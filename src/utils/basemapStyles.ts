/**
 * Which map style to try, and in what order.
 *
 * Kept apart from the component that draws it because it is pure — given the
 * dashboard's setting and the site's theme, it produces a list of style URLs.
 * That is the part worth being sure about: a wrong URL means a map that never
 * arrives, and a wrong *order* means the operator's chosen look is not the one
 * they see.
 *
 * Two looks, from the "Map look" tab in the dashboard:
 *
 *  - CARTO's vector basemaps, with the site's own basemap key. Positron,
 *    Voyager and Dark Matter are drawn from OpenStreetMap's data without the
 *    place names, which is exactly what this site wants.
 *  - The keyless styles the site used before CARTO — OpenFreeMap, then
 *    VersaTiles. They cost nothing and need no key.
 *
 * Whichever is chosen, the other is always the fallback. A key that has been
 * revoked or has run out of quota should cost a few seconds and a different
 * drawing, not the map.
 */

import type { MapSettings } from "../store/siteContent";

/** The keyless vector styles, best first — the "OpenStreetMap" look. */
export const KEYLESS_STYLES: Record<"dark" | "light", string[]> = {
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

/** CARTO's style names, as its CDN spells them. */
export const CARTO_STYLE_NAMES = {
  voyager: "voyager-gl-style",
  positron: "positron-gl-style",
  "dark-matter": "dark-matter-gl-style",
} as const;

/**
 * CARTO's style URL for one theme.
 *
 * "auto" picks by theme rather than asking: Positron is the light drawing and
 * Dark Matter the dark one. Voyager is the third and is left to taste — it is
 * the warmest of the three and suits both themes.
 */
export function cartoStyleUrl(
  settings: MapSettings,
  theme: "dark" | "light",
): string | undefined {
  const key = settings.cartoKey.trim();
  if (!key) return undefined;
  const name =
    settings.cartoStyle === "auto"
      ? theme === "light"
        ? "positron"
        : "dark-matter"
      : settings.cartoStyle;
  return `https://basemaps.cartocdn.com/gl/${CARTO_STYLE_NAMES[name]}/style.json?key=${encodeURIComponent(key)}`;
}

/**
 * The order the styles are tried in. CARTO first when the dashboard chose it
 * and there is a key to draw with; the keyless styles are always behind it, so
 * a refused key costs a few seconds rather than the map.
 */
export function styleChain(settings: MapSettings, theme: "dark" | "light"): string[] {
  const keyless = KEYLESS_STYLES[theme] ?? KEYLESS_STYLES.dark;
  if (settings.provider !== "carto") return [...keyless];
  const carto = cartoStyleUrl(settings, theme);
  return carto ? [carto, ...keyless] : [...keyless];
}

/** Named in the credit, so it is always possible to tell who drew the map. */
export function providerLabel(styleUrl: string): string | undefined {
  if (styleUrl.includes("cartocdn.com")) return "CARTO";
  if (styleUrl.includes("openfreemap.org")) return "OpenFreeMap";
  if (styleUrl.includes("versatiles.org")) return "VersaTiles";
  return undefined;
}
