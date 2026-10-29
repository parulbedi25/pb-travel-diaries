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
 * The towns a rider actually passes through between two stops.
 *
 * Pasting a Google Maps link gives the ends of a journey — Nangal, Nubra
 * Valley — and nothing in between, so the tracker shows a 778 km ride as a
 * single hop. The places on the way are already mapped: OpenStreetMap tags
 * settlements, and Geoapify's Places API serves them for a bounding box.
 *
 * Three steps, all here:
 *
 *  1. Ask Geoapify for every city/town in the box around the road.
 *  2. Keep the ones that actually sit on the road — distance to the drawn
 *     route, not to the straight line between its ends.
 *  3. Space them out: a rider wants Mandi and Manali, not eight villages
 *     eleven kilometres apart. Bigger populations win a contested slot.
 *
 * Anything the service cannot answer leaves the route exactly as imported;
 * there is a small offline list of well-known north-Indian towns so the
 * Nangal → Nubra kind of route still gets its stops when the provider is
 * unreachable, or when the site has no key.
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
}

const GEOAPIFY_PLACES_URL = "https://api.geoapify.com/v2/places";
const DEFAULT_OPTIONS: Required<Omit<MajorStopOptions, "avoid" | "key">> = {
  radiusKm: 12,
  max: 12,
  gapKm: 30,
  trimKm: 15,
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

/** Straight-line distance from a point to the nearest bit of the road. */
export function offRoadKm(point: { lat: number; lng: number }, geometry: readonly LatLng[]): number {
  if (geometry.length < 2) return Number.POSITIVE_INFINITY;
  const p: LatLng = [point.lat, point.lng];
  return sample(geometry).reduce(
    (best, vertex) => Math.min(best, haversineKm(p, vertex)),
    Number.POSITIVE_INFINITY,
  );
}

/** Kilometres from the start of the road to the point nearest this place. */
export function kmAlongRoute(
  point: { lat: number; lng: number },
  geometry: readonly LatLng[],
  cumulative?: readonly number[],
): number {
  if (geometry.length < 2) return 0;
  const totals = cumulative ?? cumulativePath(geometry);
  const index = nearestVertexIndex(geometry, point);
  return index >= 0 ? totals[index] : 0;
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
  const cumulative = cumulativePath(geometry);
  const total = cumulative[cumulative.length - 1] ?? 0;

  const scored = candidates
    .filter((c) => c.name.trim().length > 0)
    .map((c) => ({
      name: c.name.trim(),
      lat: c.lat,
      lng: c.lng,
      population: c.population,
      offRoad: offRoadKmRank(c, geometry),
      km: kmAlongRoute(c, geometry, cumulative),
    }))
    .filter((c) => c.offRoad <= radiusKm)
    .filter((c) => c.km >= trimKm && c.km <= total - trimKm)
    .filter((c) => !avoid.has(c.name.toLowerCase()))
    .sort((a, b) => a.km - b.km);

  // One pick per window along the road, and inside a window the biggest
  // settlement wins — a town of 30,000 is a stop, the hamlet next to it is not.
  const chosen: typeof scored = [];
  const seen = new Set<string>();
  for (const place of scored) {
    if (seen.has(place.name.toLowerCase())) continue;
    const previous = chosen[chosen.length - 1];
    if (previous && place.km - previous.km < gapKm) {
      if (place.population > previous.population) {
        chosen[chosen.length - 1] = place;
        seen.add(place.name.toLowerCase());
      }
      continue;
    }
    chosen.push(place);
    seen.add(place.name.toLowerCase());
  }

  const clean: MajorStop[] = chosen.map((place) => ({
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    km: place.km,
    offRoadKm: place.offRoad,
  }));

  if (clean.length <= max) return clean;

  // Too many to be useful: keep them evenly spread rather than only the first
  // dozen, which would leave the last half of the ride empty.
  const stride = clean.length / max;
  return Array.from({ length: max }, (_, i) => clean[Math.floor(i * stride)]);
}

/** A place's distance from the road, with towns allowed a little slack. */
function offRoadKmRank(place: Candidate, geometry: readonly LatLng[]): number {
  const distance = offRoadKm(place, geometry);
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
 * Every settlement in the box around the road.
 *
 * A settlement is a feature in Geoapify's `populated_place` hierarchy, and the
 * population comes from the OpenStreetMap tags it was built from — so the
 * biggest town near a stretch wins a contested suggestion, which is what a
 * rider wants. The category list asks for both cities and towns; whether a
 * feature is one or the other is read off its own raw `place` tag, because the
 * request's categories are not a reliable filter (asking for cities alone still
 * returns villages, and asking for towns still returns cities).
 */
async function geoapifyTowns(
  geometry: readonly LatLng[],
  key: string,
  timeoutMs: number,
): Promise<Candidate[]> {
  const apiKey = key.trim();
  if (!apiKey) throw new Error("No Geoapify key");
  const [south, west, north, east] = bboxOf(geometry);
  const params = new URLSearchParams({
    categories: "populated_place.city,populated_place.town",
    filter: `rect:${west.toFixed(4)},${south.toFixed(4)},${east.toFixed(4)},${north.toFixed(4)}`,
    limit: "500",
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
      return {
        name,
        lat,
        lng,
        population: Number.isFinite(population) ? population : 0,
        place: rawPlace || ((properties?.categories ?? []).includes("populated_place.city") ? "city" : "town"),
      } satisfies Candidate;
    })
    .filter((candidate): candidate is Candidate => candidate !== null);
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
  /** Where they came from, for the note under the button. */
  source: "map" | "offline";
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

  try {
    const towns = await geoapifyTowns(geometry, options.key ?? "", timeoutMs);
    if (towns.length) {
      return { stops: pickMajorStops(towns, geometry, pickOptions), source: "map" };
    }
  } catch {
    // Fall through to the list we carry ourselves.
  }
  return { stops: pickMajorStops(KNOWN_TOWNS, geometry, pickOptions), source: "offline" };
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
  if (list.length < 2) return { stops: [...list], added: [], road };

  const geometry: LatLng[] = road.ok
    ? road.geometry
    : list.map((stop) => [stop.lat, stop.lng] as LatLng);

  const stopKm = cumulativeKmOf(list, geometry);
  const legs = list.length - 1;
  // Room around each stop: a town ten kilometres short of a stop the rider
  // already has is not a stop of its own.
  const edge = options.trimKm ?? 12;

  const { stops: found } = await findMajorStops(geometry, {
    max: Math.max(12, legs * 6),
    gapKm: 30,
    radiusKm: 14,
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
  if (!between.length) return { stops: [...list], added: [], road };

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
  };
}

/**
 * Drop `additions` into `stops` at the point along `geometry` where each one
 * belongs, leaving the rider's own stops — and their order — alone.
 *
 * Suggestions that land before the start or after the finish are dropped: a
 * stop cannot come before the first or after the last of a journey.
 */
export function mergeStopsByDistance(
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
      km: place.km ?? kmAlongRoute(place, geometry),
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
