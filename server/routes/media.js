import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import { config } from "../config.js";
import { getRepo } from "../db/index.js";
import { requireEditor } from "../lib/auth.js";
import { bundledMedia } from "../lib/bundledMedia.js";
import { stripImageMetadata } from "../lib/imageMetadata.js";

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

/**
 * Tags travel as one comma-separated string in the row and as an array in the
 * API, so the dashboard never has to split on the client and a tag can never
 * contain the separator.
 */
const splitTags = (value) =>
  String(value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 40;

/** Trim, drop empties and duplicates, and cap the count — in that order. */
function normaliseTags(input) {
  const list = Array.isArray(input) ? input : String(input ?? "").split(",");
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const tag = String(raw ?? "")
      // A comma inside a tag would come back as two tags, so it goes.
      .replace(/[,\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

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
  tags: splitTags(row.tags),
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
    // A photo straight off a phone carries GPS coordinates, the device serial
    // and the time it was taken. Every upload is served from a public URL, so
    // that metadata is dropped before the bytes are stored — the pixels are
    // untouched, only the personal data goes.
    const clean = stripImageMetadata(req.file.buffer, req.file.mimetype);
    await fs.writeFile(path.join(config.mediaDir, filename), clean.buffer);

    const row = await repo.insertMedia({
      id,
      filename,
      originalName,
      mime: req.file.mimetype || "",
      size: clean.buffer.length,
      kind: kindFor(ext),
      ext,
      tags: normaliseTags(req.body?.tags).join(","),
      createdBy: req.user.username,
    });

    res.status(201).json({ item: toItem(row) });
  } catch (error) {
    next(error);
  }
});

/** Bundled photographs are files in the repo, not rows — neither can be edited. */
const isBundled = (id) => bundledMedia.some((item) => item.id === id);

/** Set a photo's tags. */
mediaRouter.patch("/media/:id", requireEditor, async (req, res, next) => {
  try {
    if (isBundled(req.params.id)) {
      return res.status(403).json({ error: "This photo ships with the website and cannot be tagged." });
    }
    const repo = await getRepo();
    const row = await repo.findMedia(String(req.params.id));
    if (!row) return res.status(404).json({ error: "No such file." });

    const tags = normaliseTags(req.body?.tags);
    await repo.updateMediaTags(row.id, tags.join(","));
    res.json({ item: toItem({ ...row, tags: tags.join(",") }) });
  } catch (error) {
    next(error);
  }
});

/**
 * Replace the pixels of an existing photo, keeping its id, its URL and its
 * place in the library. This is what the editor in the media popup saves:
 * contrast and brightness are baked into a new file, and everything already
 * pointing at the image picks the change up without being edited.
 */
mediaRouter.put("/media/:id/file", requireEditor, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file arrived." });
    if (isBundled(req.params.id)) {
      return res.status(403).json({ error: "This photo ships with the website and cannot be edited." });
    }

    const repo = await getRepo();
    const row = await repo.findMedia(String(req.params.id));
    if (!row) return res.status(404).json({ error: "No such file." });
    if (row.kind !== "image") {
      return res.status(415).json({ error: "Only photos can be edited." });
    }
    if (req.file.mimetype !== row.mime && !String(req.file.mimetype).startsWith("image/")) {
      return res.status(415).json({ error: "That is not an image." });
    }
    if (req.file.size > config.maxUploadMb * 1024 * 1024) {
      return res.status(413).json({ error: "That image is too large to store." });
    }

    // Same filename, so the URL — and every field using it — stays put. The
    // edited image is scrubbed of metadata just like a fresh upload.
    const clean = stripImageMetadata(req.file.buffer, req.file.mimetype);
    await fs.writeFile(path.join(config.mediaDir, row.filename), clean.buffer);
    const updated = await repo.updateMediaFile(row.id, {
      mime: req.file.mimetype || row.mime,
      size: clean.buffer.length,
    });
    if (!updated) return res.status(404).json({ error: "No such file." });

    res.json({ item: toItem({ ...row, mime: req.file.mimetype || row.mime, size: clean.buffer.length }) });
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
