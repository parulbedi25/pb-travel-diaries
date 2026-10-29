/**
 * The places a member has looked up, kept on this browser.
 *
 * This is the member's own notebook, not the site's data: a place is saved
 * under the member's id in `localStorage`, so it is private to them, costs the
 * database nothing, and survives a reload. Each place gets an id of its own so
 * it can be opened on a page of its own (`#/ride/place/<id>`) with its pointer
 * drawn on a map.
 *
 * The lookup is Geoapify's geocoder — the same provider that draws the maps and
 * answers the site's nearby search, so there is one key and one account of
 * where a coordinate came from. It needs the network, so a failure is reported
 * plainly and the member can still keep a place by its coordinates.
 */

export interface SavedPlace {
  id: string;
  /** What the member typed, kept as typed — that is the name they know it by. */
  name: string;
  /** The readable address the lookup returned, when it returned one. */
  address?: string;
  lat: number;
  lng: number;
  savedAt: string;
}

const PLACES_PREFIX = "pb:member:places:v1:";

const keyFor = (ownerId: number | string) => `${PLACES_PREFIX}${ownerId}`;

function newId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return random.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
}

/** Keys are per member; a saved place keeps its id forever. */
export function newPlaceId(): string {
  return newId();
}

export function loadSavedPlaces(ownerId: number | string | null | undefined): SavedPlace[] {
  if (ownerId === null || ownerId === undefined) return [];
  try {
    const raw = window.localStorage.getItem(keyFor(ownerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(toSavedPlace)
      .filter((place): place is SavedPlace => place !== null);
  } catch {
    return [];
  }
}

export function storeSavedPlaces(
  ownerId: number | string | null | undefined,
  places: SavedPlace[],
): void {
  if (ownerId === null || ownerId === undefined) return;
  try {
    window.localStorage.setItem(keyFor(ownerId), JSON.stringify(places));
  } catch {
    // Storage full or disabled: the list still works for this visit.
  }
}

/**
 * A place opened from its own page arrives with nothing but an id, and the
 * page does not know whose browser it is. Every member's list is searched, and
 * the ids are random, so a URL only ever finds the place it was made for.
 */
export function findSavedPlaceAnywhere(id: string): SavedPlace | null {
  if (!id) return null;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(PLACES_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      const match = parsed.map(toSavedPlace).find((place) => place?.id === id);
      if (match) return match;
    }
  } catch {
    return null;
  }
  return null;
}

function toSavedPlace(value: unknown): SavedPlace | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  const id = typeof row.id === "string" ? row.id : "";
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id,
    name: typeof row.name === "string" && row.name.trim() ? row.name : "Unnamed place",
    address: typeof row.address === "string" && row.address.trim() ? row.address : undefined,
    lat,
    lng,
    savedAt: typeof row.savedAt === "string" ? row.savedAt : new Date().toISOString(),
  };
}

/* ── looking a place up ──────────────────────────────────────────────── */

export interface PlaceLookup {
  name: string;
  address?: string;
  lat: number;
  lng: number;
}

const round5 = (value: number) => Math.round(value * 1e5) / 1e5;

/** Geoapify gives a whole formatted address; four parts of it are plenty. */
function tidyAddress(hit: { address_line2?: string; formatted?: string }): string | undefined {
  const source = String(hit.address_line2 ?? hit.formatted ?? "").trim();
  if (!source) return undefined;
  const parts = source
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^\d{5,6}$/.test(part));
  const address = parts.slice(0, 4).join(", ");
  return address || undefined;
}

/**
 * Find the place a member typed, with the same geocoder that draws the maps.
 * The name saved is the name they typed — the lookup answers "where", not "what
 * to call it". No key is no lookup: the box says so rather than asking a host
 * that will refuse the request.
 */
export async function findPlaceByName(query: string, key: string): Promise<PlaceLookup | null> {
  const trimmed = query.trim();
  const apiKey = key.trim();
  if (!trimmed || !apiKey) return null;

  const params = new URLSearchParams({
    text: trimmed,
    lang: "en",
    limit: "1",
    format: "json",
    apiKey,
  });
  try {
    const response = await fetch(`https://api.geoapify.com/v1/geocode/search?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      results?: { lat?: number; lon?: number; address_line2?: string; formatted?: string }[];
    };
    const hit = json.results?.[0];
    const lat = Number(hit?.lat);
    const lng = Number(hit?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { name: trimmed, address: tidyAddress(hit ?? {}), lat: round5(lat), lng: round5(lng) };
  } catch {
    return null;
  }
}

/** A coordinate pair typed by hand, for when the lookup cannot be reached. */
export function placeFromCoordinates(
  name: string,
  lat: number,
  lng: number,
): PlaceLookup | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    name: name.trim() || `${lat.toFixed(3)}, ${lng.toFixed(3)}`,
    lat: round5(lat),
    lng: round5(lng),
  };
}

/** The little map's stops: one pointer, named as the member named it. */
export const placeStops = (place: { name: string; lat: number; lng: number }) => [
  { name: place.name, lat: place.lat, lng: place.lng },
];
