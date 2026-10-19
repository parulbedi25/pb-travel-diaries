-- ─────────────────────────────────────────────────────────────────────────────
-- PB Travel Diaries — MariaDB / MySQL schema
--
-- Import this in phpMyAdmin (cPanel → phpMyAdmin → select the database →
-- Import) or run `npm run db:init`, which applies it through the app's own
-- connection settings.
--
-- Written to work on MariaDB 10.3+ and MySQL 5.7/8.0, which is what shared
-- hosting tends to offer. That means no JSON column type, no CHECK constraints
-- and no RETURNING: JSON is kept in LONGTEXT and parsed in the application.
-- ─────────────────────────────────────────────────────────────────────────────

-- The site's published configuration. One row, id = 1.
CREATE TABLE IF NOT EXISTS site_content (
  id          TINYINT UNSIGNED NOT NULL DEFAULT 1,
  content     LONGTEXT NOT NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by  VARCHAR(190) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every published snapshot, newest first. Replaces the browser's history.
CREATE TABLE IF NOT EXISTS revisions (
  id           VARCHAR(64) NOT NULL,
  description  VARCHAR(255) NOT NULL DEFAULT '',
  content      LONGTEXT NOT NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_by   VARCHAR(190) NULL,
  PRIMARY KEY (id),
  KEY revisions_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Accounts. Passwords are bcrypt hashes, never the password itself.
CREATE TABLE IF NOT EXISTS users (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username       VARCHAR(64) NOT NULL,
  email          VARCHAR(190) NULL,
  password_hash  VARCHAR(255) NOT NULL,
  role           ENUM('owner','admin') NOT NULL DEFAULT 'admin',
  disabled       TINYINT(1) NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at  DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY users_username (username),
  UNIQUE KEY users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Server-side sessions. The cookie holds a random token; only its SHA-256 is
-- stored, so a stolen database dump cannot be replayed as a login.
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

-- Signup / login / logout / failed attempt history, including the address and
-- browser that did it. Never stores passwords or password hashes.
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

-- Uploaded files. The bytes live on disk in MEDIA_DIR (default ./media) so the
-- folder can be backed up on its own; this table is the index over them.
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

-- Small key/value settings that are not part of the site content: the active
-- theme, and anything else that belongs to the deployment rather than a page.
CREATE TABLE IF NOT EXISTS settings (
  setting_key VARCHAR(64) NOT NULL,
  value       LONGTEXT NOT NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO settings (setting_key, value) VALUES ('theme', '"dark"');
