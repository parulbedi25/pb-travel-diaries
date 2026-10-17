import type { LiveStop } from "../store/siteContent";
import { nearestVertexIndex, type LatLng } from "./routing";

/**
 * How far along the ride each stop sits.
 *
 * Distances are straight-line until real road geometry has been fetched in the
 * dashboard; once it has, each leg is measured along the stored road instead,
 * which is the number a rider actually cares about.
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
export function legKm(stops: readonly LiveStop[], geometry: readonly LatLng[]): number[] {
  const legs: number[] = [];
  if (stops.length < 2) return legs;

  const usable = geometry.length >= 2;
  const vertices = usable ? stops.map((stop) => nearestVertexIndex(geometry, stop)) : [];

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
  return legs;
}

/** Kilometres from the first stop to each stop. The first is always 0. */
export function cumulativeKm(stops: readonly LiveStop[], geometry: readonly LatLng[]): number[] {
  const totals = stops.map(() => 0);
  let running = 0;
  legKm(stops, geometry).forEach((leg, i) => {
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
