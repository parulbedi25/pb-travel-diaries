/** SQLite has its own append-only migration ledger; never edit shipped entries. */
const timestamp = "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
export const SQLITE_MIGRATIONS = [{
  version: 1,
  name: "initial SQLite schema",
  statements: [
    `CREATE TABLE site_content (id INTEGER PRIMARY KEY CHECK(id=1), content TEXT NOT NULL, updated_at ${timestamp}, updated_by TEXT)`,
    `CREATE TABLE revisions (id TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', content TEXT NOT NULL, created_at ${timestamp}, created_by TEXT)`,
    `CREATE INDEX revisions_created ON revisions(created_at)`,
    `CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL COLLATE NOCASE UNIQUE, email TEXT COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'reader' CHECK(role IN ('owner','admin','reader')), disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)), created_at ${timestamp}, last_login_at TEXT, disabled_at TEXT)`,
    `CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at ${timestamp}, expires_at TEXT NOT NULL, ip TEXT, user_agent TEXT)`,
    `CREATE INDEX sessions_user ON sessions(user_id)`,
    `CREATE INDEX sessions_expiry ON sessions(expires_at)`,
    `CREATE TABLE auth_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT NOT NULL, event TEXT NOT NULL, ip TEXT, user_agent TEXT, detail TEXT, created_at ${timestamp})`,
    `CREATE INDEX auth_events_created ON auth_events(created_at)`,
    `CREATE INDEX auth_events_user ON auth_events(user_id)`,
    `CREATE TABLE media (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL, mime TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'other', ext TEXT NOT NULL DEFAULT '', created_at ${timestamp}, created_by TEXT)`,
    `CREATE INDEX media_created ON media(created_at)`,
    `CREATE TABLE settings (setting_key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at ${timestamp})`,
    `INSERT INTO settings (setting_key,value) VALUES ('theme','"dark"'),('schema_version','1')`,
  ],
}, {
  version: 2,
  name: "the bike is Taskeen, not Taweel",
  // Same rename as the MySQL side: the machine's name is stored inside the
  // saved site document, so it is rewritten here rather than left for the
  // owner to retype in the dashboard. The long sentence goes first so the
  // blanket swap cannot leave "तस्कीन means long" behind. Revisions keep the
  // name they were saved with — they are history.
  statements: [
    `UPDATE site_content SET content = replace(content, 'Named for the long roads out of Nangal Dam — طویل means long', 'Named for the calm of the long roads out of Nangal Dam — तस्कीन means peace of mind')`,
    `UPDATE site_content SET content = replace(content, 'طویل', 'तस्कीन')`,
    `UPDATE site_content SET content = replace(content, 'Taweel', 'Taskeen')`,
  ],
}];
export const SQLITE_VERSION = SQLITE_MIGRATIONS.at(-1).version;
export function migrateSqlite(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("CREATE TABLE IF NOT EXISTS pb_schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    const from = Number(db.prepare("SELECT COALESCE(MAX(version),0) AS v FROM pb_schema_migrations").get().v);
    if (from > SQLITE_VERSION) throw new Error("This SQLite database needs a newer application version.");
    const applied = [];
    for (const m of SQLITE_MIGRATIONS.filter(m => m.version > from)) {
      for (const statement of m.statements) db.exec(statement);
      db.prepare("INSERT INTO pb_schema_migrations VALUES (?, ?)").run(m.version, m.name);
      applied.push(m.version);
    }
    db.exec("COMMIT");
    return { version: SQLITE_VERSION, upgradedFrom: from, applied };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
