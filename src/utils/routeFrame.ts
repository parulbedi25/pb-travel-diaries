import type { LatLng } from "./routing";
import { fitViewExact, makeMercatorProjector, type MapView, type Projector } from "./mercator";

/**
 * What the live map has to keep in view.
 *
 * The map is fitted to its frame, so the frame decides whether the ride can be
 * seen. It used to be the checkpoints alone, plus wherever the GPS says PB is —
 * which is wrong twice over:
 *
 *  - A route drawn along the road bulges away from the stops that bound it
 *    (Srinagar → Leh runs north over Kargil, Leh → Manali loops south), so the
 *    line could leave the panel through an edge even though every checkpoint
 *    was comfortably inside it.
 *  - A GPS fix from somewhere else entirely — a phone still at home, a stale
 *    ping — was fitted with the route and shrank the whole ride into a corner.
 *
 * So the frame is the stops, the road between (sampled, because a fitted box
 * only needs its extremes), and the live point *only when it belongs to this
 * ride*. Everything the map draws is then inside the box it was fitted to, by
 * construction rather than by luck.
 */

export interface FramePoint {
  lat: number;
  lng: number;
}

/** Enough of the road to find its extremes, few enough to be free. */
const MAX_ROAD_SAMPLES = 160;
/** How far outside the route's own bounds a live ping may sit and still count. */
const LIVE_SLACK = 0.25;

function sampleRoad(geometry: readonly LatLng[]): FramePoint[] {
  if (geometry.length <= MAX_ROAD_SAMPLES) return geometry.map(([lat, lng]) => ({ lat, lng }));
  const step = Math.ceil(geometry.length / MAX_ROAD_SAMPLES);
  const out: FramePoint[] = [];
  for (let i = 0; i < geometry.length; i += step) {
    const [lat, lng] = geometry[i];
    out.push({ lat, lng });
  }
  // The last vertex is the destination of the line; a step can skip it.
  const [lat, lng] = geometry[geometry.length - 1];
  out.push({ lat, lng });
  return out;
}

function bounds(points: readonly FramePoint[]): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} | null {
  if (!points.length) return null;
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  }
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * The points the tracker's map fits itself to.
 *
 * `live` is optional and is dropped when it is nowhere near the ride — a fix
 * 300 km away is not part of this map, and including it would push the route
 * into a corner of the panel.
 */
export function routeFramePoints(
  stops: readonly { lat: number; lng: number }[],
  geometry: readonly LatLng[] = [],
  live?: { lat: number; lng: number } | null,
): FramePoint[] {
  const ride: FramePoint[] = [
    ...stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
    ...sampleRoad(geometry),
  ];
  const box = bounds(ride);
  if (!box) return live ? [{ lat: live.lat, lng: live.lng }] : [];

  const latSlack = Math.max((box.maxLat - box.minLat) * LIVE_SLACK, 0.05);
  const lngSlack = Math.max((box.maxLng - box.minLng) * LIVE_SLACK, 0.05);
  const belongs =
    !!live &&
    Number.isFinite(live.lat) &&
    Number.isFinite(live.lng) &&
    live.lat >= box.minLat - latSlack &&
    live.lat <= box.maxLat + latSlack &&
    live.lng >= box.minLng - lngSlack &&
    live.lng <= box.maxLng + lngSlack;

  return belongs && live ? [...ride, { lat: live.lat, lng: live.lng }] : ride;
}

/* ------------------------------------------------------------------ *
 * The band the route is drawn in
 * ------------------------------------------------------------------ */

/** Panel space the plates across the top and the strip along the bottom take. */
export interface BandInsets {
  top: number;
  bottom: number;
}

export interface Band extends BandInsets {
  /** Height left between them for the ride. */
  height: number;
  /** Pixels to slide the drawing down so it sits between them. */
  offsetY: number;
  /** True when the insets had to give way to keep the ride on the panel. */
  squeezed: boolean;
}

/**
 * How much of a panel is left for the route.
 *
 * The two plates are measured in pixels, which means on a short panel they can
 * want more height than the panel has. Holding the band at a minimum anyway —
 * which is what this used to do — drew the ride *underneath* the strip and
 * called it fitted. Here the insets give way together instead, in proportion,
 * so the band always fits inside the panel and the drawing is always visible.
 */
export function bandFor(
  height: number,
  insets: BandInsets,
  minBand = 140,
): Band {
  const h = Math.max(height || 1, 1);
  const available = h - insets.top - insets.bottom;
  if (available >= minBand) {
    return {
      top: insets.top,
      bottom: insets.bottom,
      height: Math.min(available, h),
      offsetY: (insets.top - insets.bottom) / 2,
      squeezed: false,
    };
  }
  const scale = Math.max(0, Math.min(1, (h - minBand) / Math.max(insets.top + insets.bottom, 1)));
  const top = insets.top * scale;
  const bottom = insets.bottom * scale;
  return {
    top,
    bottom,
    height: Math.max(h - top - bottom, Math.min(minBand, h)),
    offsetY: (top - bottom) / 2,
    squeezed: true,
  };
}

/**
 * The view and the projector that put the whole ride inside the band.
 *
 * Returned together because they are only correct together: the zoom fits the
 * band, and the projector slides that fitted drawing into place inside the
 * panel. Callers that draw with one and fit with the other get a route that
 * leaves the panel at the edges, which is exactly the fault this replaces.
 */
export function fitRouteToBand(
  frame: readonly FramePoint[],
  width: number,
  height: number,
  insets: BandInsets,
  { padX = 34, padY = 34, minBand = 140 }: { padX?: number; padY?: number; minBand?: number } = {},
): { view: MapView; band: Band; projector: Projector } {
  const band = bandFor(height, insets, minBand);
  const view = fitViewExact(frame, width, band.height, { padX, padY });
  const projector = makeMercatorProjector(view, width, height, band.offsetY);
  return { view, band, projector };
}
