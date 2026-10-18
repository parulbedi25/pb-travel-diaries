/**
 * A vector basemap with the labels turned off.
 *
 * Raster tiles have their place names painted into the picture, which is why
 * the only way to get rid of them was to find a map that ships without them —
 * and why CARTO's raster tiles needing a key took the nameless map with them.
 *
 * Vector tiles are different. The map arrives as data plus a style that says
 * how to draw it, and every text label lives in a "symbol" layer. Switching
 * those layers off is a real off switch, not a workaround: the names are never
 * drawn, nothing is blurred, covered or watermarked, and the map underneath is
 * untouched.
 *
 * Every style below is keyless — no sign-up, no API key, no request limits —
 * and all of them draw OpenStreetMap's data, so its credit is owed whichever
 * one answers (see MapAttribution in TileBasemap).
 *
 * They are tried in order, and a candidate has to prove itself twice over: the
 * style has to arrive, and then tiles have to actually reach the screen. Fail
 * either and the next one is tried. A provider having a slow day then costs a
 * few seconds rather than the whole map, and the nameless map survives one of
 * them being unreachable from wherever the visitor happens to be.
 *
 * Only when the whole chain has failed does it fall back to raster tiles,
 * which do carry labels — and the credit says so when they are on screen,
 * because a labelled map turning up where a nameless one belongs should never
 * pass for a silent success.
 *
 * Two timings in here are deliberate and easy to get wrong:
 *
 *  - Labels are hidden when the style can name its layers, not when the map has
 *    finished drawing. Anything that waits for tiles is too late; the names are
 *    already on screen.
 *  - The deadline that decides whether a candidate works is read from that same
 *    signal, never from map.isStyleLoaded(), which also waits for tile data and
 *    so reads "not loaded" on any ordinary slow connection — throwing away a
 *    working map to replace it with a labelled one.
 */

import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  type MapSourceDataEvent,
  type MapStyleDataEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useSite } from "../store/siteContent";
import TileBasemap from "./TileBasemap";
import { MapAttribution, type TileView } from "./TileBasemap";

/**
 * Keyless vector styles, best first. Both entries hide their labels the same
 * way — every text layer in each of them is a symbol layer — so whichever one
 * answers first, the map comes out nameless.
 */
const STYLE_CHAINS: Record<"dark" | "light", string[]> = {
  // OpenFreeMap's Positron and Dark are the styles CARTO's were forked from,
  // so the look barely changes.
  light: [
    "https://tiles.openfreemap.org/styles/positron",
    "https://tiles.versatiles.org/assets/styles/gray/style.json",
  ],
  dark: [
    "https://tiles.openfreemap.org/styles/dark",
    "https://tiles.versatiles.org/assets/styles/colorful-dark/style.json",
  ],
};

/** Named in the credit, so it is always possible to tell who drew the map. */
function providerLabel(styleUrl: string): string | undefined {
  if (styleUrl.includes("openfreemap.org")) return "OpenFreeMap";
  if (styleUrl.includes("versatiles.org")) return "VersaTiles";
  return undefined;
}

/** How long a candidate gets to arrive, and then to put tiles on the screen. */
const STYLE_TIMEOUT_MS = 8000;
const PAINT_TIMEOUT_MS = 6000;

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
}: {
  view: TileView;
  width: number;
  height: number;
  className?: string;
  /** Where to put the credit. Omit and none is shown — but the licence wants one. */
  attributionClassName?: string;
}) {
  const { theme } = useSite();
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [candidate, setCandidate] = useState(0);
  const sized = width > 1 && height > 1;

  const chain = STYLE_CHAINS[theme] ?? STYLE_CHAINS.dark;
  const gaveUp = candidate >= chain.length;
  const styleUrl = chain[Math.min(candidate, chain.length - 1)];

  // A fresh theme is a fresh start: whatever went wrong with the last one says
  // nothing about the next.
  useEffect(() => setCandidate(0), [theme]);

  useEffect(() => {
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

    // Has the style *definition* arrived, and have tiles reached the screen?
    // Neither is map.isStyleLoaded(), which waits for tile data as well and so
    // stays false on an ordinary slow connection long after the labels could
    // have been switched off.
    let styleIn = false;
    let painted = false;
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
      // Now the tiles have to show up. Waiting forever is how a panel ends up
      // blank; a labelled map is the lesser evil against no map at all.
      timers.push(window.setTimeout(() => !painted && next(), PAINT_TIMEOUT_MS));
    };
    const onData = (e: MapStyleDataEvent | MapSourceDataEvent) => {
      if (e?.dataType === "style") onStyleIn();
    };

    // "idle" means everything asked for has arrived and been drawn — but it
    // also fires for a map with nothing to draw, hence areTilesLoaded.
    const onIdle = () => {
      strip();
      if (created.areTilesLoaded()) painted = true;
    };

    const onError = () => {
      if (painted) return;
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

  const credit = attributionClassName ? (
    <MapAttribution
      className={attributionClassName}
      source={gaveUp ? "raster" : providerLabel(styleUrl)}
    />
  ) : null;

  if (gaveUp) {
    return (
      <>
        <TileBasemap view={view} width={width} height={height} className={className} />
        {credit}
      </>
    );
  }

  return (
    <>
      <div ref={host} className={className} aria-hidden="true" />
      {credit}
    </>
  );
}

export { MapAttribution };
