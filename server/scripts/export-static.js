/**
 * Writes the site out as plain files that any static host can serve.
 *
 *   npm run export:static
 *   npm run export:static -- --out /path/to/folder
 *   npm run export:static -- --check
 *   npm run export:static -- --db-host 203.0.113.9 --db-user pb_read --db-name pb_travel
 *
 * `--check` connects, says which database it reached, and stops: the question
 * worth answering before a full run when the database is somewhere else.
 *
 * The database flags override `.env` for this one command, which is how an
 * export is read from a site's database on a host while this machine keeps its
 * own. They are used for the few seconds of the export and are never written
 * into the folder — a static site cannot connect to a database, and credentials
 * in a web root are credentials published.
 *
 * The site normally needs the Node process: the page asks `/api/content` for
 * what it should show, and that answer lives in the database. This copies that
 * answer next to the page as `content.json`, which the store reads when no API
 * answers — so the folder it produces opens on Namecheap, Netlify, GitHub Pages,
 * S3 or a USB stick with no Node anywhere near it.
 *
 * What it writes:
 *
 *   index.html              the built page (npm run build)
 *   content.json            the published content, as a visitor sees it
 *   images/, media/         the art that ships with the code, plus uploads
 *   mobile-layout.css       the small-screen overrides the page links to
 *   maplibre-gl-worker.mjs  the map's worker, for hosts that refuse blob workers
 *   README.txt              what this folder is, and what it cannot do
 *
 * Two deliberate omissions:
 *
 *  - **Members-only sections are exported locked and empty**, exactly as a
 *    visitor sees them. A static file cannot keep a secret, and writing the
 *    member content into one would hand it to everybody who opens the folder.
 *  - **Uploads are copied in, the shipped art is copied in, and the two never
 *    overwrite each other's names** — an upload wins, because that is the order
 *    the server serves them in.
 */
import fs from "node:fs";
import path from "node:path";

const THEME_VALUES = new Set(["dark", "light"]);
const SKIP_UPLOADS = new Set(["README.md", ".DS_Store", "Thumbs.db"]);

const argValue = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const value = process.argv[at + 1];
  return value && !value.startsWith("--") ? value : fallback;
};

const hasFlag = (name) => process.argv.includes(`--${name}`);

/**
 * Database settings given on this command, applied before anything reads them.
 *
 * An export can be read from a database that is not the one this machine uses
 * day to day — the site's MySQL on a host, say — because the export is a moment,
 * not a connection the site keeps. The credentials are used for these few
 * seconds and are never written into the folder: what ships is `content.json`,
 * and a static site cannot connect to a database at all. That is the whole
 * reason these exist as flags rather than a `.env` in the upload.
 *
 * Set before the first import of `config.js`, which reads them once at load.
 */
const DB_FLAGS = {
  DB_DRIVER: "db-driver",
  DB_HOST: "db-host",
  DB_PORT: "db-port",
  DB_USER: "db-user",
  DB_NAME: "db-name",
  DB_SOCKET: "db-socket",
  DB_PASSWORD: "db-password",
};
for (const [variable, flag] of Object.entries(DB_FLAGS)) {
  const value = argValue(flag, undefined);
  if (value !== undefined) process.env[variable] = value;
}
if (argValue("db-password", undefined) !== undefined) {
  console.warn(
    "[export] --db-password is visible in this shell's history; DB_PASSWORD=… on the command is safer.",
  );
}

/**
 * The environment file this export reads.
 *
 * `.env` is the default — the same file the server reads, so one place holds
 * the database details and both the dashboard and the export agree. `--env`
 * (or `ENV_FILE`) points one run at a different file, which is how a set of
 * credentials used only for an export can be kept out of the everyday ones.
 *
 * Loaded here, before `config.js` is first imported, because `config.js` reads
 * its values once. A variable already set in the real environment wins over the
 * file, which is the same rule the server follows.
 */
// `--env`, not `--env-file`: Node claims that spelling for itself and would
// swallow it before this script ever ran.
const envFile = argValue("env", process.env.ENV_FILE || "");
const envPath = envFile ? path.resolve(envFile) : "";
if (envPath) {
  if (!fs.existsSync(envPath)) {
    console.error(`[export] --env ${envPath} does not exist.`);
    process.exit(1);
  }
  // dotenv does not overwrite what is already set, which is what we want.
  const { default: dotenv } = await import("dotenv");
  dotenv.config({ path: envPath });
  console.log(`[export] environment: ${envPath}`);
} else {
  const defaultEnv = path.resolve(import.meta.dirname, "../../.env");
  if (fs.existsSync(defaultEnv)) console.log("[export] environment: .env");
}

/** Which of the database variables the environment actually supplied. */
function envKeysUsed() {
  const names = ["DB_DRIVER", "DB_HOST", "DB_PORT", "DB_USER", "DB_NAME", "DB_SOCKET", "DB_PASSWORD"];
  return names.filter((name) => process.env[name] !== undefined);
}

const { config } = await import("../config.js");
const { closeRepo, getRepo } = await import("../db/index.js");
const { visibleTo } = await import("../routes/content.js");

/** Where the content is being read from, said without the password. */
function sourceLabel() {
  if (config.dbDriver === "sqlite") return "the local SQLite file (server/data/pbfrompb.sqlite)";
  if (config.dbDriver === "memory") return "an in-memory database (nothing to export)";
  const at = config.db.socketPath || `${config.db.host}:${config.db.port}`;
  return `MySQL at ${at}/${config.db.database} as ${config.db.user}`;
}

const parseJson = (value) => {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

/** Every file under a folder, as paths relative to it. */
function walk(dir, prefix = "") {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) found.push(...walk(path.join(dir, entry.name), relative));
    else found.push(relative);
  }
  return found;
}

function copyInto(from, to, { skip = new Set(), label } = {}) {
  let files = 0;
  let bytes = 0;
  for (const relative of walk(from)) {
    if (skip.has(path.basename(relative))) continue;
    const target = path.join(to, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(from, relative), target);
    files += 1;
    bytes += fs.statSync(target).size;
  }
  if (files) console.log(`[export] ${label}: ${files} file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  return { files, bytes };
}

/**
 * The folder without a database behind it.
 *
 * The site carries its own content — every section, the trip, the gear, the
 * shop — and a database only ever holds *changes* to it. So an export with
 * nothing to read is still a site: the built-in content, the same one a fresh
 * install shows before anyone saves. That is what `--builtin` writes, and it
 * needs no database, no setup and no credentials at all.
 */
function exportBuiltin(out) {
  const page = path.join(config.distDir, "index.html");
  if (!fs.existsSync(page)) {
    console.error("[export] dist/index.html is missing — run `node scripts/build.mjs` first.");
    process.exit(1);
  }
  writeFolder(out, page, null, { theme: "dark", title: config.siteTitle, source: "built-in content" });
}

/**
 * The folder itself: the page, the art, the uploads, and optionally the content.
 *
 * `content` is null when there is nothing to write — an export of the built-in
 * site — and then `content.json` is simply not created. The page then shows the
 * content compiled into it, which is the same thing a fresh install shows.
 */
function writeFolder(out, page, content, { theme, title, source }) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  fs.copyFileSync(page, path.join(out, "index.html"));
  console.log(`[export] index.html: ${(fs.statSync(page).size / 1024 / 1024).toFixed(1)} MB`);

  const shipped = path.join(config.root, "public");
  for (const asset of ["images", "media"]) {
    copyInto(path.join(shipped, asset), path.join(out, asset), { label: asset });
  }
  for (const file of ["mobile-layout.css", "maplibre-gl-worker.mjs"]) {
    const from = path.join(shipped, file);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(out, file));
  }

  // Uploads after the shipped art: the server lets an upload win, so the export
  // must too, or a replaced photo would silently revert.
  copyInto(config.mediaDir, path.join(out, "media"), { skip: SKIP_UPLOADS, label: "uploads" });

  if (content) {
    fs.writeFileSync(
      path.join(out, "content.json"),
      JSON.stringify({ exportedAt: new Date().toISOString(), theme, title, content }, null, 0),
    );
  }

  fs.writeFileSync(
    path.join(out, "README.txt"),
    [
      "PB Travel Diaries — static export",
      "",
      content
        ? `Exported ${new Date().toISOString()} from ${source}.`
        : `Exported ${new Date().toISOString()} from the built-in content: no database was used.`,
      "",
      "Upload the CONTENTS of this folder to the root of a website.",
      "",
      "It must be the root: the page refers to its art as /media/… and /images/…,",
      "so uploading into a subfolder will show the site with no pictures.",
      "",
      "What works here: every page, the map and its pins, the weather, the shop,",
      "the journey. This is the site as it stood at the moment of export.",
      "",
      "What does not, because there is no server: the dashboard and signing in,",
      "editing the site, uploaded photos being added later, short map links being",
      "expanded, nearby places, and the live tracker's shared position.",
      "",
      "There is no database here and no .env: " +
        (content
          ? "content.json IS the site's content, written when this folder was exported."
          : "the page carries its content, and content.json was not written.") +
        " Do not upload a .env — on a static",
      "host every file in the web root can be downloaded by anyone, and nothing",
      "here would read it anyway. To change the content, edit the site where the",
      "server runs, then export again.",
      "",
    ].join("\n"),
  );

  const total = walk(out).reduce((sum, relative) => sum + fs.statSync(path.join(out, relative)).size, 0);
  console.log(
    `[export] done — ${walk(out).length} files, ${(total / 1024 / 1024).toFixed(1)} MB in ${out}`,
  );
}

async function main() {
  if (hasFlag("builtin") || hasFlag("no-database")) {
    exportBuiltin(path.resolve(argValue("out", path.join(config.root, "release", "static"))));
    return;
  }
  if (!config.hasDatabase) {
    // Not an error about the export; an error about where the content is. Two
    // things can be done about that, and the message says both, because "open
    // the setup screen" alone leaves out the case of a database that already
    // holds the site and merely is not the one this machine uses day to day.
    const flags = "--db-host HOST --db-user USER --db-name NAME";
    console.error("[export] no database is configured on this machine yet, so there is nothing to read.");
    console.error("");
    console.error("[export] If the content is in a MySQL database this machine can reach:");
    console.error(`[export]   DB_PASSWORD='…' npm run export:static -- ${flags}`);
    console.error("[export]   (add --db-port, --db-socket or --db-driver if they differ)");
    console.error("[export] or put DB_HOST, DB_USER, DB_NAME and DB_PASSWORD in .env — this");
    console.error("[export] command reads it too. The .env is not copied into the folder: what");
    console.error("[export] ships is content.json, because a static site cannot hold a connection.");
    console.error("");
    console.error("[export] If the site has never been set up on this machine:");
    console.error("[export]   PORT=4000 node app.cjs   → finish the setup screen → Save → export again");
    process.exit(1);
  }
  const page = path.join(config.distDir, "index.html");
  if (!fs.existsSync(page)) {
    console.error("[export] dist/index.html is missing — run `node scripts/build.mjs` first.");
    process.exit(1);
  }

  // Named, never printed: knowing that DB_HOST came from `.env` is the useful
  // half; knowing the password is not, and a log is a file people paste.
  const used = envKeysUsed();
  console.log(
    used.length
      ? `[export] database settings from the environment: ${used.join(", ")}`
      : "[export] database settings: none in the environment — using the saved install file",
  );
  console.log(`[export] reading from ${sourceLabel()}`);

  const repo = await getRepo();
  try {
    // Fail here rather than halfway through copying files, with the address in
    // the message: a database on another machine is the likeliest thing to be
    // wrong, and "it did not work" would send somebody to the wrong place.
    await repo.ping();
  } catch (error) {
    const code = error?.code || "";
    // mysql2 leaves `message` empty on a refused socket; the code is the fact.
    const detail = error?.message || code || "connection failed";
    console.error(`[export] could not reach ${sourceLabel()}: ${detail}`);
    if (code === "ER_ACCESS_DENIED_ERROR") {
      // A server answered and refused the user. On a laptop that is almost
      // always credentials copied from a hosting panel: that user exists on the
      // host's MySQL, not on this machine's own.
      console.error(
        `[export] the MySQL on ${config.db.host} is running, and it does not know the user ` +
          `"${config.db.user}".`,
      );
      console.error(
        "[export] a database user created in cPanel exists on that hosting server, not on this " +
          "Mac — reach it by enabling Remote MySQL in cPanel and passing the server's hostname, " +
          "or run this command where the database actually lives.",
      );
    } else if (code === "ECONNREFUSED") {
      console.error(
        `[export] nothing is listening on ${config.db.host}:${config.db.port}. Start MySQL on this ` +
          "machine, or point --db-host at the server that has it.",
      );
    } else {
      console.error(
        "[export] check the host, the user, the password and that the database allows " +
          "connections from this machine. On shared hosting that is Remote MySQL in cPanel.",
      );
    }
    await closeRepo();
    // Still building, unless asked not to. The folder is wanted either way: it
    // can be uploaded, looked at and compared, and the warning above already
    // says that the dashboard's changes are not in it. `--strict` is for a
    // pipeline that would rather stop than ship the wrong content.
    if (hasFlag("strict")) {
      console.error("[export] --strict: stopping instead of building without the database.");
      process.exit(1);
    }
    console.warn("[export] building anyway, from the content in the code — the site will");
    console.warn("[export] open and work, without the changes saved in the dashboard.");
    exportBuiltin(path.resolve(argValue("out", path.join(config.root, "release", "static"))));
    return;
  }

  let row = null;
  try {
    row = await repo.getContent();
  } catch (error) {
    console.error(
      `[export] reached ${sourceLabel()} but could not read it: ${error?.message || error?.code || "no answer"}`,
    );
    console.error(
      "[export] a reachable database with no site content table is the wrong database — " +
        "check --db-name, or set it up by opening the site once.",
    );
    await closeRepo();
    if (hasFlag("strict")) process.exit(1);
    console.warn("[export] building anyway, from the content in the code.");
    exportBuiltin(path.resolve(argValue("out", path.join(config.root, "release", "static"))));
    return;
  }
  const theme = parseJson(await repo.getSetting("theme"));
  const savedTitle = parseJson(await repo.getSetting("site_title"));

  // The visitor's copy, by the server's own rule: members-only sections are
  // locked and emptied rather than written out.
  const content = row?.content ? visibleTo(parseJson(row.content), null) : null;
  if (!content) {
    console.error(
      "[export] nothing has been published yet — save the site in the dashboard first, " +
        "or the export would contain only the built-in defaults.",
    );
    await closeRepo();
    process.exit(1);
  }

  // `--check` answers the only question worth answering before a full run: can
  // this machine read that database, and does it hold a published site?
  if (hasFlag("check")) {
    console.log(`[export] ${sourceLabel()} — reachable`);
    console.log(
      row?.content
        ? "[export] it holds a published site; `npm run export:static` would export it."
        : "[export] it holds no published site yet; nothing to export.",
    );
    await closeRepo();
    return;
  }

  const out = path.resolve(argValue("out", path.join(config.root, "release", "static")));
  writeFolder(out, page, content, {
    theme: THEME_VALUES.has(theme) ? theme : "dark",
    title: typeof savedTitle === "string" && savedTitle.trim() ? savedTitle : config.siteTitle,
    source:
      config.dbDriver === "sqlite" ? "the local SQLite database" : "the site's database",
  });
  await closeRepo();
}

main().catch(async (error) => {
  console.error("[export] failed:", error.message);
  await closeRepo().catch(() => undefined);
  process.exit(1);
});
