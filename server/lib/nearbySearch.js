/**
 * Finding a bed, a pump, a workshop or a hospital near a point.
 *
 * The browser used to ask Overpass directly, which is the weak link: one
 * endpoint, one attempt, a twenty-second timeout, and no way to see why it
 * failed. Overpass's public instance is a volunteer service that is busy
 * often and unreachable sometimes, and a tab that silently shows nothing
 * looks like a broken feature rather than a busy server.
 *
 * So the search happens here, where it can be retried and fall back:
 *
 *  1. **Google Places**, when a key is configured — in the dashboard's
 *     Nearby settings, or `GOOGLE_PLACES_API_KEY` in the environment. It is
 *     tried first because it is the most complete answer, and it costs the
 *     owner money by the request. Google has no keyless API, so a site
 *     without a key simply does not have this step.
 *  2. **Overpass**, across several mirrors in turn — the main instance, then
 *     two independent community servers. One `out center` query per question,
 *     with a User-Agent naming this site, as Overpass asks.
 *  3. **Photon**, a keyless geocoder built on the same OpenStreetMap data,
 *     asked by tag around a point. Fast, and it does not share a server with
 *     Overpass, so it answers on the evenings Overpass is loaded.
 *  4. **Nominatim**, OpenStreetMap's own geocoder, category-searching a
 *     bounding box: the same data asked a different way one last time.
 *
 * Whatever answers, the shape handed back is the same, and the answer is
 * cached for ten minutes so flipping between tabs costs nothing.
 */

/** How far out each question is asked. A bed is worth a detour; petrol is not. */
export const KIND_RADIUS_KM = { stays: 15, essentials: 25 };

export const KINDS = Object.keys(KIND_RADIUS_KM);

/**
 * Overpass mirrors, tried in order.
 *
 * All three run the same software and the same data; they are different
 * servers, in different places, run by different people. The second is the
 * one the OSM community points at when the main instance is loaded, and the
 * third is a long-standing German mirror.
 */
export const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const PHOTON_URL = "https://photon.komoot.io/api";
const GOOGLE_PLACES_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";

/** Overpass asks callers to identify themselves; this is who we are. */
const USER_AGENT = "pb-travel-diaries/1.0 (nearby places; +https://pbfrompb.in)";

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map();

/* ------------------------------------------------------------------ *
 * The question
 * ------------------------------------------------------------------ */

/** The Overpass query for one question, as a radius around a point. */
export function overpassQuery(kind, lat, lng, radiusKm) {
  const around = `(around:${Math.round(radiusKm * 1000)},${lat.toFixed(4)},${lng.toFixed(4)})`;
  const head = "[out:json][timeout:20]";
  if (kind === "stays") {
    return `${head};nwr["tourism"~"^(hotel|guest_house|hostel|motel)$"]${around};out center 80;`;
  }
  return (
    `${head};(` +
    `nwr["amenity"="fuel"]${around};` +
    `nwr["amenity"~"^(hospital|clinic)$"]${around};` +
    `nwr["shop"="motorcycle"]${around};` +
    `nwr["service:vehicle:motorcycle"="yes"]${around};` +
    `nwr["name"~"Royal Enfield",i]${around};` +
    `);out center 140;`
  );
}

/** What Nominatim is asked, one free-text term per category. */
export function nominatimTerms(kind) {
  return kind === "stays" ? ["hotel", "guest house"] : ["petrol station", "hospital", "motorcycle repair"];
}

/** The bounding box around a point, as Nominatim wants it: west,north,east,south. */
export function viewboxOf(lat, lng, radiusKm) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / Math.max(0.2, 111 * Math.cos((lat * Math.PI) / 180));
  return [lng - dLng, lat + dLat, lng + dLng, lat - dLat].map((n) => n.toFixed(5)).join(",");
}

/** What Photon is asked: one free-text term per category, biased to the point. */
export function photonTerms(kind) {
  return kind === "stays"
    ? ["hotel", "guest house", "hostel"]
    : ["petrol station", "hospital", "motorcycle repair"];
}

/** Photon's `osm_key`/`osm_value` pair, read as the tags they stand for. */
export function tagsFromPhoton(properties) {
  const key = String(properties.osm_key ?? "");
  const value = String(properties.osm_value ?? "");
  const tags = {};
  if (key === "amenity") tags.amenity = value;
  else if (key === "tourism") tags.tourism = value;
  else if (key === "shop") tags.shop = value;
  else if (key === "service" && value === "vehicle") tags["service:vehicle:motorcycle"] = "yes";
  const name = properties.name ?? properties.street;
  if (name) tags.name = String(name);
  if (properties.opening_hours) tags.opening_hours = String(properties.opening_hours);
  return tags;
}

/* ------------------------------------------------------------------ *
 * The answer
 * ------------------------------------------------------------------ */

const EARTH_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle kilometres — the same figure the page shows. */
export function kmBetween(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const STAY_COPY = {
  hotel: "Hotel",
  guest_house: "Guest house",
  hostel: "Hostel",
  motel: "Motel",
};

const RE_NAME = /royal\s*enfield/i;

/**
 * One OpenStreetMap element as an item, or null when it is not one we asked
 * for. Written for Overpass's `tags`, and reused for Nominatim's `class` and
 * `type` by passing them in as tags.
 */
export function itemFromTags(tags, id, lat, lng, origin) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const name = String(tags.name ?? "").trim();
  const royalEnfield = RE_NAME.test(name);
  const tourism = tags.tourism ?? "";
  const amenity = tags.amenity ?? "";

  let kind = null;
  let detail = "";
  let budget = false;

  if (STAY_COPY[tourism]) {
    kind = "stay";
    budget = tourism === "guest_house" || tourism === "hostel" || tourism === "motel";
    detail = `${STAY_COPY[tourism]}${tags.stars ? ` · ${tags.stars}★` : ""}${budget ? " · budget" : ""}`;
  } else if (amenity === "fuel") {
    kind = "fuel";
    const brand = tags.brand ?? tags.operator ?? "";
    detail = brand ? `Fuel · ${brand}` : "Fuel station";
  } else if (amenity === "hospital" || amenity === "clinic") {
    kind = "hospital";
    detail = `${amenity === "hospital" ? "Hospital" : "Clinic"}${tags.emergency === "yes" ? " · emergency" : ""}`;
  } else if (tags.shop === "motorcycle" || tags["service:vehicle:motorcycle"] === "yes" || royalEnfield) {
    kind = "service";
    detail = royalEnfield ? "Royal Enfield · workshop" : "Motorcycle workshop";
  }

  if (!kind) return null;
  // A bed with no name is a bed nobody can ask for; the others read fine
  // unnamed, so they keep a plain title.
  if (kind === "stay" && !name) return null;
  const title =
    name ||
    (kind === "fuel" ? "Fuel station" : kind === "hospital" ? "Hospital" : "Workshop");

  return {
    id,
    kind,
    title,
    lat,
    lng,
    distanceKm: Number(kmBetween(origin, { lat, lng }).toFixed(2)),
    detail,
    ...(royalEnfield ? { royalEnfield: true } : {}),
    ...(budget ? { budget: true } : {}),
    ...(tags.opening_hours ? { opening: tags.opening_hours } : {}),
  };
}

/** An Overpass payload as items. */
export function itemsFromOverpass(json, origin) {
  const elements = Array.isArray(json?.elements) ? json.elements : [];
  const items = [];
  for (const element of elements) {
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    const item = itemFromTags(
      element.tags ?? {},
      `${element.type ?? "nwr"}/${element.id ?? `${lat},${lng}`}`,
      lat,
      lng,
      origin,
    );
    if (item) items.push(item);
  }
  return items;
}

/** Nominatim's `class`/`type` pair, read as the tags they stand for. */
export function tagsFromNominatim(hit) {
  const category = String(hit.class ?? "");
  const type = String(hit.type ?? "");
  const tags = {};
  if (type === "fuel" || category === "fuel") tags.amenity = "fuel";
  else if (category === "amenity" && (type === "hospital" || type === "clinic")) tags.amenity = type;
  else if (type === "hotel" || type === "guest_house" || type === "hostel" || type === "motel") {
    tags.tourism = type;
  } else if (type === "motorcycle" || type === "car_repair" || category === "shop") {
    if (type === "motorcycle") tags.shop = "motorcycle";
  }
  if (hit.name || hit.display_name) tags.name = hit.name ?? String(hit.display_name ?? "").split(",")[0];
  if (hit.extratags?.brand) tags.brand = hit.extratags.brand;
  if (hit.extratags?.opening_hours) tags.opening_hours = hit.extratags.opening_hours;
  return tags;
}

/** Photon features as items, skipping the ones that are not what was asked for. */
export function itemsFromPhoton(features, origin) {
  const items = [];
  for (const feature of Array.isArray(features) ? features : []) {
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const [lng, lat] = coordinates.map(Number);
    const item = itemFromTags(
      tagsFromPhoton(feature.properties ?? {}),
      `photon/${feature.properties?.osm_type ?? "node"}/${feature.properties?.osm_id ?? `${lat},${lng}`}`,
      lat,
      lng,
      origin,
    );
    if (item) items.push(item);
  }
  return items;
}

/** Nominatim hits as items, skipping the ones that are not what was asked for. */
export function itemsFromNominatim(hits, origin) {
  const items = [];
  for (const hit of Array.isArray(hits) ? hits : []) {
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    const item = itemFromTags(
      tagsFromNominatim(hit),
      `osm/${hit.osm_type ?? "node"}/${hit.osm_id ?? `${lat},${lng}`}`,
      lat,
      lng,
      origin,
    );
    if (item) items.push(item);
  }
  return items;
}

/** Google Places results as items — used only when a key is configured. */
export function itemsFromGoogle(results, origin) {
  const items = [];
  for (const place of Array.isArray(results) ? results : []) {
    const lat = place.geometry?.location?.lat;
    const lng = place.geometry?.location?.lng;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    const types = Array.isArray(place.types) ? place.types : [];
    const name = String(place.name ?? "").trim();
    const royalEnfield = RE_NAME.test(name);
    let kind = null;
    let detail = "";
    let budget = false;
    if (types.includes("lodging")) {
      kind = "stay";
      budget = /hostel|guest/i.test(name);
      const stars = place.rating ? ` · ${place.rating}★` : "";
      detail = `${budget ? "Guest house · budget" : "Hotel"}${stars}`;
    } else if (types.includes("gas_station")) {
      kind = "fuel";
      detail = "Fuel station";
    } else if (types.includes("hospital") || types.includes("doctor")) {
      kind = "hospital";
      detail = types.includes("hospital") ? "Hospital" : "Clinic";
    } else if (types.includes("car_repair") || royalEnfield) {
      kind = "service";
      detail = royalEnfield ? "Royal Enfield · workshop" : "Motorcycle workshop";
    }
    if (!kind || !name) continue;
    items.push({
      id: `google/${place.place_id ?? `${lat},${lng}`}`,
      kind,
      title: name,
      lat,
      lng,
      distanceKm: Number(kmBetween(origin, { lat, lng }).toFixed(2)),
      detail,
      ...(royalEnfield ? { royalEnfield: true } : {}),
      ...(budget ? { budget: true } : {}),
      ...(place.opening_hours?.open_now === undefined ? {} : { opening: place.opening_hours.open_now ? "open now" : "closed now" }),
    });
  }
  return items;
}

/**
 * Beds cheapest first, then nearest; everything else nearest, with the
 * workshop carrying the rider's own marque moved to the top of the service
 * entries. The same place tagged twice is one place.
 */
export function rankItems(items, kind) {
  // Only what was asked for: a "stays" answer that came back with a fuel
  // station in it — a regex that matched more than it meant to — must not
  // quietly appear in the beds list.
  const wanted = items.filter((item) => (kind === "stays" ? item.kind === "stay" : item.kind !== "stay"));
  const sorted = [...wanted].sort((a, b) => {
    if (kind === "stays") {
      if (Boolean(a.budget) !== Boolean(b.budget)) return a.budget ? -1 : 1;
    } else if (Boolean(a.royalEnfield) !== Boolean(b.royalEnfield)) {
      return a.royalEnfield ? -1 : 1;
    }
    return a.distanceKm - b.distanceKm;
  });
  const seen = new Set();
  return sorted.filter((item) => {
    const key = `${item.title.toLowerCase()}@${item.lat.toFixed(3)},${item.lng.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * Asking
 * ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(response, what) {
  if (!response.ok) throw new Error(`${what} answered ${response.status}`);
  return response.json();
}

/** One Overpass mirror, one question. Throws so the caller can try the next. */
async function askOverpass(url, kind, lat, lng, radiusKm, { fetchImpl, timeoutMs }) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: `data=${encodeURIComponent(overpassQuery(kind, lat, lng, radiusKm))}`,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return itemsFromOverpass(await readJson(response, "Overpass"), { lat, lng });
}

/** Nominatim, one term at a time, politely paced. */
async function askNominatim(kind, lat, lng, radiusKm, { fetchImpl, timeoutMs }) {
  const viewbox = viewboxOf(lat, lng, radiusKm);
  const wanted = nominatimTerms(kind);
  const all = [];
  for (const [index, term] of wanted.entries()) {
    if (index > 0) await sleep(1100);
    const params = new URLSearchParams({
      format: "jsonv2",
      q: term,
      viewbox,
      bounded: "1",
      limit: "25",
      addressdetails: "0",
      extratags: "1",
    });
    const response = await fetchImpl(`${NOMINATIM_URL}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    all.push(...itemsFromNominatim(await readJson(response, "Nominatim"), { lat, lng }));
  }
  return all;
}

/** Photon, one term at a time, around the point. */
async function askPhoton(kind, lat, lng, radiusKm, { fetchImpl, timeoutMs }) {
  const all = [];
  for (const term of photonTerms(kind)) {
    const params = new URLSearchParams({
      q: term,
      lat: String(lat),
      lon: String(lng),
      limit: "25",
      // A bias, not a box: Photon sorts by distance from the point, and the
      // radius is applied here rather than left to the service.
      lang: "en",
    });
    const response = await fetchImpl(`${PHOTON_URL}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await readJson(response, "Photon");
    const found = itemsFromPhoton(json.features, { lat, lng }).filter((item) => item.distanceKm <= radiusKm);
    all.push(...found);
  }
  return all;
}

/** Google Places, one call per category. */
async function askGoogle(kind, lat, lng, radiusKm, { fetchImpl, timeoutMs, key }) {
  const types = kind === "stays" ? ["lodging"] : ["gas_station", "hospital"];
  const all = [];
  for (const type of types) {
    const params = new URLSearchParams({
      location: `${lat},${lng}`,
      radius: String(Math.round(radiusKm * 1000)),
      type,
      key,
    });
    const response = await fetchImpl(`${GOOGLE_PLACES_URL}?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await readJson(response, "Google Places");
    all.push(...itemsFromGoogle(json.results, { lat, lng }));
  }
  if (kind === "essentials") {
    // Motorcycle workshops are a keyword search in Places, not a type.
    const params = new URLSearchParams({
      location: `${lat},${lng}`,
      radius: String(Math.round(radiusKm * 1000)),
      keyword: "motorcycle repair Royal Enfield",
      key,
    });
    const response = await fetchImpl(`${GOOGLE_PLACES_URL}?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await readJson(response, "Google Places");
    all.push(...itemsFromGoogle(json.results, { lat, lng }));
  }
  return all;
}

/**
 * Search around a point, trying every source that can answer.
 *
 * The order is the answer to "which is most likely to work, and best": a
 * configured Google key first (it is the most complete, and the owner has
 * deliberately paid for it), then OpenStreetMap three ways — Overpass, its
 * mirrors, Photon, and Nominatim — and nothing at all as the last resort.
 *
 * Never throws for a busy service: the caller gets whatever the first
 * answering source found, and `source` says which one it was so the page can
 * be honest about it. `tried` is there for the log and for the page's own
 * "what did you try" line.
 */
export async function searchNearby({
  kind,
  lat,
  lng,
  fetchImpl,
  mirrors = OVERPASS_MIRRORS,
  timeoutMs = 20_000,
  googleKey = process.env.GOOGLE_PLACES_API_KEY,
} = {}) {
  const radiusKm = KIND_RADIUS_KM[kind];
  if (!radiusKm) throw new Error(`Unknown nearby kind: ${kind}`);
  const origin = { lat, lng };
  const run = fetchImpl ?? globalThis.fetch;
  // `tried` is what the page shows: the sources that were asked, in order,
  // once each, in words a rider reads. `notes` keeps the technical detail —
  // which mirror, which status — for the server log and for tests.
  const tried = [];
  const notes = [];
  const mark = (label, note) => {
    if (!tried.includes(label)) tried.push(label);
    if (note) notes.push(note);
  };
  const key = String(googleKey ?? "").trim();

  // A configured key is used first: richer results, and the owner opted in.
  if (key) {
    try {
      const items = await askGoogle(kind, lat, lng, radiusKm, { fetchImpl: run, timeoutMs, key });
      if (items.length) return { source: "google", radiusKm, items: rankItems(items, kind), tried, notes };
      mark("Google Places", "google: nothing nearby");
    } catch (error) {
      mark("Google Places", `google: ${error.message}`);
    }
  }

  for (const mirror of mirrors) {
    try {
      const items = await askOverpass(mirror, kind, lat, lng, radiusKm, { fetchImpl: run, timeoutMs });
      // An empty answer from a working server is a real answer: nothing is
      // tagged there, and asking more servers for the same nothing only wastes
      // a minute of the rider's time. It is only believed while the other
      // sources have not already been found wanting.
      if (items.length) return { source: "overpass", radiusKm, items: rankItems(items, kind), tried, notes };
      mark("OpenStreetMap", `${new URL(mirror).host}: nothing nearby`);
    } catch (error) {
      mark("OpenStreetMap", `${new URL(mirror).host}: ${error.message}`);
    }
  }

  try {
    const items = await askPhoton(kind, lat, lng, radiusKm, { fetchImpl: run, timeoutMs });
    if (items.length) return { source: "photon", radiusKm, items: rankItems(items, kind), tried, notes };
    mark("Photon", "photon: nothing nearby");
  } catch (error) {
    mark("Photon", `photon: ${error.message}`);
  }

  try {
    const items = await askNominatim(kind, lat, lng, radiusKm, { fetchImpl: run, timeoutMs });
    if (items.length) return { source: "nominatim", radiusKm, items: rankItems(items, kind), tried, notes };
    mark("Nominatim", "nominatim: nothing nearby");
  } catch (error) {
    mark("Nominatim", `nominatim: ${error.message}`);
  }

  return { source: "none", radiusKm, items: [], tried, notes, keyConfigured: Boolean(key) };
}

/** The cached answer for a point, or a fresh one. */
export async function searchNearbyCached(params) {
  const key = `${params.kind}:${Number(params.lat).toFixed(3)},${Number(params.lng).toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, cached: true };

  const value = await searchNearby(params);
  // Only a real answer is worth keeping; a failed one should be retried the
  // next time somebody opens the tab.
  if (value.items.length || value.source !== "none") {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  return { ...value, cached: false };
}

/** For tests: forget everything remembered. */
export function clearNearbyCache() {
  cache.clear();
}
