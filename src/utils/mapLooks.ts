/**
 * The map vendors the site can be drawn by, and the looks each of them offers.
 *
 * A look is a *style document* — a MapLibre JSON file that already carries its
 * tiles, fonts, sprites and attribution — so a look is a vendor plus that
 * vendor's own style name. Spelling matters: these are the vendors' ids, not
 * names of our own inventing.
 *
 * Every look here is a vector style, which matters: the map turns its place
 * names off by hiding the style's text layers, and that only works on a
 * drawing. A raster style would arrive with its names printed into the picture.
 *
 * Satellite is the exception the other way: a photograph of the ground rather
 * than a style with layers to hide, so it has no names to switch off in the
 * first place. No vendor here publishes imagery, so it stays Esri's and is
 * offered whatever vendor is chosen.
 *
 * Nothing here is a hard dependency on the network at import time; the key is
 * passed in, and a missing key simply yields no style URL (the map then falls
 * back to the plain base underneath, which needs no key at all).
 */

export type Theme = "light" | "dark";

export type MapVendorId = "geoapify" | "maptiler" | "stadia" | "mapbox";

export interface MapVendor {
  id: MapVendorId;
  /** What the dropdown says. */
  label: string;
  /** The key's name at this vendor, for labels and placeholders. */
  keyName: string;
  /** Where an owner gets one. */
  keyUrl: string;
  /** The free plan, in a line, so the cost is known before signing up. */
  freeNote: string;
  /** The vendor's credit line, after OpenStreetMap's own. */
  credit: string;
  /** One style document, given the style name and the site's key. */
  styleUrl: (style: string, key: string) => string;
}

export const MAP_VENDORS: MapVendor[] = [
  {
    id: "geoapify",
    label: "Geoapify",
    keyName: "Geoapify key",
    keyUrl: "https://myprojects.geoapify.com/",
    freeNote: "3,000 map credits a day free — the same key also looks places up for the site.",
    credit: "Geoapify",
    styleUrl: (style, key) =>
      `https://maps.geoapify.com/v1/styles/${style}/style.json?apiKey=${encodeURIComponent(key)}`,
  },
  {
    id: "maptiler",
    label: "MapTiler",
    keyName: "MapTiler key",
    keyUrl: "https://cloud.maptiler.com/account/keys/",
    freeNote: "Free for a non-commercial site, with a monthly map-view allowance.",
    credit: "MapTiler",
    styleUrl: (style, key) =>
      `https://api.maptiler.com/maps/${style}/style.json?key=${encodeURIComponent(key)}`,
  },
  {
    id: "stadia",
    label: "Stadia Maps",
    keyName: "Stadia key",
    keyUrl: "https://client.stadiamaps.com/dashboard/",
    freeNote: "Free non-commercial plan — a credit card is not needed for localhost.",
    credit: "Stadia Maps",
    styleUrl: (style, key) =>
      `https://tiles.stadiamaps.com/styles/${style}.json?api_key=${encodeURIComponent(key)}`,
  },
  {
    id: "mapbox",
    label: "Mapbox",
    keyName: "Access token",
    keyUrl: "https://account.mapbox.com/access-tokens/",
    freeNote: "50,000 map loads a month free, and the token is a public one by design.",
    credit: "Mapbox",
    styleUrl: (style, key) =>
      `https://api.mapbox.com/styles/v1/mapbox/${style}?access_token=${encodeURIComponent(key)}`,
  },
];

const VENDOR_BY_ID = new Map<string, MapVendor>(MAP_VENDORS.map((vendor) => [vendor.id, vendor]));

/** A vendor by id, with Geoapify as the stand-in for anything unknown. */
export function vendorById(id: string | undefined | null): MapVendor {
  return (id ? VENDOR_BY_ID.get(id) : undefined) ?? MAP_VENDORS[0];
}

export interface MapLook {
  id: string;
  label: string;
  /** One line in the dashboard: what this drawing feels like. */
  hint: string;
  /** Which theme the drawing was made for. Satellite suits both. */
  themes: Theme[];
  /** Who draws it, for the credit and for the panel. */
  maker: string;
  /** The vendor whose style document this is; absent on imagery. */
  vendor?: MapVendorId;
  /** The vendor's own style name. */
  style?: string;
  /** True for raster imagery, which has no style to draw. */
  imagery?: boolean;
}

interface LookSeed {
  style: string;
  label: string;
  hint: string;
}

/**
 * Geoapify's drawings. Their ids are the style names themselves and are kept
 * exactly as they were, because sites saved before other vendors existed have
 * these ids written into them.
 */
const GEOAPIFY_LIGHT: LookSeed[] = [
  { style: "osm-bright", label: "Bright", hint: "Clean and light: white ground, crisp roads, soft green" },
  { style: "osm-bright-grey", label: "Bright Grey", hint: "The bright drawing with the colour drained out of it" },
  { style: "osm-bright-smooth", label: "Bright Smooth", hint: "Bright, with the small detail smoothed away — calm at a glance" },
  { style: "klokantech-basic", label: "Basic", hint: "Flat and neutral: no relief, no texture, only what matters" },
  { style: "maptiler-3d", label: "Three Dimensions", hint: "Buildings lifted off the ground — the one with depth" },
  { style: "osm-liberty", label: "Liberty", hint: "The modern OpenStreetMap look — bolder roads, softer land" },
  { style: "positron", label: "Positron", hint: "Pale and quiet, almost no colour — the calmest of the light ones" },
  { style: "positron-blue", label: "Positron Blue", hint: "Positron with the water drawn in a decided blue" },
  { style: "positron-red", label: "Positron Red", hint: "Positron with the roads picked out in red" },
  { style: "toner", label: "Toner", hint: "Black ink on white paper — a printed map, not a screen" },
  { style: "toner-grey", label: "Toner Grey", hint: "Muted grey, no colour at all — lets the route do the talking" },
];

const GEOAPIFY_DARK: LookSeed[] = [
  { style: "dark-matter", label: "Dark Matter", hint: "Near-black with thin bright roads — the darkest of the set" },
  { style: "dark-matter-brown", label: "Dark Brown", hint: "Dark Matter warmed up: brown land, cream roads" },
  { style: "dark-matter-dark-grey", label: "Dark Grey", hint: "Grey-on-grey, flat and matter of fact" },
  { style: "dark-matter-dark-purple", label: "Dark Purple", hint: "Black land under a violet wash — the night-sky one" },
  { style: "dark-matter-purple-roads", label: "Purple Roads", hint: "Dark ground with the roads in violet — the most colourful dark" },
  { style: "dark-matter-yellow-roads", label: "Yellow Roads", hint: "Dark ground, gold roads — reads like a night highway sign" },
];

const MAPTILER_LIGHT: LookSeed[] = [
  { style: "streets-v2", label: "Streets", hint: "MapTiler's everyday drawing: warm land, clear roads" },
  { style: "basic-v2", label: "Basic", hint: "Flat and quiet — the least ink of their light set" },
  { style: "bright-v2", label: "Bright", hint: "Bright ground, confident colour, easy to read at a glance" },
  { style: "outdoor-v2", label: "Outdoor", hint: "Contours and tracks picked out — made for the mountains" },
  { style: "topo-v2", label: "Topographic", hint: "Relief first: the Himalaya reads as a shape, not a corridor" },
];

const MAPTILER_DARK: LookSeed[] = [
  { style: "streets-v2-dark", label: "Streets Dark", hint: "Their street drawing after dark — warm, not black" },
  { style: "basic-v2-dark", label: "Basic Dark", hint: "The quiet drawing at night: charcoal ground, thin roads" },
  { style: "dataviz-dark", label: "Data Dark", hint: "Deep navy with the colour kept for the roads alone" },
];

const STADIA_LIGHT: LookSeed[] = [
  { style: "alidade_smooth", label: "Alidade", hint: "Soft, modern and colour-light — the house drawing" },
  { style: "osm_bright", label: "OSM Bright", hint: "The familiar bright OpenStreetMap palette" },
  { style: "outdoors", label: "Outdoors", hint: "Trails, contours and green — a walking map" },
  { style: "stamen_toner_lite", label: "Toner Lite", hint: "Thin ink on paper, minus the heaviest blacks" },
];

const STADIA_DARK: LookSeed[] = [
  { style: "alidade_smooth_dark", label: "Alidade Dark", hint: "The Alidade drawing at night: slate ground, soft roads" },
  { style: "stamen_toner", label: "Toner", hint: "High-contrast ink, night version — a printed map after dark" },
];

const MAPBOX_LIGHT: LookSeed[] = [
  { style: "streets-v12", label: "Streets", hint: "Mapbox's everyday drawing: bold roads, busy detail" },
  { style: "light-v11", label: "Light", hint: "Barely-there greys, made to sit under other information" },
  { style: "outdoors-v12", label: "Outdoors", hint: "Contours and trails — the hiking one" },
];

const MAPBOX_DARK: LookSeed[] = [
  { style: "dark-v11", label: "Dark", hint: "Near-black ground with bright labels — the night one" },
];

/** Every look any vendor offers, in the order the dashboard groups them. */
export const MAP_LOOKS: MapLook[] = [
  ...buildLooks("geoapify", GEOAPIFY_LIGHT, "light"),
  ...buildLooks("geoapify", GEOAPIFY_DARK, "dark"),
  ...buildLooks("maptiler", MAPTILER_LIGHT, "light"),
  ...buildLooks("maptiler", MAPTILER_DARK, "dark"),
  ...buildLooks("stadia", STADIA_LIGHT, "light"),
  ...buildLooks("stadia", STADIA_DARK, "dark"),
  ...buildLooks("mapbox", MAPBOX_LIGHT, "light"),
  ...buildLooks("mapbox", MAPBOX_DARK, "dark"),
  /* Esri World Imagery — a photograph of the ground, not a drawing. */
  {
    id: "satellite",
    label: "Satellite",
    hint: "A photograph of the ground, no names on it — for the Himalaya",
    themes: ["dark", "light"],
    maker: "Esri",
    imagery: true,
  },
];

/**
 * A vendor's looks, both themes at once.
 *
 * Geoapify keeps its style names as ids so a site saved before other vendors
 * existed still points at the drawing it chose; anything newer is namespaced,
 * because `streets-v2` means one thing at MapTiler and another at Mapbox.
 */
function buildLooks(vendor: MapVendorId, seeds: LookSeed[], theme: Theme): MapLook[] {
  const maker = vendorById(vendor).label;
  return seeds.map((seed) => ({
    id: vendor === "geoapify" ? seed.style : `${vendor}-${seed.style}`,
    label: seed.label,
    hint: seed.hint,
    themes: [theme],
    maker,
    vendor,
    style: seed.style,
  }));
}

const BY_ID = new Map<string, MapLook>(MAP_LOOKS.map((look) => [look.id, look]));

/** The look a vendor draws by default for a theme. */
export function vendorDefault(vendor: MapVendorId, theme: Theme): MapLook {
  const preferred: Record<MapVendorId, Record<Theme, string>> = {
    geoapify: { light: "osm-bright", dark: "dark-matter" },
    maptiler: { light: "maptiler-streets-v2", dark: "maptiler-streets-v2-dark" },
    stadia: { light: "stadia-alidade_smooth", dark: "stadia-alidade_smooth_dark" },
    mapbox: { light: "mapbox-streets-v12", dark: "mapbox-dark-v11" },
  };
  const chosen = BY_ID.get(preferred[vendor][theme]);
  if (chosen) return chosen;
  return (
    MAP_LOOKS.find((look) => look.vendor === vendor && look.themes.includes(theme)) ??
    BY_ID.get("satellite")!
  );
}

/**
 * The looks a vendor offers for a theme, in the order the dashboard shows them.
 * Satellite is offered by every vendor, because it is nobody's style.
 */
export function looksFor(theme: Theme, vendor: MapVendorId): MapLook[] {
  return MAP_LOOKS.filter(
    (look) => look.themes.includes(theme) && (look.vendor === vendor || look.imagery),
  );
}

/**
 * A look by id, for a vendor.
 *
 * An id from another vendor — a site that has just switched vendor, or one
 * saved before that vendor existed — is not drawn: the vendor's own default for
 * the theme is used instead. Imagery belongs to no vendor and is always kept.
 */
export function lookById(id: string | undefined, theme: Theme, vendor: MapVendorId): MapLook {
  const found = id ? BY_ID.get(id) : undefined;
  if (found && (found.imagery || found.vendor === vendor)) return found;
  return vendorDefault(vendor, theme);
}

/**
 * The style URL for a look, or `undefined` when there is nothing to fetch —
 * satellite imagery (the tiles are the map), or a drawing with no key to unlock
 * it. Every vendor wants the key on the style document itself.
 */
export function styleUrlFor(look: MapLook, key: string): string | undefined {
  if (!look.style || !look.vendor) return undefined;
  const trimmed = key.trim();
  if (!trimmed) return undefined;
  return vendorById(look.vendor).styleUrl(look.style, trimmed);
}
