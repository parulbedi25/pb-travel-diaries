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
