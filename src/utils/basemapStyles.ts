/**
 * Which map style to try, and how the raster stand-in is chosen.
 *
 * Kept apart from the component that draws it because it is pure — given the
 * dashboard's setting and the site's theme, it says which style document to
 * fetch. A wrong URL means a map that never arrives, so it is worth being sure
 * about in one place.
 *
 * There is one provider now. Geoapify answers with a complete MapLibre style
 * (tiles, fonts, sprites, attribution) for every look, so there is no chain of
 * substitutes to walk: the chosen drawing, or — when the site has no key to
 * fetch a style with — its raster tiles, which at least put a map on screen.
 */

import type { MapSettings } from "../store/siteContent";
import { lookById, styleUrlFor, type MapLook, type Theme } from "./mapLooks";

/** Who draws the map, for the credit. */
export const BASEMAP_MAKER = "Geoapify";

/** The look a theme is set to draw. */
function chosenLook(settings: MapSettings, theme: Theme): MapLook {
  return lookById(theme === "light" ? settings.lightLook : settings.darkLook, theme);
}

/**
 * The order the styles are tried in.
 *
 * One entry, or none: the chosen drawing's style document. Satellite returns
 * nothing on purpose — its tiles *are* the map, and asking for a style anyway
 * would be a request whose answer is never drawn.
 */
export function styleChain(settings: MapSettings, theme: Theme): string[] {
  const look = chosenLook(settings, theme);
  if (look.imagery) return [];
  const url = styleUrlFor(look, settings.geoapifyKey);
  return url ? [url] : [];
}
