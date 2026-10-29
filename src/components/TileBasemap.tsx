/**
 * Raster tiles — the picture under the pins, and the map when WebGL is not
 * available.
 *
 * The vector map is the site's map (VectorBasemap, drawing a Geoapify style).
 * This draws the same thing from Geoapify's raster tiles of the same drawing:
 * no style document, no WebGL, just squares of picture. It is used for the
 * dashboard's falling-over case, and as the immediate stand-in while a style is
 * still on its way.
 *
 * The key rides along in the tile URL, and when there is no key the tiles are
 * skipped entirely rather than drawn as the grey refusal Geoapify sends back —
 * a tile that loaded and a map that is empty is the worst kind of failure.
 *
 * Satellite is the exception: Geoapify publishes no imagery, so that look is
 * Esri's World Imagery, keyless and photographic.
 *
 * Tiles are placed by hand rather than with a map library, so the arithmetic
 * lives in utils/tiles alongside the mercator projector that places the pins —
 * one idea of where the map is, not two that can drift apart.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { resolveMapSettings, useSite, type MapSettings } from "../store/siteContent";
import { lookById, type Theme } from "../utils/mapLooks";
import { rasterStyleFor } from "../utils/basemapStyles";
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
  const mapSettings = settings ?? resolveMapSettings(content.map);
  const key = mapSettings.geoapifyKey.trim();
  const imagery = lookById(
    theme === "light" ? mapSettings.lightLook : mapSettings.darkLook,
    theme,
  ).imagery;
  const rasterStyle = rasterStyleFor(mapSettings, theme);
  // Satellite is the only raster this component is *asked* for by name; the
  // Geoapify drawing is the stand-in under the vector map, and it needs a key.
  const chain = useMemo<RasterSource[]>(() => {
    if (imagery) return ["satellite"];
    return key ? ["geoapify"] : [];
  }, [imagery, key]);

  const [step, setStep] = useState(0);
  const source: RasterSource = chain[Math.min(step, Math.max(chain.length - 1, 0))] ?? "geoapify";
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

  // A tile that will not load is the only signal that the host is not
  // answering. There is nowhere further to fall: this is the last map the site
  // can draw, so a few failures are absorbed and the credit keeps naming who
  // was asked rather than the panel quietly going blank.
  const onTileError = () => {
    if (failures.current >= FAILURES_BEFORE_FALLBACK) return;
    failures.current += 1;
    if (failures.current < FAILURES_BEFORE_FALLBACK) return;
    // Move one place down the chain; the last entry has nowhere to go, so it
    // stays put rather than flickering.
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
      // Each drawing already comes in the colours of its theme, so nothing is
      // recoloured here — the tile host is asked for the right drawing instead.

    >
      {tiles.map((tile) => (
        <img
          key={`${tile.tx}/${tile.ty}`}
          src={rasterTileUrl(source, rasterStyle, tile.tileZoom, tile, key)}
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
        source={source === "satellite" ? "ESRI" : "Geoapify"}
      />
    )}
    </>
  );
}

/**
 * Required by the tile licence. Every drawing is of OpenStreetMap's data,
 * rendered from the OpenMapTiles schema, so both credits are owed; Geoapify is
 * named alongside them because it is the host serving the pixels.
 */
const PROVIDER_LINKS: Record<string, string> = {
  Geoapify: "https://www.geoapify.com/",
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
  const provider = source;
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
      {source !== "ESRI" && (
        <>
          {" "}
          ·{" "}
          <a
            href="https://openmaptiles.org/"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:no-underline"
          >
            OpenMapTiles
          </a>
        </>
      )}
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
    </p>
  );
}
