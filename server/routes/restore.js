/**
 * Restoring a backup from the first-run setup screen.
 *
 * Two steps, because the archive is large and the database details inside it
 * may need editing before anything is written:
 *
 *   1. `POST /api/setup/restore/inspect` — the zip is uploaded and parked in
 *      `data/restore-uploads/`, and the screen is told what is inside it and
 *      which database it came from. Nothing is changed.
 *   2. `POST /api/setup/restore` — the file is imported into the database named
 *      in the request (the values from the file, corrected by the person if
 *      the new server differs), the media is unpacked, and `data/install.json`
 *      is written.
 *
 * Both are available only when the site has no database yet — the same lock as
 * the rest of the installer — so an unauthenticated visitor can never point a
 * live site at an archive of their choosing. An operator who has to restore
 * over a database the app already knows can set ALLOW_SITE_RESTORE=1.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import { config } from "../config.js";
import { resetRepo } from "../db/index.js";
import { inspectBackup, restoreBackup } from "../lib/backup.js";
import { SetupError } from "../lib/installer.js";
import { recordEvent } from "../lib/auth.js";

export const restoreRouter = express.Router();

/** Parked uploads. Created on demand, 0700 because the zips are sensitive. */
const uploadDir = path.join(config.root, "data", "restore-uploads");
await fs.mkdir(uploadDir, { recursive: true, mode: 0o700 }).catch(() => undefined);

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    // multer wants the name through the callback; returning it does nothing.
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.zip`),
  }),
  limits: { fileSize: config.maxRestoreMb * 1024 * 1024, files: 1 },
});

const isMemory = () => config.dbDriver === "memory";

/** Whether the restore screen may change anything at all. */
export function restoreAllowed() {
  if (isMemory()) return false;
  if (process.env.ALLOW_SITE_RESTORE === "1") return true;
  return !config.hasDatabase;
}

function refusal() {
  if (isMemory()) return { status: 403, error: "Restore is not used with the in-memory database." };
  return {
    status: 403,
    error:
      "This site already has a database configured. Restore is only available while the site is uninstalled — deploy the code without the data folder, or set ALLOW_SITE_RESTORE=1 to restore over it.",
  };
}

/** Delete uploads nobody came back for. */
async function sweepUploads(maxAgeMs = 60 * 60 * 1000) {
  let names = [];
  try {
    names = await fs.readdir(uploadDir);
  } catch {
    return;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const name of names) {
    const full = path.join(uploadDir, name);
    try {
      const stat = await fs.stat(full);
      if (stat.mtimeMs < cutoff) await fs.rm(full, { force: true });
    } catch {
      /* already gone */
    }
  }
}

/** An upload id is a UUID and nothing else; it never reaches the filesystem raw. */
function parkedFile(uploadId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(uploadId ?? ""))) return null;
  const full = path.join(uploadDir, `${uploadId}.zip`);
  if (!full.startsWith(uploadDir + path.sep)) return null;
  return full;
}

restoreRouter.post("/setup/restore/inspect", upload.single("file"), async (req, res, next) => {
  void sweepUploads();
  const cleanup = async () => {
    if (req.file?.path) await fs.rm(req.file.path, { force: true }).catch(() => undefined);
  };

  try {
    if (!restoreAllowed()) {
      await cleanup();
      const { status, error } = refusal();
      return res.status(status).json({ error });
    }
    if (!req.file) return res.status(400).json({ error: "Choose the backup zip first." });

    let summary;
    try {
      summary = await inspectBackup(req.file.path);
    } catch (error) {
      await cleanup();
      if (error instanceof SetupError) return res.status(error.status).json({ error: error.message });
      throw error;
    }

    res.json({
      uploadId: path.basename(req.file.filename, ".zip"),
      fileName: req.file.originalname,
      ...summary,
    });
  } catch (error) {
    if (error?.code === "LIMIT_FILE_SIZE") {
      await cleanup();
      return res.status(413).json({
        error: `That backup is larger than ${config.maxRestoreMb} MB. Raise MAX_RESTORE_MB and try again.`,
      });
    }
    next(error);
  }
});

restoreRouter.post("/setup/restore", async (req, res, next) => {
  try {
    if (!restoreAllowed()) {
      const { status, error } = refusal();
      return res.status(status).json({ error });
    }

    const file = parkedFile(req.body?.uploadId);
    if (!file) return res.status(400).json({ error: "Upload the backup zip first." });
    try {
      await fs.access(file);
    } catch {
      return res.status(410).json({ error: "That upload has expired. Upload the zip again." });
    }

    const result = await restoreBackup({
      zipPath: file,
      database: {
        connectionMode: req.body?.connectionMode,
        host: req.body?.host,
        port: req.body?.port,
        database: req.body?.database,
        user: req.body?.user,
        password: req.body?.password,
        socketPath: req.body?.socketPath,
      },
      replace: req.body?.replace === true,
    });

    // The running process was pointed at whatever database it started with.
    await resetRepo();
    await fs.rm(file, { force: true }).catch(() => undefined);

    await recordEvent(req, {
      username: "installer",
      event: "user_created",
      detail: `Restored a backup with ${result.users} account(s)`,
    });

    res.status(201).json({ ...result, next: "login" });
  } catch (error) {
    if (error instanceof SetupError) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});
