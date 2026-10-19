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
 */

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
];

/**
 * Changes applied to databases created by earlier versions. Version 1 is the
 * base schema itself; a database with no `schema_version` row is treated as
 * version 0 and upgraded.
 */
export const MIGRATIONS = [
  { version: 1, statements: [] },
  {
    version: 2,
    statements: [
      // PR #17 shipped only owner/admin. Readers join them without touching
      // the rows that already exist.
      "ALTER TABLE users MODIFY role ENUM('owner','admin','reader') NOT NULL DEFAULT 'reader'",
    ],
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Read the installed schema version. Returns 0 on a database from before it. */
async function currentVersion(executor) {
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
 * Create every table that is missing and apply pending migrations.
 *
 * `executor` is anything with `query(sql, params?)`: a mysql2 pool, a single
 * connection, or the fake used by the tests. Safe to run on every boot.
 */
export async function applySchema(executor) {
  for (const statement of BASE_STATEMENTS) {
    await executor.query(statement);
  }

  const from = await currentVersion(executor);
  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;
    for (const statement of migration.statements) {
      await executor.query(statement);
    }
  }

  if (from < LATEST_VERSION) {
    await executor.query(
      `INSERT INTO settings (setting_key, value) VALUES ('schema_version', ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [String(LATEST_VERSION)],
    );
  }

  // The site always needs a theme; the key remains editable afterwards.
  await executor.query(
    `INSERT IGNORE INTO settings (setting_key, value) VALUES ('theme', '"dark"')`,
  );

  return { version: LATEST_VERSION, upgradedFrom: from };
}
