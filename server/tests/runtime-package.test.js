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
  assert.match(html, /href="\/mobile-layout\.css(?:\?v=[^"\s]+)?"/);
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

test("optional visual skin is shared by source and prebuilt without changing palette tokens", () => {
  const html = fs.readFileSync(new URL("dist/index.html", root), "utf8");
  const template = fs.readFileSync(new URL("src/frontend-template.html", root), "utf8");
  const skin = fs.readFileSync(new URL("public/studio-skin.css", root), "utf8");
  assert.match(html, /href="\/studio-skin\.css"/);
  assert.match(template, /href="\/studio-skin\.css"/);
  assert.doesNotMatch(skin, /--color-(?:saffron|ink|ridden|start-label|end-label)[\w-]*\s*:/);
  assert.doesNotMatch(skin, /@import|url\(/);
  assert.match(skin, /Homepage only/);
});

test("mobile Machine and Gear have touch interactions in source and shipped bundle", () => {
  const html = fs.readFileSync(new URL("dist/index.html", root), "utf8");
  const machine = fs.readFileSync(new URL("src/components/MachineExperience.tsx", root), "utf8");
  const gear = fs.readFileSync(new URL("src/components/RiderKitExperience.tsx", root), "utf8");
  const css = fs.readFileSync(new URL("public/mobile-layout.css", root), "utf8");
  for (const code of [html, machine, gear]) {
    assert.ok(code.includes('(min-width: 768px) and (hover: hover) and (pointer: fine)'), "zoom must not capture mobile taps");
  }
  assert.ok(machine.includes('[data-pointer-index], [role=dialog]'));
  assert.ok(html.includes('[data-pointer-index], [role=dialog]'));
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /#machine \.machine-image-area \[data-pointer-index\] \{ width: 44px; height: 44px/);
  assert.match(css, /#machine \.machine-image-area > \[role="dialog"\]/);
  assert.match(css, /data-machine-block="hanle-story"/);
  assert.match(css, /#live \.map-label\.text-end-label/);
});

test("curated travel images ship locally without packaging runtime uploads", () => {
  const html = fs.readFileSync(new URL("dist/index.html", root), "utf8");
  const defaults = fs.readFileSync(new URL("src/store/siteContent.tsx", root), "utf8");
  for (const name of ["ladakh-pangong", "nubra-diskit", "spiti-dhankar", "rajasthan-jaipur", "varanasi-sunrise", "meghalaya-dawki", "kerala-munnar", "goa-agonda"]) {
    assert.ok(html.includes(`/media/starter/${name}.webp`));
    assert.ok(defaults.includes(`/media/starter/${name}.webp`));
    const image = fs.readFileSync(new URL(`media/starter/${name}.webp`, root));
    assert.equal(image.subarray(0, 4).toString(), "RIFF");
    assert.equal(image.subarray(8, 12).toString(), "WEBP");
  }
  const manifest = JSON.parse(fs.readFileSync(new URL("media/starter/credits.json", root), "utf8"));
  assert.equal(manifest.filter(photo => photo.library && photo.file.endsWith(".webp")).length, 8);
  assert.ok(manifest.every(image => image.source && image.author && image.license));
  const packager = fs.readFileSync(new URL("server/scripts/package.js", root), "utf8");
  assert.ok(packager.includes('copy("media/starter", "media/starter")'));
  assert.ok(!packager.includes('copy("media", "media")'));
});

test("standalone Live Map location card has a theme-aware opaque reading surface", () => {
  const html = fs.readFileSync(new URL("dist/index.html", root), "utf8");
  const source = fs.readFileSync(new URL("src/components/LiveMapPage.tsx", root), "utf8");
  const css = fs.readFileSync(new URL("public/mobile-layout.css", root), "utf8");
  assert.ok(html.includes("live-location-card w-full max-w-sm"));
  assert.ok(source.includes("live-location-card w-full max-w-sm"));
  assert.match(css, /\.live-location-card/);
  assert.match(css, /background: #111112/);
  assert.match(css, /background: #fffdf7/);
  assert.match(css, /\[data-theme="light"\] \.live-location-card/);
});


test("Live Map dark mode uses an opaque card and also themes its raster fallback", () => {
  const page = fs.readFileSync(new URL("src/components/LiveMapPage.tsx", root), "utf8");
  const tiles = fs.readFileSync(new URL("src/components/TileBasemap.tsx", root), "utf8");
  const html = fs.readFileSync(new URL("dist/index.html", root), "utf8");
  assert.ok(!page.includes("live-location-card w-full max-w-sm rounded-3xl glass"));
  assert.ok(page.includes('backgroundColor: theme === "light" ? "#fffdf7" : "#111112"'));
  assert.ok(page.includes('<ThemeToggle className="ml-auto shrink-0" />'));
  for (const text of [html, tiles]) {
    assert.ok(text.includes("data-raster-theme"));
    assert.ok(text.includes("invert(1) hue-rotate(180deg) brightness(0.75) saturate(0.65)"));
  }
});
