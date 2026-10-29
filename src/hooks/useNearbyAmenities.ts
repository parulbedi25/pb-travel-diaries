/**
 * What a rider needs around a stop: a bed, a meal, fuel, a workshop, a hospital.
 *
 * All of it comes from Geoapify, asked by the server (`/api/nearby`) so the key
 * stays out of the page and the answer can be cached: the browser sends the
 * stop and the tab, and gets back a list already sorted and clipped to the
 * town. There is no second provider behind it and no direct browser query —
 * asking a tile host's search API from the page would put the key in the URL
 * and lose the cache, and one unanswered question is a tab that looks broken.
 *
 * `places` is a different source on purpose (Wikivoyage, in the page itself):
 * what is worth visit is an editorial question, not a search one.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

export type AmenityGroup = "stays" | "food" | "essentials";
export type AmenityKind = "stay" | "eat" | "fuel" | "hospital" | "service";

export interface Amenity {
  /** Stable across reloads, so React keys and pins do not shuffle. */
  id: string;
  kind: AmenityKind;
  title: string;
  lat: number;
  lng: number;
  /** Straight-line kilometres from the place being searched around. */
  distanceKm: number;
  /** One line of what it is: "Guest house · budget", "Fuel · Indian Oil". */
  detail: string;
  /** Royal Enfield's own name on the sign, or a workshop that serves them. */
  royalEnfield?: boolean;
  /** Cheaper kinds of bed: guest houses, hostels, motels. */
  budget?: boolean;
  opening?: string;
  /** Star class or rating, when the record carries one. */
  rating?: number;
}

/** Which service answered, so the page can say where its list came from. */
export type AmenitySource = "geoapify" | "none" | "";

/**
 * Why an empty tab is empty.
 *
 * `no-area` is the important one: the town's boundary could not be looked up,
 * so nothing was searched rather than the next town being searched instead.
 */
export type AmenityReason = "no-area" | "";

/**
 * The ground a list covers.
 *
 * The town's own boundary, looked up server-side from the stop's name — so
 * "Leh" means the whole of Leh, however far the edges are. There is no radius
 * behind it: a circle around the pin is what used to put Nangal's hotels in
 * Anandpur's tab.
 */
export interface AmenityArea {
  label: string;
  spanKm: number;
  city: boolean;
}

/**
 * Nearest first, in one order for both halves of the page.
 *
 * The list is rendered in this order and the pins are laid out in it too, so
 * the first row is always the closest place and the map reads the same way.
 * The workshops that carry the rider's own marque go to the top of the service
 * entries, because that is the one a Royal Enfield can actually be fixed at.
 */
export function rankAmenities(items: readonly Amenity[], group: AmenityGroup): Amenity[] {
  const belongs = (item: Amenity) =>
    group === "stays"
      ? item.kind === "stay"
      : group === "food"
        ? item.kind === "eat"
        : item.kind !== "stay" && item.kind !== "eat";
  const sorted = [...items].filter(belongs).sort((a, b) => {
    // Only the service tab reorders: a marque workshop first, then distance.
    if (group === "essentials" && Boolean(a.royalEnfield) !== Boolean(b.royalEnfield)) {
      return a.royalEnfield ? -1 : 1;
    }
    return a.distanceKm - b.distanceKm;
  });
  // The same place listed twice — a building and its own front door — is one
  // place, and the nearer of the two is the one kept.
  const seen = new Set<string>();
  return sorted.filter((item) => {
    const key = `${item.title.toLowerCase()}@${item.lat.toFixed(3)},${item.lng.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface AmenityQuery {
  lat: number;
  lng: number;
  /** The stop's name: what makes the search the whole town, not a circle. */
  place?: string;
  group: AmenityGroup;
  /** False until the tab that needs it is opened, so nothing is asked for twice over. */
  enabled?: boolean;
}

export interface AmenityResult {
  items: Amenity[];
  loading: boolean;
  error: string;
  /** What was tried, when nothing came back. */
  tried: string[];
  /** Which service answered, or "" while nothing has. */
  source: AmenitySource;
  /** False until the first attempt has finished — the tab waits for this. */
  settled: boolean;
  /** The area the list covers, once an answer has arrived. */
  area: AmenityArea | null;
  /** Why a tab has nothing, when the reason is not "there is nothing". */
  reason: AmenityReason;
  /** What to call the wait on the tab. */
  loadingSource: string;
  reload: () => void;
}

export function useNearbyAmenities({
  lat,
  lng,
  place = "",
  group,
  enabled = true,
}: AmenityQuery): AmenityResult {
  const [items, setItems] = useState<Amenity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState<AmenitySource>("");
  const [tried, setTried] = useState<string[]>([]);
  const [settled, setSettled] = useState(false);
  const [area, setArea] = useState<AmenityArea | null>(null);
  const [reason, setReason] = useState<AmenityReason>("");
  const [attempt, setAttempt] = useState(0);
  const cache = useRef(new Map<string, Amenity[]>());
  const requestId = useRef(0);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const key = `${group}:${lat.toFixed(3)},${lng.toFixed(3)}:${place.toLowerCase()}`;

    if (attempt === 0) {
      const cached = cache.current.get(key);
      if (cached) {
        setItems(cached);
        setLoading(false);
        setError("");
        return;
      }
    }

    const mine = ++requestId.current;
    let cancelled = false;
    setLoading(true);
    setError("");

    const run = async () => {
      // A hard cap on top of the server's own: whatever happens, the tab stops
      // waiting and says something rather than spinning.
      const capped = <T,>(work: Promise<T>, ms: number): Promise<T | null> =>
        Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

      try {
        const answer = await capped(
          api
            .get<{
              items: Amenity[];
              source: AmenitySource;
              tried?: string[];
              area?: AmenityArea | null;
              reason?: AmenityReason;
            }>(
              `/api/nearby?kind=${group}&lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}${
                place ? `&place=${encodeURIComponent(place)}` : ""
              }`,
            )
            .catch(() => null),
          12_000,
        );
        if (cancelled || mine !== requestId.current) return;

        if (!answer) {
          setItems([]);
          setSource("none");
          setError("Could not look this up just now. Try again in a minute.");
          return;
        }

        setTried(Array.isArray(answer.tried) ? answer.tried : []);
        if (answer.area) setArea(answer.area);
        setReason(answer.reason ?? "");
        const ranked = rankAmenities(answer.items ?? [], group).slice(0, 40);
        cache.current.set(key, ranked);
        setItems(ranked);
        setSource(answer.source);
        if (!ranked.length && !answer.reason) {
          setError(
            group === "stays"
              ? "No beds came back for this town just now. Try a bigger town, reload, or open the Google Maps search below."
              : "No fuel, workshops or hospitals came back for this town just now. Try a bigger town, reload, or open the Google Maps search below.",
          );
        }
      } catch {
        if (cancelled || mine !== requestId.current) return;
        setItems([]);
        setSource("none");
        setError("Could not look this up just now. Try again in a minute.");
      } finally {
        if (!cancelled && mine === requestId.current) {
          setLoading(false);
          setSettled(true);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [lat, lng, place, group, enabled, attempt]);

  return {
    items,
    loading,
    error,
    source,
    tried,
    settled,
    area,
    reason,
    loadingSource: "Geoapify",
    reload,
  };
}
