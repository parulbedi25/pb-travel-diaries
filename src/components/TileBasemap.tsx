/**
 * A raster basemap — a picture of the ground instead of a drawing.
 *
 * The site's drawings come from a map vendor as vector styles, and the vector
 * map switches its labels off. A raster has no layers to switch off,
 * so only rasters with no names printed on them are allowed here: Esri's
 * imagery, and Esri's light and dark canvases. A raster of a *drawn* map would
 * carry its place names in the picture and break the promise the vector map
 * keeps.
 *
 * That makes this component the map of last resort as well as a look in its own
 * right: it needs no key, no WebGL and no worker, so it draws wherever the
 * drawings cannot. The light or dark canvas sits under a drawing until the
 * drawing has actually painted (see VectorBasemap), which is why a panel is
 * never empty.
 *
 * Tiles are placed by hand rather than with a map library, so the arithmetic
 * lives in utils/tiles alongside the mercator projector that places the pins —
 * one idea of where the map is, not two that can drift apart.
 */

import { useMemo } from "react";
import { baseTileUrl, tilesForView, type MapBase, type TileView } from "../utils/tiles";

export type { TileView };

export default function TileBasemap({
  view,
  width,
  height,
  className,
  attributionClassName,
  base = "imagery",
}: {
  view: TileView;
  width: number;
  height: number;
  className?: string;
  /** Where to put the credit. The licence wants one whenever tiles are on screen. */
  attributionClassName?: string;
  /** Which raster to draw: imagery, or the light or dark canvas. */
  base?: MapBase;
}) {
  const tiles = useMemo(
    () => tilesForView(view, width, height),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.lat, view.lng, view.zoom, width, height],
  );

  return (
    <>
      <div className={className} data-raster-theme={base} aria-hidden="true">
        {tiles.map((tile) => (
          <img
            key={`${tile.tx}/${tile.ty}`}
            src={baseTileUrl(base, tile.tileZoom, tile)}
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
        <MapAttribution className={attributionClassName} map={base === "imagery" ? "imagery" : "canvas"} />
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
 *
 * Three things can be under it, and each owes a different credit: a Geoapify
 * drawing is OpenStreetMap's data through OpenMapTiles, while the imagery and
 * the canvases are Esri's.
 */
export type MapCredit = "drawing" | "imagery" | "canvas";

const ESRI_HREF = "https://www.esri.com/en-us/legal/terms/data-attributions";

const RASTER_CREDITS: Record<"imagery" | "canvas", { lead: string; text: string }> = {
  imagery: { lead: "Imagery ©", text: "Maxar, Earthstar Geographics and the GIS community" },
  canvas: { lead: "©", text: "HERE, Garmin, OpenStreetMap contributors, the GIS community" },
};

export function MapAttribution({
  className,
  map,
  maker = "Geoapify",
}: {
  className?: string;
  /** What is being drawn: a vendor's drawing, Esri imagery, or an Esri canvas. */
  map?: MapCredit;
  /** Which vendor drew it — the drawing's credit names the one that answered. */
  maker?: string;
}) {
  const raster = map === "imagery" || map === "canvas" ? RASTER_CREDITS[map] : undefined;
  const link = "underline decoration-dotted underline-offset-2 hover:no-underline";

  return (
    <p
      className={[
        // The chip's colours live in index.css, because a map can be a light
        // drawing or a dark one under the same overlay.
        "live-map-attribution pointer-events-auto inline-block max-w-[calc(100%-1rem)]",
        className ?? "",
      ].join(" ")}
    >
      {raster ? (
        <>
          {raster.lead}{" "}
          <a href={ESRI_HREF} target="_blank" rel="noreferrer" className={link}>
            Esri
          </a>
          , {raster.text}
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
          </a>{" "}
          ·{" "}
          {/* Named, not linked: each vendor has its own terms page, and the
              credit only has to say whose drawing this is. */}
          <span>{maker}</span>
        </>
      )}
    </p>
  );
}
