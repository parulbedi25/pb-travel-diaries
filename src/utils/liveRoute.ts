import type { LiveStop } from "../store/siteContent";
import { haversineKm } from "./routeProgress";
import type { LatLng } from "./routing";

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

/**
 * The identity of a route: the stops it was measured between.
 *
 * Stored beside the road and the distance, it answers the one question the
 * tracker cannot answer by looking at the line alone — is this road still the
 * road for the stops on screen? Deleting a stop, reordering them or dragging a
 * pin all change it.
 */
export function routeSignature(stops: readonly { lat: number; lng: number }[]): string {
  return stops.map((stop) => `${stop.lat.toFixed(4)},${stop.lng.toFixed(4)}`).join(";");
}

/**
 * Does the stored road still belong to the stops on screen?
 *
 * A road saved for a longer list of stops keeps its old shape and its old
 * distance. Left to the tracker it would draw a line through places the rider
 * has deleted and keep quoting a number measured for a ride that no longer
 * exists — which is exactly what a route shortened from seven stops to two
 * showed. When the signature matches, the stored road is this route's road.
 *
 * Saves made before the signature existed fall back to the two ends: a road
 * that starts and ends on the first and last stop is the best that older data
 * can offer.
 */
export function storedRoadFits(
  stops: readonly LiveStop[],
  stored: readonly LatLng[],
  signature?: string,
  toleranceKm = 15,
): boolean {
  if (stops.length < 2 || stored.length < 2) return false;
  if (signature) return signature === routeSignature(stops);
  const start = stops[0];
  const end = stops[stops.length - 1];
  return (
    haversineKm([start.lat, start.lng], stored[0]) <= toleranceKm &&
    haversineKm([end.lat, end.lng], stored[stored.length - 1]) <= toleranceKm
  );
}
