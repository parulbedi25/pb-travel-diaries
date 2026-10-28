/**
 * Raster tiles — the fallback for when WebGL is not available.
 *
 * The tracker and the dashboard both use VectorBasemap, which can switch
 * labels off properly. This exists for the browsers where MapLibre cannot
 * start at all, and it draws the same thing: a map with no place names on it.
 * CARTO's `*_nolabels` rasters need no WebGL and are drawn from OpenStreetMap's
 * data with every label left out — so the fallback is no longer the labelled
 * compromise it used to be.
 *
 * They do want the key, though. Without it they answer 200 with a grey
 * "API KEY REQUIRED" placeholder, which is the worst kind of failure: a tile
 * that loaded and a map that is empty. So the key rides along in the tile URL,
 * and when there is no key the CARTO raster is skipped entirely and
 * OpenStreetMap's tiles are used instead — labelled, but honest about it.
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

import { useEffect, useMemo, useRef, useState } from "react";
import { resolveMapSettings, useSite, type MapSettings } from "../store/siteContent";
import { lookById, type Theme } from "../utils/mapLooks";
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
  settings,
  themeOverride,
}: {
  view: TileView;
  width: number;
  height: number;
  className?: string;
  /** Where to put the credit. The licence wants one whenever tiles are on screen. */
  attributionClassName?: string;
  /**
   * Draw this look instead of the published one. The dashboard's preview passes
   * the draft, so the map on screen can show a choice that has not been saved
   * yet — and still be the same component the site itself draws with.
   */
  settings?: MapSettings;
  /** Draw as if the site were in this theme. The dashboard previews both. */
  themeOverride?: Theme;
}) {
  const { theme: siteTheme, content } = useSite();
  const theme: Theme = themeOverride ?? (siteTheme === "light" ? "light" : "dark");
  // The dashboard's map look decides which raster is tried first. Whatever is
  // chosen, the others queue behind it — a host having a bad day should cost a
  // different drawing, not the map.
  const mapSettings = settings ?? resolveMapSettings(content.map);
  const cartoKey = mapSettings.cartoKey.trim();
  // The raster path is reached either because satellite was chosen (the tiles
  // *are* that look) or because the vector style would not draw, in which case
  // the labelled map is the last resort and says so in its credit.
  const imagery = lookById(theme === "light" ? mapSettings.lightLook : mapSettings.darkLook, theme).imagery;
  const chain = useMemo<RasterSource[]>(() => {
    // Without a key CARTO's tiles are grey "API KEY REQUIRED" squares, so they
    // are not asked for at all — the labelled map is the better of the two
    // failures, and at least it says what it is.
    const carto: RasterSource[] = cartoKey ? ["carto"] : [];
    if (imagery) return ["satellite", ...carto, "osm"];
    return [...carto, "osm"];
  }, [imagery, cartoKey]);

  const [step, setStep] = useState(0);
  const source = chain[Math.min(step, chain.length - 1)];
  const failures = useRef(0);

  useEffect(() => {
    setStep(0);
    failures.current = 0;
  }, [chain]);
  const tiles = useMemo(
    () => tilesForView(view, width, height),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.lat, view.lng, view.zoom, width, height],
  );

  // A tile that will not load is the only signal that a host is not answering.
  // The last resort is the labelled map, so it is reached only after several
  // failures — and the credit then says so rather than passing silently.
  const onTileError = () => {
    if (failures.current >= FAILURES_BEFORE_FALLBACK) return;
    failures.current += 1;
    if (failures.current < FAILURES_BEFORE_FALLBACK) return;
    // Move one place down the chain; the last entry has nowhere to go, so it
    // stays put rather than flickering between two dead hosts.
    failures.current = 0;
    setStep((i) => Math.min(i + 1, chain.length - 1));
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
          src={rasterTileUrl(source, theme === "light" ? "light" : "dark", tile.tileZoom, tile, cartoKey)}
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
        source={source === "osm" ? "raster" : source === "satellite" ? "ESRI" : "CARTO"}
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

/**
 * Who drew what is on screen.
 *
 * Most of these are drawings of OpenStreetMap's data, so its credit comes
 * first. Satellite is the exception: that is Esri's photography, and crediting
 * OpenStreetMap for a photograph would be a lie — so it says whose picture it
 * is instead.
 */
const CREDITS: Record<string, { label: string; href: string; text: string }> = {
  ESRI: {
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
  /** Who is drawing the map, or "raster" for the labelled fallback. */
  source?: string;
}) {
  const provider = source && source !== "raster" ? source : undefined;
  const imagery = provider ? CREDITS[provider] : undefined;
  if (imagery) {
    return (
      <p className={className}>
        Imagery ©{" "}
        <a
          href={imagery.href}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-dotted underline-offset-2 hover:no-underline"
        >
          {imagery.label}
        </a>
        , {imagery.text}
      </p>
    );
  }
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
