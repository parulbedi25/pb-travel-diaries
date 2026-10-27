import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../../", import.meta.url);
test("root installs only server packages and never builds on start", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("package.json", root)));
  const lock = JSON.parse(fs.readFileSync(new URL("package-lock.json", root)));
  assert.equal(manifest.devDependencies, undefined);
  assert.equal(manifest.scripts.build, undefined);
  assert.equal(manifest.scripts.start, "node app.cjs");
  assert.equal(manifest.scripts.prod, "node app.cjs");
  assert.equal(manifest.scripts.package, "node server/scripts/package.js");
  assert.ok(!Object.keys(lock.packages).some((name) => /node_modules\/(vite|vite-plugin-singlefile|@vitejs\/)/.test(name)));
  assert.ok(!fs.existsSync(new URL("vite.config.ts", root)));
});
/**
 * Two known-vulnerable packages, pinned here so a future install cannot quietly
 * bring them back.
 *
 * `npm audit` is the real gate (see `npm run audit`), but it needs the network
 * and a fresh advisory database, so it cannot run in the unit tests. These two
 * bounds are the high-severity findings we have actually fixed:
 *
 *  - body-parser 2.0.0–2.3.0: denial of service via trailing bytes after a
 *    compressed request body (GHSA-27r3-jxmh-p828). 2.4.0 fixes it.
 *  - multer 2.0.0–2.4.0: denial of service when a pending asynchronous
 *    fileFilter outlives the request (GHSA-q7qp-rjg7-q26m). 2.5.0 fixes it.
 *
 * Both are installed by the lockfile, so checking the lockfile is what stops a
 * fresh `npm install` from resolving back onto a bad range.
 */
test("the locked dependency tree stays clear of the fixed high-severity advisories", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("package.json", root)));
  const lock = JSON.parse(fs.readFileSync(new URL("package-lock.json", root)));

  const atLeast = (version, floor) => {
    const parse = (v) => String(v).split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
    const [a, b] = [parse(version), parse(floor)];
    for (let i = 0; i < 3; i += 1) {
      if (a[i] !== b[i]) return a[i] > b[i];
    }
    return true;
  };

  const locked = (name) => {
    const entry = lock.packages?.[`node_modules/${name}`];
    assert.ok(entry?.version, `${name} is missing from the lockfile`);
    return entry.version;
  };

  // multer is a direct dependency, so the declared range matters too.
  assert.match(manifest.dependencies.multer, /^\^2\.(5|[6-9]|\d{2,})\./, "package.json must ask for multer 2.5.0 or newer");
  assert.ok(atLeast(locked("multer"), "2.5.0"), `multer ${locked("multer")} is below the fixed 2.5.0`);
  assert.ok(atLeast(locked("body-parser"), "2.4.0"), `body-parser ${locked("body-parser")} is below the fixed 2.4.0`);

  // The gate itself has to exist, or the next advisory is back to being found
  // by hand.
  assert.equal(manifest.scripts.audit, "npm audit --audit-level=high");
});

test("prebuilt website is present without frontend dependencies", () => {
  const html = fs.readFileSync(new URL("dist/index.html", root), "utf8");
  assert.match(html, /<html/);
  assert.match(html, /<script/);
  assert.doesNotMatch(html, /src=["']\/src\//);
});

test("prebuilt navigation and reference source share responsive hooks", () => {
  const html = fs.readFileSync(new URL("dist/index.html", root), "utf8");
  const source = fs.readFileSync(new URL("src/components/Navbar.tsx", root), "utf8");
  for (const hook of ["site-header-row", "site-header-links", "site-header-actions", "site-mobile-menu", "site-mobile-menu-content"]) {
    assert.ok(html.includes(hook), `prebuilt site missing ${hook}`);
    assert.ok(source.includes(hook), `source missing ${hook}`);
  }
  assert.match(html, /href="\/mobile-layout\.css"/);
  assert.ok(html.includes('(min-width: 1280px)'));
  assert.ok(source.includes('(min-width: 1280px)'));
});

test("commandcenter is recognized in reference and prebuilt routers", () => {
  const html = fs.readFileSync(new URL("dist/index.html", root), "utf8");
  const source = fs.readFileSync(new URL("src/utils/router.ts", root), "utf8");
  // Minified names and quote style are not part of the contract — only that the
  // prebuilt router knows the same four admin paths the source does. The
  // minifier may inline those paths as literals or leave them as constants
  // declared just above, so each path is looked for on its own rather than as
  // one `new Set([...])` run of literals.
  for (const path of ["/admin", "/commandcenter", "/pb-control", "/login"]) {
    assert.match(html, new RegExp(`["'\`]${path}["'\`]`), `prebuilt router missing ${path}`);
  }
  assert.match(source, /COMMAND_CENTER_PATH = "\/commandcenter"/);
  assert.match(source, /new Set<string>\(\[ADMIN_PATH, COMMAND_CENTER_PATH,/);
});

test("SQLite setup is available in reference and prebuilt UI without credentials", () => {
  const html = fs.readFileSync(new URL("dist/index.html", root), "utf8");
  const source = fs.readFileSync(new URL("src/setup/SetupWizard.tsx", root), "utf8");
  for (const text of [html, source]) {
    assert.ok(text.includes("Local database (SQLite)"));
    assert.ok(text.includes("server/data/pbfrompb.sqlite"));
    assert.ok(!text.includes("Local MySQL / MariaDB (same server)"));
  }
});
