/**
 * Raster tiles — the fallback for when WebGL is not available.
 *
 * The tracker and the dashboard both use VectorBasemap, which can switch
 * labels off properly. This exists for the browsers where MapLibre cannot
 * start at all, and it draws the same thing: a map with no place names on it.
 * CARTO's `*_nolabels` rasters are keyless, need no WebGL, and are drawn from
 * OpenStreetMap's data with every label left out — so the fallback is no longer
 * the labelled compromise it used to be.
 *
 * OpenStreetMap's own tiles are still behind that, for the day CARTO cannot be
 * reached. They *are* labelled — a raster tile carries its names in the
 * picture — so they are a genuine last resort, and the credit on screen
 * changes to say "labels shown" when they are the ones drawing.
 *
 * Tiles are placed by hand rather than with a map library, so the arithmetic
 * lives in utils/tiles alongside the mercator projector that places the pins —
 * one idea of where the map is, not two that can drift apart.
 */

import { useMemo, useRef, useState } from "react";
import { useSite } from "../store/siteContent";
import { rasterTileUrl, tilesForView, type RasterSource, type TileView } from "../utils/tiles";

export type { TileView };

/** Enough failures to mean the host is out, not one stuttering tile. */
const FAILURES_BEFORE_FALLBACK = 3;

export default function TileBasemap({
  view,
  width,
  height,
  className,
  attributionClassName,
}: {
  view: TileView;
  width: number;
  height: number;
  className?: string;
  /** Where to put the credit. The licence wants one whenever tiles are on screen. */
  attributionClassName?: string;
}) {
  const { theme } = useSite();
  const [source, setSource] = useState<RasterSource>("carto");
  const failures = useRef(0);
  const tiles = useMemo(
    () => tilesForView(view, width, height),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.lat, view.lng, view.zoom, width, height],
  );

  // A tile that will not load is the only signal that a host is not answering.
  // The last resort is the labelled map, so it is reached only after several
  // failures — and the credit then says so rather than passing silently.
  const onTileError = () => {
    if (source !== "carto") return;
    failures.current += 1;
    if (failures.current >= FAILURES_BEFORE_FALLBACK) setSource("osm");
  };

  return (
    <>
    <div
      className={className}
      data-raster-theme={theme}
      data-raster-source={source}
      aria-hidden="true"
      // CARTO publishes a drawing per theme, so nothing is recoloured. Only the
      // labelled OSM last resort has a single white-page drawing, and that one
      // is inverted in dark mode so it does not glow behind white text.
      style={
        source === "osm" && theme !== "light"
          ? { filter: "invert(1) hue-rotate(180deg) brightness(0.72) saturate(0.7)" }
          : undefined
      }
    >
      {tiles.map((tile) => (
        <img
          key={`${tile.tx}/${tile.ty}`}
          src={rasterTileUrl(source, theme === "light" ? "light" : "dark", tile.tileZoom, tile)}
          alt=""
          loading="eager"
          onError={onTileError}
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
    {attributionClassName && (
      <MapAttribution
        className={attributionClassName}
        source={source === "osm" ? "raster" : "CARTO"}
      />
    )}
    </>
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
/** Where to send the credit for each provider that might be drawing. */
const PROVIDER_LINKS: Record<string, string> = {
  OpenFreeMap: "https://openfreemap.org",
  VersaTiles: "https://versatiles.org",
  CARTO: "https://carto.com/attributions",
};

export function MapAttribution({
  className,
  source,
}: {
  className?: string;
  /** Who is drawing the map, or "raster" for the labelled fallback. */
  source?: string;
}) {
  const provider = source && source !== "raster" ? source : undefined;
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
      {provider && (
        <>
          {" "}
          ·{" "}
          <a
            href={PROVIDER_LINKS[provider] ?? "https://www.openstreetmap.org/copyright"}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:no-underline"
          >
            {provider}
          </a>
        </>
      )}
      {source === "raster" && <> · labels shown</>}
    </p>
  );
}
