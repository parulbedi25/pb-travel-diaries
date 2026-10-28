import { useEffect, useRef, useState } from "react";
import type { LiveStop } from "../store/siteContent";
import { fetchRoadGeometry, type LatLng } from "../utils/routing";

const ROAD_CACHE_PREFIX = "pb_road_v1:";
const ROAD_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Coordinates are the identity of a route: same stops, same road. */
const stopsKey = (stops: readonly LiveStop[]): string =>
  stops.map((s) => `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`).join(";");

const cacheKey = (stops: readonly LiveStop[]): string => ROAD_CACHE_PREFIX + stopsKey(stops);

/**
 * Road geometry already resolved this visit, and requests already in flight.
 *
 * Two panels ask for the same road — the map draws it, the distance figures
 * measure it — and they mount together. Without these a page load would send
 * the routing service two identical requests, and a visitor would see the
 * straight-line numbers for as long as the slower one takes.
 */
const memory = new Map<string, LatLng[]>();
const inFlight = new Map<string, Promise<LatLng[] | null>>();

function readCache(key: string): LatLng[] | null {
  const visited = memory.get(key);
  if (visited) return visited;
  // This is the one thing still kept in the browser, deliberately: a
  // disposable cache of a third-party road route, worth a network request but
  // not worth a database round-trip. It never holds site content, accounts or
  // history — those live in the database.
  try {
    const cached = window.localStorage.getItem(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as { t?: number; geometry?: LatLng[] };
    const fresh = parsed?.t && Date.now() - parsed.t < ROAD_CACHE_MAX_AGE_MS;
    if (fresh && Array.isArray(parsed.geometry) && parsed.geometry.length >= 2) {
      memory.set(key, parsed.geometry);
      return parsed.geometry;
    }
  } catch {
    // A missing or unreadable cache just means we ask again.
  }
  return null;
}

function writeCache(key: string, geometry: LatLng[]): void {
  memory.set(key, geometry);
  try {
    window.localStorage.setItem(key, JSON.stringify({ t: Date.now(), geometry }));
  } catch {
    // Storage may be full or blocked; the road still draws this visit.
  }
}

async function askForRoad(stops: readonly LiveStop[]): Promise<LatLng[] | null> {
  const key = cacheKey(stops);
  const cached = readCache(key);
  if (cached) return cached;
  const already = inFlight.get(key);
  if (already) return already;

  const request = (async () => {
    try {
      const result = await fetchRoadGeometry(stops);
      if (!result.ok || result.geometry.length < 2) return null;
      writeCache(key, result.geometry);
      return result.geometry;
    } catch {
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, request);
  return request;
}

/**
 * The road the ride follows, if we can get hold of it.
 *
 * Geometry stored from the dashboard wins — that is the one with no third
 * party in the loop when a visitor loads the page. Failing that, ask the
 * routing service here so the line still hugs the road, and remember the
 * answer for a week so it is one request, not one per visit. When the service
 * cannot be reached the caller gets null and falls back to straight segments.
 *
 * This is shared rather than living inside the map, which is where it started.
 * The map drew the real road while the distance figures beside it were still
 * measured point-to-point, so a 778 km ride could be labelled 396 km — the
 * straight line through the Himalaya. Both must measure the same road.
 */
export function useRoadGeometry(stops: LiveStop[], stored: LatLng[]): LatLng[] | null {
  const [road, setRoad] = useState<LatLng[] | null>(() =>
    stored.length >= 2 || stops.length < 2 ? null : readCache(cacheKey(stops)),
  );

  // Depend on what actually matters, not on array identity: the tracker
  // re-renders on every live ping, and a fresh `stops` array each time used to
  // re-run this effect — re-reading the cache and re-requesting the road every
  // second. The key changes only when a stop really moves.
  const key = stopsKey(stops);
  const storedCount = stored.length;
  const stopsRef = useRef(stops);
  stopsRef.current = stops;

  useEffect(() => {
    if (storedCount >= 2 || stopsRef.current.length < 2) {
      setRoad(null);
      return;
    }

    const cached = readCache(ROAD_CACHE_PREFIX + key);
    if (cached) {
      setRoad(cached);
      return;
    }

    let cancelled = false;
    void askForRoad(stopsRef.current).then((geometry) => {
      if (!cancelled && geometry) setRoad(geometry);
    });
    return () => {
      cancelled = true;
    };
  }, [key, storedCount]);

  return road;
}

/**
 * The geometry to measure and draw with: what the dashboard stored, else the
 * road fetched just now, else the stops joined up — and whether that geometry
 * really follows the road, so the tracker can label the distance honestly.
 */
export function useRouteGeometry(
  stops: LiveStop[],
  stored: LatLng[],
): { geometry: LatLng[]; byRoad: boolean } {
  const road = useRoadGeometry(stops, stored);
  if (stored.length >= 2) return { geometry: stored, byRoad: true };
  if (road && road.length >= 2) return { geometry: road, byRoad: true };
  return { geometry: stops.map((s) => [s.lat, s.lng] as LatLng), byRoad: false };
}
