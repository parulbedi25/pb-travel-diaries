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
 * tiles, which do carry labels but at least show something.
 */

import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap } from "maplibre-gl";
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
    const strip = () => hideLabels(created);
    // "load" once the first style is in; "styledata" covers any later reload.
    created.on("load", strip);
    created.on("styledata", strip);

    // If the style never arrives at all — blocked, offline, whatever — nothing
    // gets drawn and there is no error thrown to catch, so the panel would
    // just sit empty. Give it a deadline and fall back to raster tiles instead.
    const deadline = window.setTimeout(() => {
      if (!created.isStyleLoaded()) setNoWebGL(true);
    }, 12000);
    const clearDeadline = () => window.clearTimeout(deadline);
    created.once("load", clearDeadline);

    return () => {
      clearDeadline();
      created.off("load", strip);
      created.off("styledata", strip);
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
