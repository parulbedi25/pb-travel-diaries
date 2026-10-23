/**
 * Applies every pending migration and prints what it did.
 *
 *   npm run db:migrate
 *
 * The server does the same thing at boot, so this is for a deploy script, a
 * maintenance window, or simply for looking at the result before restarting.
 * Running it twice is safe: applied versions live in `schema_migrations` and
 * are skipped.
 */
import mysql from "mysql2/promise";
import { config } from "../config.js";
import { connectionOptions } from "../lib/installer.js";
import { applySchema } from "../db/schema.js";


async function main() {
  if (config.dbDriver === "sqlite") {
    const { getRepo, closeRepo } = await import("../db/index.js");
    try { console.log("[db] SQLite migrations:", await (await getRepo()).migrate()); }
    finally { await closeRepo(); }
    return;
  }

  if (config.dbDriver === "memory") {
    console.log("[db:migrate] the in-memory driver starts empty on every boot — nothing to do.");
    return;
  }
  if (!config.hasDatabase) {
    console.log("[db:migrate] no database configured yet — open the setup screen first.");
    return;
  }

  const connection = await mysql.createConnection(connectionOptions(config.db, { withDatabase: true }));
  try {
    const result = await applySchema(connection);
    if (result.applied.length === 0) {
      console.log(`[db:migrate] already at v${result.version} — nothing to apply.`);
      return;
    }
    console.log(
      `[db:migrate] applied ${result.applied.map((v) => `v${v}`).join(", ")} ` +
        `— now at v${result.version} (was v${result.upgradedFrom}).`,
    );
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("[db:migrate] failed:", error.message);
  if (error.code === "ER_ACCESS_DENIED_ERROR") {
    console.error("Check DB_USER / DB_PASSWORD in .env (or the environment variables).");
  }
  if (error.code === "ER_BAD_DB_ERROR") {
    console.error("That database does not exist. Create it in your hosting panel first.");
  }
  process.exit(1);
});
