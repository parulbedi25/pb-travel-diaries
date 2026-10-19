import express from "express";
import { config } from "../config.js";
import { getRepo } from "../db/index.js";
import { currentUser, requireEditor, signupAllowed } from "../lib/auth.js";

export const contentRouter = express.Router();

/**
 * What a visitor may see.
 *
 * Sections marked "members only" keep their place in the page — the locked card
 * needs the label and the anchor — but their data is removed, so the real
 * content never reaches a browser that has not signed in. Signed-in readers
 * get the full site; the gate is about accounts, not about which role.
 */
function visibleTo(content, signedIn) {
  if (signedIn || !Array.isArray(content?.sections)) return content;
  return {
    ...content,
    sections: content.sections.map((section) =>
      section?.membersOnly ? { ...section, locked: true, data: {} } : section,
    ),
  };
}

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
    const user = await currentUser(req);
    res.json({
      content: visibleTo(parseJson(row.content), Boolean(user)),
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
contentRouter.put("/content", requireEditor, async (req, res, next) => {
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

/**
 * Revision history contains full snapshots, including members-only sections,
 * so it is for editors only.
 */
contentRouter.get("/revisions", requireEditor, async (req, res, next) => {
  try {
    const repo = await getRepo();
    const rows = await repo.listRevisions();
    res.json({ revisions: rows.map(publicRevision) });
  } catch (error) {
    next(error);
  }
});

contentRouter.delete("/revisions/:id", requireEditor, async (req, res, next) => {
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

settingsRouter.put("/settings/theme", requireEditor, async (req, res, next) => {
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

/**
 * The site's own identity: its title and whether strangers may create an
 * account. Public because the page title and the members page need both
 * before anybody signs in.
 */
settingsRouter.get("/settings/site", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const savedTitle = parseJson(await repo.getSetting("site_title"));
    const title = typeof savedTitle === "string" && savedTitle.trim() ? savedTitle : config.siteTitle;
    res.json({ title, allowSignup: await signupAllowed(repo) });
  } catch (error) {
    next(error);
  }
});

settingsRouter.put("/settings/site", requireEditor, async (req, res, next) => {
  try {
    const repo = await getRepo();

    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim();
      if (title.length < 1) return res.status(400).json({ error: "The site needs a title." });
      if (title.length > 120) {
        return res.status(400).json({ error: "Keep the site title under 120 characters." });
      }
      await repo.setSetting("site_title", JSON.stringify(title));
      config.siteTitle = title;
    }

    if (req.body?.allowSignup !== undefined) {
      await repo.setSetting("allow_signup", JSON.stringify(Boolean(req.body.allowSignup)));
    }

    const savedTitle = parseJson(await repo.getSetting("site_title"));
    res.json({
      ok: true,
      title: typeof savedTitle === "string" && savedTitle.trim() ? savedTitle : config.siteTitle,
      allowSignup: await signupAllowed(repo),
    });
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
