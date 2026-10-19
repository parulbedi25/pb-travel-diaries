/**
 * Applies the schema to the database named in `.env` (or in the answers the
 * setup screen saved).
 *
 *   npm run db:init
 *
 * The first-run setup screen does the same thing from the browser, so this is
 * only for command-line installs and for upgrades. Safe to run repeatedly: the
 * schema module creates what is missing and applies pending migrations.
 */
import mysql from "mysql2/promise";
import { config } from "../config.js";
import { applySchema } from "../db/schema.js";

async function main() {
  const { database, host, port, user, password, socketPath } = config.db;
  // Plain connection options: pool-only keys (connectionLimit) belong to the
  // server, not to this one-off script.
  const connection = {
    host,
    port,
    user,
    password,
    ...(socketPath ? { socketPath } : {}),
  };

  console.log(`[db:init] host ${socketPath || `${host}:${port}`} as ${user}`);
  const admin = await mysql.createConnection(connection);
  try {
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, "")}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    console.log(`[db:init] database "${database}" ready`);
  } catch (error) {
    // Shared hosting usually refuses CREATE DATABASE; the database is then made
    // outside the app. Continue and let the schema import speak for itself.
    console.log(`[db:init] could not create the database (${error.code}); assuming it exists`);
  } finally {
    await admin.end();
  }

  const conn = await mysql.createConnection({ ...connection, database });
  try {
    const result = await applySchema(conn);
    console.log(
      `[db:init] schema v${result.version} applied` +
        (result.upgradedFrom ? ` (upgraded from v${result.upgradedFrom})` : ""),
    );
    const [tables] = await conn.query("SHOW TABLES");
    console.log("[db:init] tables:", Object.values(tables).map((r) => Object.values(r)[0]).join(", "));
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error("[db:init] failed:", error.message);
  if (error.code === "ER_ACCESS_DENIED_ERROR") {
    console.error("Check DB_USER / DB_PASSWORD in .env (or the panel's environment variables).");
  }
  if (error.code === "ER_BAD_DB_ERROR") {
    console.error("The database does not exist. Create it in your hosting panel (MySQL / MariaDB → Databases) first.");
  }
  if (error.code === "ECONNREFUSED") {
    console.error("Nothing is listening on that host/port. On shared hosting try DB_SOCKET.");
  }
  process.exit(1);
});
