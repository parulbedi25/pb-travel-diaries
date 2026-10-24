import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import { config } from "../config.js";
import { getRepo } from "../db/index.js";
import { requireEditor } from "../lib/auth.js";
import { bundledMedia } from "../lib/bundledMedia.js";

export const mediaRouter = express.Router();

/**
 * Uploaded files live in MEDIA_DIR (default ./media) as ordinary files with
 * random names, and are indexed in the `media` table. Keeping the bytes on
 * disk — rather than in the database or in a data URL — is what makes the
 * folder something you can copy, zip and back up on its own.
 */
await fs.mkdir(config.mediaDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
});

/** Extension whitelist, checked against the name the upload arrived with. */
const ALLOWED_EXT = new Set([
  "png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg", "heic", "heif",
  "pdf", "doc", "docx", "odt", "rtf", "pages",
  "xls", "xlsx", "ods", "csv", "numbers",
  "ppt", "pptx", "odp", "key",
  "txt", "md", "json", "zip", "gpx", "kml", "kmz", "mp4", "webm", "mov",
]);

const KIND_BY_EXT = {
  image: "png jpg jpeg webp gif avif bmp svg heic heif",
  pdf: "pdf",
  word: "doc docx odt rtf pages",
  excel: "xls xlsx ods csv numbers",
  powerpoint: "ppt pptx odp key",
  text: "txt md json",
  archive: "zip gpx kml kmz",
  video: "mp4 webm mov",
};

function kindFor(ext) {
  for (const [kind, list] of Object.entries(KIND_BY_EXT)) {
    if (list.split(" ").includes(ext)) return kind;
  }
  return "other";
}

/** The public URL a stored file is served from. */
const publicUrl = (filename) => `/media/${filename}`;

const toItem = (row) => ({
  id: row.id,
  name: row.originalName,
  type: row.mime,
  size: Number(row.size),
  // The dashboard treats this as the image source; a URL works everywhere a
  // data URL used to, and keeps the response small.
  dataUrl: row.url ?? publicUrl(row.filename),
  url: row.url ?? publicUrl(row.filename),
  addedAt:
    row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ""),
  kind: row.kind,
  ext: row.ext,
});

mediaRouter.get("/media", requireEditor, async (req, res, next) => {
  try {
    const repo = await getRepo();
    const rows = await repo.listMedia();
    // Uploads first, then the photographs that ship with the site, so the
    // shelf in the dashboard shows both and either can be picked.
    res.json({ media: [...rows.map(toItem), ...bundledMedia] });
  } catch (error) {
    next(error);
  }
});

mediaRouter.post("/media", requireEditor, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file arrived." });

    const originalName = String(req.file.originalname || "upload").slice(0, 255);
    const ext = path.extname(originalName).replace(".", "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return res.status(415).json({ error: `.${ext || "file"} is not a supported upload type.` });
    }

    const repo = await getRepo();
    const id = crypto.randomUUID();
    // Random name on disk: no collisions, no path traversal, no leaking the
    // original filename in a public URL.
    const filename = `${id}.${ext}`;
    await fs.writeFile(path.join(config.mediaDir, filename), req.file.buffer);

    const row = await repo.insertMedia({
      id,
      filename,
      originalName,
      mime: req.file.mimetype || "",
      size: req.file.size,
      kind: kindFor(ext),
      ext,
      createdBy: req.user.username,
    });

    res.status(201).json({ item: toItem(row) });
  } catch (error) {
    next(error);
  }
});

mediaRouter.delete("/media/:id", requireEditor, async (req, res, next) => {
  try {
    const repo = await getRepo();
    // Shipped photographs are part of the website, not of the upload folder.
    if (bundledMedia.some((item) => item.id === req.params.id)) {
      return res.status(403).json({
        error: "This photo ships with the website. Pick a different one instead.",
      });
    }

    const row = await repo.findMedia(String(req.params.id));
    if (!row) return res.status(404).json({ error: "No such file." });

    await repo.deleteMedia(row.id);
    try {
      await fs.unlink(path.join(config.mediaDir, row.filename));
    } catch (error) {
      // The index row is gone either way; a missing file is already the goal.
      if (error.code !== "ENOENT") throw error;
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
