/**
 * The restore route, over HTTP.
 *
 * There is no MariaDB here, so the interesting half is what happens *before* a
 * connection exists: the upload, the preview the screen shows, and the refusal
 * of anything that is not a PB Travel Diaries backup. The last call points the
 * restore at a port nothing is listening on, which proves the route reaches the
 * importer and turns its failure into a sentence rather than a 500.
 *
 * This file deliberately runs with the MySQL driver and no database
 * configured — that is the state a freshly deployed server is in, and the only
 * state in which the restore screen is offered.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-restore-media-"));
const work = await fs.mkdtemp(path.join(os.tmpdir(), "pb-restore-work-"));

// No DB_* variables, so `hasDatabase` is false and the restore screen is open.
delete process.env.DB_HOST;
delete process.env.DB_NAME;
delete process.env.DB_USER;
delete process.env.DB_PASSWORD;
process.env.DB_DRIVER = "mysql";
process.env.MEDIA_DIR = mediaDir;
process.env.RATE_LIMIT_PER_MINUTE = "0";
process.env.INSTALL_FILE = path.join(work, "install.json");

const { createApp } = await import("../app.js");
const { writeZip } = await import("../lib/zip.js");

let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(mediaDir, { recursive: true, force: true });
  await fs.rm(work, { recursive: true, force: true });
  // The parked upload lives under the project's data folder.
  const uploads = path.resolve("data", "restore-uploads");
  await fs.rm(uploads, { recursive: true, force: true }).catch(() => undefined);
});

const payload = {
  format: "pb-restore",
  formatVersion: 1,
  createdAt: "2026-02-01T02:00:00.000Z",
  reason: "scheduled",
  siteTitle: "PB Travel Diaries",
  app: { name: "PB Travel Diaries", schemaVersion: 3 },
  database: {
    host: "old-server.example.com",
    port: 3306,
    database: "pb_old",
    user: "pb_old_user",
    password: "old-secret",
    socketPath: "",
  },
  data: {
    users: [
      { id: 1, username: "parul", role: "owner", passwordHash: "$2b$10$hash", disabled: 0 },
      { id: 2, username: "tribe1", role: "reader", passwordHash: "$2b$10$hash2", disabled: 1 },
    ],
    settings: [{ settingKey: "site_title", value: '"PB Travel Diaries"' }],
    media: [{ id: "m1", filename: "photo.png", originalName: "photo.png", mime: "image/png", size: 4 }],
    revisions: [],
    authEvents: [],
    content: { content: '{"v":1}', updatedAt: "2026-02-01T01:00:00.000Z", updatedBy: "parul" },
  },
};

async function uploadZip(name, entries) {
  const file = path.join(work, name);
  await writeZip(file, entries);
  const form = new FormData();
  form.append("file", new Blob([await fs.readFile(file)], { type: "application/zip" }), name);
  const response = await fetch(`${base}/api/setup/restore/inspect`, { method: "POST", body: form });
  return { status: response.status, json: await response.json() };
}

test("a fresh deployment offers the restore screen", async () => {
  const status = await fetch(`${base}/api/setup/status`).then((r) => r.json());
  assert.equal(status.installed, false);
  assert.equal(status.restoreAllowed, true, "no database is configured yet");
});

test("uploading a backup shows what is inside and which database it came from", async () => {
  const { status, json } = await uploadZip("pb-backup-good.zip", [
    { path: "pb-restore.json", data: JSON.stringify(payload) },
    { path: "media/photo.png", data: Buffer.from([1, 2, 3, 4]) },
  ]);

  assert.equal(status, 200);
  assert.match(json.uploadId, /^[0-9a-f-]{36}$/);
  assert.equal(json.users, 2);
  assert.equal(json.mediaFiles, 1);
  assert.equal(json.siteTitle, "PB Travel Diaries");
  assert.equal(json.schemaVersion, 3);
  assert.equal(json.database.database, "pb_old");
  assert.equal(json.database.user, "pb_old_user");
  assert.equal(json.database.password, "old-secret", "the file's own credentials come back so they can be kept or edited");
});

test("a zip that is not a backup is refused with a sentence", async () => {
  const { status, json } = await uploadZip("holiday-photos.zip", [
    { path: "photos/1.jpg", data: "not a backup" },
  ]);
  assert.equal(status, 400);
  assert.match(json.error, /pb-restore\.json/);
});

test("a restore with an unreachable database says so instead of crashing", async () => {
  const { json } = await uploadZip("pb-backup-unreachable.zip", [
    { path: "pb-restore.json", data: JSON.stringify(payload) },
  ]);

  const response = await fetch(`${base}/api/setup/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadId: json.uploadId,
      host: "127.0.0.1",
      port: 1,
      database: "pb_old",
      user: "pb_old_user",
      password: "old-secret",
    }),
  });
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.match(result.error, /Nothing accepted a connection|Could not set up the database/i);
});

test("an upload id that is not a uuid never reaches the filesystem", async () => {
  const response = await fetch(`${base}/api/setup/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId: "../../data/install.json", host: "localhost" }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Upload the backup zip first/);
});
