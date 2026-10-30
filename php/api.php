<?php
/**
 * The bootstrap: the one job PHP does on a static deployment.
 *
 * A folder of files cannot open a database. This file can, because PHP is code
 * the server executes — so the first visit uses it for exactly three things:
 *
 *   1. say whether the database is reachable (`setup/status`, `setup/test`);
 *   2. create the tables (`setup/database`);
 *   3. create the owner account (`setup/owner`).
 *
 * That is the whole list. It never signs anybody in, never reads or writes the
 * site's content, never touches a photo, and stores no session — once the
 * database exists the site's API is the Node server, and this file refuses
 * everything else with 410 Gone. Deleting it after setup is safe and is the
 * cleanest way to prove the point.
 *
 * The Node app does not use this file at all, not even for its own setup: that
 * lives in `server/routes/setup.js`. So a Node deployment never runs PHP.
 *
 * The database password lives in `php-config.php` beside this file. That is safe
 * in a way a `.env` in a web root is not: PHP is *executed*, so its source is
 * never served. Keep the `.php` extension.
 */

declare(strict_types=1);

/* ── it has to run everywhere ───────────────────────────────────────────── */

/**
 * This file is deployed to whatever PHP the host happens to run, so it uses
 * nothing newer than 7.2 and nothing that needs an extension to be installed.
 *
 * Two things made an older or leaner server answer with a *blank page* rather
 * than an error — which reads as "the file is not there" and is impossible to
 * diagnose from a browser:
 *
 *  - `str_starts_with` / `str_ends_with` / `str_contains` are PHP 8.0. Calling
 *    one on 7.4 is a fatal error, and shared hosting turns `display_errors`
 *    off, so the response body is empty.
 *  - `mb_strlen` / `mb_strtolower` need the mbstring extension, which a minimal
 *    PHP build may not have.
 *
 * Both are answered here, once, so the rest of the file can use them freely.
 */
if (!function_exists('str_starts_with')) {
  function str_starts_with(string $haystack, string $needle): bool
  {
    return $needle === '' || strncmp($haystack, $needle, strlen($needle)) === 0;
  }
}
if (!function_exists('str_ends_with')) {
  function str_ends_with(string $haystack, string $needle): bool
  {
    if ($needle === '') return true;
    return substr($haystack, -strlen($needle)) === $needle;
  }
}
if (!function_exists('str_contains')) {
  function str_contains(string $haystack, string $needle): bool
  {
    return $needle === '' || strpos($haystack, $needle) !== false;
  }
}
if (!function_exists('mb_strlen')) {
  function mb_strlen(string $value, ?string $encoding = null): int
  {
    return strlen($value);
  }
}
if (!function_exists('mb_substr')) {
  function mb_substr(string $value, int $start, ?int $length = null, ?string $encoding = null): string
  {
    return $length === null ? substr($value, $start) : substr($value, $start, $length);
  }
}
if (!function_exists('mb_strtolower')) {
  function mb_strtolower(string $value, ?string $encoding = null): string
  {
    return strtolower($value);
  }
}

/**
 * Every failure becomes JSON.
 *
 * A fatal error with `display_errors` off sends nothing at all, and nothing is
 * what sent us looking for a missing file. The handler below still cannot catch
 * a parse error (the file would not have loaded), but it catches everything the
 * code itself can trip over, and says so in a way the setup screen can show.
 */
set_error_handler(static function (int $severity, string $message, string $file = '', int $line = 0): bool {
  // Only the severities that mean "this did not work". A notice or a
  // deprecation is normal on an unknown PHP version — 8.1 is noisy about null
  // arguments — and turning one into an exception would replace a working setup
  // with a 500.
  $fatal = E_WARNING | E_USER_WARNING | E_RECOVERABLE_ERROR;
  if (!($severity & $fatal)) return false;
  if (!(error_reporting() & $severity)) return false;
  throw new ErrorException($message, 0, $severity, $file, $line);
});

register_shutdown_function(static function (): void {
  $error = error_get_last();
  if (!$error || !in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) return;
  if (headers_sent()) return;
  http_response_code(500);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode([
    'error' => 'The setup file hit a fatal error: ' . $error['message'],
    'code' => 'php_fatal',
    'php' => PHP_VERSION,
    'line' => $error['line'],
  ], JSON_UNESCAPED_SLASHES);
});

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
  // Where the Node API lives. Written by the export (`--api`), and only used
  // for the sentence that tells the setup screen where to go afterwards.
  'apiUrl' => '/server',
];

const SCHEMA_VERSION = 8;

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

/**
 * Which setup step this request is.
 *
 * Three spellings, all of them the same four answers, because the folder may or
 * may not have a working `.htaccess`:
 *
 *   /api/setup/status            rewrite to api.php (the tidy one)
 *   /api.php/setup/status        PATH_INFO, no rewrite needed
 *   /api.php?route=setup/status  a query parameter, works on any PHP host
 *
 * The last one is why this file needs no Apache configuration at all to do its
 * job: a host that ignores `.htaccess`, or a file manager that hides dotfiles
 * and never uploads it, still reaches the bootstrap.
 */
function route(): string
{
  $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
  $at = strpos($path, '/api/');
  if ($at !== false) return trim(substr($path, $at + 5), '/');

  // /api.php/setup/status
  $script = (string) ($_SERVER['SCRIPT_NAME'] ?? '');
  $info = (string) ($_SERVER['PATH_INFO'] ?? '');
  if ($info === '' && $script !== '' && str_starts_with($path, $script)) {
    $info = substr($path, strlen($script));
  }
  $info = trim($info, '/');
  if ($info !== '') return $info;

  // /api.php?route=setup/status
  $asked = $_GET['route'] ?? '';
  return is_string($asked) ? trim($asked, '/') : '';
}

function method(): string
{
  return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

function to_iso($value): ?string
{
  if ($value === null || $value === '') return null;
  $stamp = strtotime((string) $value . (str_contains((string) $value, ' ') ? ' UTC' : ''));
  if ($stamp === false) return null;
  return gmdate('Y-m-d\TH:i:s\Z', $stamp);
}

function now_db(): string
{
  return gmdate('Y-m-d H:i:s');
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
 * `IF NOT EXISTS` makes this the repair as well as the setup, and the columns
 * are the Node server's own, so the app finds the database already shaped the
 * way it expects and runs its migrations on top without a rewrite.
 */
function schema_statements(): array
{
  global $cfg;
  if ($cfg['driver'] === 'sqlite') {
    // SQLite: for local trials of this file. Shared hosting is MySQL.
    return [
      "CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(64) NOT NULL UNIQUE, email VARCHAR(190) NULL,
        password_hash VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL DEFAULT 'reader',
        disabled INTEGER NOT NULL DEFAULT 0, created_at VARCHAR(32) NOT NULL,
        last_login_at VARCHAR(32) NULL)",
      "CREATE TABLE IF NOT EXISTS settings (
        setting_key VARCHAR(64) PRIMARY KEY, value TEXT NOT NULL, updated_at VARCHAR(32) NOT NULL)",
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
        maker VARCHAR(64) NOT NULL, model VARCHAR(120) NOT NULL, year INTEGER NULL,
        mileage_kmpl REAL NULL, mileage_source VARCHAR(16) NOT NULL DEFAULT 'manual',
        created_at VARCHAR(32) NOT NULL)",
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
 * Columns a table must have, added when an older setup made it without them.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so
 * a database created by an older version of this file would keep its narrow
 * rows and the Node app would fail on the first write. Adding the column is
 * the repair, and it runs on the way into both setup steps.
 */
function required_columns(): array
{
  return [
    'users' => [
      'email' => 'VARCHAR(190) NULL',
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
      'notes' => 'LONGTEXT NULL',
      'gallery' => 'LONGTEXT NULL',
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
      continue; // No such table yet: the CREATE either made it or could not.
    }
    foreach ($columns as $column => $definition) {
      if (in_array($column, $have, true)) continue;
      if ($sqlite) $definition = str_replace('LONGTEXT', 'TEXT', $definition);
      try {
        $pdo->exec('ALTER TABLE ' . $table . ' ADD COLUMN ' . $column . ' ' . $definition);
      } catch (Throwable $e) {
        // A column the server refuses to add is not worth failing the setup.
      }
    }
  }
}

/**
 * The settings table, which the first version of this file got wrong.
 *
 * It wrote `settings(name, value)`; the server's is `settings(setting_key,
 * value, updated_at)`. A database from that version is folded into the real
 * shape, keeping the values it already had.
 */
function repair_settings_table(PDO $pdo): void
{
  try {
    $columns = $pdo->query('SELECT * FROM settings LIMIT 1')->fetch();
  } catch (Throwable $e) {
    return; // No table yet.
  }
  if (!is_array($columns)) return;
  if (!array_key_exists('name', $columns) || array_key_exists('setting_key', $columns)) return;

  $rows = $pdo->query('SELECT name, value FROM settings')->fetchAll();
  $pdo->exec('DROP TABLE settings');
  foreach (schema_statements() as $statement) {
    try {
      $pdo->exec($statement);
    } catch (Throwable $e) {
      // A table that will not be created here fails loudly in the setup step.
    }
  }
  foreach ($rows as $row) {
    $pdo->prepare('INSERT INTO settings (setting_key, value, updated_at) VALUES (?, ?, ?)')
      ->execute([$row['name'], $row['value'], now_db()]);
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

function put_setting(string $name, string $value, ?PDO $pdo = null): void
{
  $pdo = $pdo ?? repo();
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

function count_users(): int
{
  $pdo = repo();
  return $pdo ? count_users_on($pdo) : 0;
}

function count_users_on(PDO $pdo): int
{
  try {
    return (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
  } catch (Throwable $e) {
    return 0;
  }
}

/** Whether the site is set up: the tables exist and something marks them. */
function installed(): bool
{
  $pdo = repo();
  if (!$pdo) return false;
  try {
    $pdo->query('SELECT setting_key FROM settings LIMIT 1')->fetchAll();
    $pdo->query('SELECT username FROM users LIMIT 1')->fetchAll();
  } catch (Throwable $e) {
    return false;
  }
  return count_users() > 0;
}

/* ── setup, once ────────────────────────────────────────────────────────── */

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

/**
 * A bcrypt hash the Node server can verify.
 *
 * PHP writes `$2y$`; the server's bcryptjs expects the modern `$2b$` spelling.
 * The two algorithms are identical — only the prefix differs — so the hash is
 * relabelled rather than re-encoded, which keeps the password exactly as typed.
 */
function password_hash_for_node(string $password): string
{
  $hash = password_hash($password, PASSWORD_BCRYPT);
  // A string edit, not a regex: in a replacement `$2` is a back-reference to a
  // group that does not exist, and it silently eats the marker.
  if (str_starts_with($hash, '$2y$')) $hash = '$2b$' . substr($hash, 4);
  return $hash;
}

/* ════════════════════════════════════════════════════════════════════════
 * Routes — setup only
 * ═══════════════════════════════════════════════════════════════════════ */

$route = route();
$verb = method();

/** A property of the deployment, not of a session: there is no session here. */
function refusal(string $route): void
{
  global $cfg;
  fail(
    sprintf(
      'This file only creates the database. The site\'s API is the Node server%s — nothing else is served from PHP on this deployment.',
      ' (' . (string) $cfg['apiUrl'] . ')'
    ),
    410,
    'setup-only'
  );
}

/**
 * "Is this file even running?" — answered in one request.
 *
 * The setup screen asks for this when none of the setup addresses answered, and
 * shows the result on the page. It is the difference between four very
 * different faults that all look the same from a browser:
 *
 *   the file is not there (404) · PHP is not running for the folder (the file
 *   downloads) · PHP is too old or missing an extension (an error) · the
 *   database is the thing that is wrong (this answers, the connect fails).
 *
 * Nothing secret is in the reply: no password, and no host or user at all once
 * the site is installed.
 */
if ($route === 'diag' && ($verb === 'GET' || $verb === 'POST')) {
  $ready = installed();
  $configFile = __DIR__ . '/php-config.php';
  $db = settings_for($cfg);

  $connect = null;
  if ($ready) {
    $connect = ['ok' => true, 'detail' => 'The database answered.'];
  } else {
    try {
      $pdo = connect($db);
      $pdo->query('SELECT 1')->fetchAll();
      $connect = ['ok' => true, 'detail' => 'Connected, but the tables are not installed yet.'];
    } catch (Throwable $e) {
      $connect = ['ok' => false, 'detail' => $e->getMessage()];
    }
  }

  // Table names the setup has created, so a half-finished install is obvious.
  $tables = [];
  try {
    $pdo = repo();
    if ($pdo) {
      if (pdo_driver($pdo) === 'sqlite') {
        $names = array_column($pdo->query("SELECT name FROM sqlite_master WHERE type = 'table'")->fetchAll(), 'name');
      } else {
        // SHOW TABLES returns one column with an unpredictable name; the first
        // key of the first row is what it is.
        $rows = $pdo->query('SHOW TABLES')->fetchAll();
        $names = [];
        foreach ($rows as $row) $names[] = (string) reset($row);
      }
      foreach (['users', 'settings', 'site_content', 'media', 'revisions', 'member_bikes', 'member_journeys', 'route_alerts', 'alert_reads', 'schema_migrations'] as $wanted) {
        $tables[$wanted] = in_array($wanted, $names, true);
      }
    }
  } catch (Throwable $e) {
    $tables = [];
  }

  json_out([
    'ok' => true,
    'what' => 'The PHP setup file is running.',
    'php' => PHP_VERSION,
    'sapi' => PHP_SAPI,
    'server' => $_SERVER['SERVER_SOFTWARE'] ?? '',
    'installed' => $ready,
    'configFile' => [
      'present' => is_file($configFile),
      'readable' => is_readable($configFile),
    ],
    'extensions' => [
      'pdo' => extension_loaded('pdo'),
      'pdo_mysql' => extension_loaded('pdo_mysql'),
      'pdo_sqlite' => extension_loaded('pdo_sqlite'),
      'mbstring' => extension_loaded('mbstring'),
      'json' => extension_loaded('json'),
    ],
    'folderWritable' => is_writable(__DIR__),
    'database' => $ready
      ? ['driver' => $db['driver'], 'connect' => $connect, 'tables' => $tables]
      : [
          'driver' => $db['driver'],
          'host' => $db['host'],
          'port' => $db['port'],
          'database' => $db['database'],
          'user' => $db['user'],
          'connect' => $connect,
          'tables' => $tables,
        ],
    'apiUrl' => (string) $cfg['apiUrl'],
  ]);
}

/* ── first visit ────────────────────────────────────────────────────────── */

if ($route === 'setup/status' && $verb === 'GET') {
  $ready = installed();
  $users = count_users();
  $db = settings_for($cfg);
  // Tables but no accounts: the database step is done and the owner is next.
  $tablesExist = false;
  if ($pdo = repo()) {
    try {
      $pdo->query('SELECT username FROM users LIMIT 1')->fetchAll();
      $tablesExist = true;
    } catch (Throwable $e) {
      $tablesExist = false;
    }
  }
  $savedTitle = setting('site_title');
  $decodedTitle = $savedTitle === null ? null : json_decode($savedTitle, true);
  json_out([
    'installed' => $ready,
    'needsOwner' => $tablesExist && $users === 0,
    'databaseReady' => $tablesExist,
    'users' => $users,
    'siteTitle' => is_string($decodedTitle) && trim($decodedTitle) !== '' ? $decodedTitle : $cfg['siteTitle'],
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
    // Which program answers the next request after setup. The screen says it
    // in as many words: PHP stops here.
    'engine' => 'php-setup',
    'apiUrl' => (string) $cfg['apiUrl'],
  ]);
}

if ($route === 'setup/test' && $verb === 'POST') {
  if (installed()) {
    fail('This site is already set up. The API is the Node server — nothing here needs testing again.', 409, 'setup-only');
  }
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
    $pdo->query('SELECT 1')->fetchAll();
  } catch (Throwable $e) {
    fail('The database could not be opened: ' . $e->getMessage(), 400);
  }
  if (count_users_on($pdo) > 0) {
    fail('This site is already set up. Sign in through the Node API — the dashboard is not served by PHP.', 409, 'setup-only');
  }
  try {
    repair_settings_table($pdo);
    foreach (schema_statements() as $statement) $pdo->exec($statement);
    // A database an earlier setup created keeps its narrow tables: the columns
    // the server writes are added here, so "Create tables" is a repair too.
    ensure_columns($pdo);
  } catch (Throwable $e) {
    fail('The tables could not be created: ' . $e->getMessage(), 500);
  }
  $title = trim((string) (body()['siteTitle'] ?? ''));
  if ($title !== '') put_setting('site_title', (string) json_encode($title), $pdo);
  put_setting('schema_version', (string) SCHEMA_VERSION, $pdo);
  try {
    $pdo->prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      ->execute([SCHEMA_VERSION, 'php setup', now_db()]);
  } catch (Throwable $e) {
    // Already recorded.
  }
  $users = count_users_on($pdo);
  json_out([
    'ok' => true,
    'siteTitle' => $title !== '' ? $title : $cfg['siteTitle'],
    'createdDatabase' => false,
    'users' => $users,
    'needsOwner' => $users === 0,
    'next' => $users === 0 ? 'owner' : 'login',
    'apiUrl' => (string) $cfg['apiUrl'],
  ], 201);
}

if ($route === 'setup/owner' && $verb === 'POST') {
  $input = body();
  $pdo = repo();
  if (!$pdo) fail('Finish the database step first.', 409);
  repair_settings_table($pdo);
  try {
    foreach (schema_statements() as $statement) $pdo->exec($statement);
  } catch (Throwable $e) {
    // Already there.
  }
  ensure_columns($pdo);
  if (count_users_on($pdo) > 0) {
    fail('This site already has its owner account. Sign in through the Node API instead.', 409, 'setup-only');
  }

  $username = mb_strtolower(trim((string) ($input['username'] ?? '')));
  $password = (string) ($input['password'] ?? '');
  $email = trim((string) ($input['email'] ?? ''));
  if ($problem = username_problem($username)) fail($problem);
  if ($problem = password_problem($password)) fail($problem);

  $pdo->prepare('INSERT INTO users (username, email, password_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, 0, ?)')
    ->execute([
      $username,
      $email !== '' ? $email : null,
      password_hash_for_node($password),
      'owner',
      now_db(),
    ]);
  $id = (int) $pdo->lastInsertId();
  $statement = $pdo->prepare('SELECT id, username, email, role, disabled, created_at FROM users WHERE id = ?');
  $statement->execute([$id]);
  $row = $statement->fetch();

  json_out([
    'user' => [
      'id' => (int) $row['id'],
      'username' => $row['username'],
      'email' => $row['email'] ?: null,
      'role' => $row['role'],
      'disabled' => (int) $row['disabled'] === 1,
      'createdAt' => to_iso($row['created_at']),
      'lastLoginAt' => null,
    ],
    // No session is created here — PHP never signs anybody in. The screen sends
    // the person to the API, which is where the sign-in happens.
    'apiUrl' => (string) $cfg['apiUrl'],
    'signInAt' => (string) $cfg['apiUrl'] . '/api/auth/login',
  ], 201);
}

/* Anything else is not this file's job — and never was. */
refusal($route);
