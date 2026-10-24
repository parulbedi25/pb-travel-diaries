import { databaseIdentifier } from "./sqlSafety.js";
/**
 * The daily backup, and the importer that puts one back.
 *
 * Every archive is a normal zip with four things inside:
 *
 *   pb-restore.json   the whole database as plain JSON — accounts, password
 *                     hashes, the site and its history, the media index, every
 *                     setting — plus the database details this installation
 *                     was using. Edit the `database` block in a text editor and
 *                     the file points at a different database; that is what
 *                     makes it standalone.
 *   media/            the uploaded files, byte for byte.
 *   app/              the application itself, so a redeploy is unzip-and-run.
 *                   (Leave it out with BACKUP_INCLUDE_APP=false.)
 *   RESTORE-README.txt  what the file is and how to put it back.
 *
 * Archives land in `backup/` at the project root (created on first use) and
 * the newest BACKUP_KEEP are kept — ten by default. The folder is not served
 * by Express; it is only reachable through the dashboard, which requires an
 * editor session.
 */
import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { applyInstall, config } from "../config.js";
import { applySchema, LATEST_VERSION } from "../db/schema.js";
import { getRepo } from "../db/index.js";
import { installFilePath, publicInstall, readInstall, writeInstall } from "./installFile.js";
import { connectionOptions, friendlyDatabaseError, SetupError, validateDatabase } from "./installer.js";
import { extractTo, readZipText, safeJoin, walkZipEntries, writeZip } from "./zip.js";

/** What a backup calls itself, so the importer can recognise one. */
export const BACKUP_FORMAT = "pb-restore";
export const BACKUP_FORMAT_VERSION = 1;

const ZIP_PATTERN = /^pb-backup-[\w.-]+\.zip$/;

/* ── the archive's contents ───────────────────────────────────────────── */

/** Files at the project root that belong in `app/`. */
const APP_FILES = [
  "app.cjs",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "README.md",
  "RUNNING.md",
  "DEPLOYMENT.md",
  "NAMECHEAP.md",
  "OPTIMIZATION.md",
  "SQL-SECURITY.md",
  "SQLITE.md",
  ".env.example",
];

/** Folders that belong in `app/`, walked recursively. */
const APP_DIRS = ["server", "src", "public", "dist", "media/starter"];

/** Never archived, whatever folder they appear in. */
const SKIP_DIRS = new Set(["node_modules", ".git", "backup", "release", "data", ".s"]);

async function* walkFiles(dir, base = dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full, base);
    } else if (entry.isFile()) {
      yield { file: full, path: path.relative(base, full) };
    }
  }
}

const iso = (value) => {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

/**
 * The `pb-restore.json` body: everything the database holds, plus the
 * connection details this installation is using.
 */
export async function buildRestorePayload({ reason = "manual", repo, at = new Date() } = {}) {
  const source = repo ?? (await getRepo());
  const data = await source.exportAll();
  const install = readInstall();

  const database = install?.db?.driver === "sqlite" ? { driver: "sqlite", database: "pbfrompb" } : install?.db
    ? {
        host: install.db.host,
        port: install.db.port,
        database: install.db.database,
        user: install.db.user,
        password: install.db.password,
        socketPath: install.db.socketPath ?? "",
      }
    : null;

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: at.toISOString(),
    reason,
    siteTitle: config.siteTitle,
    app: {
      name: "PB Travel Diaries",
      schemaVersion: LATEST_VERSION,
      node: process.version,
    },
    // Passwords for the database this backup came from. Deliberately part of
    // the file: restoring onto a new server should not require remembering
    // them. The archive itself is written 0600 inside a 0700 folder.
    database,
    data: {
      users: data.users.map((user) => ({
        ...user,
        disabled: user.disabled ? 1 : 0,
        disabledAt: iso(user.disabledAt),
        createdAt: iso(user.createdAt),
        lastLoginAt: iso(user.lastLoginAt),
      })),
      settings: data.settings,
      media: data.media.map((item) => ({ ...item, createdAt: iso(item.createdAt) })),
      authEvents: data.authEvents.map((event) => ({ ...event, createdAt: iso(event.createdAt) })),
      revisions: data.revisions.map((revision) => ({
        ...revision,
        createdAt: iso(revision.createdAt),
      })),
      content: data.content
        ? { ...data.content, updatedAt: iso(data.content.updatedAt) }
        : null,
    },
  };
}

const RESTORE_README = (createdAt) => `PB Travel Diaries — backup
=====================================

Created: ${createdAt}

What is in this zip
-------------------
  pb-restore.json    Every account (with its password hash), the published
                     site and its revision history, the media index, all the
                     settings, the access log, and the database details this
                     installation used. This is the file you import.
  media/             The uploaded photographs and documents.
  app/               The application's own files, so a fresh server can be
                     deployed from this zip alone.

How to restore
--------------
  1. Put the application on the server (copy the app/ folder out of this zip,
     or deploy the code as usual) and run \`npm ci\` there.
  2. Open the site. On the first-run setup screen choose "Restore a backup",
     upload this zip, and check the database details it fills in.
  3. If the new server uses a different database name, user or password,
     change them on that screen before pressing Restore. (You can also edit
     the "database" block in pb-restore.json and re-zip it — the screen reads
     the file either way.)
  4. Press Restore. Every account, image and setting is written back, and you
     sign in with the password you already had.

The database must be created in your hosting panel first if the app's user is
not allowed to create it. Nothing here needs importing through phpMyAdmin.

Keep this file private: pb-restore.json contains database credentials and the
password hashes of every account.
`;

/* ── writing a backup ─────────────────────────────────────────────────── */

export async function ensureBackupDir() {
  await fs.mkdir(config.backup.dir, { recursive: true, mode: 0o700 });
  try {
    await fs.chmod(config.backup.dir, 0o700);
  } catch {
    /* some hosts manage permissions themselves */
  }
  return config.backup.dir;
}

const stamp = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}-${String(
    date.getMinutes(),
  ).padStart(2, "0")}-${String(date.getSeconds()).padStart(2, "0")}`;

/**
 * Write one archive. Resolves with `{ name, path, bytes, createdAt }`.
 *
 * The order matters for a restore: `pb-restore.json` is written first, so an
 * interrupted archive is still recognisable as a backup (and is discarded by
 * the filename check anyway).
 */
export async function createBackup({ reason = "manual", repo, at = new Date() } = {}) {
  const payload = await buildRestorePayload({ reason, repo, at });
  const dir = await ensureBackupDir();
  const createdAt = new Date(payload.createdAt);
  const name = `pb-backup-${stamp(createdAt)}.zip`;
  const target = path.join(dir, name);
  const partial = `${target}.part`;

  const entries = async function* () {
    yield { path: "RESTORE-README.txt", data: RESTORE_README(payload.createdAt) };
    yield { path: "pb-restore.json", data: JSON.stringify(payload, null, 2) };

    // Uploaded media, byte for byte, under media/<same name>.
    for await (const file of walkFiles(config.mediaDir)) {
      yield { path: `media/${file.path}`, file: file.file };
    }

    // The application's own files, so the zip can also rebuild the server.
    if (config.backup.includeApp) {
      for (const name of APP_FILES) {
        const full = path.join(config.root, name);
        try {
          await fs.access(full);
          yield { path: `app/${name}`, file: full };
        } catch {
          /* optional file, not present in this checkout */
        }
      }
      for (const folder of APP_DIRS) {
        const full = path.join(config.root, folder);
        try {
          await fs.access(full);
        } catch {
          continue;
        }
        for await (const file of walkFiles(full)) {
          yield { path: `app/${folder}/${file.path}`, file: file.file };
        }
      }
    }
  };

  try {
    await writeZip(partial, entries());
    await fs.rename(partial, target);
  } catch (error) {
    await fs.rm(partial, { force: true }).catch(() => undefined);
    throw error;
  }

  const stat = await fs.stat(target);
  await pruneBackups(config.backup.keep);
  return { name, path: target, bytes: stat.size, createdAt: payload.createdAt, reason };
}

/** Newest first. The dashboard lists these. */
export async function listBackups() {
  await ensureBackupDir();
  const names = await fs.readdir(config.backup.dir).catch(() => []);
  const found = [];
  for (const name of names) {
    if (!ZIP_PATTERN.test(name)) continue;
    const full = path.join(config.backup.dir, name);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      found.push({ name, bytes: stat.size, createdAt: stat.mtime.toISOString() });
    } catch {
      /* vanished between readdir and stat */
    }
  }
  return found.sort((a, b) => (a.name < b.name ? 1 : -1));
}

/** Delete all but the newest `keep` archives. */
export async function pruneBackups(keep = config.backup.keep) {
  const all = await listBackups();
  const doomed = all.slice(Math.max(1, keep));
  for (const backup of doomed) {
    await fs.rm(path.join(config.backup.dir, backup.name), { force: true });
  }
  return doomed.map((backup) => backup.name);
}

/** Absolute path for one archive, or null if the name is not one of ours. */
export function backupPath(name) {
  if (!ZIP_PATTERN.test(String(name))) return null;
  const target = safeJoin(config.backup.dir, name);
  if (!target) return null;
  return target;
}

/* ── reading a backup ─────────────────────────────────────────────────── */

/** Parse `pb-restore.json` out of an archive. Throws a SetupError if absent. */
export async function readBackupPayload(zipPath) {
  let text = null;
  try {
    text = await readZipText(zipPath, "pb-restore.json");
  } catch {
    throw new SetupError("That file is not a readable zip archive. Upload the .zip the backup created.");
  }
  if (!text) {
    throw new SetupError(
      "That zip is not a PB Travel Diaries backup — it has no pb-restore.json inside.",
    );
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new SetupError("The pb-restore.json inside that archive is not valid JSON.");
  }
  if (payload?.format !== BACKUP_FORMAT) {
    throw new SetupError("That pb-restore.json was not written by this app.");
  }
  if (Number(payload.formatVersion) > BACKUP_FORMAT_VERSION) {
    throw new SetupError(
      "That backup was made by a newer version of the app. Update the app, then restore it.",
    );
  }
  return payload;
}

/**
 * What the restore screen shows before doing anything: whose backup it is,
 * how much is inside, and the database it came from.
 */
export async function inspectBackup(zipPath) {
  const payload = await readBackupPayload(zipPath);
  const data = payload.data ?? {};
  let mediaFiles = 0;
  let mediaBytes = 0;
  let hasApp = false;
  await walkZipEntries(zipPath, ({ path: name, size }) => {
    if (name.startsWith("media/")) {
      mediaFiles += 1;
      mediaBytes += size ?? 0;
    }
    if (name.startsWith("app/")) hasApp = true;
    return true;
  });

  return {
    siteTitle: payload.siteTitle ?? "PB Travel Diaries",
    createdAt: payload.createdAt ?? null,
    reason: payload.reason ?? "",
    schemaVersion: Number(payload.app?.schemaVersion) || 0,
    database: payload.database ?? null,
    users: data.users?.length ?? 0,
    revisions: data.revisions?.length ?? 0,
    mediaFiles,
    mediaBytes,
    hasApp,
    hasContent: Boolean(data.content),
  };
}

/* ── restoring ────────────────────────────────────────────────────────── */

/** An ISO string from the JSON as MySQL's DATETIME. `null` stays null. */
function sqlDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function sqlDateMs(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 23).replace("T", " ");
}

/**
 * Insert many rows with one statement per chunk. `columns` are real column
 * names; `rows` are arrays of values in the same order.
 */
async function insertRows(connection, table, columns, rows) {
  if (!rows?.length) return 0;
  const CHUNK = 100;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const slice = rows.slice(start, start + CHUNK);
    const placeholders = slice.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
    await connection.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders}`,
      slice.flat(),
    );
  }
  return rows.length;
}

/**
 * Write an archive back into a database, and its media back onto disk.
 *
 * The tables are created as the backup remembers them (its own schema
 * version), the rows are loaded, and only then is the rest of the migration
 * list applied — so a future migration that backfills existing rows sees the
 * restored data rather than an empty table.
 */
export async function restoreBackup({ zipPath, database, replace = false, connect = mysql.createConnection } = {}) {
  const payload = await readBackupPayload(zipPath);

  const backupVersion = Number(payload.app?.schemaVersion) || 1;
  if (backupVersion > LATEST_VERSION) {
    throw new SetupError(
      `That backup is from schema version ${backupVersion}, but this installation only knows ` +
        `version ${LATEST_VERSION}. Deploy the newer code first, then restore.`,
    );
  }

  if (database?.connectionMode === "local" || (database?.connectionMode == null && payload.database?.driver === "sqlite")) {
    const { restoreSqlite } = await import("./sqliteRestore.js");
    return restoreSqlite({ payload, zipPath, replace });
  }

  // Database details: what the file remembers, overridden by anything typed on
  // the restore screen.
  const merged = {
    ...(payload.database ?? {}),
    ...Object.fromEntries(
      Object.entries(database ?? {}).filter(([, value]) => value !== undefined && value !== ""),
    ),
  };
  let db;
  try {
    db = validateDatabase(merged);
  } catch (error) {
    if (error instanceof SetupError) throw error;
    throw new SetupError("Fill in the database name, user and password before restoring.");
  }
  if (!db.database) {
    throw new SetupError("That backup has no database name in it — enter one on this screen.");
  }

  const data = payload.data ?? {};
  const counts = { users: 0, revisions: 0, media: 0, authEvents: 0, settings: 0 };

  /* 1. The database itself. */

  let server;
  try {
    server = await connect(connectionOptions(db, { withDatabase: false }));
  } catch (error) {
    throw new SetupError(friendlyDatabaseError(error, db), 400);
  }
  try {
    try {
      await server.query(
        `CREATE DATABASE IF NOT EXISTS ${databaseIdentifier(db.database)}
         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
    } catch {
      // Shared hosting rarely allows this; the panel makes the database. The
      // connection below says whether it exists and is granted.
    }
  } finally {
    await server.end();
  }

  let connection;
  try {
    connection = await connect(connectionOptions(db, { withDatabase: true }));
  } catch (error) {
    throw new SetupError(friendlyDatabaseError(error, db), 400);
  }

  try {
    const [existing] = await connection.query("SELECT COUNT(*) AS n FROM users").catch(() => [[{ n: 0 }]]);
    const present = Number(existing?.[0]?.n ?? 0);
    if (present > 0 && !replace) {
      throw new SetupError(
        `The database “${db.database}” already holds ${present} account(s). ` +
          "Tick “Replace what is in that database” if this restore should overwrite it.",
        409,
      );
    }

    // Build the tables at the backup's version, load the rows, then catch up.
    await applySchema(connection, { upTo: backupVersion });

    await connection.beginTransaction();
    try {
      if (present > 0) {
        for (const table of [
          "sessions",
          "auth_events",
          "media",
          "revisions",
          "site_content",
          "users",
          "settings",
        ]) {
          await connection.query(`DELETE FROM ${table}`);
        }
      }

      counts.users = await insertRows(
        connection,
        "users",
        ["id", "username", "email", "password_hash", "role", "disabled", "created_at", "last_login_at"],
        (data.users ?? []).map((user) => [
          user.id,
          user.username,
          user.email ?? null,
          user.passwordHash,
          user.role ?? "reader",
          user.disabled ? 1 : 0,
          sqlDate(user.createdAt),
          sqlDate(user.lastLoginAt),
        ]),
      );

      if (data.content?.content) {
        await connection.query(
          `INSERT INTO site_content (id, content, updated_at, updated_by) VALUES (1, ?, ?, ?)
           ON DUPLICATE KEY UPDATE content = VALUES(content), updated_by = VALUES(updated_by)`,
          [data.content.content, sqlDate(data.content.updatedAt) ?? sqlDate(new Date()), data.content.updatedBy ?? null],
        );
      }

      counts.revisions = await insertRows(
        connection,
        "revisions",
        ["id", "description", "content", "created_at", "created_by"],
        (data.revisions ?? []).map((revision) => [
          revision.id,
          revision.description ?? "",
          revision.content,
          sqlDateMs(revision.createdAt),
          revision.createdBy ?? null,
        ]),
      );

      counts.media = await insertRows(
        connection,
        "media",
        ["id", "filename", "original_name", "mime", "size", "kind", "ext", "created_at", "created_by"],
        (data.media ?? []).map((item) => [
          item.id,
          item.filename,
          item.originalName ?? item.filename,
          item.mime ?? "",
          item.size ?? 0,
          item.kind ?? "other",
          item.ext ?? "",
          sqlDateMs(item.createdAt) ?? sqlDateMs(new Date()),
          item.createdBy ?? null,
        ]),
      );

      counts.authEvents = await insertRows(
        connection,
        "auth_events",
        ["id", "user_id", "username", "event", "ip", "user_agent", "detail", "created_at"],
        (data.authEvents ?? []).map((event) => [
          event.id,
          event.userId ?? null,
          event.username ?? "",
          event.event,
          event.ip ?? null,
          event.userAgent ?? null,
          event.detail ?? null,
          sqlDateMs(event.createdAt) ?? sqlDateMs(new Date()),
        ]),
      );

      for (const setting of data.settings ?? []) {
        if (!setting?.settingKey) continue;
        await connection.query(
          `INSERT INTO settings (setting_key, value) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE value = VALUES(value)`,
          [setting.settingKey, setting.value],
        );
        counts.settings += 1;
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    }

    // Anything this installation knows that the backup did not: run now, on
    // top of the restored rows.
    await applySchema(connection);
    await connection.query(
      `INSERT INTO settings (setting_key, value) VALUES ('schema_version', ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [String(LATEST_VERSION)],
    );

    // AUTO_INCREMENT must sit above the highest restored id.
    const [maxUser] = await connection.query("SELECT COALESCE(MAX(id), 0) AS n FROM users");
    await connection.query(`ALTER TABLE users AUTO_INCREMENT = ${Number(maxUser?.[0]?.n ?? 0) + 1}`);
  } catch (error) {
    if (error instanceof SetupError) throw error;
    if (error?.code === "ER_BAD_DB_ERROR") {
      throw new SetupError(
        `The database “${db.database}” does not exist and this user may not create it. ` +
          "Create it in your hosting panel first, then restore again.",
        400,
      );
    }
    throw new SetupError(`The backup could not be written: ${error?.message ?? "unknown error"}`, 400);
  } finally {
    await connection.end();
  }

  /* 2. The media files, into MEDIA_DIR. */

  const mediaDir = config.mediaDir;
  const extracted = await extractTo(zipPath, mediaDir, { prefix: "media/" }).catch(() => ({
    files: 0,
    bytes: 0,
  }));

  /* 3. The connection details, so the next boot knows where the data is. */

  const answers = {
    installed: true,
    siteTitle: payload.siteTitle || config.siteTitle,
    db: {
      host: db.host,
      port: db.port,
      database: db.database,
      user: db.user,
      password: db.password,
      ...(db.socketPath ? { socketPath: db.socketPath } : {}),
    },
    schemaVersion: LATEST_VERSION,
    installedAt: new Date().toISOString(),
    restoredFrom: payload.createdAt ?? null,
  };
  try {
    writeInstall(answers, installFilePath());
  } catch {
    throw new SetupError(
      "The data is restored, but the app could not save its connection details. " +
        "Make the data folder writable (chmod 775 data) and run the restore again.",
      500,
    );
  }
  applyInstall(answers);

  return {
    ok: true,
    siteTitle: answers.siteTitle,
    db: publicInstall(answers),
    users: counts.users,
    revisions: counts.revisions,
    mediaRecords: counts.media,
    mediaFiles: extracted.files,
    authEvents: counts.authEvents,
    settings: counts.settings,
    schemaVersion: LATEST_VERSION,
    restoredFrom: payload.createdAt ?? null,
  };
}

/* ── the daily timer ──────────────────────────────────────────────────── */

let timer = null;

/** Has a backup already been written today (local time)? */
async function backedUpToday() {
  const today = new Date().toDateString();
  const newest = (await listBackups())[0];
  return Boolean(newest) && new Date(newest.createdAt).toDateString() === today;
}

/** Run the daily backup if it is due. Safe to call as often as you like. */
export async function runScheduledBackup(now = new Date()) {
  if (!config.backup.enabled) return null;
  if (now.getHours() < config.backup.hour) return null;
  if (await backedUpToday()) return null;
  return createBackup({ reason: "scheduled" });
}

/**
 * Start the daily run. Checks every fifteen minutes rather than sleeping until
 * the exact hour, so a laptop asleep at 2am still gets its backup when it
 * wakes, and a clock change cannot skip a day.
 */
export function startBackupScheduler({ intervalMs = 15 * 60 * 1000, firstDelayMs = 20 * 1000 } = {}) {
  // The in-memory driver is for tests and local demos; it has nothing worth
  // archiving and would fill the folder with empty copies.
  if (!config.backup.enabled || config.dbDriver === "memory") return null;
  if (timer) return timer;

  const tick = () => {
    void runScheduledBackup()
      .then((result) => {
        if (result) console.log(`[backup] wrote ${result.name} (${Math.round(result.bytes / 1024)} KB)`);
      })
      .catch((error) => console.error("[backup] failed:", error.message));
  };

  const first = setTimeout(tick, firstDelayMs);
  first.unref?.();
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return timer;
}

export function stopBackupScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Message text for the dashboard: when the next run is due. */
export function backupScheduleSummary() {
  const { enabled, hour, keep, dir } = config.backup;
  return {
    enabled,
    hour,
    keep,
    dir,
    includeApp: config.backup.includeApp,
  };
}
