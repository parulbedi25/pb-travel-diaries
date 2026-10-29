/**
 * Satellite imagery — a photograph of the ground instead of a drawing.
 *
 * Every one of the site's drawings comes from Geoapify as a vector style, and
 * the vector map switches its labels off. Imagery is the exception: it has no
 * layers to switch off, no names to hide and nothing to restyle, so it is drawn
 * here as plain tiles, without a map library, and it suits the Himalaya in a
 * way no street drawing does.
 *
 * The tiles are Esri's World Imagery: keyless, CORS-open and photographic, with
 * no name printed anywhere on it. That is also why this path is the only raster
 * one left — a raster tile of a *drawn* map carries its place names in the
 * picture, and showing one would break the promise the vector map keeps.
 *
 * Tiles are placed by hand rather than with a map library, so the arithmetic
 * lives in utils/tiles alongside the mercator projector that places the pins —
 * one idea of where the map is, not two that can drift apart.
 */

import { useMemo } from "react";
import { imageryTileUrl, tilesForView, type TileView } from "../utils/tiles";

export type { TileView };

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
  const tiles = useMemo(
    () => tilesForView(view, width, height),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.lat, view.lng, view.zoom, width, height],
  );

  return (
    <>
      <div className={className} data-raster-theme="imagery" aria-hidden="true">
        {tiles.map((tile) => (
          <img
            key={`${tile.tx}/${tile.ty}`}
            src={imageryTileUrl(tile.tileZoom, tile)}
            alt=""
            loading="eager"
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
        <MapAttribution className={attributionClassName} source="Esri" />
      )}
    </>
  );
}

/**
 * Who drew what is on screen, in a chip that reads on a light map and a dark
 * one alike.
 *
 * The map is the one part of the page that is not painted with the site's
 * palette — a light drawing and a dark drawing sit under the same overlay — so
 * the credit cannot use text that only works on one of them. It carries its own
 * background instead, and every caller supplies position and nothing else.
 */
const PROVIDER_LINKS: Record<string, string> = {
  Geoapify: "https://www.geoapify.com/",
};

const CREDITS: Record<string, { label: string; href: string; text: string }> = {
  Esri: {
    label: "Esri",
    href: "https://www.esri.com/en-us/legal/terms/data-attributions",
    text: "Maxar, Earthstar Geographics and the GIS community",
  },
};

export function MapAttribution({
  className,
  source,
}: {
  className?: string;
  /** Who is drawing the map: "Geoapify" for a drawing, "Esri" for imagery. */
  source?: string;
}) {
  const imagery = source ? CREDITS[source] : undefined;
  const link = "underline decoration-dotted underline-offset-2 hover:no-underline";

  return (
    <p
      className={[
        // The chip's colours live in index.css, one rule per theme, because a
        // map can be a light drawing or a dark one under the same overlay.
        "live-map-attribution pointer-events-auto inline-block max-w-[calc(100%-1rem)]",
        className ?? "",
      ].join(" ")}
    >
      {imagery ? (
        <>
          Imagery ©{" "}
          <a href={imagery.href} target="_blank" rel="noreferrer" className={link}>
            {imagery.label}
          </a>
          , {imagery.text}
        </>
      ) : (
        <>
          ©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className={link}
          >
            OpenStreetMap
          </a>{" "}
          contributors ·{" "}
          <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer" className={link}>
            OpenMapTiles
          </a>
          {source && (
            <>
              {" "}
              ·{" "}
              <a
                href={PROVIDER_LINKS[source] ?? "https://www.openstreetmap.org/copyright"}
                target="_blank"
                rel="noreferrer"
                className={link}
              >
                {source}
              </a>
            </>
          )}
        </>
      )}
    </p>
  );
}
