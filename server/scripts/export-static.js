/**
 * Writes the site out as plain files that any static host can serve.
 *
 *   npm run export:static
 *   npm run export:static -- --out /path/to/folder
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
import { config } from "../config.js";
import { closeRepo, getRepo } from "../db/index.js";
import { visibleTo } from "../routes/content.js";

const THEME_VALUES = new Set(["dark", "light"]);
const SKIP_UPLOADS = new Set(["README.md", ".DS_Store", "Thumbs.db"]);

const argValue = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const value = process.argv[at + 1];
  return value && !value.startsWith("--") ? value : fallback;
};

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

async function main() {
  if (!config.hasDatabase) {
    console.error("[export] no database configured yet — open the setup screen first.");
    process.exit(1);
  }
  const page = path.join(config.distDir, "index.html");
  if (!fs.existsSync(page)) {
    console.error("[export] dist/index.html is missing — run `node scripts/build.mjs` first.");
    process.exit(1);
  }

  const repo = await getRepo();
  const row = await repo.getContent();
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

  const out = path.resolve(argValue("out", path.join(config.root, "release", "static")));
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

  fs.writeFileSync(
    path.join(out, "content.json"),
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        theme: THEME_VALUES.has(theme) ? theme : "dark",
        title: typeof savedTitle === "string" && savedTitle.trim() ? savedTitle : config.siteTitle,
        content,
      },
      null,
      0,
    ),
  );

  fs.writeFileSync(
    path.join(out, "README.txt"),
    [
      "PB Travel Diaries — static export",
      "",
      `Exported ${new Date().toISOString()} from ${config.hasDatabase ? config.dbDriver : "unknown"} database.`,
      "",
      "Upload the CONTENTS of this folder to the root of a website.",
      "",
      "It must be the root: the page refers to its art as /media/… and /images/…,",
      "so uploading into a subfolder will show the site with no pictures.",
      "",
      "What works here: every page, the map and its pins, the weather, the shop,",
      "the journey. This is the site as it was published at the moment of export.",
      "",
      "What does not, because there is no server: the dashboard and signing in,",
      "editing the site, uploaded photos being added later, short map links being",
      "expanded, nearby places, and the live tracker's shared position.",
      "",
      "To change anything, edit the site on a host running the server, or run it",
      "locally, then export again.",
      "",
    ].join("\n"),
  );

  const total = walk(out).reduce((sum, relative) => sum + fs.statSync(path.join(out, relative)).size, 0);
  console.log(
    `[export] done — ${walk(out).length} files, ${(total / 1024 / 1024).toFixed(1)} MB in ${out}`,
  );
  await closeRepo();
}

main().catch(async (error) => {
  console.error("[export] failed:", error.message);
  await closeRepo().catch(() => undefined);
  process.exit(1);
});
