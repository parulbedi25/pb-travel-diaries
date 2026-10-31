import {
  fetchRoadGeometry,
  nearestVertexIndex,
  nearestVertexIndexFrom,
  type LatLng,
  type RouteFetchResult,
} from "./routing";
import { haversineKm } from "./routeProgress";
import type { LiveStop } from "../store/siteContent";

/**
 * The towns a rider actually rides through.
 *
 * A pasted map link gives the ends of a journey — Nangal, Nubra Valley — and
 * nothing in between, so a 778 km ride reads as one hop. The places on the way
 * are already mapped, so the fill asks for them and puts them on the route:
 *
 *  1. Ask the Places API about the road a stretch at a time, for cities, towns
 *     and villages. A stretch at a time matters: one box around a long ride is
 *     answered with the first few hundred places, which is never all of them.
 *  2. Keep the ones on the road — measured against the drawn route, not the
 *     straight line between its ends.
 *  3. Keep all of them, in the order the road reaches them. Distance between
 *     two stops is not a reason to drop one: towns sit 10 km apart in one
 *     valley and 50 km apart in the next.
 *
 * If the service cannot answer at all, a small carried list of well-known
 * north-Indian towns keeps the Nangal → Leh kind of ride populated. That list
 * is also added to a good answer, so a place the map happens to miss is still
 * on the route.
 */

export interface MajorStop {
  name: string;
  lat: number;
  lng: number;
  /** Kilometres from the start of the route, measured along the road. */
  km: number;
  /** Straight-line distance from the road, in kilometres. */
  offRoadKm: number;
}

interface Candidate {
  name: string;
  lat: number;
  lng: number;
  population: number;
  place: string;
}

export interface MajorStopOptions {
  /** The site's Geoapify key. Without one the carried list is used instead. */
  key?: string;
  /** Keep suggestions this far from the road at most. */
  radiusKm?: number;
  /** How many to suggest. */
  max?: number;
  /** Never suggest two places closer together than this along the road. */
  gapKm?: number;
  /** Leave the ends of the route alone. */
  trimKm?: number;
  /** Names already on the route — never suggest them twice. */
  avoid?: readonly string[];
  /** How far from the road a settlement may sit and still be asked about. */
  corridorKm?: number;
}

const GEOAPIFY_PLACES_URL = "https://api.geoapify.com/v2/places";
/**
 * The stops a rider passes, not a sample of them.
 *
 * `gapKm` used to be 30, which threw away every town less than 30 km after the
 * one before it — so a stretch with a town every 12 km kept one and lost four,
 * and a 50 km empty stretch got nothing at all. Real roads are not spaced
 * evenly, and the list should not pretend they are: the only thing filtered out
 * now is the same place mentioned twice. `gapKm` survives as that guard.
 */
const DEFAULT_OPTIONS: Required<Omit<MajorStopOptions, "avoid" | "key" | "corridorKm">> = {
  radiusKm: 14,
  max: 120,
  gapKm: 1.5,
  trimKm: 3,
};

/* ------------------------------------------------------------------ *
 * Geometry maths
 * ------------------------------------------------------------------ */

/** Distance along the path to every vertex, so a point can be placed on it. */
function cumulativePath(geometry: readonly LatLng[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < geometry.length; i += 1) {
    out.push(out[i - 1] + haversineKm(geometry[i - 1], geometry[i]));
  }
  return out;
}

/** A subsample of the path, so a 4,000-vertex road is cheap to scan. */
function sample(geometry: readonly LatLng[], limit = 500): LatLng[] {
  if (geometry.length <= limit) return [...geometry];
  const step = Math.ceil(geometry.length / limit);
  const out: LatLng[] = [];
  for (let i = 0; i < geometry.length; i += step) out.push(geometry[i]);
  const last = geometry[geometry.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Straight-line distance from a point to the nearest sampled bit of the road. */
function offRoadKm(point: { lat: number; lng: number }, path: readonly LatLng[]): number {
  if (path.length < 2) return Number.POSITIVE_INFINITY;
  const p: LatLng = [point.lat, point.lng];
  let best = Number.POSITIVE_INFINITY;
  for (const vertex of path) {
    const d = haversineKm(p, vertex);
    if (d < best) best = d;
  }
  return best;
}

/** Kilometres from the start of the road to the point nearest this place. */
function kmAlongRoute(
  point: { lat: number; lng: number },
  path: readonly LatLng[],
  cumulative: readonly number[],
): number {
  const index = nearestVertexIndex(path, point);
  return index >= 0 ? cumulative[index] : 0;
}

/* ------------------------------------------------------------------ *
 * Choosing the stops
 * ------------------------------------------------------------------ */

/**
 * Turn raw map candidates into a readable list of stops.
 *
 * Pure and synchronous on purpose: the network is one function away, and the
 * choosing can be checked without a map, a key or a connection.
 */
export function pickMajorStops(
  candidates: readonly Candidate[],
  geometry: readonly LatLng[],
  options: MajorStopOptions = {},
): MajorStop[] {
  if (geometry.length < 2) return [];
  const { radiusKm, max, gapKm, trimKm } = { ...DEFAULT_OPTIONS, ...options };
  const avoid = new Set((options.avoid ?? []).map((name) => name.trim().toLowerCase()));
  // One subsample of the road, used for every candidate: measuring each of a
  // thousand places against the full 4,000-vertex line is the difference
  // between a fill that lands while the operator waits and one that does not.
  const path = sample(geometry);
  const cumulative = cumulativePath(path);
  const total = cumulative[cumulative.length - 1] ?? 0;

  const scored = candidates
    .filter((c) => c.name.trim().length > 0)
    .map((c) => ({
      name: c.name.trim(),
      lat: c.lat,
      lng: c.lng,
      population: c.population,
      rank: placeRank(c.place),
      offRoad: offRoadKmRank(c, path),
      km: kmAlongRoute(c, path, cumulative),
    }))
    .filter((c) => c.offRoad <= radiusKm)
    .filter((c) => c.km >= trimKm && c.km <= total - trimKm)
    .filter((c) => !avoid.has(c.name.toLowerCase()))
    .sort((a, b) => a.km - b.km);

  /**
   * Every town on the road, in the order it is reached.
   *
   * Nothing is skipped for being close to the stop before it: two towns 8 km
   * apart are two towns, and the rider passes both. What *is* thrown away is a
   * second name for the same ground — the map lists a town and its own
   * neighbourhood, or the same village under a local spelling. Two entries
   * within `gapKm` of each other are one place, and the bigger one keeps the
   * slot.
   */
  const chosen: typeof scored = [];
  const seen = new Set<string>();
  for (const place of scored) {
    const name = place.name.toLowerCase();
    if (seen.has(name)) continue;
    const previous = chosen[chosen.length - 1];
    // A city or a town is a stop wherever it falls; a village is only worth a
    // row when it is not crowding one — otherwise every hamlet on a busy road
    // doubles the list without adding anywhere new.
    const minGap = place.rank >= 2 ? gapKm : Math.max(gapKm, VILLAGE_GAP_KM);
    if (previous && place.km - previous.km < minGap) {
      // Same ground twice: the bigger settlement keeps the row. Rank first —
      // a town whose own village sits on top of it is still the town, even
      // when neither has a population figure — and population second.
      const beats =
        place.rank > previous.rank ||
        (place.rank === previous.rank && place.population > previous.population);
      if (beats) chosen[chosen.length - 1] = place;
      seen.add(name);
      continue;
    }
    chosen.push(place);
    seen.add(name);
  }

  const toStop = (place: (typeof chosen)[number]): MajorStop => ({
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    km: place.km,
    offRoadKm: place.offRoad,
  });

  if (chosen.length <= max) return chosen.map(toStop);

  // A very long ride can name more towns than a tracker can show. Keep the
  // cities and towns first — a village beside a city is the city's stop — then
  // put what is left back in the order the rider meets it.
  return [...chosen]
    .sort((a, b) => b.rank - a.rank || b.population - a.population || a.km - b.km)
    .slice(0, max)
    .sort((a, b) => a.km - b.km)
    .map(toStop);
}

/** Villages this close to a bigger stop are part of that stop, not a row. */
const VILLAGE_GAP_KM = 5;

/** How much of a stop a settlement is: a city outranks a village. */
function placeRank(place: string): number {
  const kind = place.trim().toLowerCase();
  if (kind === "city") return 3;
  if (kind === "town") return 2;
  if (kind === "village" || kind === "hamlet") return 1;
  return 0;
}

/** A place's distance from the road, with towns allowed a little slack. */
function offRoadKmRank(place: Candidate, path: readonly LatLng[]): number {
  const distance = offRoadKm(place, path);
  // A city's marker can sit well away from the highway that serves it.
  return place.place === "city" ? Math.max(0, distance - 4) : distance;
}

/* ------------------------------------------------------------------ *
 * Geoapify
 * ------------------------------------------------------------------ */

/** The box around the road, with a little slack so a town near the end counts. */
function bboxOf(geometry: readonly LatLng[], pad = 0.2): [number, number, number, number] {
  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;
  for (const [lat, lng] of geometry) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  return [south - pad, west - pad, north + pad, east + pad];
}

/** One feature as the Places API returns it, cut down to what we read. */
interface PlaceFeature {
  properties?: {
    name?: string;
    categories?: string[];
    lon?: number;
    lat?: number;
    formatted?: string;
    datasource?: { raw?: Record<string, unknown> };
  };
  geometry?: { coordinates?: [number, number] };
}

/**
 * The road cut into stretches, so each is searched on its own.
 *
 * One box around a thousand-kilometre ride covers half a mountain range, and
 * the Places API answers a box with its first few hundred settlements — the
 * ones near the middle of a big box, or wherever the index happens to start.
 * Asking about a box per 120 km instead means every stretch of the road is its
 * own question with its own answer, and a town forty kilometres off the part of
 * the ride it belongs to is no longer competing with a city four hundred
 * kilometres away for the same page of results.
 *
 * The windows overlap by a pad on each box, so a place sitting exactly on the
 * boundary is still found; duplicates are removed by the caller.
 */
function routeWindows(geometry: readonly LatLng[], windowKm = 120): LatLng[][] {
  if (geometry.length < 2) return [geometry.slice(0, 1)];
  const step = Math.max(1, Math.ceil(geometry.length / 600));
  const points: LatLng[] = [];
  for (let i = 0; i < geometry.length; i += step) points.push(geometry[i]);
  const last = geometry[geometry.length - 1];
  if (points[points.length - 1] !== last) points.push(last);

  const windows: LatLng[][] = [];
  let current: LatLng[] = [points[0]];
  let since = 0;
  for (let i = 1; i < points.length; i += 1) {
    since += haversineKm(points[i - 1], points[i]);
    current.push(points[i]);
    if (since >= windowKm) {
      windows.push(current);
      current = [points[i]];
      since = 0;
    }
  }
  if (current.length > 1) windows.push(current);
  return windows.length ? windows : [points];
}

/** How many pages of 500 the API is asked for per window. */
const PAGES_PER_WINDOW = 2;

/** One page of settlements in one box. */
async function townsInBox(
  box: [number, number, number, number],
  apiKey: string,
  offset: number,
  timeoutMs: number,
): Promise<Candidate[]> {
  const [south, west, north, east] = box;
  const params = new URLSearchParams({
    categories: "populated_place.city,populated_place.town,populated_place.village",
    filter: `rect:${west.toFixed(4)},${south.toFixed(4)},${east.toFixed(4)},${north.toFixed(4)}`,
    limit: "500",
    offset: String(offset),
    lang: "en",
    apiKey,
  });

  const response = await fetch(`${GEOAPIFY_PLACES_URL}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Geoapify answered ${response.status}`);
  const json = (await response.json()) as { features?: PlaceFeature[] };

  return (json.features ?? [])
    .map((feature) => {
      const properties = feature.properties;
      const name = properties?.name?.trim();
      const lng = properties?.lon ?? feature.geometry?.coordinates?.[0];
      const lat = properties?.lat ?? feature.geometry?.coordinates?.[1];
      if (!name || typeof lat !== "number" || typeof lng !== "number") return null;
      const raw = properties?.datasource?.raw ?? {};
      const rawPlace = typeof raw.place === "string" ? raw.place : "";
      const population = Number.parseInt(String(raw.population ?? ""), 10);
      const categories = properties?.categories ?? [];
      return {
        name,
        lat,
        lng,
        population: Number.isFinite(population) ? population : 0,
        place:
          rawPlace ||
          (categories.includes("populated_place.city")
            ? "city"
            : categories.includes("populated_place.village")
              ? "village"
              : "town"),
      } satisfies Candidate;
    })
    .filter((candidate): candidate is Candidate => candidate !== null);
}

/**
 * Every settlement along the road, asked for stretch by stretch.
 *
 * Cities, towns and villages all count: a village on the road is a place the
 * rider goes through, and leaving it out is what makes a route read as if it
 * skipped a mountain range. Population and the settlement's own rank decide
 * which of two nearby names is kept (see pickMajorStops) — not distance alone.
 *
 * A window that fails is not fatal while others answer, but a ride where every
 * window failed throws, so the caller knows to fall back to the carried list
 * rather than believe a half-answered map.
 */
async function geoapifyTowns(
  geometry: readonly LatLng[],
  key: string,
  timeoutMs: number,
): Promise<Candidate[]> {
  const apiKey = key.trim();
  if (!apiKey) throw new Error("No Geoapify key");
  const windows = routeWindows(geometry);

  const answers = await Promise.allSettled(
    windows.flatMap((window) => {
      const box = bboxOf(window);
      return Array.from({ length: PAGES_PER_WINDOW }, (_, page) =>
        townsInBox(box, apiKey, page * 500, timeoutMs),
      );
    }),
  );

  const byGround = new Map<string, Candidate>();
  let answered = 0;
  for (const answer of answers) {
    if (answer.status !== "fulfilled") continue;
    answered += 1;
    for (const candidate of answer.value) {
      const where = `${candidate.name.toLowerCase()}|${candidate.lat.toFixed(3)}|${candidate.lng.toFixed(3)}`;
      const seen = byGround.get(where);
      if (!seen || candidate.population > seen.population) byGround.set(where, candidate);
    }
  }
  if (!answered) throw new Error("Geoapify did not answer");
  return [...byGround.values()];
}

/* ------------------------------------------------------------------ *
 * OpenStreetMap, asked directly
 * ------------------------------------------------------------------ */

/**
 * The settlements along a road, from OpenStreetMap itself.
 *
 * Geoapify is a good index and needs a key; Most sites do not have one, and
 * without it the fill used to fall back to a dozen carried town names — which
 * is why a ride like Chandigarh → Saharanpur came back with nothing between
 * them, though it passes Rajpura, Ambala, Naraingarh, Yamunanagar and Deoband.
 *
 * Overpass is OpenStreetMap's own query service: no key, no page of results
 * that runs out, and it will answer "every settlement within 15 km of this
 * line", which is exactly the question. It is the same service the nearby page
 * already trusts for beds and petrol pumps.
 *
 * The road is asked about in chunks — a handful of `around:` coordinates per
 * request — because one request carrying a thousand coordinates is a request
 * a public server is entitled to refuse.
 */
const OVERPASS_HOSTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/** How far from the road a settlement may sit and still be on the ride. */
const CORRIDOR_KM = 15;
/** Coordinates per request: enough to cover a stretch, few enough to be polite. */
const CORRIDOR_POINTS = 24;
/** How often the road is sampled: a coordinate every eight kilometres. */
const CORRIDOR_SAMPLE_KM = 8;
/**
 * How wide to look when the road itself could not be fetched.
 *
 * The geometry is then a straight line between the stops, and a real road
 * wanders — Chandigarh to Saharanpur goes through Ambala, thirty-five
 * kilometres west of the straight line. Looking wider is the only way to find
 * those towns when the routing service is down.
 */
const CORRIDOR_WITHOUT_ROAD_KM = 40;
/** However long the ride, it is asked about in this many coordinates at most. */
const CORRIDOR_SAMPLES = 200;
/** How long one chunk gets, across every mirror it tries. */
const OVERPASS_BUDGET_MS = 16_000;

interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

/**
 * The question: every city, town and village within `radiusKm` of this line.
 *
 * `around:` takes a list of coordinates, so the road itself is the filter —
 * a town forty kilometres off the route is never fetched, let alone drawn.
 * Ways and relations count as well as nodes: a town mapped as an area carries
 * its name on the area, and `out center` gives it a point to sit on.
 */
export function corridorQuery(
  points: readonly LatLng[],
  radiusKm: number = CORRIDOR_KM,
): string {
  const around = points
    .map(([lat, lng]) => `${lat.toFixed(4)},${lng.toFixed(4)}`)
    .join(",");
  const radius = Math.round(radiusKm * 1000);
  return (
    `[out:json][timeout:25];(` +
    `nwr["place"~"^(city|town|village)$"](around:${radius},${around});` +
    `);out center 900;`
  );
}

/** Every settlement in one answer, read as a candidate stop. */
function candidatesFromOverpass(elements: readonly OverpassElement[]): Candidate[] {
  const out: Candidate[] = [];
  for (const element of elements) {
    const name = element.tags?.name?.trim();
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (!name || typeof lat !== "number" || typeof lng !== "number") continue;
    const place = (element.tags?.place ?? "town").trim();
    const population = Number.parseInt(String(element.tags?.population ?? ""), 10);
    out.push({
      name,
      lat,
      lng,
      population: Number.isFinite(population) ? population : 0,
      place,
    });
  }
  return out;
}

/** One chunk of the road, asked of the first mirror that answers. */
async function askOverpass(
  points: readonly LatLng[],
  timeoutMs: number,
  corridorKm: number,
): Promise<Candidate[]> {
  const body = `data=${encodeURIComponent(corridorQuery(points, corridorKm))}`;
  let lastError: unknown = null;
  const startedAt = Date.now();
  for (const host of OVERPASS_HOSTS) {
    // The budget is for the chunk, not for each mirror: three slow mirrors in a
    // row would otherwise hold the fill for most of a minute.
    const left = Math.min(timeoutMs, OVERPASS_BUDGET_MS) - (Date.now() - startedAt);
    if (left < 1500) break;
    try {
      const response = await fetch(host, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
        signal: AbortSignal.timeout(left),
      });
      if (!response.ok) throw new Error(`Overpass answered ${response.status}`);
      const json = (await response.json()) as { elements?: OverpassElement[] };
      return candidatesFromOverpass(json.elements ?? []);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Overpass did not answer");
}

/**
 * Evenly spaced coordinates along a line, ends included.
 *
 * Walking the vertices would thin out on the long empty stretches between two
 * towns and bunch up on the hairpins; this samples by distance, interpolating
 * inside a leg, so the spacing is the same everywhere.
 */
function corridorPoints(
  geometry: readonly LatLng[],
  spacingKm: number,
  limit = CORRIDOR_SAMPLES,
): LatLng[] {
  if (geometry.length < 2) return geometry.slice(0, 1);
  const cumulative = cumulativePath(geometry);
  const total = cumulative[cumulative.length - 1] ?? 0;
  if (!(total > 0)) return [geometry[0]];
  const spacing = Math.max(0.5, spacingKm);
  const count = Math.min(limit, Math.max(2, Math.ceil(total / spacing) + 1));
  const step = total / (count - 1);
  const out: LatLng[] = [];
  let leg = 0;
  for (let i = 0; i < count; i += 1) {
    const target = i === count - 1 ? total : i * step;
    while (leg < geometry.length - 2 && cumulative[leg + 1] < target) leg += 1;
    const a = geometry[leg];
    const b = geometry[leg + 1] ?? geometry[leg];
    const legKm = (cumulative[leg + 1] ?? total) - cumulative[leg];
    const t = legKm > 0 ? Math.min(1, Math.max(0, (target - cumulative[leg]) / legKm)) : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/**
 * Every settlement along the road, from OpenStreetMap.
 *
 * The same contract as the Geoapify version: a chunk that fails is not fatal
 * while others answer, but a ride where nothing answered throws, so the caller
 * knows it is holding an incomplete answer rather than a complete emptiness.
 */
async function overpassTowns(
  geometry: readonly LatLng[],
  timeoutMs: number,
  corridorKm: number,
): Promise<Candidate[]> {
  // `around:` means "near any of these coordinates", not "near this line", so
  // the coordinates have to be close enough together that their circles touch.
  // Interpolated, not merely subsampled: the geometry can be two points —
  // a straight line when the road could not be fetched — and a line is exactly
  // where evenly spaced coordinates matter most.
  const spacing = Math.min(CORRIDOR_SAMPLE_KM, corridorKm * 0.8);
  const points = corridorPoints(geometry, spacing);
  if (points.length < 2) return [];
  const chunks: LatLng[][] = [];
  for (let i = 0; i < points.length; i += CORRIDOR_POINTS) {
    chunks.push(points.slice(i, i + CORRIDOR_POINTS));
  }

  const answers = await Promise.allSettled(
    chunks.map((chunk) => askOverpass(chunk, timeoutMs, corridorKm)),
  );
  const byGround = new Map<string, Candidate>();
  let answered = 0;
  for (const answer of answers) {
    if (answer.status !== "fulfilled") continue;
    answered += 1;
    for (const candidate of answer.value) {
      keepLongerName(byGround, candidate);
    }
  }
  if (!answered) throw new Error("OpenStreetMap did not answer");
  return [...byGround.values()];
}

/**
 * Two names for the same ground: keep the one that is a bigger place.
 *
 * The map lists a town and the village inside it, and every source spells its
 * coordinates a little differently, so the key is the name and the ground it
 * sits on to a hundred metres rather than an exact match.
 */
function keepLongerName(seen: Map<string, Candidate>, candidate: Candidate): void {
  const key = `${candidate.name.toLowerCase()}|${candidate.lat.toFixed(2)}|${candidate.lng.toFixed(2)}`;
  const previous = seen.get(key);
  if (!previous || placeRank(candidate.place) > placeRank(previous.place) || candidate.population > previous.population) {
    seen.set(key, candidate);
  }
}

/* ------------------------------------------------------------------ *
 * Offline fallback
 * ------------------------------------------------------------------ */

/**
 * Well-known towns, for when the provider cannot be reached.
 *
 * Only places this site's rides actually go near, and only ever used after
 * filtering by distance to the road — so a route somewhere else in the country
 * simply gets no suggestions rather than wrong ones.
 */
const KNOWN_TOWNS: Candidate[] = (
  [
    ["Manali", 32.2396, 77.1887, "town"],
    ["Kullu", 31.9578, 77.1095, "town"],
    ["Mandi", 31.708, 76.9319, "city"],
    ["Sundernagar", 31.5333, 76.8833, "town"],
    ["Bilaspur", 31.3305, 76.7567, "town"],
    ["Nangal", 31.369, 76.3729, "town"],
    ["Una", 31.4685, 76.2708, "town"],
    ["Anandpur Sahib", 31.239, 76.503, "town"],
    ["Rupnagar", 30.9686, 76.527, "town"],
    ["Hoshiarpur", 31.5322, 75.9115, "city"],
    ["Jalandhar", 31.326, 75.5762, "city"],
    ["Ludhiana", 30.901, 75.8573, "city"],
    ["Chandigarh", 30.7333, 76.7794, "city"],
    ["Pathankot", 32.2643, 75.6421, "city"],
    ["Dharamshala", 32.219, 76.3234, "town"],
    ["Kangra", 32.0998, 76.2691, "town"],
    ["Palampur", 32.1109, 76.5363, "town"],
    ["Chamba", 32.5534, 76.1251, "town"],
    ["Dalhousie", 32.5387, 75.9706, "town"],
    ["Shimla", 31.1048, 77.1734, "city"],
    ["Narkanda", 31.267, 77.453, "town"],
    ["Rampur", 31.449, 77.63, "town"],
    ["Reckong Peo", 31.539, 78.2665, "town"],
    ["Kalpa", 31.54, 78.44, "town"],
    ["Kaza", 32.226, 78.071, "town"],
    ["Keylong", 32.5717, 77.0317, "town"],
    ["Jispa", 32.6417, 77.1833, "town"],
    ["Darcha", 32.6896, 77.2214, "town"],
    ["Sarchu", 32.9, 77.65, "town"],
    ["Pang", 33.1, 77.85, "town"],
    ["Upshi", 33.7583, 77.7667, "town"],
    ["Karu", 33.83, 77.8, "town"],
    ["Leh", 34.1526, 77.5771, "city"],
    ["Diskit", 34.556, 77.555, "town"],
    ["Kargil", 34.5538, 76.1349, "city"],
    ["Drass", 34.43, 75.75, "town"],
    ["Sonamarg", 34.3, 75.29, "town"],
    ["Srinagar", 34.0837, 74.7973, "city"],
    ["Gulmarg", 34.0484, 74.3805, "town"],
    ["Jammu", 32.7266, 74.857, "city"],
    ["Dehradun", 30.3165, 78.0322, "city"],
    ["Rishikesh", 30.0869, 78.2676, "town"],
    ["Uttarkashi", 30.7268, 78.4354, "town"],
    ["Joshimath", 30.5556, 79.5646, "town"],
    ["Chamoli", 30.4029, 79.3196, "town"],
    ["Rudraprayag", 30.2847, 78.9814, "town"],
    ["Badrinath", 30.7433, 79.4938, "town"],
    ["Pithoragarh", 29.5828, 80.2181, "town"],
    ["Nainital", 29.3803, 79.4636, "town"],
    ["Almora", 29.5892, 79.6467, "town"],
  ] as [string, number, number, string][]
).map(([name, lat, lng, place]) => ({ name, lat, lng, place, population: 0 }));

/* ------------------------------------------------------------------ *
 * The one call the dashboard makes
 * ------------------------------------------------------------------ */

export interface MajorStopResult {
  stops: MajorStop[];
  /** Which map answered: Geoapify, OpenStreetMap, both, or neither. */
  source: "map" | "osm" | "both" | "offline";
}

/**
 * Suggest the major stops between the ends of `geometry`.
 *
 * Never throws: a route with no suggestions is a valid answer, and the
 * dashboard is allowed to say "no towns found on this stretch" instead of
 * showing an error it cannot act on.
 */
export async function findMajorStops(
  geometry: readonly LatLng[],
  options: MajorStopOptions & { timeoutMs?: number } = {},
): Promise<MajorStopResult> {
  if (geometry.length < 2) return { stops: [], source: "offline" };
  const { timeoutMs = 20_000, ...pickOptions } = options;

  /**
   * Both maps are asked, every time, and their answers are put together.
   *
   * They are not alternatives: Geoapify indexes settlements with a population
   * figure, so it ranks a town above the hamlet beside it, while Overpass
   * answers the whole corridor and needs no key at all. Asking both and
   * merging is what makes a stretch like Chandigarh → Saharanpur come back
   * with Rajpura, Ambala, Naraingarh, Yamunanagar and Deoband rather than
   * with whichever of the two happened to have an answer that day.
   */
  const [geoapify, overpass] = await Promise.allSettled([
    geoapifyTowns(geometry, options.key ?? "", timeoutMs),
    overpassTowns(geometry, Math.min(timeoutMs, 14_000), pickOptions.corridorKm ?? CORRIDOR_KM),
  ]);

  const fromGeoapify = geoapify.status === "fulfilled" ? geoapify.value : [];
  const fromOverpass = overpass.status === "fulfilled" ? overpass.value : [];

  const merged = new Map<string, Candidate>();
  // The carried list goes in first and is then overwritten by anything the map
  // knows better: it is a floor, not a substitute.
  for (const candidate of KNOWN_TOWNS) keepLongerName(merged, candidate);
  for (const candidate of fromOverpass) keepLongerName(merged, candidate);
  for (const candidate of fromGeoapify) keepLongerName(merged, candidate);

  const stops = pickMajorStops([...merged.values()], geometry, pickOptions);
  if (fromGeoapify.length || fromOverpass.length) {
    return { stops, source: fromGeoapify.length && fromOverpass.length ? "both" : fromGeoapify.length ? "map" : "osm" };
  }
  return { stops, source: "offline" };
}

/* ------------------------------------------------------------------ *
 * Filling a journey in
 * ------------------------------------------------------------------ */

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export interface FilledRoute {
  stops: LiveStop[];
  /** Names of the stops that were added, in order. */
  added: string[];
  /** The road that was measured, so the caller can store it. */
  road: RouteFetchResult;
  /** Which map named the towns, so the dashboard can say where they came from. */
  source: MajorStopResult["source"];
}

/**
 * A journey filled in with the towns it rides through.
 *
 * A pasted map link gives points, not the road between them: two stops or
 * seven, what the link names is where the rider turns around, and the towns on
 * the way are missing from all of them. So every leg is filled — the towns
 * between the first stop and the second, the second and the third, and so on
 * to the end — chosen from the whole road's geometry and then kept only where
 * they fall strictly between two stops, with a little room either side so a
 * town does not land on top of a stop the rider typed.
 *
 * The rider's own stops keep their places, their notes and their order. The
 * measured road comes back with the stops because the dashboard stores it, and
 * because the suggestion is only as good as the geometry it was chosen along.
 */
export async function fillRoute(
  list: readonly LiveStop[],
  options: MajorStopOptions = {},
): Promise<FilledRoute> {
  const road = await fetchRoadGeometry(list);
  if (list.length < 2) return { stops: [...list], added: [], road, source: "offline" };

  /**
   * The line everything is measured against.
   *
   * Without a road it is a straight line between the stops — but a line of two
   * points has no positions along it, so every town would measure as the start
   * or as the finish and be thrown out for not being between them. Interpolating
   * it, one coordinate every two kilometres, gives the straight line the same
   * kind of geometry the road has, and nothing else in here has to know which
   * of the two it is looking at.
   */
  const geometry: LatLng[] = road.ok
    ? road.geometry
    : corridorPoints(
        list.map((stop) => [stop.lat, stop.lng] as LatLng),
        2,
        Math.max(64, list.length * 120),
      );

  const stopKm = cumulativeKmOf(list, geometry);
  const legs = list.length - 1;
  // Only a town almost on top of a stop is left out — the row would read as a
  // duplicate. A place twenty kilometres before a stop is a stop of its own.
  const edge = options.trimKm ?? 2;

  // How many rows a ride can carry: roughly one every ten kilometres. A ride
  // of 250 km wants its towns, not four hundred hamlets; a ride of 2,000 km
  // wants far more than a fixed dozen. Every city and town comes first when
  // the list has to be cut, so the villages are what give way.
  const lengthKm = stopKm[stopKm.length - 1] ?? 0;
  const wanted = Math.min(120, Math.max(10, Math.round(lengthKm / 10)));

  // Without a road, the geometry is a straight line between the stops, and a
  // real road wanders tens of kilometres away from that — so the corridor is
  // widened to look for the towns a straight line would miss.
  const corridorKm = options.corridorKm ?? (road.ok ? CORRIDOR_KM : CORRIDOR_WITHOUT_ROAD_KM);

  const { stops: found, source } = await findMajorStops(geometry, {
    max: wanted,
    radiusKm: corridorKm,
    corridorKm,
    ...options,
    avoid: [...(options.avoid ?? []), ...list.map((stop) => stop.name)],
  });

  // Keep the ones that are on a leg rather than merely near the road: with two
  // stops that is the whole ride, with seven it is every stretch between them.
  const between = found.filter((place) =>
    stopKm.some(
      (km, index) =>
        index < legs && place.km > km + edge && place.km < stopKm[index + 1] - edge,
    ),
  );
  if (!between.length) return { stops: [...list], added: [], road, source };

  const merged = mergeStopsByDistance(list, geometry, between, (place: MajorStop) => ({
    name: place.name,
    // No note: the tracker shows the distance from the start for a stop
    // without one, which is exactly what a stop on the way wants to say.
    note: "",
    status: "next",
    lat: round4(place.lat),
    lng: round4(place.lng),
  }));

  return {
    stops: merged,
    added: between.map((place) => place.name),
    road,
    source,
  };
}

/**
 * Drop `additions` into `stops` at the point along `geometry` where each one
 * belongs, leaving the rider's own stops — and their order — alone.
 *
 * Suggestions that land before the start or after the finish are dropped: a
 * stop cannot come before the first or after the last of a journey.
 */
function mergeStopsByDistance(
  stops: readonly LiveStop[],
  geometry: readonly LatLng[],
  additions: readonly MajorStop[],
  toStop: (place: MajorStop) => LiveStop,
): LiveStop[] {
  if (additions.length === 0) return [...stops];
  const totals = cumulativeKmOf(stops, geometry);
  // A place the route already has is not added again, whatever the suggestion
  // list says — two identical stops read as a bug, not as a landmark.
  const known = new Set(stops.map((stop) => stop.name.trim().toLowerCase()));
  const fresh = additions.filter((place) => {
    const name = place.name.trim().toLowerCase();
    if (known.has(name)) return false;
    known.add(name);
    return true;
  });
  const rows = [
    ...stops.map((stop, index) => ({ stop, km: totals[index] ?? 0, order: index })),
    ...fresh.map((place, index) => ({
      stop: toStop(place),
      km: place.km,
      order: stops.length + index,
    })),
  ].sort((a, b) => (a.km === b.km ? a.order - b.order : a.km - b.km));

  // Keep the ends where they are, whatever the arithmetic says.
  const sorted = rows.map((row) => row.stop);
  return sorted;
}

/**
 * How far along the road each stop is, measured **in order**.
 *
 * Each stop is matched to the nearest vertex from the one before it, never the
 * nearest anywhere. A round trip that ends where it started would otherwise
 * measure its own destination as zero kilometres in — and every stop sorted
 * against that figure would land in front of the ride it belongs to.
 */
function cumulativeKmOf(
  stops: readonly LiveStop[],
  geometry: readonly LatLng[],
): number[] {
  const totals: number[] = stops.map(() => 0);
  if (geometry.length < 2 || stops.length < 2) return totals;
  const cumulative = cumulativePath(geometry);
  let cursor = 0;
  stops.forEach((stop, index) => {
    if (index === 0) return;
    const vertex = nearestVertexIndexFrom(geometry, stop, cursor);
    if (vertex >= 0) cursor = vertex;
    totals[index] = cursor >= 0 ? cumulative[cursor] : 0;
  });
  return totals;
}
