import type { LiveStop } from "../store/siteContent";
import { nearestVertexIndexFrom, type LatLng } from "./routing";

/**
 * How far along the ride each stop sits.
 *
 * Distances are straight-line until real road geometry has been fetched in the
 * dashboard; once it has, each leg is measured along the stored road instead,
 * which is the number a rider actually cares about.
 *
 * Two details decide whether the total matches what Google or a route planner
 * says, and both are easy to get wrong:
 *
 *  - **The stops are walked in order.** Every stop is matched to a vertex of
 *    the road starting from the previous stop's vertex, never from the top of
 *    the list. On a round trip the start and the finish are the same place, so
 *    a plain "nearest vertex" match sends the last leg back to kilometres
 *    zero — and the ride comes out a hundred kilometres short.
 *  - **The routing service's own total wins.** A returned line is simplified
 *    to save bandwidth, which shortens it by a fraction of a percent; when the
 *    service also says how long the road it found is, the legs are scaled so
 *    they add up to that number. The shape stays the same; only the ruler
 *    changes.
 */

const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Length of each leg between consecutive stops, in kilometres. */
export function legKm(
  stops: readonly LiveStop[],
  geometry: readonly LatLng[],
  options: { totalKm?: number } = {},
): number[] {
  const legs: number[] = [];
  if (stops.length < 2) return legs;

  const usable = geometry.length >= 2;

  // Match each stop to a vertex, searching only forwards from the one before,
  // and never so far ahead that the stops still to come have nothing left to
  // match — that is what keeps a round trip measuring forwards.
  const vertices: number[] = [];
  if (usable) {
    let cursor = 0;
    for (let i = 0; i < stops.length; i += 1) {
      const remaining = stops.length - 1 - i;
      const until = Math.max(cursor + 1, geometry.length - remaining);
      const index = nearestVertexIndexFrom(geometry, stops[i], cursor, until);
      vertices.push(index);
      if (index >= 0) cursor = index;
    }
  }

  for (let i = 0; i < stops.length - 1; i += 1) {
    const straight = haversineKm([stops[i].lat, stops[i].lng], [stops[i + 1].lat, stops[i + 1].lng]);
    let leg = straight;
    if (usable) {
      const from = vertices[i];
      const to = vertices[i + 1];
      // Only trust the road when the stops resolve to points that run
      // forwards along it; otherwise the straight line is the honest answer.
      if (from >= 0 && to > from) {
        let along = 0;
        for (let v = from; v < to; v += 1) along += haversineKm(geometry[v], geometry[v + 1]);
        if (along > 0) leg = along;
      }
    }
    legs.push(leg);
  }

  // Scale to the number the routing service measured on the full road, when it
  // gave us one: the drawn line is simplified, the distance reported is not.
  const measured = legs.reduce((sum, leg) => sum + leg, 0);
  const official = options.totalKm ?? 0;
  if (official > 0 && measured > 0) {
    const scale = official / measured;
    return legs.map((leg) => leg * scale);
  }
  return legs;
}

/** Kilometres from the first stop to each stop. The first is always 0. */
export function cumulativeKm(
  stops: readonly LiveStop[],
  geometry: readonly LatLng[],
  options: { totalKm?: number } = {},
): number[] {
  const totals = stops.map(() => 0);
  let running = 0;
  legKm(stops, geometry, options).forEach((leg, i) => {
    running += leg;
    totals[i + 1] = running;
  });
  return totals;
}

/** Round for display: 12.4 km under 100, whole kilometres above it. */
export function formatKm(km: number): string {
  if (km <= 0) return "0 km";
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/**
 * Where a ride is after `km` kilometres, as a point on the road.
 *
 * Used for the weather bubbles every hundred kilometres: they have to sit on
 * the drawn route, not on the straight line between its ends, so the position
 * is interpolated along the vertices.
 */
export function pointAtKm(
  geometry: readonly LatLng[],
  km: number,
): { lat: number; lng: number } | null {
  if (geometry.length < 2) return null;
  if (km <= 0) return { lat: geometry[0][0], lng: geometry[0][1] };
  let travelled = 0;
  for (let i = 1; i < geometry.length; i += 1) {
    const segment = haversineKm(geometry[i - 1], geometry[i]);
    if (travelled + segment >= km) {
      const ratio = segment === 0 ? 0 : (km - travelled) / segment;
      return {
        lat: geometry[i - 1][0] + (geometry[i][0] - geometry[i - 1][0]) * ratio,
        lng: geometry[i - 1][1] + (geometry[i][1] - geometry[i - 1][1]) * ratio,
      };
    }
    travelled += segment;
  }
  const last = geometry[geometry.length - 1];
  return { lat: last[0], lng: last[1] };
}

/** The full length of a road, vertex to vertex. */
export function geometryKm(geometry: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < geometry.length; i += 1) total += haversineKm(geometry[i - 1], geometry[i]);
  return total;
}
