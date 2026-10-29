import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { distanceKm, type MapPoint } from "../utils/liveRoute";

/**
 * What a rider needs around a stop: a bed, fuel, a workshop, a hospital.
 *
 * Wikipedia answers "what is worth seeing" — its editors decide what is
 * notable, which is right for places and useless for a petrol pump.
 * OpenStreetMap is the other way round: every fuel station, clinic and
 * motorcycle workshop is tagged, and Overpass serves them without a key.
 *
 * Two questions, each asked through the server (`/api/nearby`), because the
 * server can try three Overpass mirrors and then Nominatim when a mirror is
 * busy — the thing a single browser request cannot do. If the server itself
 * cannot be reached (a static preview, a dropped connection), the browser asks
 * the mirrors directly as a last resort, and only then does the tab say it
 * could not look.
 */

/** How far out each question is asked. A bed is worth a detour; petrol is not. */
export const STAY_RADIUS_KM = 15;
export const FOOD_RADIUS_KM = 12;
export const ESSENTIALS_RADIUS_KM = 25;

/** Kept identical to the server's, so the fallback asks the same question. */
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export type AmenityGroup = "stays" | "food" | "essentials";
export type AmenityKind = "stay" | "eat" | "fuel" | "hospital" | "service";

export interface Amenity {
  /** Stable across reloads, so React keys and pins do not shuffle. */
  id: string;
  kind: AmenityKind;
  title: string;
  lat: number;
  lng: number;
  /** Straight-line kilometres from the place being searched around. */
  distanceKm: number;
  /** One line of what it is: "Guest house · budget", "Fuel · Indian Oil". */
  detail: string;
  /** Royal Enfield's own name on the sign, or a workshop that serves them. */
  royalEnfield?: boolean;
  /** Cheaper kinds of bed: guest houses, hostels, motels. */
  budget?: boolean;
  opening?: string;
  /** Google's own rating out of five, when the answer came from Google. */
  rating?: number;
}

/** Which service answered, so the page can say where its list came from. */
export type AmenitySource = "overpass" | "nominatim" | "google" | "none" | "";

/**
 * The ground a list covers.
 *
 * Normally the town's own boundary, looked up server-side from the stop's
 * name — so "Leh" means the whole of Leh, however far the edges are. When that
 * boundary cannot be found, `city` is false and a radius stood in for it.
 */
export interface AmenityArea {
  label: string;
  spanKm: number;
  city: boolean;
}

/* ------------------------------------------------------------------ *
 * The browser's own attempt, for when the server cannot answer
 * ------------------------------------------------------------------ */

function radiusFor(group: AmenityGroup): number {
  return group === "stays" ? STAY_RADIUS_KM : group === "food" ? FOOD_RADIUS_KM : ESSENTIALS_RADIUS_KM;
}

function overpassQuery(group: AmenityGroup, lat: number, lng: number, radiusKm: number): string {
  const around = `(around:${Math.round(radiusKm * 1000)},${lat.toFixed(4)},${lng.toFixed(4)})`;
  const head = "[out:json][timeout:20]";
  if (group === "stays") {
    return (
      `${head};(` +
      `nwr["tourism"~"^(hotel|guest_house|hostel|motel|apartment|chalet)$"]${around};` +
      `nwr["name"~"lodge|homestay|home stay|guest house|rest house|yatri niwas",i]${around};` +
      `);out center 120;`
    );
  }
  if (group === "food") {
    return (
      `${head};(` +
      `nwr["amenity"~"^(restaurant|cafe|fast_food|food_court|ice_cream)$"]${around};` +
      `nwr["name"~"dhaba|dhabha|bhojanal|bhojnalaya|eatery|restaurant",i]${around};` +
      `);out center 160;`
    );
  }
  return (
    `${head};(` +
    `nwr["amenity"="fuel"]${around};` +
    `nwr["amenity"~"^(hospital|clinic)$"]${around};` +
    `nwr["shop"~"^(motorcycle|car_repair|car_parts|tyres)$"]${around};` +
    `nwr["service:vehicle:motorcycle"="yes"]${around};` +
    `nwr["service:vehicle:car"="yes"]${around};` +
    `nwr["name"~"Royal Enfield",i]${around};` +
    `);out center 200;`
  );
}

const STAY_COPY: Record<string, string> = {
  hotel: "Hotel",
  guest_house: "Guest house",
  hostel: "Hostel",
  motel: "Motel",
  apartment: "Apartment",
  chalet: "Chalet",
};

const LODGE_NAME = /\blodge\b|\bhomestay\b|home stay|rest house|yatri niwas|guest house/i;

const EAT_COPY: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "Cafe",
  fast_food: "Fast food",
  food_court: "Food court",
  ice_cream: "Ice cream",
};

const DHABA_NAME = /dhaba|dhabha|bhojanal|bhojnal|bhojanalya/i;

const SHOP_COPY: Record<string, string> = {
  motorcycle: "Motorcycle workshop",
  car_repair: "Automobile workshop",
  car_parts: "Spare parts",
  tyres: "Tyres & puncture",
};

const RE_NAME = /royal\s*enfield/i;

/** One Overpass element as an amenity, or null when it is not one we asked for. */
export function amenityFrom(element: OverpassElement, origin: MapPoint): Amenity | null {
  const tags = element.tags ?? {};
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  const name = (tags.name ?? "").trim();
  const royalEnfield = RE_NAME.test(name);
  const tourism = tags.tourism ?? "";
  const amenity = tags.amenity ?? "";

  let kind: AmenityKind | null = null;
  let detail = "";
  let budget = false;

  if (STAY_COPY[tourism] || (LODGE_NAME.test(name) && (amenity || tourism || tags.shop))) {
    kind = "stay";
    budget = tourism === "guest_house" || tourism === "hostel" || tourism === "motel" || LODGE_NAME.test(name);
    const stars = tags.stars ? ` · ${tags.stars}★` : "";
    const label = LODGE_NAME.test(name) ? "Lodge" : STAY_COPY[tourism] ?? "Stay";
    detail = `${label}${stars}${budget ? " · budget" : ""}`;
  } else if (EAT_COPY[amenity]) {
    kind = "eat";
    detail = `${DHABA_NAME.test(name) ? "Dhaba" : EAT_COPY[amenity]}${tags.cuisine ? ` · ${tags.cuisine}` : ""}`;
  } else if (amenity === "fuel") {
    kind = "fuel";
    const brand = tags.brand ?? tags.operator ?? "";
    detail = brand ? `Fuel · ${brand}` : "Fuel station";
  } else if (amenity === "hospital" || amenity === "clinic") {
    kind = "hospital";
    detail = `${amenity === "hospital" ? "Hospital" : "Clinic"}${
      tags.emergency === "yes" ? " · emergency" : ""
    }`;
  } else if (
    SHOP_COPY[tags.shop] ||
    tags["service:vehicle:motorcycle"] === "yes" ||
    tags["service:vehicle:car"] === "yes" ||
    royalEnfield
  ) {
    kind = "service";
    detail = royalEnfield
      ? "Royal Enfield · service centre"
      : SHOP_COPY[tags.shop] ?? "Automobile workshop";
  }

  if (!kind) return null;
  // A bed with no name is a bed nobody can ask for; the others read fine as
  // "Fuel station" on a list, so they keep a plain name.
  if (kind === "stay" && !name) return null;
  const title =
    name ||
    (kind === "fuel"
      ? "Fuel station"
      : kind === "hospital"
        ? "Hospital"
        : kind === "eat"
          ? EAT_COPY[amenity] ?? "Eatery"
          : "Workshop");

  return {
    id: `${element.type ?? "nwr"}/${element.id ?? `${lat},${lng}`}`,
    kind,
    title,
    lat,
    lng,
    distanceKm: Number(distanceKm(origin, { lat, lng }).toFixed(2)),
    detail,
    ...(royalEnfield ? { royalEnfield: true } : {}),
    ...(budget ? { budget: true } : {}),
    ...(tags.opening_hours ? { opening: tags.opening_hours } : {}),
  };
}

/**
 * Beds first cheap, then near; everything else near first, with the workshops
 * that carry the rider's own marque moved to the top of the service entries.
 */
/**
 * Nearest first, in one order for both halves of the page.
 *
 * The list is rendered in this order and the pins are laid out in it too, so
 * the first row is always the closest place and the map reads the same way.
 */
export function rankAmenities(items: readonly Amenity[], group: AmenityGroup): Amenity[] {
  const belongs = (item: Amenity) =>
    group === "stays" ? item.kind === "stay" : group === "food" ? item.kind === "eat" : item.kind !== "stay" && item.kind !== "eat";
  const sorted = [...items].filter(belongs).sort((a, b) => a.distanceKm - b.distanceKm);
  // The same place tagged twice — a node and its building way — is one place.
  const seen = new Set<string>();
  return sorted.filter((item) => {
    const key = `${item.title.toLowerCase()}@${item.lat.toFixed(3)},${item.lng.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function askMirror(group: AmenityGroup, lat: number, lng: number, mirror: string): Promise<Amenity[]> {
  const radius = radiusFor(group);
  const response = await fetch(mirror, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: `data=${encodeURIComponent(overpassQuery(group, lat, lng, radius))}`,
    // Six seconds, not twenty: this is a fallback behind a server that already
    // has its own deadline, and a rider is watching a spinner.
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`Overpass answered ${response.status}`);
  const json = (await response.json()) as { elements?: OverpassElement[] };
  const origin = { lat, lng };
  return (json.elements ?? [])
    .map((element) => amenityFrom(element, origin))
    .filter((item): item is Amenity => item !== null);
}

/**
 * The first of several promises to come back with something in it, or null
 * once all of them have failed or answered with nothing.
 */
function firstNonEmpty<T>(work: Promise<T[]>[]): Promise<T[] | null> {
  return new Promise((resolve) => {
    let pending = work.length;
    if (!pending) {
      resolve(null);
      return;
    }
    for (const promise of work) {
      promise.then(
        (value) => {
          if (value.length) resolve(value);
          else if (--pending === 0) resolve(null);
        },
        () => {
          if (--pending === 0) resolve(null);
        },
      );
    }
  });
}

export interface AmenityQuery {
  lat: number;
  lng: number;
  /** The stop's name: what turns a circle around a pin into a town's area. */
  place?: string;
  group: AmenityGroup;
  /** False until the tab that needs it is opened, so nothing is asked for twice over. */
  enabled?: boolean;
}

export interface AmenityResult {
  items: Amenity[];
  loading: boolean;
  error: string;
  /** What was tried, in order, when nothing came back. */
  tried: string[];
  /** Which service answered, or "" while nothing has. */
  source: AmenitySource;
  /** False until the first attempt has finished — the tab waits for this. */
  settled: boolean;
  /** The area the list covers, once an answer has arrived. */
  area: AmenityArea | null;
  loadingSource: string;
  reload: () => void;
}

export function useNearbyAmenities({
  lat,
  lng,
  place = "",
  group,
  enabled = true,
}: AmenityQuery): AmenityResult {
  const [items, setItems] = useState<Amenity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState<AmenitySource>("");
  const [tried, setTried] = useState<string[]>([]);
  const [loadingSource, setLoadingSource] = useState("Google & OpenStreetMap");
  const [settled, setSettled] = useState(false);
  const [area, setArea] = useState<AmenityArea | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cache = useRef(new Map<string, Amenity[]>());
  const requestId = useRef(0);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const key = `${group}:${lat.toFixed(3)},${lng.toFixed(3)}:${place.toLowerCase()}`;

    if (attempt === 0) {
      const cached = cache.current.get(key);
      if (cached) {
        setItems(cached);
        setLoading(false);
        setError("");
        return;
      }
    }

    const mine = ++requestId.current;
    let cancelled = false;
    setLoading(true);
    setError("");
    setLoadingSource("Google & OpenStreetMap");

    const run = async () => {
      // A hard cap on top of the server's own: whatever happens, the tab stops
      // waiting and says something rather than spinning.
      const capped = <T,>(work: Promise<T>, ms: number): Promise<T | null> =>
        Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

      try {
        // The server asks every source at once and answers with the first that
        // has anything; this is the route that works, and the only one needed.
        const viaServer = await capped(
          api
            .get<{
              items: Amenity[];
              source: AmenitySource;
              tried?: string[];
              area?: AmenityArea | null;
            }>(
              `/api/nearby?kind=${group}&lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}${
                place ? `&place=${encodeURIComponent(place)}` : ""
              }`,
            )
            .catch(() => null),
          12_000,
        );
        if (cancelled || mine !== requestId.current) return;

        if (viaServer) {
          setTried(Array.isArray(viaServer.tried) ? viaServer.tried : []);
          if (viaServer.area) setArea(viaServer.area);
          const ranked = rankAmenities(viaServer.items, group).slice(0, 40);
          cache.current.set(key, ranked);
          setItems(ranked);
          setSource(viaServer.source);
          if (!ranked.length) {
            setError(
              group === "stays"
                ? "No beds came back for this point just now. Try a bigger town, reload, or open the Google Maps search below."
                : "No fuel, workshops or hospitals came back for this point just now. Try a bigger town, reload, or open the Google Maps search below.",
            );
          }
          return;
        }

        // The server itself did not answer: ask the mirrors from here, all at
        // once, and take whichever is first with anything.
        setLoadingSource("OpenStreetMap (direct)");
        const direct = await capped(
          firstNonEmpty(MIRRORS.map((mirror) => askMirror(group, lat, lng, mirror))).catch(() => []),
          8_000,
        );
        if (cancelled || mine !== requestId.current) return;
        const ranked = rankAmenities(direct ?? [], group).slice(0, 40);
        if (ranked.length) {
          cache.current.set(key, ranked);
          setItems(ranked);
          setSource("overpass");
          return;
        }
        setItems([]);
        setSource("none");
        setError("Could not look this up just now. Try again in a minute, or open the Google Maps search below.");
      } catch {
        if (cancelled || mine !== requestId.current) return;
        setItems([]);
        setSource("none");
        setError("Could not look this up just now. Try again in a minute.");
      } finally {
        if (!cancelled && mine === requestId.current) {
          setLoading(false);
          setSettled(true);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [lat, lng, place, group, enabled, attempt]);

  return { items, loading, error, source, tried, settled, area, loadingSource, reload };
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}
