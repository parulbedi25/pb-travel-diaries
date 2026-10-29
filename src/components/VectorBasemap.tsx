/**
 * A vector basemap with the labels turned off.
 *
 * Raster tiles have their place names painted into the picture, so a vector
 * map is the only way to get rid of them honestly. The map arrives as data plus
 * a style that says how to draw it, and every text label lives in a "symbol"
 * layer. Switching those layers off is a real off switch, not a workaround: the
 * names are never drawn, nothing is blurred, covered or watermarked, and the map
 * underneath is untouched.
 *
 * Every drawing comes from Geoapify (see ./utils/mapLooks). One style document
 * per look, fetched with the site's key; the style carries its own tiles, fonts
 * and sprites, so there is nothing else to configure and no second host to fall
 * back to. If the style never lands — no WebGL, no key, a host having a bad day
 * — the same drawing is shown as Geoapify raster tiles underneath, and the
 * panel says who drew it either way (see MapAttribution in TileBasemap).
 *
 * Patience is the whole difficulty. Too little and a working map gets thrown
 * away for being slow. Too much and the panel sits empty while it waits. So:
 *
 *  - A style is only abandoned when it has *stalled*. Tiles that are still
 *    arriving, however slowly, mean it is working — and throwing that away
 *    costs more than waiting for it.
 *  - While the vector map is on its way, the raster map is shown underneath and
 *    dropped the moment tiles land. A slow connection sees a map immediately
 *    and it goes nameless when the vector one arrives, rather than an empty
 *    panel for as long as it takes.
 *
 * Two timings in here are deliberate and easy to get wrong:
 *
 *  - Labels are hidden when the style can name its layers, not when the map has
 *    finished drawing. Anything that waits for tiles is too late; the names are
 *    already on screen.
 *  - Nothing is ever judged by map.isStyleLoaded(), which waits for tile data
 *    as well as the style and so reads "not loaded" on any ordinary slow
 *    connection — that is what threw away a working map and put labels back.
 */

import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  type MapSourceDataEvent,
  type MapStyleDataEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { resolveMapSettings, useSite, type MapSettings } from "../store/siteContent";
import TileBasemap from "./TileBasemap";
import { MapAttribution, type TileView } from "./TileBasemap";
import { BASEMAP_MAKER, styleChain } from "../utils/basemapStyles";
import { lookById, type Theme } from "../utils/mapLooks";

/** How long the style gets to arrive, and then how long tiles get to show up. */
const STYLE_TIMEOUT_MS = 15000;
const PAINT_TIMEOUT_MS = 15000;
/** Once tiles are arriving, how long they may stop arriving for. */
const STALL_TIMEOUT_MS = 15000;
/** How long to hold out before putting a map you can see on the screen. */
const PLACEHOLDER_AFTER_MS = 3000;

/**
 * Turn every label off.
 *
 * Doing it by layer type rather than by name means it cannot miss one: any
 * layer that can hold text is a symbol layer, whatever the style calls it.
 */
function hideLabels(map: MapLibreMap): void {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type === "symbol") {
      map.setLayoutProperty(layer.id, "visibility", "none");
    }
  }
}

export default function VectorBasemap({
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
  /** Where to put the credit. Omit and none is shown — but the licence wants one. */
  attributionClassName?: string;
  /**
   * Draw this look instead of the published one, so the dashboard's preview
   * shows an unsaved choice. The site itself never passes it.
   */
  settings?: MapSettings;
  /**
   * Draw as if the site were in this theme, whatever it is actually in — the
   * dashboard previews the light and dark looks side by side.
   */
  themeOverride?: Theme;
}) {
  const { theme: siteTheme, content } = useSite();
  const theme: Theme = themeOverride ?? (siteTheme === "light" ? "light" : "dark");
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [candidate, setCandidate] = useState(0);
  /**
   * Showing the labelled raster map until the nameless one is ready. Cleared
   * the moment tiles land, so it also stands in for "the nameless map is what
   * you are looking at".
   */
  const [placeholder, setPlaceholder] = useState(false);
  const sized = width > 1 && height > 1;

  const mapSettings = settings ?? resolveMapSettings(content.map);
  const look = lookById(theme === "light" ? mapSettings.lightLook : mapSettings.darkLook, theme);
  const chain = styleChain(mapSettings, theme);
  const gaveUp = candidate >= chain.length;
  const styleUrl = chain[Math.min(candidate, chain.length - 1)];

  // A fresh theme or a fresh map look is a fresh start: whatever went wrong
  // with the last one says nothing about the next.
  useEffect(() => setCandidate(0), [
    theme,
    mapSettings.lightLook,
    mapSettings.darkLook,
    mapSettings.geoapifyKey,
  ]);

  useEffect(() => {
    // Nothing to load for satellite: the tiles are the map, and asking a style
    // server anyway would be a request whose answer is never drawn.
    if (look.imagery) return;
    if (!host.current || !sized || gaveUp) return;

    let created: MapLibreMap;
    try {
      created = new MapLibreMap({
        container: host.current,
        style: styleUrl,
        center: [view.lng, view.lat],
        zoom: view.zoom,
        // Every one of these would move the map away from the projection our
        // pins are placed with, so they are pinned rather than left to default.
        bearing: 0,
        pitch: 0,
        // The overlay owns the pointer: in the tracker it keeps the map still,
        // and in the dashboard it is what receives the click that drops a pin.
        interactive: false,
        // Carried by MapAttribution instead, so it sits with the rest of the
        // panel's furniture rather than in MapLibre's own corner.
        attributionControl: false,
        fadeDuration: 0,
      });
    } catch {
      // No WebGL, so no vector map — and no point trying the others.
      setCandidate(chain.length);
      return;
    }

    map.current = created;

    let styleIn = false;
    let paintedNow = false;
    let tilesSeen = 0;
    let countedAtCheck = 0;
    let errors = 0;
    const sweeps: number[] = [];
    const timers: number[] = [];
    const strip = () => hideLabels(created);
    const next = () => setCandidate((index) => index + 1);

    // Some styles arrive asking for a globe. Our pins are placed with mercator
    // maths, so the two would disagree the moment the map curved.
    const flatten = () => {
      try {
        created.setProjection?.({ type: "mercator" });
      } catch {
        // Whatever it wants to be, the overlay stays where it is.
      }
    };

    // "style.load" is the event for precisely this, new in v6; "data" with a
    // style dataType is the same signal under its older name. Both are listed
    // so a rename can never quietly put the names back on the map.
    const onStyleIn = () => {
      if (styleIn) return;
      styleIn = true;
      flatten();
      strip();
      // Sprites and glyphs can widen the layer list in the moments after the
      // style lands, so sweep again rather than trusting the first pass.
      for (const ms of [0, 150, 600, 2000]) sweeps.push(window.setTimeout(strip, ms));
      timers.push(window.setTimeout(paintCheck, PAINT_TIMEOUT_MS));
    };

    // Tiles that are still arriving mean the host is answering. Only a stall
    // is a reason to move on: abandoning a map that is nearly there is how a
    // slow connection ends up with the labelled one instead.
    const paintCheck = () => {
      if (paintedNow) return;
      if (tilesSeen > countedAtCheck) {
        countedAtCheck = tilesSeen;
        timers.push(window.setTimeout(paintCheck, STALL_TIMEOUT_MS));
        return;
      }
      next();
    };

    const onData = (e: MapStyleDataEvent | MapSourceDataEvent) => {
      if (e?.dataType === "style") onStyleIn();
      // "content" is a tile's contents arriving — the proof that this host is
      // really serving, however slowly.
      if (e?.dataType === "source" && e.sourceDataType === "content") tilesSeen += 1;
    };

    // "idle" means everything asked for has arrived and been drawn — but it
    // also fires for a map with nothing to draw, hence areTilesLoaded.
    const onIdle = () => {
      strip();
      if (!created.areTilesLoaded()) return;
      paintedNow = true;
      setPlaceholder(false);
    };

    const onError = () => {
      if (paintedNow) return;
      errors += 1;
      // Before the style lands an error is the style itself; after it, a
      // handful of failing tiles means the host is not really answering.
      if (!styleIn || errors >= 4) next();
    };

    created.on("style.load", onStyleIn);
    created.on("data", onData);
    created.on("load", strip);
    // A later style change brings fresh layers with it.
    created.on("styledata", strip);
    created.on("idle", onIdle);
    created.on("error", onError);

    timers.push(window.setTimeout(() => !styleIn && next(), STYLE_TIMEOUT_MS));
    // Something to look at rather than an empty panel. It is replaced, not
    // added to, the moment the nameless map puts its first tiles on screen.
    timers.push(
      window.setTimeout(() => {
        if (!paintedNow) setPlaceholder(true);
      }, PLACEHOLDER_AFTER_MS),
    );

    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      sweeps.forEach((id) => window.clearTimeout(id));
      created.off("style.load", onStyleIn);
      created.off("data", onData);
      created.off("load", strip);
      created.off("styledata", strip);
      created.off("idle", onIdle);
      created.off("error", onError);
      created.remove();
      map.current = null;
    };
    // Rebuilt when the theme or the candidate changes — moving or resizing
    // reuses the same map. `view` is read once here and then followed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, sized, candidate, styleUrl]);

  // Follow the view. jumpTo so there is no animation to fall out of step with.
  useEffect(() => {
    map.current?.jumpTo({ center: [view.lng, view.lat], zoom: view.zoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.lat, view.lng, view.zoom]);

  useEffect(() => {
    map.current?.resize();
  }, [width, height]);

  // Satellite is a photograph of the ground, not a style with layers to draw,
  // so there is nothing for MapLibre to do: the tiles are the whole map.
  if (look.imagery) {
    return (
      <TileBasemap
        view={view}
        width={width}
        height={height}
        className={className}
        attributionClassName={attributionClassName}
        settings={settings}
        themeOverride={themeOverride}
      />
    );
  }

  const showingRaster = gaveUp || placeholder;
  // Whichever raster ends up on screen credits itself, because only it knows
  // whether it settled on the nameless drawing or the labelled last resort.
  const credit = attributionClassName && !showingRaster ? (
    <MapAttribution className={attributionClassName} source={BASEMAP_MAKER} />
  ) : null;

  if (gaveUp) {
    return (
      <>
        <TileBasemap
          view={view}
          width={width}
          height={height}
          className={className}
          attributionClassName={attributionClassName}
          settings={settings}
        />
      </>
    );
  }

  return (
    <>
      {/* Underneath, so the nameless map covers it as soon as it arrives. */}
      {placeholder && (
        <TileBasemap
          view={view}
          width={width}
          height={height}
          className={className}
          attributionClassName={attributionClassName}
          settings={settings}
        />
      )}
      <div ref={host} className={className} aria-hidden="true" />
      {credit}
    </>
  );
}

export { MapAttribution };
