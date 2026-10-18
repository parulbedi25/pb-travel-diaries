/**
 * A vector basemap from OpenFreeMap with the labels turned off.
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
 * OpenFreeMap serves these free: no key, no sign-up, no request limits, no
 * cookies, commercial use allowed. The data is OpenStreetMap's, so attribution
 * is still owed — see MapAttribution below.
 *
 * MapLibre draws to WebGL. On the rare browser where that is unavailable there
 * is no map at all rather than a broken one, so it falls back to the raster
 * tiles, which do carry labels but at least show something — and say so in the
 * credit, because a labelled map should never turn up silently.
 *
 * When to hide the labels matters as much as how. They have to go the moment
 * the style can be named, not when the map has finished drawing: every event
 * that waits for tiles is too late, and the names are already on screen by
 * then. See the note above isStyleLoaded below.
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

/** OpenFreeMap's Positron (light) and Dark — the styles CARTO's were forked from. */
const STYLES: Record<"dark" | "light", string> = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
};

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
  const [noWebGL, setNoWebGL] = useState(false);
  const sized = width > 1 && height > 1;

  useEffect(() => {
    if (!host.current || !sized) return;

    let created: MapLibreMap;
    try {
      created = new MapLibreMap({
        container: host.current,
        style: STYLES[theme] ?? STYLES.dark,
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
      setNoWebGL(true);
      return;
    }

    map.current = created;

    // Has the style *definition* arrived? That is all it takes to name a layer
    // and hide it. Deliberately not map.isStyleLoaded(): that also waits for
    // the tile data behind the style, so on an ordinary slow connection it is
    // still false long after every label could have been switched off — and a
    // deadline read from it throws away a map that was working and swaps in
    // labelled tiles. Both mistakes look like "the names came back".
    let styleIn = false;
    const sweeps: number[] = [];
    const strip = () => hideLabels(created);

    // "style.load" is the event for precisely this, new in v6; "data" with a
    // style dataType is the same signal under its older name. Both are listed
    // so a rename can never quietly put the names back on the map.
    const onStyleIn = () => {
      styleIn = true;
      strip();
      // Sprites and glyphs can widen the layer list in the moments after the
      // style lands, so sweep again rather than trusting the first pass.
      for (const ms of [0, 150, 600, 2000]) sweeps.push(window.setTimeout(strip, ms));
    };
    const onData = (e: MapStyleDataEvent | MapSourceDataEvent) => {
      if (e?.dataType === "style") onStyleIn();
    };

    created.on("style.load", onStyleIn);
    created.on("data", onData);
    created.on("load", strip);
    // A later style change — the theme swapping, for one — brings fresh layers.
    created.on("styledata", strip);
    created.on("idle", strip);

    // Only a real failure gives up: the style or its sprites could not be
    // fetched at all, so nothing at all is going to be drawn here.
    const onError = () => {
      if (!styleIn) setNoWebGL(true);
    };
    created.on("error", onError);

    // If the style simply never arrives, do not sit on an empty panel forever.
    // Generous, because what follows it is a labelled map.
    const deadline = window.setTimeout(() => {
      if (!styleIn) setNoWebGL(true);
    }, 20000);

    return () => {
      window.clearTimeout(deadline);
      sweeps.forEach((id) => window.clearTimeout(id));
      created.off("style.load", onStyleIn);
      created.off("data", onData);
      created.off("load", strip);
      created.off("styledata", strip);
      created.off("idle", strip);
      created.off("error", onError);
      created.remove();
      map.current = null;
    };
    // Rebuilt only when the style itself changes — moving or resizing reuses
    // the same map. `view` is read once here and then followed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, sized]);

  // Follow the view. jumpTo so there is no animation to fall out of step with.
  useEffect(() => {
    map.current?.jumpTo({ center: [view.lng, view.lat], zoom: view.zoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.lat, view.lng, view.zoom]);

  useEffect(() => {
    map.current?.resize();
  }, [width, height]);

  const credit = attributionClassName ? (
    <MapAttribution className={attributionClassName} source={noWebGL ? "raster" : "vector"} />
  ) : null;

  if (noWebGL) {
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
