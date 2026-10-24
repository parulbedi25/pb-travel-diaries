import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Nearby places, straight from Wikipedia.
 *
 * Two keyless calls, both with `origin=*` so a static file can make them:
 *
 *  1. GeoSearch — every article Wikipedia has geotagged within a radius of a
 *     point, nearest first. This is the "top places to visit" list: Wikipedia's
 *     own editors decide what is notable enough to have an article and a
 *     coordinate, which is a better guide than a paid listings API.
 *  2. PageImages + extracts for those pages — one batched call for the photo,
 *     the coordinates and the opening paragraph.
 *
 * Photos are Wikimedia's free files only: `pageimages` is asked with its
 * default licence setting, so nothing non-free is ever pulled in. Credit for
 * both the text and the pictures belongs to Wikipedia / Wikimedia Commons and
 * is shown on the page.
 *
 * Everything here is optional decoration on top of the tracker, so failing is
 * survivable: the caller gets an `error` and keeps its own view of the world.
 */

export interface NearbyPlace {
  pageid: number;
  title: string;
  lat: number;
  lng: number;
  /** Distance from the point that was searched, in kilometres. */
  distanceKm: number;
  extract: string;
  /** Wikimedia thumbnail URL, or "" when the article has no free image. */
  image: string;
  /** The article itself, for the "read more" link. */
  wikiUrl: string;
}

interface GeoSearchHit {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
  dist: number;
}

const API = "https://en.wikipedia.org/w/api.php";
const REQUEST_TIMEOUT_MS = 12_000;

async function wikiJson(params: Record<string, string>): Promise<unknown> {
  const url = `${API}?${new URLSearchParams({ format: "json", origin: "*", ...params })}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Wikipedia answered ${response.status}`);
  return response.json();
}

interface PageImagesResponse {
  query?: {
    pages?: Record<
      string,
      {
        pageid?: number;
        title?: string;
        thumbnail?: { source?: string };
        coordinates?: { lat: number; lon: number }[];
        extract?: string;
      }
    >;
  };
}

/**
 * One page's worth of detail, in the order the caller asked for it.
 * `pages` comes back keyed by pageid and in no guaranteed order, so the hits
 * are re-matched by id rather than by position.
 */
async function detailsFor(hits: GeoSearchHit[]): Promise<NearbyPlace[]> {
  if (!hits.length) return [];
  const raw = (await wikiJson({
    action: "query",
    prop: "pageimages|coordinates|extracts",
    piprop: "thumbnail",
    pithumbsize: "640",
    exintro: "1",
    explaintext: "1",
    exchars: "260",
    titles: hits.map((hit) => hit.title).join("|"),
  })) as PageImagesResponse;

  const pages = Object.values(raw.query?.pages ?? {});
  const byId = new Map<number, (typeof pages)[number]>();
  const byTitle = new Map<string, (typeof pages)[number]>();
  for (const page of pages) {
    if (typeof page.pageid === "number") byId.set(page.pageid, page);
    if (page.title) byTitle.set(page.title, page);
  }

  return hits.map((hit) => {
    const page = byId.get(hit.pageid) ?? byTitle.get(hit.title);
    return {
      pageid: hit.pageid,
      title: page?.title ?? hit.title,
      lat: hit.lat,
      lng: hit.lon,
      distanceKm: hit.dist / 1000,
      extract: (page?.extract ?? "").trim(),
      image: page?.thumbnail?.source ?? "",
      wikiUrl: `https://en.wikipedia.org/?curid=${hit.pageid}`,
    };
  });
}

/** GeoSearch only ever returns articles, but a category or a list is not a place. */
const looksLikeAPlace = (hit: GeoSearchHit): boolean =>
  Boolean(hit.title) && !hit.title.startsWith("List of ") && !hit.title.startsWith("Category:");

export interface NearbyQuery {
  lat: number;
  lng: number;
  /** Search radius in kilometres. */
  radiusKm: number;
  /** How many places to ask for. */
  count: number;
}

export function useNearbyPlaces({ lat, lng, radiusKm, count }: NearbyQuery) {
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  // The last query that worked, so a re-render with the same numbers is free.
  const cacheKey = useRef("");
  const requestId = useRef(0);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const radius = Math.max(1, Math.min(50, Math.round(radiusKm) || 10));
    const limit = Math.max(5, Math.min(10, Math.round(count) || 8));
    const key = `${lat.toFixed(3)},${lng.toFixed(3)},${radius},${limit}#${attempt}`;
    if (key === cacheKey.current) return;
    cacheKey.current = key;

    const mine = ++requestId.current;
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const raw = (await wikiJson({
          action: "query",
          list: "geosearch",
          gscoord: `${lat}|${lng}`,
          gsradius: String(radius * 1000),
          gslimit: String(limit),
        })) as { query?: { geosearch?: GeoSearchHit[] } };

        const hits = (raw.query?.geosearch ?? []).filter(looksLikeAPlace);
        const withDetails = await detailsFor(hits);
        if (cancelled || mine !== requestId.current) return;
        // An empty result is not a failure: it means Wikipedia has nothing
        // geotagged this far out. The page says so in its own words.
        setPlaces(withDetails);
      } catch {
        if (cancelled || mine !== requestId.current) return;
        setPlaces([]);
        setError(
          "Could not reach Wikipedia. The nearby list needs an internet connection — the live map keeps working without it.",
        );
      } finally {
        if (!cancelled && mine === requestId.current) setLoading(false);
      }
    };

    void run();
    // The responses are dropped by the `mine` check instead of being aborted:
    // a fetch already in flight costs nothing to ignore, and one fewer moving
    // part is one fewer way for the page to end up loading forever.
    return () => {
      cancelled = true;
    };
  }, [lat, lng, radiusKm, count, attempt]);

  return { places, loading, error, reload };
}
