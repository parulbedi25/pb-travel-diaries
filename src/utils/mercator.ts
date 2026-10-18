/**
 * Web Mercator, the projection every slippy map uses.
 *
 * Google's keyless embed can be asked for a plain centred view
 * (`?ll=lat,lng&z=zoom&output=embed`) — a map with no markers, no directions
 * and no white panel. Because we choose the centre and the zoom ourselves, we
 * know exactly how that map is projected, which means our own pins can be laid
 * over it and line up with the streets underneath.
 *
 * No such luck with a *directions* embed: Google picks the view to fit the
 * route and never tells us what it chose, so nothing can be aligned to it.
 */

const TILE = 256;
/** Mercator runs away to infinity at the poles; this is where maps stop. */
const MAX_LAT = 85.05112878;
/** Degrees. Gives a single stop something to sit inside. */
const MIN_SPAN = 0.05;

export interface MapView {
  lat: number;
  lng: number;
  zoom: number;
}

const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value));

function project(lat: number, lng: number, world: number): { x: number; y: number } {
  const clamped = clamp(lat, -MAX_LAT, MAX_LAT);
  const sin = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * world,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world,
  };
}

function unproject(x: number, y: number, world: number): { lat: number; lng: number } {
  const n = Math.PI * (1 - (2 * y) / world);
  return {
    lat: (Math.atan(Math.sinh(n)) * 180) / Math.PI,
    lng: (x / world) * 360 - 180,
  };
}

/**
 * The centre and zoom that fit `stops` into a width × height box.
 *
 * `padX` and `padY` reserve that many pixels on each side for the markers
 * themselves — a pin is ~24px across and its name hangs below it, so fitting
 * the raw points to the edge would clip them. `fit` is the fraction of what
 * remains that the stops may fill.
 *
 * Zoom has to be a whole number (that is all Google's `z` accepts), which
 * means the fitted stops land somewhere between half and all of the available
 * box. Keeping `fit` at 1 and reserving the margin in pixels instead is what
 * stops it settling at the bottom of that range and leaving the box half
 * empty.
 */
export function fitView(
  stops: readonly { lat: number; lng: number }[],
  width: number,
  height: number,
  { fit = 1, padX = 26, padY = 26 }: { fit?: number; padX?: number; padY?: number } = {},
): MapView {
  const w = Math.max(width || 600, 1);
  const h = Math.max(height || 400, 1);

  const lats = stops.length ? stops.map((s) => s.lat) : [31];
  const lngs = stops.length ? stops.map((s) => s.lng) : [76.5];
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);
  if (maxLat - minLat < MIN_SPAN) {
    const mid = (minLat + maxLat) / 2;
    minLat = mid - MIN_SPAN / 2;
    maxLat = mid + MIN_SPAN / 2;
  }
  if (maxLng - minLng < MIN_SPAN) {
    const mid = (minLng + maxLng) / 2;
    minLng = mid - MIN_SPAN / 2;
    maxLng = mid + MIN_SPAN / 2;
  }

  // Measure the bounding box once, at zoom 0, then scale it up: the span in
  // pixels doubles with every zoom level.
  const topLeft = project(maxLat, minLng, TILE);
  const bottomRight = project(minLat, maxLng, TILE);
  const spanX = Math.max(Math.abs(bottomRight.x - topLeft.x), 1e-6);
  const spanY = Math.max(Math.abs(bottomRight.y - topLeft.y), 1e-6);
  const innerW = Math.max((w - padX * 2) * fit, 1);
  const innerH = Math.max((h - padY * 2) * fit, 1);
  const zoom = clamp(Math.floor(Math.log2(Math.min(innerW / spanX, innerH / spanY))), 3, 17);
  const centre = unproject((topLeft.x + bottomRight.x) / 2, (topLeft.y + bottomRight.y) / 2, TILE);
  return { lat: centre.lat, lng: centre.lng, zoom };
}

export interface Projector {
  /** Percentage across / down the box, for `left` and `top`. */
  toXY: (point: { lat: number; lng: number }) => { x: number; y: number };
  toLatLng: (x: number, y: number) => { lat: number; lng: number };
}

/**
 * Turn a known view into the same mapping the iframe is showing, so a pin
 * dropped under the cursor lands on the spot it was dropped on.
 *
 * `offsetY` slides the whole projected picture down by that many pixels
 * without moving the map, which is how the tracker keeps its route inside the
 * band between the badge across the top and the strip along the bottom. The
 * map itself still fills the panel; only the drawing on top of it moves.
 */
export function makeMercatorProjector(
  view: MapView,
  width: number,
  height: number,
  offsetY = 0,
): Projector {
  const world = TILE * 2 ** view.zoom;
  const w = Math.max(width || 600, 1);
  const h = Math.max(height || 400, 1);
  const centre = project(view.lat, view.lng, world);

  return {
    toXY: ({ lat, lng }) => {
      const p = project(lat, lng, world);
      return {
        x: ((w / 2 + (p.x - centre.x)) / w) * 100,
        y: ((h / 2 + offsetY + (p.y - centre.y)) / h) * 100,
      };
    },
    toLatLng: (x, y) =>
      unproject(
        centre.x + (x / 100) * w - w / 2,
        centre.y + (y / 100) * h - h / 2 - offsetY,
        world,
      ),
  };
}
