/**
 * Shows where the database is and what a migration would do to it.
 *
 *   npm run db:status
 *
 * Read-only: it connects, prints the installed and latest schema versions and
 * the name of every migration that has not run yet, then closes the connection.
 */
import mysql from "mysql2/promise";
import { config } from "../config.js";
import { connectionOptions } from "../lib/installer.js";
import { migrationStatus } from "../db/schema.js";


async function main() {
  if (config.dbDriver === "sqlite") {
    const { DatabaseSync } = await import("node:sqlite");
    const { SQLITE_FILE } = await import("../db/sqlite.js");
    const { SQLITE_VERSION, SQLITE_MIGRATIONS } = await import("../db/sqliteMigrations.js");
    const db = new DatabaseSync(SQLITE_FILE, { readOnly: true });
    try {
      const installed = Number(db.prepare("SELECT COALESCE(MAX(version),0) AS v FROM pb_schema_migrations").get().v);
      console.log(`[db:status] SQLite installed v${installed}, latest v${SQLITE_VERSION}`);
      for (const m of SQLITE_MIGRATIONS.filter(m => m.version > installed)) console.log(`  v${m.version} ${m.name}`);
    } finally { db.close(); }
    return;
  }

  if (config.dbDriver === "memory") {
    console.log("[db:status] the in-memory driver has no database to inspect.");
    return;
  }
  if (!config.hasDatabase) {
    console.log("[db:status] no database configured yet — open the setup screen first.");
    return;
  }

  const connection = await mysql.createConnection(connectionOptions(config.db, { withDatabase: true }));
  try {
    const { installed, latest, pending } = await migrationStatus(connection);
    console.log(`[db:status] installed v${installed}, latest v${latest}`);
    if (pending.length === 0) {
      console.log("[db:status] nothing to do — the database is up to date.");
      return;
    }
    console.log(`[db:status] ${pending.length} migration(s) waiting:`);
    for (const migration of pending) {
      console.log(`  v${migration.version}  ${migration.name}`);
    }
    console.log("[db:status] apply them with `npm run db:migrate` (or restart the server).");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("[db:status] failed:", error.message);
  if (error.code === "ER_ACCESS_DENIED_ERROR") {
    console.error("Check DB_USER / DB_PASSWORD in .env (or the environment variables).");
  }
  if (error.code === "ER_BAD_DB_ERROR") {
    console.error("That database does not exist. Create it in your hosting panel first.");
  }
  process.exit(1);
});
