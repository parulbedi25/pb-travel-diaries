import type { LiveStop } from "../store/siteContent";

/**
 * Where the ride is, according to the dashboard.
 *
 * A stop marked "Here now" is the answer. If nobody has marked one — an older
 * route saved before the status field existed, say — the last stop already
 * ridden is where he must be, and failing that the start.
 */
export function currentStopIndex(stops: readonly LiveStop[]): number {
  const here = stops.findIndex((stop) => stop.status === "live");
  if (here >= 0) return here;
  const ridden = stops.reduce((acc, stop, i) => (stop.status === "done" ? i : acc), -1);
  return ridden >= 0 ? ridden : 0;
}

/** The stop the ride has reached, or undefined for an empty route. */
export function currentStop(stops: readonly LiveStop[]): LiveStop | undefined {
  if (!stops.length) return undefined;
  return stops[currentStopIndex(stops)];
}

/**
 * Marking a stop "Here now" rewrites the whole route around it: everything
 * before it has been ridden, everything after it is still to come. Exactly one
 * stop ends up live, so the tracker can never show two current positions.
 *
 * Every other status is left alone — marking a stop "Ridden" by hand is an
 * edit, not an instruction about where the bike is.
 */
export function cascadeHereNow(stops: readonly LiveStop[], index: number): LiveStop[] {
  return stops.map((stop, i) => {
    if (i === index) return { ...stop, status: "live" as const };
    return { ...stop, status: i < index ? ("done" as const) : ("next" as const) };
  });
}

/** Ask the places page for a point a place can be measured from. */
export interface MapPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres — used for "x km from here". */
export function distanceKm(a: MapPoint, b: MapPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A keyless Google Maps link that opens the place itself.
 *
 * Coordinates, not a name: the query parameter is a plain search, so passing
 * the name would let Google pick a different place with that name. The point
 * we already know is the one that must open.
 */
export function googleMapsPlaceUrl(point: MapPoint): string {
  return `https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`;
}
