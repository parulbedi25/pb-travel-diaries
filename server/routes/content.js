import express from "express";
import { getRepo } from "../db/index.js";
import { requireUser } from "../lib/auth.js";

export const contentRouter = express.Router();

/**
 * The published site. Public: every visitor reads it on load.
 * An empty database answers `{ content: null }` and the app falls back to its
 * built-in defaults until an admin publishes for the first time.
 */
contentRouter.get("/content", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const row = await repo.getContent();
    if (!row) return res.json({ content: null, updatedAt: null, updatedBy: null });
    res.json({
      content: parseJson(row.content),
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Publish. Writes the content and its revision as one transaction, so the
 * history can never disagree with what is live.
 */
contentRouter.put("/content", requireUser, async (req, res, next) => {
  try {
    const repo = await getRepo();
    const content = req.body?.content;
    if (!content || typeof content !== "object") {
      return res.status(400).json({ error: "Expected a site content object." });
    }
    if (content.v !== 1 || !Array.isArray(content.sections)) {
      return res.status(400).json({ error: "That content does not look like a saved site." });
    }

    const description = String(req.body?.description ?? "").slice(0, 255) || "Website update";
    const revisionId = String(req.body?.revisionId ?? "").slice(0, 64) || `rev-${Date.now()}`;
    const serialised = JSON.stringify(content);
    if (serialised.length > 8_000_000) {
      return res.status(413).json({ error: "That site snapshot is too large to store." });
    }

    const revisions = await repo.putContent({
      content: serialised,
      description,
      revisionId,
      by: req.user.username,
    });

    res.json({ ok: true, revisions: revisions.map(publicRevision) });
  } catch (error) {
    next(error);
  }
});

contentRouter.get("/revisions", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const rows = await repo.listRevisions();
    res.json({ revisions: rows.map(publicRevision) });
  } catch (error) {
    next(error);
  }
});

contentRouter.delete("/revisions/:id", requireUser, async (req, res, next) => {
  try {
    const repo = await getRepo();
    const removed = await repo.deleteRevision(String(req.params.id).slice(0, 64));
    if (!removed) return res.status(404).json({ error: "No such revision." });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* ── settings that belong to the deployment rather than a page ─────────── */

export const settingsRouter = express.Router();

const THEME_VALUES = new Set(["dark", "light"]);

settingsRouter.get("/settings/theme", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const raw = await repo.getSetting("theme");
    const theme = parseJson(raw);
    res.json({ theme: THEME_VALUES.has(theme) ? theme : "dark" });
  } catch (error) {
    next(error);
  }
});

settingsRouter.put("/settings/theme", requireUser, async (req, res, next) => {
  try {
    const theme = String(req.body?.theme ?? "");
    if (!THEME_VALUES.has(theme)) return res.status(400).json({ error: "Theme must be dark or light." });
    const repo = await getRepo();
    await repo.setSetting("theme", JSON.stringify(theme));
    res.json({ ok: true, theme });
  } catch (error) {
    next(error);
  }
});

/* ── helpers ────────────────────────────────────────────────────────────── */

function publicRevision(row) {
  return {
    id: row.id,
    description: row.description,
    content: parseJson(row.content),
    timestamp: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ""),
    createdBy: row.createdBy ?? null,
  };
}

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
