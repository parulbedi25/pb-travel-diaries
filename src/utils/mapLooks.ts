/**
 * The map looks the site can be drawn in.
 *
 * Every drawing here is one of Geoapify's styles: a MapLibre style document
 * that already carries its tiles, fonts, sprites and attribution, so a look is
 * a single name — `osm-bright`, `positron`, `dark-matter` — plus the site's key.
 * There is no second tile host any more: the CARTO, OpenFreeMap and VersaTiles
 * drawings are gone, along with the code that built their URLs, because one
 * provider that answers is worth less than one provider that is understood.
 * The style names are Geoapify's own, spelled exactly — `osm-carto` is the
 * Mapnik drawing, and there is no style called plain "carto".
 *
 * A look is chosen per theme in the dashboard, so a site can be `osm-bright` by
 * day and `dark-matter` by night. Two of them are not drawings at all:
 * `osm-carto` is a picture of the classic OSM drawing, names and all, served as
 * raster tiles through a style, and satellite is a photograph of the ground.
 * Geoapify publishes no imagery, so satellite stays Esri's, drawn by the raster
 * path; `osm-carto` is listed as it is because a rider who wants the map they
 * know should be able to have it, and its own hint says what comes with it.
 *
 * Nothing here is a hard dependency on the network at import time; the key is
 * passed in, and a missing key simply yields no style URL (the map then falls
 * back to Geoapify's raster tiles, which say so in their credit).
 */

export type Theme = "light" | "dark";

export type MapLookId =
  /* Geoapify's drawings of OpenStreetMap data — one style name each. */
  | "osm-bright"
  | "osm-bright-grey"
  | "osm-bright-smooth"
  | "osm-carto"
  | "klokantech-basic"
  | "maptiler-3d"
  | "osm-liberty"
  | "positron"
  | "positron-blue"
  | "positron-red"
  | "toner"
  | "toner-grey"
  | "dark-matter"
  | "dark-matter-brown"
  | "dark-matter-dark-grey"
  | "dark-matter-dark-purple"
  | "dark-matter-purple-roads"
  | "dark-matter-yellow-roads"
  /* Esri World Imagery — a photograph of the ground, not a drawing. */
  | "satellite";

export interface MapLook {
  id: MapLookId;
  label: string;
  /** One line in the dashboard: what this drawing feels like. */
  hint: string;
  /** Which theme the drawing was made for. Satellite suits both. */
  themes: Theme[];
  /** Who draws it, for the credit and for the panel. */
  maker: "Geoapify" | "Esri";
  /** Geoapify's style name — the URL needs the site's key appended. */
  style?: string;
  /** True for raster imagery, which has no style to draw. */
  imagery?: boolean;
}

export const MAP_LOOKS: MapLook[] = [
  /* ── light ───────────────────────────────────────────────────────────── */
  {
    id: "osm-bright",
    label: "Bright",
    hint: "Clean and light: white ground, crisp roads, soft green",
    themes: ["light"],
    maker: "Geoapify",
    style: "osm-bright",
  },
  {
    id: "osm-bright-grey",
    label: "Bright Grey",
    hint: "The bright drawing with the colour drained out of it",
    themes: ["light"],
    maker: "Geoapify",
    style: "osm-bright-grey",
  },
  {
    id: "osm-bright-smooth",
    label: "Bright Smooth",
    hint: "Bright, with the small detail smoothed away — calm at a glance",
    themes: ["light"],
    maker: "Geoapify",
    style: "osm-bright-smooth",
  },
  {
    id: "osm-carto",
    label: "Mapnik",
    hint: "The classic OpenStreetMap drawing — with its names printed on it",
    themes: ["light"],
    maker: "Geoapify",
    style: "osm-carto",
  },
  {
    id: "klokantech-basic",
    label: "Basic",
    hint: "Flat and neutral: no relief, no texture, only what matters",
    themes: ["light"],
    maker: "Geoapify",
    style: "klokantech-basic",
  },
  {
    id: "maptiler-3d",
    label: "Three Dimensions",
    hint: "Buildings lifted off the ground — the one with depth",
    themes: ["light"],
    maker: "Geoapify",
    style: "maptiler-3d",
  },
  {
    id: "osm-liberty",
    label: "Liberty",
    hint: "The modern OpenStreetMap look — bolder roads, softer land",
    themes: ["light"],
    maker: "Geoapify",
    style: "osm-liberty",
  },
  {
    id: "positron",
    label: "Positron",
    hint: "Pale and quiet, almost no colour — the calmest of the light ones",
    themes: ["light"],
    maker: "Geoapify",
    style: "positron",
  },
  {
    id: "positron-blue",
    label: "Positron Blue",
    hint: "Positron with the water drawn in a decided blue",
    themes: ["light"],
    maker: "Geoapify",
    style: "positron-blue",
  },
  {
    id: "positron-red",
    label: "Positron Red",
    hint: "Positron with the roads picked out in red",
    themes: ["light"],
    maker: "Geoapify",
    style: "positron-red",
  },
  {
    id: "toner",
    label: "Toner",
    hint: "Black ink on white paper — a printed map, not a screen",
    themes: ["light"],
    maker: "Geoapify",
    style: "toner",
  },
  {
    id: "toner-grey",
    label: "Toner Grey",
    hint: "Muted grey, no colour at all — lets the route do the talking",
    themes: ["light"],
    maker: "Geoapify",
    style: "toner-grey",
  },

  /* ── dark ────────────────────────────────────────────────────────────── */
  {
    id: "dark-matter",
    label: "Dark Matter",
    hint: "Near-black with thin bright roads — the darkest of the set",
    themes: ["dark"],
    maker: "Geoapify",
    style: "dark-matter",
  },
  {
    id: "dark-matter-brown",
    label: "Dark Brown",
    hint: "Dark Matter warmed up: brown land, cream roads",
    themes: ["dark"],
    maker: "Geoapify",
    style: "dark-matter-brown",
  },
  {
    id: "dark-matter-dark-grey",
    label: "Dark Grey",
    hint: "Grey-on-grey, flat and matter of fact",
    themes: ["dark"],
    maker: "Geoapify",
    style: "dark-matter-dark-grey",
  },
  {
    id: "dark-matter-dark-purple",
    label: "Dark Purple",
    hint: "Black land under a violet wash — the night-sky one",
    themes: ["dark"],
    maker: "Geoapify",
    style: "dark-matter-dark-purple",
  },
  {
    id: "dark-matter-purple-roads",
    label: "Purple Roads",
    hint: "Dark ground with the roads in violet — the most colourful dark",
    themes: ["dark"],
    maker: "Geoapify",
    style: "dark-matter-purple-roads",
  },
  {
    id: "dark-matter-yellow-roads",
    label: "Yellow Roads",
    hint: "Dark ground, gold roads — reads like a night highway sign",
    themes: ["dark"],
    maker: "Geoapify",
    style: "dark-matter-yellow-roads",
  },

  /* ── both ────────────────────────────────────────────────────────────── */
  {
    id: "satellite",
    label: "Satellite",
    hint: "A photograph of the ground, no names on it — for the Himalaya",
    themes: ["dark", "light"],
    maker: "Esri",
    imagery: true,
  },
];

const BY_ID = new Map<MapLookId, MapLook>(MAP_LOOKS.map((look) => [look.id, look]));

/** The looks drawn for a theme, in the order the dashboard offers them. */
export function looksFor(theme: Theme): MapLook[] {
  return MAP_LOOKS.filter((look) => look.themes.includes(theme));
}

/**
 * A look by id, with a theme-appropriate stand-in when the id is not one this
 * build knows — an older save, or a look removed since.
 */
export function lookById(id: string | undefined, theme: Theme): MapLook {
  const found = id ? BY_ID.get(id as MapLookId) : undefined;
  if (found) return found;
  return theme === "light" ? BY_ID.get("osm-bright")! : BY_ID.get("dark-matter")!;
}

/**
 * The style URL for a look, or `undefined` when there is nothing to fetch —
 * satellite imagery (the tiles are the map), or a drawing with no key to unlock
 * it. Geoapify wants the key on the style document itself.
 */
export function styleUrlFor(look: MapLook, key: string): string | undefined {
  if (!look.style) return undefined;
  const trimmed = key.trim();
  if (!trimmed) return undefined;
  return `https://maps.geoapify.com/v1/styles/${look.style}/style.json?apiKey=${encodeURIComponent(trimmed)}`;
}
