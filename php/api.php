<?php
/**
 * The site's whole API, in PHP, for hosts that run PHP but not Node.
 *
 * A static folder cannot talk to a database: nothing on the server executes, and
 * a browser has no MySQL client. PHP does execute — shared hosting runs it — so
 * the exported folder carries this file and the site behaves like the Node
 * deployment: first visit shows the setup screen, "Test connection" really
 * connects, "Create tables" really creates them, and every endpoint the
 * dashboard calls answers with the shape the page expects.
 *
 * The database password lives in `php-config.php` beside this file. That is safe
 * in a way a `.env` in a web root is not: PHP is *executed*, so its source is
 * never served. Keep the `.php` extension.
 *
 * The tables are the Node server's own — same names, same columns — so a
 * database created here is one the Node app can take over, and a database the
 * Node app created is one this file can serve. `ensure_schema()` runs the
 * idempotent `CREATE TABLE IF NOT EXISTS` on any request that finds the schema
 * missing or out of date, which is what repairs a half-created database.
 */

declare(strict_types=1);

/* ── configuration ──────────────────────────────────────────────────────── */

$configFile = __DIR__ . '/php-config.php';
$cfg = is_file($configFile) ? require $configFile : [];
$cfg += [
  'driver' => 'mysql',
  'host' => 'localhost',
  'port' => 3306,
  'database' => '',
  'user' => '',
  'password' => '',
  'socket' => '',
  'siteTitle' => 'PB Travel Diaries',
  'sessionName' => 'pb_session',
  'stopWords' => false,
];

const SCHEMA_VERSION = 8;
const SWEEP_MINUTES = 30;

/* ── plumbing ───────────────────────────────────────────────────────────── */

function json_out($payload, int $status = 200): void
{
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  exit;
}

function fail(string $message, int $status = 400, ?string $code = null): void
{
  $body = ['error' => $message];
  if ($code !== null) $body['code'] = $code;
  json_out($body, $status);
}

function body(): array
{
  $raw = file_get_contents('php://input');
  // A test harness has no request body to read, so it names a file instead.
  // This is a server-side environment variable, never something a visitor can
  // set, and a real request always arrives with its body in php://input.
  if (($raw === false || $raw === '') && getenv('PB_BODY_FILE')) {
    $raw = (string) file_get_contents((string) getenv('PB_BODY_FILE'));
  }
  if ($raw === false || $raw === '') return [];
  $parsed = json_decode($raw, true);
  return is_array($parsed) ? $parsed : [];
}

/** The request path below `/api`, without the query string. */
function route(): string
{
  $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
  $at = strpos($path, '/api/');
  if ($at === false) return '';
  return trim(substr($path, $at + 5), '/');
}

function method(): string
{
  return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

/** Database time in, ISO time out — what the page's JSON expects. */
function now_db(): string
{
  return gmdate('Y-m-d H:i:s');
}

function to_iso($value): ?string
{
  if ($value === null || $value === '') return null;
  $stamp = strtotime((string) $value . (str_contains((string) $value, ' ') ? ' UTC' : ''));
  if ($stamp === false) return null;
  return gmdate('Y-m-d\TH:i:s\Z', $stamp);
}

function json_setting_encode($value): string
{
  return (string) json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

/* ── the database ───────────────────────────────────────────────────────── */

function settings_for(array $cfg, ?array $given = null): array
{
  // A request may name a different host/user/database than the baked one — the
  // setup screen exists so those can be corrected on the server. A password is
  // the exception: an empty field means "use the one already configured", which
  // is how the form can be prefilled without sending a password to a browser.
  $given = $given ?? [];
  $pick = static function (string $key, $fallback) use ($given) {
    $value = $given[$key] ?? null;
    if (is_string($value) && trim($value) !== '') return trim($value);
    return $fallback;
  };
  $password = $given['password'] ?? '';
  return [
    'driver' => $cfg['driver'],
    'host' => (string) $pick('host', $cfg['host']),
    'port' => (int) $pick('port', $cfg['port']),
    'database' => (string) $pick('database', $cfg['database']),
    'user' => (string) $pick('user', $cfg['user']),
    'password' => is_string($password) && $password !== '' ? $password : (string) $cfg['password'],
    'socket' => (string) $pick('socketPath', $cfg['socket']),
  ];
}

function connect(array $db, bool $withDatabase = true): PDO
{
  if ($db['driver'] === 'sqlite') {
    $file = __DIR__ . '/data/' . ($db['database'] !== '' ? $db['database'] : 'pbfrompb') . '.sqlite';
    if (!is_dir(dirname($file))) mkdir(dirname($file), 0775, true);
    $pdo = new PDO('sqlite:' . $file);
  } else {
    $dsn = $db['socket'] !== ''
      ? sprintf('mysql:unix_socket=%s', $db['socket'])
      : sprintf('mysql:host=%s;port=%d', $db['host'], $db['port']);
    if ($withDatabase && $db['database'] !== '') $dsn .= ';dbname=' . $db['database'];
    $pdo = new PDO($dsn, $db['user'], $db['password']);
  }
  $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
  return $pdo;
}

/** The site's connection, or null when it cannot be opened. */
function repo(): ?PDO
{
  global $cfg;
  static $pdo = null;
  static $tried = false;
  if ($tried) return $pdo;
  $tried = true;
  try {
    $pdo = connect(settings_for($cfg));
    $pdo->query('SELECT 1')->fetchAll();
  } catch (Throwable $e) {
    $pdo = null;
  }
  return $pdo;
}

function pdo_driver(PDO $pdo): string
{
  return $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
}

/**
 * Every table, exactly as the Node server names them.
 *
 * `IF NOT EXISTS` makes this the repair as well as the setup: a database that
 * only half-created its tables gets the rest on the next request, and a
 * database the Node app built is left alone.
 */
function schema_statements(): array
{
  global $cfg;
  $mysql = $cfg['driver'] !== 'sqlite';

  if (!$mysql) {
    // SQLite: for local trials of this file. Shared hosting is MySQL.
    return [
      "CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(64) NOT NULL UNIQUE,
        email VARCHAR(190) NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(16) NOT NULL DEFAULT 'reader',
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at VARCHAR(32) NOT NULL,
        last_login_at VARCHAR(32) NULL)",
      "CREATE TABLE IF NOT EXISTS settings (
        setting_key VARCHAR(64) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at VARCHAR(32) NOT NULL)",
      "CREATE TABLE IF NOT EXISTS site_content (
        id INTEGER PRIMARY KEY, content TEXT NOT NULL,
        updated_at VARCHAR(32) NOT NULL, updated_by VARCHAR(190) NULL)",
      "CREATE TABLE IF NOT EXISTS revisions (
        id VARCHAR(64) PRIMARY KEY, description VARCHAR(255) NOT NULL DEFAULT '',
        content TEXT NOT NULL, created_at VARCHAR(32) NOT NULL, created_by VARCHAR(190) NULL)",
      "CREATE TABLE IF NOT EXISTS auth_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NULL,
        username VARCHAR(190) NOT NULL, event VARCHAR(32) NOT NULL,
        ip VARCHAR(64) NULL, user_agent VARCHAR(255) NULL, detail VARCHAR(255) NULL,
        created_at VARCHAR(32) NOT NULL)",
      "CREATE TABLE IF NOT EXISTS media (
        id VARCHAR(64) PRIMARY KEY, filename VARCHAR(255) NOT NULL UNIQUE,
        original_name VARCHAR(255) NOT NULL, mime VARCHAR(190) NOT NULL DEFAULT '',
        size INTEGER NOT NULL DEFAULT 0, kind VARCHAR(32) NOT NULL DEFAULT 'other',
        ext VARCHAR(16) NOT NULL DEFAULT '', tags VARCHAR(400) NOT NULL DEFAULT '',
        created_at VARCHAR(32) NOT NULL, created_by VARCHAR(190) NULL)",
      "CREATE TABLE IF NOT EXISTS member_bikes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        maker VARCHAR(64) NOT NULL, model VARCHAR(120) NOT NULL,
        year INTEGER NULL, mileage_kmpl REAL NULL,
        mileage_source VARCHAR(16) NOT NULL DEFAULT 'manual', created_at VARCHAR(32) NOT NULL)",
      "CREATE TABLE IF NOT EXISTS member_journeys (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        title VARCHAR(160) NOT NULL DEFAULT '', bike_id INTEGER NULL,
        stops TEXT NOT NULL, notes TEXT NOT NULL, gallery TEXT NOT NULL,
        round_trip INTEGER NOT NULL DEFAULT 0,
        created_at VARCHAR(32) NOT NULL, updated_at VARCHAR(32) NOT NULL)",
      "CREATE TABLE IF NOT EXISTS route_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind VARCHAR(24) NOT NULL DEFAULT 'weather',
        severity VARCHAR(16) NOT NULL DEFAULT 'info', title VARCHAR(200) NOT NULL,
        body VARCHAR(1000) NOT NULL DEFAULT '', place VARCHAR(160) NOT NULL DEFAULT '',
        lat REAL NULL, lng REAL NULL, source VARCHAR(24) NOT NULL DEFAULT 'weather',
        dedupe_key VARCHAR(200) NOT NULL DEFAULT '', route_signature TEXT NOT NULL DEFAULT '',
        created_at VARCHAR(32) NOT NULL, expires_at VARCHAR(32) NULL)",
      "CREATE TABLE IF NOT EXISTS alert_reads (
        alert_id INTEGER NOT NULL, user_id INTEGER NOT NULL, read_at VARCHAR(32) NOT NULL,
        PRIMARY KEY (alert_id, user_id))",
      "CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY, name VARCHAR(160) NOT NULL DEFAULT '',
        applied_at VARCHAR(32) NOT NULL)",
    ];
  }

  return [
    "CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(64) NOT NULL,
      email VARCHAR(190) NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('owner','admin','reader') NOT NULL DEFAULT 'reader',
      disabled TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL,
      last_login_at DATETIME NULL,
      PRIMARY KEY (id),
      UNIQUE KEY users_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    "CREATE TABLE IF NOT EXISTS settings (
      setting_key VARCHAR(64) NOT NULL,
      value LONGTEXT NOT NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (setting_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    "CREATE TABLE IF NOT EXISTS site_content (
      id TINYINT UNSIGNED NOT NULL DEFAULT 1,
      content LONGTEXT NOT NULL,
      updated_at DATETIME NOT NULL,
      updated_by VARCHAR(190) NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    "CREATE TABLE IF NOT EXISTS revisions (
      id VARCHAR(64) NOT NULL,
      description VARCHAR(255) NOT NULL DEFAULT '',
      content LONGTEXT NOT NULL,
      created_at DATETIME(3) NOT NULL,
      created_by VARCHAR(190) NULL,
      PRIMARY KEY (id),
      KEY revisions_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    "CREATE TABLE IF NOT EXISTS auth_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NULL,
      username VARCHAR(190) NOT NULL,
      event VARCHAR(32) NOT NULL,
      ip VARCHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      detail VARCHAR(255) NULL,
      created_at DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      KEY auth_events_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    "CREATE TABLE IF NOT EXISTS media (
      id VARCHAR(64) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      mime VARCHAR(190) NOT NULL DEFAULT '',
      size BIGINT UNSIGNED NOT NULL DEFAULT 0,
      kind VARCHAR(32) NOT NULL DEFAULT 'other',
      ext VARCHAR(16) NOT NULL DEFAULT '',
      tags VARCHAR(400) NOT NULL DEFAULT '',
      created_at DATETIME(3) NOT NULL,
      created_by VARCHAR(190) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY media_filename (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    "CREATE TABLE IF NOT EXISTS member_bikes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      maker VARCHAR(64) NOT NULL,
      model VARCHAR(120) NOT NULL,
      year SMALLINT UNSIGNED NULL,
      mileage_kmpl DECIMAL(5,2) NULL,
      mileage_source VARCHAR(16) NOT NULL DEFAULT 'manual',
      created_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      KEY member_bikes_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    "CREATE TABLE IF NOT EXISTS member_journeys (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(160) NOT NULL DEFAULT '',
      bike_id BIGINT UNSIGNED NULL,
      stops LONGTEXT NOT NULL,
      notes LONGTEXT NOT NULL,
      gallery LONGTEXT NOT NULL,
      round_trip TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      KEY member_journeys_user (user_id),
      KEY member_journeys_bike (bike_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    "CREATE TABLE IF NOT EXISTS route_alerts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      kind VARCHAR(24) NOT NULL DEFAULT 'weather',
      severity VARCHAR(16) NOT NULL DEFAULT 'info',
      title VARCHAR(200) NOT NULL,
      body VARCHAR(1000) NOT NULL DEFAULT '',
      place VARCHAR(160) NOT NULL DEFAULT '',
      lat DECIMAL(9,6) NULL,
      lng DECIMAL(9,6) NULL,
      source VARCHAR(24) NOT NULL DEFAULT 'weather',
      dedupe_key VARCHAR(200) NOT NULL DEFAULT '',
      route_signature VARCHAR(4000) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL,
      expires_at DATETIME NULL,
      PRIMARY KEY (id),
      UNIQUE KEY route_alerts_dedupe (dedupe_key),
      KEY route_alerts_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    "CREATE TABLE IF NOT EXISTS alert_reads (
      alert_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      read_at DATETIME NOT NULL,
      PRIMARY KEY (alert_id, user_id),
      KEY alert_reads_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    "CREATE TABLE IF NOT EXISTS schema_migrations (
      version INT UNSIGNED NOT NULL,
      name VARCHAR(160) NOT NULL DEFAULT '',
      applied_at DATETIME(3) NOT NULL,
      PRIMARY KEY (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
  ];
}

/**
 * Bring an existing database up to the whole schema.
 *
 * Called once per request that finds the schema missing or older than this
 * file, so a database whose first setup created only some of the tables is
 * repaired on the next page load rather than needing a reinstall.
 */
function ensure_schema(bool $force = false): void
{
  $pdo = repo();
  if (!$pdo) return;
  static $done = false;
  if ($done && !$force) return;
  $done = true;

  // The first version of this file wrote a `settings` table with a `name`
  // column. That is not the server's schema, so it is folded into the real one
  // before anything reads it.
  try {
    $columns = $pdo->query("SELECT * FROM settings LIMIT 1")->fetch();
    if (is_array($columns) && array_key_exists('name', $columns) && !array_key_exists('setting_key', $columns)) {
      $rows = $pdo->query('SELECT name, value FROM settings')->fetchAll();
      $pdo->exec('DROP TABLE settings');
      foreach (schema_statements() as $statement) {
        $pdo->exec($statement);
      }
      foreach ($rows as $row) {
        $pdo->prepare('INSERT INTO settings (setting_key, value, updated_at) VALUES (?, ?, ?)')
          ->execute([$row['name'], $row['value'], now_db()]);
      }
      return;
    }
  } catch (Throwable $e) {
    // No settings table yet: the statements below create everything.
  }

  foreach (schema_statements() as $statement) {
    try {
      $pdo->exec($statement);
    } catch (Throwable $e) {
      // One failing statement must not stop the rest: a half-broken database is
      // exactly the case this exists for.
    }
  }

  ensure_columns($pdo);
  import_media_index($pdo);

  try {
    $version = (int) $pdo->query("SELECT value FROM settings WHERE setting_key = 'schema_version'")->fetchColumn();
  } catch (Throwable $e) {
    $version = 0;
  }
  if ($version < SCHEMA_VERSION) {
    put_setting('schema_version', (string) SCHEMA_VERSION);
    try {
      $pdo->prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        ->execute([SCHEMA_VERSION, 'php bridge schema', now_db()]);
    } catch (Throwable $e) {
      // Already recorded.
    }
  }
}

/**
 * Columns a table must have, added when an older setup made the table without
 * them.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so a
 * database created by an earlier version of this file would keep its narrow
 * `media` row and every tag write would fail. Adding the column is the repair.
 */
function required_columns(): array
{
  return [
    'users' => [
      'email' => "VARCHAR(190) NULL",
      'role' => "VARCHAR(16) NOT NULL DEFAULT 'reader'",
      'disabled' => 'TINYINT(1) NOT NULL DEFAULT 0',
      'created_at' => 'DATETIME NULL',
      'last_login_at' => 'DATETIME NULL',
    ],
    'site_content' => [
      'updated_by' => 'VARCHAR(190) NULL',
      'updated_at' => 'DATETIME NULL',
    ],
    'revisions' => [
      'description' => "VARCHAR(255) NOT NULL DEFAULT ''",
      'created_by' => 'VARCHAR(190) NULL',
    ],
    'media' => [
      'tags' => "VARCHAR(400) NOT NULL DEFAULT ''",
      'kind' => "VARCHAR(32) NOT NULL DEFAULT 'other'",
      'ext' => "VARCHAR(16) NOT NULL DEFAULT ''",
      'mime' => "VARCHAR(190) NOT NULL DEFAULT ''",
      'size' => 'BIGINT UNSIGNED NOT NULL DEFAULT 0',
      'created_at' => 'DATETIME NULL',
      'created_by' => 'VARCHAR(190) NULL',
    ],
    'auth_events' => [
      'ip' => 'VARCHAR(64) NULL',
      'user_agent' => 'VARCHAR(255) NULL',
      'detail' => 'VARCHAR(255) NULL',
    ],
    'member_bikes' => [
      'year' => 'SMALLINT UNSIGNED NULL',
      'mileage_kmpl' => 'DECIMAL(5,2) NULL',
      'mileage_source' => "VARCHAR(16) NOT NULL DEFAULT 'manual'",
      'created_at' => 'DATETIME NULL',
    ],
    'member_journeys' => [
      'bike_id' => 'BIGINT UNSIGNED NULL',
      'notes' => "LONGTEXT NULL",
      'gallery' => "LONGTEXT NULL",
      'round_trip' => 'TINYINT(1) NOT NULL DEFAULT 0',
      'updated_at' => 'DATETIME NULL',
    ],
    'route_alerts' => [
      'place' => "VARCHAR(160) NOT NULL DEFAULT ''",
      'lat' => 'DECIMAL(9,6) NULL',
      'lng' => 'DECIMAL(9,6) NULL',
      'source' => "VARCHAR(24) NOT NULL DEFAULT 'weather'",
      'dedupe_key' => "VARCHAR(200) NOT NULL DEFAULT ''",
      'route_signature' => "VARCHAR(4000) NOT NULL DEFAULT ''",
      'expires_at' => 'DATETIME NULL',
    ],
  ];
}

function ensure_columns(PDO $pdo): void
{
  $sqlite = pdo_driver($pdo) === 'sqlite';
  foreach (required_columns() as $table => $columns) {
    try {
      if ($sqlite) {
        $rows = $pdo->query('PRAGMA table_info(' . $table . ')')->fetchAll();
        $have = array_column($rows, 'name');
      } else {
        $rows = $pdo->query('SHOW COLUMNS FROM `' . $table . '`')->fetchAll();
        $have = array_column($rows, 'Field');
      }
    } catch (Throwable $e) {
      continue; // No such table yet: the CREATE above either made it or could not.
    }
    foreach ($columns as $column => $definition) {
      if (in_array($column, $have, true)) continue;
      // SQLite is strict about defaults on added columns; the SQLite schema
      // statements already create these, so this path is MySQL in practice.
      if ($sqlite && str_contains($definition, 'NOT NULL DEFAULT')) {
        $definition = str_replace('LONGTEXT', 'TEXT', $definition);
      }
      try {
        $pdo->exec('ALTER TABLE ' . $table . ' ADD COLUMN ' . $column . ' ' . $definition);
      } catch (Throwable $e) {
        // A column the server refuses to add is not worth failing the request.
      }
    }
  }
}

/** Whether the site is set up: the schema exists and something marks it. */
function tables_exist(): bool
{
  $pdo = repo();
  if (!$pdo) return false;
  try {
    $pdo->query('SELECT setting_key FROM settings LIMIT 1')->fetchAll();
    $pdo->query('SELECT username FROM users LIMIT 1')->fetchAll();
    return true;
  } catch (Throwable $e) {
    return false;
  }
}

function setting(string $name): ?string
{
  $pdo = repo();
  if (!$pdo) return null;
  try {
    $statement = $pdo->prepare('SELECT value FROM settings WHERE setting_key = ?');
    $statement->execute([$name]);
    $value = $statement->fetchColumn();
  } catch (Throwable $e) {
    return null;
  }
  return $value === false ? null : (string) $value;
}

function put_setting(string $name, string $value): void
{
  $pdo = repo();
  if (!$pdo) return;
  $sqlite = pdo_driver($pdo) === 'sqlite';
  $sql = $sqlite
    ? 'INSERT INTO settings (setting_key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET value = excluded.value'
    : 'INSERT INTO settings (setting_key, value, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)';
  try {
    $pdo->prepare($sql)->execute([$name, $value, now_db()]);
  } catch (Throwable $e) {
    // No tables yet: nothing to remember, and the caller is mid-setup.
  }
}

function setting_json(string $name, $fallback)
{
  $raw = setting($name);
  if ($raw === null) return $fallback;
  $value = json_decode($raw, true);
  return $value === null ? $fallback : $value;
}

function count_users(): int
{
  $pdo = repo();
  if (!$pdo) return 0;
  try {
    return (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
  } catch (Throwable $e) {
    return 0;
  }
}

/* ── accounts and sessions ──────────────────────────────────────────────── */

function session_start_once(): void
{
  global $cfg;
  if (session_status() === PHP_SESSION_ACTIVE) return;
  session_name($cfg['sessionName']);
  session_set_cookie_params([
    'httponly' => true,
    'samesite' => 'Lax',
    'secure' => (($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off'),
    'path' => '/',
  ]);
  session_start();
}

function public_user(array $row): array
{
  return [
    'id' => (int) $row['id'],
    'username' => $row['username'],
    'email' => $row['email'] ?: null,
    'role' => $row['role'],
    'disabled' => (int) ($row['disabled'] ?? 0) === 1,
    'createdAt' => to_iso($row['created_at'] ?? null),
    'lastLoginAt' => to_iso($row['last_login_at'] ?? null),
  ];
}

function current_user(): ?array
{
  session_start_once();
  $id = $_SESSION['user_id'] ?? null;
  if (!$id) return null;
  $pdo = repo();
  if (!$pdo) return null;
  try {
    $statement = $pdo->prepare('SELECT * FROM users WHERE id = ?');
    $statement->execute([$id]);
    $row = $statement->fetch();
  } catch (Throwable $e) {
    return null;
  }
  if (!$row || (int) $row['disabled'] === 1) return null;
  return $row;
}

function is_editor(?array $user): bool
{
  return $user !== null && in_array($user['role'], ['owner', 'admin'], true);
}

function require_user(): array
{
  $user = current_user();
  if (!$user) fail('Sign in to continue.', 401);
  return $user;
}

function require_editor(): array
{
  $user = require_user();
  if (!is_editor($user)) fail('Your account can read the site but not change it.', 403);
  return $user;
}

function require_owner(): array
{
  $user = require_user();
  if ($user['role'] !== 'owner') fail('Only the owner can do that.', 403);
  return $user;
}

function sign_in(array $row): void
{
  session_start_once();
  session_regenerate_id(true);
  $_SESSION['user_id'] = (int) $row['id'];
  try {
    repo()?->prepare('UPDATE users SET last_login_at = ? WHERE id = ?')->execute([now_db(), (int) $row['id']]);
  } catch (Throwable $e) {
    // Cosmetic: the session is what matters.
  }
}

function record_event(?array $user, string $event, string $detail = '', ?string $username = null): void
{
  $pdo = repo();
  if (!$pdo) return;
  try {
    $pdo->prepare('INSERT INTO auth_events (user_id, username, event, ip, user_agent, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      ->execute([
        $user['id'] ?? null,
        $username ?? ($user['username'] ?? 'visitor'),
        $event,
        $_SERVER['REMOTE_ADDR'] ?? null,
        mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
        mb_substr($detail, 0, 255),
        now_db(),
      ]);
  } catch (Throwable $e) {
    // Logging must never break the request it is describing.
  }
}

function normalise_username($value): string
{
  return mb_strtolower(trim((string) $value), 'UTF-8');
}

function username_problem(string $username): ?string
{
  if (!preg_match('/^[a-z0-9._-]{3,32}$/', $username)) {
    return 'A username is 3 to 32 letters, numbers, dots, dashes or underscores.';
  }
  return null;
}

function password_problem(string $password): ?string
{
  if (mb_strlen($password) < 8 || !preg_match('/[a-z]/i', $password) || !preg_match('/[0-9]/', $password)) {
    return 'Use at least 8 characters with a letter and a number.';
  }
  return null;
}

/* ── the bike catalogue, baked at export time ───────────────────────────── */

function catalogue(): array
{
  static $data = null;
  if ($data !== null) return $data;
  $file = __DIR__ . '/catalogue.json';
  $raw = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
  $data = is_array($raw['makers'] ?? null) ? $raw['makers'] : [];
  return $data;
}

function slug($value): string
{
  $value = mb_strtolower(trim((string) $value));
  $value = preg_replace('/[^a-z0-9]+/u', '-', $value) ?? '';
  return trim($value, '-');
}

function find_maker($value): ?array
{
  $wanted = slug($value);
  if ($wanted === '') return null;
  foreach (catalogue() as $maker) {
    if ($maker['id'] === $wanted || slug($maker['name']) === $wanted) return $maker;
  }
  return null;
}

function find_model($makerValue, $modelValue): ?array
{
  $maker = find_maker($makerValue);
  if (!$maker) return null;
  $wanted = slug($modelValue);
  if ($wanted === '') return null;
  foreach ($maker['models'] as $model) {
    if ($model['id'] === $wanted || slug($model['name']) === $wanted) {
      return ['maker' => $maker, 'model' => $model];
    }
  }
  return null;
}

/** The same wear table the Node catalogue uses. */
function with_wear(float $kmpl, $year): float
{
  if (!$year) return round($kmpl, 1);
  $age = max(0, (int) gmdate('Y') - (int) $year);
  $factor = 1.0;
  if ($age >= 12) $factor = 0.88;
  elseif ($age >= 7) $factor = 0.93;
  elseif ($age >= 3) $factor = 0.97;
  return round($kmpl * $factor, 1);
}

function estimate_mileage($makerValue, $modelValue, $year): array
{
  $found = find_model($makerValue, $modelValue);
  if ($found) {
    $kmpl = with_wear((float) $found['model']['kmpl'], $year);
    return [
      'kmpl' => $kmpl,
      'note' => sprintf(
        '%s %s averages about %s km/l; with the year you gave, %s km/l.',
        $found['maker']['name'],
        $found['model']['name'],
        $found['model']['kmpl'],
        $kmpl
      ),
    ];
  }
  $maker = find_maker($makerValue);
  if ($maker) {
    $total = 0.0;
    foreach ($maker['models'] as $model) $total += (float) $model['kmpl'];
    $average = count($maker['models']) ? $total / count($maker['models']) : 45;
    $kmpl = with_wear(round($average, 1), $year);
    return [
      'kmpl' => $kmpl,
      'note' => sprintf('%s models average about %s km/l — tell us the model for a closer figure.', $maker['name'], $kmpl),
    ];
  }
  return [
    'kmpl' => 45.0,
    'note' => 'A typical Indian motorcycle returns about 45 km/l; enter your own figure for a real number.',
  ];
}

/* ── the ride's arithmetic, ported from lib/tripMath.js ─────────────────── */

function haversine_km(?array $a, ?array $b): float
{
  if (!$a || !$b) return 0.0;
  $lat1 = (float) $a['lat'];
  $lng1 = (float) $a['lng'];
  $lat2 = (float) $b['lat'];
  $lng2 = (float) $b['lng'];
  $rad = static fn ($deg) => ($deg * M_PI) / 180;
  $dLat = $rad($lat2 - $lat1);
  $dLng = $rad($lng2 - $lng1);
  $h = sin($dLat / 2) ** 2 + cos($rad($lat1)) * cos($rad($lat2)) * sin($dLng / 2) ** 2;
  return 2 * 6371.0088 * asin(min(1, sqrt($h)));
}

function round_to(float $value, int $places = 1): float
{
  $factor = 10 ** $places;
  return round($value * $factor) / $factor;
}

function measure_stops($stops): array
{
  $out = [];
  foreach (is_array($stops) ? $stops : [] as $stop) {
    if (!is_array($stop)) continue;
    if (!is_numeric($stop['lat'] ?? null) || !is_numeric($stop['lng'] ?? null)) continue;
    $out[] = [
      'name' => trim((string) ($stop['name'] ?? '')),
      'lat' => (float) $stop['lat'],
      'lng' => (float) $stop['lng'],
    ];
  }
  return $out;
}

function journey_math($stops, $kmpl = null, bool $roundTrip = false): array
{
  $points = measure_stops($stops);
  $legs = [];
  for ($i = 1; $i < count($points); $i += 1) {
    $legs[] = [
      'from' => $points[$i - 1]['name'],
      'to' => $points[$i]['name'],
      'km' => round_to(haversine_km($points[$i - 1], $points[$i]), 1),
    ];
  }
  $oneWay = round_to(array_sum(array_column($legs, 'km')), 1);
  $roundTripKm = round_to($oneWay * 2, 1);
  $perLitre = ($kmpl !== null && (float) $kmpl > 0) ? (float) $kmpl : null;

  return [
    'stops' => count($points),
    'legs' => $legs,
    'oneWayKm' => $oneWay,
    'roundTripKm' => $roundTripKm,
    'kmpl' => $perLitre,
    'litresOneWay' => $perLitre ? round_to($oneWay / $perLitre, 2) : null,
    'litresRoundTrip' => $perLitre ? round_to($roundTripKm / $perLitre, 2) : null,
    'selectedKm' => $roundTrip ? $roundTripKm : $oneWay,
    'selectedLitres' => $perLitre ? round_to(($roundTrip ? $roundTripKm : $oneWay) / $perLitre, 2) : null,
    'from' => $points[0]['name'] ?? '',
    'to' => $points[count($points) - 1]['name'] ?? '',
  ];
}

function petrol_per_bike($stops, array $bikes): array
{
  $out = [];
  foreach ($bikes as $bike) {
    $maths = journey_math($stops, $bike['mileageKmpl'] ?? null, false);
    $out[] = [
      'bikeId' => (int) $bike['id'],
      'maker' => $bike['maker'],
      'model' => $bike['model'],
      'kmpl' => $bike['mileageKmpl'],
      'mileageSource' => $bike['mileageSource'],
      'litresOneWay' => $maths['litresOneWay'],
      'litresRoundTrip' => $maths['litresRoundTrip'],
    ];
  }
  return $out;
}

/* ── media ──────────────────────────────────────────────────────────────── */

/**
 * The uploaded file, whether it arrived as POST or as PUT.
 *
 * PHP fills `$_FILES` for a POST and never for a PUT, so replacing a photo's
 * pixels — which the dashboard sends as PUT — would look like an empty request
 * if this only asked `$_FILES`. The multipart body is read and split here
 * instead, which is what makes "save a cropped photo" work on a PHP host.
 */
function incoming_upload(): ?array
{
  if (!empty($_FILES['file']) && (int) ($_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
    $file = $_FILES['file'];
    return [
      'path' => (string) $file['tmp_name'],
      'name' => (string) ($file['name'] ?? 'upload'),
      'type' => (string) ($file['type'] ?? ''),
      'size' => (int) ($file['size'] ?? 0),
    ];
  }

  $type = (string) ($_SERVER['CONTENT_TYPE'] ?? '');
  if (!preg_match('/boundary=(?:"([^"]+)"|([^;]+))/', $type, $match)) return null;
  $boundary = trim($match[1] !== '' ? $match[1] : $match[2]);
  $raw = (string) file_get_contents('php://input');
  if ($raw === '' || $boundary === '') return null;

  foreach (explode('--' . $boundary, $raw) as $part) {
    $split = strpos($part, "\r\n\r\n");
    if ($split === false) continue;
    $head = substr($part, 0, $split);
    if (!preg_match('/name="([^"]*)"/', $head, $field)) continue;
    if ($field[1] !== 'file') continue;
    if (!preg_match('/filename="([^"]*)"/', $head, $name)) continue;
    $bytes = substr($part, $split + 4);
    // The trailing CRLF before the next boundary belongs to the wrapper.
    if (str_ends_with($bytes, "\r\n")) $bytes = substr($bytes, 0, -2);
    $path = tempnam(sys_get_temp_dir(), 'pbupload');
    if ($path === false) return null;
    file_put_contents($path, $bytes);
    preg_match('/Content-Type:\s*([^\r\n]+)/i', $head, $mime);
    return [
      'path' => $path,
      'name' => $name[1],
      'type' => trim($mime[1] ?? ''),
      'size' => strlen($bytes),
    ];
  }
  return null;
}

function media_public_url(string $filename): string
{
  // The Node app serves an upload at /media/<file> (MEDIA_DIR is `media/`), and
  // the export copies the uploads into that same folder, so this matches it.
  return '/media/' . $filename;
}

/** Where uploads are written: the media folder the page already reads. */
function media_upload_dir(): string
{
  $dir = __DIR__ . '/media';
  if (!is_dir($dir)) mkdir($dir, 0755, true);
  return $dir;
}

function media_item(array $row): array
{
  $url = media_public_url($row['filename']);
  return [
    'id' => $row['id'],
    'name' => $row['original_name'],
    'type' => $row['mime'],
    'size' => (int) $row['size'],
    'dataUrl' => $url,
    'url' => $url,
    'addedAt' => to_iso($row['created_at']) ?? '',
    'kind' => $row['kind'],
    'ext' => $row['ext'],
    'tags' => array_values(array_filter(array_map('trim', explode(',', (string) ($row['tags'] ?? ''))))),
  ];
}

/** The photographs that ship with the site: files, not rows. */
function bundled_media(): array
{
  static $items = null;
  if ($items !== null) return $items;
  $file = __DIR__ . '/bundled-media.json';
  $raw = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
  $items = is_array($raw) ? $raw : [];
  return $items;
}

/**
 * Put the exported photos back in the shelf.
 *
 * The folder carries the uploads as files and their rows in `media-index.json`.
 * A database created on this host has no rows of its own, so the shelf would be
 * empty while the photographs sat right there. Inserting them once, keyed by
 * filename, is the difference between an empty grid and the site's own media.
 * A database that already knows these photos is left exactly as it is.
 */
function import_media_index(PDO $pdo): void
{
  static $done = false;
  if ($done) return;
  $done = true;
  $file = __DIR__ . '/media-index.json';
  if (!is_file($file)) return;
  try {
    $count = (int) $pdo->query('SELECT COUNT(*) FROM media')->fetchColumn();
  } catch (Throwable $e) {
    return;
  }
  if ($count > 0) return;

  $rows = json_decode((string) file_get_contents($file), true);
  if (!is_array($rows)) return;
  $insert = null;
  try {
    $insert = $pdo->prepare(
      'INSERT INTO media (id, filename, original_name, mime, size, kind, ext, tags, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
  } catch (Throwable $e) {
    return;
  }
  foreach ($rows as $row) {
    if (!is_array($row) || empty($row['filename']) || empty($row['id'])) continue;
    // Only the files that actually arrived: a row for a missing file would show
    // a broken picture in the dashboard.
    if (!is_file(media_upload_dir() . '/' . basename((string) $row['filename']))) continue;
    if (!preg_match('/^[A-Za-z0-9._:-]+$/', (string) $row['id'])) continue;
    try {
      $insert->execute([
        (string) $row['id'],
        basename((string) $row['filename']),
        (string) ($row['originalName'] ?? $row['filename']),
        (string) ($row['mime'] ?? ''),
        (int) ($row['size'] ?? 0),
        (string) ($row['kind'] ?? 'image'),
        (string) ($row['ext'] ?? ''),
        (string) ($row['tags'] ?? ''),
        now_db(),
        $row['createdBy'] ?? null,
      ]);
    } catch (Throwable $e) {
      // Already there, or a duplicate filename.
    }
  }
}

function list_media_rows(): array
{
  $pdo = repo();
  if (!$pdo) return [];
  try {
    return $pdo->query('SELECT * FROM media ORDER BY created_at DESC')->fetchAll();
  } catch (Throwable $e) {
    return [];
  }
}

/* ── backups: a JSON snapshot, which is what this deployment can write ──── */

function backup_dir(): string
{
  $dir = __DIR__ . '/backup';
  if (!is_dir($dir)) mkdir($dir, 0755, true);
  return $dir;
}

function list_backups(): array
{
  $dir = backup_dir();
  $out = [];
  foreach (glob($dir . '/pb-backup-*.json') ?: [] as $file) {
    $out[] = [
      'name' => basename($file),
      'bytes' => filesize($file) ?: 0,
      'createdAt' => to_iso(gmdate('Y-m-d H:i:s', filemtime($file) ?: time())),
      'reason' => 'php',
    ];
  }
  usort($out, static fn ($a, $b) => strcmp($b['createdAt'], $a['createdAt']));
  return $out;
}

function create_backup(): array
{
  $pdo = repo();
  if (!$pdo) fail('The database is not set up yet.', 503);
  $content = null;
  try {
    $content = $pdo->query('SELECT content FROM site_content WHERE id = 1')->fetchColumn();
  } catch (Throwable $e) {
    $content = null;
  }
  $settings = [];
  try {
    foreach ($pdo->query('SELECT setting_key, value FROM settings')->fetchAll() as $row) {
      $settings[$row['setting_key']] = $row['value'];
    }
  } catch (Throwable $e) {
    $settings = [];
  }
  $users = [];
  try {
    foreach ($pdo->query('SELECT username, email, role, created_at FROM users')->fetchAll() as $row) {
      $users[] = $row;
    }
  } catch (Throwable $e) {
    $users = [];
  }
  $payload = [
    'kind' => 'pb-travel-diaries/backup',
    'createdAt' => gmdate('Y-m-d\TH:i:s\Z'),
    'content' => $content === false ? null : json_decode((string) $content, true),
    'settings' => $settings,
    'users' => $users,
  ];
  $name = 'pb-backup-' . gmdate('Y-m-d_H-i-s') . '.json';
  file_put_contents(backup_dir() . '/' . $name, (string) json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
  return ['name' => $name, 'bytes' => filesize(backup_dir() . '/' . $name) ?: 0, 'createdAt' => to_iso(gmdate('Y-m-d H:i:s'))];
}

/* ── shortcuts for the endpoints below ──────────────────────────────────── */

function alert_row(array $row, bool $read): array
{
  return [
    'id' => (int) $row['id'],
    'kind' => $row['kind'] ?: 'weather',
    'severity' => $row['severity'] ?: 'info',
    'title' => $row['title'] ?? '',
    'body' => $row['body'] ?? '',
    'place' => $row['place'] ?? '',
    'lat' => $row['lat'] === null ? null : (float) $row['lat'],
    'lng' => $row['lng'] === null ? null : (float) $row['lng'],
    'source' => $row['source'] ?: 'weather',
    'createdAt' => to_iso($row['created_at']),
    'expiresAt' => to_iso($row['expires_at']),
    'read' => $read,
  ];
}

function bike_row(array $row): array
{
  $mileage = $row['mileage_kmpl'] === null ? null : (float) $row['mileage_kmpl'];
  $estimate = estimate_mileage($row['maker'], $row['model'], $row['year']);
  return [
    'id' => (int) $row['id'],
    'maker' => $row['maker'],
    'model' => $row['model'],
    'year' => $row['year'] === null ? null : (int) $row['year'],
    'mileageKmpl' => $mileage,
    'mileageSource' => $row['mileage_source'] ?: 'manual',
    'createdAt' => to_iso($row['created_at']),
    'estimateNote' => $estimate['note'],
    'litresPer100Km' => $mileage ? round((100 / $mileage) * 10) / 10 : null,
  ];
}

function journey_row(array $row, array $bikes): array
{
  $stops = json_decode((string) $row['stops'], true) ?: [];
  $gallery = json_decode((string) $row['gallery'], true) ?: [];
  $bikeId = $row['bike_id'] === null ? null : (int) $row['bike_id'];
  $chosen = null;
  foreach ($bikes as $bike) {
    if ((int) $bike['id'] === $bikeId) $chosen = $bike;
  }
  return [
    'id' => (int) $row['id'],
    'title' => $row['title'] ?? '',
    'bikeId' => $bikeId,
    'stops' => $stops,
    'notes' => $row['notes'] ?? '',
    'gallery' => $gallery,
    'roundTrip' => (int) $row['round_trip'] === 1,
    'createdAt' => to_iso($row['created_at']),
    'updatedAt' => to_iso($row['updated_at']),
    'maths' => journey_math($stops, $chosen['mileageKmpl'] ?? null, (int) $row['round_trip'] === 1),
    'perBike' => petrol_per_bike($stops, $bikes),
  ];
}

function list_bikes(int $userId): array
{
  $pdo = repo();
  if (!$pdo) return [];
  try {
    $statement = $pdo->prepare('SELECT * FROM member_bikes WHERE user_id = ? ORDER BY id ASC');
    $statement->execute([$userId]);
    return array_map('bike_row', $statement->fetchAll());
  } catch (Throwable $e) {
    return [];
  }
}

function list_journeys(int $userId): array
{
  $pdo = repo();
  if (!$pdo) return [];
  try {
    $statement = $pdo->prepare('SELECT * FROM member_journeys WHERE user_id = ? ORDER BY id DESC');
    $statement->execute([$userId]);
    return $statement->fetchAll();
  } catch (Throwable $e) {
    return [];
  }
}

/* ── outbound HTTP, for the map links and the nearby search ─────────────── */

function http_get(string $url, int $timeout = 8): array
{
  if (function_exists('curl_init')) {
    $handle = curl_init($url);
    curl_setopt_array($handle, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_FOLLOWLOCATION => true,
      CURLOPT_MAXREDIRS => 8,
      CURLOPT_TIMEOUT => $timeout,
      CURLOPT_CONNECTTIMEOUT => 4,
      CURLOPT_USERAGENT => 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36',
    ]);
    $text = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $final = (string) curl_getinfo($handle, CURLINFO_EFFECTIVE_URL);
    $error = curl_error($handle);
    curl_close($handle);
    return ['status' => $status, 'text' => is_string($text) ? $text : '', 'url' => $final, 'error' => $error];
  }
  $context = stream_context_create(['http' => ['timeout' => $timeout, 'follow_location' => 1, 'max_redirects' => 8]]);
  $text = @file_get_contents($url, false, $context);
  $headers = $http_response_header ?? [];
  $status = 0;
  foreach ($headers as $header) {
    if (preg_match('#^HTTP/\S+\s+(\d{3})#', $header, $m)) $status = (int) $m[1];
  }
  return [
    'status' => $status,
    'text' => is_string($text) ? $text : '',
    'url' => $url,
    'error' => $text === false ? 'request failed' : '',
  ];
}

function http_post_form(string $url, string $payload, int $timeout = 12): array
{
  if (function_exists('curl_init')) {
    $handle = curl_init($url);
    curl_setopt_array($handle, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_POST => true,
      CURLOPT_POSTFIELDS => $payload,
      CURLOPT_TIMEOUT => $timeout,
      CURLOPT_CONNECTTIMEOUT => 5,
      CURLOPT_USERAGENT => 'pb-travel-diaries/static',
    ]);
    $text = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $error = curl_error($handle);
    curl_close($handle);
    return ['status' => $status, 'text' => is_string($text) ? $text : '', 'error' => $error];
  }
  $context = stream_context_create(['http' => [
    'method' => 'POST',
    'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
    'content' => $payload,
    'timeout' => $timeout,
  ]]);
  $text = @file_get_contents($url, false, $context);
  return ['status' => $text === false ? 0 : 200, 'text' => is_string($text) ? $text : '', 'error' => $text === false ? 'request failed' : ''];
}

/** A map address, never a share token: the same rule the Node server applies. */
function looks_like_map_address(string $url): bool
{
  $host = mb_strtolower((string) parse_url($url, PHP_URL_HOST));
  $host = preg_replace('/^www\./', '', $host ?? '') ?? '';
  $allowed = ['google.com', 'google.co.in', 'goo.gl', 'g.co', 'bing.com', 'apple.com', 'openstreetmap.org'];
  $ok = false;
  foreach ($allowed as $base) {
    if ($host === $base || str_ends_with($host, '.' . $base)) $ok = true;
  }
  if (!$ok) return false;
  if (in_array($host, ['maps.app.goo.gl', 'goo.gl', 'g.co'], true)) {
    $path = (string) parse_url($url, PHP_URL_PATH);
    $segments = array_values(array_filter(explode('/', $path)));
    return count($segments) > 1 || (bool) preg_match('/maps|dir|place|search|@/', $path . (string) parse_url($url, PHP_URL_QUERY));
  }
  return true;
}

/* ════════════════════════════════════════════════════════════════════════
 * Routes
 * ═══════════════════════════════════════════════════════════════════════ */

$route = route();
$verb = method();

/* Any request that finds a half-created database repairs it before answering. */
if ($route !== '' && !str_starts_with($route, 'setup/')) {
  ensure_schema();
}

/* ── first visit ────────────────────────────────────────────────────────── */

if ($route === 'setup/status' && $verb === 'GET') {
  $ready = tables_exist();
  $users = $ready ? count_users() : 0;
  $db = settings_for($cfg);
  json_out([
    'installed' => $ready,
    'needsOwner' => $ready && $users === 0,
    'databaseReady' => $ready,
    'users' => $users,
    'siteTitle' => (string) setting_json('site_title', $cfg['siteTitle']),
    // Filled in, so the form arrives already describing this server's database.
    // The password is the one thing never sent: an empty field means "use the
    // stored one".
    'db' => [
      'driver' => $db['driver'],
      'host' => $db['host'],
      'port' => $db['port'],
      'database' => $db['database'],
      'user' => $db['user'],
      'socketPath' => $db['socket'],
      'passwordStored' => $db['password'] !== '',
    ],
    'setupLocked' => $ready,
    'restoreAllowed' => false,
    'error' => null,
    'mode' => 'installer',
    'engine' => 'php',
  ]);
}

if ($route === 'setup/test' && $verb === 'POST') {
  $db = settings_for($cfg, body());
  $sqlite = $db['driver'] === 'sqlite';
  try {
    $server = connect($db, false);
    $version = (string) $server->query($sqlite ? 'SELECT sqlite_version()' : 'SELECT VERSION()')->fetchColumn();
  } catch (Throwable $e) {
    fail('The database server could not be reached: ' . $e->getMessage(), 502);
  }
  $exists = false;
  try {
    if ($sqlite) {
      $server->query('SELECT 1');
      $exists = true;
    } else {
      $server->query('USE `' . str_replace('`', '', $db['database']) . '`');
      $exists = true;
    }
  } catch (Throwable $e) {
    $exists = false;
  }
  json_out([
    'ok' => $exists,
    'serverVersion' => $version,
    'database' => $db['database'],
    'databaseExists' => $exists,
    'message' => $exists
      ? sprintf('Connected to %s. The database "%s" is there and the user can open it.', $version, $db['database'])
      : sprintf(
        'The server answered (%s), but the database "%s" is not there yet, or %s may not open it. Create it in cPanel → MySQL Databases, then test again.',
        $version,
        $db['database'],
        $db['user']
      ),
  ]);
}

if ($route === 'setup/database' && $verb === 'POST') {
  $db = settings_for($cfg, body());
  try {
    $pdo = connect($db);
  } catch (Throwable $e) {
    fail('The database could not be opened: ' . $e->getMessage(), 400);
  }
  try {
    foreach (schema_statements() as $statement) $pdo->exec($statement);
    // A database an earlier setup created keeps its narrow tables: the columns
    // the dashboard writes are added here, so "Create tables" is a repair too.
    ensure_columns($pdo);
  } catch (Throwable $e) {
    fail('The tables could not be created: ' . $e->getMessage(), 500);
  }
  $title = trim((string) (body()['siteTitle'] ?? ''));
  if ($title !== '') put_setting('site_title', json_setting_encode($title));
  put_setting('schema_version', (string) SCHEMA_VERSION);
  $users = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
  record_event(null, 'user_created', 'Database tables created by the setup screen', 'installer');
  json_out([
    'ok' => true,
    'siteTitle' => $title !== '' ? $title : $cfg['siteTitle'],
    'createdDatabase' => false,
    'users' => $users,
    'needsOwner' => $users === 0,
    'next' => $users === 0 ? 'owner' : 'login',
  ], 201);
}

if ($route === 'setup/owner' && $verb === 'POST') {
  $input = body();
  $pdo = repo();
  if (!$pdo) fail('Finish the database step first.', 409);
  try {
    foreach (schema_statements() as $statement) $pdo->exec($statement);
  } catch (Throwable $e) {
    // Already there.
  }
  ensure_columns($pdo);
  if (count_users() > 0) fail('This site already has its owner account. Sign in instead.', 409);

  $username = normalise_username($input['username'] ?? '');
  $password = (string) ($input['password'] ?? '');
  $email = trim((string) ($input['email'] ?? ''));
  if ($problem = username_problem($username)) fail($problem);
  if ($problem = password_problem($password)) fail($problem);

  $pdo->prepare('INSERT INTO users (username, email, password_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, 0, ?)')
    ->execute([$username, $email !== '' ? $email : null, password_hash($password, PASSWORD_DEFAULT), 'owner', now_db()]);
  $id = (int) $pdo->lastInsertId();
  $statement = $pdo->prepare('SELECT * FROM users WHERE id = ?');
  $statement->execute([$id]);
  $row = $statement->fetch();
  record_event($row, 'signup', 'Owner account created by the setup screen');
  sign_in($row);
  json_out(['user' => public_user($row)], 201);
}

// Restoring a zip archive needs the Node importer and its media unpacking. The
// setup screen hides the option on this deployment (`restoreAllowed: false`);
// this answers plainly if anything asks anyway.
if (str_starts_with($route, 'setup/restore')) {
  fail(
    'Restoring a backup zip is not available on a PHP deployment. Import the matching pb-backup-…json into the database, or deploy the Node app with its data folder.',
    403
  );
}

/* ── accounts ───────────────────────────────────────────────────────────── */

if ($route === 'auth/status' && $verb === 'GET') {
  $row = current_user();
  json_out([
    'users' => count_users(),
    'signedIn' => $row !== null,
    'user' => $row ? public_user($row) : null,
    'allowSignup' => (bool) setting_json('allow_signup', false),
  ]);
}

if ($route === 'auth/me' && $verb === 'GET') {
  $row = require_user();
  json_out(['user' => public_user($row)]);
}

if ($route === 'auth/signup' && $verb === 'POST') {
  if (!setting_json('allow_signup', false)) {
    fail('Signups are closed. Ask the owner for an account.', 403);
  }
  $input = body();
  $username = normalise_username($input['username'] ?? '');
  $password = (string) ($input['password'] ?? '');
  $email = trim((string) ($input['email'] ?? ''));
  if ($problem = username_problem($username)) fail($problem);
  if ($problem = password_problem($password)) fail($problem);
  $pdo = repo();
  if (!$pdo) fail('The database is not set up yet.', 503);
  $statement = $pdo->prepare('SELECT id FROM users WHERE username = ?');
  $statement->execute([$username]);
  if ($statement->fetchColumn()) fail('That username is taken.', 409);
  $pdo->prepare('INSERT INTO users (username, email, password_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, 0, ?)')
    ->execute([$username, $email !== '' ? $email : null, password_hash($password, PASSWORD_DEFAULT), 'reader', now_db()]);
  $id = (int) $pdo->lastInsertId();
  $statement = $pdo->prepare('SELECT * FROM users WHERE id = ?');
  $statement->execute([$id]);
  $row = $statement->fetch();
  record_event($row, 'signup', 'Read-only account created by its owner');
  sign_in($row);
  json_out(['user' => public_user($row)], 201);
}

if ($route === 'auth/login' && $verb === 'POST') {
  $input = body();
  $pdo = repo();
  if (!$pdo) fail('The database is not set up yet.', 503);
  $statement = $pdo->prepare('SELECT * FROM users WHERE username = ?');
  $statement->execute([normalise_username($input['username'] ?? '')]);
  $row = $statement->fetch();
  if (!$row || !password_verify((string) ($input['password'] ?? ''), $row['password_hash'])) {
    record_event(null, 'failed_login', 'Wrong password', normalise_username($input['username'] ?? ''));
    fail('That username and password do not match an account.', 401);
  }
  if ((int) $row['disabled'] === 1) fail('This account has been switched off.', 403);
  record_event($row, 'login', 'Signed in from the PHP bridge');
  sign_in($row);
  json_out(['user' => public_user($row)]);
}

if ($route === 'auth/logout' && $verb === 'POST') {
  $row = current_user();
  if ($row) record_event($row, 'logout', 'Signed out');
  session_start_once();
  $_SESSION = [];
  session_destroy();
  json_out(['ok' => true]);
}

if ($route === 'auth/password' && $verb === 'POST') {
  $row = require_user();
  $input = body();
  $current = (string) ($input['currentPassword'] ?? '');
  $next = (string) ($input['newPassword'] ?? '');
  if (!password_verify($current, $row['password_hash'])) fail('The current password is not right.', 400);
  if ($problem = password_problem($next)) fail($problem);
  repo()?->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    ->execute([password_hash($next, PASSWORD_DEFAULT), (int) $row['id']]);
  record_event($row, 'password_change', 'Changed their own password');
  json_out(['ok' => true]);
}

if ($route === 'auth/users' && $verb === 'GET') {
  require_owner();
  $pdo = repo();
  $rows = [];
  if ($pdo) {
    try {
      $rows = $pdo->query('SELECT * FROM users ORDER BY id ASC')->fetchAll();
    } catch (Throwable $e) {
      $rows = [];
    }
  }
  json_out(['users' => array_map('public_user', $rows)]);
}

if ($route === 'auth/users' && $verb === 'POST') {
  $owner = require_owner();
  $input = body();
  $username = normalise_username($input['username'] ?? '');
  $password = (string) ($input['password'] ?? '');
  $email = trim((string) ($input['email'] ?? ''));
  $role = ($input['role'] ?? '') === 'reader' ? 'reader' : 'admin';
  if ($problem = username_problem($username)) fail($problem);
  if ($problem = password_problem($password)) fail($problem);
  $pdo = repo();
  if (!$pdo) fail('The database is not set up yet.', 503);
  $statement = $pdo->prepare('SELECT id FROM users WHERE username = ?');
  $statement->execute([$username]);
  if ($statement->fetchColumn()) fail('That username is taken.', 409);
  $pdo->prepare('INSERT INTO users (username, email, password_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, 0, ?)')
    ->execute([$username, $email !== '' ? $email : null, password_hash($password, PASSWORD_DEFAULT), $role, now_db()]);
  $id = (int) $pdo->lastInsertId();
  $statement = $pdo->prepare('SELECT * FROM users WHERE id = ?');
  $statement->execute([$id]);
  record_event($owner, 'user_created', 'Created ' . $username);
  json_out(['user' => public_user($statement->fetch())], 201);
}

if (preg_match('#^auth/users/(\d+)$#', $route, $m)) {
  $owner = require_owner();
  $id = (int) $m[1];
  $pdo = repo();
  $statement = $pdo->prepare('SELECT * FROM users WHERE id = ?');
  $statement->execute([$id]);
  $target = $statement->fetch();

  if ($verb === 'PATCH') {
    if (!$target) fail('No such account.', 404);
    $input = body();
    if (array_key_exists('disabled', $input)) {
      if ((int) $target['id'] === (int) $owner['id']) fail('You cannot switch your own account off.', 400);
      $pdo->prepare('UPDATE users SET disabled = ? WHERE id = ?')->execute([$input['disabled'] ? 1 : 0, $id]);
      record_event($owner, 'user_created', ($input['disabled'] ? 'Disabled ' : 'Re-enabled ') . $target['username']);
    }
    if (isset($input['role'])) {
      $role = in_array($input['role'], ['owner', 'admin', 'reader'], true) ? $input['role'] : null;
      if ($role && (int) $target['id'] === (int) $owner['id'] && $role !== 'owner') {
        fail('You cannot take the owner role off your own account.', 400);
      }
      if ($role) $pdo->prepare('UPDATE users SET role = ? WHERE id = ?')->execute([$role, $id]);
    }
    $statement->execute([$id]);
    json_out(['user' => public_user($statement->fetch())]);
  }

  if ($verb === 'DELETE') {
    if (!$target) fail('No such account.', 404);
    if ((int) $target['id'] === (int) $owner['id']) fail('The owner account cannot be deleted.', 400);
    if ($target['role'] === 'owner') fail('The owner account cannot be deleted.', 400);
    $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
    record_event($owner, 'user_deleted', 'Deleted ' . $target['username']);
    json_out(['ok' => true]);
  }
}

if ($route === 'auth/events' && $verb === 'GET') {
  require_owner();
  $limit = max(1, min(500, (int) ($_GET['limit'] ?? 100)));
  $pdo = repo();
  $rows = [];
  if ($pdo) {
    try {
      $rows = $pdo->query('SELECT * FROM auth_events ORDER BY id DESC LIMIT ' . $limit)->fetchAll();
    } catch (Throwable $e) {
      $rows = [];
    }
  }
  json_out(['events' => array_map(static fn ($row) => [
    'id' => (int) $row['id'],
    'username' => $row['username'],
    'event' => $row['event'],
    'detail' => $row['detail'] ?? '',
    'ip' => $row['ip'] ?? null,
    'createdAt' => to_iso($row['created_at']),
  ], $rows)]);
}

/* ── the published site ─────────────────────────────────────────────────── */

/** The newest 15 snapshots, in the order the dashboard shows them. */
function list_revision_rows(): array
{
  $pdo = repo();
  if (!$pdo) return [];
  try {
    $rows = $pdo->query(
      'SELECT id, description, content, created_at, created_by FROM revisions ORDER BY created_at DESC, id DESC LIMIT 15'
    )->fetchAll();
  } catch (Throwable $e) {
    return [];
  }
  return array_map('public_revision', $rows);
}

/** A revision as the dashboard reads it — `timestamp`, not `createdAt`. */
function public_revision(array $row): array
{
  return [
    'id' => $row['id'],
    'description' => $row['description'],
    'content' => json_decode((string) $row['content'], true),
    'timestamp' => to_iso($row['created_at']) ?? '',
    'createdBy' => $row['created_by'] ?? null,
  ];
}

/**
 * What this request may see — the same rule as `visibleTo` in the Node server.
 *
 * A members-only section keeps its place in the page but loses its data for a
 * visitor who is not signed in, and nobody ever receives the `locked` flag.
 */
function visible_content($content, bool $signedIn)
{
  if (!is_array($content) || !is_array($content['sections'] ?? null)) return $content;
  $content['sections'] = array_map(static function ($section) use ($signedIn) {
    if (!is_array($section)) return $section;
    if ($signedIn) {
      // Whoever is signed in gets every section, and never a lock: the flag is
      // only ever a note to a visitor who is not.
      unset($section['locked']);
      return $section;
    }
    if (!empty($section['membersOnly'])) {
      $section['locked'] = true;
      $section['data'] = new stdClass();
      return $section;
    }
    unset($section['locked']);
    return $section;
  }, $content['sections']);
  return $content;
}

/** What is written: `locked` describes one response, never the site. */
function writable_content($content)
{
  if (!is_array($content) || !is_array($content['sections'] ?? null)) return $content;
  $content['sections'] = array_map(static function ($section) {
    if (is_array($section)) unset($section['locked']);
    return $section;
  }, $content['sections']);
  return $content;
}


if ($route === 'content' && $verb === 'GET') {
  $pdo = repo();
  if (!$pdo) json_out(['content' => null, 'updatedAt' => null, 'updatedBy' => null]);
  try {
    $row = $pdo->query('SELECT content, updated_at, updated_by FROM site_content WHERE id = 1')->fetch();
  } catch (Throwable $e) {
    $row = null;
  }
  if (!$row) json_out(['content' => null, 'updatedAt' => null, 'updatedBy' => null]);
  json_out([
    'content' => visible_content(json_decode($row['content'], true), current_user() !== null),
    'updatedAt' => to_iso($row['updated_at']),
    'updatedBy' => $row['updated_by'],
  ]);
}

if ($route === 'content' && $verb === 'PUT') {
  $user = require_editor();
  $pdo = repo();
  $input = body();
  $content = $input['content'] ?? null;
  if (!is_array($content)) fail('Expected a site content object.', 400);
  if (($content['v'] ?? null) !== 1 || !is_array($content['sections'] ?? null)) {
    fail('That content does not look like a saved site.', 400);
  }
  $serialised = json_encode(writable_content($content), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  if ($serialised === false) fail('That content could not be stored.', 400);
  if (strlen($serialised) > 8000000) fail('That site snapshot is too large to store.', 413);

  $description = trim((string) ($input['description'] ?? '')) ?: 'Website update';
  $revisionId = trim((string) ($input['revisionId'] ?? '')) ?: 'rev-' . time();

  $sqlite = pdo_driver($pdo) === 'sqlite';
  $save = $sqlite
    ? 'INSERT INTO site_content (id, content, updated_at, updated_by) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at, updated_by = excluded.updated_by'
    : 'INSERT INTO site_content (id, content, updated_at, updated_by) VALUES (1, ?, ?, ?)
       ON DUPLICATE KEY UPDATE content = VALUES(content), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)';
  $pdo->prepare($save)->execute([$serialised, now_db(), $user['username']]);

  $pdo->prepare('INSERT INTO revisions (id, description, content, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
    ->execute([$revisionId, mb_substr($description, 0, 255), $serialised, now_db(), $user['username']]);

  // Keep the newest 15 snapshots, exactly like the Node repository, and answer
  // with the list: the dashboard replaces its own history with this.
  try {
    $pdo->prepare(
      'DELETE FROM revisions WHERE id NOT IN (SELECT id FROM (SELECT id FROM revisions ORDER BY created_at DESC, id DESC LIMIT 15) AS keep)'
    )->execute();
  } catch (Throwable $e) {
    // SQLite dislikes the derived table; the trim is housekeeping, not the save.
  }
  json_out(['ok' => true, 'revisions' => list_revision_rows()]);
}

if ($route === 'revisions' && $verb === 'GET') {
  require_editor();
  json_out(['revisions' => list_revision_rows()]);
}

if (preg_match('#^revisions/(.+)$#', $route, $m) && $verb === 'DELETE') {
  require_editor();
  $pdo = repo();
  if (!$pdo) fail('The database is not set up yet.', 503);
  $statement = $pdo->prepare('DELETE FROM revisions WHERE id = ?');
  $statement->execute([mb_substr(rawurldecode($m[1]), 0, 64)]);
  if ($statement->rowCount() === 0) fail('No such revision.', 404);
  json_out(['ok' => true]);
}

/* ── settings ───────────────────────────────────────────────────────────── */

if ($route === 'settings/theme' && $verb === 'GET') {
  $theme = setting_json('theme', 'dark');
  json_out(['theme' => in_array($theme, ['dark', 'light'], true) ? $theme : 'dark']);
}

if ($route === 'settings/theme' && $verb === 'PUT') {
  require_editor();
  $theme = (string) (body()['theme'] ?? '');
  if (!in_array($theme, ['dark', 'light'], true)) fail('Theme must be dark or light.', 400);
  put_setting('theme', json_setting_encode($theme));
  json_out(['ok' => true, 'theme' => $theme]);
}

if ($route === 'settings/site' && $verb === 'GET') {
  $title = setting_json('site_title', $cfg['siteTitle']);
  json_out([
    'title' => is_string($title) && trim($title) !== '' ? $title : $cfg['siteTitle'],
    'allowSignup' => (bool) setting_json('allow_signup', false),
  ]);
}

if ($route === 'settings/site' && $verb === 'PUT') {
  require_editor();
  $input = body();
  if (array_key_exists('title', $input)) {
    $title = trim((string) $input['title']);
    if ($title === '') fail('The site needs a title.', 400);
    if (mb_strlen($title) > 120) fail('Keep the site title under 120 characters.', 400);
    put_setting('site_title', json_setting_encode($title));
  }
  if (array_key_exists('allowSignup', $input)) {
    put_setting('allow_signup', json_setting_encode((bool) $input['allowSignup']));
  }
  $saved = setting_json('site_title', $cfg['siteTitle']);
  json_out(['ok' => true, 'title' => $saved, 'allowSignup' => (bool) setting_json('allow_signup', false)]);
}

/* ── media ──────────────────────────────────────────────────────────────── */

if ($route === 'media' && $verb === 'GET') {
  require_editor();
  json_out(['media' => array_merge(array_map('media_item', list_media_rows()), bundled_media())]);
}

if (($route === 'media' && $verb === 'POST') || (preg_match('#^media/([^/]+)/file$#', $route, $m) && $verb === 'PUT')) {
  require_editor();
  $replacing = isset($m[1]);
  $file = incoming_upload();
  if ($file === null) fail('No file arrived.', 400);
  $original = mb_substr(basename($file['name']) ?: 'upload', 0, 255);
  $ext = mb_strtolower(pathinfo($original, PATHINFO_EXTENSION));
  $allowed = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg', 'mp4', 'webm', 'pdf'];
  if (!in_array($ext, $allowed, true)) {
    @unlink($file['path']);
    fail('.' . ($ext !== '' ? $ext : 'file') . ' is not a supported upload type.', 415);
  }
  $uploadDir = media_upload_dir();

  $pdo = repo();
  if (!$pdo) fail('The database is not set up yet.', 503);

  if ($replacing) {
    $id = rawurldecode($m[1]);
    $statement = $pdo->prepare('SELECT * FROM media WHERE id = ?');
    $statement->execute([$id]);
    $existing = $statement->fetch();
    if (!$existing) fail('No such photo.', 404);
    $target = $uploadDir . '/' . $existing['filename'];
    if (!@rename($file['path'], $target) && !@copy($file['path'], $target)) {
      fail('The file could not be stored. The media folder must be writable.', 500);
    }
    $pdo->prepare('UPDATE media SET size = ?, mime = ? WHERE id = ?')
      ->execute([filesize($target) ?: 0, (string) $file['type'] ?: (string) $existing['mime'], $id]);
    $statement->execute([$id]);
    json_out(['item' => media_item($statement->fetch())]);
  }

  $id = bin2hex(random_bytes(16));
  $filename = $id . '.' . $ext;
  if (!@rename($file['path'], $uploadDir . '/' . $filename) && !@copy($file['path'], $uploadDir . '/' . $filename)) {
    fail('The file could not be stored. The media folder must be writable.', 500);
  }
  $video = in_array($ext, ['mp4', 'webm'], true);
  $tags = $_POST['tags'] ?? (body()['tags'] ?? '');
  $pdo->prepare('INSERT INTO media (id, filename, original_name, mime, size, kind, ext, tags, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    ->execute([
      $id,
      $filename,
      $original,
      (string) $file['type'],
      filesize($uploadDir . '/' . $filename) ?: 0,
      $video ? 'video' : 'image',
      $ext,
      is_array($tags) ? implode(',', array_map('strval', $tags)) : (string) $tags,
      now_db(),
      current_user()['username'] ?? null,
    ]);
  $statement = $pdo->prepare('SELECT * FROM media WHERE id = ?');
  $statement->execute([$id]);
  json_out(['item' => media_item($statement->fetch())], 201);
}

if (preg_match('#^media/([^/]+)$#', $route, $m)) {
  $user = require_editor();
  $id = rawurldecode($m[1]);
  $pdo = repo();
  if (!$pdo) fail('The database is not set up yet.', 503);

  if ($verb === 'PATCH') {
    if (str_starts_with($id, 'bundled:')) {
      fail('This photo ships with the website and cannot be tagged.', 403);
    }
    $tags = body()['tags'] ?? [];
    $clean = implode(',', array_slice(array_map(
      static fn ($tag) => mb_substr(trim((string) $tag), 0, 40),
      is_array($tags) ? $tags : []
    ), 0, 12));
    $statement = $pdo->prepare('UPDATE media SET tags = ? WHERE id = ?');
    $statement->execute([$clean, $id]);
    if ($statement->rowCount() === 0) fail('No such photo.', 404);
    $statement = $pdo->prepare('SELECT * FROM media WHERE id = ?');
    $statement->execute([$id]);
    json_out(['item' => media_item($statement->fetch())]);
  }

  if ($verb === 'DELETE') {
    if (str_starts_with($id, 'bundled:')) {
      fail('This photo ships with the website and cannot be deleted.', 403);
    }
    $statement = $pdo->prepare('SELECT * FROM media WHERE id = ?');
    $statement->execute([$id]);
    $row = $statement->fetch();
    if (!$row) fail('No such photo.', 404);
    $file = media_upload_dir() . '/' . $row['filename'];
    if (is_file($file)) @unlink($file);
    $pdo->prepare('DELETE FROM media WHERE id = ?')->execute([$id]);
    json_out(['ok' => true]);
  }
}

/* ── backups ────────────────────────────────────────────────────────────── */

if ($route === 'backups' && $verb === 'GET') {
  require_owner();
  $backups = list_backups();
  json_out([
    // No cron job on this deployment: backups are taken when the button is
    // pressed, so `enabled` is false and `nextRunAt` has no answer to give.
    'enabled' => false,
    'hour' => 2,
    'keep' => 10,
    'dir' => 'backup',
    'includeApp' => false,
    'lastBackupAt' => $backups[0]['createdAt'] ?? null,
    'nextRunAt' => null,
    'backups' => $backups,
  ]);
}

if ($route === 'backups' && $verb === 'POST') {
  require_owner();
  json_out(['backup' => create_backup()], 201);
}

if (preg_match('#^backups/(.+)$#', $route, $m) && $verb === 'GET') {
  require_owner();
  $name = basename(rawurldecode($m[1]));
  if (!preg_match('/^pb-backup-[A-Za-z0-9_.-]+\.json$/', $name)) fail('That is not a backup file name.', 400);
  $file = backup_dir() . '/' . $name;
  if (!is_file($file)) fail('That backup is no longer here.', 404);
  header('Content-Type: application/json');
  header('Content-Disposition: attachment; filename="' . $name . '"');
  header('Cache-Control: no-store');
  readfile($file);
  exit;
}

/* ── alerts ─────────────────────────────────────────────────────────────── */

if ($route === 'alerts' && $verb === 'GET') {
  $user = require_user();
  $pdo = repo();
  $rows = [];
  if ($pdo) {
    try {
      $statement = $pdo->prepare(
        'SELECT * FROM route_alerts WHERE expires_at IS NULL OR expires_at > ? ORDER BY created_at DESC LIMIT 60'
      );
      $statement->execute([now_db()]);
      $rows = $statement->fetchAll();
    } catch (Throwable $e) {
      $rows = [];
    }
  }
  $read = [];
  if ($pdo) {
    try {
      $statement = $pdo->prepare('SELECT alert_id FROM alert_reads WHERE user_id = ?');
      $statement->execute([(int) $user['id']]);
      $read = array_map('intval', array_column($statement->fetchAll(), 'alert_id'));
    } catch (Throwable $e) {
      $read = [];
    }
  }
  $list = array_map(static fn ($row) => alert_row($row, in_array((int) $row['id'], $read, true)), $rows);
  json_out([
    'alerts' => $list,
    'unread' => count(array_filter($list, static fn ($alert) => !$alert['read'])),
    'sweepMinutes' => SWEEP_MINUTES,
    'canPost' => is_editor($user),
    // Said in the answer, because the dashboard shows it: this deployment has no
    // weather sweep, so only the notices an editor posts will appear.
    'sweepAvailable' => false,
  ]);
}

if ($route === 'alerts/read' && $verb === 'POST') {
  $user = require_user();
  $pdo = repo();
  if (!$pdo) json_out(['marked' => 0]);
  $ids = body()['ids'] ?? null;
  if (!is_array($ids)) {
    try {
      $ids = array_map('intval', array_column($pdo->query('SELECT id FROM route_alerts')->fetchAll(), 'id'));
    } catch (Throwable $e) {
      $ids = [];
    }
  }
  $marked = 0;
  foreach (array_slice($ids, 0, 200) as $id) {
    $id = (int) $id;
    if ($id <= 0) continue;
    try {
      $sqlite = pdo_driver($pdo) === 'sqlite';
      $sql = $sqlite
        ? 'INSERT INTO alert_reads (alert_id, user_id, read_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'
        : 'INSERT IGNORE INTO alert_reads (alert_id, user_id, read_at) VALUES (?, ?, ?)';
      $pdo->prepare($sql)->execute([$id, (int) $user['id'], now_db()]);
      $marked += 1;
    } catch (Throwable $e) {
      // Already read, or the alert is gone.
    }
  }
  json_out(['marked' => $marked]);
}

if ($route === 'alerts/refresh' && $verb === 'POST') {
  require_user();
  // No forecast sweep on this deployment: it needs the Node scheduler and a
  // weather key. Answering "ok" keeps the button harmless instead of broken.
  json_out(['ok' => true, 'inserted' => 0, 'checked' => 0, 'skipped' => 'php deployment']);
}

if ($route === 'alerts' && $verb === 'POST') {
  $user = require_editor();
  $input = body();
  $title = trim((string) ($input['title'] ?? ''));
  if (mb_strlen($title) < 4) fail('Give the notice a headline — “NH-503 blocked at Ropar”, say.', 400);
  if (mb_strlen($title) > 140) fail('Keep the headline under 140 characters.', 400);
  $detail = mb_substr(trim((string) ($input['body'] ?? '')), 0, 800);
  $place = mb_substr(trim((string) ($input['place'] ?? '')), 0, 120);
  $hours = (float) ($input['hours'] ?? 12);
  if ($hours < 1 || $hours > 336) fail('How long does it stand for? Between 1 hour and 14 days.', 400);
  $severity = in_array($input['severity'] ?? '', ['info', 'watch', 'warning'], true) ? $input['severity'] : 'warning';

  $pdo = repo();
  if (!$pdo) fail('The database is not set up yet.', 503);
  $coord = static function ($value) {
    if ($value === null || $value === '') return null;
    return is_numeric($value) ? (float) $value : null;
  };
  try {
    $pdo->prepare(
      'INSERT INTO route_alerts (kind, severity, title, body, place, lat, lng, source, dedupe_key, route_signature, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
      'road', $severity, $title, $detail, $place,
      $coord($input['lat'] ?? null), $coord($input['lng'] ?? null),
      'admin',
      'road:' . gmdate('Y-m-d H:i') . ':' . mb_substr(mb_strtolower($title), 0, 80),
      '',
      now_db(),
      gmdate('Y-m-d H:i:s', time() + (int) round($hours * 3600)),
    ]);
  } catch (Throwable $e) {
    fail('That notice could not be stored: ' . $e->getMessage(), 500);
  }
  json_out(['ok' => true, 'inserted' => 1], 201);
}

if (preg_match('#^alerts/(\d+)$#', $route, $m) && $verb === 'DELETE') {
  require_editor();
  $pdo = repo();
  if (!$pdo) fail('The database is not set up yet.', 503);
  $statement = $pdo->prepare('DELETE FROM route_alerts WHERE id = ?');
  $statement->execute([(int) $m[1]]);
  if ($statement->rowCount() === 0) fail('That alert is already gone.', 404);
  json_out(['ok' => true]);
}

/* ── the member's corner ────────────────────────────────────────────────── */

if ($route === 'member/catalogue' && $verb === 'GET') {
  json_out(['makers' => catalogue()]);
}

if ($route === 'member/garage' && $verb === 'GET') {
  $user = require_user();
  $bikes = list_bikes((int) $user['id']);
  $journeys = array_map(static fn ($row) => journey_row($row, $bikes), list_journeys((int) $user['id']));
  json_out([
    'bikes' => $bikes,
    'journeys' => $journeys,
    'totals' => [
      'bikes' => count($bikes),
      'journeys' => count($journeys),
      'kmOneWay' => round_to(array_sum(array_map(static fn ($j) => $j['maths']['oneWayKm'], $journeys)), 1),
      'stops' => array_sum(array_map(static fn ($j) => $j['maths']['stops'], $journeys)),
    ],
  ]);
}

if ($route === 'member/bikes' && $verb === 'GET') {
  $user = require_user();
  json_out(['bikes' => list_bikes((int) $user['id'])]);
}

if ($route === 'member/bikes' && $verb === 'POST') {
  $user = require_user();
  $input = body();
  $maker = find_maker($input['maker'] ?? '');
  $model = find_model($input['maker'] ?? '', $input['model'] ?? '');
  if (!$maker) fail('Choose the bike’s maker.', 400);
  if (!$model) fail('Choose the bike’s model.', 400);
  $year = ($input['year'] ?? '') === '' ? null : (int) $input['year'];
  $now = (int) gmdate('Y');
  if ($year !== null && ($year < 1970 || $year > $now + 1)) {
    fail('The purchase year should be between 1970 and ' . ($now + 1) . '.', 400);
  }
  $typed = ($input['mileageKmpl'] ?? $input['mileage'] ?? '') === '' ? null : (float) ($input['mileageKmpl'] ?? $input['mileage']);
  if ($typed !== null && ($typed <= 0 || $typed > 200)) {
    fail('The mileage should be between 1 and 200 km per litre.', 400);
  }
  $estimate = estimate_mileage($maker['name'], $model['model']['name'], $year);
  $pdo = repo();
  if (!$pdo) fail('The database is not set up yet.', 503);
  $pdo->prepare('INSERT INTO member_bikes (user_id, maker, model, year, mileage_kmpl, mileage_source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    ->execute([
      (int) $user['id'],
      $maker['name'],
      $model['model']['name'],
      $year,
      $typed ?? $estimate['kmpl'],
      $typed !== null ? 'manual' : 'estimated',
      now_db(),
    ]);
  $bikes = list_bikes((int) $user['id']);
  $created = $bikes[count($bikes) - 1] ?? null;
  json_out(['bike' => $created, 'bikes' => $bikes, 'estimateNote' => $estimate['note']], 201);
}

if (preg_match('#^member/bikes/(\d+)$#', $route, $m)) {
  $user = require_user();
  $pdo = repo();
  if (!$pdo) fail('The database is not set up yet.', 503);
  $id = (int) $m[1];
  $statement = $pdo->prepare('SELECT * FROM member_bikes WHERE id = ? AND user_id = ?');
  $statement->execute([$id, (int) $user['id']]);
  $current = $statement->fetch();
  if (!$current) fail('That bike is not in your garage.', 404);

  if ($verb === 'PATCH') {
    $input = body();
    $maker = find_maker($input['maker'] ?? $current['maker']) ?? ['name' => $current['maker']];
    $model = find_model($input['maker'] ?? $current['maker'], $input['model'] ?? $current['model']);
    $year = array_key_exists('year', $input) ? (($input['year'] ?? '') === '' ? null : (int) $input['year']) : ($current['year'] === null ? null : (int) $current['year']);
    $typed = array_key_exists('mileageKmpl', $input) || array_key_exists('mileage', $input)
      ? (float) ($input['mileageKmpl'] ?? $input['mileage'])
      : ($current['mileage_kmpl'] === null ? null : (float) $current['mileage_kmpl']);
    $estimate = estimate_mileage($maker['name'], $model['model']['name'] ?? $current['model'], $year);
    $pdo->prepare('UPDATE member_bikes SET maker = ?, model = ?, year = ?, mileage_kmpl = ?, mileage_source = ? WHERE id = ? AND user_id = ?')
      ->execute([
        $maker['name'],
        $model['model']['name'] ?? $current['model'],
        $year,
        $typed ?? $estimate['kmpl'],
        array_key_exists('mileageKmpl', $input) || array_key_exists('mileage', $input) ? 'manual' : $current['mileage_source'],
        $id,
        (int) $user['id'],
      ]);
    $bikes = list_bikes((int) $user['id']);
    $saved = null;
    foreach ($bikes as $bike) if ((int) $bike['id'] === $id) $saved = $bike;
    json_out(['bike' => $saved, 'bikes' => $bikes, 'estimateNote' => $estimate['note']]);
  }

  if ($verb === 'DELETE') {
    $pdo->prepare('DELETE FROM member_bikes WHERE id = ? AND user_id = ?')->execute([$id, (int) $user['id']]);
    json_out(['ok' => true, 'bikes' => list_bikes((int) $user['id'])]);
  }
}

if ($route === 'member/journeys' && $verb === 'GET') {
  $user = require_user();
  $bikes = list_bikes((int) $user['id']);
  json_out([
    'bikes' => $bikes,
    'journeys' => array_map(static fn ($row) => journey_row($row, $bikes), list_journeys((int) $user['id'])),
  ]);
}

if ($route === 'member/journeys' && $verb === 'POST') {
  $user = require_user();
  $pdo = repo();
  if (!$pdo) fail('The database is not set up yet.', 503);
  $input = body();
  $stops = is_array($input['stops'] ?? null) ? array_slice($input['stops'], 0, 60) : [];
  if ($problem = stops_problem($stops)) fail($problem);
  $statement = $pdo->prepare(
    'INSERT INTO member_journeys (user_id, title, bike_id, stops, notes, gallery, round_trip, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  $statement->execute([
    (int) $user['id'],
    journey_title($input, $stops),
    journey_bike($input, (int) $user['id'], $pdo),
    json_setting_encode($stops),
    mb_substr((string) ($input['notes'] ?? ''), 0, 20000),
    json_setting_encode($input['gallery'] ?? []),
    !empty($input['roundTrip']) ? 1 : 0,
    now_db(),
    now_db(),
  ]);
  $bikes = list_bikes((int) $user['id']);
  $id = (int) $pdo->lastInsertId();
  $statement = $pdo->prepare('SELECT * FROM member_journeys WHERE id = ?');
  $statement->execute([$id]);
  json_out(['journey' => journey_row($statement->fetch(), $bikes)], 201);
}

if (preg_match('#^member/journeys/(\d+)$#', $route, $m)) {
  $user = require_user();
  $pdo = repo();
  if (!$pdo) fail('The database is not set up yet.', 503);
  $id = (int) $m[1];
  $statement = $pdo->prepare('SELECT * FROM member_journeys WHERE id = ? AND user_id = ?');
  $statement->execute([$id, (int) $user['id']]);
  $current = $statement->fetch();
  if (!$current) fail('That ride is not yours.', 404);

  if ($verb === 'PATCH') {
    $input = body();
    $stops = is_array($input['stops'] ?? null) ? array_slice($input['stops'], 0, 60) : (json_decode((string) $current['stops'], true) ?: []);
    if ($problem = stops_problem($stops)) fail($problem);
    $pdo->prepare('UPDATE member_journeys SET title = ?, bike_id = ?, stops = ?, notes = ?, gallery = ?, round_trip = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      ->execute([
        journey_title($input, $stops, (string) $current['title']),
        journey_bike($input, (int) $user['id'], $pdo, $current['bike_id']),
        json_setting_encode($stops),
        mb_substr((string) ($input['notes'] ?? $current['notes']), 0, 20000),
        json_setting_encode($input['gallery'] ?? (json_decode((string) $current['gallery'], true) ?: [])),
        array_key_exists('roundTrip', $input) ? (!empty($input['roundTrip']) ? 1 : 0) : (int) $current['round_trip'],
        now_db(),
        $id,
        (int) $user['id'],
      ]);
    $statement->execute([$id, (int) $user['id']]);
    json_out(['journey' => journey_row($statement->fetch(), list_bikes((int) $user['id']))]);
  }

  if ($verb === 'DELETE') {
    $pdo->prepare('DELETE FROM member_journeys WHERE id = ? AND user_id = ?')->execute([$id, (int) $user['id']]);
    json_out(['ok' => true]);
  }
}

/** A ride's stops: coordinates are required, nothing may be off the map. */
function stops_problem(array $stops): ?string
{
  if (count($stops) > 60) return 'A ride can hold up to 60 stops.';
  foreach ($stops as $stop) {
    if (!is_array($stop)) continue;
    $lat = $stop['lat'] ?? null;
    $lng = $stop['lng'] ?? null;
    if (!is_numeric($lat) || !is_numeric($lng)) continue;
    if (abs((float) $lat) > 90 || abs((float) $lng) > 180) {
      return 'One of the stops has a coordinate outside the map.';
    }
  }
  return null;
}

function journey_title(array $input, array $stops, string $fallback = ''): string
{
  $title = trim((string) ($input['title'] ?? $fallback));
  if ($title !== '') return mb_substr($title, 0, 120);
  if (count($stops) > 1) {
    $last = $stops[count($stops) - 1];
    return mb_substr(trim((string) ($stops[0]['name'] ?? '')) . ' → ' . trim((string) ($last['name'] ?? '')), 0, 120);
  }
  return 'New ride';
}

function journey_bike(array $input, int $userId, PDO $pdo, $fallback = null): ?int
{
  $raw = array_key_exists('bikeId', $input) ? $input['bikeId'] : $fallback;
  if ($raw === null || $raw === '') return null;
  $id = (int) $raw;
  $statement = $pdo->prepare('SELECT id FROM member_bikes WHERE id = ? AND user_id = ?');
  $statement->execute([$id, $userId]);
  if (!$statement->fetchColumn()) {
    fail('Pick a bike from your own garage.', 400);
  }
  return $id;
}

if ($route === 'member/link' && $verb === 'POST') {
  require_user();
  $result = http_get(trim((string) (body()['url'] ?? '')));
  if ($result['error'] !== '' || $result['url'] === '') {
    fail('The map service could not be reached from this server.', 502);
  }
  if (!looks_like_map_address($result['url'])) {
    fail('That link did not expand to a map address.', 422);
  }
  json_out(['url' => $result['url']]);
}

/* ── the map link the dashboard pastes ──────────────────────────────────── */

if ($route === 'maps/resolve' && $verb === 'POST') {
  require_editor();
  $url = trim((string) (body()['url'] ?? ''));
  if (!preg_match('#^https?://#i', $url)) fail('That is not a link.', 400);
  if (looks_like_map_address($url)) json_out(['url' => $url]);

  $result = http_get($url);
  if ($result['error'] !== '' || $result['url'] === '') {
    fail('The short link could not be read from this server (' . ($result['error'] ?: 'no answer') . '). Open it in a browser, copy the address and paste that here.', 502);
  }
  if (!looks_like_map_address($result['url'])) {
    fail('The short link did not give up a map address. Open it in a browser and paste the full address instead.', 422);
  }
  json_out(['url' => $result['url']]);
}

if ($route === 'maps/health' && $verb === 'GET') {
  require_editor();
  $started = microtime(true);
  $result = http_get('https://maps.app.goo.gl/', 6);
  json_out([
    'reachable' => $result['error'] === '' && $result['status'] > 0,
    'code' => $result['error'] !== '' ? $result['error'] : ($result['status'] ? '' : 'ENOANSWER'),
    'ms' => (int) round((microtime(true) - $started) * 1000),
    'proxy' => '',
    'proxySource' => '',
    'pac' => '',
    'platform' => 'php ' . PHP_VERSION,
    'node' => '',
    'family' => 0,
    'route' => 'direct',
    'routes' => [['route' => 'direct', 'error' => $result['error']]],
    'hint' => $result['error'] === ''
      ? 'The server can reach the maps.'
      : 'The hosting firewall is blocking outbound requests from PHP.',
  ]);
}

/* ── nearby places, straight from OpenStreetMap ─────────────────────────── */

if ($route === 'nearby' && $verb === 'GET') {
  $kind = (string) ($_GET['kind'] ?? '');
  $kinds = ['stays' => 15, 'food' => 12, 'essentials' => 25];
  if (!isset($kinds[$kind])) {
    fail('Ask for one of: stays, food, essentials.', 400);
  }
  $lat = (float) ($_GET['lat'] ?? 0);
  $lng = (float) ($_GET['lng'] ?? 0);
  if (abs($lat) > 90 || abs($lng) > 180 || ($lat === 0.0 && $lng === 0.0)) {
    fail('A latitude and longitude on the map are needed.', 400);
  }
  $radius = $kinds[$kind] * 1000;
  $filters = [
    'stays' => '["tourism"~"hotel|guest_house|hostel|motel"]',
    'food' => '["amenity"~"restaurant|cafe|fast_food|dhaba"]',
    'essentials' => '["amenity"~"fuel|pharmacy|hospital|atm|bank"]',
  ][$kind];
  $query = sprintf(
    '[out:json][timeout:12];(node%s(around:%d,%F,%F);way%s(around:%d,%F,%F););out center 60;',
    $filters, $radius, $lat, $lng, $filters, $radius, $lat, $lng
  );
  $response = http_post_form('https://overpass-api.de/api/interpreter', 'data=' . rawurlencode($query), 14);
  $payload = json_decode($response['text'], true);
  $items = [];
  foreach (is_array($payload['elements'] ?? null) ? $payload['elements'] : [] as $element) {
    $tags = $element['tags'] ?? [];
    $placeLat = $element['lat'] ?? ($element['center']['lat'] ?? null);
    $placeLng = $element['lon'] ?? ($element['center']['lon'] ?? null);
    if ($placeLat === null || $placeLng === null) continue;
    $name = trim((string) ($tags['name'] ?? ''));
    if ($name === '' && $kind === 'stays') continue;
    $items[] = [
      'id' => 'osm/' . ($element['id'] ?? ''),
      'kind' => $kind,
      'title' => $name !== '' ? $name : ($kind === 'essentials' ? 'Fuel or pharmacy' : 'Eatery'),
      'lat' => (float) $placeLat,
      'lng' => (float) $placeLng,
      'distanceKm' => round_to(haversine_km(['lat' => $lat, 'lng' => $lng], ['lat' => $placeLat, 'lng' => $placeLng]), 2),
      'detail' => trim((string) ($tags['amenity'] ?? $tags['tourism'] ?? '')),
      'opening' => $tags['opening_hours'] ?? null,
    ];
  }
  usort($items, static fn ($a, $b) => $a['distanceKm'] <=> $b['distanceKm']);
  json_out([
    'source' => 'openstreetmap',
    'area' => null,
    'cached' => false,
    'items' => array_slice($items, 0, 60),
    'tried' => $response['error'] !== '' ? ['overpass: ' . $response['error']] : [],
  ]);
}

/* Anything else: a JSON 404, never the page's HTML — the client would read that
   as "the server is broken" instead of "this deployment has no such endpoint". */
fail('This deployment has no such endpoint: /' . $route, 404);
