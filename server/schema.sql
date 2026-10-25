-- ─────────────────────────────────────────────────────────────────────────────
-- PB Travel Diaries — MariaDB / MySQL schema
--
-- GENERATED FILE — edit server/db/schema.js and server/db/migrations.js, then
-- run `npm run schema:sql`.
--
-- You do not have to import this: the first-run setup screen creates every
-- table, and the server applies pending migrations at boot. It is kept for
-- people who prefer phpMyAdmin or Adminer (open the database, then Import).
--
-- Importing it into a database that has already run some of these statements
-- reports "duplicate column" or "duplicate key" for those and carries on; those
-- two messages are safe to ignore. The app's own upgrader skips them silently.
--
-- Written for MariaDB 10.3+ and MySQL 5.7/8.0: no JSON column type, no CHECK
-- constraints and no RETURNING. JSON is kept in LONGTEXT and parsed in the
-- application. Schema version: 6.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS site_content (
    id          TINYINT UNSIGNED NOT NULL DEFAULT 1,
    content     LONGTEXT NOT NULL,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by  VARCHAR(190) NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS revisions (
    id           VARCHAR(64) NOT NULL,
    description  VARCHAR(255) NOT NULL DEFAULT '',
    content      LONGTEXT NOT NULL,
    created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_by   VARCHAR(190) NULL,
    PRIMARY KEY (id),
    KEY revisions_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_events (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS media (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
    setting_key VARCHAR(64) NOT NULL,
    value       LONGTEXT NOT NULL,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (setting_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INT UNSIGNED NOT NULL,
    name        VARCHAR(160) NOT NULL DEFAULT '',
    applied_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (version)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version, name) VALUES (1, 'initial schema');

ALTER TABLE users MODIFY role ENUM('owner','admin','reader') NOT NULL DEFAULT 'reader';

INSERT IGNORE INTO schema_migrations (version, name) VALUES (2, 'read-only reader role');

ALTER TABLE users ADD COLUMN disabled_at DATETIME NULL AFTER disabled;

ALTER TABLE auth_events MODIFY event ENUM('signup','login','logout','failed_login','password_change','user_created','user_deleted','user_disabled','user_enabled') NOT NULL;

INSERT IGNORE INTO schema_migrations (version, name) VALUES (3, 'disabled accounts');

UPDATE site_content SET content = REPLACE(content, 'Named for the long roads out of Nangal Dam — طویل means long', 'Named for the calm of the long roads out of Nangal Dam — تسکین means peace of mind');

UPDATE site_content SET content = REPLACE(content, 'Named for the calm of the long roads out of Nangal Dam — तस्कीन means peace of mind', 'Named for the calm of the long roads out of Nangal Dam — تسکین means peace of mind');

UPDATE site_content SET content = REPLACE(content, 'طویل', 'تسکین');

UPDATE site_content SET content = REPLACE(content, 'तस्कीन', 'تسکین');

UPDATE site_content SET content = REPLACE(content, 'Taweel', 'Taskeen');

INSERT IGNORE INTO schema_migrations (version, name) VALUES (4, 'the bike is Taskeen, written تسکین');

CREATE TABLE IF NOT EXISTS member_bikes (
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS member_journeys (
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version, name) VALUES (5, 'member garages and journeys');

CREATE INDEX member_journeys_bike ON member_journeys (bike_id);

INSERT IGNORE INTO schema_migrations (version, name) VALUES (6, 'member garage lookups');

INSERT IGNORE INTO settings (setting_key, value) VALUES ('schema_version', '6');

INSERT IGNORE INTO settings (setting_key, value) VALUES ('theme', '"dark"');
