/**
 * `npm run dev` — the API and the Vite dev server in one terminal.
 *
 * The app has two halves in development: the Express server (API, media, auth
 * on :4000) and Vite (hot reload on :5173, proxying /api and /media to the
 * API). Starting them separately is easy to forget, and a browser that opens
 * Vite without the API looks broken. This starts both, forwards Ctrl+C to
 * both, and reuses an API that is already running so `npm run dev` can be
 * started next to `npm run dev:api`.
 *
 * Vite is only a development tool. The deployed app is the Node server plus
 * the built `dist/` folder; see `npm run prod`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiPort = String(process.env.API_PORT || process.env.PORT || "4000");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");

const children = [];
let stopping = false;

function start(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.push(child);
  return child;
}

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal));
}

/** Is something already answering on the API port? */
async function apiIsRunning() {
  try {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/health`, {
      signal: AbortSignal.timeout(1200),
    });
    // 503 means the server is up and only the database is unreachable — still
    // a server this command must not start a second copy of.
    return response.status === 200 || response.status === 503;
  } catch {
    return false;
  }
}

if (!fs.existsSync(viteBin)) {
  console.error(
    "Vite is not installed. Run `npm ci` first (it installs the development tools).",
  );
  process.exit(1);
}

const apiAlreadyRunning = await apiIsRunning();
if (apiAlreadyRunning) {
  console.log(`[dev] using the API already running on :${apiPort}`);
} else {
  console.log(`[dev] API on :${apiPort} (restarts on server file changes)`);
  start(process.execPath, ["--watch", "server/index.js"], {
    NODE_ENV: "development",
    PORT: apiPort,
    API_PORT: apiPort,
  });
}

console.log("[dev] Vite on :5173 with hot reload");
const vite = start(process.execPath, [viteBin], {
  NODE_ENV: "development",
  API_PORT: apiPort,
});

vite.on("exit", (code, signal) => {
  if (stopping) return;
  stop();
  process.exitCode = code ?? (signal ? 1 : 0);
});

for (const child of children) {
  child.on("exit", (code) => {
    if (stopping || child === vite) return;
    // The API died on its own (a syntax error, a lost port). Do not leave a
    // dev server running against nothing.
    console.error(`[dev] the API exited (${code ?? "signal"}); stopping Vite`);
    stop();
    process.exitCode = code ?? 1;
  });
}

process.on("exit", () => stop());
