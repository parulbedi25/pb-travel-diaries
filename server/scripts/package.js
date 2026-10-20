/**
 * Build a folder that runs on a plain Node host.
 *
 * The app has two kinds of files:
 *
 *   runtime     server/ (plain JavaScript), dist/ (the built site), public/
 *               (art the server serves), package.json + lock
 *   build-only  src/, index.html, tsconfig.json, vite.config.ts and every
 *               Vite/React package
 *
 * Vite never runs in production. This script copies only the runtime half into
 * `release/pb-travel-diaries/`, so the host needs nothing but Node and
 * `npm ci --omit=dev`. Upload the folder (or a ZIP of it), start it, done.
 *
 *   npm run package      # builds dist/ first, then this folder
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(root, "dist");
const indexFile = path.join(dist, "index.html");

if (!fs.existsSync(indexFile)) {
  console.error(
    "dist/index.html is missing. Run `npm run package` (it builds first), not this file directly.",
  );
  process.exit(1);
}

const releaseRoot = path.join(root, "release");
const target = path.join(releaseRoot, "pb-travel-diaries");

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

/** Copy a file or folder, skipping things that are not part of a deployment. */
function copy(from, to, { skip = [] } = {}) {
  const source = path.join(root, from);
  if (!fs.existsSync(source)) {
    console.warn(`[package] skipped ${from} (missing)`);
    return;
  }
  fs.cpSync(source, path.join(target, to), {
    recursive: true,
    filter: (file) => {
      const relative = path.relative(root, file).split(path.sep).join("/");
      return !skip.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
    },
  });
}

copy("server", "server", { skip: ["server/tests"] });
copy("dist", "dist");
copy("public", "public");
copy("app.cjs", "app.cjs");

for (const file of [
  "package.json",
  "package-lock.json",
  "README.md",
  "RUNNING.md",
  "DEPLOYMENT.md",
  "NAMECHEAP.md",
  ".env.example",
]) {
  copy(file, file);
}

// The uploaded package deliberately has no build tools or build scripts.
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
manifest.scripts = {
  start: "node app.cjs",
  "hosting:check": "node server/scripts/hosting-check.js",
  "backup:now": "node server/scripts/backup-now.js",
};
delete manifest.devDependencies;
fs.writeFileSync(path.join(target, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
// Keep resolved versions/integrities while removing development-only packages.
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
lock.packages[""].scripts = undefined;
delete lock.packages[""].devDependencies;
for (const [name, pkg] of Object.entries(lock.packages)) {
  if (name && pkg.dev === true) delete lock.packages[name];
}
fs.writeFileSync(path.join(target, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");

const startHere = `PB Travel Diaries — deploy folder
=================================

This folder is the whole application. It runs on Node.js alone: no Vite,
no TypeScript, no build step on the server.

What is inside
--------------
server/     the Node server (API, auth, uploads, database)
dist/       the built site, already compiled
public/     art the server serves at /media
package*.json, .env.example, and the three guides

Run it
------
1. Copy this folder to the server (File Manager, SFTP or scp).
2. In cPanel click Run NPM Install. No terminal command is required.
   This folder has only runtime dependencies and already includes dist/.
   Do NOT run build or prod on the host.

   Optional terminal equivalent: npm install --omit=dev

3. Create the writable folders (backup/ appears by itself on the first
   scheduled run, but creating it now proves the folder is writable):

     mkdir -p data media backup
     chmod 775 data media backup

4. Optionally run hosting:check using the panel Run JS Script button.
   It checks dependencies and creates writable folders, then exits.

5. Point the host's "Node.js app" at the startup file:

     app.cjs

   (Any process manager works; Passenger, Plesk and systemd all accept it.)
   cPanel shared hosting — Namecheap, for one — runs it through Passenger and
   supplies the socket or port itself; see NAMECHEAP.md for the exact fields.

6. Open the site. The first visit shows the setup screen: website title,
   database details, then the owner account. Moving an existing site instead?
   Choose "Restore a backup" on that same screen and upload one of the zips
   from the old server's backup/ folder.

You need a database that already exists, and a database user attached to it
with all privileges. The setup screen creates every table itself.

More detail: RUNNING.md (all commands) and DEPLOYMENT.md (hosts, backups,
HTTPS, updates).
`;
fs.writeFileSync(path.join(target, "START-HERE.txt"), startHere);

/** Report what was produced, in the units a person cares about. */
function sizeOf(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? sizeOf(full) : fs.statSync(full).size;
  }
  return total;
}

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
})(target);

const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const relative = path.relative(root, target);

console.log(`[package] ${relative} — ${files.length} files, ${mb(sizeOf(target))}`);
console.log("[package] contains: server/, dist/, public/, package files, docs");
console.log("[package] backups go to <install>/backup/ — separate from this folder");
console.log("[package] cPanel: Run NPM Install, startup file app.cjs, then Start/Restart (no build)");
