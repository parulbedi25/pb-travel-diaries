/**
 * What `npm run export:static` writes into the folder.
 *
 * The folder is files and nothing else. These checks are the ones that catch a
 * release which uploads but cannot work: a page that does not know where the
 * API is, a stray server-side file, or a `--api` address that was dropped on the
 * floor. They run the real export and read the real files back.
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
    // A machine with no database of its own, which is the normal build machine.
    env: { ...process.env, DB_DRIVER: "", DB_HOST: "", DB_NAME: "", DB_USER: "", DB_PASSWORD: "" },
  });
  return {
    out,
    read: (name) => fs.readFileSync(path.join(out, name), "utf8"),
    has: (name) => fs.existsSync(path.join(out, name)),
    list: () => fs.readdirSync(out),
    clean: () => fs.rmSync(out, { recursive: true, force: true }),
  };
}

test("the folder carries no server-side code at all", () => {
  const folder = exportOnce(["--builtin", "--api", "https://example.test/server"]);
  try {
    for (const name of folder.list()) {
      assert.ok(!/\.php$/i.test(name), `a .php file was exported: ${name}`);
    }
    assert.equal(folder.has("php-config.php"), false);
    assert.equal(folder.has(".htaccess"), false);
  } finally {
    folder.clean();
  }
});

test("the page is told where the API is", () => {
  const folder = exportOnce(["--builtin", "--api", "https://example.test/server"]);
  try {
    const html = folder.read("index.html");
    assert.match(html, /<script>window\.__PB_API_BASE__="https:\/\/example\.test\/server";<\/script>/);
    assert.ok(!html.includes("__PB_SETUP__"), "the setup marker has no business here any more");
  } finally {
    folder.clean();
  }
});

test("without --api the page is left untouched", () => {
  const folder = exportOnce(["--builtin"]);
  try {
    const html = folder.read("index.html");
    assert.ok(!html.includes('<script>window.__PB_API_BASE__='));
    // The bundle mentions the name because it reads it; nothing sets it.
    assert.ok(!/window\.__PB_API_BASE__=" /.test(html));
  } finally {
    folder.clean();
  }
});

test("exporting with an API needs no database on this machine", () => {
  // The case that stopped a build: no DB here, and the content is on the server.
  const folder = exportOnce(["--api", "/server"]);
  try {
    assert.equal(folder.has("index.html"), true);
    const readme = folder.read("README.txt");
    assert.match(readme, /The API for the dashboard lives at \/server/);
    assert.match(readme, /no database was used/);
  } finally {
    folder.clean();
  }
});

test("the readme describes what the folder can and cannot do", () => {
  const withApi = exportOnce(["--builtin", "--api", "/server"]);
  try {
    const readme = withApi.read("README.txt");
    assert.match(readme, /Upload the CONTENTS of this folder/);
    assert.match(readme, /content\.json/);
    assert.ok(!/api\.php|php-config|PHP bootstrap/.test(readme));
  } finally {
    withApi.clean();
  }

  const bare = exportOnce(["--builtin"]);
  try {
    // No API: it must say plainly what does not work, rather than implying it does.
    assert.match(bare.read("README.txt"), /there is no server/i);
  } finally {
    bare.clean();
  }
});
