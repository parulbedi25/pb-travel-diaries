/**
 * A vector basemap with the labels turned off.
 *
 * Raster tiles have their place names painted into the picture, so a vector
 * map is the only way to get rid of them honestly.
 *
 * Vector tiles are different. The map arrives as data plus a style that says
 * how to draw it, and every text label lives in a "symbol" layer. Switching
 * those layers off is a real off switch, not a workaround: the names are never
 * drawn, nothing is blurred, covered or watermarked, and the map underneath is
 * untouched.
 *
 * The style comes from the dashboard's "Map look" setting — one Geoapify
 * drawing per theme (see MapSettings in store/siteContent and utils/mapLooks).
 * One style document per look, fetched with the site's key; the style carries
 * its own tiles, fonts and sprites, so there is nothing else to configure and
 * no second host to fall back to. If the style never lands — no WebGL, no key,
 * a host having a bad day — the panel says the map is missing, because there is
 * no second drawing to fall back to that would keep this promise.
 *
 * Every drawing is of OpenStreetMap's data rendered by OpenMapTiles, so both
 * credits are owed whichever one answers (see MapAttribution in TileBasemap).
 *
 * Patience is the whole difficulty. Too little and a working map gets thrown
 * away for being slow; too much and the panel sits empty while it waits. So a
 * map is only abandoned when it has *stalled*: tiles that are still arriving,
 * however slowly, mean it is working — and throwing that away costs more than
 * waiting for it. There is deliberately nothing drawing underneath while it
 * loads: every raster basemap Geoapify serves has its place names painted into
 * the picture, and a named map flashing up before the nameless one arrives is
 * the same broken promise, just harder to notice.
 *
 * Two timings in here are deliberate and easy to get wrong:
 *
 *  - Labels are hidden when the style can name its layers, not when the map has
 *    finished drawing. Anything that waits for tiles is too late; the names are
 *    already on screen.
 *  - Nothing is ever judged by map.isStyleLoaded(), which waits for tile data
 *    as well as the style and so reads "not loaded" on any ordinary slow
 *    connection — that is what threw away working maps.
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

  // No key, no map: say so where the map would be, with the one instruction
  // that fixes it. A blank panel looks like a bug; this is a task.
  if (!mapSettings.geoapifyKey.trim() && !look.imagery) {
    return (
      <div
        className={className}
        role="img"
        aria-label="The map needs a Geoapify key"
        style={{ display: "grid", placeItems: "center", background: "rgba(255,255,255,0.02)" }}
      >
        <p className="px-6 text-center text-[11px] leading-relaxed text-zinc-500">
          The map needs a key — paste one in the dashboard under{" "}
          <span className="text-zinc-300">Settings → Map → Map API key</span>.
        </p>
      </div>
    );
  }

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
      />
    );
  }

  // The style would not draw — no WebGL, a revoked key, a host having a bad
  // day. There is no labelled map behind this one any more: a place name on
  // the map is exactly what the site promises not to show, so the panel says
  // the map is missing instead of drawing a different one.
  if (gaveUp) {
    return (
      <div
        className={className}
        role="img"
        aria-label="The map could not be drawn"
        style={{ display: "grid", placeItems: "center", background: "rgba(255,255,255,0.02)" }}
      >
        <p className="px-6 text-center text-[11px] leading-relaxed text-zinc-500">
          The map could not be drawn just now. It will try again on the next visit.
        </p>
      </div>
    );
  }

  const credit = attributionClassName ? (
    <MapAttribution className={attributionClassName} source={BASEMAP_MAKER} />
  ) : null;

  return (
    <>
      <div ref={host} className={className} aria-hidden="true" />
      {credit}
    </>
  );
}

export { MapAttribution };
