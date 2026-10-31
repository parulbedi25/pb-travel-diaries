import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Link2,
  Undo2,
  Loader2,
  MapPinned,
  Plus,
  RotateCcw,
  Sparkles,
  Route as RouteIcon,
  Search,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { resolveMapSettings, useSite, type LiveStop } from "../store/siteContent";
import {
  SOURCE_LABELS,
  describePoint,
  normalisePasted,
  parseRouteLink,
  type MapLinkSource,
  type RoutePoint,
} from "../utils/mapLinks";
import { siteApi } from "../api/siteApi";
import { fetchRoadGeometry, type LatLng } from "../utils/routing";
import { routeSignature } from "../utils/liveRoute";
import { fitViewExact, makeMercatorProjector } from "../utils/mercator";
import VectorBasemap from "../components/VectorBasemap";
import { cumulativeKm, formatKm } from "../utils/routeProgress";
import { fillRoute, findMajorStops, mergeStopsByDistance, type MajorStop } from "../utils/majorStops";
import { lookupQueries, placeRegion, shortPlaceName } from "../utils/placeNames";
import { expandShortLinkInBrowser } from "../utils/unshorten";
import { cascadeHereNow, cascadeRidden } from "../utils/liveRoute";
import { searchPlaces, type PlaceHit } from "../utils/placeSearch";
import {
  insertStop,
  removeAllStops,
  removeStopAt,
  replaceEndpoint,
  restoreStops,
  restoreStop,
} from "../utils/routeEdits";
import PlaceTypeahead from "./PlaceTypeahead";
import { cn } from "../utils/cn";
import { inputCls } from "./fieldStyles";

/**
 * Editor for the live tracker's route.
 *
 * One surface, and it is the one you can work on: a map of OpenStreetMap with
 * no place names on it, with numbered draggable pins on top — click to drop a
 * stop, drag to move it. The map is pinned to the same projection as the pins,
 * so what you click is what you get.
 *
 * The order of the list is the order of the journey: the first stop is the
 * start, the last is the destination, and the tracker draws them green and red.
 */

const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500";

/**
 * Expand one short link, asking twice only when asking twice can help.
 *
 * Following a share link means the server reaching Google, and a busy host or
 * a stalled connection is worth one more try a moment later. A refusal is not:
 * a link that is not a map, or one whose destination is unreadable, answers the
 * same way however many times it is asked, and retrying it only makes the
 * operator wait twice as long for the same sentence.
 */
async function resolveShortLink(link: string): Promise<string> {
  try {
    return await siteApi.resolveMapLink(link);
  } catch (error) {
    const status = (error as { status?: number }).status ?? 0;
    // 0 is "the server could not be reached" from the client's own layer.
    if (status !== 0 && status !== 502 && status !== 504) throw error;
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    return siteApi.resolveMapLink(link);
  }
}

const STATUSES: LiveStop["status"][] = ["done", "live", "next"];

const STATUS_COPY: Record<LiveStop["status"], string> = {
  done: "Ridden",
  live: "Here now",
  next: "Still to come",
};

const ROLE_COPY = { start: "Start", end: "Destination", mid: "On the way" } as const;

/**
 * One line of "what just happened to the route".
 *
 * A removal carries the stop itself and where it was, because a red name the
 * operator cannot put back is only a complaint: `Undo` needs the coordinates,
 * the status and the position in the list, not just the word.
 */
interface RouteChange {
  name: string;
  kind: "added" | "removed";
  /** The stop as it was, for a removal that can be undone. */
  stop?: LiveStop;
  /** Where it sat in the list when it went. */
  index?: number;
}

type Role = keyof typeof ROLE_COPY;

const roleOf = (index: number, total: number): Role =>
  index === 0 ? "start" : index === total - 1 ? "end" : "mid";

const round = (n: number) => Math.round(n * 1e4) / 1e4;

/** "between Nangal and Manali" — where a stop landed, in words. */
function describePosition(stops: LiveStop[], place: { name: string; lat: number; lng: number }): string {
  const index = stops.findIndex(
    (stop) => stop.name === place.name && Math.abs(stop.lat - place.lat) < 0.01,
  );
  if (index < 0) return "on the route";
  if (index === 0) return "as the start";
  if (index === stops.length - 1) return "as the destination";
  return `between ${stops[index - 1].name} and ${stops[index + 1].name}`;
}

/* ------------------------------------------------------------------ *
 * Placement grid: geography in, percentages out.
 * ------------------------------------------------------------------ */

/**
 * Look a place up by name.
 *
 * Geoapify's forward geocoder, with the site's own key — the same key that
 * draws the map, so there is one thing to configure and one place to change it.
 * Failing is not fatal: the coordinates can always be typed in by hand, but it
 * should be rare, because a single unplaceable stop used to refuse a whole
 * route.
 */
async function geocodeOne(
  query: string,
  key: string,
): Promise<{ lat: number; lng: number } | null> {
  const apiKey = key.trim();
  if (!apiKey) return null;
  const params = new URLSearchParams({ text: query, lang: "en", limit: "1", format: "json", apiKey });
  try {
    const response = await fetch(`https://api.geoapify.com/v1/geocode/search?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { results?: { lat?: number; lon?: number }[] };
    const first = json.results?.[0];
    const lat = Number(first?.lat);
    const lng = Number(first?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat: round(lat), lng: round(lng) };
  } catch {
    return null;
  }
}

/**
 * Place a stop named only by its address, trying the readable name before the
 * full postal string — "Manali" resolves where "Manali, Himachal Pradesh,
 * India, 175131" can miss.
 */
async function geocode(
  query: string,
  key: string,
): Promise<{ lat: number; lng: number } | null> {
  for (const attempt of lookupQueries(query)) {
    const found = await geocodeOne(attempt, key);
    if (found) return found;
    // The exact-search endpoint needs a key; the suggestion services do not.
    // A site that has not pasted a Geoapify key yet can still place a name
    // typed by hand, which is the difference between a usable installer and a
    // route builder that says "could not find" to every town in India.
    const [fallback] = await searchPlaces(attempt, { key, limit: 1 });
    if (fallback) return { lat: round(fallback.lat), lng: round(fallback.lng) };
  }
  return null;
}

/**
 * Turn a coordinate back into a name. A route link usually gives one end as
 * coordinates and the other as a name, so the coordinate end would otherwise
 * arrive on the tracker as "31.369, 76.3729" — true, and no use to a reader.
 * Same service as the name lookup above, and just as optional: failing leaves
 * the coordinates as the name.
 */
async function reverseLookup(
  lat: number,
  lng: number,
  key: string,
): Promise<{ name: string; state?: string } | null> {
  const apiKey = key.trim();
  if (!apiKey) return reverseFromOsm(lat, lng);
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), lang: "en", limit: "1", format: "json", apiKey });
  let response: Response;
  try {
    response = await fetch(`https://api.geoapify.com/v1/geocode/reverse?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
  } catch {
    // A blocked or offline lookup is not a reason to fail an import: the
    // coordinates are already known, only the name is missing.
    return null;
  }
  if (!response.ok) return null;
  const json = (await response.json()) as {
    results?: { name?: string; address_line1?: string; state?: string; county?: string }[];
  };
  const first = json.results?.[0];
  const name = (first?.name || first?.address_line1 || "").trim();
  if (!name) return null;
  const state = first?.state ?? first?.county;
  return state ? { name, state } : { name };
}

/**
 * A coordinate's name from OpenStreetMap, for a site with no key.
 *
 * Photon has a reverse endpoint beside its search one, and it needs no
 * account, so a pasted link whose end is a pair of numbers still arrives with
 * a town's name on it on a brand-new install.
 */
async function reverseFromOsm(
  lat: number,
  lng: number,
): Promise<{ name: string; state?: string } | null> {
  try {
    const response = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=en`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      features?: { properties?: Record<string, unknown> }[];
    };
    const props = json.features?.[0]?.properties ?? {};
    const text = (field: string) =>
      typeof props[field] === "string" ? (props[field] as string).trim() : "";
    const name = text("name") || text("city") || text("county") || text("state");
    if (!name) return null;
    const state = text("state") || text("county");
    return state ? { name, state } : { name };
  } catch {
    return null;
  }
}

/** The services this can name in the selector. */
const LINK_SOURCES: MapLinkSource[] = ["google", "bing", "apple", "openstreetmap", "other"];

export default function RouteStopsEditor({
  stops,
  routeGeometry,
  routeDistanceKm,
  mapSource,
  onChange,
  onGeometryChange,
  onDistanceChange,
  onMapSourceChange,
  onRouteChange,
}: {
  stops: LiveStop[];
  routeGeometry: LatLng[];
  /** The routing service's own length for that road. Zero when not measured. */
  routeDistanceKm: number;
  /** Which map service the last pasted link came from — picked, never typed. */
  mapSource: MapLinkSource;
  onChange: (stops: LiveStop[]) => void;
  onGeometryChange: (geometry: LatLng[]) => void;
  onDistanceChange: (km: number) => void;
  onMapSourceChange: (source: MapLinkSource) => void;
  /**
   * Stops, road and distance in one write.
   *
   * The dashboard stores the section data as one object, so three separate
   * writes from the same handler each rebuilt it from the render that was
   * already on screen — the last one won and the stops it had not seen went
   * back to their old values. That is why a replace could report seven stops
   * and leave the old six in the list.
   */
  onRouteChange?: (patch: {
    stops?: LiveStop[];
    routeGeometry?: LatLng[];
    routeDistanceKm?: number;
    routeSignature?: string;
  }) => void;
}) {
  const { content } = useSite();
  /** The same key the map is drawn with, so there is one thing to configure. */
  const geoapifyKey = resolveMapSettings(content.map).geoapifyKey;
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [stopBusy, setStopBusy] = useState(false);
  /** What the last automatic road measurement said. */
  const [roadNote, setRoadNote] = useState("");
  const [stopNote, setStopNote] = useState("");
  const [stopError, setStopError] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoomStep, setZoomStep] = useState(0);
  const [link, setLink] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importNote, setImportNote] = useState("");
  const [replaceArmed, setReplaceArmed] = useState(false);
  /**
   * What has changed about the route since it was last looked at: the stops a
   * paste threw away (red, struck through) and the ones it brought in (green).
   * Kept as a list rather than a sentence so a ride that grew by eight towns is
   * still readable at a glance.
   */
  const [changes, setChanges] = useState<RouteChange[]>([]);
  /** What the last replace discarded, so it can be put back. */
  const [undo, setUndo] = useState<{ stops: LiveStop[]; geometry: LatLng[]; distanceKm: number } | null>(
    null,
  );
  const [expanded, setExpanded] = useState<{ link: string; url: string; via?: string } | null>(
    null,
  );
  /* The route builder: a start, a destination, and towns filled in between. */
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [midText, setMidText] = useState("");
  const [startPicked, setStartPicked] = useState<PlaceHit | null>(null);
  const [endPicked, setEndPicked] = useState<PlaceHit | null>(null);
  const [addTowns, setAddTowns] = useState(true);
  const [building, setBuilding] = useState(false);
  const [buildNote, setBuildNote] = useState("");
  const [filling, setFilling] = useState(false);
  /** The two ends the towns between them have already been filled in for. */
  const filledFor = useRef("");
  const [buildError, setBuildError] = useState("");
  /**
   * What the server said when asked whether it can reach the maps at all.
   *
   * Only asked for when an expansion has already failed: the answer exists to
   * separate "the link is bad" from "this server has no way out to Google",
   * and those two need different things done about them.
   */
  const [serverCheck, setServerCheck] = useState<{
    state: "idle" | "checking" | "done";
    reachable?: boolean;
    text?: string;
  }>({ state: "idle" });
  /** The replace button, so arming it is not undone by its own click. */
  const replaceRef = useRef<HTMLButtonElement | null>(null);
  const [resolving, setResolving] = useState(false);
  const [expandError, setExpandError] = useState("");

  /**
   * The two boxes follow the route's own ends, until somebody types in them.
   *
   * The start and destination are already stated by the list; the boxes are a
   * second way to say the same thing, so they show what the list says whenever
   * they are empty rather than starting blank on a route that has two ends.
   */
  useEffect(() => {
    if (!stops.length) return;
    setStartText((current) => (current.trim() ? current : stops[0].name));
    setEndText((current) => (current.trim() ? current : stops[stops.length - 1].name));
  }, [stops]);

  // The projection has to match the map underneath pixel for pixel, so the
  // box is measured rather than assumed.
  useEffect(() => {
    const host = gridRef.current;
    if (!host) return;
    const measure = (width?: number, height?: number) => {
      const w = width ?? host.clientWidth;
      const h = height ?? host.clientHeight;
      if (w > 0 && h > 0) setSize({ width: w, height: h });
    };
    measure();
    const observer = new ResizeObserver((entries) => {
      const rect = entries?.[0]?.contentRect;
      if (rect?.width && rect?.height) measure(rect.width, rect.height);
      else measure();
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const fit = useMemo(
    () => fitViewExact(stops, size.width, size.height, { padX: 28, padY: 28 }),
    [stops, size.width, size.height],
  );
  const zoom = Math.max(3, Math.min(18, fit.zoom + zoomStep));
  const view = { lat: fit.lat, lng: fit.lng, zoom };
  const projector = useMemo(
    () => makeMercatorProjector(view, size.width, size.height),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.lat, view.lng, zoom, size.width, size.height],
  );
  const placed = useMemo(() => stops.map((stop) => projector.toXY(stop)), [stops, projector]);

  // The map underneath is the same tiles the tracker draws: no place names,
  // and a projection we work out ourselves so the pins land where you click.
  // Re-fitting pulls a fresh set of tiles, so let the view settle first.
  const [backdropView, setBackdropView] = useState(view);
  useEffect(() => {
    const timer = window.setTimeout(() => setBackdropView(view), 500);
    return () => window.clearTimeout(timer);
  }, [view.lat, view.lng, zoom]);
  const totals = useMemo(
    () => cumulativeKm(stops, routeGeometry, { totalKm: routeDistanceKm }),
    [stops, routeGeometry, routeDistanceKm],
  );

  // The replace button arms rather than asking with a dialog: it cannot fire
  // by accident, and it cannot trap the operator behind a modal.
  //
  // It stays armed until it is used, the link changes, or the operator clicks
  // away from it — deliberately no timer. It used to disarm itself after four
  // seconds, so reading the button before clicking it meant the second click
  // merely armed it again: nothing happened, twice, and the route looked
  // impossible to replace.
  useEffect(() => {
    if (!replaceArmed) return;
    const disarm = (event: Event) => {
      // The click that arms it — and the one that fires it — both start on the
      // button itself; only a click somewhere else puts it back.
      if (replaceRef.current?.contains(event.target as Node)) return;
      setReplaceArmed(false);
    };
    document.addEventListener("pointerdown", disarm);
    return () => document.removeEventListener("pointerdown", disarm);
  }, [replaceArmed]);

  /**
   * Add to the list of changes, flipping a name that comes back.
   *
   * Nothing is dropped for being old. This used to keep only the last sixteen
   * names, which quietly cut the front off a replace that retired a long route
   * — the red line named some of what had gone and said nothing about the rest,
   * so a stop that had been thrown away looked like one that was still there.
   */
  const recordChanges = useCallback((entries: RouteChange[]) => {
    setChanges((current) => {
      const next = [...current];
      for (const entry of entries) {
        const name = entry.name.trim();
        if (!name) continue;
        const seen = next.findIndex((item) => item.name.toLowerCase() === name.toLowerCase());
        if (seen >= 0) next.splice(seen, 1);
        next.push({ ...entry, name });
      }
      return next;
    });
  }, []);

  /**
   * Take a stop off the route, remembering enough to put it back.
   *
   * The road is measured again by `applyStops`, so an undo is a normal edit and
   * lands in the same place in the list it came from.
   */
  const removeStop = useCallback(
    (index: number) => {
      const { stops: next, removed } = removeStopAt(stops, index);
      if (!removed) return;
      applyStops(next);
      recordChanges([{ name: removed.stop.name, kind: "removed", ...removed }]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyStops belongs to this render on purpose
    [stops],
  );

  /** Put one removed stop back where it was. */
  const restoreChange = useCallback(
    (change: RouteChange) => {
      if (change.kind !== "removed") {
        // A green line the operator is done reading: dismiss it, change nothing.
        setChanges((current) => current.filter((item) => item !== change));
        return;
      }
      const stop = change.stop;
      if (!stop) {
        setChanges((current) => current.filter((item) => item !== change));
        return;
      }
      applyStops(restoreStop(stops, stop, change.index ?? stops.length));
      recordChanges([{ name: stop.name, kind: "added" }]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyStops belongs to this render on purpose
    [stops],
  );

  /** Put every stop that was removed back, in the order they were listed. */
  const restoreAllRemoved = useCallback(() => {
    const removed = changes.filter(
      (change): change is RouteChange & { stop: LiveStop } =>
        change.kind === "removed" && Boolean(change.stop),
    );
    if (!removed.length) return;
    applyStops(
      restoreStops(
        stops,
        removed.map((change) => ({ stop: change.stop, index: change.index ?? stops.length })),
      ),
    );
    recordChanges(removed.map((change) => ({ name: change.stop.name, kind: "added" as const })));
    setStopNote(`Put ${removed.length} stop${removed.length === 1 ? "" : "s"} back.`);
  }, [changes, stops]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Take every stop off the route at once, each one undoable. */
  const clearAllStops = useCallback(() => {
    if (!stops.length) return;
    const { stops: next, removals } = removeAllStops(stops);
    applyStops(next);
    recordChanges(
      removals.map((removal) => ({
        name: removal.stop.name,
        kind: "removed" as const,
        ...removal,
      })),
    );
    setStopNote(`Removed all ${stops.length} stops. Each one can be put back below.`);
  }, [stops]); // eslint-disable-line react-hooks/exhaustive-deps -- one snapshot per click

  const patch = useCallback(
    (index: number, part: Partial<LiveStop>) => {
      onChange(stops.map((stop, i) => (i === index ? { ...stop, ...part } : stop)));
    },
    [onChange, stops],
  );

  const addStop = useCallback(
    (lat: number, lng: number) => {
      const next: LiveStop = {
        name: `Stop ${stops.length + 1}`,
        note: "",
        status: "next",
        lat: round(lat),
        lng: round(lng),
      };
      // A pin dropped between two stops belongs between them on the road, not
      // tacked on the end.
      applyStops(insertStop(stops, next).stops);
      recordChanges([{ name: next.name, kind: "added" }]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyStops belongs to this render on purpose
    [stops],
  );

  /**
   * Statuses are not independent.
   *
   * "Here now" is a statement about the whole route — everything behind it has
   * been ridden, everything ahead is still to come — so choosing it rewrites
   * the other stops rather than leaving the route claiming two current
   * positions. "Ridden" is the same claim, one stop earlier: a stop cannot be
   * behind the bike while the stops above it are still ahead, so choosing it
   * marks everything above it ridden too (see cascadeRidden).
   */
  const setStatus = useCallback(
    (index: number, status: LiveStop["status"]) => {
      if (status === "live") {
        onChange(cascadeHereNow(stops, index));
        return;
      }
      if (status === "done") {
        onChange(cascadeRidden(stops, index));
        return;
      }
      patch(index, { status });
    },
    [onChange, patch, stops],
  );

  const move = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= stops.length) return;
      const reordered = [...stops];
      const [item] = reordered.splice(from, 1);
      reordered.splice(to, 0, item);
      // The order is the route: moving a stop moves the road with it.
      applyStops(reordered);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyStops belongs to this render on purpose
    [stops],
  );

  const handleGridClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const host = gridRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const point = projector.toLatLng(
      Math.min(100, Math.max(0, x)),
      Math.min(100, Math.max(0, y)),
    );
    addStop(point.lat, point.lng);
  };

  const handlePinMove = (index: number, event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragIndex !== index) return;
    const host = gridRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const point = projector.toLatLng(
      Math.min(100, Math.max(0, x)),
      Math.min(100, Math.max(0, y)),
    );
    patch(index, { lat: round(point.lat), lng: round(point.lng) });
  };

  /** A suggestion turned into a stop, with the role written on its note. */
  const stopFromPlace = (place: PlaceHit, role: Role, status: LiveStop["status"] = "next"): LiveStop => {
    const stop: LiveStop = {
      name: place.name.trim() || `${place.lat.toFixed(3)}, ${place.lng.toFixed(3)}`,
      note: `${ROLE_COPY[role]} · picked by name`,
      status,
      lat: round(place.lat),
      lng: round(place.lng),
    };
    if (place.region) stop.state = place.region;
    return stop;
  };

  /**
   * A start or destination chosen from the list.
   *
   * Choosing a start on an empty route makes it the route; on a route that
   * already has one, it replaces that stop (so the ends can be changed without
   * rebuilding everything) while keeping the status the owner had given it.
   */
  const chooseEndpoint = (which: "start" | "end", place: PlaceHit) => {
    if (which === "start") {
      setStartText(place.name);
      setStartPicked(place);
    } else {
      setEndText(place.name);
      setEndPicked(place);
    }
    const index = which === "start" ? 0 : Math.max(stops.length - 1, 0);
    const role: Role = which === "start" ? "start" : "end";
    // An empty route takes the first stop as "here now": there is nothing to
    // ride behind it.
    const status = stops.length ? stops[index].status : "live";
    const { stops: next, removed } = replaceEndpoint(
      stops,
      stopFromPlace(place, role, status),
      which,
    );
    recordChanges([
      ...(removed
        ? [{ name: removed.stop.name, kind: "removed" as const, ...removed }]
        : []),
      { name: place.name, kind: "added" },
    ]);
    if (next.length < 2) {
      applyStops(next);
      return;
    }
    // Two ends are a ride, not a ruler: the towns on the road between them are
    // added here, whichever way the two ends were chosen.
    setBuildNote(`Looking for the towns between ${next[0].name} and ${next[next.length - 1].name}…`);
    if (addTowns) {
      // The stops go in at once; the fill measures the road for the route it
      // ends up with, so there is one measurement rather than two racing ones.
      commitRoute({ stops: next, routeGeometry: [], routeDistanceKm: 0, routeSignature: "" });
      void fillBetweenEnds(next);
    } else {
      applyStops(next);
    }
  };

  /**
   * A stop typed between the ends.
   *
   * It is dropped into the leg of the route it sits nearest to — "Mandi" goes
   * between Nangal and Manali even though it was typed last — and it is marked
   * green in the change list, so an unwanted town is one click from gone.
   */
  const chooseMidStop = (place: PlaceHit) => {
    // A stop dropped in the middle never takes over "here now": where the rider
    // is, is a statement the owner made, not something an edit should move.
    const { stops: next } = insertStop(stops, stopFromPlace(place, "mid"));
    applyStops(next);
    recordChanges([{ name: place.name, kind: "added" }]);
    setStopNote(`${place.name} added ${describePosition(next, place)}.`);
  };

  /**
   * Place an end that was typed but never picked from the list.
   *
   * The suggestions are the easy path; typing a name and pressing Enter is the
   * other one, and it must not do nothing — the name is looked up and, if it
   * resolves, becomes the start or the destination exactly as a suggestion
   * would.
   */
  const applyTypedEndpoint = async (which: "start" | "end") => {
    const typed = (which === "start" ? startText : endText).trim();
    if (!typed) return;
    const picked = which === "start" ? startPicked : endPicked;
    if (picked) {
      chooseEndpoint(which, picked);
      return;
    }
    setBuildError("");
    const found = await geocode(typed, geoapifyKey);
    if (!found) {
      setBuildError(
        `Could not find “${typed}”. Pick it from the suggestions, or type the coordinates on the stop itself.`,
      );
      return;
    }
    chooseEndpoint(which, { name: typed, region: "", ...found });
  };

  /** A stop typed between the ends and never picked from the list. */
  const applyTypedMid = async () => {
    const typed = midText.trim();
    if (!typed) return;
    setBuildError("");
    const found = await geocode(typed, geoapifyKey);
    if (!found) {
      setBuildError(`Could not find “${typed}”. Pick it from the suggestions instead.`);
      return;
    }
    chooseMidStop({ name: typed, region: "", ...found });
    setMidText("");
  };

  /**
   * Build the route from the two ends, with the towns in between filled in.
   *
   * This is the "OK" of the builder: resolve the names, set the ends, and — if
   * asked — put the important towns of the actual road between them, all in one
   * write so the stops, the road and its distance agree. Every town it adds is
   * listed in green, and each is individually removable afterwards.
   */
  const buildRoute = async () => {
    if (building) return;
    const startName = startText.trim();
    const endName = endText.trim();
    if (!startName || !endName) {
      setBuildError("Type or pick both a start and a destination.");
      return;
    }
    setBuilding(true);
    setBuildError("");
    setBuildNote("");

    try {
      const resolve = async (
        picked: PlaceHit | null,
        text: string,
      ): Promise<{ name: string; region: string; lat: number; lng: number } | null> => {
        if (picked) return picked;
        const found = await geocode(text, geoapifyKey);
        return found ? { name: text, region: "", ...found } : null;
      };

      const start = await resolve(startPicked, startName);
      const end = await resolve(endPicked, endName);
      if (!start || !end) {
        setBuildError(
          `Could not find ${!start ? `“${startName}”` : `“${endName}”`}. Pick it from the suggestions, or add it by clicking the map.`,
        );
        return;
      }

      // The ends become the ends; anything already between them stays as it is.
      const first = stops[0];
      const last = stops[stops.length - 1];
      const sameAs = (stop: LiveStop | undefined, place: { name: string; lat: number; lng: number }) =>
        Boolean(stop) && stop!.name.trim().toLowerCase() === place.name.trim().toLowerCase() &&
        Math.abs(stop!.lat - place.lat) < 0.01 && Math.abs(stop!.lng - place.lng) < 0.01;

      let base: LiveStop[];
      if (!stops.length) {
        base = [
          stopFromPlace(start as PlaceHit, "start", "live"),
          stopFromPlace(end as PlaceHit, "end"),
        ];
      } else if (stops.length === 1) {
        base = [
          sameAs(first, start) ? first : { ...stopFromPlace(start as PlaceHit, "start", first.status) },
          stopFromPlace(end as PlaceHit, "end"),
        ];
      } else {
        base = stops.map((stop, index) => {
          if (index === 0 && !sameAs(first, start)) {
            return { ...stopFromPlace(start as PlaceHit, "start", stop.status) };
          }
          if (index === stops.length - 1 && !sameAs(last, end)) {
            return { ...stopFromPlace(end as PlaceHit, "end", stop.status) };
          }
          return stop;
        });
      }

      // An end this replaces is still a stop somebody chose: it goes in the red
      // list with the rest, so the old route can be put back.
      const replaced: RouteChange[] = [];
      if (first && !sameAs(first, start)) {
        replaced.push({ name: first.name, kind: "removed", stop: first, index: 0 });
      }
      if (last && last !== first && !sameAs(last, end)) {
        replaced.push({ name: last.name, kind: "removed", stop: last, index: stops.length - 1 });
      }

      const added: string[] = [];
      if (!stops.some((stop) => stop.name.trim().toLowerCase() === start.name.trim().toLowerCase())) {
        added.push(start.name);
      }
      if (!stops.some((stop) => stop.name.trim().toLowerCase() === end.name.trim().toLowerCase())) {
        added.push(end.name);
      }

      if (!addTowns || base.length < 2) {
        applyStops(base);
        recordChanges([
          ...replaced,
          ...added.map((name) => ({ name, kind: "added" as const })),
        ]);
        setBuildNote(`${base.length} stops on the route. Add towns on the way whenever you want them.`);
        return;
      }

      const road = await fetchRoadGeometry(base);
      if (!road.ok) {
        applyStops(base);
        recordChanges([
          ...replaced,
          ...added.map((name) => ({ name, kind: "added" as const })),
        ]);
        setBuildError(`${road.message} The two ends are on the route; the towns were not filled in.`);
        return;
      }

      const { stops: found } = await findMajorStops(road.geometry, {
        key: geoapifyKey,
        avoid: base.map((stop) => stop.name),
        max: 12,
        gapKm: 30,
        radiusKm: 14,
      });
      const merged = mergeStopsByDistance(base, road.geometry, found, (place: MajorStop) => ({
        name: place.name,
        note: "Between your points · filled in from the road",
        status: "next",
        lat: round(place.lat),
        lng: round(place.lng),
      }));
      commitRoute({
        stops: merged,
        routeGeometry: road.geometry,
        routeDistanceKm: road.distanceKm,
        routeSignature: routeSignature(merged),
      });
      const townNames = merged
        .slice(1, -1)
        .map((stop) => stop.name)
        .filter((name) => !base.some((stop) => stop.name.toLowerCase() === name.toLowerCase()));
      recordChanges([
        ...replaced,
        ...added.map((name) => ({ name, kind: "added" as const })),
        ...townNames.map((name) => ({ name, kind: "added" as const })),
      ]);
      filledFor.current = `${base[0].lat.toFixed(4)},${base[0].lng.toFixed(4)}>${base[
        base.length - 1
      ].lat.toFixed(4)},${base[base.length - 1].lng.toFixed(4)}`;
      setBuildNote(
        townNames.length
          ? `Route built: ${start.name} → ${end.name}, with ${townNames.length} towns in between (${townNames.join(
              ", ",
            )}) — all in green, and each one removable.`
          : `Route built: ${start.name} → ${end.name}. No towns to add on this stretch.`,
      );
    } catch {
      setBuildError("Could not build the route just now. Try again in a moment.");
    } finally {
      setBuilding(false);
    }
  };

  const handleFind = async () => {
    const name = query.trim();
    if (!name) return;
    setLooking(true);
    setLookError("");
    try {
      const found = await geocode(name, geoapifyKey);
      if (!found) {
        setLookError(`Could not find “${name}”. Add it by clicking the grid or typing coordinates.`);
        return;
      }
      applyStops(
        insertStop(stops, { name, note: "", status: "next", lat: found.lat, lng: found.lng }).stops,
      );
      recordChanges([{ name, kind: "added" }]);
      setQuery("");
    } catch {
      setLookError("The place lookup could not be reached. Click the grid or type coordinates.");
    } finally {
      setLooking(false);
    }
  };

  // A short share link hides the route behind a redirect the browser cannot
  // read, so it is expanded once through the server and the result is what gets
  // parsed. The short link stays in the box — that is the thing they pasted.
  //
  // What gets sent for expansion is the *address*, not the paste: a link that
  // arrived as `[text](https://maps.app.goo.gl/…)` or with `&amp;` in it is
  // cleaned up first, because the server checks the host before following it
  // and markdown around an address is not a host it can follow.
  const trimmedLink = link.trim();
  const cleanLink = normalisePasted(link);
  const effectiveLink = expanded && expanded.link === cleanLink ? expanded.url : cleanLink;

  // Read while typing: the service and the points are known before anything is
  // added, so the operator can see what the link says without committing to it.
  const parsedLink = useMemo(() => parseRouteLink(effectiveLink), [effectiveLink]);

  /** Can the link be imported at all, and if not — in words. */
  const canImport = parsedLink.ok && !importing && !resolving;
  const importBlockedReason = !trimmedLink
    ? "Paste a link above and this button reads it."
    : resolving
      ? "Waiting for the short link to expand — a second, usually."
      : expandError
        ? "The short link could not be read. Open it in a browser and paste the full address from its address bar."
        : parsedLink.ok
          ? ""
          : parsedLink.message;

  const linkStatus = !trimmedLink
    ? "Selected automatically from whichever link you paste."
    : resolving
      ? "Short link — expanding it to read the route…"
      : expandError
        ? expandError
        : expanded?.via
          ? `${parsedLink.message} Read in this browser (${expanded.via}), because the server could not reach Google.`
          : parsedLink.message;

  useEffect(() => {
    if (!trimmedLink) {
      setExpanded(null);
      setExpandError("");
      return;
    }
    // Already expanded: clearing the spinner here matters, because the cleanup
    // of the previous run runs when this effect re-enters and would otherwise
    // strand `resolving` at true, greying out the replace button forever.
    if (expanded?.link === cleanLink) {
      setResolving(false);
      return;
    }
    if (!parseRouteLink(cleanLink).shortLink) {
      setResolving(false);
      setExpanded(null);
      setExpandError("");
      return;
    }
    // Debounced: a pasted link lands in one go, typing one is not a request
    // per keystroke.
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setResolving(true);
      setExpandError("");
      void resolveShortLink(cleanLink)
        .then((url) => {
          if (cancelled) return;
          // An answer without an address is not an expansion; treating it as
          // one leaves the panel parsing "undefined" and the buttons dead.
          if (!url || !/^https?:\/\//i.test(url)) throw new Error("That short link came back empty.");
          setResolving(false);
          setExpanded({ link: cleanLink, url });
        })
        .catch(async (error: unknown) => {
          if (cancelled) return;
          // The server could not do it — usually because this machine's Node
          // has no road out while the browser beside it does. Ask the browser
          // before giving up: the route is the point, not which half of the
          // app fetched it.
          const fromBrowser = await expandShortLinkInBrowser(cleanLink).catch(() => null);
          if (cancelled) return;
          if (fromBrowser) {
            setServerCheck({ state: "idle" });
            setResolving(false);
            setExpandError("");
            setExpanded({ link: cleanLink, url: fromBrowser.url, via: fromBrowser.via });
            return;
          }
          setResolving(false);
          // Ask the server why, once, so the panel can say whether this is a
          // bad link or a host with no road out.
          setServerCheck({ state: "checking" });
          void siteApi
            .mapLinkHealth()
            .then((health) => {
              // Said out loud, because it is the difference between "fix the
              // link" and "fix the machine this is running on" — and a proxy
              // taken from the Mac's own settings is worth naming, since that
              // is exactly what changed when the site moved machines.
              const via = health.proxy
                ? ` through ${health.proxySource === "system" ? "the system proxy" : "the proxy"} ${health.proxy}`
                : "";
              setServerCheck({
                state: "done",
                reachable: health.reachable,
                text: health.reachable
                  ? `The server can reach the maps${via} (${health.ms} ms), so this particular link is the problem.${health.hint ? ` ${health.hint}` : ""}`
                  : `${health.code ? `The server could not reach the maps${via} (${health.code}). ` : ""}${health.hint}`,
              });
            })
            .catch(() => setServerCheck({ state: "idle" }));
          // The server's own sentence already says what went wrong and what to
          // do about it — appending a second instruction only repeats it.
          setExpandError(
            error instanceof Error
              ? error.message
              : "That short link could not be expanded. Open it and copy the address bar instead.",
          );
        })
        .finally(() => {
          if (!cancelled) setResolving(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cleanLink, expanded?.link]);

  /** Picked out of the link, not asked for by hand. */
  const rememberSource = (source: MapLinkSource) => {
    if (source !== "other" && source !== mapSource) onMapSourceChange(source);
  };

  const handleLinkChange = (value: string) => {
    setLink(value);
    setImportError("");
    setImportNote("");
    setReplaceArmed(false);
    const detection = parseRouteLink(value).source;
    if (value.trim() && detection !== "other") rememberSource(detection);
  };

  /**
   * Turn what the link said into stops.
   *
   * A link can name an end or give it as coordinates, and either way the other
   * half is looked up — the name from Geoapify's reverse lookup, the position
   * from its search. Nothing is written until every point resolves, so a link
   * half-read cannot leave the tracker with two stops and a hole.
   */
  const resolvePoint = async (
    point: RoutePoint,
    index: number,
    total: number,
    source: MapLinkSource,
  ): Promise<LiveStop | null> => {
    let lat = point.lat;
    let lng = point.lng;
    const address = point.label?.trim() ?? "";
    // The map gets the readable name, the note keeps the full address: nothing
    // is lost, it is just filed where it can be read.
    let name = address ? shortPlaceName(address) : "";
    let state = address ? placeRegion(address) : undefined;

    if (lat === undefined || lng === undefined) {
      if (!address) return null;
      const found = await geocode(address, geoapifyKey);
      if (!found) return null;
      lat = found.lat;
      lng = found.lng;
    } else if (!name) {
      const looked = await reverseLookup(lat, lng, geoapifyKey);
      if (looked) {
        name = looked.name;
        state = looked.state;
      }
    }

    const role = index === 0 ? "Start" : index === total - 1 ? "Destination" : "On the way";
    const status: LiveStop["status"] = index === 0 ? "live" : "next";
    const extra = address && address !== name ? ` · ${address}` : "";
    const stop: LiveStop = {
      name: name || `${lat.toFixed(3)}, ${lng.toFixed(3)}`,
      note: `${role} · from ${SOURCE_LABELS[source]}${extra}`,
      status,
      lat: round(lat),
      lng: round(lng),
    };
    if (state) stop.state = state;
    return stop;
  };

  /**
   * Add the major stops of the route already on screen, without disturbing the
   * ones the rider put there: each suggestion is dropped in at its own place
   * along the road.
   */
  const handleAddMajorStops = async () => {
    if (stops.length < 2 || stopBusy) return;
    setStopBusy(true);
    setStopNote("");
    setStopError("");
    try {
      let geometry = routeGeometry;
      // The distance that belongs to that geometry: the stored one when the
      // road came from the dashboard, the measurement when it was just fetched.
      let roadKm = routeDistanceKm;
      if (geometry.length < 2) {
        const road = await fetchRoadGeometry(stops);
        if (!road.ok) {
          setStopError(road.message);
          return;
        }
        geometry = road.geometry;
        roadKm = road.distanceKm;
      }
      const { stops: found, source } = await findMajorStops(geometry, {
        key: geoapifyKey,
        avoid: stops.map((stop) => stop.name),
        max: 12,
        gapKm: 30,
        radiusKm: 14,
      });
      if (!found.length) {
        setStopNote("No towns found on this stretch — the stops below are already it.");
        return;
      }
      const merged = mergeStopsByDistance(stops, geometry, found, (place: MajorStop) => ({
        name: place.name,
        note: "",
        status: "next",
        lat: round(place.lat),
        lng: round(place.lng),
      }));
      // The road already runs through these places, so it is stored with them,
      // under the signature of the stops it now belongs to.
      commitRoute({
        stops: merged,
        routeGeometry: geometry,
        routeDistanceKm: roadKm,
        routeSignature: routeSignature(merged),
      });
      recordChanges(found.map((place) => ({ name: place.name, kind: "added" as const })));
      setStopNote(
        `Added ${found.length} major stop${found.length === 1 ? "" : "s"} along the road: ${found
          .map((place) => place.name)
          .join(", ")}.${source === "offline" ? " (Offline list — the map service was busy.)" : ""}`,
      );
    } catch {
      setStopError("Could not look up the towns on this route.");
    } finally {
      setStopBusy(false);
    }
  };

  /**
   * Write the route back in one go.
   *
   * Falls back to the three single-field callbacks when the host has no
   * combined writer, so the editor still works on its own.
   */
  const commitRoute = (patch: {
    stops?: LiveStop[];
    routeGeometry?: LatLng[];
    routeDistanceKm?: number;
    routeSignature?: string;
  }) => {
    if (onRouteChange) {
      onRouteChange(patch);
      return;
    }
    if (patch.stops !== undefined) onChange(patch.stops);
    if (patch.routeGeometry !== undefined) onGeometryChange(patch.routeGeometry);
    if (patch.routeDistanceKm !== undefined) onDistanceChange(patch.routeDistanceKm);
  };

  /**
   * A slow road answer must never land on top of a newer one: every edit takes
   * a ticket, and only the newest ticket may write.
   */
  const roadToken = useRef(0);

  /**
   * Write a changed set of stops *and* measure the road for them again.
   *
   * The stored road and its distance belong to the stops that were there a
   * moment ago. Left behind after a deletion they draw a line through a place
   * the rider removed and keep quoting the old ride — a route cut from seven
   * stops down to two went on saying 1,556 km. So the road is cleared in the
   * same write as the stops, then measured again and stored with the signature
   * of the stops it was measured between.
   *
   * Every edit that changes the ground changes the road: deleting a stop,
   * adding one, reordering them, dragging a pin.
   */
  const applyStops = (next: LiveStop[]) => {
    const token = (roadToken.current += 1);
    setRoadNote("");
    setFetchError("");

    if (next.length < 2) {
      commitRoute({
        stops: next,
        routeGeometry: [],
        routeDistanceKm: 0,
        routeSignature: "",
      });
      setFetching(false);
      setRoadNote("One stop left — the road is measured again once there are two.");
      return;
    }

    commitRoute({
      stops: next,
      routeGeometry: [],
      routeDistanceKm: 0,
      routeSignature: "",
    });
    setFetching(true);
    void fetchRoadGeometry(next).then((result) => {
      // A newer edit has already asked; this answer is about a route that no
      // longer exists.
      if (token !== roadToken.current) return;
      setFetching(false);
      if (result.ok) {
        commitRoute({
          routeGeometry: result.geometry,
          routeDistanceKm: result.distanceKm,
          routeSignature: routeSignature(next),
        });
        setRoadNote(
          `Road measured again for ${next.length} stop${next.length === 1 ? "" : "s"} · ${formatKm(
            result.distanceKm,
          )}. Save to show it on the tracker.`,
        );
      } else {
        setFetchError(result.message);
      }
    });
  };

  /**
   * The towns between the two ends, added however the ends were set.
   *
   * Whether the ends arrived from a suggestion, a typed name, a pasted map
   * link or a pair of pins, a route of two points is a ruler between them and
   * not a ride. So any edit that leaves the route with two or more stops fills
   * in the towns it passes through — once per pair of ends, so the owner's own
   * deletions are not undone on the next edit — and lists each one in green,
   * where it can be removed again.
   *
   * The toggle in the builder is the escape hatch: with "Add the important
   * towns in between" off, nothing is filled in and the route stays exactly
   * what the owner made.
   */
  const fillBetweenEnds = useCallback(
    async (base: LiveStop[], say = true) => {
      if (!addTowns || base.length < 2) return base;
      const start = base[0];
      const end = base[base.length - 1];
      const key = `${start.lat.toFixed(4)},${start.lng.toFixed(4)}>${end.lat.toFixed(4)},${end.lng.toFixed(4)}`;
      if (filledFor.current === key) return base;
      filledFor.current = key;
      if (filling) return base;
      setFilling(true);
      try {
        // The towns already on the route are not "found again": they are the
        // stops the owner put there, and `fillRoute` skips them by name.
        const filled = await fillRoute(base, { key: geoapifyKey });
        if (!filled.added.length) {
          if (filled.road.ok) {
            commitRoute({
              stops: base,
              routeGeometry: filled.road.geometry,
              routeDistanceKm: filled.road.distanceKm,
              routeSignature: routeSignature(base),
            });
          }
          if (say) {
            setBuildNote(
              base.length === 2
                ? `No towns to add between ${start.name} and ${end.name} — the road is ${formatKm(
                    filled.road.ok ? filled.road.distanceKm : 0,
                  )}.`
                : "",
            );
          }
          return base;
        }
        commitRoute(
          filled.road.ok
            ? {
                stops: filled.stops,
                routeGeometry: filled.road.geometry,
                routeDistanceKm: filled.road.distanceKm,
                routeSignature: routeSignature(filled.stops),
              }
            : { stops: filled.stops, routeGeometry: [], routeDistanceKm: 0, routeSignature: "" },
        );
        recordChanges(filled.added.map((name) => ({ name, kind: "added" as const })));
        if (say) {
          setBuildNote(
            `${filled.added.length} town${filled.added.length === 1 ? "" : "s"} added between ${
              start.name
            } and ${end.name}: ${filled.added.join(", ")}. Each is in green — remove any you do not want.`,
          );
        }
        return filled.stops;
      } catch {
        if (say) setBuildError("Could not look for the towns between those two points just now.");
        return base;
      } finally {
        setFilling(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one fill per pair of ends
    [addTowns, geoapifyKey, filling, recordChanges],
  );

  const handleImport = async (mode: "add" | "replace") => {
    if (!parsedLink.ok || importing) return;
    setImporting(true);
    setImportError("");
    setImportNote("");

    const built: LiveStop[] = [];
    const unread: string[] = [];

    try {
      for (const [index, point] of parsedLink.points.entries()) {
        const resolved = await resolvePoint(point, index, parsedLink.points.length, parsedLink.source);
        if (resolved) built.push(resolved);
        else unread.push(point.label ?? `${point.lat}, ${point.lng}`);
      }

      // A single stop that cannot be placed must not sink the whole route: the
      // one unplaceable point is reported and left out, everything else is
      // imported. Refusing the lot is what made "Use as the route" look broken.
      if (built.length < 2) {
        setImportError(
          `Could not place ${unread.join(", ") || "any stop in that link"}. Add the stops by hand below.`,
        );
        return;
      }

      const existing = mode === "replace" ? [] : stops;
      // Only one stop can be "here now". Adding a route behind an existing one
      // must not claim PB is in two places, so the imported stops join as still
      // to come; a fresh route starts at its own start.
      if (existing.length) {
        for (const stop of built) stop.status = "next";
      }
      // Bookkeeping, not paranoia: a route imported twice should not double
      // every stop, and the same coordinate twice is the same place.
      const seen = new Set(existing.map((stop) => `${stop.lat.toFixed(4)},${stop.lng.toFixed(4)}`));
      let skipped = 0;
      const fresh = built.filter((stop, index) => {
        const key = `${stop.lat.toFixed(4)},${stop.lng.toFixed(4)}`;
        // The first and last points define the journey — a round trip that
        // comes back to a stop already on the tracker still needs its ride home.
        const end = index === 0 || index === built.length - 1;
        if (!end && seen.has(key)) {
          skipped += 1;
          return false;
        }
        seen.add(key);
        return true;
      });

      if (!fresh.length) {
        setImportNote("Every point in that link is already a stop.");
        return;
      }

      // A pasted link gives the ends of a journey, not the road between them,
      // so a route of exactly two stops is filled in with the towns it passes
      // through — and the road itself is measured and stored, so the tracker
      // reports the real distance from the first visit rather than a straight
      // line through the mountains.
      const imported = [...existing, ...fresh];
      const measured = await fillRoute(imported);
      // The switch in the builder decides whether towns are filled in, for a
      // paste as much as for a typed pair: with it off the link's own points
      // are the route, and only the road is measured.
      const filled = addTowns
        ? measured
        : { stops: imported, added: [] as string[], road: measured.road };

      // What this paste changed, named: the stops it threw away (red) and the
      // ones it brought in (green) — the link's own points and the towns filled
      // in between them alike, because both are new to this route.
      //
      // A stop survives only if the new route has the same name *on the same
      // ground*. Matching on the name alone was the reason a place could vanish
      // from the map and still not be struck through: a township both routes
      // pass through kept the old pin's name, so the stop the paste had thrown
      // away was reported as kept. Two tenths of a degree of latitude is about
      // 200 m — further than a geocoder jitters, closer than a moved pin.
      const samePlace = (a: LiveStop, b: LiveStop) =>
        a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
        Math.abs(a.lat - b.lat) < 0.002 &&
        Math.abs(a.lng - b.lng) < 0.002;
      setChanges([
        ...stops
          .filter((stop) => !filled.stops.some((next) => samePlace(stop, next)))
          .map((stop) => ({ name: stop.name, kind: "removed" as const })),
        ...filled.stops
          .filter((stop) => !stops.some((old) => samePlace(stop, old)))
          .map((stop) => ({ name: stop.name, kind: "added" as const })),
      ]);

      // What a replace threw away, kept so it can be put back in one click.
      if (mode === "replace" && stops.length) {
        setUndo({ stops, geometry: routeGeometry, distanceKm: routeDistanceKm });
      } else if (mode === "add") {
        setUndo(null);
      }

      // The road is stored with the route, so the tracker reports real road
      // distance on the first visit instead of joining the stops with rulers.
      // Stops, road and distance go in as one write: written one at a time,
      // each rebuilt the section from the same stale copy and the next one
      // undid it.
      commitRoute(
        filled.road.ok
          ? {
              stops: filled.stops,
              routeGeometry: filled.road.geometry,
              routeDistanceKm: filled.road.distanceKm,
              routeSignature: routeSignature(filled.stops),
            }
          : {
              stops: filled.stops,
              // The stored road geometry belongs to the old stops; leaving it
              // would draw a route through points that are no longer on it.
              ...(routeGeometry.length
                ? { routeGeometry: [], routeDistanceKm: 0, routeSignature: "" }
                : { routeSignature: "" }),
            },
      );

      setImportNote(
        `${unread.length ? `${unread.join(", ")} could not be placed and was left out. ` : ""}${
          mode === "replace" ? "Added" : "Added"
        } ${fresh.length} ${fresh.length === 1 ? "stop" : "stops"} from ${SOURCE_LABELS[parsedLink.source]}: ${
          fresh.map((stop) => stop.name).join(", ")
        }.${skipped ? ` ${skipped} already on the tracker.` : ""}${
          filled.added.length ? ` Filled in ${filled.added.length} major stops on the way.` : ""
        }${filled.road.ok ? ` Road measured at ${formatKm(filled.road.distanceKm)}.` : " Could not measure the road just now — fetch it below."}`,
      );
      setLink("");
      setReplaceArmed(false);
    } catch {
      // Whatever went wrong, say so — and leave the buttons working. An import
      // that died halfway used to leave the panel permanently "busy", which
      // looks exactly like a button that does nothing.
      setImportError("That import could not finish. Try again, or add the stops by hand below.");
    } finally {
      setImporting(false);
    }
  };

  const handleFetchRoad = async () => {
    if (stops.length < 2) return;
    const token = (roadToken.current += 1);
    setFetching(true);
    setFetchError("");
    setRoadNote("");
    const result = await fetchRoadGeometry(stops);
    if (token !== roadToken.current) return;
    setFetching(false);
    if (result.ok) {
      commitRoute({
        routeGeometry: result.geometry,
        routeDistanceKm: result.distanceKm,
        routeSignature: routeSignature(stops),
      });
      setRoadNote(`Road measured for ${stops.length} stops · ${formatKm(result.distanceKm)}. Save to show it on the tracker.`);
    } else {
      setFetchError(result.message);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* ── Place the stops ── */}
      <div className="rounded-2xl border border-white/[0.08] bg-ink-950/50 p-4">
        <p className="flex items-center gap-2 text-xs font-bold text-white">
          <MapPinned className="h-4 w-4 text-saffron-300" aria-hidden="true" />
          Place the stops
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          Click the map to drop a stop, or drag a pin to move it. The map underneath is the same
          nameless tiles the tracker uses, pinned to the same projection as the pins, so what you
          click is what you get.
        </p>

        <div
          ref={gridRef}
          onClick={handleGridClick}
          className="route-grid relative mt-3 aspect-[3/2] w-full cursor-crosshair overflow-hidden rounded-xl border border-white/10"
        >
          {/* The map underneath. Pointer-dead, so clicks land on our overlay. */}
          <VectorBasemap
            view={backdropView}
            width={size.width}
            height={size.height}
            className="pointer-events-none absolute inset-0 overflow-hidden"
            attributionClassName="pointer-events-none absolute bottom-1 right-1.5"
          />

          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 300 200"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {placed.length > 1 && (
              <polyline
                points={placed.map((p) => `${(p.x * 3).toFixed(1)},${(p.y * 2).toFixed(1)}`).join(" ")}
                fill="none"
                stroke="var(--color-saffron-400)"
                strokeOpacity="0.55"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray="6 5"
              />
            )}
          </svg>

          <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setZoomStep((step) => Math.min(step + 1, 8));
              }}
              aria-label="Zoom the map in"
              className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-ink-950/80 text-zinc-300 backdrop-blur-md transition-colors hover:border-white/25 hover:text-white"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setZoomStep((step) => Math.max(step - 1, -4));
              }}
              aria-label="Zoom the map out"
              className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-ink-950/80 text-zinc-300 backdrop-blur-md transition-colors hover:border-white/25 hover:text-white"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
          </div>

          {stops.map((stop, index) => {
            const role = roleOf(index, stops.length);
            const point = placed[index];
            return (
              <button
                key={`${stop.name}-${index}`}
                type="button"
                title={`${ROLE_COPY[role]} · ${stop.name}`}
                aria-label={`${ROLE_COPY[role]} · ${stop.name}. Drag to move.`}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragIndex(index);
                }}
                onPointerMove={(event) => handlePinMove(index, event)}
                onPointerUp={() => {
                  setDragIndex(null);
                  // The pin has moved, so the road under it has too.
                  applyStops(stops);
                }}
                onPointerCancel={() => setDragIndex(null)}
                onClick={(event) => event.stopPropagation()}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none active:cursor-grabbing"
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
              >
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full border-2 border-white text-[11px] font-bold shadow-lg ${
                    role === "start"
                      ? "bg-emerald-500 text-white"
                      : role === "end"
                        ? "bg-red-500 text-white"
                        : "bg-[#f5b301] text-ink-950"
                  }`}
                >
                  {index + 1}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="min-w-0 flex-1">
            <PlaceTypeahead
              value={query}
              onChange={(text) => {
                setQuery(text);
                setLookError("");
              }}
              onPick={(place) => {
                chooseMidStop(place);
                setQuery("");
              }}
              onEnter={() => void handleFind()}
              options={{ key: geoapifyKey, country: "in", limit: 6, near: stops[stops.length - 1] }}
              label="Add a stop by name"
              hint="Start typing and the places appear underneath — pick one, or press Find."
              placeholder="Anandpur Sahib…"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleFind()}
            disabled={looking || !query.trim()}
            className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-xs font-semibold text-white transition-all duration-300 hover:border-white/25 disabled:opacity-40"
          >
            {looking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Find
          </button>
          <button
            type="button"
            onClick={() => {
              const last = stops[stops.length - 1];
              addStop(last ? last.lat + 0.05 : 31, last ? last.lng + 0.05 : 76.5);
            }}
            className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-xs font-semibold text-white transition-all duration-300 hover:border-white/25"
          >
            <Plus className="h-3.5 w-3.5" /> Add stop
          </button>
        </div>
        {lookError && <p className="mt-2 text-[11px] text-amber-200">{lookError}</p>}
      </div>

      {/* ── Start, destination, and the towns between ── */}
      <div className="rounded-2xl border border-white/[0.08] bg-ink-950/50 p-4">
        <p className="flex items-center gap-2 text-xs font-bold text-white">
          <Sparkles className="h-4 w-4 text-saffron-300" aria-hidden="true" />
          Start and destination
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          Type either end — the places appear as you type. Press{" "}
          <span className="text-zinc-300">Build the route</span> and the important towns on the road
          between them are added for you, in green. Any town you do not want, remove it; it goes red
          and can be put back.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <PlaceTypeahead
            value={startText}
            onChange={(text) => {
              setStartText(text);
              setStartPicked(null);
              setBuildError("");
            }}
            onPick={(place) => chooseEndpoint("start", place)}
            onEnter={() => void applyTypedEndpoint("start")}
            options={{ key: geoapifyKey, country: "in", limit: 6 }}
            label="Start"
            placeholder="Nangal…"
          />
          <PlaceTypeahead
            value={endText}
            onChange={(text) => {
              setEndText(text);
              setEndPicked(null);
              setBuildError("");
            }}
            onPick={(place) => chooseEndpoint("end", place)}
            onEnter={() => void applyTypedEndpoint("end")}
            options={{
              key: geoapifyKey,
              country: "in",
              limit: 6,
              near: stops.length ? stops[0] : undefined,
            }}
            label="Destination"
            placeholder="Leh…"
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <PlaceTypeahead
            value={midText}
            onChange={(text) => setMidText(text)}
            onPick={(place) => {
              chooseMidStop(place);
              setMidText("");
            }}
            onEnter={() => void applyTypedMid()}
            options={{ key: geoapifyKey, country: "in", limit: 6, near: stops[stops.length - 1] }}
            label="A stop in between"
            hint="It lands between the two stops it sits closest to on the road — not always at the end."
            placeholder="Mandi…"
          />
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-[11px] text-zinc-300">
              <input
                type="checkbox"
                checked={addTowns}
                onChange={(event) => {
                  const on = event.target.checked;
                  setAddTowns(on);
                  // Switched back on with a route already drawn: fill it in now
                  // rather than waiting for the next edit.
                  if (on && stops.length >= 2) {
                    filledFor.current = "";
                    void fillBetweenEnds(stops);
                  }
                }}
                className="h-3.5 w-3.5 accent-emerald-500"
              />
              Add the important towns in between
            </label>
            <button
              type="button"
              onClick={() => void buildRoute()}
              disabled={building || !startText.trim() || !endText.trim()}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-saffron-400 px-4 py-2.5 text-xs font-bold text-on-gold shadow-lg shadow-saffron-400/25 transition-all duration-300 hover:brightness-110 active:scale-95 disabled:opacity-40"
            >
              {building ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {building ? "Building the route…" : "Build the route"}
            </button>
          </div>
        </div>

        {buildError && <p className="mt-2 text-[11px] text-amber-200">{buildError}</p>}
        {buildNote && <p className="mt-2 text-[11px] leading-relaxed text-emerald-300">{buildNote}</p>}
      </div>

      {/* ── From a map link ── */}
      <div className="rounded-2xl border border-white/[0.08] bg-ink-950/50 p-4">
        <p className="flex items-center gap-2 text-xs font-bold text-white">
          <Link2 className="h-4 w-4 text-saffron-300" aria-hidden="true" />
          From a map link
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          Planned the ride in Google Maps or Bing Maps already? Paste the link here and its start and
          destination become stops — the service is picked out of the link itself, and names are looked
          up so the pins land in the right place.
        </p>

        <input
          value={link}
          onChange={(event) => handleLinkChange(event.target.value)}
          onPaste={(event) => {
            // Paste is the whole point of this box, so read it immediately
            // rather than waiting for the change event to catch up.
            const pasted = event.clipboardData.getData("text");
            if (pasted) {
              event.preventDefault();
              handleLinkChange(pasted);
            }
          }}
          placeholder="https://www.google.com/maps/dir/Nangal/Chandigarh"
          aria-label="Paste a shared map route link"
          aria-describedby="live-link-read"
          spellCheck={false}
          autoComplete="off"
          className={cn(inputCls, "mt-3 font-mono text-[12px]")}
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] sm:items-start">
          <div>
            <label className={labelCls} htmlFor="live-map-source">
              Map service
            </label>
            <select
              id="live-map-source"
              value={mapSource}
              onChange={(event) => onMapSourceChange(event.target.value as MapLinkSource)}
              className={inputCls}
            >
              {LINK_SOURCES.map((source) => (
                <option key={source} value={source} className="bg-ink-900">
                  {SOURCE_LABELS[source]}
                </option>
              ))}
            </select>
          </div>
          <p
            id="live-link-read"
            className={cn(
              "text-[11px] leading-relaxed",
              !trimmedLink || resolving ? "text-zinc-500" : parsedLink.ok && !expandError ? "text-zinc-400" : "text-amber-200",
            )}
          >
            {linkStatus}
            {/* When the expansion fails, the link itself is the way out: open
                it, copy the address bar, paste it above — and the same parser
                reads the route without asking the server at all. */}
            {expandError && /^https?:\/\//i.test(cleanLink) && (
              <>
                {" "}
                <a
                  href={cleanLink}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline decoration-amber-300/40 underline-offset-2 hover:decoration-amber-300"
                >
                  Open it
                </a>
              </>
            )}
          </p>
        </div>

        {parsedLink.ok && (
          <ol className="mt-3 space-y-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            {parsedLink.points.map((point, index) => (
              <li key={`${index}-${point.label ?? ""}`} className="flex items-start gap-2 text-[11px] text-zinc-300">
                <span
                  className={cn(
                    "aspect-square mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white",
                    index === 0
                      ? "bg-emerald-500"
                      : index === parsedLink.points.length - 1
                        ? "bg-red-500"
                        : "bg-[#f5b301] text-ink-950",
                  )}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span className="leading-relaxed">{describePoint(point, index, parsedLink.points.length)}</span>
              </li>
            ))}
          </ol>
        )}

        {/* The two actions are one click each now.
            Replacing used to arm first and disarm itself after four seconds,
            so reading the label before clicking it meant the second click only
            armed it again: the route looked impossible to replace. The undo
            below is what makes one click safe. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            ref={replaceRef}
            type="button"
            onClick={() => void handleImport("replace")}
            disabled={!canImport}
            title={canImport ? undefined : importBlockedReason}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-xs font-semibold transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-60",
              canImport
                ? "border-saffron-400/50 bg-saffron-400/15 text-saffron-200 hover:border-saffron-400/80 hover:bg-saffron-400/25"
                : "border-white/10 bg-white/[0.03] text-zinc-500",
            )}
          >
            {importing || resolving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RouteIcon className="h-3.5 w-3.5" />
            )}
            {importing
              ? "Replacing…"
              : resolving
                ? "Expanding the short link…"
                : stops.length
                  ? `Replace all ${stops.length} stops`
                  : "Use as the route"}
          </button>
          <button
            type="button"
            onClick={() => void handleImport("add")}
            disabled={!canImport}
            title={canImport ? undefined : importBlockedReason}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-xs font-semibold text-white transition-all duration-300 hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add to the end
          </button>
          {undo && (
            <button
              type="button"
              onClick={() => {
                commitRoute({
                  stops: undo.stops,
                  routeGeometry: undo.geometry,
                  routeDistanceKm: undo.distanceKm,
                  // The road being put back was measured for these stops.
                  routeSignature: undo.geometry.length ? routeSignature(undo.stops) : "",
                });
                setUndo(null);
                setImportNote(`Put the previous ${undo.stops.length} stops back.`);
              }}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-white/25 hover:text-white"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo replace
            </button>
          )}
        </div>
        {/* When a button cannot be pressed, say why next to it — a pale button
            that swallows the click is not an explanation. */}
        {!canImport && importBlockedReason && importBlockedReason !== linkStatus && (
          <p className="mt-2 text-[11px] text-amber-200">{importBlockedReason}</p>
        )}
        {importError && <p className="mt-2 text-[11px] text-amber-200">{importError}</p>}
        {serverCheck.state !== "idle" && (
          <p
            className={cn(
              "mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed",
              serverCheck.state === "checking"
                ? "text-zinc-500"
                : serverCheck.reachable
                  ? "text-zinc-400"
                  : "text-amber-200",
            )}
          >
            {serverCheck.state === "checking" ? (
              <>
                <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
                Asking this server whether it can reach the maps…
              </>
            ) : (
              <>
                <span
                  className={cn(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    serverCheck.reachable ? "bg-emerald-400" : "bg-amber-400",
                  )}
                  aria-hidden="true"
                />
                {serverCheck.text}
              </>
            )}
          </p>
        )}
        {importNote && <p className="mt-2 text-[11px] text-emerald-300">{importNote}</p>}

        {/* Named, not counted: a red line through every stop this paste threw
            away, and the ones it brought in — the link's points and the towns
            filled in on the way — in green. */}
        {changes.length > 0 && (
          <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Route changes
              <span className="ml-2 normal-case tracking-normal text-zinc-400">
                {[
                  changes.filter((change) => change.kind === "removed").length
                    ? `${changes.filter((change) => change.kind === "removed").length} removed`
                    : "",
                  changes.filter((change) => change.kind === "added").length
                    ? `${changes.filter((change) => change.kind === "added").length} added`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {changes.map((change, changeIndex) => (
                <li
                  key={`${change.kind}-${change.name}-${changeIndex}`}
                  className={
                    change.kind === "removed"
                      ? "flex items-center gap-1.5 rounded-full border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-300"
                      : "flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300"
                  }
                >
                  <span className={change.kind === "removed" ? "line-through" : undefined}>
                    {change.kind === "removed" ? "− " : "+ "}
                    {change.name}
                  </span>
                  {change.kind === "removed" && change.stop && (
                    <button
                      type="button"
                      onClick={() => restoreChange(change)}
                      title={`Put ${change.name} back where it was`}
                      aria-label={`Undo removing ${change.name}`}
                      className="inline-flex items-center gap-0.5 rounded-full border border-red-300/40 px-1.5 py-px text-[10px] font-bold text-red-100 transition-colors hover:bg-red-400/20 hover:text-white"
                    >
                      <Undo2 className="h-2.5 w-2.5" /> Undo
                    </button>
                  )}
                  {change.kind === "added" && (
                    <button
                      type="button"
                      onClick={() => restoreChange(change)}
                      title="Dismiss this note (the stop stays)"
                      aria-label={`Dismiss the note for ${change.name}`}
                      className="text-[10px] text-emerald-200/70 transition-colors hover:text-white"
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {changes.some((change) => change.kind === "removed" && change.stop) && (
              <button
                type="button"
                onClick={() => restoreAllRemoved()}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-semibold text-zinc-300 transition-colors hover:border-white/30 hover:text-white"
              >
                <RotateCcw className="h-3 w-3" /> Put every removed stop back
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Road ── */}
      <div className="rounded-2xl border border-white/[0.08] bg-ink-950/50 p-4">
        <p className="flex items-center gap-2 text-xs font-bold text-white">
          <RouteIcon className="h-4 w-4 text-saffron-300" aria-hidden="true" />
          Road route
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          {routeGeometry.length
            ? `${routeGeometry.length} points of real road stored${
                routeDistanceKm > 0 ? `, measured at ${formatKm(routeDistanceKm)}` : ""
              }. Refetch after moving a stop so distances follow the road again.`
            : "No road geometry yet — distances are measured straight between stops. Fetch the road to measure the actual route."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleFetchRoad()}
            disabled={fetching || stops.length < 2}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-xs font-semibold text-white transition-all duration-300 hover:border-white/25 disabled:opacity-40"
          >
            {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RouteIcon className="h-3.5 w-3.5" />}
            {routeGeometry.length ? "Refetch road route" : "Fetch road route"}
          </button>
          <button
            type="button"
            onClick={() => void handleAddMajorStops()}
            disabled={stopBusy || stops.length < 2}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-xs font-semibold text-white transition-all duration-300 hover:border-white/25 disabled:opacity-40"
          >
            {stopBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPinned className="h-3.5 w-3.5" />}
            Add major stops on the way
          </button>
          {stops.length > 0 && (
            <button
              type="button"
              onClick={() => clearAllStops()}
              className="ml-auto flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs font-semibold text-zinc-400 transition-colors hover:border-red-400/40 hover:text-red-300"
              title="Take every stop off the route — each one stays listed in red and can be put back"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear all stops
            </button>
          )}
          {stops.length < 2 && (
            <span className="text-[11px] text-zinc-500">Needs at least two stops.</span>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          The towns between the first and last stop — Mandi, Kullu, Manali, Keylong, Leh — chosen from
          the map for the road you have drawn. A linked route of just two stops gets them filled in
          for you when it is imported.
        </p>
        {roadNote && <p className="mt-2 text-[11px] text-emerald-300">{roadNote}</p>}
        {fetchError && <p className="mt-2 text-[11px] text-amber-200">{fetchError}</p>}
        {stopError && <p className="mt-2 text-[11px] text-amber-200">{stopError}</p>}
        {stopNote && <p className="mt-2 text-[11px] text-emerald-300">{stopNote}</p>}
      </div>

      {/* ── Each stop ── */}
      {stops.map((stop, index) => {
        const role = roleOf(index, stops.length);
        return (
          <div key={`${stop.name}-${index}`} className="rounded-2xl border border-white/[0.08] bg-ink-950/50 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="flex flex-wrap items-center gap-2 text-xs font-bold text-white">
                <span
                  className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white ${
                    role === "start" ? "bg-emerald-500" : role === "end" ? "bg-red-500" : "bg-[#f5b301] text-ink-950"
                  }`}
                >
                  {index + 1}
                </span>
                {ROLE_COPY[role]} · {STATUS_COPY[stop.status]}
                <span className="font-normal text-zinc-500">{formatKm(totals[index] ?? 0)}</span>
                {/* Green, because this is a stop that was added for you. */}
                {changes.some(
                  (change) =>
                    change.kind === "added" &&
                    change.name.trim().toLowerCase() === stop.name.trim().toLowerCase(),
                ) && (
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.1em] text-emerald-300">
                    Added
                  </span>
                )}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(index, index - 1)}
                  disabled={index === 0}
                  aria-label={`Move ${stop.name} earlier`}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:border-white/25 hover:text-white disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, index + 1)}
                  disabled={index === stops.length - 1}
                  aria-label={`Move ${stop.name} later`}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:border-white/25 hover:text-white disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeStop(index)}
                  aria-label={`Remove ${stop.name}`}
                  title="Remove this stop — it can be put back from the red list below"
                  className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:border-red-400/40 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor={`stop-name-${index}`}>
                  Name
                </label>
                <input
                  id={`stop-name-${index}`}
                  value={stop.name}
                  onChange={(event) => patch(index, { name: event.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor={`stop-status-${index}`}>
                  Status
                </label>
                <select
                  id={`stop-status-${index}`}
                  value={stop.status}
                  onChange={(event) => setStatus(index, event.target.value as LiveStop["status"])}
                  className={inputCls}
                >
                  {STATUSES.map((value) => (
                    <option key={value} value={value} className="bg-ink-900">
                      {STATUS_COPY[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor={`stop-lat-${index}`}>
                  Latitude
                </label>
                <input
                  id={`stop-lat-${index}`}
                  type="number"
                  step="0.0001"
                  value={stop.lat}
                  onChange={(event) => patch(index, { lat: Number(event.target.value) })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor={`stop-lng-${index}`}>
                  Longitude
                </label>
                <input
                  id={`stop-lng-${index}`}
                  type="number"
                  step="0.0001"
                  value={stop.lng}
                  onChange={(event) => patch(index, { lng: Number(event.target.value) })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor={`stop-state-${index}`}>
                  State / region
                </label>
                <input
                  id={`stop-state-${index}`}
                  value={stop.state ?? ""}
                  placeholder="Punjab, India"
                  onChange={(event) => patch(index, { state: event.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor={`stop-altitude-${index}`}>
                  Altitude
                </label>
                <input
                  id={`stop-altitude-${index}`}
                  value={stop.altitude ?? ""}
                  placeholder="1,150 ft"
                  onChange={(event) => patch(index, { altitude: event.target.value })}
                  className={inputCls}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor={`stop-note-${index}`}>
                  Note
                </label>
                <input
                  id={`stop-note-${index}`}
                  value={stop.note}
                  onChange={(event) => patch(index, { note: event.target.value })}
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
