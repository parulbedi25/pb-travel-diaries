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
 *   kind   `stays` (beds) or `essentials` (fuel, workshops, hospitals)
 *   lat/lng the point to search around, in degrees
 *
 * Answers `{ source, radiusKm, items, cached }`, where `source` says which
 * service actually answered — `overpass`, `nominatim`, `google` or `none`.
 */
import express from "express";
import { KINDS, searchNearbyCached } from "../lib/nearbySearch.js";

export const nearbyRouter = express.Router();

const problem = (message, status = 400) => Object.assign(new Error(message), { status });

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

    const result = await searchNearbyCached({ kind, lat, lng });
    // The cache goes out with the answer so a stale-but-useful list is
    // visibly old rather than quietly wrong; nothing here is personal.
    res.set("Cache-Control", "no-store");
    res.json({
      source: result.source,
      radiusKm: result.radiusKm,
      cached: Boolean(result.cached),
      items: result.items,
    });
  } catch (error) {
    next(error);
  }
});
