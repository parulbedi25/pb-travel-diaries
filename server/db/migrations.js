/**
 * Every change the database has ever needed, in the order it happened.
 *
 * A migration is a version number, a short name, and an `up(executor)` that
 * brings a database from the previous version to this one. `up` may run any
 * SQL and may also move data around — a new column can be filled in, a setting
 * can be renamed, rows can be backfilled — because it receives the connection
 * rather than a list of statements.
 *
 * Adding a feature later is one entry at the end of this array:
 *
 *   {
 *     version: 4,
 *     name: "add the rides table",
 *     up: sql(
 *       `CREATE TABLE IF NOT EXISTS rides (...)`,
 *       `ALTER TABLE users ADD COLUMN rides_seen INT NOT NULL DEFAULT 0`,
 *     ),
 *   }
 *
 * and then `npm run db:migrate` (or simply restarting the server) applies it.
 * Never edit a migration that has shipped: some installations have already run
 * it, and the ledger records it by version number and name. Add a new one.
 *
 * Never add a column to `BASE_STATEMENTS` in schema.js either. Those are the
 * tables as they looked at version 1, and they must stay that way — a fresh
 * installation creates them and then replays every migration on top, exactly
 * like a database that has been running for years.
 */

/**
 * A migration body made of plain statements, run in order.
 *
 * Note that MySQL has no `ADD COLUMN IF NOT EXISTS`, which is precisely why the
 * ledger exists: each version runs once and is never attempted again.
 */
export function sql(...statements) {
  const run = async (executor) => {
    for (const statement of statements) await executor.query(statement);
  };
  // `npm run schema:sql` reads this so the generated file matches the app.
  run.statements = statements;
  return run;
}

/**
 * The event labels the access log understands. Adding one means a migration
 * that alters the enum, which is what version 3 does below.
 */
export const AUTH_EVENTS = [
  "signup",
  "login",
  "logout",
  "failed_login",
  "password_change",
  "user_created",
  "user_deleted",
  "user_disabled",
  "user_enabled",
];

export const MIGRATIONS = [
  {
    version: 1,
    name: "initial schema",
    // The tables themselves are created by BASE_STATEMENTS before any
    // migration runs, so version 1 only records that it happened.
    up: sql(),
  },
  {
    version: 2,
    name: "read-only reader role",
    // PR #17 shipped only owner/admin. Readers join them without touching the
    // rows that already exist.
    up: sql("ALTER TABLE users MODIFY role ENUM('owner','admin','reader') NOT NULL DEFAULT 'reader'"),
  },
  {
    version: 3,
    name: "disabled accounts",
    up: sql(
      // When an account was switched off, so the dashboard can show it. The
      // `disabled` flag itself has been there since version 1.
      "ALTER TABLE users ADD COLUMN disabled_at DATETIME NULL AFTER disabled",
      // New events: an account disabled or re-enabled from the dashboard.
      `ALTER TABLE auth_events MODIFY event ENUM(${AUTH_EVENTS.map((e) => `'${e}'`).join(",")}) NOT NULL`,
    ),
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
