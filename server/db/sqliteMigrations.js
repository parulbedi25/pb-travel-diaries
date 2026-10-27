/** SQLite has its own append-only migration ledger; never edit shipped entries. */
import { isAlreadyApplied } from "./migrationErrors.js";
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
  name: "the bike is Taskeen, written تسکین",
  // Same rename as the MySQL side: the machine's name is stored inside the
  // saved site document, so it is rewritten here rather than left for the
  // owner to retype in the dashboard. The subtext sentence goes first so the
  // blanket swaps cannot leave "تسکین means long" behind, and the Devanagari
  // spelling is swept up in case a document was saved while it was in use.
  // Revisions keep the name they were saved with — they are history.
  statements: [
    `UPDATE site_content SET content = replace(content, 'Named for the long roads out of Nangal Dam — طویل means long', 'Named for the calm of the long roads out of Nangal Dam — تسکین means peace of mind')`,
    `UPDATE site_content SET content = replace(content, 'Named for the calm of the long roads out of Nangal Dam — तस्कीन means peace of mind', 'Named for the calm of the long roads out of Nangal Dam — تسکین means peace of mind')`,
    `UPDATE site_content SET content = replace(content, 'طویل', 'تسکین')`,
    `UPDATE site_content SET content = replace(content, 'तस्कीन', 'تسکین')`,
    `UPDATE site_content SET content = replace(content, 'Taweel', 'Taskeen')`,
  ],
}, {
  version: 3,
  name: "member garages and journeys",
  // Same two tables as the MySQL side (migration 5), in SQLite's spelling.
  // They belong to a member and nothing else reads them: the site's own
  // content, the admin dashboard and the public pages are untouched.
  statements: [
    `CREATE TABLE IF NOT EXISTS member_bikes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, maker TEXT NOT NULL, model TEXT NOT NULL, year INTEGER, mileage_kmpl REAL, mileage_source TEXT NOT NULL DEFAULT 'manual', created_at ${timestamp})`,
    `CREATE INDEX IF NOT EXISTS member_bikes_user ON member_bikes(user_id)`,
    `CREATE TABLE IF NOT EXISTS member_journeys (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL DEFAULT '', bike_id INTEGER, stops TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '', gallery TEXT NOT NULL DEFAULT '[]', round_trip INTEGER NOT NULL DEFAULT 0, created_at ${timestamp}, updated_at ${timestamp})`,
    `CREATE INDEX IF NOT EXISTS member_journeys_user ON member_journeys(user_id)`,
  ],
}, {
  version: 4,
  name: "member garage lookups",
  // The same index the MySQL side adds in version 6: finding the rides that
  // used a bike, before the bike can be removed.
  statements: [
    `CREATE INDEX IF NOT EXISTS member_journeys_bike ON member_journeys(bike_id)`,
  ],
}, {
  version: 5,
  name: "media tags",
  // The same column as the MySQL side's version 7. SQLite can add a column
  // with a constant default in place, so no table rebuild is needed.
  statements: [
    `ALTER TABLE media ADD COLUMN tags TEXT NOT NULL DEFAULT ''`,
  ],
}];
export const SQLITE_VERSION = SQLITE_MIGRATIONS.at(-1).version;

/**
 * What an upgrade would do to a SQLite database, without doing it.
 *
 * Read-only and used by `npm run db:status`, `db:migrate --dry-run` and the
 * health endpoint, so an operator can see the gap between the code and the
 * database before anything changes.
 */
export function sqliteMigrationStatus(db) {
  let installed = 0;
  try {
    const row = db.prepare("SELECT COALESCE(MAX(version),0) AS v FROM pb_schema_migrations").get();
    installed = Number(row?.v ?? 0);
  } catch {
    installed = 0;
  }
  return {
    installed,
    latest: SQLITE_VERSION,
    pending: SQLITE_MIGRATIONS.filter((m) => m.version > installed).map((m) => ({
      version: m.version,
      name: m.name,
      statements: m.statements.length,
    })),
  };
}
export function migrateSqlite(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("CREATE TABLE IF NOT EXISTS pb_schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    const from = Number(db.prepare("SELECT COALESCE(MAX(version),0) AS v FROM pb_schema_migrations").get().v);
    if (from > SQLITE_VERSION) throw new Error("This SQLite database needs a newer application version.");
    const applied = [];
    for (const m of SQLITE_MIGRATIONS.filter(m => m.version > from)) {
      // A statement that is already in place is not a failure: an interrupted
      // migration is resumed by re-running it, and the first statements will
      // meet their own work. See migrationErrors.js.
      for (const statement of m.statements) {
        try {
          db.exec(statement);
        } catch (error) {
          if (!isAlreadyApplied(error)) throw error;
        }
      }
      db.prepare("INSERT OR IGNORE INTO pb_schema_migrations VALUES (?, ?)").run(m.version, m.name);
      applied.push(m.version);
    }
    db.exec("COMMIT");
    return { version: SQLITE_VERSION, upgradedFrom: from, applied };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
