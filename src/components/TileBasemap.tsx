/**
 * Raster tiles — the map for when the vector one cannot be drawn.
 *
 * The tracker and the dashboard both use VectorBasemap, which draws Geoapify's
 * vector styles and switches their place labels off properly. This exists for
 * the two cases that leave it with nothing to draw: a browser without WebGL,
 * and a site with no Geoapify key to fetch a style with.
 *
 * It draws the same provider's same drawing, as pre-rendered tiles. Geoapify's
 * rasters need the key too, so a blank key is reported plainly rather than
 * asked for — a tile host's refusal draws as a grey square, and a grey square
 * that answers 200 is the worst kind of failure.
 *
 * Satellite is the one thing here Geoapify does not publish: that is Esri's
 * World Imagery, a photograph of the ground with no names painted into it.
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
import { cn } from "../utils/cn";

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
  const key = mapSettings.geoapifyKey.trim();
  // The raster path is reached either because satellite was chosen (the tiles
  // *are* that look) or because the vector style would not draw, in which case
  // Geoapify's raster of the same drawing stands in.
  const look = lookById(theme === "light" ? mapSettings.lightLook : mapSettings.darkLook, theme);
  const looksSatellite = Boolean(look.imagery);
  const rasterStyle = rasterStyleFor(mapSettings, theme);
  const chain = useMemo<RasterSource[]>(() => {
    // Without a key Geoapify's tiles are refusals, so they are not asked for at
    // all; the panel says why instead (see the notice below).
    if (looksSatellite) return ["satellite"];
    return key ? ["geoapify"] : [];
  }, [looksSatellite, key]);

  const [step, setStep] = useState(0);
  const source: RasterSource = chain[Math.min(step, Math.max(chain.length - 1, 0))];
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

  // Nothing to ask for and nothing to show: the honest panel is a blank one
  // with the reason on it, not a request that will be refused.
  if (!chain.length) {
    return (
      <div className={cn(className, "grid place-items-center bg-ink-900")} aria-hidden="true">
        <p className="px-4 text-center text-[10px] leading-relaxed text-zinc-500">
          Add a Geoapify key in the dashboard to draw the map.
        </p>
      </div>
    );
  }

  return (
    <>
    <div
      className={className}
      data-raster-theme={theme}
      data-raster-source={source}
      aria-hidden="true"
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
        source={source === "satellite" ? "Esri" : "Geoapify"}
      />
    )}
    </>
  );
}

/**
 * Who drew what is on screen.
 *
 * Both of the site's maps draw OpenStreetMap's data, so its credit is always
 * owed: Geoapify renders it, and the licence asks Geoapify to be named for the
 * tiles as well. Satellite is the exception — that is Esri's photography, and
 * crediting OpenStreetMap for a photograph would be a lie.
 */
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
  /** Who is drawing the map: "Geoapify" or "Esri". */
  source?: string;
}) {
  const imagery = source ? CREDITS[source] : undefined;
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
      Powered by{" "}
      <a
        href="https://www.geoapify.com/"
        target="_blank"
        rel="noreferrer"
        className="underline decoration-dotted underline-offset-2 hover:no-underline"
      >
        Geoapify
      </a>{" "}
      · ©{" "}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="underline decoration-dotted underline-offset-2 hover:no-underline"
      >
        OpenStreetMap
      </a>{" "}
      contributors
    </p>
  );
}
