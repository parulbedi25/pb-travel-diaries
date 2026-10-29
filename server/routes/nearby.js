/**
 * The nearby search, as the page asks for it.
 *
 *   GET /api/nearby?kind=stays&lat=34.1526&lng=77.5771&place=Leh
 *
 * `place` is the stop the page is looking around. It is what makes the answer
 * the whole town rather than a circle around a pin: the name is geocoded for
 * its boundary, and the places query is clipped to that boundary by the
 * provider itself.
 *
 * The search runs here rather than in the browser for one reason: the API key.
 * It is a paid key with a daily quota, so it stays on the server — the page
 * asks this route, and this route is the only thing that ever sends it.
 *
 * Which key, in order: `GEOAPIFY_KEY` from the environment (the deployment's
 * own, and the one to use when the site's key is only meant for tiles), then
 * the key saved with the site's map settings in the dashboard, then the
 * built-in default that the build ships with. The saved key is read once a
 * minute rather than per request: it changes when an owner types a new one, and
 * that is not an every-search event.
 */
import express from "express";
import { getRepo } from "../db/index.js";
import { DEFAULT_GEOAPIFY_KEY, KINDS, searchNearbyCached } from "../lib/nearbySearch.js";

export const nearbyRouter = express.Router();

const problem = (message, status = 400) => Object.assign(new Error(message), { status });

const KEY_TTL_MS = 60_000;
let keyCache = { at: 0, key: "" };

function parse(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

/** The Geoapify key to spend on a search, from the environment or the site. */
async function geoapifyKey() {
  const fromEnv = String(process.env.GEOAPIFY_KEY ?? "").trim();
  if (fromEnv) return fromEnv;

  if (Date.now() - keyCache.at < KEY_TTL_MS && keyCache.key) return keyCache.key;

  let key = "";
  try {
    const repo = await getRepo();
    const row = await repo.getContent();
    const content = parse(row?.content);
    key = String(content?.map?.geoapifyKey ?? "").trim();
  } catch {
    // No database yet, or a site that has never been published: the default
    // key still draws the map, so it can still answer this question.
    key = "";
  }
  keyCache = { at: Date.now(), key: key || DEFAULT_GEOAPIFY_KEY };
  return keyCache.key;
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
    const place = String(req.query.place ?? "").trim().slice(0, 120);

    const result = await searchNearbyCached({ kind, lat, lng, place, key: await geoapifyKey() });

    // `tried` is what the page shows when it found nothing: it is the
    // difference between "there is nothing here" and "nothing answered". The
    // detail behind it goes to the log, where a refused key is worth reading.
    if (!result.items.length && result.notes?.length) {
      console.info(`nearby ${kind} ${lat.toFixed(3)},${lng.toFixed(3)}: ${result.notes.join(" | ")}`);
    }
    res.set("Cache-Control", "no-store");
    res.json({
      source: result.source,
      // The area the answer covers: the town's own boundary. When it could not
      // be found there is no area and no list — `reason` says so, because a
      // circle around the pin would answer with the next town.
      area: result.area ?? null,
      ...(result.reason ? { reason: result.reason } : {}),
      cached: Boolean(result.cached),
      items: result.items,
      ...(result.items.length ? {} : { tried: result.tried ?? [] }),
    });
  } catch (error) {
    next(error);
  }
});
