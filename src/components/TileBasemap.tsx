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
 * CARTO's "_nolabels" styles do — the same tiles as their labelled
 * counterparts with the label layer left out, so there is nothing to hide: the
 * names are simply not in the image. They have needed a free API key since
 * September 2026 (see cartoKey in utils/tiles); with no key configured the
 * tracker falls back to OpenStreetMap's tiles, which are keyless but labelled.
 *
 * The tiles are placed by hand rather than with a map library, so the
 * arithmetic lives in utils/tiles alongside the mercator projector that places
 * the pins — one idea of where the map is, not two that can drift apart.
 */

import { useMemo, useState } from "react";
import { useSite } from "../store/siteContent";
import {
  TILE_STYLES,
  cartoKey,
  osmTileUrl,
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

  // With a key, CARTO's nameless tiles. Without one there is no point asking —
  // it answers with a watermarked image rather than an error — so go straight
  // to OpenStreetMap. A keyed request that genuinely fails ends up there too.
  const [cartoFailed, setCartoFailed] = useState(false);
  const named = !cartoKey || cartoFailed;

  return (
    <div className={className} aria-hidden="true">
      {tiles.map((tile) => (
        <img
          key={`${tile.tx}/${tile.ty}`}
          src={
            named
              ? osmTileUrl(tileZoom, tile)
              : tileUrl(style, tileZoom, tile, retina, cartoKey)
          }
          onError={() => setCartoFailed(true)}
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

/**
 * Required by the tile licence. Both providers are drawing on OpenStreetMap's
 * data; CARTO's name is only due when it is the one serving the tiles.
 */
export function TileAttribution({ className }: { className?: string }) {
  const carto = cartoKey.length > 0;
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
      contributors
      {carto && (
        <>
          {" "}
          ©{" "}
          <a
            href="https://carto.com/attributions"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:no-underline"
          >
            CARTO
          </a>
        </>
      )}
    </p>
  );
}
