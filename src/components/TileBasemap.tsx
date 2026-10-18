/**
 * Raster tiles — the fallback for when WebGL is not available.
 *
 * The tracker and the dashboard both use VectorBasemap, which can switch
 * labels off properly. This exists for the browsers where MapLibre cannot
 * start at all: OpenStreetMap's own tiles need no key and no WebGL, so the map
 * still shows. They are labelled, because raster tiles have their names painted
 * into the picture and there is no way to ask for them without.
 *
 * Tiles are placed by hand rather than with a map library, so the arithmetic
 * lives in utils/tiles alongside the mercator projector that places the pins —
 * one idea of where the map is, not two that can drift apart.
 */

import { useMemo } from "react";
import { osmTileUrl, tilesForView, type TileView } from "../utils/tiles";

export type { TileView };

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
  const tiles = useMemo(
    () => tilesForView(view, width, height),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.lat, view.lng, view.zoom, width, height],
  );

  return (
    <div className={className} aria-hidden="true">
      {tiles.map((tile) => (
        <img
          key={`${tile.tx}/${tile.ty}`}
          src={osmTileUrl(tile.tileZoom, tile)}
          alt=""
          width={Math.round(tile.size)}
          height={Math.round(tile.size)}
          draggable={false}
          style={{
            position: "absolute",
            left: `${Math.round(tile.left * 100) / 100}px`,
            top: `${Math.round(tile.top * 100) / 100}px`,
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
 * Required by the tile licence. Both the vector and the raster map are drawing
 * on OpenStreetMap's data, so its credit is always owed; OpenFreeMap's is added
 * when it is the one serving.
 *
 * The raster map is the fallback, and its tiles have names painted into them.
 * When it is on screen the credit says so, because a labelled map appearing
 * where a nameless one belongs should never pass as a silent success.
 */
export function MapAttribution({
  className,
  source = "vector",
}: {
  className?: string;
  source?: "vector" | "raster";
}) {
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
      {source === "vector" && (
        <>
          {" "}
          ·{" "}
          <a
            href="https://openfreemap.org"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:no-underline"
          >
            OpenFreeMap
          </a>
        </>
      )}
      {source === "raster" && <> · labels shown</>}
    </p>
  );
}
