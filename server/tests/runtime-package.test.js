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
  assert.ok(html.includes('new Set([w0e,"/commandcenter","/pb-control","/login"])'));
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
