/**
 * Upgrading a database that is already in use.
 *
 * The installer tests cover a brand-new database. These cover the other half,
 * which is the one that matters on a live site: a database that is one, two or
 * five versions behind the code, upgraded while the site keeps serving.
 *
 * Four things have to hold, and each has a test below:
 *
 *  - A fresh install ends at the latest version, member garage included.
 *  - A database that is behind runs only what is new.
 *  - An upgrade interrupted halfway is finished by running it again — not
 *    stuck on a column it already added.
 *  - Two upgrades cannot run at once, and a dry run changes nothing.
 *
 * The MySQL half runs against an executor that records SQL and answers like the
 * ledger; the SQLite half runs against a real SQLite file, because that driver
 * is available here and its migration path is its own.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DB_DRIVER = "memory";
process.env.RATE_LIMIT_PER_MINUTE = "0";
process.env.BCRYPT_ROUNDS = "4";

const { applySchema, planMigrations, migrationStatus, LATEST_VERSION } = await import("../db/schema.js");
const { MIGRATIONS } = await import("../db/migrations.js");
const { isAlreadyApplied, isMissingSchema } = await import("../db/migrationErrors.js");

/**
 * An executor that behaves like a database with `version` already applied.
 *
 * `onQuery` can answer or throw for a statement before the default handling, so
 * a test can make one specific step fail the way a real server would.
 */
function fakeDb({ version = 0, onQuery } = {}) {
  const ledger = new Set();
  for (let v = 1; v <= version; v += 1) ledger.add(v);

  const seen = [];
  return {
    ledger,
    seen,
    statements() {
      return seen.map((entry) => entry.sql);
    },
    async query(sql, params) {
      const text = String(sql);
      seen.push({ sql: text, params });
      if (onQuery) {
        const answer = await onQuery(text, params, seen);
        if (answer !== undefined) return answer;
      }
      if (text.includes("SELECT MAX(version) AS version FROM schema_migrations")) {
        return [[{ version: ledger.size ? Math.max(...ledger) : null }]];
      }
      if (text.includes("COUNT(*) AS n FROM schema_migrations")) {
        return [[{ n: ledger.size }]];
      }
      if (text.includes("INSERT IGNORE INTO schema_migrations") || text.includes("INSERT INTO schema_migrations")) {
        ledger.add(Number(params?.[0]));
        return [{ affectedRows: 1 }];
      }
      if (text.includes("SELECT value FROM settings")) {
        return [[{ value: "0" }]];
      }
      if (text.includes("GET_LOCK")) return [[{ ok: 1 }]];
      if (text.includes("RELEASE_LOCK")) return [[{ ok: 1 }]];
      return [{ affectedRows: 1 }];
    },
  };
}

/** A MySQL error with the code the driver would use. */
const mysqlError = (code, message) => Object.assign(new Error(message), { code });

test("a fresh database ends at the latest version, member garage included", async () => {
  const db = fakeDb();
  const result = await applySchema(db);

  assert.equal(result.version, LATEST_VERSION);
  assert.equal(result.upgradedFrom, 0);
  assert.deepEqual(result.applied, [1, 2, 3, 4, 5, 6]);

  const statements = db.statements().join("\n");
  assert.match(statements, /CREATE TABLE IF NOT EXISTS member_bikes/);
  assert.match(statements, /CREATE TABLE IF NOT EXISTS member_journeys/);
  assert.match(statements, /CREATE INDEX member_journeys_bike/);
  assert.equal(db.ledger.size, LATEST_VERSION, "every version is in the ledger");
});

test("a database that is behind runs only what is new", async () => {
  const db = fakeDb({ version: 4 });
  const result = await applySchema(db);

  assert.equal(result.upgradedFrom, 4);
  assert.deepEqual(result.applied, [5, 6], "the member garage and its index");

  const statements = db.statements().join("\n");
  assert.ok(!statements.includes("MODIFY event ENUM"), "no shipped migration is replayed");
  assert.ok(!statements.includes("ADD COLUMN disabled_at"));

  // The base tables are still declared, but only as `IF NOT EXISTS`: saying
  // "make sure this exists" costs nothing and is what lets the same code path
  // serve a brand-new database and a year-old one.
  const created = db.seen.filter((entry) => /^CREATE TABLE/.test(entry.sql.trim()));
  assert.ok(created.length > 0);
  for (const entry of created) {
    assert.match(entry.sql.trim(), /^CREATE TABLE IF NOT EXISTS/i, entry.sql.slice(0, 40));
  }
});

test("an upgrade interrupted halfway is finished by running it again", async () => {
  // First attempt: the column lands, then the next statement fails hard (a
  // dropped connection, a lock timeout — anything that is not "already done").
  const first = fakeDb({
    onQuery: (sql) => {
      if (sql.includes("MODIFY event ENUM")) {
        throw mysqlError("ER_LOCK_WAIT_TIMEOUT", "Lock wait timeout exceeded");
      }
      return undefined;
    },
  });

  await assert.rejects(applySchema(first), /Lock wait timeout/);
  assert.equal(first.ledger.has(3), false, "the failed version is not recorded as done");

  // Second attempt: the column from the interrupted run is still there, so the
  // replay meets its own work. That must not stop the upgrade.
  const second = fakeDb({
    version: 2,
    onQuery: (sql) => {
      if (sql.includes("ADD COLUMN disabled_at")) {
        throw mysqlError("ER_DUP_FIELDNAME", "Duplicate column name 'disabled_at'");
      }
      return undefined;
    },
  });

  const result = await applySchema(second);
  assert.deepEqual(result.applied, [3, 4, 5, 6]);
  assert.equal(second.ledger.has(3), true, "and it finishes, rather than failing forever");
});

test("an upgrade takes the schema lock, and a busy lock stops it", async () => {
  const db = fakeDb({ version: 5 });
  await applySchema(db);

  const statements = db.statements();
  const lockAt = statements.findIndex((sql) => sql.includes("GET_LOCK"));
  const firstChange = statements.findIndex((sql) => /^(CREATE|ALTER|INSERT)/.test(sql.trim()));
  assert.ok(lockAt >= 0 && lockAt < firstChange, "the lock is taken before anything is written");
  assert.ok(statements.some((sql) => sql.includes("RELEASE_LOCK")), "and released afterwards");

  // Somebody else is already upgrading.
  const busy = fakeDb({
    version: 4,
    onQuery: (sql) => (sql.includes("GET_LOCK") ? [[{ ok: 0 }]] : undefined),
  });
  await assert.rejects(applySchema(busy), (error) => error.code === "SCHEMA_LOCK_TIMEOUT");
  assert.ok(
    !busy.statements().some((sql) => /^(CREATE|ALTER)/.test(sql.trim())),
    "nothing is touched when the lock is not ours",
  );
});

test("a dry run says what is waiting and changes nothing", async () => {
  const db = fakeDb({ version: 4 });
  const plan = await planMigrations(db);

  assert.equal(plan.installed, 4);
  assert.equal(plan.latest, LATEST_VERSION);
  assert.deepEqual(
    plan.pending.map((entry) => entry.version),
    [5, 6],
  );
  assert.deepEqual(
    plan.pending.map((entry) => entry.name),
    ["member garages and journeys", "member garage lookups"],
  );
  assert.deepEqual(
    plan.pending.map((entry) => entry.statements),
    [2, 1],
    "each step says how many statements it is made of",
  );
  assert.ok(
    !db.seen.some((entry) => /^(CREATE|ALTER|INSERT|UPDATE)/.test(entry.sql.trim())),
    "read-only: no schema or data was touched",
  );
});

test("migration status still hands back the entries themselves", async () => {
  const db = fakeDb({ version: 5 });
  const status = await migrationStatus(db);
  assert.equal(status.installed, 5);
  assert.equal(status.latest, LATEST_VERSION);
  assert.equal(status.pending.length, 1);
  assert.equal(status.pending[0].version, 6);
  assert.equal(typeof status.pending[0].up, "function", "callers can still run it");
});

test("the error teller knows an upgrade apart from a fault", () => {
  assert.equal(isAlreadyApplied(mysqlError("ER_DUP_FIELDNAME", "Duplicate column name 'x'")), true);
  assert.equal(isAlreadyApplied(mysqlError("ER_DUP_KEYNAME", "Duplicate key name 'x'")), true);
  assert.equal(isAlreadyApplied(new Error("duplicate column name: disabled_at")), true);
  assert.equal(isAlreadyApplied(mysqlError("ER_LOCK_WAIT_TIMEOUT", "Lock wait timeout")), false);
  assert.equal(isAlreadyApplied(mysqlError("ER_TABLEACCESS_DENIED_ERROR", "denied")), false);

  assert.equal(isMissingSchema(mysqlError("ER_NO_SUCH_TABLE", "Table 'member_bikes' doesn't exist")), true);
  assert.equal(isMissingSchema(new Error("no such table: member_bikes")), true);
  assert.equal(isMissingSchema(new Error("SQLITE_BUSY: database is locked")), false);
});

test("the health endpoint reports where the schema is", async () => {
  const { createApp } = await import("../app.js");
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ok, true);
    // The in-memory driver is created at the current version, so nothing waits.
    assert.equal(health.schema.installed, LATEST_VERSION);
    assert.equal(health.schema.latest, LATEST_VERSION);
    assert.deepEqual(health.schema.pending, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a request that meets a half-upgraded database gets a 503, not a 500", async () => {
  const { createApp } = await import("../app.js");
  const { getRepo } = await import("../db/index.js");
  const repo = await getRepo();
  const original = repo.getContent;
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;

    // The shape a driver raises when the code asks for a table that the
    // upgrade has not created yet.
    repo.getContent = async () => {
      throw Object.assign(new Error("Table 'member_bikes' doesn't exist"), { code: "ER_NO_SUCH_TABLE" });
    };
    const missing = await fetch(`${base}/api/content`);
    assert.equal(missing.status, 503);
    const body = await missing.json();
    assert.equal(body.code, "schema_pending");
    assert.match(body.error, /upgraded/i);
    assert.ok(!("detail" in body), "no stack-trace detail for a scheduled step");

    // Anything else is still a genuine failure.
    repo.getContent = async () => {
      throw Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK" });
    };
    const broken = await fetch(`${base}/api/content`);
    assert.equal(broken.status, 500);
  } finally {
    repo.getContent = original;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("every SQLite upgrade lands, including the member indexes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-migrate-"));
  const file = path.join(dir, "pb.sqlite");
  const { createSqliteRepo } = await import("../db/sqlite.js");
  const { DatabaseSync } = await import("node:sqlite");

  const repo = await createSqliteRepo(file);
  try {
    const first = await repo.migrate();
    assert.equal(first.version, 4, "the SQLite ledger reaches its own latest");
    assert.deepEqual(first.applied, [1, 2, 3, 4]);

    const twice = await repo.migrate();
    assert.deepEqual(twice.applied, [], "a second run has nothing to do");

    const status = await repo.schemaStatus();
    assert.equal(status.installed, 4);
    assert.deepEqual(status.pending, []);
  } finally {
    await repo.close();
  }

  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const indexes = db.prepare("PRAGMA index_list('member_journeys')").all().map((row) => row.name);
    assert.ok(indexes.includes("member_journeys_bike"), "the ride→bike lookup is indexed");
    assert.ok(indexes.includes("member_journeys_user"));
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    assert.ok(tables.includes("member_bikes"));
    assert.ok(tables.includes("member_journeys"));
  } finally {
    db.close();
  }

  await fs.rm(dir, { recursive: true, force: true });
});

test("an interrupted SQLite upgrade resumes instead of failing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-migrate-"));
  const file = path.join(dir, "pb.sqlite");
  const { createSqliteRepo } = await import("../db/sqlite.js");
  const { DatabaseSync } = await import("node:sqlite");

  const repo = await createSqliteRepo(file);
  try {
    await repo.migrate();
  } finally {
    await repo.close();
  }

  // Pretend the last version was interrupted after its statement ran but before
  // the ledger row was written.
  const db = new DatabaseSync(file);
  db.prepare("DELETE FROM pb_schema_migrations WHERE version = 4").run();
  db.close();

  const again = await createSqliteRepo(file);
  try {
    const result = await again.migrate();
    assert.deepEqual(result.applied, [4], "it is replayed, not refused");
  } finally {
    await again.close();
  }

  await fs.rm(dir, { recursive: true, force: true });
});

test("SQLite status names what is waiting, before anything runs", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-status-"));
  const file = path.join(dir, "pb.sqlite");
  const { DatabaseSync } = await import("node:sqlite");
  const { sqliteMigrationStatus, SQLITE_VERSION } = await import("../db/sqliteMigrations.js");
  const { createSqliteRepo } = await import("../db/sqlite.js");

  // Nothing at all yet: the whole list waits, and it is still read-only.
  const blank = new DatabaseSync(file);
  try {
    const plan = sqliteMigrationStatus(blank);
    assert.equal(plan.installed, 0);
    assert.equal(plan.latest, SQLITE_VERSION);
    assert.deepEqual(
      plan.pending.map((entry) => entry.version),
      [1, 2, 3, 4],
    );
    for (const entry of plan.pending) {
      assert.equal(typeof entry.statements, "number");
      assert.ok(entry.name.length > 0);
    }
  } finally {
    blank.close();
  }

  const repo = await createSqliteRepo(file);
  try {
    await repo.migrate();
  } finally {
    await repo.close();
  }

  // Behind by one, the way a site is for the minute after a deploy.
  const behind = new DatabaseSync(file);
  try {
    behind.prepare("DELETE FROM pb_schema_migrations WHERE version = 4").run();
    behind.exec("DROP INDEX member_journeys_bike");
    const plan = sqliteMigrationStatus(behind);
    assert.equal(plan.installed, 3);
    assert.deepEqual(plan.pending.map((entry) => entry.version), [4]);
    assert.equal(plan.pending[0].name, "member garage lookups");
  } finally {
    behind.close();
  }

  // And running the real upgrader finishes exactly that step.
  const again = await createSqliteRepo(file);
  try {
    assert.deepEqual((await again.migrate()).applied, [4]);
  } finally {
    await again.close();
  }

  await fs.rm(dir, { recursive: true, force: true });
});

test("the ledger and the shipped migrations agree", () => {
  // Guards against a version being renumbered or a gap appearing, either of
  // which would make an installed database miss a step.
  for (const [index, migration] of MIGRATIONS.entries()) {
    assert.equal(migration.version, index + 1, `v${migration.version} is out of order`);
    assert.ok(migration.name.length > 0);
    assert.equal(typeof migration.up, "function");
    assert.ok(
      Array.isArray(migration.up.statements),
      `v${migration.version} should be made of statements so the schema file can show it`,
    );
  }
});
