/**
 * The dashboard's window onto `backup/`.
 *
 * Listing, taking one now, and downloading one. Every route needs an editor
 * session — a backup holds every account's password hash and the database
 * password, so it is the most sensitive file the app produces.
 */
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { requireEditor } from "../lib/auth.js";
import {
  backupPath,
  backupScheduleSummary,
  createBackup,
  listBackups,
} from "../lib/backup.js";
import { config } from "../config.js";

export const backupsRouter = express.Router();

/** When the timer will next write an archive, as an ISO string. */
function nextRunAt(now = new Date()) {
  const next = new Date(now);
  next.setHours(config.backup.hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

backupsRouter.get("/backups", requireEditor, async (req, res, next) => {
  try {
    const backups = await listBackups();
    res.json({
      ...backupScheduleSummary(),
      lastBackupAt: backups[0]?.createdAt ?? null,
      nextRunAt: config.backup.enabled ? nextRunAt() : null,
      backups,
    });
  } catch (error) {
    next(error);
  }
});

backupsRouter.post("/backups", requireEditor, async (req, res, next) => {
  try {
    const backup = await createBackup({ reason: "dashboard" });
    res.status(201).json({
      backup: { name: backup.name, bytes: backup.bytes, createdAt: backup.createdAt },
    });
  } catch (error) {
    next(error);
  }
});

backupsRouter.get("/backups/:name", requireEditor, async (req, res, next) => {
  try {
    const file = backupPath(req.params.name);
    if (!file) return res.status(400).json({ error: "That is not a backup file name." });
    if (!fs.existsSync(file)) return res.status(404).json({ error: "That backup is no longer here." });
    res.setHeader("Cache-Control", "no-store");
    res.download(file, path.basename(file), (error) => {
      // A cancelled download is not a server error; the response is already
      // on its way and can only be closed.
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    next(error);
  }
});
