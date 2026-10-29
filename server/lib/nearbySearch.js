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
 *  1. **Google**, asked the way a browser asks it — the Maps search page
 *     itself, whose results are read out of the page Google sends back. No
 *     API key, no billing account, nothing to configure: the same public
 *     results anyone sees on maps.google.com, asked by category around the
 *     point. It is tried first because it is the most complete answer, and a
 *     rider looking for a bed wants Google's list.
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
const GOOGLE_MAPS_URL = "https://www.google.com/maps/search";

/** Overpass asks callers to identify themselves; this is who we are. */
const USER_AGENT = "pb-travel-diaries/1.0 (nearby places; +https://pbfrompb.in)";

/**
 * Google is a different kind of server: ask it as a script does and it may
 * hand back the cut-down page, which carries no results. So the Maps page is
 * asked with an ordinary browser's headers, because that is the page with the
 * data in it.
 */
const BROWSER_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-IN,en-GB;q=0.9,en;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

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

/**
 * What Google is asked, one free-text search per category. These are the words
 * a rider would type into Maps, not API type names, because the page is being
 * asked rather than the API.
 */
export function googleTerms(kind) {
  return kind === "stays"
    ? ["hotels", "guest houses", "hostels"]
    : ["petrol pumps", "hospitals", "motorcycle repair Royal Enfield"];
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

/* ------------------------------------------------------------------ *
 * Google, asked as a page
 * ------------------------------------------------------------------ */

/** Words that mean a record is a bed, a pump, a hospital or a workshop. */
const GOOGLE_TOKENS = {
  stay: ["lodging", "hotel", "guest_house", "guest house", "hostel", "motel", "resort", "homestay", "bed and breakfast"],
  fuel: ["gas_station", "gas station", "petrol", "fuel", "filling station", "petrol pump"],
  hospital: ["hospital", "clinic", "doctor", "medical", "nursing home", "dispensary"],
  service: ["car_repair", "motorcycle", "motor cycle", "bike repair", "two wheeler", "workshop", "royal enfield", "garage"],
};

/** A Google place id, e.g. `0x391ad0a2b:0x1f2ab3c` — never a name. */
const HEX_ID = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;
const URLISH = /^(https?:\/\/|www\.|\/)/i;

/**
 * Every array in the page's data, visited once.
 *
 * Google's Maps page hands the browser one enormous state array; the places
 * live in it as arrays of their own. Rather than depend on an index that
 * changes between builds of their page, this walks the whole thing and lets
 * the shape of a record identify itself.
 */
function eachArray(node, visit, depth = 0) {
  if (depth > 24 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    visit(node);
    for (const child of node) eachArray(child, visit, depth + 1);
    return;
  }
  for (const child of Object.values(node)) eachArray(child, visit, depth + 1);
}

/**
 * Every coordinate pair a record's children could be read as.
 *
 * `[lat, lng]` and `[null, null, lat, lng]` both appear in Google's data, and
 * so do number pairs that are not coordinates at all — a rating and its review
 * count look exactly like a latitude and a longitude. So the caller gets all of
 * them and picks the one nearest the point being searched, which is the only
 * one that could be the place.
 */
function coordinateCandidates(record) {
  const out = [];
  for (const child of record) {
    if (!Array.isArray(child)) continue;
    const numbers = child.filter((entry) => typeof entry === "number");
    if (numbers.length < 2) continue;
    const others = child.filter((entry) => entry !== null && entry !== undefined);
    if (others.length !== numbers.length) continue;
    // `[lat, lng]` or `[null, null, lat, lng]`, most specific last.
    const [lat, lng] = numbers.length >= 4 ? numbers.slice(-2) : numbers;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    if (lat === 0 && lng === 0) continue;
    out.push({ lat, lng });
  }
  return out;
}

/** All the words in a record's subtree, lowercased, for classification. */
function wordsIn(node, out = [], depth = 0) {
  if (depth > 6) return out;
  if (typeof node === "string") {
    out.push(node.toLowerCase());
    return out;
  }
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) wordsIn(child, out, depth + 1);
    return out;
  }
  for (const child of Object.values(node)) {
    if (typeof child === "string") out.push(child.toLowerCase());
    else wordsIn(child, out, depth + 1);
  }
  return out;
}

/** Every number in a record's subtree, skipping the ones used as coordinates. */
function numbersIn(node, skip, out = [], depth = 0) {
  if (depth > 5 || node === null || node === undefined) return out;
  if (typeof node === "number") {
    if (!skip.has(node)) out.push(node);
    return out;
  }
  if (typeof node !== "object") return out;
  const children = Array.isArray(node) ? node : Object.values(node);
  for (const child of children) {
    // A pair that was read as coordinates is not also a rating.
    if (Array.isArray(child) && child.length <= 4 && coordinateCandidates([child]).length) {
      for (const number of child) if (typeof number === "number") skip.add(number);
      continue;
    }
    numbersIn(child, skip, out, depth + 1);
  }
  return out;
}

/** Which of the four things this record is, from the words around it. */
export function googleKindOf(words, name = "") {
  const haystack = [...words, name.toLowerCase()];
  for (const kind of ["stay", "fuel", "hospital", "service"]) {
    if (haystack.some((word) => GOOGLE_TOKENS[kind].some((token) => word.includes(token)))) return kind;
  }
  return null;
}

/**
 * The data array out of a Google Maps page.
 *
 * The page ships as `window.APP_INITIALIZATION_STATE=[…];window.APP_FLAGS=…`.
 * Only the first of those is wanted, and a build of their page that renames it
 * simply yields nothing — which is why OpenStreetMap is still underneath.
 */
export function googleStateFrom(html) {
  const match = String(html ?? "").match(/window\.APP_INITIALIZATION_STATE\s*=\s*(\[[\s\S]*?\]);\s*window\./);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Google's results as items.
 *
 * A record is recognised by what it has, not where it sits: a name that is a
 * name, coordinates in the right ranges, and a word somewhere near it saying
 * it is a hotel or a pump. The same place listed under two searches is one
 * place.
 */
export function itemsFromGoogleState(state, origin) {
  const items = [];
  if (!state) return items;

  eachArray(state, (record) => {
    // A place record is flat and modest; the containers around it are not.
    if (record.length > 220) return;
    // Direct children only: a record is flat, and reading grandchildren would
    // turn one place into several.
    const strings = record.filter((child) => typeof child === "string" && child.trim());
    const named = strings
      .filter((text) => !HEX_ID.test(text) && !URLISH.test(text))
      .filter((text) => text.trim().length >= 2 && text.trim().length <= 90)
      .sort((a, b) => b.length - a.length);
    if (!named.length) return;

    const candidates = coordinateCandidates(record);
    if (!candidates.length) return;
    // The real coordinates are the ones near the point that was searched for.
    const coords = candidates.reduce((best, next) =>
      kmBetween(origin, next) < kmBetween(origin, best) ? next : best,
    );

    const name = named[0].trim();
    // A category word on its own is not a place.
    if (Object.values(GOOGLE_TOKENS).flat().includes(name.toLowerCase())) return;

    const words = wordsIn(record);
    const kind = googleKindOf(words, name);
    if (!kind) return;

    const royalEnfield = RE_NAME.test(name);
    // Google's rating is a number between 1 and 5 with a decimal on it, kept
    // somewhere in the record — and never one of the coordinates.
    const rating = numbersIn(record, new Set()).find(
      (value) => value >= 1 && value <= 5 && !Number.isInteger(value),
    );
    const budget = kind === "stay" && /hostel|guest|homestay|budget|oyo/i.test(name);

    const detail =
      kind === "stay"
        ? `${budget ? "Guest house · budget" : "Hotel"}${rating ? ` · ${rating}★` : ""}`
        : kind === "fuel"
          ? "Fuel station"
          : kind === "hospital"
            ? "Hospital"
            : royalEnfield
              ? "Royal Enfield · workshop"
              : "Motorcycle workshop";

    items.push({
      id: `google/${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`,
      kind,
      title: name,
      lat: coords.lat,
      lng: coords.lng,
      distanceKm: Number(kmBetween(origin, coords).toFixed(2)),
      detail,
      ...(royalEnfield ? { royalEnfield: true } : {}),
      ...(budget ? { budget: true } : {}),
    });
  });

  return items;
}

/** A whole page as items — the state, or nothing. */
export function itemsFromGoogleMapsHtml(html, origin) {
  const items = itemsFromGoogleState(googleStateFrom(html), origin);
  // The same place can be listed in two categories; keep the nearest copy.
  const seen = new Map();
  for (const item of items) {
    const key = `${item.title.toLowerCase()}@${item.lat.toFixed(4)},${item.lng.toFixed(4)}`;
    const kept = seen.get(key);
    if (!kept || item.distanceKm < kept.distanceKm) seen.set(key, item);
  }
  return [...seen.values()];
}

/**
 * Nearest first — one answer to "what is around here", whatever the tab.
 *
 * The list on the page and the pins on the map read in the same order, so the
 * nearest bed or pump is always the first thing offered, and the same place
 * tagged twice is one place.
 */
export function rankItems(items, kind) {
  // Only what was asked for: a "stays" answer that came back with a fuel
  // station in it — a regex that matched more than it meant to — must not
  // quietly appear in the beds list.
  const wanted = items.filter((item) => (kind === "stays" ? item.kind === "stay" : item.kind !== "stay"));
  const sorted = [...wanted].sort((a, b) => a.distanceKm - b.distanceKm);
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

/** Nominatim, one term — the last resort, so it gets one try, not three. */
async function askNominatim(kind, lat, lng, radiusKm, { fetchImpl, timeoutMs }) {
  const viewbox = viewboxOf(lat, lng, radiusKm);
  const [term] = nominatimTerms(kind);
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
  return itemsFromNominatim(await readJson(response, "Nominatim"), { lat, lng });
}

/**
 * Photon, every term at once.
 *
 * The terms were asked one after another, which made the whole source as slow
 * as three calls added together. Photon is keyless and has no pacing rule, so
 * they go out together and the answers are merged.
 */
async function askPhoton(kind, lat, lng, radiusKm, { fetchImpl, timeoutMs }) {
  const answers = await Promise.allSettled(
    photonTerms(kind).map(async (term) => {
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
      return itemsFromPhoton(json.features, { lat, lng }).filter((item) => item.distanceKm <= radiusKm);
    }),
  );
  const all = [];
  for (const answer of answers) if (answer.status === "fulfilled") all.push(...answer.value);
  if (answers.every((answer) => answer.status === "rejected")) {
    throw answers[0].reason;
  }
  return all;
}

/**
 * Google, one search page per category.
 *
 * The page is asked exactly as a browser asks it — `/maps/search/<words>/@lat,
 * lng,<zoom>z` — and the results are read out of the answer. The zoom is set
 * from the radius so Google's own list is about as wide as the tab claims to
 * be, and the radius is then applied here, because Google's idea of "near" is
 * generous.
 */
async function askGoogle(kind, lat, lng, radiusKm, { fetchImpl, timeoutMs }) {
  const zoom = Math.max(10, Math.min(15, Math.round(15 - Math.log2(Math.max(1, radiusKm / 2)))));
  const all = [];
  for (const term of googleTerms(kind)) {
    const url = `${GOOGLE_MAPS_URL}/${encodeURIComponent(term)}/@${lat.toFixed(5)},${lng.toFixed(5)},${zoom}z?hl=en`;
    const response = await fetchImpl(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Google answered ${response.status}`);
    const html = await response.text();
    all.push(
      ...itemsFromGoogleMapsHtml(html, { lat, lng }).filter((item) => item.distanceKm <= radiusKm),
    );
  }
  return all;
}

/**
 * Every Overpass mirror at once, the first non-empty answer kept.
 *
 * Asking them in turn meant three timeouts in a row when the network was
 * having a bad day — a minute and a half before the rider saw anything. They
 * run the same data on different servers, so whichever answers first is the
 * answer.
 */
async function askAnyMirror(mirrors, kind, lat, lng, radiusKm, { fetchImpl, timeoutMs, onError }) {
  return new Promise((resolve, reject) => {
    if (!mirrors.length) {
      reject(new Error("no mirror to ask"));
      return;
    }
    let settled = false;
    let pending = mirrors.length;
    for (const mirror of mirrors) {
      askOverpass(mirror, kind, lat, lng, radiusKm, { fetchImpl, timeoutMs }).then(
        (items) => {
          if (settled) return;
          if (items.length) {
            settled = true;
            resolve(items);
            return;
          }
          if (--pending === 0) {
            settled = true;
            resolve([]);
          }
        },
        (error) => {
          onError?.(mirror, error);
          if (settled) return;
          if (--pending === 0) {
            settled = true;
            reject(new Error("every mirror was busy"));
          }
        },
      );
    }
  });
}

/**
 * How long the whole question is allowed to take.
 *
 * A rider opening this tab expects a list, not a spinner: the sources are
 * asked together and the first good answer wins, so a reachable one arrives in
 * a few hundred milliseconds. The limits below are what happens when the
 * network is having a bad day — never four minutes, as three sequential
 * mirrors and a paced geocoder once added up to.
 */
export const SEARCH_TIMEOUT_MS = 4_000;
export const SEARCH_BUDGET_MS = 5_000;
export const FALLBACK_BUDGET_MS = 2_500;

/**
 * The first non-empty answer, or null once every task has failed or gone
 * quiet past the budget. Each task is `{ label, run }`, and `run` resolves to
 * items — an empty list counts as "no answer", not as a result.
 */
function firstAnswer(tasks, budgetMs) {
  return new Promise((resolve) => {
    let settled = false;
    let pending = tasks.length;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    // The timer is a cap, not a delay: whatever is still in flight when it
    // fires has already lost. It is cleared the moment somebody answers, so a
    // normal search holds the process open for no longer than it takes.
    const timer = setTimeout(() => finish(null), budgetMs);
    if (!pending) {
      finish(null);
      return;
    }
    for (const task of tasks) {
      task.run().then(
        (items) => {
          if (Array.isArray(items) && items.length) finish({ task, items });
          else if (--pending === 0) finish(null);
        },
        () => {
          if (--pending === 0) finish(null);
        },
      );
    }
  });
}

/** Nothing below is trusted to honour its own timeout, so the caller caps it. */
function withCap(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve([]), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Search around a point, asking every source that can answer at the same time.
 *
 * Google, the Overpass mirrors and Photon are all keyless, all free, and all
 * faster than the rider is patient, so they are asked together and the first
 * one with something to say is the answer. Nominatim, which paces its callers
 * and is the slowest, is only asked if the first wave came back with nothing.
 *
 * Never throws for a busy service: the caller gets whatever the first
 * answering source found, and `source` says which one it was so the page can
 * be honest about it. `tried` is there for the log and for the page's own
 * "what did you try" line; `notes` keeps the technical detail.
 */
export async function searchNearby({
  kind,
  lat,
  lng,
  fetchImpl,
  mirrors = OVERPASS_MIRRORS,
  timeoutMs = SEARCH_TIMEOUT_MS,
  budgetMs = SEARCH_BUDGET_MS,
  fallbackBudgetMs = FALLBACK_BUDGET_MS,
} = {}) {
  const radiusKm = KIND_RADIUS_KM[kind];
  if (!radiusKm) throw new Error(`Unknown nearby kind: ${kind}`);
  const origin = { lat, lng };
  const run = fetchImpl ?? globalThis.fetch;

  // `tried` is what the page shows: the sources that were asked, in order,
  // once each, in words a rider reads. `notes` keeps the technical detail.
  const tried = [];
  const notes = [];
  const mark = (label, note) => {
    if (!tried.includes(label)) tried.push(label);
    if (note) notes.push(note);
  };
  const note = (source, error) => notes.push(`${source}: ${error?.message ?? error}`);

  const wave = [
    {
      label: "Google",
      run: async () => {
        try {
          return await askGoogle(kind, lat, lng, radiusKm, { fetchImpl: run, timeoutMs });
        } catch (error) {
          note("google", error);
          return [];
        }
      },
    },
    {
      label: "OpenStreetMap",
      run: async () => {
        try {
          return await askAnyMirror(mirrors, kind, lat, lng, radiusKm, {
            fetchImpl: run,
            timeoutMs,
            onError: (mirror, error) => note(new URL(mirror).host, error?.message ?? error),
          });
        } catch (error) {
          note("overpass", error);
          return [];
        }
      },
    },
    {
      label: "Photon",
      run: async () => {
        try {
          return await askPhoton(kind, lat, lng, radiusKm, { fetchImpl: run, timeoutMs });
        } catch (error) {
          note("photon", error);
          return [];
        }
      },
    },
  ];
  for (const task of wave) tried.push(task.label);

  const winner = await firstAnswer(wave, budgetMs);
  if (winner) {
    return {
      source:
        winner.task.label === "Google"
          ? "google"
          : winner.task.label === "OpenStreetMap"
            ? "overpass"
            : "photon",
      radiusKm,
      items: rankItems(winner.items, kind).slice(0, 40),
      tried,
      notes,
    };
  }

  tried.push("Nominatim");
  try {
    const items = await withCap(
      askNominatim(kind, lat, lng, radiusKm, { fetchImpl: run, timeoutMs: fallbackBudgetMs }),
      fallbackBudgetMs,
    );
    if (items.length) {
      return { source: "nominatim", radiusKm, items: rankItems(items, kind).slice(0, 40), tried, notes };
    }
    notes.push("nominatim: nothing nearby");
  } catch (error) {
    note("nominatim", error);
  }

  return { source: "none", radiusKm, items: [], tried, notes };
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
