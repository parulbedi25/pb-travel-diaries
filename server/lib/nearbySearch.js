/**
 * Finding a bed, a meal, a pump, a workshop or a hospital near a point.
 *
 * Everything here is Geoapify. It is a licensed API with a real key, so there
 * is one answer to ask for instead of four to race: two requests, both cheap.
 *
 *  1. **What is the town?** A forward geocode of the stop's name, asked for a
 *     *city*, returns the town's own boundary id and its box. That boundary is
 *     the whole question — "every bed in Anandpur Sahib" — and not a circle
 *     around the pin, which is what used to put Nangal's hotels in Anandpur's
 *     tab and Nangal's workshops in Kiratpur's.
 *  2. **What is in it?** One Places query per tab with `filter=place:<id>`,
 *     which is the provider's own clipping to that boundary. There is no
 *     radius here at all, deliberately: a radius is the shape of the bug this
 *     replaced, so a town that has nothing in it gets an empty tab with the
 *     reason, never the next town's list.
 *
 * What comes back is mapped onto the same item the page has always drawn —
 * name, kind, one line of detail, an opening time, a distance from the rider's
 * own stop — so the page did not have to learn a new vocabulary for a new
 * provider. The OSM tags behind each record (`datasource.raw`) still decide the
 * wording: a dhaba is a restaurant with a different sign on it, a `stars` tag
 * on a hotel is its star class, and a Royal Enfield name on a workshop is the
 * one a rider can actually be fixed at.
 *
 * Nothing is thrown at the caller for a busy service: a failed search returns
 * no items and says why, and the ten-minute cache means flipping between tabs
 * costs one request rather than one per flip.
 */

export const KINDS = ["stays", "food", "essentials"];

/**
 * A town, not a district and not a state.
 *
 * A settlement's own boundary is what a rider means by "all of Mohali". A
 * tehsil or district boundary — Rupnagar, which holds both Anandpur Sahib and
 * Nangal — is not: that is the shape that put Nangal's hotels in Anandpur's
 * list, and Geoapify will happily return one if it is asked for a county.
 */
export const SETTLEMENT_RANKS = ["city", "town", "village", "municipality", "borough", "suburb"];

/** A boundary wider than this is a district wearing a town's name. */
export const MAX_AREA_SPAN_KM = 45;

/** The geocode is one quick question before the real one. */
export const AREA_TIMEOUT_MS = 4_000;
/** The places query is the one worth waiting a moment for. */
export const SEARCH_TIMEOUT_MS = 7_000;

export const GEOCODE_URL = "https://api.geoapify.com/v1/geocode/search";
export const REVERSE_URL = "https://api.geoapify.com/v1/geocode/reverse";
export const PLACES_URL = "https://api.geoapify.com/v2/places";

/**
 * The key the build ships with, so a fresh site's map and its nearby tabs work
 * before anybody opens the dashboard. It is the same value the map settings
 * default to in `src/store/siteContent.tsx` — the browser bundle and this
 * server are built separately, so the two constants have to agree by hand.
 * `GEOAPIFY_KEY` in the environment overrides both, and is the one to set on a
 * deployment where the tile key must stay separate from the search key.
 */
export const DEFAULT_GEOAPIFY_KEY = "0383366d3de84c54b9383738d8e60a28";

/**
 * What each tab asks for, in Geoapify's category vocabulary.
 *
 * Parents on purpose: `accommodation` covers hotels, guest houses, hostels,
 * motels, apartments and chalets, and a new leaf category added by the provider
 * tomorrow is then still included rather than silently missed. `commercial`
 * vehicle is where a Royal Enfield dealer lives when it is tagged as a
 * motorcycle shop rather than a workshop.
 */
export const KIND_CATEGORIES = {
  stays: ["accommodation"],
  food: ["catering"],
  essentials: ["service.vehicle", "commercial.vehicle", "healthcare"],
};

/** How many places one tab may return, and how many the provider sends. */
const RESULT_LIMIT = 60;
const PAGE_LIMIT = 100;

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map();

/* ── small maths, shared with the rest of the app ────────────────────── */

/** A box: `{ south, north, west, east }`, in degrees. */
export function boundsFromBbox(bbox) {
  const lat1 = Number(bbox?.lat1);
  const lat2 = Number(bbox?.lat2);
  const lon1 = Number(bbox?.lon1);
  const lon2 = Number(bbox?.lon2);
  if (![lat1, lat2, lon1, lon2].every(Number.isFinite)) return null;
  return {
    south: Math.min(lat1, lat2),
    north: Math.max(lat1, lat2),
    west: Math.min(lon1, lon2),
    east: Math.max(lon1, lon2),
  };
}

/** How wide a box is — its longer side, in kilometres. */
export function spanKmOf(bounds) {
  const midLat = ((bounds.north + bounds.south) / 2) * (Math.PI / 180);
  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.32 * Math.cos(midLat);
  const height = (bounds.north - bounds.south) * kmPerDegLat;
  const width = (bounds.east - bounds.west) * kmPerDegLng;
  return Math.max(Math.abs(width), Math.abs(height));
}

/** Great-circle kilometres — the same figure the page shows. */
export function kmBetween(a, b) {
  const rad = (value) => (value * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ── the town ────────────────────────────────────────────────────────── */

/** The name a rider would use for an area: "Leh", "Nangal". */
function areaLabelOf(hit, fallback) {
  const name = String(hit?.city ?? hit?.name ?? hit?.address_line1 ?? "").trim();
  return name || String(fallback ?? "").trim();
}

function isEmptyArea(place) {
  return { label: String(place ?? "").trim(), bounds: null, spanKm: 0, city: false, placeId: null };
}

async function geocode(url, params, { fetchImpl, timeoutMs }) {
  const query = new URLSearchParams(params).toString();
  const response = await fetchImpl(`${url}?${query}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Geoapify answered ${response.status}`);
  const json = await response.json();
  return Array.isArray(json?.results) ? json.results : [];
}

/**
 * The town the stop is in, and the boundary id the places query clips to.
 *
 * Asked by name first — that is the question the page already has an answer to
 * — and by coordinate when the stop has no name. A result is only accepted if
 * it reads like a settlement and is not so wide that it must be a district, so
 * the honest failure ("no area") stays possible instead of a town-sized answer
 * being invented.
 */
export async function areaFor({ place, lat, lng, key, fetchImpl, timeoutMs = AREA_TIMEOUT_MS }) {
  const run = fetchImpl ?? globalThis.fetch;
  const ask = { key, lang: "en", limit: "5", format: "json" };
  const wanted = String(place ?? "").trim();

  let results = [];
  try {
    if (wanted) {
      results = await geocode(
        GEOCODE_URL,
        { ...ask, text: wanted, type: "city" },
        { fetchImpl: run, timeoutMs },
      );
      // A hamlet is not a city: if the strict question finds nothing, ask the
      // open one and read the result's own type instead.
      if (!results.length) {
        results = await geocode(
          GEOCODE_URL,
          { ...ask, text: wanted },
          { fetchImpl: run, timeoutMs },
        );
      }
    } else if (Number.isFinite(lat) && Number.isFinite(lng)) {
      results = await geocode(
        REVERSE_URL,
        { ...ask, lat: String(lat), lon: String(lng) },
        { fetchImpl: run, timeoutMs },
      );
    }
  } catch {
    // A geocoder having a bad day is an empty answer, not a crash: the page
    // says it could not find the area rather than showing another town's list.
    return isEmptyArea(wanted);
  }

  for (const hit of results) {
    const rank = String(hit?.result_type ?? "");
    if (rank && !SETTLEMENT_RANKS.includes(rank)) continue;
    const bounds = boundsFromBbox(hit?.bbox);
    if (!bounds) continue;
    const spanKm = spanKmOf(bounds);
    if (spanKm > MAX_AREA_SPAN_KM) continue;
    const placeId = typeof hit?.place_id === "string" ? hit.place_id : null;
    if (!placeId) continue;
    return {
      label: areaLabelOf(hit, wanted),
      bounds,
      spanKm: Number(spanKm.toFixed(1)),
      city: true,
      placeId,
    };
  }

  return isEmptyArea(wanted);
}

/* ── one place, read as an item ──────────────────────────────────────── */

const RE_NAME = /royal\s*enfield|\benfield\b|\bRE\s+(service|motors|showroom)\b/i;
/**
 * Names that mean a bed without a category to say so. "Guest house" is not in
 * here on purpose: it is a category of its own, and a hotel called "Chospa
 * Guest House" should not be relabelled a lodge.
 */
const LODGE_NAME = /\blodge\b|\bhomestay\b|home stay|rest house|yatri niwas/i;
const DHABA_NAME = /dhaba|dhabha|bhojanal|bhojnal|bhojanalya/i;

const STAY_COPY = {
  "accommodation.hotel": "Hotel",
  "accommodation.guest_house": "Guest house",
  "accommodation.hostel": "Hostel",
  "accommodation.motel": "Motel",
  "accommodation.apartment": "Apartment",
  "accommodation.chalet": "Chalet",
  "accommodation.hostel_dormitory": "Hostel dorm",
};

const EAT_COPY = {
  "catering.restaurant": "Restaurant",
  "catering.cafe": "Cafe",
  "catering.fast_food": "Fast food",
  "catering.food_court": "Food court",
  "catering.ice_cream": "Ice cream",
};

const BUDGET_STAYS = new Set([
  "accommodation.guest_house",
  "accommodation.hostel",
  "accommodation.motel",
]);

/** The most specific category a record carries, longest key wins. */
function leafOf(categories, prefix) {
  const matches = (categories ?? []).filter((name) => String(name).startsWith(prefix));
  return matches.sort((a, b) => String(b).length - String(a).length)[0] ?? "";
}

/**
 * One Geoapify feature as the item the page draws, or null when it is not one
 * of the things this tab asked for.
 */
export function itemFromFeature(feature, origin) {
  const props = feature?.properties ?? {};
  const coords = feature?.geometry?.coordinates;
  const lng = Number(Array.isArray(coords) ? coords[0] : props.lon);
  const lat = Number(Array.isArray(coords) ? coords[1] : props.lat);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const categories = Array.isArray(props.categories) ? props.categories.map(String) : [];
  const tags = props.datasource?.raw ?? {};
  const name = String(props.name ?? tags.name ?? "").trim();
  const royalEnfield = RE_NAME.test(name);

  let kind = null;
  let detail = "";
  let budget = false;

  const stayLeaf = leafOf(categories, "accommodation");
  const eatLeaf = leafOf(categories, "catering");
  const healthLeaf = leafOf(categories, "healthcare");
  const vehicleLeaf = leafOf(categories, "service.vehicle") || leafOf(categories, "commercial.vehicle");

  if (stayLeaf || categories.includes("accommodation")) {
    kind = "stay";
    budget = BUDGET_STAYS.has(stayLeaf) || LODGE_NAME.test(name);
    const stars = tags.stars ? ` · ${String(tags.stars).replace(/[^\d.]/g, "")}★` : "";
    const label = LODGE_NAME.test(name) ? "Lodge" : STAY_COPY[stayLeaf] ?? "Stay";
    detail = `${label}${stars}${budget ? " · budget" : ""}`;
  } else if (eatLeaf || categories.includes("catering")) {
    kind = "eat";
    const cuisine = typeof tags.cuisine === "string" ? tags.cuisine.replace(/;/g, ", ") : "";
    detail = `${DHABA_NAME.test(name) ? "Dhaba" : EAT_COPY[eatLeaf] ?? "Eatery"}${
      cuisine ? ` · ${cuisine}` : ""
    }`;
  } else if (categories.includes("service.vehicle.fuel")) {
    kind = "fuel";
    const brand = String(props.brand ?? tags.brand ?? tags.operator ?? "").trim();
    detail = brand ? `Fuel · ${brand}` : "Fuel station";
  } else if (healthLeaf || categories.includes("healthcare")) {
    kind = "hospital";
    const label = healthLeaf === "healthcare.hospital" ? "Hospital" : "Clinic";
    detail = `${label}${tags.emergency === "yes" ? " · emergency" : ""}`;
  } else if (vehicleLeaf || categories.includes("service.vehicle") || categories.includes("commercial.vehicle")) {
    kind = "service";
    const vehicleType = String(props.commercial?.type ?? tags.shop ?? "");
    detail = royalEnfield
      ? "Royal Enfield · service centre"
      : /motorcycle/i.test(vehicleType)
        ? "Motorcycle workshop"
        : /car/i.test(vehicleType)
          ? "Car workshop"
          : "Automobile workshop";
  }

  if (!kind) return null;
  // A bed with no name is a bed nobody can ask for; the others read fine
  // unnamed, so they keep a plain title.
  if (kind === "stay" && !name) return null;

  const title =
    name ||
    (kind === "fuel"
      ? "Fuel station"
      : kind === "hospital"
        ? "Hospital"
        : kind === "eat"
          ? EAT_COPY[eatLeaf] ?? "Eatery"
          : "Workshop");

  const rating = Number.parseFloat(String(tags.stars ?? ""));
  const opening = String(props.opening_hours ?? tags.opening_hours ?? "").trim();

  return {
    id: String(props.place_id ?? `geoapify/${lat.toFixed(5)},${lng.toFixed(5)}`),
    kind,
    title,
    lat,
    lng,
    distanceKm: Number(kmBetween(origin, { lat, lng }).toFixed(2)),
    detail,
    ...(royalEnfield ? { royalEnfield: true } : {}),
    ...(budget ? { budget: true } : {}),
    ...(opening ? { opening } : {}),
    ...(Number.isFinite(rating) && rating > 0 && rating <= 5 ? { rating } : {}),
  };
}

/** Nearest first, with the rider's own marque at the top of the service tab. */
export function rankItems(items, kind) {
  return [...items].sort((a, b) => {
    if (kind === "essentials" && Boolean(a.royalEnfield) !== Boolean(b.royalEnfield)) {
      return a.royalEnfield ? -1 : 1;
    }
    return a.distanceKm - b.distanceKm;
  });
}

/* ── the search ──────────────────────────────────────────────────────── */

async function askPlaces(kind, area, origin, { key, fetchImpl, timeoutMs }) {
  const run = fetchImpl ?? globalThis.fetch;
  const filter = area.placeId
    ? `place:${area.placeId}`
    : `rect:${area.bounds.west},${area.bounds.south},${area.bounds.east},${area.bounds.north}`;
  const query = new URLSearchParams({
    categories: KIND_CATEGORIES[kind].join(","),
    filter,
    limit: String(PAGE_LIMIT),
    lang: "en",
  });
  const response = await run(`${PLACES_URL}?${query.toString()}&apiKey=${encodeURIComponent(key)}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Geoapify places answered ${response.status}`);
  const json = await response.json();
  const features = Array.isArray(json?.features) ? json.features : [];
  return features
    .map((feature) => itemFromFeature(feature, origin))
    .filter((item) => item !== null);
}

/**
 * A whole town's worth of one kind of place.
 *
 * Never throws for a busy service: the caller gets the items that came back and
 * `tried`/`notes` say what happened, so the page can be honest rather than
 * showing a spinner that never resolves.
 */
export async function searchNearby({
  kind,
  lat,
  lng,
  place,
  key,
  fetchImpl,
  timeoutMs = SEARCH_TIMEOUT_MS,
  areaTimeoutMs = AREA_TIMEOUT_MS,
} = {}) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown nearby kind: ${kind}`);
  const origin = { lat, lng };
  const notes = [];

  if (!key) {
    return {
      source: "none",
      area: null,
      items: [],
      tried: [],
      notes: ["geoapify: no key configured"],
    };
  }

  const area = await areaFor({ place, lat, lng, key, fetchImpl, timeoutMs: areaTimeoutMs });
  const areaOut = { label: area.label, spanKm: area.spanKm, city: area.city };

  // No town boundary, no list. Without one the only thing left is a circle
  // around the pin, which is what used to answer with the next town's places —
  // so the honest answer is nothing, with the reason.
  if (!area.placeId) {
    return {
      source: "none",
      area: areaOut,
      reason: "no-area",
      items: [],
      tried: [],
      notes: ["area: no settlement boundary found"],
    };
  }

  try {
    const items = await askPlaces(kind, area, origin, { key, fetchImpl, timeoutMs });
    return {
      source: "geoapify",
      area: areaOut,
      items: rankItems(items, kind).slice(0, RESULT_LIMIT),
      tried: ["Geoapify"],
      notes,
    };
  } catch (error) {
    notes.push(`geoapify: ${error?.message ?? error}`);
    return {
      source: "none",
      area: areaOut,
      items: [],
      tried: ["Geoapify"],
      notes,
    };
  }
}

/** The cached answer for a point, or a fresh one. */
export async function searchNearbyCached(params) {
  // The place is part of the key: two towns a few hundred metres apart still
  // mean different areas, and one must not be answered with the other's list.
  const cacheKey = `${params.kind}:${Number(params.lat).toFixed(3)},${Number(params.lng).toFixed(3)}:${String(
    params.place ?? "",
  )
    .trim()
    .toLowerCase()}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, cached: true };

  const value = await searchNearby(params);
  // Only a real answer is worth keeping; a failed one should be retried the
  // next time somebody opens the tab.
  if (value.items.length || value.source !== "none" || value.reason) {
    cache.set(cacheKey, { at: Date.now(), value });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  return { ...value, cached: false };
}

/** For tests: forget everything remembered. */
export function clearNearbyCache() {
  cache.clear();
}
