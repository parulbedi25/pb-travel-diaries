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
 * Two versions of this exist because of where the zoom can come from.
 * fitViewExact returns the honest fractional answer. fitView rounds it down to
 * a whole level, which is what anything driven by Google's embed needs: its
 * `z` parameter only accepts integers, so a fitted route lands somewhere
 * between half and all of the box it was given. The tracker draws its own
 * tiles now, so it asks for the exact one and fills the box properly.
 */
function fitBox(
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
  const zoom = Math.log2(Math.min(innerW / spanX, innerH / spanY));
  const centre = unproject((topLeft.x + bottomRight.x) / 2, (topLeft.y + bottomRight.y) / 2, TILE);
  return { lat: centre.lat, lng: centre.lng, zoom };
}

/** The exact zoom that fits — fractional, so the box is filled edge to edge. */
export function fitViewExact(
  stops: readonly { lat: number; lng: number }[],
  width: number,
  height: number,
  options: { fit?: number; padX?: number; padY?: number } = {},
): MapView {
  const box = fitBox(stops, width, height, options);
  return { ...box, zoom: clamp(box.zoom, 3, 17) };
}

/** The same, rounded down to a whole zoom level. */
export function fitView(
  stops: readonly { lat: number; lng: number }[],
  width: number,
  height: number,
  options: { fit?: number; padX?: number; padY?: number } = {},
): MapView {
  const box = fitBox(stops, width, height, options);
  return { ...box, zoom: clamp(Math.floor(box.zoom), 3, 17) };
}

/** Pixels reserved along each edge of a panel. */
export interface MapInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/**
 * The exact view that fits `points` into what is left of a panel once some of
 * it is covered — a list drawn over the map, a badge strip, anything.
 *
 * `fitViewExact` fits into the whole panel and cannot help here: with a list
 * covering the right third, a route fitted to the panel puts half its pins
 * under the list. This fits into the uncovered box and then slides the map's
 * centre so that same box sits exactly where it belongs, which is a shift in
 * geography, not a shift of the drawing — so the tiles underneath and the pins
 * on top stay in step, and the next pan or zoom starts from a true view.
 */
export function fitViewInset(
  points: readonly { lat: number; lng: number }[],
  width: number,
  height: number,
  insets: MapInsets = {},
  options: { fit?: number; padX?: number; padY?: number } = {},
): MapView {
  const w = Math.max(width || 600, 1);
  const h = Math.max(height || 400, 1);
  const left = Math.max(insets.left ?? 0, 0);
  const right = Math.max(insets.right ?? 0, 0);
  const top = Math.max(insets.top ?? 0, 0);
  const bottom = Math.max(insets.bottom ?? 0, 0);
  const innerW = Math.max(w - left - right, 40);
  const innerH = Math.max(h - top - bottom, 40);

  const inner = fitBox(points, innerW, innerH, {
    fit: options.fit ?? 1,
    padX: options.padX ?? 12,
    padY: options.padY ?? 12,
  });
  const zoom = clamp(inner.zoom, 3, 17);
  const world = TILE * 2 ** zoom;

  // Where the fitted centre must land, and where the panel's own centre is.
  const targetX = left + innerW / 2;
  const targetY = top + innerH / 2;
  const shiftX = targetX - w / 2;
  const shiftY = targetY - h / 2;

  const centre = project(inner.lat, inner.lng, world);
  const centreOfPanel = unproject(centre.x - shiftX, centre.y - shiftY, world);
  return { lat: centreOfPanel.lat, lng: centreOfPanel.lng, zoom };
}

/* ------------------------------------------------------------------ *
 * Moving the map by hand
 * ------------------------------------------------------------------ */

/** The closest and furthest a visitor may zoom. */
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 18;

/** Keeps a zoom inside the range the tiles and the projection agree on. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * The same view, dragged `dx` / `dy` pixels.
 *
 * A drag moves the picture with the finger, so the centre of the map travels
 * the other way: pull the map right and you are looking further west. Zoom is
 * untouched, which is what makes a drag feel like paper rather than a scroll.
 */
export function panView(view: MapView, dx: number, dy: number): MapView {
  if (!dx && !dy) return view;
  const world = TILE * 2 ** view.zoom;
  const centre = project(view.lat, view.lng, world);
  const next = unproject(centre.x - dx, centre.y - dy, world);
  return { lat: next.lat, lng: next.lng, zoom: view.zoom };
}

/**
 * Zoom to `zoom` while keeping one point of the map still.
 *
 * The wheel is over a place, the pinch is between two fingers: whatever is under
 * that point before the zoom has to still be under it afterwards, or the map
 * slides away from what the rider was looking at. Everything here is in
 * *pixels of the panel* — `anchor` is the point that must not move.
 */
export function zoomViewAt(
  view: MapView,
  zoom: number,
  anchor: { x: number; y: number },
  width: number,
  height: number,
): MapView {
  const next = clampZoom(zoom);
  if (Math.abs(next - view.zoom) < 1e-6) return view;
  const w = Math.max(width || 600, 1);
  const h = Math.max(height || 400, 1);

  // The ground under the anchor, read off the old zoom.
  const world = TILE * 2 ** view.zoom;
  const centre = project(view.lat, view.lng, world);
  const under = unproject(centre.x + (anchor.x - w / 2), centre.y + (anchor.y - h / 2), world);

  // Put that same ground back under the anchor at the new zoom.
  const nextWorld = TILE * 2 ** next;
  const spot = project(under.lat, under.lng, nextWorld);
  const shifted = unproject(spot.x - (anchor.x - w / 2), spot.y - (anchor.y - h / 2), nextWorld);
  return { lat: shifted.lat, lng: shifted.lng, zoom: next };
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
