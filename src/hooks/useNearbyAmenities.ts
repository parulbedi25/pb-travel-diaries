import { useCallback, useEffect, useRef, useState } from "react";
import { distanceKm, type MapPoint } from "../utils/liveRoute";

/**
 * What a rider needs around a stop, straight from OpenStreetMap.
 *
 * Wikipedia answers "what is worth seeing here" — its editors decide what is
 * notable, which is exactly right for places to visit and useless for a
 * petrol pump. OpenStreetMap is the other way round: it has every fuel
 * station, every clinic and every motorcycle workshop, tagged, and Overpass
 * serves them without a key or an account.
 *
 * Two questions, one query each:
 *
 *  - **stays** — hotels, guest houses, hostels: a bed, cheap ones named as
 *    such rather than pretending to know tonight's price.
 *  - **essentials** — fuel, hospitals and clinics, motorcycle workshops, and
 *    anything with Royal Enfield in its name, because that is the one thing a
 *    rider on this route asks for by name.
 *
 * Everything is optional decoration over the map, so a failure is a sentence
 * in the list, never a broken page.
 */

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const REQUEST_TIMEOUT_MS = 20_000;

/** How far out each question is asked. A bed is worth a detour; petrol is not. */
export const STAY_RADIUS_KM = 15;
export const ESSENTIALS_RADIUS_KM = 25;

export type AmenityGroup = "stays" | "essentials";
export type AmenityKind = "stay" | "fuel" | "hospital" | "service";

export interface Amenity {
  /** `node/123` — stable across reloads, so React keys and pins do not shuffle. */
  id: string;
  kind: AmenityKind;
  title: string;
  lat: number;
  lng: number;
  /** Straight-line kilometres from the place being searched around. */
  distanceKm: number;
  /** One line of what it is: "Guest house", "Fuel · Indian Oil", "Workshop · Royal Enfield". */
  detail: string;
  /** Royal Enfield's own name on the sign, or a workshop that services them. */
  royalEnfield?: boolean;
  /** Cheapest kinds first among beds: guest houses and hostels before hotels. */
  budget?: boolean;
  opening?: string;
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

/** The Overpass query for one question, as a radius around a point. */
export function overpassQuery(group: AmenityGroup, lat: number, lng: number, radiusKm: number): string {
  const around = `(around:${Math.round(radiusKm * 1000)},${lat.toFixed(4)},${lng.toFixed(4)})`;
  const head = `[out:json][timeout:${Math.round(REQUEST_TIMEOUT_MS / 1000) - 5}]`;
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
export function amenityFrom(
  element: OverpassElement,
  origin: MapPoint,
): Amenity | null {
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
    const emergency = tags.emergency === "yes" ? " · emergency" : "";
    detail = `${amenity === "hospital" ? "Hospital" : "Clinic"}${emergency}`;
  } else if (tags.shop === "motorcycle" || tags["service:vehicle:motorcycle"] === "yes" || royalEnfield) {
    kind = "service";
    detail = royalEnfield ? "Royal Enfield · workshop" : "Motorcycle workshop";
  }

  if (!kind) return null;
  // A bed with no name is a bed nobody can ask for; the others read fine as
  // "Fuel station" on a list, so they keep a plain name.
  const title =
    name || (kind === "stay" ? "Unnamed stay" : kind === "fuel" ? "Fuel station" : kind === "hospital" ? "Hospital" : "Workshop");
  if (kind === "stay" && !name) return null;

  return {
    id: `${element.type ?? "nwr"}/${element.id ?? `${lat},${lng}`}`,
    kind,
    title,
    lat,
    lng,
    distanceKm: distanceKm(origin, { lat, lng }),
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

export interface AmenityQuery {
  lat: number;
  lng: number;
  group: AmenityGroup;
  /** False until the tab that needs it is opened, so nothing is asked for twice over. */
  enabled?: boolean;
}

export function useNearbyAmenities({ lat, lng, group, enabled = true }: AmenityQuery) {
  const [items, setItems] = useState<Amenity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const cache = useRef(new Map<string, Amenity[]>());
  const requestId = useRef(0);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const radius = group === "stays" ? STAY_RADIUS_KM : ESSENTIALS_RADIUS_KM;
    const key = `${group}:${lat.toFixed(3)},${lng.toFixed(3)},${radius}`;

    const cached = attempt === 0 ? cache.current.get(key) : undefined;
    if (cached) {
      setItems(cached);
      setLoading(false);
      setError("");
      return;
    }

    const mine = ++requestId.current;
    let cancelled = false;
    setLoading(true);
    setError("");

    const run = async () => {
      try {
        const response = await fetch(OVERPASS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: `data=${encodeURIComponent(overpassQuery(group, lat, lng, radius))}`,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`Overpass answered ${response.status}`);
        const json = (await response.json()) as { elements?: OverpassElement[] };
        if (cancelled || mine !== requestId.current) return;
        const origin = { lat, lng };
        const found = (json.elements ?? [])
          .map((element) => amenityFrom(element, origin))
          .filter((item): item is Amenity => item !== null);
        const ranked = rankAmenities(found, group).slice(0, 40);
        cache.current.set(key, ranked);
        setItems(ranked);
      } catch {
        if (cancelled || mine !== requestId.current) return;
        setItems([]);
        setError(
          group === "stays"
            ? "Could not reach OpenStreetMap for the beds around here."
            : "Could not reach OpenStreetMap for fuel and hospitals around here.",
        );
      } finally {
        if (!cancelled && mine === requestId.current) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [lat, lng, group, enabled, attempt]);

  return { items, loading, error, reload };
}
