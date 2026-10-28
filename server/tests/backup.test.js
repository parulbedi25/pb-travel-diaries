/**
 * Tests for the daily backup and the importer that restores one.
 *
 * The archive itself is real — a real zip written to a temporary `backup/`
 * folder, then read back and inspected. Only the database half of a restore is
 * emulated, because there is no MariaDB here: the fake records every statement,
 * which is enough to prove the rows, the column names and the order.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const block = await fs.mkdtemp(path.join(os.tmpdir(), "pb-backup-test-"));
const mediaDir = path.join(block, "media");
const backupDir = path.join(block, "backup");
const installFile = path.join(block, "data", "install.json");
await fs.mkdir(mediaDir, { recursive: true });

process.env.DB_DRIVER = "memory";
process.env.MEDIA_DIR = mediaDir;
process.env.BACKUP_DIR = backupDir;
process.env.INSTALL_FILE = installFile;
process.env.BCRYPT_ROUNDS = "4";

const { getRepo } = await import("../db/index.js");
const {
  BACKUP_FORMAT,
  backupPath,
  createBackup,
  inspectBackup,
  listBackups,
  pruneBackups,
  readBackupPayload,
  restoreBackup,
} = await import("../lib/backup.js");
const { SetupError } = await import("../lib/installer.js");
const { publicInstall, readInstall } = await import("../lib/installFile.js");
const { readZipText, safeJoin, writeZip } = await import("../lib/zip.js");

const repo = await getRepo();
const photo = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

before(async () => {
  const ownerId = await repo.createUser({
    username: "parul",
    email: "pb@example.com",
    passwordHash: "$2b$10$abcdefghijklmnopqrstuv",
    role: "owner",
  });
  await repo.createUser({
    username: "tribe1",
    passwordHash: "$2b$10$zyxwvutsrqponmlkjihgfe",
    role: "reader",
  });
  await repo.setUserDisabled(await repo.findUserByUsername("tribe1").then((u) => u.id), true);
  await repo.putContent({
    content: JSON.stringify({ v: 1, sections: [{ id: "sec-hero", type: "hero", data: {} }] }),
    description: "First publish",
    revisionId: "rev-1",
    by: "parul",
  });
  await repo.setSetting("site_title", '"PB Travel Diaries"');
  await repo.setSetting("allow_signup", "true");
  await fs.writeFile(path.join(mediaDir, "photo.png"), photo);
  await repo.insertMedia({
    id: "media-1",
    filename: "photo.png",
    originalName: "himalaya.png",
    mime: "image/png",
    size: photo.length,
    kind: "image",
    ext: "png",
    createdBy: "parul",
  });
  assert.ok(ownerId > 0);
});

after(async () => {
  await fs.rm(block, { recursive: true, force: true });
});

test("a backup is a real zip with the database, the media and the app inside", async () => {
  const at = new Date("2026-03-04T09:05:06");
  const backup = await createBackup({ reason: "test", repo, at });
  const pad = (n) => String(n).padStart(2, "0");
  const expected =
    `pb-backup-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `_${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}.zip`;
  assert.equal(backup.name, expected, "the name is the local date and time, so they sort as they happened");

  const stat = await fs.stat(backup.path);
  assert.equal(stat.mode & 0o777, 0o600, "the archive holds every password hash; only the owner reads it");
  assert.ok(stat.size > 500, "the archive has content");

  const dirMode = (await fs.stat(backupDir)).mode & 0o777;
  assert.equal(dirMode, 0o700, "and the folder it lives in is private too");

  assert.match(await readZipText(backup.path, "app/app.cjs"), /server\/index\.js/);
  const payload = await readBackupPayload(backup.path);
  assert.equal(payload.format, BACKUP_FORMAT);
  assert.equal(payload.siteTitle, "PB Travel Diaries");

  // Accounts survive with their hashes, which is what makes a restore a
  // restore rather than a re-installation.
  assert.equal(payload.data.users.length, 2);
  const owner = payload.data.users.find((user) => user.username === "parul");
  assert.equal(owner.role, "owner");
  assert.equal(owner.passwordHash, "$2b$10$abcdefghijklmnopqrstuv");
  const reader = payload.data.users.find((user) => user.username === "tribe1");
  assert.equal(reader.disabled, 1, "a disabled account stays disabled after a restore");

  // Settings, the published site and its history.
  assert.ok(payload.data.settings.some((row) => row.settingKey === "site_title"));
  assert.equal(payload.data.revisions.length, 1);
  assert.equal(payload.data.media.length, 1);

  // The file is the importer: database details travel with it.
  assert.equal(payload.database, null, "the memory driver has no connection to record");

  const summary = await inspectBackup(backup.path);
  assert.equal(summary.users, 2);
  assert.equal(summary.mediaFiles, 1, "the uploaded photograph is in the archive");
  assert.equal(summary.mediaBytes, photo.length);
  assert.equal(summary.hasContent, true);
});

test("the restore payload can be edited by hand and carries its own schema version", async () => {
  const backup = await listBackups().then((all) => all[0]);
  const payload = await readBackupPayload(path.join(backupDir, backup.name));
  assert.ok(Number(payload.app.schemaVersion) >= 3);
  // Everything a different database would need, in plain text, ready to edit.
  assert.ok("database" in payload);
  assert.ok("formatVersion" in payload);
});

test("only the newest archives are kept", async () => {
  await createBackup({ reason: "second", repo, at: new Date("2026-03-05T09:00:00Z") });
  await createBackup({ reason: "third", repo, at: new Date("2026-03-06T09:00:00Z") });

  const all = await listBackups();
  assert.equal(all.length, 3);
  assert.match(all[0].name, /2026-03-06/, "newest first");

  const removed = await pruneBackups(2);
  assert.equal(removed.length, 1);
  const left = await listBackups();
  assert.equal(left.length, 2);
  assert.equal(left[0].name, all[0].name);
  assert.equal(left[1].name, all[1].name);
});

test("a backup file name can never point outside the backup folder", () => {
  assert.equal(backupPath("../../etc/passwd"), null);
  assert.equal(backupPath("pb-backup-2026-01-01_00-00-00.zip"), path.join(backupDir, "pb-backup-2026-01-01_00-00-00.zip"));
  assert.equal(safeJoin("/srv/media", "../../etc/passwd"), null);
  assert.equal(safeJoin("/srv/media", "/etc/passwd"), null);
  assert.equal(safeJoin("/srv/media", "C:\\Windows\\win.ini"), null);
  assert.equal(safeJoin("/srv/media", "nested/photo.png"), path.join("/srv/media", "nested", "photo.png"));
});

test("a zip that is not one of ours is refused with a sentence, not a stack trace", async () => {
  const notOurs = path.join(block, "random.zip");
  await writeZip(notOurs, [{ path: "hello.txt", data: "not a backup" }]);
  await assert.rejects(() => readBackupPayload(notOurs), (error) => {
    assert.ok(error instanceof SetupError);
    assert.match(error.message, /pb-restore\.json/);
    return true;
  });

  const garbage = path.join(block, "garbage.zip");
  await fs.writeFile(garbage, "this is not a zip at all");
  await assert.rejects(() => readBackupPayload(garbage), /not a readable zip/);
});

/** A connection that records statements and pretends the tables are there. */
function fakeConnection({ users = 0 } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      const text = String(sql);
      queries.push({ sql: text, params });
      if (text.includes("COUNT(*) AS n FROM users")) return [[{ n: users }]];
      if (text.includes("SELECT MAX(version) AS version FROM schema_migrations")) return [[{ version: 3 }]];
      if (text.includes("COUNT(*) AS n FROM schema_migrations")) return [[{ n: 3 }]];
      if (text.includes("COALESCE(MAX(id), 0)")) return [[{ n: 2 }]];
      return [{ affectedRows: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async end() {},
  };
}

test("restoring writes every account, image row and setting back", async () => {
  const all = await listBackups();
  const zipPath = path.join(backupDir, all[0].name);
  const connection = fakeConnection({ users: 0 });
  const connect = async () => connection;

  await fs.rm(installFile, { force: true }).catch(() => undefined);

  const result = await restoreBackup({
    zipPath,
    database: {
      host: "db.example.com",
      port: 3306,
      database: "pb_restored",
      user: "pb_user",
      password: "s3cret",
    },
    connect,
  });

  assert.equal(result.ok, true);
  assert.equal(result.users, 2);
  assert.equal(result.mediaRecords, 1);
  assert.equal(result.mediaFiles, 1, "the photograph was unpacked into MEDIA_DIR");

  const sql = connection.queries.map((entry) => entry.sql);
  // Table names are quoted for MySQL, which is also the visible proof that
  // they went through the allowlist in sqlSafety before reaching the driver.
  const insertUsers = connection.queries.find((entry) =>
    entry.sql.startsWith("INSERT INTO `users` (id, username, email, password_hash, role, disabled, created_at, last_login_at)"),
  );
  assert.ok(insertUsers, "users are inserted by their real column names");
  assert.ok(insertUsers.params.includes("$2b$10$abcdefghijklmnopqrstuv"), "the password hash travels");
  assert.ok(sql.some((statement) => statement.startsWith("INSERT INTO `media`")));
  assert.ok(sql.some((statement) => statement.includes("INSERT INTO site_content")));
  assert.ok(sql.some((statement) => statement.includes("INSERT INTO settings")));
  assert.ok(
    sql.some((statement) => statement.startsWith("ALTER TABLE users AUTO_INCREMENT")),
    "the next account cannot collide with a restored id",
  );

  // The connection details are saved, so the next boot opens this database.
  const saved = readInstall(installFile);
  assert.equal(saved.installed, true);
  assert.equal(saved.db.database, "pb_restored");
  assert.equal(saved.db.user, "pb_user");
  assert.equal(saved.db.password, "s3cret");
  assert.equal(publicInstall(saved).password, undefined);

  // And the media is on disk, byte for byte.
  const written = await fs.readFile(path.join(mediaDir, "photo.png"));
  assert.ok(written.equals(photo));
});

test("restoring over a database that already has accounts needs permission", async () => {
  const all = await listBackups();
  const zipPath = path.join(backupDir, all[0].name);

  await assert.rejects(
    () =>
      restoreBackup({
        zipPath,
        database: { host: "localhost", database: "pb_restored", user: "u", password: "p" },
        replace: false,
        connect: async () => fakeConnection({ users: 3 }),
      }),
    (error) => {
      assert.ok(error instanceof SetupError);
      assert.equal(error.status, 409);
      assert.match(error.message, /already holds 3 account/);
      return true;
    },
  );
});

test("a backup from a newer schema is refused instead of half-imported", async () => {
  const newer = path.join(block, "newer.zip");
  await writeZip(newer, [
    {
      path: "pb-restore.json",
      data: JSON.stringify({
        format: BACKUP_FORMAT,
        formatVersion: 1,
        app: { schemaVersion: 99 },
        data: { users: [] },
      }),
    },
  ]);

  await assert.rejects(
    () =>
      restoreBackup({
        zipPath: newer,
        database: { host: "localhost", database: "pb", user: "u", password: "p" },
        connect: async () => fakeConnection(),
      }),
    /schema version 99/,
  );
});
