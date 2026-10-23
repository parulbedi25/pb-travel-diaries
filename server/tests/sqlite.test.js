import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const block = await fs.mkdtemp(path.join(os.tmpdir(), "pb-sqlite-test-"));
process.env.INSTALL_FILE = path.join(block, "data/install.json");
process.env.BCRYPT_ROUNDS = "4";
process.env.RATE_LIMIT_PER_MINUTE = "0";
delete process.env.DB_DRIVER;
const { config } = await import("../config.js");
config.root = block;
config.dbDriver = "mysql";
config.hasDatabase = false;
config.mediaDir = path.join(block, "media");
config.backup.dir = path.join(block, "backup");
config.backup.includeApp = true;
config.distDir = fileURLToPath(new URL("../../dist", import.meta.url));
const { getRepo, closeRepo } = await import("../db/index.js");
const { createApp } = await import("../app.js");
const { createSqliteRepo } = await import("../db/sqlite.js");
const { readInstall } = await import("../lib/installFile.js");
const { createBackup, readBackupPayload, restoreBackup } = await import("../lib/backup.js");
const { walkZipEntries } = await import("../lib/zip.js");
const server = createApp().listen(0);
await new Promise(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let cookie = "";
async function call(url, body) {
  const response = await fetch(base + url, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { response, body: await response.json() };
}
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await closeRepo();
  await fs.rm(block, { recursive: true, force: true });
});

test("credential-free local install creates a private real SQLite database and locks setup", async () => {
  const before = await call("/api/setup/status");
  assert.equal(before.body.installed, false);
  const { response, body } = await call("/api/setup/database", { connectionMode: "local", siteTitle: "SQLite test", database: "ignored-request-name", file: "/tmp/ignored-request-path" });
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.next, "owner");
  assert.equal(body.db.database, "pbfrompb");
  assert.equal(config.dbDriver, "sqlite");
  const filename = path.join(block, "server/data/pbfrompb.sqlite");
  assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
  assert.equal((await fs.readFile(filename)).subarray(0, 15).toString(), "SQLite format 3");
  assert.equal(readInstall().db.driver, "sqlite");
  assert.equal(readInstall().db.password, undefined);
  assert.equal((await call("/api/setup/database", { connectionMode: "local", siteTitle: "Override" })).response.status, 403);
  for (const p of ["/server/data/pbfrompb.sqlite", "/server/data/pbfrompb.sqlite-wal", "/data/install.json"]) assert.equal((await fetch(base + p)).status, 404);
});

test("owner setup, login, persistence, permissions and disabled sessions work with SQLite", async () => {
  const owner = await call("/api/setup/owner", { username: "owner", password: "local-test-password1" });
  assert.equal(owner.response.status, 201, JSON.stringify(owner.body));
  cookie = owner.response.headers.get("set-cookie").split(";")[0];
  assert.equal((await call("/api/auth/me")).body.user.role, "owner");
  const repo = await getRepo();
  const id = await repo.createUser({ username: "reader", role: "reader", passwordHash: "hash" });
  await repo.createSession({ tokenHash: "reader-session", userId: id, expiresAt: new Date(Date.now() + 60000) });
  assert.ok(await repo.findSession("reader-session"));
  await repo.setUserDisabled(id, true);
  assert.equal(await repo.findSession("reader-session"), null);
  const content = JSON.stringify({ sections: [{ id: "hero", enabled: true, data: { title: "Persisted" } }] });
  await repo.putContent({ content, revisionId: "rev-one", by: "owner" });
  await repo.setSetting("theme", '"light"');
  await closeRepo();
  const reopened = await getRepo();
  assert.equal((await reopened.getContent()).content, content);
  assert.equal(await reopened.getSetting("theme"), '"light"');
  assert.equal((await reopened.findUserByUsername("reader")).disabled, 1);
  assert.equal((await call("/api/auth/me")).body.user.role, "owner", "sessions survive process/repository reopen");
  assert.equal((await call("/api/setup/status")).body.needsOwner, false);
  assert.equal((await call("/api/health")).body.database, "sqlite");
  cookie = "";
  assert.equal((await call("/api/auth/users")).response.status, 401);
  const login = await call("/api/auth/login", { username: "owner", password: "local-test-password1" });
  assert.equal(login.response.status, 200);
});

test("SQLite operations bind payloads, handle duplicate users and serialize transactions", async () => {
  const repo = await getRepo();
  assert.equal(await repo.findUserByUsername("' OR 1=1 --"), null);
  await assert.rejects(repo.createUser({ username: "OWNER", passwordHash: "x", role: "owner" }), { code: "ER_DUP_ENTRY" });
  await Promise.all(Array.from({ length: 25 }, (_, i) => repo.putContent({ content: JSON.stringify({ i }), revisionId: `parallel-${i}`, by: "owner" })));
  assert.equal((await repo.listRevisions()).length, 15);
  const saved = await repo.getContent();
  await assert.rejects(repo.putContent({ content: "rollback", revisionId: "parallel-24", by: "owner" }));
  assert.equal((await repo.getContent()).content, saved.content, "failed revision insertion rolls back published content too");
  assert.deepEqual((await repo.migrate()).applied, []);
});

test("SQLite backup is portable JSON, excludes raw WAL files, and restores losslessly", async () => {
  await fs.mkdir(config.mediaDir, { recursive: true });
  await fs.writeFile(path.join(config.mediaDir, "test.png"), "test-photo");
  const repo = await getRepo();
  await repo.insertMedia({ id: "test-image", filename: "test.png", originalName: "test.png", mime: "image/png", size: 10, kind: "image", ext: "png", createdBy: "owner" });
  const original = JSON.parse(JSON.stringify(await repo.exportAll()));
  const backup = await createBackup({ repo });
  const payload = await readBackupPayload(backup.path);
  assert.equal(payload.database.driver, "sqlite");
  const names = [];
  await walkZipEntries(backup.path, entry => { names.push(entry.path); });
  assert.ok(!names.some(name => /\.sqlite(?:-|$)/.test(name)));
  assert.ok(names.includes("media/test.png"));
  await assert.rejects(restoreBackup({ zipPath: backup.path, database: { connectionMode: "local" } }), /already has data/);
  await repo.setSetting("theme", '"dark"');
  await closeRepo();
  const result = await restoreBackup({ zipPath: backup.path, database: { connectionMode: "local" }, replace: true });
  assert.equal(result.users, 2);
  assert.equal(result.mediaFiles, 1);
  const restored = JSON.parse(JSON.stringify(await (await getRepo()).exportAll()));
  assert.deepEqual(restored, original);
  assert.equal((await getRepo()).kind, "sqlite");
});

test("saved driver is rediscovered by a fresh Node process", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const code = `
    const {config}=await import(${JSON.stringify(new URL("../config.js", import.meta.url).href)});
    config.root=${JSON.stringify(block)};
    const {getRepo,closeRepo}=await import(${JSON.stringify(new URL("../db/index.js", import.meta.url).href)});
    const repo=await getRepo();
    console.log('RESULT='+JSON.stringify({driver:config.dbDriver,kind:repo.kind,users:await repo.countUsers(),title:await repo.getSetting('site_title')}));
    await closeRepo();
  `;
  const env = { ...process.env };
  for (const key of ["DB_DRIVER", "DB_HOST", "DB_NAME", "DB_USER"]) delete env[key];
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", code], { env });
  const result = JSON.parse(stdout.split("\n").find(line => line.startsWith("RESULT=")).slice(7));
  assert.equal(result.driver, "sqlite");
  assert.equal(result.kind, "sqlite");
  assert.equal(result.users, 2);
});

test("invalid import rolls back and incompatible future SQLite migrations fail closed", async () => {
  const repo = await createSqliteRepo(path.join(block, "isolated/db.sqlite"));
  try {
    await repo.migrate();
    await repo.createUser({ username: "original", passwordHash: "hash", role: "owner" });
    const exported = await repo.exportAll();
    const invalid = { ...exported, users: [{ ...exported.users[0], role: "not-a-role" }] };
    await assert.rejects(repo.importAll(invalid));
    assert.equal((await repo.findUserByUsername("original")).role, "owner");
  } finally { await repo.close(); }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(block, "isolated/db.sqlite"));
  db.prepare("INSERT INTO pb_schema_migrations VALUES (?, ?)").run(999, "future version");
  db.close();
  const incompatible = await createSqliteRepo(path.join(block, "isolated/db.sqlite"));
  try { await assert.rejects(incompatible.migrate(), /newer application/); }
  finally { await incompatible.close(); }
});
