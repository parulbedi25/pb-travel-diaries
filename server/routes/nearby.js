/**
 * The nearby search, as the page asks for it.
 *
 *   GET /api/nearby?kind=stays&lat=34.1526&lng=77.5771
 *
 * Deliberately open: it is the same public map data anyone could ask Overpass
 * for themselves, and it reveals nothing about the site. Doing it here rather
 * than in the browser is what makes it survivable — one mirror down, the next
 * one answers, and a tab that would have shown nothing shows a bed.
 *
 * The exception is the Google Places key, which is the owner's and never
 * leaves the server:
 *
 *   GET    /api/nearby/key     whether one is configured, and its last four
 *   PUT    /api/nearby/key     set or replace it                    (owner)
 *   DELETE /api/nearby/key     remove it                            (owner)
 */
import express from "express";
import { getRepo } from "../db/index.js";
import { requireOwner } from "../lib/auth.js";
import { KINDS, searchNearbyCached } from "../lib/nearbySearch.js";

export const nearbyRouter = express.Router();

const problem = (message, status = 400) => Object.assign(new Error(message), { status });

/** Where the owner's key is kept: the deployment's settings, not the content. */
export const GOOGLE_KEY_SETTING = "nearby_google_key";

/** The key, from the database, or from the environment when nothing is saved. */
export async function googleKeyFor(repo) {
  const saved = await repo.getSetting(GOOGLE_KEY_SETTING).catch(() => null);
  if (typeof saved === "string" && saved.length) {
    try {
      const parsed = JSON.parse(saved);
      if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
    } catch {
      // A value written before this existed is used as it stands.
      if (saved.trim()) return saved.trim();
    }
  }
  const fromEnv = String(process.env.GOOGLE_PLACES_API_KEY ?? "").trim();
  return fromEnv || "";
}

/****************************************************************************
 * The search
 ****************************************************************************/

nearbyRouter.get("/nearby", async (req, res, next) => {
  try {
    const kind = String(req.query.kind ?? "");
    if (!KINDS.includes(kind)) {
      throw problem(`Ask for one of: ${KINDS.join(", ")}.`);
    }
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw problem("A latitude between -90 and 90 is needed.");
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw problem("A longitude between -180 and 180 is needed.");

    const repo = await getRepo();
    const googleKey = await googleKeyFor(repo);
    const result = await searchNearbyCached({ kind, lat, lng, googleKey });

    // `tried` is what the page shows when it found nothing: it is the
    // difference between "there is nothing here" and "nothing answered". The
    // detail behind it goes to the log, where a mirror's 504 is worth reading.
    if (!result.items.length && result.notes?.length) {
      console.info(`nearby ${kind} ${lat.toFixed(3)},${lng.toFixed(3)}: ${result.notes.join(" | ")}`);
    }
    res.set("Cache-Control", "no-store");
    res.json({
      source: result.source,
      radiusKm: result.radiusKm,
      cached: Boolean(result.cached),
      items: result.items,
      googleKey: Boolean(googleKey),
      ...(result.items.length ? {} : { tried: result.tried ?? [] }),
    });
  } catch (error) {
    next(error);
  }
});

/****************************************************************************
 * The key
 ****************************************************************************/

/** Whether a key is set — never the key itself. */
nearbyRouter.get("/nearby/key", requireOwner, async (req, res, next) => {
  try {
    const repo = await getRepo();
    const key = await googleKeyFor(repo);
    const fromEnv = Boolean(String(process.env.GOOGLE_PLACES_API_KEY ?? "").trim());
    res.json({
      configured: Boolean(key),
      // Enough to recognise which key is in place, not enough to use it.
      hint: key ? `…${key.slice(-4)}` : "",
      source: fromEnv && key === String(process.env.GOOGLE_PLACES_API_KEY).trim() ? "environment" : key ? "saved" : "none",
    });
  } catch (error) {
    next(error);
  }
});

/** Set or replace the key. Owner only: it is their Google bill. */
nearbyRouter.put("/nearby/key", requireOwner, async (req, res, next) => {
  try {
    const key = String(req.body?.key ?? "").trim();
    if (key.length < 20) throw problem("That does not look like a Google API key — they are 39 characters long.");
    if (key.length > 200) throw problem("That key is too long to be a Google API key.");
    if (!/^[A-Za-z0-9_\-]+$/.test(key)) throw problem("A Google API key is letters, digits, dashes and underscores.");
    const repo = await getRepo();
    await repo.setSetting(GOOGLE_KEY_SETTING, JSON.stringify(key));
    res.json({ ok: true, configured: true, hint: `…${key.slice(-4)}`, source: "saved" });
  } catch (error) {
    next(error);
  }
});

/** Take it out again — usually because a key was rotated or is being revoked. */
nearbyRouter.delete("/nearby/key", requireOwner, async (req, res, next) => {
  try {
    const repo = await getRepo();
    await repo.setSetting(GOOGLE_KEY_SETTING, JSON.stringify(""));
    const fromEnv = Boolean(String(process.env.GOOGLE_PLACES_API_KEY ?? "").trim());
    res.json({ ok: true, configured: fromEnv, hint: "", source: fromEnv ? "environment" : "none" });
  } catch (error) {
    next(error);
  }
});
