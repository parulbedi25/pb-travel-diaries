/**
 * The map looks the site can be drawn in.
 *
 * One catalogue, one provider. Every drawing here is a Geoapify style: a
 * MapLibre style document that already carries its tiles, fonts, sprites and
 * attribution, so a look is a single name — `osm-bright`, `positron`,
 * `dark-matter` — plus the site's key. Spelling matters: these are Geoapify's
 * own style ids, not names of our own inventing, and there is no style called
 * plain "carto" (`osm-carto` is the Mapnik drawing, and it arrives as raster
 * tiles with its place names printed into the picture).
 *
 * A look is chosen per theme in the dashboard, so a site can be `osm-bright` by
 * day and `dark-matter` by night. Every drawing here is a *vector* style, which
 * matters: the map turns its place names off by hiding the style's text layers,
 * and that only works on a drawing. Geoapify's `osm-carto` is left out for that
 * reason — it arrives as raster tiles with the names printed into the picture.
 *
 * Satellite is the exception the other way: a photograph of the ground rather
 * than a style with layers to hide, so it has no names to switch off in the
 * first place. Geoapify publishes no imagery, so it stays Esri's.
 *
 * Nothing here is a hard dependency on the network at import time; the key is
 * passed in, and a missing key simply yields no style URL (the map then falls
 * back to the raster tiles, which say in their credit that they are the map).
 */

export type Theme = "light" | "dark";

export type MapLookId =
  /* Geoapify's drawings of OpenStreetMap data — one style name each. */
  | "osm-bright"
  | "osm-bright-grey"
  | "osm-bright-smooth"
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
export function styleUrlFor(look: MapLook, geoapifyKey: string): string | undefined {
  if (!look.style) return undefined;
  const key = geoapifyKey.trim();
  if (!key) return undefined;
  return `https://maps.geoapify.com/v1/styles/${look.style}/style.json?apiKey=${encodeURIComponent(key)}`;
}
