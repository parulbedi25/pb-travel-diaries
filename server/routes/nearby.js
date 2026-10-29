/**
 * The nearby search, as the page asks for it.
 *
 *   GET /api/nearby?kind=stays&lat=34.1526&lng=77.5771&place=Leh
 *
 * `place` is the stop the page is looking around. It is what makes the answer
 * the whole town rather than a circle around a pin: the name is looked up once
 * for its boundary, and every source is then asked over that area.
 *
 * Deliberately open: it is the same public map data anyone could ask Overpass
 * for themselves, and it reveals nothing about the site. Doing it here rather
 * than in the browser is what makes it survivable — one mirror down, the next
 * one answers, and a tab that would have shown nothing shows a bed.
 *
 * Google is asked the same way, without an API key: the Maps search page is
 * fetched and read, so there is nothing to pay for and nothing to configure.
 */
import express from "express";
import { KINDS, searchNearbyCached } from "../lib/nearbySearch.js";

export const nearbyRouter = express.Router();

const problem = (message, status = 400) => Object.assign(new Error(message), { status });

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

    const result = await searchNearbyCached({ kind, lat, lng, place });

    // `tried` is what the page shows when it found nothing: it is the
    // difference between "there is nothing here" and "nothing answered". The
    // detail behind it goes to the log, where a mirror's 504 is worth reading.
    if (!result.items.length && result.notes?.length) {
      console.info(`nearby ${kind} ${lat.toFixed(3)},${lng.toFixed(3)}: ${result.notes.join(" | ")}`);
    }
    res.set("Cache-Control", "no-store");
    res.json({
      source: result.source,
      // The area the answer covers: the town's own box. When its boundary
      // could not be found there is no box and no list — `reason` says so,
      // because a circle around the pin would answer with the next town.
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
