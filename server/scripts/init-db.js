/**
 * Applies server/schema.sql to the configured database.
 *
 *   npm run db:init
 *
 * Safe to run repeatedly: every statement is CREATE TABLE IF NOT EXISTS or
 * INSERT IGNORE. It creates the database itself if the user is allowed to.
 */
import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { config } from "../config.js";

const schemaPath = path.join(config.root, "server", "schema.sql");

async function main() {
  const sql = await fs.readFile(schemaPath, "utf8");
  const { database, host, port, user, password, socketPath } = config.db;
  // Plain connection options: pool-only keys (connectionLimit) belong to the
  // server, not to this one-off script.
  const connection = { host, port, user, password, ...(socketPath ? { socketPath } : {}) };

  console.log(`[db:init] host ${host}:${port} as ${user}`);
  const admin = await mysql.createConnection(connection);
  try {
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, "")}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    console.log(`[db:init] database "${database}" ready`);
  } catch (error) {
    // Shared hosting usually refuses CREATE DATABASE; the database is then made
    // in cPanel first. Continue and let the schema import speak for itself.
    console.log(`[db:init] could not create the database (${error.code}); assuming it exists`);
  } finally {
    await admin.end();
  }

  const conn = await mysql.createConnection({ ...connection, database, multipleStatements: true });
  try {
    await conn.query(sql);
    console.log("[db:init] schema applied");
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
  if (error.code === "ECONNREFUSED") {
    console.error("Nothing is listening on that host/port. On shared hosting try DB_SOCKET.");
  }
  process.exit(1);
});
