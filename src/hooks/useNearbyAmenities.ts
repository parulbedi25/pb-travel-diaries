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
export const ESSENTIALS_RADIUS_KM = 25;

/** Kept identical to the server's, so the fallback asks the same question. */
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export type AmenityGroup = "stays" | "essentials";
export type AmenityKind = "stay" | "fuel" | "hospital" | "service";

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
}

/** Which service answered, so the page can say where its list came from. */
export type AmenitySource = "overpass" | "nominatim" | "google" | "none" | "";

/* ------------------------------------------------------------------ *
 * The browser's own attempt, for when the server cannot answer
 * ------------------------------------------------------------------ */

function overpassQuery(group: AmenityGroup, lat: number, lng: number, radiusKm: number): string {
  const around = `(around:${Math.round(radiusKm * 1000)},${lat.toFixed(4)},${lng.toFixed(4)})`;
  const head = "[out:json][timeout:20]";
  if (group === "stays") {
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

const STAY_COPY: Record<string, string> = {
  hotel: "Hotel",
  guest_house: "Guest house",
  hostel: "Hostel",
  motel: "Motel",
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

  if (STAY_COPY[tourism]) {
    kind = "stay";
    budget = tourism === "guest_house" || tourism === "hostel" || tourism === "motel";
    const stars = tags.stars ? ` · ${tags.stars}★` : "";
    detail = `${STAY_COPY[tourism]}${stars}${budget ? " · budget" : ""}`;
  } else if (amenity === "fuel") {
    kind = "fuel";
    const brand = tags.brand ?? tags.operator ?? "";
    detail = brand ? `Fuel · ${brand}` : "Fuel station";
  } else if (amenity === "hospital" || amenity === "clinic") {
    kind = "hospital";
    detail = `${amenity === "hospital" ? "Hospital" : "Clinic"}${
      tags.emergency === "yes" ? " · emergency" : ""
    }`;
  } else if (tags.shop === "motorcycle" || tags["service:vehicle:motorcycle"] === "yes" || royalEnfield) {
    kind = "service";
    detail = royalEnfield ? "Royal Enfield · workshop" : "Motorcycle workshop";
  }

  if (!kind) return null;
  // A bed with no name is a bed nobody can ask for; the others read fine as
  // "Fuel station" on a list, so they keep a plain name.
  if (kind === "stay" && !name) return null;
  const title =
    name ||
    (kind === "fuel" ? "Fuel station" : kind === "hospital" ? "Hospital" : "Workshop");

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
export function rankAmenities(items: readonly Amenity[], group: AmenityGroup): Amenity[] {
  const sorted = [...items].sort((a, b) => {
    if (group === "stays") {
      if (Boolean(a.budget) !== Boolean(b.budget)) return a.budget ? -1 : 1;
    } else if (Boolean(a.royalEnfield) !== Boolean(b.royalEnfield)) {
      return a.royalEnfield ? -1 : 1;
    }
    return a.distanceKm - b.distanceKm;
  });
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
  const radius = group === "stays" ? STAY_RADIUS_KM : ESSENTIALS_RADIUS_KM;
  const response = await fetch(mirror, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: `data=${encodeURIComponent(overpassQuery(group, lat, lng, radius))}`,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Overpass answered ${response.status}`);
  const json = (await response.json()) as { elements?: OverpassElement[] };
  const origin = { lat, lng };
  return (json.elements ?? [])
    .map((element) => amenityFrom(element, origin))
    .filter((item): item is Amenity => item !== null);
}

export interface AmenityQuery {
  lat: number;
  lng: number;
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
  /** Whether the server has a Google Places key to spend. */
  googleKey: boolean;
  /** Which service answered, or "" while nothing has. */
  source: AmenitySource;
  loadingSource: string;
  reload: () => void;
}

export function useNearbyAmenities({
  lat,
  lng,
  group,
  enabled = true,
}: AmenityQuery): AmenityResult {
  const [items, setItems] = useState<Amenity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState<AmenitySource>("");
  const [tried, setTried] = useState<string[]>([]);
  const [googleKey, setGoogleKey] = useState(false);
  const [loadingSource, setLoadingSource] = useState("OpenStreetMap");
  const [attempt, setAttempt] = useState(0);
  const cache = useRef(new Map<string, Amenity[]>());
  const requestId = useRef(0);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const key = `${group}:${lat.toFixed(3)},${lng.toFixed(3)}`;

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
    setLoadingSource("OpenStreetMap");

    const run = async () => {
      try {
        // The server answers across three mirrors and Nominatim; it is the
        // route that works when a browser-to-Overpass request would not.
        const viaServer = await api
          .get<{ items: Amenity[]; source: AmenitySource; tried?: string[]; googleKey?: boolean }>(
            `/api/nearby?kind=${group}&lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`,
          )
          .catch(() => null);
        if (cancelled || mine !== requestId.current) return;

        if (viaServer) {
          setGoogleKey(Boolean(viaServer.googleKey));
          setTried(Array.isArray(viaServer.tried) ? viaServer.tried : []);
          if (viaServer.items.length || viaServer.source !== "none") {
            const ranked = rankAmenities(viaServer.items, group).slice(0, 40);
            cache.current.set(key, ranked);
            setItems(ranked);
            setSource(viaServer.source);
            return;
          }
        }

        // No server, or a server that could not reach anything: ask the
        // mirrors from here, one at a time.
        setLoadingSource("OpenStreetMap (direct)");
        for (const mirror of MIRRORS) {
          try {
            const found = await askMirror(group, lat, lng, mirror);
            if (cancelled || mine !== requestId.current) return;
            const ranked = rankAmenities(found, group).slice(0, 40);
            cache.current.set(key, ranked);
            setItems(ranked);
            setSource("overpass");
            return;
          } catch {
            // next mirror
          }
        }
        if (cancelled || mine !== requestId.current) return;
        setItems([]);
        setSource("none");
        setError(
          group === "stays"
            ? "OpenStreetMap could not be reached for the beds around here — all three mirrors were busy. Try again in a minute, or open the Google Maps search below."
            : "OpenStreetMap could not be reached for fuel and hospitals around here — all three mirrors were busy. Try again in a minute, or open the Google Maps search below.",
        );
      } catch {
        if (cancelled || mine !== requestId.current) return;
        setItems([]);
        setSource("none");
        setError("Could not look this up just now. Try again in a minute.");
      } finally {
        if (!cancelled && mine === requestId.current) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [lat, lng, group, enabled, attempt]);

  return { items, loading, error, source, tried, googleKey, loadingSource, reload };
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}
