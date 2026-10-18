/**
 * Which map tiles cover a panel, and where each one sits inside it.
 *
 * Kept apart from the component that draws them because it is pure geometry —
 * the same kind of arithmetic as utils/mercator, and the thing that has to be
 * provably in step with it. The overlay places pins with the mercator
 * projector; this places the picture underneath them. If the two disagree by
 * even a pixel the route drifts off the roads, so the maths lives here where
 * it can be checked directly.
 */

const TILE = 256;
const MAX_LAT = 85.05112878;

export interface TileView {
  lat: number;
  lng: number;
  zoom: number;
}

export interface PlacedTile {
  /** Column in the world grid; can run negative or past the end, it wraps. */
  tx: number;
  /** Row in the world grid; never leaves 0…2^zoom-1. */
  ty: number;
  /** Where the tile's top-left corner sits inside the panel, in pixels. */
  left: number;
  top: number;
  /** How big the tile is drawn, in pixels — 256 scaled by the zoom fraction. */
  size: number;
  /** The column wrapped into range — what goes in the URL. */
  wrapped: number;
  /** The whole level these were fetched at — also what goes in the URL. */
  tileZoom: number;
}

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

/**
 * Tiles exist only at whole zoom levels, but the view does not have to.
 *
 * The trick behind a fractional zoom: fetch the tiles from the nearest whole
 * level and draw them scaled by whatever is left over. A zoom of 8.4 fetches
 * level 8 tiles and draws them 2^0.4 times larger — about 1.3x. Rounding to
 * the nearest level rather than down keeps that factor between 0.71 and 1.41,
 * so tiles are never stretched far enough to look soft.
 */
export function tileScale(zoom: number): { tileZoom: number; scale: number } {
  const tileZoom = clamp(Math.round(zoom), 0, 19);
  return { tileZoom, scale: 2 ** (zoom - tileZoom) };
}

/** The point in the whole world picture, in pixels, at a given zoom. */
export function worldPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const clamped = Math.max(Math.min(lat, MAX_LAT), -MAX_LAT);
  const sin = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/** The inverse of worldPixel: the panel is `width` × `height` around `view`. */
export function panelOrigin(
  view: TileView,
  width: number,
  height: number,
): { x: number; y: number } {
  const centre = worldPixel(view.lat, view.lng, view.zoom);
  return { x: centre.x - width / 2, y: centre.y - height / 2 };
}

/**
 * The tiles covering a width × height panel centred on `view`.
 *
 * Longitude wraps, so a panel can run off either side of the world and still
 * be filled. Latitude does not: rows outside the grid are dropped, and
 * whatever is behind the tiles shows through there.
 */
export function tilesForView(view: TileView, width: number, height: number): PlacedTile[] {
  const { tileZoom, scale } = tileScale(view.zoom);
  const centre = worldPixel(view.lat, view.lng, tileZoom);
  // The tiles are drawn `scale` times the size they come, so the panel covers
  // that much less of the world than its own width and height.
  const originX = centre.x - width / (2 * scale);
  const originY = centre.y - height / (2 * scale);
  const spanX = width / scale;
  const spanY = height / scale;
  const count = 2 ** tileZoom;
  const tiles: PlacedTile[] = [];

  const firstCol = Math.floor(originX / TILE);
  const lastCol = Math.floor((originX + spanX) / TILE);
  const firstRow = Math.floor(originY / TILE);
  const lastRow = Math.floor((originY + spanY) / TILE);

  for (let tx = firstCol; tx <= lastCol; tx += 1) {
    for (let ty = firstRow; ty <= lastRow; ty += 1) {
      if (ty < 0 || ty >= count) continue;
      const wrapped = ((tx % count) + count) % count;
      tiles.push({
        tx,
        ty,
        left: (tx * TILE - originX) * scale,
        top: (ty * TILE - originY) * scale,
        size: TILE * scale,
        wrapped,
        tileZoom,
      });
    }
  }
  return tiles;
}

/**
 * OpenStreetMap's own tiles. Keyless, which is why they are the fallback when
 * MapLibre cannot start — but they are labelled, because raster tiles carry
 * their names in the image. There is no double-density variant.
 */
export function osmTileUrl(tileZoom: number, tile: PlacedTile): string {
  return `https://tile.openstreetmap.org/${tileZoom}/${tile.wrapped}/${tile.ty}.png`;
}

export { TILE as TILE_SIZE };
