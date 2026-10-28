import { geometryKm, pointAtKm } from "./routeProgress";
import type { LatLng } from "./routing";

/**
 * Weather bubbles along a ride, one every hundred kilometres.
 *
 * A single forecast at the start says nothing about the pass four hundred
 * kilometres ahead, where it can be snowing while Nangal is warm. Rather than
 * sprinkle bubbles evenly across the *picture* — which would put them where
 * the road doubles back on itself — each one sits at a true distance along the
 * road, found by walking the vertices and interpolating.
 *
 * The distances are the route's own (the routing service's figure when it is
 * known), so "400 km" means four hundred kilometres ridden, not four hundred
 * kilometres of latitude.
 */

export interface KmMark {
  /** Kilometres from the start, as marked. */
  km: number;
  lat: number;
  lng: number;
}

export function kmMarksAlong(
  geometry: readonly LatLng[],
  totalKm: number,
  everyKm = 100,
): KmMark[] {
  if (geometry.length < 2 || everyKm <= 0) return [];
  const drawnKm = geometryKm(geometry);
  if (drawnKm <= 0) return [];
  const total = totalKm > 0 ? totalKm : drawnKm;

  const marks: KmMark[] = [];
  // Stop short of the destination: the last checkpoint already has its own
  // weather, and a bubble on top of it would just cover the pin.
  for (let km = everyKm; km <= total - everyKm / 2; km += everyKm) {
    const point = pointAtKm(geometry, (km / total) * drawnKm);
    if (point) marks.push({ km, ...point });
  }
  return marks;
}
