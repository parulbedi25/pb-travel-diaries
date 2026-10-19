/**
 * Writes a backup immediately, outside the daily schedule.
 *
 *   npm run backup:now
 *
 * Useful before an upgrade, or from a cron job if the hosting plan restarts
 * the app often enough that the built-in timer never reaches its hour. The
 * archive is the same one the dashboard's "Back up now" button produces.
 */
import { config } from "../config.js";
import { closeRepo, getRepo } from "../db/index.js";
import { createBackup, listBackups } from "../lib/backup.js";

async function main() {
  if (!config.hasDatabase && config.dbDriver !== "memory") {
    console.error("[backup] no database configured yet — open the setup screen first.");
    process.exit(1);
  }

  const repo = await getRepo();
  await repo.ping();
  // Archive a database whose schema is current, not one a later boot would
  // have to migrate while it is being read.
  await repo.migrate();

  const result = await createBackup({ reason: "cli", repo });
  console.log(
    `[backup] wrote ${result.name} — ${(result.bytes / 1024 / 1024).toFixed(1)} MB in ${config.backup.dir}`,
  );

  const kept = await listBackups();
  console.log(`[backup] ${kept.length} archive(s) kept (limit ${config.backup.keep}).`);

  await closeRepo();
}

main().catch(async (error) => {
  console.error("[backup] failed:", error.message);
  await closeRepo().catch(() => undefined);
  process.exit(1);
});
