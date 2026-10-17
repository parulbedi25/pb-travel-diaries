/**
 * Google Maps URLs for the site.
 *
 * Everything here is keyless on purpose. There is no Google Cloud project, no
 * API key and no billing attached to this site, which rules out the Maps
 * JavaScript API and the Maps Embed API — both require a key.
 *
 * What is left is the endpoint Google itself hands out from Maps → Share →
 * "Embed a map": `maps.google.com/maps?...&output=embed`. It is free, has no
 * quota and needs no key. The price is that it is an iframe: we can set the
 * route and the view, but we cannot draw our own markers on top of it. That is
 * why the tracker keeps its own stop strip beside the map rather than plotting
 * points in the iframe.
 *
 * Important: pulling Google *tiles* into Leaflet
 * (`mt1.google.com/vt/lyrs=m&x=…`) would look identical and keep our overlays,
 * but Google forbids it — "You may not access map tiles or satellite imagery
 * through any mechanism besides Google Maps Platform". So we do not.
 */

import type { LiveStop } from "../store/siteContent";

const EMBED_BASE = "https://maps.google.com/maps";
const DIR_BASE = "https://www.google.com/maps/dir/";

type Coord = { lat: number; lng: number };

function coord(point: Coord): string {
  return `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
}

/**
 * A driving route through every stop, drawn by Google.
 *
 * Coordinates are used rather than place names so a village like Bharatgarh
 * cannot be mistaken for a same-named place elsewhere. The `+to:` chain is the
 * long-standing way to add stops to this endpoint; if Google ever stops
 * honouring it the map still degrades to a simple first-to-last route.
 */
export function routeEmbedUrl(stops: LiveStop[]): string {
  if (!stops.length) return "";
  if (stops.length === 1) return placeEmbedUrl(stops[0].lat, stops[0].lng, 13);
  const [first, ...rest] = stops;
  const chain = rest.map(coord).join("+to:");
  // iwloc=near keeps Google from opening an info balloon over the route.
  return `${EMBED_BASE}?saddr=${coord(first)}&daddr=${chain}&dirflg=d&hl=en&iwloc=near&output=embed`;
}

/**
 * A plain centred map: no marker, no route, no white panel.
 *
 * This is the one we can align things to, because we pick the centre and the
 * zoom ourselves — see utils/mercator.ts.
 */
export function viewEmbedUrl(lat: number, lng: number, zoom: number): string {
  return `${EMBED_BASE}?ll=${lat.toFixed(5)},${lng.toFixed(5)}&z=${Math.round(zoom)}&t=m&hl=en&output=embed`;
}

/** A single place, centred and pinned. */
export function placeEmbedUrl(lat: number, lng: number, zoom = 12): string {
  return `${EMBED_BASE}?q=${lat.toFixed(5)},${lng.toFixed(5)}&z=${zoom}&hl=en&output=embed`;
}

/**
 * The same route opened full-page in Google Maps, using the documented Maps
 * URLs scheme (no key, supports waypoints).
 */
export function routeLinkUrl(stops: LiveStop[]): string {
  if (!stops.length) return "https://www.google.com/maps";
  if (stops.length === 1) return placeLinkUrl(stops[0].lat, stops[0].lng);
  const origin = coord(stops[0]);
  const destination = coord(stops[stops.length - 1]);
  const waypoints = stops.slice(1, -1).map(coord).join("|");
  const url = `${DIR_BASE}?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
  return waypoints ? `${url}&waypoints=${waypoints}` : url;
}

/** A single place opened full-page in Google Maps. */
export function placeLinkUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(5)},${lng.toFixed(5)}`;
}
