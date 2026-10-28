/**
 * Reading a route out of a shared map link.
 *
 * A ride is usually planned somewhere else first — Google Maps on the phone, a
 * Bing route on the laptop — and what comes back is a link. Asking the operator
 * to retype the start and the destination as coordinates is the kind of step
 * that gets a route wrong by a kilometre, so the link is read instead, and the
 * service it came from is read with it: a Google link says Google, a Bing link
 * says Bing.
 *
 * Every service spells a route differently, and none of them documents its
 * parameters as a contract, so this is deliberately forgiving:
 *
 *  - Google: `/maps/dir/<from>/<to>/…`, the `?api=1&origin=&destination=`
 *    form, the older `?saddr=&daddr=`, and the `/maps/place/<name>/@lat,lng`
 *    links that come out of a single dropped pin.
 *  - Bing: `?rtp=pos.31.369_76.3729~adr.Chandigarh`, and the `?cp=lat~lng`
 *    centre of a plain map link.
 *  - Apple: `?saddr=&daddr=`, and `?q=`/`?ll=` for a single point.
 *  - OpenStreetMap: `?route=lat,lng;lat,lng` and `#map=zoom/lat/lng`.
 *  - Anything else that carries a `lat,lng` pair — `?q=`, `?ll=`, `?center=`,
 *    `@lat,lng`, `geo:` URIs — is read as a point rather than being refused.
 *
 * Two kinds of stop come out of that. A segment can be a coordinate pair, or it
 * can be a place name, and names still need looking up — that happens at import
 * time (see RouteStopsEditor), not here. This file stays pure and synchronous so
 * the dashboard can show what it found while the link is still being typed.
 *
 * Short share links (`maps.app.goo.gl/…`) are a redirect, and a page cannot read
 * a cross-origin one. They come back flagged `shortLink`, and the dashboard asks
 * the server to expand them (see server/routes/maps.js) before parsing the
 * result here — so a link from the phone works as well as one from a laptop.
 *
 * Two details decide whether a shared route arrives intact, and both are easy
 * to get wrong:
 *
 *  - **The last stop is not a duplicate.** Google writes a loop as
 *    `…/dir/Nangal/…/Nangal/…`, so de-duplicating by name throws away the ride
 *    home. Only *adjacent* repeats are collapsed here.
 *  - **The camera is not a stop.** A shared directions link ends with the map
 *    viewpoint — `…/Nubra+Valley/@34.62,76.75,9.08z` — which is where the map
 *    was looking, not somewhere the rider stops. Read as a stop it became a
 *    destination named "@34.6293181,76.7557312,9.08z", which no geocoder can
 *    place, so the import half-failed on a route that was otherwise perfect.
 *  - **The coordinates are in the link.** A shared directions URL carries the
 *    exact pin of every stop in its `data=…` blob (`!8m2!3d31.3832213!4d76.3765753`),
 *    in the same order as the names in the path, so they are paired up instead
 *    of leaving every stop to a name lookup — which is how a misspelt stop
 *    ("Leh laddakh") used to fail the whole import.
 *  - **There are two spellings of a pin.** A stop Google knows by place id is
 *    written `!1s0x391acc…!2m2!1d76.3765753!2d31.3832213` — longitude first,
 *    latitude second — while a stop it only knows by name uses
 *    `!3d<lat>!4d<lng>`. Reading only the second spelling meant a seven-stop
 *    directions link arrived with no coordinates at all, and every stop then
 *    depended on a geocoder that does not know "Leh laddakh".
 *  - **The link arrives wrapped.** Copied out of a chat or a notes app it can
 *    come as `[text](https://…)`, with `&amp;` for `&`, or inside `<>`. None of
 *    that is part of the address, so it is peeled off before anything else.
 *  - **Google's own state is not a stop.** A shared directions URL carries
 *    `am=t` (travel mode) beside the camera. Read as a place it becomes an
 *    unplaceable stop called "am=t", and because one unplaceable stop used to
 *    fail the whole import, pasting a perfectly good link did nothing at all.
 */

import { shortPlaceName } from "./placeNames";

/** Which service the link came from — and what the dashboard selects. */
export type MapLinkSource = "google" | "bing" | "apple" | "openstreetmap" | "other";

export const SOURCE_LABELS: Record<MapLinkSource, string> = {
  google: "Google Maps",
  bing: "Bing Maps",
  apple: "Apple Maps",
  openstreetmap: "OpenStreetMap",
  other: "Other maps",
};

/** One endpoint of the route: a name, a coordinate pair, or both. */
export interface RoutePoint {
  /** Named by the link itself, when it names one. */
  label?: string;
  lat?: number;
  lng?: number;
}

export interface ParsedRouteLink {
  /** True when there is at least one point to import. */
  ok: boolean;
  /** A short share link: it needs expanding server-side before it can be read. */
  shortLink?: boolean;
  source: MapLinkSource;
  /** A start and a destination, a single pin, or nothing readable. */
  kind: "route" | "place" | "none";
  points: RoutePoint[];
  /** Worth showing the operator: what was found, or what blocked it. */
  message: string;
}

const none = (source: MapLinkSource, message: string): ParsedRouteLink => ({
  ok: false,
  source,
  kind: "none",
  points: [],
  message,
});

/** `%E0%A4%…` → text, and the `+` a map link uses for a space. */
const decode = (value: string): string => {
  try {
    return decodeURIComponent(value.replace(/\+/g, " ")).trim();
  } catch {
    return value.trim();
  }
};

const inRange = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * A coordinate pair at the start of a string — `31.369,76.3729`, and the
 * `31.369_76.3729` / `31.369~76.3729` spellings Bing and some others use.
 * A third number is an altitude and is dropped.
 */
export function readCoords(text: string): { lat: number; lng: number } | null {
  const match = text
    .trim()
    // Google's camera reads `@31.6,76.7,12z`: the `@` is part of the URL, and
    // the third number is the zoom, so neither should stop a pair being read.
    .replace(/^@/, "")
    .match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,~_]\s*(-?\d{1,3}(?:\.\d+)?)(?:\s*[,~_]\s*-?\d+(?:\.\d+)?[a-z]?)?$/i);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return inRange(lat, lng) ? { lat, lng } : null;
}

/**
 * A name, unless it is really a coordinate pair — or the camera.
 *
 * A shared directions link carries the map's viewpoint after the stops, as
 * `/dir/from/to/@34.62,76.75,9.08z`. That `@` segment is where the map was
 * looking, not somewhere the rider stops, and it used to be taken as the
 * destination: the import then tried to look up a place called
 * "@34.6293181,76.7557312,9.08z", failed, and left the route half-added.
 */
function pointFromSegment(segment: string): RoutePoint | null {
  const text = decode(segment);
  if (!text) return null;
  if (text.startsWith("@")) return null;
  const coords = readCoords(text);
  if (coords) return coords;
  // Google writes its own state into the path — `data=!4m2!4m1!3e0`, but also
  // `am=t` for the travel mode. That is not a place, and must never become a
  // stop called "am=t": it cannot be placed, and one unplaceable stop is enough
  // to refuse the whole route, which is how a perfectly good seven-stop link
  // ended up doing nothing when it was imported. Anything shaped `key=value`
  // is URL state, not somewhere a rider stops.
  if (/^(data=|!|\?)/.test(text)) return null;
  if (/^[a-z_][a-z0-9_]*=/i.test(text)) return null;
  return { label: text.replace(/\s+/g, " ") };
}

/** Which service served the link — by host, because that is what it says. */
export function sourceOfHost(host: string): MapLinkSource {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (h.endsWith("google.com") || h.endsWith("google.co.in") || h === "goo.gl") return "google";
  if (h.endsWith("bing.com")) return "bing";
  if (h.endsWith("apple.com")) return "apple";
  if (h.endsWith("openstreetmap.org")) return "openstreetmap";
  return "other";
}

/** The `30.7333,76.7794` inside `…/@30.7333,76.7794,12z` or `…!3d30.73!4d76.77`. */
function coordsInBody(body: string): { lat: number; lng: number } | null {
  const at = body.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) {
    const coords = { lat: Number(at[1]), lng: Number(at[2]) };
    if (inRange(coords.lat, coords.lng)) return coords;
  }
  const md = body.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (md) {
    const coords = { lat: Number(md[1]), lng: Number(md[2]) };
    if (inRange(coords.lat, coords.lng)) return coords;
  }
  return null;
}

/**
 * A value that may be a pair, a pair with a name beside it (`31.369,76.3729
 * (Nangal)`, which geo: and Google's `q=` both use), or just a name.
 */
function pointFromText(text: string): RoutePoint | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const exact = readCoords(trimmed);
  if (exact) return exact;
  const leading = trimmed.match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (leading) {
    const lat = Number(leading[1]);
    const lng = Number(leading[2]);
    if (inRange(lat, lng)) {
      const label = trimmed.slice(leading[0].length).replace(/^[\s()]+|[\s()]+$/g, "");
      return label ? { lat, lng, label } : { lat, lng };
    }
  }
  return { label: trimmed };
}

/** `q=`, `query=`, `ll=`, `center=`, `where1=`, `address=` — the one-pointer parameters. */
function pointParam(params: URLSearchParams, names: string[]): RoutePoint | null {
  for (const name of names) {
    const raw = params.get(name);
    if (!raw) continue;
    const point = pointFromText(decode(raw));
    if (point) return point;
  }
  return null;
}

/**
 * Drop empty ends, and collapse only repeats that sit next to each other.
 *
 * A round trip ends where it started — `Nangal → … → Nangal` — and deleting the
 * second Nangal silently turns the ride into a one-way trip. Two identical
 * points *in a row* are the only ones that are certainly a mistake.
 */
function tidy(points: RoutePoint[]): RoutePoint[] {
  const kept: RoutePoint[] = [];
  for (const point of points) {
    if (!point.label && point.lat === undefined) continue;
    const previous = kept[kept.length - 1];
    const key = (p: RoutePoint) => (p.lat !== undefined && p.lng !== undefined
      ? `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`
      : `label:${(p.label ?? "").toLowerCase()}`);
    if (previous && key(previous) === key(point)) continue;
    kept.push(point);
  }
  return kept;
}

/**
 * The exact pin of each stop, out of Google's `data=` blob.
 *
 * The blob is a protobuf written as `!`-separated tags, and Google spells the
 * same pin two ways:
 *
 *  - `!3d<lat>!4d<lng>` — the name-only form (`!8m2!3d31.3832213!4d76.3765753`).
 *  - `!1d<lng>!2d<lat>` — the place-id form, longitude first
 *    (`!1s0x391acc…!2m2!1d76.3765753!2d31.3832213`).
 *
 * Both are read, one pair per stop, in route order. Anything else in there
 * (`!1s`, `!4m`, `!3e`, `!4b1`) is skipped, and a latitude/longitude that is
 * not on Earth is dropped rather than handed to the map.
 */
export function coordsFromDataBlob(text: string): { lat: number; lng: number }[] {
  const pairs: { lat: number; lng: number }[] = [];
  // Tag and number, in the order Google writes them.
  const pattern = /!([1-4])d(-?\d+(?:\.\d+)?)/g;
  const tokens: { kind: string; value: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) tokens.push({ kind: match[1], value: Number(match[2]) });

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const first = tokens[i];
    const second = tokens[i + 1];
    if (first.kind === "3" && second.kind === "4") {
      // `!3d<lat>!4d<lng>`
      if (inRange(first.value, second.value)) pairs.push({ lat: first.value, lng: second.value });
      i += 1;
    } else if (first.kind === "1" && second.kind === "2") {
      // `!1d<lng>!2d<lat>` — longitude comes first.
      if (inRange(second.value, first.value)) pairs.push({ lat: second.value, lng: first.value });
      i += 1;
    }
  }
  return pairs;
}

function parsed(source: MapLinkSource, points: RoutePoint[]): ParsedRouteLink {
  const kept = tidy(points);
  if (!kept.length) return none(source, "That link has no start or destination in it that this can read.");
  const kind = kept.length >= 2 ? "route" : "place";
  const message = kind === "route"
    ? `${SOURCE_LABELS[source]} route · ${kept.length} points, start to destination.`
    : `${SOURCE_LABELS[source]} pin · one point. A directions link gives you both ends.`;
  return { ok: true, source, kind, points: kept, message };
}

/** Google's `/maps/dir/from/to/…`, and its query-string twins. */
function parseGoogle(url: URL): ParsedRouteLink {
  const params = url.searchParams;
  const path = url.pathname;

  // `?api=1&origin=…&destination=…` and the older `?saddr=…&daddr=…`.
  const queryPoints: RoutePoint[] = [];
  const origin = params.get("origin") ?? params.get("saddr");
  const destination = params.get("destination") ?? params.get("daddr");
  if (origin) {
    const point = pointFromSegment(origin);
    if (point) queryPoints.push(point);
  }
  const waypoints = params.get("waypoints");
  if (waypoints) {
    for (const piece of waypoints.split("|")) {
      const point = pointFromSegment(piece);
      if (point) queryPoints.push(point);
    }
  }
  if (destination) {
    const point = pointFromSegment(destination);
    if (point) queryPoints.push(point);
  }
  if (queryPoints.length) return parsed("google", queryPoints);

  // The share sheet's form: /maps/dir/<from>/<to>/<…>/data=!4m…
  const segments = path.split("/").filter(Boolean).map(decode);
  const dirAt = segments.findIndex((segment) => segment === "dir" || segment === "dir/");
  if (dirAt >= 0) {
    // `pointFromSegment` drops the `/@lat,lng,zoom` camera segment, so what is
    // left is the stops themselves, in route order.
    const points = segments
      .slice(dirAt + 1)
      .map(pointFromSegment)
      .filter((point): point is RoutePoint => Boolean(point));
    // The names are in the path and the pins are in the data blob, in the same
    // order — so a named stop keeps its name and gains its exact coordinate,
    // and nothing needs looking up.
    const pins = coordsFromDataBlob(url.href);
    if (points.length >= 2) {
      if (pins.length === points.length) {
        return parsed(
          "google",
          points.map((point, index) => ({ ...point, lat: pins[index].lat, lng: pins[index].lng })),
        );
      }
      // A pin the name already carries wins; the rest stay for a lookup.
      const merged = points.map((point) => point);
      for (let index = 0; index < Math.min(pins.length, merged.length); index += 1) {
        if (merged[index].lat === undefined) merged[index] = { ...merged[index], ...pins[index] };
      }
      return parsed("google", merged);
    }
  }

  // A single pin: /maps/place/<name>/@lat,lng,12z
  const placeAt = segments.findIndex((segment) => segment === "place");
  const bodyCoords = coordsInBody(url.href);
  if (placeAt >= 0) {
    const name = segments[placeAt + 1] ?? "";
    const point: RoutePoint = bodyCoords ? { ...bodyCoords } : {};
    if (name && !readCoords(name)) point.label = name;
    if (point.lat !== undefined || point.label) return parsed("google", [point]);
  }

  const single = pointParam(params, ["query", "q", "destination", "daddr", "ll", "center"]);
  if (single) return parsed("google", [single]);
  if (bodyCoords) return parsed("google", [{ ...bodyCoords, label: undefined }]);
  return none("google", "That Google link has no route or pin in it this can read.");
}

/** Bing's `?rtp=pos.lat_lng~adr.Name`, and the `?cp=lat~lng` centre. */
function parseBing(url: URL): ParsedRouteLink {
  const params = url.searchParams;
  const rtp = params.get("rtp") ?? params.get("RTP");
  if (rtp) {
    const points = rtp
      .split("~")
      .map((piece) => {
        const text = decode(piece).replace(/^(pos|adr|wp)\./i, "");
        if (!text) return null;
        const coords = readCoords(text);
        if (coords) return coords as RoutePoint;
        return { label: text } as RoutePoint;
      })
      .filter((point): point is RoutePoint => Boolean(point));
    if (points.length) return parsed("bing", points);
  }

  const centre = params.get("cp");
  if (centre) {
    const text = decode(centre);
    // Bing separates the pair with "~": `cp=31.369~76.3729`.
    const coords = readCoords(text) ?? readCoords(text.replace(/~/g, ","));
    if (coords) return parsed("bing", [coords]);
  }

  const single = pointParam(params, ["where1", "q", "destination", "daddr"]);
  if (single) return parsed("bing", [single]);
  return none("bing", "That Bing link has no route or pin in it this can read.");
}

/** Apple's `saddr`/`daddr`, and `q`/`ll` for the single-pin form. */
function parseApple(url: URL): ParsedRouteLink {
  const params = url.searchParams;
  const points: RoutePoint[] = [];
  for (const name of ["saddr", "daddr"]) {
    const raw = params.get(name);
    if (!raw) continue;
    const point = pointFromSegment(raw);
    if (point) points.push(point);
  }
  if (points.length) return parsed("apple", points);

  const single = pointParam(params, ["q", "ll", "address", "near"]);
  const coords = readCoords(decode(params.get("ll") ?? ""));
  if (!single) return coords
    ? parsed("apple", [coords])
    : none("apple", "That Apple Maps link has no route or pin in it this can read.");
  // `?ll=…&q=Nangal` — the pin's position and its name arrive separately.
  if (single.label && single.lat === undefined && coords) return parsed("apple", [{ ...coords, label: single.label }]);
  return parsed("apple", [single]);
}

/** OpenStreetMap's `?route=a;b` and its `#map=zoom/lat/lng`. */
function parseOpenStreetMap(url: URL): ParsedRouteLink {
  const params = url.searchParams;
  const route = params.get("route");
  if (route) {
    const points = decode(route)
      .split(";")
      .map((piece) => {
        const coords = readCoords(piece);
        return coords ? (coords as RoutePoint) : ({ label: piece.trim() } as RoutePoint);
      })
      .filter((point) => point.lat !== undefined || point.label);
    if (points.length) return parsed("openstreetmap", points);
  }

  const hash = url.hash.replace(/^#/, "");
  const mapHash = hash.match(/^map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
  if (mapHash) {
    const lat = Number(mapHash[1]);
    const lng = Number(mapHash[2]);
    if (inRange(lat, lng)) return parsed("openstreetmap", [{ lat, lng }]);
  }

  const lat = Number(params.get("mlat"));
  const lng = Number(params.get("mlon"));
  if (inRange(lat, lng)) return parsed("openstreetmap", [{ lat, lng }]);

  const single = pointParam(params, ["query", "q", "where"]);
  if (single) return parsed("openstreetmap", [single]);
  return none("openstreetmap", "That OpenStreetMap link has no route or pin in it this can read.");
}

/** `geo:31.369,76.3729` and the `geo:0,0?q=…` form Android shares. */
function parseGeoUri(raw: string): ParsedRouteLink {
  const body = raw.slice(4);
  const [path, query = ""] = body.split("?");
  const coords = readCoords(path.split(";")[0] ?? "");
  const params = new URLSearchParams(query);
  const q = params.get("q");
  if (coords && (coords.lat !== 0 || coords.lng !== 0)) {
    const label = q ? decode(q).replace(/^[\s()]+|[\s()]+$/g, "") : undefined;
    return parsed("other", [label ? { ...coords, label } : coords]);
  }
  if (q) {
    const point = pointFromText(decode(q));
    if (point) return parsed("other", [point]);
  }
  return none("other", "That geo: link has no readable coordinate in it.");
}

/**
 * Everything that is not one of the four names: read a coordinate pair out of
 * the query, the body or a `geo:` URI, and take a bare name if there is one.
 */
function parseOther(url: URL, raw: string): ParsedRouteLink {
  const params = url.searchParams;
  const points: RoutePoint[] = [];
  for (const name of ["saddr", "origin", "from", "addr", "daddr", "destination", "to"]) {
    const value = params.get(name);
    if (!value) continue;
    const point = pointFromSegment(value);
    if (point) points.push(point);
  }
  if (points.length) return parsed("other", points);

  const single = pointParam(params, ["q", "query", "ll", "center", "where1", "address", "location"]);
  if (single) return parsed("other", [single]);

  const bodyCoords = coordsInBody(raw);
  if (bodyCoords) return parsed("other", [bodyCoords]);

  // Last resort: a bare pair anywhere in the URL a human pasted.
  const anywhere = raw.match(/[?&/=](-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})/);
  if (anywhere) {
    const lat = Number(anywhere[1]);
    const lng = Number(anywhere[2]);
    if (inRange(lat, lng)) return parsed("other", [{ lat, lng }]);
  }
  return none("other", "No start or destination could be read from that link.");
}

/**
 * The address, out of whatever the clipboard held.
 *
 * A link pasted from a chat, a notes app or a web page is often not a bare
 * address: markdown wraps it in `[label](…)`, HTML escapes the ampersands as
 * `&amp;`, mail clients add angle brackets, and a sentence can end up around
 * it. None of that belongs to the URL, so it is removed here instead of making
 * every parser below defend itself.
 */
export function normalisePasted(raw: string): string {
  let text = (raw ?? "").trim();
  if (!text) return "";

  // [label](url) and ![alt](url) — take the address, drop the label.
  const markdown = text.match(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?\s*\)/);
  if (markdown) text = markdown[1];
  else {
    // A bare address inside prose, in <> or on its own.
    const bare = text.match(/<?((?:https?:\/\/|geo:)[^\s<>"']+)>?/i);
    if (bare) text = bare[1];
  }

  // `&amp;` is an escaped ampersand, `&#38;` the numeric spelling of the same.
  text = text.replace(/&amp;/gi, "&").replace(/&#0*38;/g, "&").replace(/&lt;|&gt;/gi, "");

  // Punctuation that ended the sentence rather than the URL, and a trailing
  // bracket left over from the markdown wrapper.
  text = text.replace(/[.,;:!?]+$/, "");
  while (text.endsWith(")") && (text.match(/\(/g) ?? []).length < (text.match(/\)/g) ?? []).length) {
    text = text.slice(0, -1);
  }
  return text.trim();
}

/**
 * Read a pasted link. Never throws: a link it cannot make sense of comes back
 * with `ok: false` and a sentence saying why, so the dashboard can say it out
 * loud instead of silently doing nothing.
 */
export function parseRouteLink(raw: string): ParsedRouteLink {
  const text = normalisePasted(raw);
  if (!text) return none("other", "");

  if (/^geo:/i.test(text)) return parseGeoUri(text);

  // A shortened share link is a redirect, and a page cannot read a cross-origin
  // one. It is flagged rather than refused: the dashboard expands it through
  // the server and parses the result with the code below.
  if (/(^|\/\/)(maps\.app\.goo\.gl|goo\.gl|g\.co)\//i.test(`${text}/`)) {
    return {
      ok: false,
      shortLink: true,
      source: "google",
      kind: "none",
      points: [],
      message: "Short link — expanding it to read the route…",
    };
  }

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return none("other", "That does not look like a link. Copy the whole address, starting with https://");
  }

  const source = sourceOfHost(url.hostname);
  if (source === "google") return parseGoogle(url);
  if (source === "bing") return parseBing(url);
  if (source === "apple") return parseApple(url);
  if (source === "openstreetmap") return parseOpenStreetMap(url);
  return parseOther(url, text);
}

/**
 * One line describing a point, for the preview list before anything is added.
 * The first is the start and the last is the destination, which is the same
 * rule the tracker colours its pins by.
 */
export function describePoint(point: RoutePoint, index: number, total: number): string {
  const role = index === 0 ? "Start" : index === total - 1 ? "Destination" : "On the way";
  const coords = point.lat !== undefined && point.lng !== undefined
    ? `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`
    : "looked up on import";
  // The readable name, not the whole postal address: the preview should show
  // what the tracker will say, not a plus code and a postcode.
  return point.label
    ? `${role} · ${shortPlaceName(point.label)} · ${coords}`
    : `${role} · ${coords}`;
}
