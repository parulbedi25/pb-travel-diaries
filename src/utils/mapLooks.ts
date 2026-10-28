/**
 * The map looks the site can be drawn in.
 *
 * One catalogue, one answer, for the dashboard and for the maps themselves.
 * Before this, "Map look" offered a provider and then — under CARTO only — one
 * of three CARTO drawings, and whichever you picked applied to both themes. So
 * there was no way to say "Positron by day, Dark Matter by night", and no way to
 * use a drawing from anybody but CARTO.
 *
 * A look is now just a drawing: where its style comes from, whether it needs the
 * key, and which theme it was made for. The dashboard asks for one per theme;
 * this module turns each into a style URL, or reports that it is satellite
 * imagery with no style at all.
 *
 * Nothing here is a hard dependency. Every vector look falls back to a keyless
 * style of a similar weight when its own host will not answer (see
 * styleChain in ./basemapStyles), because a map in another drawing is worth
 * more than a blank panel.
 */

export type Theme = "light" | "dark";

export type MapLookId =
  /* CARTO — keyed vector drawings, drawn from OpenStreetMap data. */
  | "positron"
  | "voyager"
  | "dark-matter"
  /* OpenFreeMap — keyless vector drawings, no account needed. */
  | "bright"
  | "liberty"
  | "osm-dark"
  /* VersaTiles — keyless vector drawings, a quieter alternative. */
  | "gray"
  | "colorful-dark"
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
  maker: "CARTO" | "OpenFreeMap" | "VersaTiles" | "Esri";
  /** The style URL, for the keyless looks. */
  url?: string;
  /** CARTO's style name — the URL needs the site's key appended. */
  carto?: "positron-gl-style" | "voyager-gl-style" | "dark-matter-gl-style";
  /** True for raster imagery, which has no style to draw. */
  imagery?: boolean;
}

export const MAP_LOOKS: MapLook[] = [
  /* ── light ───────────────────────────────────────────────────────────── */
  {
    id: "bright",
    label: "Bright",
    hint: "Clean and light: white ground, crisp roads, soft green",
    themes: ["light"],
    maker: "OpenFreeMap",
    url: "https://tiles.openfreemap.org/styles/bright",
  },
  {
    id: "positron",
    label: "Positron",
    hint: "Pale and quiet, almost no colour — the calmest of the light ones",
    themes: ["light"],
    maker: "CARTO",
    carto: "positron-gl-style",
  },
  {
    id: "liberty",
    label: "Liberty",
    hint: "The classic OpenStreetMap look: colour, detail, roads in yellow",
    themes: ["light"],
    maker: "OpenFreeMap",
    url: "https://tiles.openfreemap.org/styles/liberty",
  },
  {
    id: "gray",
    label: "Grey",
    hint: "Muted grey, no colour at all — lets the route do the talking",
    themes: ["light"],
    maker: "VersaTiles",
    url: "https://tiles.versatiles.org/assets/styles/gray/style.json",
  },

  /* ── dark ────────────────────────────────────────────────────────────── */
  {
    id: "dark-matter",
    label: "Dark Matter",
    hint: "Near-black with thin bright roads — the darkest of the set",
    themes: ["dark"],
    maker: "CARTO",
    carto: "dark-matter-gl-style",
  },
  {
    id: "osm-dark",
    label: "Dark",
    hint: "OpenStreetMap's own dark drawing: charcoal ground, soft colour",
    themes: ["dark"],
    maker: "OpenFreeMap",
    url: "https://tiles.openfreemap.org/styles/dark",
  },
  {
    id: "colorful-dark",
    label: "Colourful Dark",
    hint: "Dark, but keeps the greens and blues of the landscape",
    themes: ["dark"],
    maker: "VersaTiles",
    url: "https://tiles.versatiles.org/assets/styles/colorful-dark/style.json",
  },
  {
    id: "voyager",
    label: "Voyager",
    hint: "Warm and earthy — the one that works in both themes",
    themes: ["dark", "light"],
    maker: "CARTO",
    carto: "voyager-gl-style",
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
  return theme === "light" ? BY_ID.get("bright")! : BY_ID.get("osm-dark")!;
}

/** Whether the vector map should hand over to raster imagery for this look. */
export function isImageryLook(id: string | undefined, theme: Theme): boolean {
  return Boolean(lookById(id, theme).imagery);
}

/**
 * The style URL for a look, or `undefined` when there is nothing to fetch —
 * satellite imagery, or a CARTO drawing with no key to unlock it.
 */
export function styleUrlFor(look: MapLook, cartoKey: string): string | undefined {
  if (look.url) return look.url;
  if (!look.carto) return undefined;
  const key = cartoKey.trim();
  if (!key) return undefined;
  return `https://basemaps.cartocdn.com/gl/${look.carto}/style.json?key=${encodeURIComponent(key)}`;
}
