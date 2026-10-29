/**
 * Build the single-file site that the server serves.
 *
 * `npm run build` — and nothing by hand. This exists because the site was once
 * rebuilt with a hand-written Vite config that had lost the Tailwind plugin: the
 * markup shipped, the styles did not, and the first-run screen came up
 * unstyled, overlapping and unreadable. The plugin is now in the committed
 * config, and this script refuses to finish unless the stylesheet actually
 * contains utility classes, so that particular failure cannot leave the machine
 * quietly again.
 *
 * The toolchain is installed on demand rather than saved in package.json: the
 * root manifest is the *server's* — a host installing this repository gets
 * Express and nothing else — so the frontend packages are fetched only when a
 * build is actually wanted:
 *
 *   npm i --no-save --legacy-peer-deps react react-dom lucide-react \
 *     framer-motion clsx tailwind-merge maplibre-gl vite @vitejs/plugin-react \
 *     @tailwindcss/vite tailwindcss vite-plugin-singlefile typescript
 *
 * It does four things the build needs and a bare `vite build` does not:
 *
 *  - builds from the page template, whose name is what stops Vite's dev-server
 *    entry from being confused with the built one;
 *  - renames the result to `index.html` and points its stylesheet link at the
 *    root, because every route of this site is served from the root;
 *  - copies MapLibre's worker next to the page, for hosting policies that
 *    refuse blob workers (see server/app.js and src/utils/mapWorker.ts);
 *  - checks the result before declaring success.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = (...parts) => path.join(root, ...parts);
const dist = at("dist");
const indexFile = path.join(dist, "index.html");

function fail(message) {
  console.error(`\n[build] ${message}\n`);
  process.exit(1);
}

// The worker is part of the site: MapLibre cannot draw without it, and the
// server answers /maplibre-gl-worker.mjs from public/ for hosts that forbid
// blob workers.
const worker = at("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
if (!fs.existsSync(worker)) {
  fail("node_modules/maplibre-gl is missing — install the build toolchain (see the top of this file).");
}
fs.copyFileSync(worker, at("public/maplibre-gl-worker.mjs"));

// Vite builds the template; the name `build.html` is deliberate, so the entry
// can never be confused with a page of the site itself.
fs.copyFileSync(at("src/frontend-template.html"), at("build.html"));

try {
  execFileSync(process.execPath, [at("node_modules/vite/bin/vite.js"), "build"], {
    cwd: root,
    stdio: "inherit",
  });
} finally {
  fs.rmSync(at("build.html"), { force: true });
}

if (!fs.existsSync(path.join(dist, "build.html"))) fail("vite build produced no page.");
fs.renameSync(path.join(dist, "build.html"), indexFile);

// Every route is served from the root, so the stylesheet link has to be too.
const html = fs.readFileSync(indexFile, "utf8").replace(
  'href="./mobile-layout.css"',
  'href="/mobile-layout.css"',
);
fs.writeFileSync(indexFile, html);

// The check that would have caught the unstyled build: Tailwind utilities are
// the site's only styling, and `--tw-` custom properties come from it alone.
const utilities = (html.match(/--tw-/g) ?? []).length;
const hasRule = html.includes(".rounded-3xl{") && html.includes(".bg-saffron-400{");
if (utilities < 500 || !hasRule) {
  fail(
    `the stylesheet has ${utilities} Tailwind properties and ${hasRule ? "some" : "none"} of its rules — ` +
      "the build is missing the tailwindcss() Vite plugin. Not shipping this.",
  );
}

const gzipped = gzipSync(html).length;
console.log(
  `\n[build] dist/index.html — ${(html.length / 1024).toFixed(0)} kB, ` +
    `${(gzipped / 1024).toFixed(0)} kB gzipped, ${utilities} Tailwind properties, worker copied.`,
);
