/**
 * Which map style to try, and in what order.
 *
 * Kept apart from the component that draws it because it is pure — given the
 * dashboard's setting and the site's theme, it produces a list of style URLs.
 * That is the part worth being sure about: a wrong URL means a map that never
 * arrives, and a wrong *order* means the operator's chosen look is not the one
 * they see.
 *
 * The dashboard picks one look per theme (see ./mapLooks). Whatever is chosen,
 * a keyless style of a similar weight is queued behind it, so a host having a
 * bad day — or a CARTO key that has been revoked or has run out of quota —
 * costs a few seconds and a different drawing rather than the map.
 */

import type { MapSettings } from "../store/siteContent";
import { lookById, looksFor, styleUrlFor, type Theme } from "./mapLooks";

/**
 * The keyless fallbacks for a theme, most similar to what was chosen first.
 *
 * These are the looks that need no account of any kind, so they are always
 * available: OpenFreeMap's drawings, then VersaTiles'.
 */
export function keylessChain(theme: Theme): string[] {
  return looksFor(theme)
    .map((look) => look.url)
    .filter((url): url is string => Boolean(url));
}

/**
 * The order the styles are tried in.
 *
 * The chosen drawing first — if it has a URL, which rules out satellite (there
 * is no style to fetch) and a CARTO drawing with no key. Everything keyless for
 * that theme follows, minus anything already in front.
 */
export function styleChain(settings: MapSettings, theme: Theme): string[] {
  const chosen = lookById(theme === "light" ? settings.lightLook : settings.darkLook, theme);
  const first = styleUrlFor(chosen, settings.cartoKey);
  const rest = keylessChain(theme).filter((url) => url !== first);
  return first ? [first, ...rest] : rest;
}

/** Named in the credit, so it is always possible to tell who drew the map. */
export function providerLabel(styleUrl: string): string | undefined {
  if (styleUrl.includes("cartocdn.com")) return "CARTO";
  if (styleUrl.includes("openfreemap.org")) return "OpenFreeMap";
  if (styleUrl.includes("versatiles.org")) return "VersaTiles";
  return undefined;
}
