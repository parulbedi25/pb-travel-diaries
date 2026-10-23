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

test("interactive trip stories and their editor are shipped without a frontend build", () => {
  const html = fs.readFileSync(new URL("dist/index.html", root), "utf8");
  const reader = fs.readFileSync(new URL("src/components/Showcase.tsx", root), "utf8");
  const editor = fs.readFileSync(new URL("src/admin/AdminPage.tsx", root), "utf8");
  assert.match(html, /href="\/trip-stories\.css"/);
  for (const marker of ["Follow the story", "Next chapter", "Previous chapter", "Story chapter position", "Photo to follow"]) {
    assert.ok(html.includes(marker), `Shipped reader missing ${marker}`);
    assert.ok(reader.includes(marker), `Reference reader missing ${marker}`);
  }
  for (const marker of ["Story checkpoints", "Checkpoint photo", "Food find (optional)", "Move checkpoint"]) {
    assert.ok(html.includes(marker), `Shipped editor missing ${marker}`);
    assert.ok(editor.includes(marker), `Reference editor missing ${marker}`);
  }
  assert.doesNotMatch(reader, /setInterval|localStorage|dangerouslySetInnerHTML/);
});

test("shipped inline JavaScript parses after manual prebuilt updates", async () => {
  const { spawnSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = fs.mkdtempSync(join(tmpdir(), "pb-shipped-script-"));
  try {
    const html = fs.readFileSync(new URL("dist/index.html", root), "utf8");
    for (const [index, script] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].entries()) {
      if (!script[1].trim()) continue;
      const file = join(dir, `${index}.mjs`);
      fs.writeFileSync(file, script[1]);
      const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
