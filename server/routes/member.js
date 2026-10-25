/**
 * The member's own corner of the site.
 *
 * Everything here is behind a signed-in account and scoped to that account's
 * id, in the query itself. A member's garage and rides are not part of the
 * site's content: nothing in this file reads or writes `site_content`, so no
 * amount of use here can change a public page, a section, or the dashboard the
 * owner edits. A member who is also the owner sees the same private garage as
 * anybody else — it does not merge into the site.
 *
 * Shapes, briefly:
 *
 *   GET    /member/catalogue            makers, models, their average mileage
 *   GET    /member/bikes                the garage, oldest first
 *   POST   /member/bikes                add a bike (mileage optional → estimated)
 *   PATCH  /member/bikes/:id            correct one
 *   DELETE /member/bikes/:id            remove one; its rides keep their distance
 *
 *   GET    /member/journeys             rides, newest first, already measured
 *   POST   /member/journeys             a new ride, from pins or an imported link
 *   PATCH  /member/journeys/:id         edit one
 *   DELETE /member/journeys/:id         remove one
 *
 *   POST   /member/link                 expand a short map link for the rider
 *
 * Every journey in a response carries `maths` (one-way, round trip, litres)
 * and `perBike`, so the dashboard never does arithmetic of its own.
 */
import express from "express";
import { getRepo } from "../db/index.js";
import { requireUser } from "../lib/auth.js";
import {
  estimateMileage,
  listBikeCatalogue,
  makerName,
  modelName,
} from "../lib/bikeCatalogue.js";
import { journeyMath, petrolPerBike } from "../lib/tripMath.js";
import { expandMapLink, MapLinkError } from "./maps.js";

export const memberRouter = express.Router();

const MAX_STOPS = 60;
const MAX_GALLERY = 24;
const MAX_NOTE = 20_000;
const MAX_TITLE = 120;

/* ── validation ──────────────────────────────────────────────────────── */

const yearProblem = (year) => {
  if (year == null || year === "") return null;
  const value = Number(year);
  const now = new Date().getFullYear();
  if (!Number.isInteger(value) || value < 1970 || value > now + 1) {
    return `The purchase year should be between 1970 and ${now + 1}.`;
  }
  return null;
};

const mileageProblem = (kmpl) => {
  if (kmpl == null || kmpl === "") return null;
  const value = Number(kmpl);
  if (!Number.isFinite(value) || value <= 0 || value > 200) {
    return "The mileage should be between 1 and 200 km per litre.";
  }
  return null;
};

const problem = (message) => Object.assign(new Error(message), { status: 400 });

/** A bike, from whatever the form sent. Names are normalised to the catalogue. */
function readBike(body, { existing } = {}) {
  const maker = makerName(body?.maker ?? existing?.maker);
  const model = modelName(body?.maker ?? existing?.maker, body?.model ?? existing?.model);
  if (!maker) throw problem("Choose the bike's maker.");
  if (!model) throw problem("Choose the bike's model.");

  const rawYear = body?.year ?? existing?.year ?? null;
  const rawMileage = body?.mileageKmpl ?? body?.mileage ?? existing?.mileageKmpl ?? null;

  const yearError = yearProblem(rawYear);
  if (yearError) throw problem(yearError);
  const mileageError = mileageProblem(rawMileage);
  if (mileageError) throw problem(mileageError);

  const year = rawYear == null || rawYear === "" ? null : Number(rawYear);
  const typed = rawMileage == null || rawMileage === "" ? null : Number(rawMileage);
  const estimate = estimateMileage({ maker, model, year });

  return {
    maker,
    model,
    year,
    // Left blank on purpose, so it is filled in from the catalogue: the member
    // gets a usable figure at once and can replace it whenever they measure one.
    mileageKmpl: typed ?? estimate.kmpl,
    mileageSource: typed != null ? "manual" : "estimated",
    estimateNote: estimate.note,
  };
}

/** Stops are pins: a name is nice, a coordinate is required. */
function readStops(input) {
  const list = Array.isArray(input) ? input : [];
  if (list.length > MAX_STOPS) throw problem(`A ride can hold up to ${MAX_STOPS} stops.`);
  const stops = [];
  for (const raw of list) {
    const lat = Number(raw?.lat);
    const lng = Number(raw?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw problem("One of the stops has a coordinate outside the map.");
    }
    stops.push({
      name: String(raw?.name ?? "").trim().slice(0, 120) || `${lat.toFixed(3)}, ${lng.toFixed(3)}`,
      lat,
      lng,
      ...(Number.isFinite(Number(raw?.altitudeM)) ? { altitudeM: Math.round(Number(raw.altitudeM)) } : {}),
    });
  }
  return stops;
}

function readGallery(input) {
  const list = Array.isArray(input) ? input : [];
  return list
    .slice(0, MAX_GALLERY)
    .map((raw) => ({
      url: String(raw?.url ?? "").trim().slice(0, 2000),
      caption: String(raw?.caption ?? "").trim().slice(0, 200),
    }))
    .filter((entry) => entry.url);
}

/** One journey, validated against the member's own garage. */
function readJourney(body, bikes, { existing } = {}) {
  const owner = new Set(bikes.map((bike) => bike.id));
  const rawBikeId = body?.bikeId ?? existing?.bikeId ?? null;
  let bikeId = rawBikeId == null || rawBikeId === "" ? null : Number(rawBikeId);
  if (bikeId != null && !owner.has(bikeId)) {
    // Not "forbidden": from this member's point of view that bike simply is
    // not in their garage, and saying more would confirm it exists elsewhere.
    throw problem("Pick a bike from your own garage.");
  }

  const stops = readStops(body?.stops ?? existing?.stops ?? []);
  const title =
    String(body?.title ?? existing?.title ?? "").trim().slice(0, MAX_TITLE) ||
    (stops.length > 1 ? `${stops[0].name} → ${stops.at(-1).name}` : "New ride");

  const notes = String(body?.notes ?? existing?.notes ?? "").slice(0, MAX_NOTE);
  const gallery = readGallery(body?.gallery ?? existing?.gallery ?? []);
  const roundTrip = Boolean(body?.roundTrip ?? existing?.roundTrip ?? false);

  return { title, bikeId, stops, notes, gallery, roundTrip };
}

/** What the dashboard reads back: the ride plus every number it will show. */
function present(journey, bikes) {
  const chosen = bikes.find((bike) => bike.id === journey.bikeId) ?? null;
  return {
    ...journey,
    maths: journeyMath(journey.stops, {
      kmpl: chosen?.mileageKmpl ?? null,
      roundTrip: journey.roundTrip,
    }),
    perBike: petrolPerBike(journey.stops, bikes),
  };
}

const presentBike = (bike) => ({
  ...bike,
  estimateNote: estimateMileage({ maker: bike.maker, model: bike.model, year: bike.year }).note,
  /** Litres for a 100 km ride, so a garage list says something at a glance. */
  litresPer100Km: bike.mileageKmpl ? Math.round((100 / bike.mileageKmpl) * 10) / 10 : null,
});

/* ── garage ──────────────────────────────────────────────────────────── */

/**
 * The catalogue is the one open endpoint in this file, and deliberately so:
 * the signup form has to offer makers and models *before* an account exists.
 * It is a fixed list of bikes — no member's data touches it.
 */
memberRouter.get("/member/catalogue", (_req, res) => {
  res.json({ makers: listBikeCatalogue() });
});

// Everything below is the member's own: no session, no garage.
memberRouter.use("/member", requireUser);

memberRouter.get("/member/bikes", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const bikes = await repo.listBikes(req.user.id);
    res.json({ bikes: bikes.map(presentBike) });
  } catch (error) {
    next(error);
  }
});

memberRouter.post("/member/bikes", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const bike = readBike(req.body);
    const id = await repo.createBike(req.user.id, bike);
    const created = (await repo.listBikes(req.user.id)).find((entry) => entry.id === id);
    res.status(201).json({
      bike: presentBike(created ?? { id, ...bike }),
      bikes: (await repo.listBikes(req.user.id)).map(presentBike),
      estimateNote: bike.estimateNote,
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    next(error);
  }
});

memberRouter.patch("/member/bikes/:id", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const bikes = await repo.listBikes(req.user.id);
    const current = bikes.find((bike) => bike.id === Number(req.params.id));
    if (!current) return res.status(404).json({ error: "That bike is not in your garage." });
    const bike = readBike(req.body, { existing: current });
    const ok = await repo.updateBike(req.user.id, current.id, bike);
    if (!ok) return res.status(404).json({ error: "That bike is not in your garage." });
    const saved = await repo.listBikes(req.user.id);
    res.json({
      bike: presentBike(saved.find((entry) => entry.id === current.id) ?? current),
      bikes: saved.map(presentBike),
      estimateNote: bike.estimateNote,
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    next(error);
  }
});

memberRouter.delete("/member/bikes/:id", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const ok = await repo.deleteBike(req.user.id, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "That bike is not in your garage." });
    res.json({ ok: true, bikes: (await repo.listBikes(req.user.id)).map(presentBike) });
  } catch (error) {
    next(error);
  }
});

/* ── journeys ────────────────────────────────────────────────────────── */

memberRouter.get("/member/journeys", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const [bikes, journeys] = await Promise.all([
      repo.listBikes(req.user.id),
      repo.listJourneys(req.user.id),
    ]);
    res.json({
      bikes: bikes.map(presentBike),
      journeys: journeys.map((journey) => present(journey, bikes)),
    });
  } catch (error) {
    next(error);
  }
});

memberRouter.post("/member/journeys", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const bikes = await repo.listBikes(req.user.id);
    const journey = readJourney(req.body, bikes);
    const id = await repo.createJourney(req.user.id, journey);
    const created = (await repo.listJourneys(req.user.id)).find((entry) => entry.id === id);
    res.status(201).json({ journey: present(created ?? { id, ...journey }, bikes) });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    next(error);
  }
});

memberRouter.patch("/member/journeys/:id", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const bikes = await repo.listBikes(req.user.id);
    const journeys = await repo.listJourneys(req.user.id);
    const current = journeys.find((journey) => journey.id === Number(req.params.id));
    if (!current) return res.status(404).json({ error: "That ride is not yours." });
    const journey = readJourney(req.body, bikes, { existing: current });
    const ok = await repo.updateJourney(req.user.id, current.id, journey);
    if (!ok) return res.status(404).json({ error: "That ride is not yours." });
    const saved = (await repo.listJourneys(req.user.id)).find((entry) => entry.id === current.id);
    res.json({ journey: present(saved ?? { ...current, ...journey }, bikes) });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    next(error);
  }
});

memberRouter.delete("/member/journeys/:id", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const ok = await repo.deleteJourney(req.user.id, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "That ride is not yours." });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* ── importing a ride from a link ────────────────────────────────────── */

/**
 * The same expansion the dashboard uses, opened to members.
 *
 * It is a narrow thing: a short map link in, the long map link out. The
 * parsing stays on the client, in `src/utils/mapLinks.ts`, so a member's
 * imported ride is read by exactly the code that reads the site's own route —
 * one implementation, one set of bugs.
 */
memberRouter.post("/member/link", async (req, res) => {
  try {
    const url = await expandMapLink(req.body?.url);
    res.json({ url });
  } catch (error) {
    if (error instanceof MapLinkError) {
      return res.status(error.status).json({ error: error.message });
    }
    res.status(502).json({ error: "The map service could not be reached." });
  }
});

/* ── one garage, as the dashboard opens it ───────────────────────────── */

memberRouter.get("/member/garage", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const [bikes, journeys] = await Promise.all([
      repo.listBikes(req.user.id),
      repo.listJourneys(req.user.id),
    ]);
    const measured = journeys.map((journey) => present(journey, bikes));
    res.json({
      bikes: bikes.map(presentBike),
      journeys: measured,
      totals: {
        bikes: bikes.length,
        journeys: journeys.length,
        kmOneWay: Math.round(measured.reduce((sum, j) => sum + j.maths.oneWayKm, 0) * 10) / 10,
        stops: measured.reduce((sum, j) => sum + j.maths.stops, 0),
      },
    });
  } catch (error) {
    next(error);
  }
});
