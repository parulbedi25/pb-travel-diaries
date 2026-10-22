import { databaseIdentifier } from "./sqlSafety.js";
/**
 * Turn the answers from the setup screen into a working database.
 *
 * The database and its user are created in the hosting panel (or by a
 * database administrator) before this screen is used — no app running over
 * the web should be the thing that creates accounts. This module connects,
 * creates the database only when that user is allowed to, creates every table
 * (idempotently), seeds the deployment settings, and only then writes the
 * credential file. A failure at any point leaves the site still "not
 * installed", so the screen can simply be retried.
 */
import mysql from "mysql2/promise";
import { applyInstall } from "../config.js";
import { applySchema, LATEST_VERSION } from "../db/schema.js";
import { installFilePath, publicInstall, writeInstall } from "./installFile.js";

/** An error whose message is safe and useful to show on the setup screen. */
export class SetupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "SetupError";
    this.status = status;
  }
}

/**
 * Hosting panels often prefix database and user names with the account name,
 * so keep the accepted set wide and do not "correct" what the panel issued.
 */
const NAME_PATTERN = /^[A-Za-z0-9_$-]{1,64}$/;
const HOST_PATTERN = /^[A-Za-z0-9._:-]{1,255}$/;

/**
 * Validate and normalise the form. Returns the values the rest of this module
 * uses; throws SetupError with a sentence written for a person.
 */
export function validateSetupInput(input = {}) {
  const siteTitle = String(input.siteTitle ?? "").trim();
  if (siteTitle.length < 1) throw new SetupError("Give the website a title.");
  if (siteTitle.length > 120) throw new SetupError("Keep the website title under 120 characters.");
  return { siteTitle, db: validateDatabase(input) };
}

/**
 * The database half of a form, validated on its own. The restore screen uses
 * this too: it has no website title to ask for, but the names, the port and
 * the password rules are identical.
 */
export function validateDatabase(input = {}) {
  const host = String(input.host ?? "").trim() || "127.0.0.1";
  const socketPath = String(input.socketPath ?? "").trim();
  if (!socketPath && !HOST_PATTERN.test(host)) {
    throw new SetupError("That database host does not look right.");
  }

  const database = String(input.database ?? "").trim();
  if (!database) throw new SetupError("Enter the database name.");
  if (!NAME_PATTERN.test(database)) {
    throw new SetupError("Database names can use letters, numbers, underscore, dash and $ only.");
  }

  const user = String(input.user ?? "").trim();
  if (!user) throw new SetupError("Enter the database username.");
  if (!NAME_PATTERN.test(user)) {
    throw new SetupError("Database usernames can use letters, numbers, underscore, dash and $ only.");
  }

  const rawPort = String(input.port ?? "").trim() || "3306";
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new SetupError("The database port must be a number between 1 and 65535.");
  }

  const password = String(input.password ?? "");
  if (password.length > 400) throw new SetupError("That database password is too long.");

  return { host, port, user, password, database, socketPath: socketPath || undefined };
}

/** Connection options for a database, from validated fields. */
export function connectionOptions(db, { withDatabase } = {}) {
  const options = {
    multipleStatements: false,
    user: db.user,
    password: db.password,
    charset: "utf8mb4",
    connectTimeout: 10_000,
  };
  if (db.socketPath) {
    options.socketPath = db.socketPath;
  } else {
    options.host = db.host;
    options.port = db.port;
  }
  if (withDatabase) options.database = db.database;
  return options;
}

/**
 * Explain the common failures in terms of what the person can do next.
 * Deliberately host-agnostic: the same words fit any panel, a managed
 * database and a VPS. Never echoes the password back.
 */
export function friendlyDatabaseError(error, db) {
  const code = error?.code ?? "";
  const where = db.socketPath ? db.socketPath : `${db.host}:${db.port}`;
  switch (code) {
    case "ER_ACCESS_DENIED_ERROR":
    case "ER_ACCESS_DENIED_NO_PASSWORD_ERROR":
      return `The user “${db.user}” could not sign in. Create that database user in your hosting panel with this exact password, add it to “${db.database}” with all privileges, then enter the same details here.`;
    case "ER_BAD_DB_ERROR":
      return `The database “${db.database}” does not exist. Create it first in your hosting panel (MySQL / MariaDB → Databases), add the user “${db.user}” to it with all privileges, then enter those details here.`;
    case "ER_DBACCESS_DENIED_ERROR":
      return `The database “${db.database}” exists, but the user “${db.user}” is not allowed to open it. Add the user to that database with all privileges in your hosting panel, then try again.`;
    case "ECONNREFUSED":
      return `Nothing accepted a connection at ${where}. Check the database host and port shown in your hosting panel — on most setups the host is “localhost”.`;
    case "ENOTFOUND":
      return `The host “${db.host}” could not be found. Use the database host from your hosting panel — usually “localhost”.`;
    case "ETIMEDOUT":
      return `Connecting to ${where} timed out. Check the host and port, and whether your host allows remote database connections.`;
    case "ER_NOT_SUPPORTED_AUTH_MODE":
      return "This MariaDB server uses an authentication method the app does not support. Ask your host to use mysql_native_password for this database user.";
    case "ER_TOO_MANY_USER_CONNECTIONS":
    case "ER_CON_COUNT_ERROR":
      return "The database has no free connections right now. Wait a moment and try again.";
    default:
      return `Could not set up the database: ${error?.message ?? "unknown error"}`;
  }
}

/** What to do when the database itself has not been created yet. */
function missingDatabaseMessage(db) {
  return (
    `The database “${db.database}” does not exist yet. Create it in your hosting panel ` +
    `(MySQL / MariaDB → Databases), add the user “${db.user}” to it with all privileges, ` +
    "then enter those same details here."
  );
}

/**
 * Check the credentials without changing anything.
 *
 * Returns a report rather than throwing for the ordinary "not created yet"
 * cases, so the setup screen can show what is missing instead of a red error
 * with no way forward:
 *
 *   { ok: true,  serverVersion, databaseExists: true,  message }
 *   { ok: false, serverVersion, databaseExists: false, message }
 *
 * A server that cannot be reached at all still throws a SetupError.
 * `connect` is injectable so the tests can run the whole flow without MariaDB.
 */
export async function testConnection(input, { connect = mysql.createConnection } = {}) {
  const { db } = validateSetupInput(input);

  try {
    const connection = await connect(connectionOptions(db, { withDatabase: true }));
    try {
      const [rows] = await connection.query("SELECT VERSION() AS version, DATABASE() AS current");
      const serverVersion = String(rows?.[0]?.version ?? "");
      return {
        ok: true,
        serverVersion,
        database: db.database,
        databaseExists: true,
        message:
          `Connected to MariaDB ${serverVersion}`.trim() +
          ` — “${db.database}” exists and “${db.user}” can open it.`,
      };
    } finally {
      await connection.end();
    }
  } catch (error) {
    if (error?.code !== "ER_BAD_DB_ERROR") {
      throw new SetupError(friendlyDatabaseError(error, db), 400);
    }

    // The password was accepted but the database is missing. Confirm the
    // server itself answers, then say exactly what to create first.
    try {
      const connection = await connect(connectionOptions(db, { withDatabase: false }));
      try {
        const [rows] = await connection.query("SELECT VERSION() AS version");
        return {
          ok: false,
          serverVersion: String(rows?.[0]?.version ?? ""),
          database: db.database,
          databaseExists: false,
          message: missingDatabaseMessage(db),
        };
      } finally {
        await connection.end();
      }
    } catch (inner) {
      if (inner instanceof SetupError) throw inner;
      throw new SetupError(friendlyDatabaseError(inner, db), 400);
    }
  }
}

/**
 * Create the database when allowed, create the tables, seed the settings, and
 * save the credentials. The install file is written last: if anything fails,
 * the next visit still opens the setup screen.
 */
export async function installDatabase(input, options = {}) {
  const { connect = mysql.createConnection, file = installFilePath(), apply = true } = options;
  const { siteTitle, db } = validateSetupInput(input);

  let createdDatabase = false;
  // The database is missing and this user may not create it; the connection
  // attempt below decides whether it is absent or merely not granted.
  let createDenied = false;
  const counts = { users: 0 };

  // Connecting without a database works even when the user has no global
  // privileges, and lets "the database already exists" pass.
  let admin;
  try {
    admin = await connect(connectionOptions(db, { withDatabase: false }));
  } catch (error) {
    throw new SetupError(friendlyDatabaseError(error, db), 400);
  }
  try {
    // Does the database already exist? On most hosting the database is made
    // in the panel first, in which case `createdDatabase` should say so.
    let exists = false;
    try {
      const [rows] = await admin.query(
        "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1",
        [db.database],
      );
      exists = (rows?.length ?? 0) > 0;
    } catch {
      // Some hosts hide information_schema; fall through and let the CREATE
      // (or the connection below) give the final answer.
    }

    if (!exists) {
      try {
        await admin.query(
          `CREATE DATABASE IF NOT EXISTS ${databaseIdentifier(db.database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        );
        createdDatabase = true;
      } catch (error) {
        // Shared hosting almost never lets an application create databases;
        // the panel does that. Whether the database is missing, or present but
        // not granted to this user, is only clear once we try to open it — the
        // connection below says which of the two it is.
        const denied = [
          "ER_DBACCESS_DENIED_ERROR",
          "ER_ACCESS_DENIED_ERROR",
          "ER_ACCESS_DENIED_NO_PASSWORD_ERROR",
          "ER_SPECIFIC_ACCESS_DENIED_ERROR",
          "ER_CANT_CREATE_DB",
        ];
        if (!denied.includes(error?.code)) {
          throw new SetupError(friendlyDatabaseError(error, db), 400);
        }
        createDenied = true;
      }
    }
  } finally {
    await admin.end();
  }

  let connection;
  try {
    connection = await connect(connectionOptions(db, { withDatabase: true }));
  } catch (error) {
    if (createDenied && error?.code === "ER_BAD_DB_ERROR") {
      throw new SetupError(missingDatabaseMessage(db), 400);
    }
    throw new SetupError(friendlyDatabaseError(error, db), 400);
  }

  try {
    await applySchema(connection);

    // The site title lives in the database, not in the build, so it can be
    // changed later from the dashboard without rebuilding.
    await connection.query(
      `INSERT INTO settings (setting_key, value) VALUES ('site_title', ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [JSON.stringify(siteTitle)],
    );
    // New installations let people create read-only accounts from the public
    // sign-up page; the owner can switch that off in Settings.
    await connection.query(
      `INSERT INTO settings (setting_key, value) VALUES ('allow_signup', 'true')
       ON DUPLICATE KEY UPDATE value = value`,
    );

    // A database that already has an owner is being reconnected (for example
    // after install.json was lost). Do not offer to create a second owner.
    const [rows] = await connection.query("SELECT COUNT(*) AS n FROM users");
    counts.users = Number(rows?.[0]?.n ?? 0);
  } catch (error) {
    // The connection can be lazy: a driver may only discover that the
    // database is missing or not granted when the first statement runs.
    if (error?.code === "ER_BAD_DB_ERROR") {
      throw new SetupError(missingDatabaseMessage(db), 400);
    }
    if (error?.code === "ER_DBACCESS_DENIED_ERROR" || error?.code === "ER_ACCESS_DENIED_ERROR") {
      throw new SetupError(friendlyDatabaseError(error, db), 400);
    }
    throw new SetupError(`The tables could not be created: ${error?.message ?? "unknown error"}`, 400);
  } finally {
    await connection.end();
  }

  const answers = {
    installed: true,
    siteTitle,
    db: {
      host: db.host,
      port: db.port,
      database: db.database,
      user: db.user,
      password: db.password,
      ...(db.socketPath ? { socketPath: db.socketPath } : {}),
    },
    schemaVersion: LATEST_VERSION,
    installedAt: new Date().toISOString(),
  };
  try {
    writeInstall(answers, file);
  } catch {
    // The tables exist, but without this file the next boot would not know
    // where they are. Say exactly which permission to fix.
    throw new SetupError(
      "The database and tables are ready, but the app could not save its connection details. Make the data folder writable (chmod 775 data) and try again.",
      500,
    );
  }

  if (apply) applyInstall(answers);

  return {
    ok: true,
    siteTitle,
    createdDatabase,
    db: publicInstall(answers),
    schemaVersion: LATEST_VERSION,
    users: counts.users,
    needsOwner: counts.users === 0,
  };
}
