/**
 * A plain basemap drawn from tiles that carry no place names.
 *
 * Why this exists: Google's keyless embed paints its own place names into the
 * map image and offers no parameter to switch them off — not on the road map,
 * not on satellite, and not with any combination of filters that leaves the
 * map readable. The tracker's whole point is that the only names on it are the
 * checkpoints PB added, so the basemap has to come from somewhere that ships a
 * nameless style.
 *
 * CARTO's basemaps do, and they need no key. The "_nolabels" styles are the
 * same tiles as their labelled counterparts with the label layer left out, so
 * there is nothing to hide: the names are simply not in the image.
 *
 * The tiles are placed by hand rather than with a map library, so the
 * arithmetic lives in utils/tiles alongside the mercator projector that places
 * the pins — one idea of where the map is, not two that can drift apart.
 */

import { useMemo } from "react";
import { useSite } from "../store/siteContent";
import {
  TILE_STYLES,
  tileScale,
  tilesForView,
  tileUrl,
  type TileView,
} from "../utils/tiles";

export default function TileBasemap({
  view,
  width,
  height,
  className,
}: {
  view: TileView;
  width: number;
  height: number;
  className?: string;
}) {
  const { theme } = useSite();
  const tiles = useMemo(
    () => tilesForView(view, width, height),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.lat, view.lng, view.zoom, width, height],
  );

  // A fractional zoom draws the tiles larger than they come, so fetch the
  // double-density ones whenever that is happening, not just on dense screens.
  const { tileZoom, scale } = tileScale(view.zoom);
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const retina = dpr > 1.25 || scale > 1.05;
  const style = TILE_STYLES[theme] ?? TILE_STYLES.dark;

  return (
    <div className={className} aria-hidden="true">
      {tiles.map((tile) => (
        <img
          key={`${tile.tx}/${tile.ty}`}
          src={tileUrl(style, tileZoom, tile, retina)}
          alt=""
          width={Math.round(tile.size)}
          height={Math.round(tile.size)}
          draggable={false}
          style={{
            position: "absolute",
            left: `${tile.left}px`,
            top: `${tile.top}px`,
            width: `${Math.round(tile.size * 100) / 100}px`,
            height: `${Math.round(tile.size * 100) / 100}px`,
            maxWidth: "none",
          }}
        />
      ))}
    </div>
  );
}

/** Required by the tile licence: the data is OpenStreetMap's, tiles are CARTO's. */
export function TileAttribution({ className }: { className?: string }) {
  return (
    <p className={className}>
      ©{" "}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="underline decoration-dotted underline-offset-2 hover:no-underline"
      >
        OpenStreetMap
      </a>{" "}
      contributors ©{" "}
      <a
        href="https://carto.com/attributions"
        target="_blank"
        rel="noreferrer"
        className="underline decoration-dotted underline-offset-2 hover:no-underline"
      >
        CARTO
      </a>
    </p>
  );
}
