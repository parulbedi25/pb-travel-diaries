/**
 * Turn the answers from the setup screen into a working database.
 *
 * The user supplies the MariaDB host, database, user and password they created
 * in cPanel. This module connects, creates the database when their account is
 * allowed to, creates every table (idempotently), seeds the deployment
 * settings, and only then writes the credential file. A failure at any point
 * leaves the site still "not installed", so the screen can simply be retried.
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

/** cPanel prefixes database and user names, so keep the accepted set wide. */
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

  const host = String(input.host ?? "").trim() || "127.0.0.1";
  const socketPath = String(input.socketPath ?? "").trim();
  if (!socketPath && !HOST_PATTERN.test(host)) {
    throw new SetupError("That database host does not look right.");
  }

  const database = String(input.database ?? "").trim();
  if (!database) throw new SetupError("Enter the database name from cPanel.");
  if (!NAME_PATTERN.test(database)) {
    throw new SetupError("Database names can use letters, numbers, underscore, dash and $ only.");
  }

  const user = String(input.user ?? "").trim();
  if (!user) throw new SetupError("Enter the database username from cPanel.");
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

  return { siteTitle, db: { host, port, user, password, database, socketPath: socketPath || undefined } };
}

function optionsFor(db, { withDatabase }) {
  const options = {
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
 * Never echoes the password back.
 */
export function friendlyDatabaseError(error, db) {
  const code = error?.code ?? "";
  const where = db.socketPath ? db.socketPath : `${db.host}:${db.port}`;
  switch (code) {
    case "ER_ACCESS_DENIED_ERROR":
      return "MariaDB rejected that username or password. Check the database user's password in cPanel's MySQL Databases page.";
    case "ER_BAD_DB_ERROR":
      return `The database “${db.database}” does not exist. Create it in cPanel → MySQL® Databases, then try again.`;
    case "ER_DBACCESS_DENIED_ERROR":
      return `The user “${db.user}” is not allowed to open “${db.database}”. Add the user to that database in cPanel and give it ALL PRIVILEGES.`;
    case "ECONNREFUSED":
      return `Nothing accepted a connection at ${where}. On cPanel the host is usually “localhost”.`;
    case "ENOTFOUND":
      return `The host “${db.host}” could not be found. On cPanel use “localhost”.`;
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

/**
 * Check the credentials without changing anything.
 * `connect` is injectable so the tests can run the whole flow without MariaDB.
 */
export async function testConnection(input, { connect = mysql.createConnection } = {}) {
  const { db } = validateSetupInput(input);

  try {
    const connection = await connect(optionsFor(db, { withDatabase: true }));
    try {
      const [rows] = await connection.query("SELECT VERSION() AS version, DATABASE() AS current");
      return {
        ok: true,
        database: db.database,
        serverVersion: String(rows?.[0]?.version ?? ""),
      };
    } finally {
      await connection.end();
    }
  } catch (error) {
    if (error?.code !== "ER_BAD_DB_ERROR") {
      throw new SetupError(friendlyDatabaseError(error, db), 400);
    }
    // The database is missing — say whether the server itself is reachable,
    // because that changes which cPanel page to open.
    try {
      const connection = await connect(optionsFor(db, { withDatabase: false }));
      await connection.end();
      throw new SetupError(
        `MariaDB answered, but the database “${db.database}” does not exist yet. Create it in cPanel → MySQL® Databases, or let this screen create it.`,
        400,
      );
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
  const counts = { users: 0 };

  // Connecting without a database works even when the user has no global
  // privileges, and lets a cPanel-style "database already exists" pass.
  let admin;
  try {
    admin = await connect(optionsFor(db, { withDatabase: false }));
  } catch (error) {
    throw new SetupError(friendlyDatabaseError(error, db), 400);
  }
  try {
    // Does the database already exist? A cPanel account usually creates it
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
          `CREATE DATABASE IF NOT EXISTS \`${db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        );
        createdDatabase = true;
      } catch (error) {
        // cPanel users usually cannot create databases — that is fine, the
        // database is created in the panel and just has to exist.
        if (!["ER_DBACCESS_DENIED_ERROR", "ER_ACCESS_DENIED_ERROR", "ER_SPECIFIC_ACCESS_DENIED_ERROR"].includes(error?.code)) {
          throw new SetupError(friendlyDatabaseError(error, db), 400);
        }
      }
    }
  } finally {
    await admin.end();
  }

  let connection;
  try {
    connection = await connect(optionsFor(db, { withDatabase: true }));
  } catch (error) {
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
