/**
 * Tests for the first-run installer.
 *
 * There is no MariaDB in the test environment, so the parts that would talk to
 * it take a connection factory: the SQL is emulated here, while everything
 * else — validation, the install file, the schema versioning, the lock on the
 * setup endpoints — is the real code.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-setup-media-"));
process.env.DB_DRIVER = "memory";
process.env.MEDIA_DIR = mediaDir;
process.env.RATE_LIMIT_PER_MINUTE = "0";
process.env.BCRYPT_ROUNDS = "4";

const { applySchema, LATEST_VERSION } = await import("../db/schema.js");
const {
  friendlyDatabaseError,
  installDatabase,
  SetupError,
  testConnection,
  validateSetupInput,
} = await import("../lib/installer.js");
const { publicInstall, readInstall, writeInstall } = await import("../lib/installFile.js");

let server;
let base;

before(async () => {
  const { createApp } = await import("../app.js");
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(mediaDir, { recursive: true, force: true });
});

/** A tiny executor that records SQL and reports a chosen schema version. */
function fakeExecutor(version = 0) {
  let current = version;
  const seen = [];
  return {
    seen,
    async query(sql, params) {
      seen.push({ sql: String(sql), params });
      if (String(sql).includes("SELECT value FROM settings")) {
        return [current ? [{ value: String(current) }] : []];
      }
      if (String(sql).startsWith("INSERT INTO settings") && String(sql).includes("schema_version")) {
        current = Number(params?.[0]) || 0;
      }
      return [{ affectedRows: 1 }];
    },
  };
}

test("the schema creates tables, records its version and upgrades only once", async () => {
  const fresh = fakeExecutor(0);
  const first = await applySchema(fresh);
  assert.equal(first.version, LATEST_VERSION);
  assert.equal(first.upgradedFrom, 0);

  const statements = fresh.seen.map((entry) => entry.sql);
  assert.ok(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS users")));
  assert.ok(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS auth_events")));
  assert.ok(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS settings")));
  assert.ok(
    statements.some((sql) => sql.includes("ALTER TABLE users MODIFY role")),
    "a fresh schema applies the reader-role migration",
  );
  assert.ok(statements.some((sql) => sql.includes("'schema_version'")));

  const upgraded = fakeExecutor(LATEST_VERSION);
  const second = await applySchema(upgraded);
  assert.equal(second.upgradedFrom, LATEST_VERSION);
  assert.ok(
    !upgraded.seen.some((entry) => entry.sql.includes("ALTER TABLE users")),
    "an up-to-date database is not altered again",
  );
  assert.ok(
    !upgraded.seen.some((entry) => entry.sql.includes("schema_version") && entry.sql.startsWith("INSERT")),
    "the version row is only written when it changes",
  );
});

test("setup input is validated before any connection is opened", () => {
  const good = validateSetupInput({
    siteTitle: "  PB Travel Diaries  ",
    host: "localhost",
    port: "3306",
    database: "cpuser_pbtravel",
    user: "cpuser_pb",
    password: "secret",
  });
  assert.equal(good.siteTitle, "PB Travel Diaries");
  assert.equal(good.db.host, "localhost");
  assert.equal(good.db.port, 3306);

  assert.throws(() => validateSetupInput({ siteTitle: "", database: "x", user: "y" }), SetupError);
  assert.throws(
    () => validateSetupInput({ siteTitle: "x", database: "bad name", user: "y" }),
    /Database names/,
  );
  assert.throws(
    () => validateSetupInput({ siteTitle: "x", database: "db", user: "y", port: "70000" }),
    /port/,
  );
});

test("the install file is private, round-trips and never exposes the password", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-install-"));
  const file = path.join(dir, "install.json");
  try {
    writeInstall(
      {
        installed: true,
        siteTitle: "Trails",
        db: {
          host: "localhost",
          port: 3306,
          database: "db",
          user: "u",
          password: "top-secret",
        },
      },
      file,
    );

    const saved = readInstall(file);
    assert.equal(saved.siteTitle, "Trails");
    assert.equal(saved.db.password, "top-secret");

    const mode = (await fs.stat(file)).mode & 0o777;
    assert.equal(mode, 0o600, "only the owner may read the password file");

    const visible = publicInstall(saved);
    assert.equal(visible.database, "db");
    assert.equal("password" in visible, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("installDatabase creates the database, applies the schema and saves the answers", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-install-"));
  const file = path.join(dir, "install.json");
  const seen = [];
  const connect = async (options) => ({
    async query(sql, params) {
      seen.push({ sql: String(sql), params, database: options.database });
      if (options.database && String(sql).includes("SELECT value FROM settings")) {
        return [[{ value: String(LATEST_VERSION) }]];
      }
      return [{ affectedRows: 1 }];
    },
    async end() {},
  });

  try {
    const result = await installDatabase(
      {
        siteTitle: "PB Travel Diaries",
        host: "localhost",
        port: "3306",
        database: "cpuser_pb",
        user: "cpuser_pb",
        password: "secret",
      },
      { connect, file, apply: false },
    );

    assert.equal(result.ok, true);
    assert.equal(result.createdDatabase, true);
    assert.equal(result.needsOwner, true, "a new database has nobody to sign in as yet");
    assert.equal(result.db.password, undefined, "the result is safe to send back");

    const sql = seen.map((entry) => entry.sql).join("\n");
    assert.match(sql, /CREATE DATABASE IF NOT EXISTS `cpuser_pb`/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS users/);
    assert.match(sql, /INSERT INTO settings .*site_title/);
    assert.match(sql, /INSERT INTO settings .*allow_signup/);

    const saved = readInstall(file);
    assert.equal(saved.installed, true);
    assert.equal(saved.siteTitle, "PB Travel Diaries");
    assert.equal(saved.db.password, "secret");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a database created outside the app is connected to, not recreated", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-install-"));
  const file = path.join(dir, "install.json");
  const sql = [];
  const connect = async () => ({
    async query(statement) {
      sql.push(String(statement));
      if (String(statement).includes("information_schema.SCHEMATA")) {
        return [[{ SCHEMA_NAME: "cpuser_pb" }]];
      }
      if (String(statement).includes("SELECT value FROM settings")) {
        return [[{ value: String(LATEST_VERSION) }]];
      }
      return [{ affectedRows: 1 }];
    },
    async end() {},
  });

  try {
    const result = await installDatabase(
      { siteTitle: "PB", host: "localhost", database: "cpuser_pb", user: "cpuser_pb", password: "p" },
      { connect, file, apply: false },
    );
    assert.equal(result.createdDatabase, false, "the panel already made this database");
    assert.equal(sql.some((statement) => statement.includes("CREATE DATABASE")), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("reconnecting a database that already has an owner does not offer a second one", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-install-"));
  const file = path.join(dir, "install.json");
  const connect = async () => ({
    async query(sql) {
      if (String(sql).includes("SELECT COUNT(*) AS n FROM users")) return [[{ n: 2 }]];
      if (String(sql).includes("SELECT value FROM settings")) {
        return [[{ value: String(LATEST_VERSION) }]];
      }
      return [{ affectedRows: 1 }];
    },
    async end() {},
  });

  try {
    const result = await installDatabase(
      { siteTitle: "PB", host: "localhost", database: "db", user: "u", password: "p" },
      { connect, file, apply: false },
    );
    assert.equal(result.users, 2);
    assert.equal(result.needsOwner, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a rejected database password is explained without leaking it", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-install-"));
  const file = path.join(dir, "install.json");
  const denied = async () => {
    const error = new Error("Access denied");
    error.code = "ER_ACCESS_DENIED_ERROR";
    throw error;
  };

  try {
    await assert.rejects(
      installDatabase(
        {
          siteTitle: "x",
          host: "localhost",
          database: "db",
          user: "u",
          password: "hunter2",
        },
        { connect: denied, file, apply: false },
      ),
      (error) => {
        assert.ok(error instanceof SetupError);
        assert.match(error.message, /create that database user/i);
        assert.match(error.message, /all privileges/i);
        assert.doesNotMatch(error.message, /hunter2/);
        return true;
      },
    );
    await assert.rejects(fs.access(file), "nothing is written when setup fails");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("database errors explain what to create, without naming one hosting panel", () => {
  const db = { host: "localhost", port: 3306, database: "db", user: "u" };

  const missing = friendlyDatabaseError({ code: "ER_BAD_DB_ERROR" }, db);
  assert.match(missing, /does not exist/);
  assert.match(missing, /create it first/i);
  assert.match(missing, /all privileges/i);

  const denied = friendlyDatabaseError({ code: "ER_DBACCESS_DENIED_ERROR" }, db);
  assert.match(denied, /not allowed to open/);
  assert.match(denied, /all privileges/i);

  const refused = friendlyDatabaseError({ code: "ECONNREFUSED" }, db);
  assert.match(refused, /localhost:3306/);
  assert.match(refused, /hosting panel/i);

  // The wording is the same whichever panel the site is deployed on.
  for (const message of [missing, denied, refused]) {
    assert.doesNotMatch(message, /cPanel|Plesk|DirectAdmin|Namecheap/i);
  }
});

test("testing a missing database reports what is there and what is missing", async () => {
  let sawWithoutDatabase = false;
  const connect = async (options) => ({
    async query(statement) {
      if (!options.database) {
        sawWithoutDatabase = true;
        return [[{ version: "10.11.6-MariaDB" }]];
      }
      const error = new Error("Unknown database 'pb_new'");
      error.code = "ER_BAD_DB_ERROR";
      throw error;
    },
    async end() {},
  });

  const result = await testConnection(
    { siteTitle: "PB", host: "localhost", database: "pb_new", user: "pb_user", password: "p" },
    { connect },
  );

  assert.equal(sawWithoutDatabase, true, "the server is still asked whether it answers");
  assert.equal(result.ok, false);
  assert.equal(result.databaseExists, false);
  assert.equal(result.serverVersion, "10.11.6-MariaDB");
  assert.match(result.message, /does not exist yet/);
  assert.match(result.message, /create it in your hosting panel/i);
  assert.match(result.message, /all privileges/i);
});

test("a successful connection test says the database is reachable", async () => {
  const connect = async () => ({
    async query() {
      return [[{ version: "10.11.6-MariaDB", current: "pb" }]];
    },
    async end() {},
  });

  const result = await testConnection(
    { siteTitle: "PB", host: "localhost", database: "pb", user: "pb_user", password: "p" },
    { connect },
  );
  assert.equal(result.ok, true);
  assert.equal(result.databaseExists, true);
  assert.match(result.message, /10\.11\.6-MariaDB/);
  assert.match(result.message, /can open it/);
});

test("creating tables on a missing database asks for it to be created first", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-install-"));
  const file = path.join(dir, "install.json");
  const connect = async (options) => ({
    async query(statement) {
      if (String(statement).includes("information_schema.SCHEMATA")) return [[]];
      if (String(statement).includes("CREATE DATABASE")) {
        const error = new Error("Access denied");
        error.code = "ER_DBACCESS_DENIED_ERROR";
        throw error;
      }
      // Opening the database tells the installer the database itself is gone,
      // rather than merely not granted to this user.
      if (options.database) {
        const error = new Error("Unknown database 'pb_new'");
        error.code = "ER_BAD_DB_ERROR";
        throw error;
      }
      return [{ affectedRows: 1 }];
    },
    async end() {},
  });

  try {
    await assert.rejects(
      installDatabase(
        { siteTitle: "PB", host: "localhost", database: "pb_new", user: "pb_user", password: "p" },
        { connect, file, apply: false },
      ),
      (error) => {
        assert.ok(error instanceof SetupError);
        assert.match(error.message, /does not exist yet/);
        assert.match(error.message, /add the user/i);
        assert.match(error.message, /all privileges/i);
        return true;
      },
    );
    await assert.rejects(fs.access(file), "no install file for a failed setup");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a database the user cannot open is distinguished from a missing one", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-install-"));
  const file = path.join(dir, "install.json");
  const connect = async (options) => ({
    async query(statement) {
      if (String(statement).includes("information_schema.SCHEMATA")) return [[]];
      if (String(statement).includes("CREATE DATABASE")) {
        const error = new Error("Access denied");
        error.code = "ER_DBACCESS_DENIED_ERROR";
        throw error;
      }
      if (options.database) {
        const error = new Error("Access denied for database");
        error.code = "ER_DBACCESS_DENIED_ERROR";
        throw error;
      }
      return [{ affectedRows: 1 }];
    },
    async end() {},
  });

  try {
    await assert.rejects(
      installDatabase(
        { siteTitle: "PB", host: "localhost", database: "pb_existing", user: "pb_user", password: "p" },
        { connect, file, apply: false },
      ),
      (error) => {
        assert.ok(error instanceof SetupError);
        assert.match(error.message, /exists, but the user/i);
        assert.match(error.message, /all privileges/i);
        assert.doesNotMatch(error.message, /does not exist/i);
        return true;
      },
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("setup endpoints are locked once a site is installed", async () => {
  // In memory mode the site is always "installed"; the destructive endpoints
  // must refuse rather than rewrite a live configuration.
  const status = await fetch(base + "/api/setup/status").then((r) => r.json());
  assert.equal(status.installed, true);
  assert.equal(status.needsOwner, false);
  assert.equal(status.mode, "memory");

  const attempt = await fetch(base + "/api/setup/database", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteTitle: "x", database: "db", user: "u" }),
  });
  assert.equal(attempt.status, 403);

  const owner = await fetch(base + "/api/setup/owner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "someone", password: "password1" }),
  });
  assert.equal(owner.status, 403);
});
