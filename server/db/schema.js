/**
 * The database schema, as executable statements.
 *
 * This is the single source of truth: the first-run installer applies it
 * through the user's own connection, `npm run db:init` applies it from the
 * command line, and the server applies any pending migration at boot. The
 * `schema.sql` file is generated from these arrays (`npm run schema:sql`) for
 * people who prefer phpMyAdmin.
 *
 * Written to work on MariaDB 10.3+ and MySQL 5.7/8.0: no JSON column type, no
 * CHECK constraints and no RETURNING. JSON is kept in LONGTEXT and parsed in
 * the application.
 *
 * ── Changing the schema later ──────────────────────────────────────────────
 * These statements are the tables as they looked at version 1 and must not
 * grow. Anything new — a column, an index, a table, a backfilled row — goes in
 * `migrations.js` as the next version, so an installation that has been live
 * for a year upgrades exactly like a brand-new one. See migrations.js for the
 * shape of an entry.
 */

// Re-exported so everything that only cares about "the current version" can keep
// importing it from the schema module.
export { LATEST_VERSION } from "./migrations.js";

/** Tables every installation needs. `IF NOT EXISTS` makes this idempotent. */
export const BASE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS site_content (
    id          TINYINT UNSIGNED NOT NULL DEFAULT 1,
    content     LONGTEXT NOT NULL,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by  VARCHAR(190) NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS revisions (
    id           VARCHAR(64) NOT NULL,
    description  VARCHAR(255) NOT NULL DEFAULT '',
    content      LONGTEXT NOT NULL,
    created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_by   VARCHAR(190) NULL,
    PRIMARY KEY (id),
    KEY revisions_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 'reader' accounts can sign in and read the members-only parts of the site,
  // but cannot publish, upload or manage anybody. 'admin' and 'owner' can.
  `CREATE TABLE IF NOT EXISTS users (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username       VARCHAR(64) NOT NULL,
    email          VARCHAR(190) NULL,
    password_hash  VARCHAR(255) NOT NULL,
    role           ENUM('owner','admin','reader') NOT NULL DEFAULT 'reader',
    disabled       TINYINT(1) NOT NULL DEFAULT 0,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at  DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY users_username (username),
    UNIQUE KEY users_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash   CHAR(64) NOT NULL,
    user_id      BIGINT UNSIGNED NOT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at   DATETIME NOT NULL,
    ip           VARCHAR(64) NULL,
    user_agent   VARCHAR(255) NULL,
    PRIMARY KEY (token_hash),
    KEY sessions_user (user_id),
    KEY sessions_expiry (expires_at),
    CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS auth_events (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id     BIGINT UNSIGNED NULL,
    username    VARCHAR(190) NOT NULL,
    event       ENUM('signup','login','logout','failed_login','password_change','user_created','user_deleted') NOT NULL,
    ip          VARCHAR(64) NULL,
    user_agent  VARCHAR(255) NULL,
    detail      VARCHAR(255) NULL,
    created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY auth_events_created (created_at),
    KEY auth_events_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS media (
    id             VARCHAR(64) NOT NULL,
    filename       VARCHAR(255) NOT NULL,
    original_name  VARCHAR(255) NOT NULL,
    mime           VARCHAR(190) NOT NULL DEFAULT '',
    size           BIGINT UNSIGNED NOT NULL DEFAULT 0,
    kind           VARCHAR(32) NOT NULL DEFAULT 'other',
    ext            VARCHAR(16) NOT NULL DEFAULT '',
    created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_by     VARCHAR(190) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY media_filename (filename),
    KEY media_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS settings (
    setting_key VARCHAR(64) NOT NULL,
    value       LONGTEXT NOT NULL,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (setting_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // The ledger: one row per migration this database has run. It is created
  // here rather than by a migration because a migration cannot record itself
  // before the table that records it exists.
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INT UNSIGNED NOT NULL,
    name        VARCHAR(160) NOT NULL DEFAULT '',
    applied_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (version)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

/** Read how far this database has been migrated. 0 when nothing has run yet. */
export async function currentVersion(executor) {
  try {
    const [rows] = await executor.query("SELECT MAX(version) AS version FROM schema_migrations");
    const fromLedger = Number(rows?.[0]?.version);
    if (Number.isFinite(fromLedger) && fromLedger > 0) return fromLedger;
  } catch {
    // A database from before the ledger existed. Fall through to the setting.
  }
  try {
    const [rows] = await executor.query(
      "SELECT value FROM settings WHERE setting_key = 'schema_version' LIMIT 1",
    );
    return Number(rows?.[0]?.value) || 0;
  } catch {
    return 0;
  }
}

/**
 * Databases installed before `schema_migrations` existed recorded their version
 * in `settings.schema_version`. When the ledger is empty but that setting says
 * the site is at version N, record 1..N as already applied — otherwise the
 * upgrade would replay `ALTER TABLE` statements that have already run.
 */
async function adoptLegacyVersions(executor, migrations) {
  const [rows] = await executor.query("SELECT COUNT(*) AS n FROM schema_migrations");
  if (Number(rows?.[0]?.n ?? 0) > 0) return;

  let legacy = 0;
  try {
    const [setting] = await executor.query(
      "SELECT value FROM settings WHERE setting_key = 'schema_version' LIMIT 1",
    );
    legacy = Number(setting?.[0]?.value) || 0;
  } catch {
    legacy = 0;
  }
  if (legacy <= 0) return;

  for (const migration of migrations) {
    if (migration.version > legacy) break;
    await executor.query(
      "INSERT IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, NOW(3))",
      [migration.version, `${migration.name} (adopted)`],
    );
  }
}

/**
 * Create every table that is missing and apply pending migrations.
 *
 * `executor` is anything with `query(sql, params?)`: a mysql2 pool, a single
 * connection, or the fake used by the tests. Safe to run on every boot: a
 * version that the ledger already holds is skipped, so only genuinely new work
 * happens.
 */
export async function applySchema(executor, { migrations, upTo = Infinity } = {}) {
  const all = migrations ?? (await import("./migrations.js")).MIGRATIONS;
  // `upTo` stops partway: a restore has to build the tables as the backup
  // remembers them, load the rows, and only then run anything newer — so a
  // migration that backfills existing data sees the restored rows.
  const list = all.filter((migration) => migration.version <= upTo);

  for (const statement of BASE_STATEMENTS) {
    await executor.query(statement);
  }

  await adoptLegacyVersions(executor, list);

  const from = await currentVersion(executor);
  const applied = [];
  for (const migration of list) {
    if (migration.version <= from) continue;
    await migration.up(executor);
    await executor.query("INSERT INTO schema_migrations (version, name) VALUES (?, ?)", [
      migration.version,
      migration.name,
    ]);
    applied.push(migration.version);
  }

  // Kept in step for older tooling and for anyone reading the settings table.
  const latest = list[list.length - 1]?.version ?? 0;
  if (applied.length > 0 || from < latest) {
    await executor.query(
      `INSERT INTO settings (setting_key, value) VALUES ('schema_version', ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [String(latest)],
    );
  }

  // The site always needs a theme; the key remains editable afterwards.
  await executor.query(
    `INSERT IGNORE INTO settings (setting_key, value) VALUES ('theme', '"dark"')`,
  );

  return { version: latest, upgradedFrom: from, applied };
}

/** What `npm run db:status` prints: installed, latest, and what is waiting. */
export async function migrationStatus(executor, { migrations } = {}) {
  const list = migrations ?? (await import("./migrations.js")).MIGRATIONS;
  let installed = 0;
  try {
    installed = await currentVersion(executor);
  } catch {
    installed = 0;
  }
  const latest = list[list.length - 1]?.version ?? 0;
  return {
    installed,
    latest,
    pending: list.filter((m) => m.version > installed),
  };
}
