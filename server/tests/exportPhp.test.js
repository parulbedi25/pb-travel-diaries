/**
 * What the `--php` export actually writes into the folder.
 *
 * Written after a release went out with a `php-config.php` that was missing its
 * closing semicolon: `api.php` fataled while requiring it, `display_errors` is
 * off on shared hosting, and the browser got an empty body — which reads as
 * "api.php is not there" and is a miserable thing to debug from a screenshot.
 *
 * So this runs the real export and reads the real files back. A file that would
 * parse is the minimum bar for shipping one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "server", "scripts", "export-static.js");

function exportOnce(flags) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "pb-export-"));
  execFileSync(process.execPath, [script, ...flags, "--out", out], {
    cwd: root,
    stdio: "pipe",
    env: { ...process.env, DB_DRIVER: "", DB_HOST: "", DB_NAME: "", DB_USER: "", DB_PASSWORD: "" },
  });
  return {
    out,
    read: (name) => fs.readFileSync(path.join(out, name), "utf8"),
    has: (name) => fs.existsSync(path.join(out, name)),
    clean: () => fs.rmSync(out, { recursive: true, force: true }),
  };
}

test("php-config.php is complete PHP, not a file that fatals when required", () => {
  const folder = exportOnce(["--builtin", "--php", "--api", "https://example.test/server"]);
  try {
    const config = folder.read("php-config.php");
    assert.ok(config.startsWith("<?php"));
    assert.match(config, /return \[/);
    // The semicolon after the array literal. This one character was missing, and
    // its absence is invisible in a browser with display_errors off.
    assert.ok(config.trimEnd().endsWith("];"), `php-config.php does not end with "];":\n${config.slice(-80)}`);
    // One assignment per line, all inside the returned array.
    const lines = config.trimEnd().split("\n").filter((line) => line.startsWith("  '"));
    assert.ok(lines.length >= 8, `expected the settings array, found ${lines.length} lines`);
    for (const line of lines) assert.match(line, /^ {2}'[A-Za-z]+' => .+,$/);
  } finally {
    folder.clean();
  }
});

test("the exported api.php carries the generated schema and the API address", () => {
  const folder = exportOnce(["--builtin", "--php", "--api", "https://example.test/server"]);
  try {
    const api = folder.read("api.php");
    assert.equal(api.split("/* PB-SCHEMA:START").length - 1, 1);
    assert.ok(!api.includes("$SCHEMA = [];"), "the empty schema placeholder was not replaced");
    assert.match(api, /'mysql' => \[/);
    assert.match(api, /'sqlite' => \[/);
    assert.match(api, /INSERT (?:IGNORE|OR IGNORE) INTO (?:pb_)?schema_migrations/);
    assert.equal(folder.read("php-config.php").includes('"https://example.test/server"'), true);
    assert.equal(folder.has(".htaccess"), true);
  } finally {
    folder.clean();
  }
});

test("the page is told where the API is and that a bootstrap was shipped", () => {
  const folder = exportOnce(["--builtin", "--php", "--api", "https://example.test/server"]);
  try {
    const html = folder.read("index.html");
    assert.match(html, /window\.__PB_API_BASE__="https:\/\/example\.test\/server";/);
    assert.match(html, /window\.__PB_SETUP__="php";/);
  } finally {
    folder.clean();
  }
});

test("a plain static export carries no PHP at all", () => {
  const folder = exportOnce(["--builtin"]);
  try {
    assert.equal(folder.has("api.php"), false);
    assert.equal(folder.has("php-config.php"), false);
    // The bundle mentions both names because it reads them; what must be absent
    // is the injected tag that sets them.
    const html = folder.read("index.html");
    assert.ok(!html.includes('<script>window.__PB_SETUP__='));
    assert.ok(!html.includes('<script>window.__PB_API_BASE__='));
  } finally {
    folder.clean();
  }
});
