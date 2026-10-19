/**
 * Entry point.
 *
 * Local dev:  npm run dev         → API :4000, Vite :5173 (hot reload)
 * Production: npm start           → http://localhost:4000
 *             npm run prod        → build, then the same
 * Hosting:    any Node host (Passenger, Plesk, systemd) → server/scripts/start.js
 *
 * Under Passenger the panel supplies PORT, and it can be a socket
 * path rather than a number — `listen` accepts both.
 */
import { config } from "./config.js";
import { createApp } from "./app.js";
import { closeRepo, getRepo } from "./db/index.js";
import { startBackupScheduler, stopBackupScheduler } from "./lib/backup.js";

const app = createApp();

// Prove the database answers before accepting traffic, but do not refuse to
// start if it is down: the health endpoint is more useful than a crash loop,
// and the setup screen has to open even when nothing is configured.
if (config.hasDatabase) {
  try {
    const repo = await getRepo();
    await repo.ping();
    const schema = await repo.migrate();
    console.log(`[db] connected (${repo.kind}), schema v${schema.version}`);
  } catch (error) {
    console.error(`[db] not reachable yet: ${error.message}`);
  }
} else {
  console.log("[setup] no database configured yet — open /#/setup");
}

const server = app.listen(config.port, () => {
  const where = typeof config.port === "number" ? `http://localhost:${config.port}` : config.port;
  console.log(`[server] ${config.nodeEnv} listening on ${where}`);
  console.log(`[server] media folder: ${config.mediaDir}`);
  console.log(`[server] serving site: ${config.distDir}`);
  if (config.backup.enabled) {
    console.log(
      `[server] backups: daily at ${String(config.backup.hour).padStart(2, "0")}:00, ` +
        `keeping ${config.backup.keep}, in ${config.backup.dir}`,
    );
  }
});

// The daily zip. It checks every quarter of an hour and writes once a day, so
// a server that was asleep at the appointed hour still gets its backup.
startBackupScheduler();

/** Finish in-flight work before exiting, so a deploy never truncates a save. */
async function shutdown(signal) {
  console.log(`[server] ${signal} — closing`);
  stopBackupScheduler();
  server.close(async () => {
    await closeRepo();
    process.exit(0);
  });
  // Do not hang forever if a connection refuses to close.
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
