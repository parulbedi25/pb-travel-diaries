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

import { isAlreadyApplied } from "./migrationErrors.js";

/**
 * A migration body made of plain statements, run in order.
 *
 * Note that MySQL has no `ADD COLUMN IF NOT EXISTS`, which is precisely why the
 * ledger exists: each version runs once and is never attempted again.
 *
 * A version can still be interrupted halfway — MySQL commits DDL as it goes, so
 * a statement that fails leaves the earlier ones behind with no ledger row. The
 * next run then replays the version from the top and meets its own work: a
 * column that already exists, an index that is already there. Those specific
 * errors are counted as "done" and the migration carries on (see
 * migrationErrors.js); anything else stops it. That is what makes an upgrade
 * resumable rather than stuck: fix the cause, run it again, and it finishes the
 * job from where it stopped.
 */
export function sql(...statements) {
  const run = async (executor) => {
    const skipped = [];
    for (const statement of statements) {
      try {
        await executor.query(statement);
      } catch (error) {
        if (!isAlreadyApplied(error)) throw error;
        skipped.push(statement);
      }
    }
    return { skipped };
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
  {
    version: 4,
    name: "the bike is Taskeen, written تسکین",
    // The machine's name lives inside the saved site document, so a rename is
    // a data change rather than a schema one — the owner would otherwise have
    // to retype every field in the dashboard. The subtext sentence goes first
    // so the blanket swaps below cannot leave "تسکین means long" behind. The
    // Devanagari spelling is swept up too, in case a document was saved while
    // the site briefly used it. Saved revisions are history and are untouched.
    up: sql(
      "UPDATE site_content SET content = REPLACE(content, 'Named for the long roads out of Nangal Dam — طویل means long', 'Named for the calm of the long roads out of Nangal Dam — تسکین means peace of mind')",
      "UPDATE site_content SET content = REPLACE(content, 'Named for the calm of the long roads out of Nangal Dam — तस्कीन means peace of mind', 'Named for the calm of the long roads out of Nangal Dam — تسکین means peace of mind')",
      "UPDATE site_content SET content = REPLACE(content, 'طویل', 'تسکین')",
      "UPDATE site_content SET content = REPLACE(content, 'तस्कीन', 'تسکین')",
      "UPDATE site_content SET content = REPLACE(content, 'Taweel', 'Taskeen')",
    ),
  },
  {
    version: 5,
    name: "member garages and journeys",
    // A member's own rides live beside the site's own tables and never touch
    // them: one row per bike, one per journey, both keyed to the account that
    // owns them. The journey is kept as JSON in LONGTEXT — stops, notes and
    // gallery — because it is written and read whole, and because the same
    // shape has to survive MySQL, SQLite and the in-memory driver.
    up: sql(
      `CREATE TABLE IF NOT EXISTS member_bikes (
        id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id         BIGINT UNSIGNED NOT NULL,
        maker           VARCHAR(64) NOT NULL,
        model           VARCHAR(120) NOT NULL,
        year            SMALLINT UNSIGNED NULL,
        mileage_kmpl    DECIMAL(5,2) NULL,
        mileage_source  VARCHAR(16) NOT NULL DEFAULT 'manual',
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY member_bikes_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS member_journeys (
        id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id     BIGINT UNSIGNED NOT NULL,
        title       VARCHAR(160) NOT NULL DEFAULT '',
        bike_id     BIGINT UNSIGNED NULL,
        stops       LONGTEXT NOT NULL,
        notes       LONGTEXT NOT NULL,
        gallery     LONGTEXT NOT NULL,
        round_trip  TINYINT(1) NOT NULL DEFAULT 0,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY member_journeys_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    ),
  },
  {
    version: 6,
    name: "member garage lookups",
    // Removing a bike has to find the rides that used it, and a member's ride
    // list is read on every visit to the garage. Migration 5 indexed the owner
    // columns; this adds the one lookup that was left scanning: journeys by
    // bike. Additive and short — safe to run while the site is serving.
    up: sql("CREATE INDEX member_journeys_bike ON member_journeys (bike_id)"),
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
