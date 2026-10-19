/**
 * Entry point.
 *
 * Local:      npm run server      → http://localhost:4000
 * Hosting:    cPanel/Plesk "Node.js App" → startup file server/index.js
 *
 * Under Passenger (cPanel) the panel supplies PORT, and it can be a socket
 * path rather than a number — `listen` accepts both.
 */
import { config } from "./config.js";
import { createApp } from "./app.js";
import { closeRepo, getRepo } from "./db/index.js";

const app = createApp();

// Prove the database answers before accepting traffic, but do not refuse to
// start if it is down: the health endpoint is more useful than a crash loop.
try {
  const repo = await getRepo();
  await repo.ping();
  console.log(`[db] connected (${repo.kind})`);
} catch (error) {
  console.error(`[db] not reachable yet: ${error.message}`);
}

const server = app.listen(config.port, () => {
  const where = typeof config.port === "number" ? `http://localhost:${config.port}` : config.port;
  console.log(`[server] ${config.nodeEnv} listening on ${where}`);
  console.log(`[server] media folder: ${config.mediaDir}`);
  console.log(`[server] serving site: ${config.distDir}`);
});

/** Finish in-flight work before exiting, so a deploy never truncates a save. */
async function shutdown(signal) {
  console.log(`[server] ${signal} — closing`);
  server.close(async () => {
    await closeRepo();
    process.exit(0);
  });
  // Do not hang forever if a connection refuses to close.
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
