<?php
/**
 * The site's own API, in PHP, for hosts that run PHP but not Node.
 *
 * A static folder cannot talk to a database: nothing on the server executes,
 * and a browser has no MySQL client. PHP does execute — this host runs it — so
 * the same folder can carry a small API that opens the database, and the site
 * behaves like the Node version: first visit shows the setup screen, "Test
 * connection" really connects, "Create tables" really creates them, and the
 * owner account really exists afterwards.
 *
 * The database password lives in `php-config.php` beside this file. That is safe
 * in a way a `.env` in a web root is not: PHP is *executed* by the server, so
 * its source is never served — whereas a `.env` is a plain file anyone can
 * download. `php-config.php` therefore must keep its `.php` extension.
 *
 * Routes match the Node server exactly, so the built page needs no changes:
 * `/api/setup/status`, `/api/setup/test`, `/api/setup/database`,
 * `/api/setup/owner`, `/api/content`, `/api/settings/*`, `/api/auth/*`.
 *
 * Written against PDO so the same file serves MySQL and SQLite; MySQL is what
 * shared hosting offers.
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
];

const SCHEMA_VERSION = 1;

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
  // A test harness has no request body to read, so it names a file to use
  // instead. This is a server-side environment variable, so a visitor cannot
  // set it; a real request always arrives with its body in php://input.
  if (($raw === false || $raw === '') && getenv('PB_BODY_FILE')) {
    $raw = (string) file_get_contents(getenv('PB_BODY_FILE'));
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
  $route = $at === false ? '' : substr($path, $at + 5);
  return trim($route, '/');
}

function method(): string
{
  return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

/** Now, in the format the page's content rows carry. */
function online_now(): string
{
  return gmdate('Y-m-d\TH:i:s\Z');
}

/* ── the database ───────────────────────────────────────────────────────── */

function settings_for(array $cfg, ?array $given = null): array
{
  // A request may name a different host/user/database than the baked one — the
  // setup screen exists so those can be corrected on the server. A password is
  // the exception: an empty field means "use the one already configured", which
  // is how the form can be pre-filled without ever sending the password to a
  // browser.
  $given = $given ?? [];
  $pick = static function (string $key, $fallback) use ($given) {
    $value = $given[$key] ?? null;
    if (is_string($value) && trim($value) !== '') return trim($value);
    return $fallback;
  };
  $password = $given['password'] ?? '';
  return [
    'driver' => $cfg['driver'],
    'host' => $pick('host', $cfg['host']),
    'port' => (int) $pick('port', $cfg['port']),
    'database' => $pick('database', $cfg['database']),
    'user' => $pick('user', $cfg['user']),
    'password' => is_string($password) && $password !== '' ? $password : $cfg['password'],
    'socket' => $pick('socketPath', $cfg['socket']),
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

/** The site's repository, or null when it is not set up yet. */
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

function table_statements(): array
{
  global $cfg;
  $mysql = $cfg['driver'] !== 'sqlite';
  $id = $mysql ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  $text = $mysql ? 'LONGTEXT' : 'TEXT';

  $statements = [
    "CREATE TABLE IF NOT EXISTS users (
       id $id,
       username VARCHAR(64) NOT NULL UNIQUE,
       email VARCHAR(190) NULL,
       password_hash VARCHAR(255) NOT NULL,
       role VARCHAR(16) NOT NULL DEFAULT 'reader',
       disabled TINYINT NOT NULL DEFAULT 0,
       created_at VARCHAR(32) NOT NULL
     )",
    "CREATE TABLE IF NOT EXISTS settings (
       name VARCHAR(64) PRIMARY KEY,
       value $text NOT NULL
     )",
    "CREATE TABLE IF NOT EXISTS site_content (
       id INT NOT NULL,
       content $text NOT NULL,
       updated_at VARCHAR(32) NOT NULL,
       updated_by VARCHAR(64) NOT NULL,
       PRIMARY KEY (id)
     )",
    "CREATE TABLE IF NOT EXISTS revisions (
       id VARCHAR(64) PRIMARY KEY,
       description VARCHAR(255) NOT NULL,
       content $text NOT NULL,
       created_at VARCHAR(32) NOT NULL,
       created_by VARCHAR(64) NOT NULL
     )",
    "CREATE TABLE IF NOT EXISTS auth_events (
       id $id,
       username VARCHAR(64) NULL,
       event VARCHAR(32) NOT NULL,
       detail VARCHAR(255) NOT NULL DEFAULT '',
       created_at VARCHAR(32) NOT NULL
     )",
  ];
  return $statements;
}

function create_tables(PDO $pdo): void
{
  foreach (table_statements() as $statement) {
    $pdo->exec($statement);
  }
  $exists = $pdo->prepare('SELECT COUNT(*) FROM settings WHERE name = ?');
  $exists->execute(['schema_version']);
  if (!$exists->fetchColumn()) {
    $insert = $pdo->prepare('INSERT INTO settings (name, value) VALUES (?, ?)');
    $insert->execute(['schema_version', (string) SCHEMA_VERSION]);
  }
}

function setting(string $name): ?string
{
  $pdo = repo();
  if (!$pdo) return null;
  try {
    $statement = $pdo->prepare('SELECT value FROM settings WHERE name = ?');
    $statement->execute([$name]);
    $value = $statement->fetchColumn();
  } catch (Throwable $e) {
    // Before the tables exist there is nothing to read, and that is not an
    // error: it is the state the setup screen is for.
    return null;
  }
  return $value === false ? null : (string) $value;
}

function put_setting(string $name, string $value): void
{
  $pdo = repo();
  if (!$pdo) return;
  $sql = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite'
    ? 'INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value'
    : 'INSERT INTO settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)';
  try {
    $pdo->prepare($sql)->execute([$name, $value]);
  } catch (Throwable $e) {
    // No tables yet: nothing to remember, and the caller is mid-setup anyway.
  }
}

/**
 * Whether the site's tables are there.
 *
 * The database opening is not the same as being set up: an empty database opens
 * perfectly and has nothing in it, which is exactly the state the setup screen
 * exists for. Asking for the schema marker is the honest test.
 */
function tables_exist(): bool
{
  $pdo = repo();
  if (!$pdo) return false;
  try {
    $pdo->query('SELECT name FROM settings WHERE name = \'schema_version\'')->fetchAll();
    return true;
  } catch (Throwable $e) {
    return false;
  }
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
  ];
}

function current_user(): ?array
{
  session_start_once();
  $id = $_SESSION['user_id'] ?? null;
  if (!$id) return null;
  $pdo = repo();
  if (!$pdo) return null;
  $statement = $pdo->prepare('SELECT * FROM users WHERE id = ?');
  $statement->execute([$id]);
  $row = $statement->fetch();
  if (!$row || (int) $row['disabled'] === 1) return null;
  return $row;
}

function require_editor(): array
{
  $user = current_user();
  if (!$user) fail('Sign in to continue.', 401);
  if (!in_array($user['role'], ['owner', 'admin'], true)) {
    fail('Your account can read the site but not change it.', 403);
  }
  return $user;
}

function sign_in(array $row): void
{
  session_start_once();
  session_regenerate_id(true);
  $_SESSION['user_id'] = (int) $row['id'];
}

/* ── routes ─────────────────────────────────────────────────────────────── */

$route = route();
$method = method();

/* First visit: what does this deployment need? */
if ($route === 'setup/status' && $method === 'GET') {
  $ready = tables_exist();
  $installed = $ready;
  $users = $ready ? count_users() : 0;
  $error = null;
  $db = settings_for($cfg);
  json_out([
    'installed' => $installed,
    'needsOwner' => $installed && $users === 0,
    'databaseReady' => $installed,
    'users' => $users,
    'siteTitle' => setting('site_title') !== null
      ? (json_decode(setting('site_title') ?: '""', true) ?: $cfg['siteTitle'])
      : $cfg['siteTitle'],
    // Filled in, so the form arrives already describing this server's database.
    // The password is the one thing never sent: the field may be left blank and
    // the server uses the stored one.
    'db' => [
      'driver' => $db['driver'],
      'host' => $db['host'],
      'port' => $db['port'],
      'database' => $db['database'],
      'user' => $db['user'],
      'socketPath' => $db['socket'],
      'passwordStored' => $db['password'] !== '',
    ],
    'setupLocked' => $installed,
    'restoreAllowed' => false,
    'error' => $error,
    'mode' => 'installer',
    'engine' => 'php',
  ]);
}

/* "Test connection" — proves the details without changing anything. */
if ($route === 'setup/test' && $method === 'POST') {
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

/* Step 1: create every table. */
if ($route === 'setup/database' && $method === 'POST') {
  $db = settings_for($cfg, body());
  try {
    $pdo = connect($db);
  } catch (Throwable $e) {
    fail('The database could not be opened: ' . $e->getMessage(), 400);
  }
  try {
    create_tables($pdo);
  } catch (Throwable $e) {
    fail('The tables could not be created: ' . $e->getMessage(), 500);
  }
  // Remembered here as well as in php-config.php, so the site title survives a
  // redeploy of the folder.
  $title = trim((string) (body()['siteTitle'] ?? ''));
  if ($title !== '') put_setting('site_title', json_encode($title, JSON_UNESCAPED_UNICODE));
  $users = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
  json_out([
    'ok' => true,
    'siteTitle' => $title !== '' ? $title : $cfg['siteTitle'],
    'createdDatabase' => false,
    'users' => $users,
    'needsOwner' => $users === 0,
    'next' => $users === 0 ? 'owner' : 'login',
  ], 201);
}

/* Step 2: the owner account. */
if ($route === 'setup/owner' && $method === 'POST') {
  $input = body();
  $pdo = repo();
  if (!$pdo) fail('Finish the database step first.', 409);
  if (count_users() > 0) fail('This site already has its owner account. Sign in instead.', 409);

  $username = strtolower(trim((string) ($input['username'] ?? '')));
  $password = (string) ($input['password'] ?? '');
  $email = trim((string) ($input['email'] ?? ''));

  if (!preg_match('/^[a-z0-9._-]{3,32}$/', $username)) {
    fail('A username is 3 to 32 letters, numbers, dots, dashes or underscores.', 400);
  }
  if (strlen($password) < 8 || !preg_match('/[a-z]/i', $password) || !preg_match('/[0-9]/', $password)) {
    fail('Use at least 8 characters with a letter and a number.', 400);
  }

  $statement = $pdo->prepare(
    'INSERT INTO users (username, email, password_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, 0, ?)'
  );
  $statement->execute([$username, $email !== '' ? $email : null, password_hash($password, PASSWORD_DEFAULT), 'owner', online_now()]);
  $id = (int) $pdo->lastInsertId();

  $pdo->prepare('INSERT INTO auth_events (username, event, detail, created_at) VALUES (?, ?, ?, ?)')
    ->execute([$username, 'signup', 'Owner account created by the setup screen', online_now()]);

  $statement = $pdo->prepare('SELECT * FROM users WHERE id = ?');
  $statement->execute([$id]);
  $row = $statement->fetch();
  sign_in($row);
  json_out(['user' => public_user($row)], 201);
}

/* Sign in and out. */
if ($route === 'auth/login' && $method === 'POST') {
  $input = body();
  $pdo = repo();
  if (!$pdo) fail('The database is not set up yet.', 503);
  $statement = $pdo->prepare('SELECT * FROM users WHERE username = ?');
  $statement->execute([strtolower(trim((string) ($input['username'] ?? '')))]);
  $row = $statement->fetch();
  if (!$row || !password_verify((string) ($input['password'] ?? ''), $row['password_hash'])) {
    fail('That username and password do not match an account.', 401);
  }
  if ((int) $row['disabled'] === 1) fail('This account has been switched off.', 403);
  sign_in($row);
  json_out(['user' => public_user($row)]);
}

if ($route === 'auth/status' && $method === 'GET') {
  $row = current_user();
  json_out([
    'users' => count_users(),
    'signedIn' => $row !== null,
    'user' => $row ? public_user($row) : null,
    'allowSignup' => false,
  ]);
}

if ($route === 'auth/logout' && $method === 'POST') {
  session_start_once();
  $_SESSION = [];
  session_destroy();
  json_out(['ok' => true]);
}

/* The published site. */
if ($route === 'content' && $method === 'GET') {
  $pdo = repo();
  if (!$pdo) json_out(['content' => null, 'updatedAt' => null, 'updatedBy' => null]);
  try {
    $statement = $pdo->query('SELECT content, updated_at, updated_by FROM site_content WHERE id = 1');
    $row = $statement->fetch();
  } catch (Throwable $e) {
    json_out(['content' => null, 'updatedAt' => null, 'updatedBy' => null]);
  }
  if (!$row) json_out(['content' => null, 'updatedAt' => null, 'updatedBy' => null]);
  json_out([
    'content' => json_decode($row['content'], true),
    'updatedAt' => $row['updated_at'],
    'updatedBy' => $row['updated_by'],
  ]);
}

if ($route === 'content' && $method === 'PUT') {
  $user = require_editor();
  $pdo = repo();
  $input = body();
  $content = $input['content'] ?? null;
  if (!is_array($content) || !isset($content['sections'])) {
    fail('Expected a site content object.', 400);
  }
  $serialised = json_encode($content, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  if ($serialised === false) fail('That content could not be stored.', 400);
  if (strlen($serialised) > 8000000) fail('That site snapshot is too large to store.', 413);

  $description = trim((string) ($input['description'] ?? '')) ?: 'Website update';
  $revisionId = trim((string) ($input['revisionId'] ?? '')) ?: 'rev-' . time();

  $sqlite = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
  $save = $sqlite
    ? 'INSERT INTO site_content (id, content, updated_at, updated_by) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at, updated_by = excluded.updated_by'
    : 'INSERT INTO site_content (id, content, updated_at, updated_by) VALUES (1, ?, ?, ?)
       ON DUPLICATE KEY UPDATE content = VALUES(content), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)';
  $pdo->prepare($save)->execute([$serialised, online_now(), $user['username']]);

  $pdo->prepare('INSERT INTO revisions (id, description, content, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
    ->execute([$revisionId, mb_substr($description, 0, 255), $serialised, online_now(), $user['username']]);

  json_out(['ok' => true, 'updatedAt' => online_now(), 'updatedBy' => $user['username']]);
}

/** A setting in the shape the page expects: a JSON value. */
function setting_json(string $name, $fallback)
{
  $raw = setting($name);
  if ($raw === null) return $fallback;
  $value = json_decode($raw, true);
  return $value === null ? $fallback : $value;
}

if ($route === 'settings/theme' && $method === 'GET') {
  $theme = setting_json('theme', 'dark');
  json_out(['theme' => in_array($theme, ['dark', 'light'], true) ? $theme : 'dark']);
}

if ($route === 'settings/theme' && $method === 'PUT') {
  require_editor();
  $theme = (string) (body()['theme'] ?? '');
  if (!in_array($theme, ['dark', 'light'], true)) fail('Theme must be dark or light.', 400);
  put_setting('theme', json_encode($theme));
  json_out(['ok' => true, 'theme' => $theme]);
}

if ($route === 'settings/site' && $method === 'GET') {
  global $cfg;
  $title = setting_json('site_title', $cfg['siteTitle']);
  json_out(['title' => is_string($title) && trim($title) !== '' ? $title : $cfg['siteTitle'], 'allowSignup' => false]);
}

if ($route === 'settings/site' && $method === 'PUT') {
  require_editor();
  global $cfg;
  $title = trim((string) (body()['title'] ?? ''));
  if ($title !== '') {
    if (mb_strlen($title) > 120) fail('Keep the site title under 120 characters.', 400);
    put_setting('site_title', json_encode($title, JSON_UNESCAPED_UNICODE));
  }
  $saved = setting_json('site_title', $cfg['siteTitle']);
  json_out(['ok' => true, 'title' => $saved, 'allowSignup' => false]);
}

/* The dashboard asks for these on load; empty answers keep it quiet on a
   deployment whose history and media live on the other server. */
if ($route === 'revisions' && $method === 'GET') {
  $pdo = repo();
  $rows = [];
  if ($pdo) {
    try {
      $rows = $pdo->query('SELECT id, description, created_at, created_by FROM revisions ORDER BY created_at DESC LIMIT 50')->fetchAll();
    } catch (Throwable $e) {
      $rows = [];
    }
  }
  json_out(['revisions' => array_map(static fn ($row) => [
    'id' => $row['id'],
    'description' => $row['description'],
    'createdAt' => $row['created_at'],
    'createdBy' => $row['created_by'],
  ], $rows)]);
}

if ($route === 'media' && $method === 'GET') {
  json_out(['media' => []]);
}

if ($route === 'backups' && $method === 'GET') {
  json_out(['backups' => [], 'enabled' => false, 'last' => null]);
}

fail('This deployment has no such endpoint: /' . $route, 404);
