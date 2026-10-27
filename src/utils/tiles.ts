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
 * The raster basemaps, best first.
 *
 * CARTO's `*_nolabels` rasters are the point of this list: they are drawn from
 * OpenStreetMap's data with every place name left out, which is the same thing
 * the vector styles are asked for by switching their symbol layers off. They
 * come in a light and a dark drawing, so each theme gets the map it asks for.
 *
 * They are **not** keyless, whatever the URL suggests. Asked without a key the
 * tile answers 200 with a placeholder stamped "API KEY REQUIRED" — a 2 KB grey
 * square where the map should be. Measured, not assumed: the same tile is
 * 13.7 KB with the key and 2 KB without. So the key travels in the URL, and
 * with no key the CARTO raster is skipped rather than drawn as a grey hole
 * (see TileBasemap).
 *
 * Where the ground is a landscape rather than a diagram, the satellite tiles
 * are Esri's World Imagery — keyless, CORS-open, and photographic, so there is
 * no name printed anywhere on them. They are the "Satellite" layout in the
 * dashboard, and they suit the Himalaya better than any Street drawing does.
 *
 * OpenStreetMap's own tiles stay at the end as a genuine last resort — keyless
 * too, but *labelled*, because a raster tile has its names painted into the
 * picture and there is no way to ask for it without. If they ever end up on
 * screen the credit says so (see MapAttribution), because a labelled map where
 * a nameless one belongs should not pass as a success.
 */
export type RasterSource = "carto" | "satellite" | "osm";

/**
 * Each raster's own drawing, so the map follows the site's theme.
 *
 * `key` is the CARTO basemap key, and a CARTO tile needs it to be a map at all:
 * without it the tile is a grey "API KEY REQUIRED" placeholder that still
 * answers 200 — the kind of failure that looks like a working map until you
 * actually look at it.
 */
export function rasterTileUrl(
  source: RasterSource,
  theme: "light" | "dark",
  tileZoom: number,
  tile: PlacedTile,
  key?: string,
): string {
  if (source === "carto") {
    const drawing = theme === "light" ? "light_nolabels" : "dark_nolabels";
    const base = `https://a.basemaps.cartocdn.com/${drawing}/${tileZoom}/${tile.wrapped}/${tile.ty}.png`;
    const trimmed = (key ?? "").trim();
    return trimmed ? `${base}?key=${encodeURIComponent(trimmed)}` : base;
  }
  if (source === "satellite") {
    // Esri's imagery is a photograph of the ground, so there is nothing to
    // switch off: no names, no road shield, no label layer at all.
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tileZoom}/${tile.ty}/${tile.wrapped}`;
  }
  return `https://tile.openstreetmap.org/${tileZoom}/${tile.wrapped}/${tile.ty}.png`;
}
