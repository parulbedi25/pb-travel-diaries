/**
 * Finding a place by typing its name, and knowing where it belongs in a ride.
 *
 * Two small jobs, both done here so they can be reasoned about and tested
 * without a browser:
 *
 *  1. **Suggestions.** Geoapify's autocomplete answers partial text — "anand"
 *     — with the places that start like that, each with a name, a region and
 *     coordinates. That is what the typeahead shows under the box after a
 *     couple of keystrokes, instead of making the operator finish the name and
 *     press Find.
 *  2. **Placement.** A stop typed into a route has no index: "Mandi" belongs
 *     between Nangal and Manali, not appended after Leh. `insertAlong` finds
 *     the leg of the route the point sits nearest to and drops it in there, so
 *     the sequence keeps describing the road even when stops are added out of
 *     order.
 *
 * Nothing here writes to the site; the editor decides what to do with the
 * answer. A failure is an empty list, never an exception — a geocoder that is
 * briefly angry must not take the dashboard down with it.
 */
import { placeRegion, shortPlaceName } from "./placeNames";

/** One place the typeahead can offer. */
export interface PlaceHit {
  /** "Mandi" — the part that goes on the pin. */
  name: string;
  /** "Himachal Pradesh, India" — the line under it, when the service says. */
  region: string;
  lat: number;
  lng: number;
  /** What the service called it, for a tooltip: "city", "town", "village"… */
  kind?: string;
  /** The whole address, used to tell two same-named places apart. */
  address?: string;
}

export interface PlaceSearchOptions {
  /** The site's Geoapify key — the same one the map is drawn with. */
  key: string;
  /** How many suggestions to ask for. Six fits under a box without scrolling. */
  limit?: number;
  /** Narrow the answer to one country, as an ISO code ("in"). */
  country?: string;
  /** Prefer places near this point — a rider in Punjab gets Punjab first. */
  near?: { lat: number; lng: number };
}

const AUTOCOMPLETE_URL = "https://api.geoapify.com/v1/geocode/autocomplete";
/** Keyless OpenStreetMap geocoders, used when the site has no Geoapify key. */
const PHOTON_URL = "https://photon.komoot.io/api";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/** Longer than this and it is not a place name, it is a pasted paragraph. */
const MAX_TERM = 120;

/**
 * The request behind the suggestions.
 *
 * Built separately from the fetch so the shape of it — which parameters, which
 * key — can be checked without a network. An empty key means "no suggestions":
 * the caller shows the typed name as a single result and moves on.
 */
export function autocompleteUrl(term: string, options: PlaceSearchOptions): string | null {
  const text = term.trim().replace(/\s+/g, " ").slice(0, MAX_TERM);
  const apiKey = options.key.trim();
  if (!text || !apiKey) return null;

  const params = new URLSearchParams({
    text,
    lang: "en",
    limit: String(Math.min(Math.max(options.limit ?? 6, 1), 10)),
    format: "json",
    apiKey,
  });
  if (options.country) params.set("filter", `countrycode:${options.country.toLowerCase()}`);
  if (options.near) params.set("bias", `proximity:${options.near.lng},${options.near.lat}`);

  return `${AUTOCOMPLETE_URL}?${params.toString()}`;
}

/**
 * The keyless fallback's request: OpenStreetMap places by Photon.
 *
 * The dashboard cannot assume the site has a Geoapify key — a fresh install
 * has none until somebody pastes one into the map settings — and a suggestion
 * box that says "no key" on a brand-new site is a suggestion box that does not
 * work. Photon answers partial names, needs no account, and sends CORS
 * headers, so the same box suggests places either way.
 */
export function photonUrl(term: string, options: Omit<PlaceSearchOptions, "key">): string | null {
  const text = term.trim().replace(/\s+/g, " ").slice(0, MAX_TERM);
  if (!text) return null;
  const params = new URLSearchParams({
    q: text,
    limit: String(Math.min(Math.max(options.limit ?? 6, 1), 10)),
    lang: "en",
  });
  // Photon takes a point to sort by, and a box to stay inside; the point is
  // what makes a rider typing "Mandi" get the one in Himachal first.
  if (options.near) {
    params.set("lat", String(options.near.lat));
    params.set("lon", String(options.near.lng));
  }
  return `${PHOTON_URL}?${params.toString()}`;
}

/** The last resort: Nominatim, which always answers but asks to be asked rarely. */
export function nominatimUrl(term: string, options: Omit<PlaceSearchOptions, "key">): string | null {
  const text = term.trim().replace(/\s+/g, " ").slice(0, MAX_TERM);
  if (!text) return null;
  const params = new URLSearchParams({
    q: text,
    format: "jsonv2",
    limit: String(Math.min(Math.max(options.limit ?? 6, 1), 10)),
    addressdetails: "1",
    "accept-language": "en",
  });
  if (options.country) params.set("countrycodes", options.country.toLowerCase());
  return `${NOMINATIM_URL}?${params.toString()}`;
}

/**
 * One result, as the box shows it.
 *
 * Geoapify returns `{ name, city, state, country, lat, lon, result_type }` and
 * a `formatted` line. The name is what a rider would write on a sign; the
 * region is what tells two of them apart — there is a Mandi in Himachal and
 * another in Madhya Pradesh, and picking the wrong one puts the bike 900 km
 * away.
 */
export function placeFromResult(result: unknown): PlaceHit | null {
  if (!result || typeof result !== "object") return null;
  const row = result as Record<string, unknown>;
  const lat = Number(row.lat);
  const lng = Number(row.lon ?? row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  const formatted = typeof row.formatted === "string" ? row.formatted.trim() : "";
  const name =
    (typeof row.name === "string" && row.name.trim()) ||
    shortPlaceName(formatted) ||
    (typeof row.city === "string" && row.city.trim()) ||
    `${lat.toFixed(3)}, ${lng.toFixed(3)}`;

  const parts = [row.state, row.country]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean);
  // A landmark answer often carries no `state`, only a formatted address —
  // "Mandi, Himachal Pradesh, India" — so the region is read out of that
  // rather than left blank, which is what tells two Mandis apart.
  const region = parts.length
    ? parts.join(", ")
    : (placeRegion(formatted) ?? "") ||
      [row.county, row.city]
        .map((part) => (typeof part === "string" ? part.trim() : ""))
        .filter(Boolean)
        .join(", ");

  return {
    name,
    region,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    kind: typeof row.result_type === "string" ? row.result_type : undefined,
    address: formatted || undefined,
  };
}

/** Every usable result from an autocomplete answer, in the order it came. */
export function placesFromResponse(json: unknown, limit = 6): PlaceHit[] {
  const results = (json as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: PlaceHit[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    const place = placeFromResult(result);
    if (!place) continue;
    // Two rows for the same village (a node and its boundary) read as a bug.
    const key = `${place.name.toLowerCase()}|${place.lat.toFixed(3)}|${place.lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
    if (out.length >= limit) break;
  }
  return out;
}

/** Photon's `features` as suggestions, with the same shape as the rest. */
export function placesFromPhoton(json: unknown, limit = 6): PlaceHit[] {
  const features = (json as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: PlaceHit[] = [];
  const seen = new Set<string>();
  for (const raw of features) {
    const feature = raw as {
      geometry?: { coordinates?: unknown[] };
      properties?: Record<string, unknown>;
    };
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const props = feature.properties ?? {};
    const text = (key: string) => (typeof props[key] === "string" ? (props[key] as string).trim() : "");
    const name = text("name") || text("city") || text("county") || text("state");
    if (!name) continue;

    const key = `${name.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const region = [text("state"), text("country")]
      .filter(Boolean)
      .join(", ");
    out.push({
      name,
      region,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      kind: text("osm_value") || text("type") || undefined,
      address: [name, text("city"), text("state"), text("country")]
        .filter(Boolean)
        .join(", "),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Nominatim's hits as suggestions. */
export function placesFromNominatim(json: unknown, limit = 6): PlaceHit[] {
  if (!Array.isArray(json)) return [];
  const out: PlaceHit[] = [];
  const seen = new Set<string>();
  for (const raw of json) {
    const row = raw as Record<string, unknown>;
    const lat = Number(row.lat);
    const lng = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const display = typeof row.display_name === "string" ? row.display_name.trim() : "";
    const name =
      (typeof row.name === "string" && row.name.trim()) ||
      shortPlaceName(display) ||
      display.split(",")[0]?.trim() ||
      "";
    if (!name) continue;
    const key = `${name.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // `addressdetails=1` gives the state and country as fields, which reads
    // better than a district plucked out of the display name: "Punjab, India"
    // tells two Anandpurs apart, "Rupnagar" tells nobody anything.
    const address = (row.address ?? {}) as Record<string, unknown>;
    const field = (key: string) =>
      typeof address[key] === "string" ? (address[key] as string).trim() : "";
    const region =
      [field("state"), field("country")].filter(Boolean).join(", ") || (placeRegion(display) ?? "");

    out.push({
      name,
      region,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      kind: typeof row.type === "string" ? row.type : undefined,
      address: display || undefined,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** One request, parsed. Returns null when the service answered nothing usable. */
async function ask(
  url: string,
  parse: (json: unknown, limit: number) => PlaceHit[],
  limit: number,
  fetchImpl: typeof fetch,
): Promise<PlaceHit[] | null> {
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const found = parse(await response.json(), limit);
    return found.length ? found : null;
  } catch {
    return null;
  }
}

/**
 * Suggestions for what has been typed.
 *
 * Three services, tried in the order that gives the best answer first: the
 * site's own Geoapify key when there is one, then Photon, then Nominatim —
 * both keyless OpenStreetMap geocoders. A site with no key still suggests
 * places, and a service that is down costs a moment rather than the box.
 * Nothing here throws: an empty list is the worst this can do.
 */
export async function searchPlaces(
  term: string,
  options: PlaceSearchOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<PlaceHit[]> {
  const limit = Math.min(options.limit ?? 6, 10);

  const geoapify = autocompleteUrl(term, options);
  if (geoapify) {
    const found = await ask(geoapify, placesFromResponse, limit, fetchImpl);
    if (found) return found;
  }

  const photon = photonUrl(term, options);
  if (photon) {
    const found = await ask(photon, placesFromPhoton, limit, fetchImpl);
    if (found) return found;
  }

  const nominatim = nominatimUrl(term, options);
  if (nominatim) {
    const found = await ask(nominatim, placesFromNominatim, limit, fetchImpl);
    if (found) return found;
  }

  return [];
}

/* ------------------------------------------------------------------ *
 * Where a place belongs in the sequence
 * ------------------------------------------------------------------ */

/** A stop as placement needs it: a position, and an identity for the caller. */
export interface Placeable {
  lat: number;
  lng: number;
}

const RAD = Math.PI / 180;

/** Kilometres between two points on the globe. */
export function kmBetween(a: Placeable, b: Placeable): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * How far a point sits from one leg of the route.
 *
 * Measured in the flat plane: over the length of a leg on a map of India the
 * error is a few metres, and a straight line in degrees is far cheaper and far
 * easier to reason about than a great-circle projection for a question that
 * only needs "which leg".
 */
function legOffsets(point: Placeable, from: Placeable, to: Placeable): number {
  const scale = Math.cos(((from.lat + to.lat) / 2) * RAD) || 1;
  const ax = (to.lng - from.lng) * scale;
  const ay = to.lat - from.lat;
  const px = (point.lng - from.lng) * scale;
  const py = point.lat - from.lat;
  const lengthSq = ax * ax + ay * ay;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (px * ax + py * ay) / lengthSq));
  const nearest = { lat: from.lat + ay * t, lng: from.lng + (ax * t) / scale };
  return kmBetween(point, nearest);
}

/**
 * The index a new stop should be inserted at, so the sequence still follows the
 * road.
 *
 * The leg the point sits closest to wins, and it goes after that leg's first
 * stop. With one stop there is only one answer (the end); with none it is 0.
 * A point that is nowhere near the route still needs somewhere to live, so the
 * nearest leg is used rather than refusing — an out-and-back detour the rider
 * intends is not an error to guess about.
 */
export function insertIndexAlong(stops: readonly Placeable[], point: Placeable): number {
  if (stops.length === 0) return 0;
  if (stops.length === 1) return 1;
  let best = { index: 1, offKm: Infinity };
  for (let i = 0; i < stops.length - 1; i += 1) {
    const offKm = legOffsets(point, stops[i], stops[i + 1]);
    if (offKm < best.offKm) best = { index: i + 1, offKm };
  }
  return best.index;
}

/** The same list with `item` dropped into the place the road implies. */
export function insertAlong<T extends Placeable>(stops: readonly T[], item: T): T[] {
  const next = [...stops];
  next.splice(insertIndexAlong(stops, item), 0, item);
  return next;
}
