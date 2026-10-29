/**
 * The places a member has looked up, kept on this browser.
 *
 * This is the member's own notebook, not the site's data: a place is saved
 * under the member's id in `localStorage`, so it is private to them, costs the
 * database nothing, and survives a reload. Each place gets an id of its own so
 * it can be opened on a page of its own (`#/ride/place/<id>`) with its pointer
 * drawn on a map.
 *
 * The lookup itself is the same pair the dashboard's stop editor uses —
 * Nominatim first, because it knows landmarks as well as towns, then
 * Open-Meteo's geocoder, which is smaller but fast and not rate-limited per
 * second. Both need the network, so a failure is reported plainly and the
 * member can still keep a place by its coordinates.
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

/** Nominatim gives the name as the first part of its long display name. */
function tidyAddress(displayName: string | undefined): string | undefined {
  if (!displayName) return undefined;
  const parts = displayName
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  // Drop the postal code and the country: "India, 175131" is noise on a card.
  const kept = parts.filter((part, index) => index < parts.length - 1 || !/^\d{5,6}$/.test(part));
  const address = kept.slice(0, 4).join(", ");
  return address || undefined;
}

async function lookupNominatim(query: string): Promise<PlaceLookup | null> {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=" +
    encodeURIComponent(query);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const rows = (await response.json()) as {
    lat?: string;
    lon?: string;
    display_name?: string;
  }[];
  const first = Array.isArray(rows) ? rows[0] : undefined;
  const lat = Number(first?.lat);
  const lng = Number(first?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    name: query,
    address: tidyAddress(first?.display_name),
    lat: round5(lat),
    lng: round5(lng),
  };
}

async function lookupOpenMeteo(query: string): Promise<PlaceLookup | null> {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=" +
    encodeURIComponent(query);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const json = (await response.json()) as {
    results?: {
      name?: string;
      latitude?: number;
      longitude?: number;
      admin1?: string;
      country?: string;
    }[];
  };
  const first = json.results?.[0];
  if (typeof first?.latitude !== "number" || typeof first?.longitude !== "number") return null;
  const place = [first.admin1, first.country].filter(Boolean).join(", ");
  return {
    name: query,
    address: place || undefined,
    lat: round5(first.latitude),
    lng: round5(first.longitude),
  };
}

/**
 * Find the place a member typed. The name saved is the name they typed — the
 * lookup answers "where", not "what to call it".
 */
export async function findPlaceByName(query: string): Promise<PlaceLookup | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  try {
    const found = await lookupNominatim(trimmed);
    if (found) return found;
  } catch {
    // Fall through to the second service.
  }
  try {
    return await lookupOpenMeteo(trimmed);
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
