/**
 * Road geometry for the live tracker.
 *
 * The tracker used to draw a hand-drawn bezier that only vaguely resembled the
 * journey. To follow the actual road we ask a routing service — but we do that
 * **in the dashboard, when the route is saved**, and store the result in the
 * site content. Visitors then render stored coordinates and never depend on a
 * third party being up, rate-limited or reachable.
 *
 * The service is OSRM's public demo server, which needs no key. It is a demo
 * endpoint, so the fetch is expected to fail sometimes; the caller keeps the
 * previous geometry when it does, and the tracker falls back to straight
 * segments between the stops if there is none.
 */

export type LatLng = [number, number];

export interface RouteFetchResult {
  ok: boolean;
  /** [lat, lng] pairs following the road. Empty when the fetch failed. */
  geometry: LatLng[];
  /**
   * The length of that road in kilometres, as the routing service measured it.
   * Our own sum along the returned vertices is close but a little short — the
   * service simplifies the line it hands back — so the official number is kept
   * here for anything that has to be exact.
   */
  distanceKm: number;
  message: string;
}

/**
 * Where a road is asked for, in order.
 *
 * Both speak the same OSRM API, so the answering server does not matter — only
 * that one of them answers. The first is OSRM's demo server, which is the more
 * generous of the two but has busy days; the second is the FOSSGIS instance
 * that runs on the same data. Trying a second host is the difference between a
 * measured road and a set of straight lines through the Himalaya, which is a
 * distance nobody would call right.
 */
const ROUTING_HOSTS = [
  "https://router.project-osrm.org/route/v1/driving",
  "https://routing.openstreetmap.de/routed-car/route/v1/driving",
];

interface RoutePoint {
  lat: number;
  lng: number;
}

const usable = (points: readonly RoutePoint[]): RoutePoint[] =>
  points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

/**
 * Ask the routing service for the road path through `points`.
 *
 * Coordinates arrive as [lat, lng] and OSRM wants lon,lat — the conversion
 * happens here and again on the way back out, so callers only ever see
 * [lat, lng].
 */
export async function fetchRoadGeometry(
  points: readonly RoutePoint[],
  { timeoutMs = 15_000 }: { timeoutMs?: number } = {},
): Promise<RouteFetchResult> {
  const stops = usable(points);
  if (stops.length < 2) {
    return { ok: false, geometry: [], distanceKm: 0, message: "Add at least two stops with coordinates." };
  }

  const path = stops.map((s) => `${s.lng.toFixed(6)},${s.lat.toFixed(6)}`).join(";");
  let lastMessage = "Could not reach the routing service.";

  for (const host of ROUTING_HOSTS) {
    const attempt = await askHost(host, path, timeoutMs);
    if (attempt.ok) return attempt;
    lastMessage = attempt.message;
  }
  return { ok: false, geometry: [], distanceKm: 0, message: lastMessage };
}

/** One routing host, one try. */
async function askHost(
  base: string,
  path: string,
  timeoutMs: number,
): Promise<RouteFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/${path}?overview=full&geometries=geojson`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        geometry: [],
        distanceKm: 0,
        message: `Routing service returned ${response.status}.`,
      };
    }
    const data = (await response.json()) as {
      code?: string;
      routes?: { distance?: number; geometry?: { coordinates?: [number, number][] } }[];
    };
    if (data.code !== "Ok" || !data.routes?.length) {
      return { ok: false, geometry: [], distanceKm: 0, message: "No road route between these stops." };
    }
    const metres = data.routes[0].distance ?? 0;
    const geometry = (data.routes[0].geometry?.coordinates ?? []).map(
      ([lon, lat]) => [lat, lon] as LatLng,
    );
    if (geometry.length < 2) {
      return {
        ok: false,
        geometry: [],
        distanceKm: 0,
        message: "The routing service returned an empty path.",
      };
    }
    return {
      ok: true,
      geometry,
      distanceKm: metres > 0 ? metres / 1000 : 0,
      message: `Road route loaded — ${geometry.length} points.`,
    };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      geometry: [],
      distanceKm: 0,
      message: aborted ? "The routing service did not respond in time." : "Could not reach the routing service.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Squared distance in degrees — plenty for picking the nearest route vertex. */
function distanceSquared(a: LatLng, b: LatLng): number {
  const dLat = a[0] - b[0];
  const dLng = a[1] - b[1];
  return dLat * dLat + dLng * dLng;
}

/**
 * Index of the vertex in `geometry` closest to `point`, or -1 when empty.
 *
 * `from` and `until` bound the search, and that is what makes a loop read
 * correctly. A round trip — Nangal → Srinagar → Leh → Manali → Nangal — passes
 * the start twice, so the *nearest* vertex to the first stop is often the last
 * vertex, and the nearest vertex to the last stop is often the first: matched
 * that way every stop lands on the same point, every leg falls back to a
 * straight line, and the ride comes out a hundred kilometres short. Searching
 * only forwards from the previous stop's vertex — and leaving enough of the
 * road for the stops still to come — keeps every leg going the way the rider
 * went.
 */
export function nearestVertexIndexFrom(
  geometry: readonly LatLng[],
  point: RoutePoint,
  from = 0,
  /** One past the last vertex worth looking at. */
  until = geometry.length,
): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  const start = Math.max(0, Math.min(from, Math.max(geometry.length - 1, 0)));
  const end = Math.max(start, Math.min(until, geometry.length));
  for (let i = start; i < end; i += 1) {
    const distance = distanceSquared(geometry[i], [point.lat, point.lng]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** The nearest vertex from the beginning of the route. */
export function nearestVertexIndex(geometry: readonly LatLng[], point: RoutePoint): number {
  return nearestVertexIndexFrom(geometry, point, 0);
}

export interface SplitRoute {
  covered: LatLng[];
  remaining: LatLng[];
}

/**
 * Split the road into the part already ridden and the part still to come.
 *
 * The dividing point is PB's current stop — the one marked `live`, or the last
 * one marked `done` when nothing is live. We find the nearest vertex on the
 * stored road rather than assuming the stops are spread evenly along it.
 */
export function splitRouteAtProgress(
  geometry: readonly LatLng[],
  stops: readonly { lat: number; lng: number; status?: string }[],
): SplitRoute {
  if (geometry.length < 2) return { covered: [], remaining: [] };

  const liveIndex = stops.findIndex((s) => s.status === "live");
  const doneIndices = stops.reduce<number[]>(
    (acc, s, i) => (s.status === "done" ? [...acc, i] : acc),
    [],
  );
  const markerIndex =
    liveIndex >= 0 ? liveIndex : doneIndices.length ? doneIndices[doneIndices.length - 1] : -1;
  if (markerIndex < 0) return { covered: [], remaining: [...geometry] };

  const splitAt = nearestVertexIndex(geometry, stops[markerIndex]);
  if (splitAt <= 0) return { covered: [], remaining: [...geometry] };
  if (splitAt >= geometry.length - 1) return { covered: [...geometry], remaining: [] };

  return {
    covered: geometry.slice(0, splitAt + 1),
    remaining: geometry.slice(splitAt),
  };
}
