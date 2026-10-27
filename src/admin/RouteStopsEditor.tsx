import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Link2,
  Loader2,
  MapPinned,
  Plus,
  Route as RouteIcon,
  Search,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { LiveStop } from "../store/siteContent";
import {
  SOURCE_LABELS,
  describePoint,
  parseRouteLink,
  type MapLinkSource,
  type RoutePoint,
} from "../utils/mapLinks";
import { siteApi } from "../api/siteApi";
import { fetchRoadGeometry, type LatLng } from "../utils/routing";
import { fitViewExact, makeMercatorProjector } from "../utils/mercator";
import VectorBasemap from "../components/VectorBasemap";
import { cumulativeKm, formatKm } from "../utils/routeProgress";
import { cascadeHereNow } from "../utils/liveRoute";
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

const STATUSES: LiveStop["status"][] = ["done", "live", "next"];

const STATUS_COPY: Record<LiveStop["status"], string> = {
  done: "Ridden",
  live: "Here now",
  next: "Still to come",
};

const ROLE_COPY = { start: "Start", end: "Destination", mid: "On the way" } as const;

type Role = keyof typeof ROLE_COPY;

const roleOf = (index: number, total: number): Role =>
  index === 0 ? "start" : index === total - 1 ? "end" : "mid";

const round = (n: number) => Math.round(n * 1e4) / 1e4;

/* ------------------------------------------------------------------ *
 * Placement grid: geography in, percentages out.
 * ------------------------------------------------------------------ */

/**
 * Look a place up by name. Nominatim (OpenStreetMap) needs no key; it is only
 * ever called when you press Find, and failing is not fatal — the coordinates
 * can always be typed in by hand.
 */
async function geocode(
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(
    query,
  )}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const json = (await response.json()) as { lat?: string; lon?: string }[];
  const first = Array.isArray(json) ? json[0] : undefined;
  if (!first) return null;
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat: round(lat), lng: round(lng) } : null;
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
): Promise<{ name: string; state?: string } | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&lat=${lat}&lon=${lng}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const json = (await response.json()) as {
    name?: string;
    display_name?: string;
    address?: Record<string, string>;
  };
  const name = (json.name || json.display_name?.split(",")[0] || "").trim();
  if (!name) return null;
  const state = json.address?.state ?? json.address?.state_district;
  return state ? { name, state } : { name };
}

/** The services this can name in the selector. */
const LINK_SOURCES: MapLinkSource[] = ["google", "bing", "apple", "openstreetmap", "other"];

export default function RouteStopsEditor({
  stops,
  routeGeometry,
  mapSource,
  onChange,
  onGeometryChange,
  onMapSourceChange,
}: {
  stops: LiveStop[];
  routeGeometry: LatLng[];
  /** Which map service the last pasted link came from — picked, never typed. */
  mapSource: MapLinkSource;
  onChange: (stops: LiveStop[]) => void;
  onGeometryChange: (geometry: LatLng[]) => void;
  onMapSourceChange: (source: MapLinkSource) => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoomStep, setZoomStep] = useState(0);
  const [link, setLink] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importNote, setImportNote] = useState("");
  const [replaceArmed, setReplaceArmed] = useState(false);
  const [expanded, setExpanded] = useState<{ link: string; url: string } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [expandError, setExpandError] = useState("");

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
  const totals = useMemo(() => cumulativeKm(stops, routeGeometry), [stops, routeGeometry]);

  // The replace button arms for a moment rather than asking with a dialog:
  // it cannot fire by accident, and it cannot trap the operator behind a modal.
  useEffect(() => {
    if (!replaceArmed) return;
    const timer = window.setTimeout(() => setReplaceArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [replaceArmed]);

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
      onChange([...stops, next]);
    },
    [onChange, stops],
  );

  /**
   * Statuses are not independent. "Here now" is a statement about the whole
   * route — everything behind it has been ridden, everything ahead is still to
   * come — so choosing it rewrites the other stops rather than leaving the
   * route claiming two current positions.
   */
  const setStatus = useCallback(
    (index: number, status: LiveStop["status"]) => {
      if (status === "live") {
        onChange(cascadeHereNow(stops, index));
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
      onChange(reordered);
    },
    [onChange, stops],
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

  const handleFind = async () => {
    const name = query.trim();
    if (!name) return;
    setLooking(true);
    setLookError("");
    try {
      const found = await geocode(name);
      if (!found) {
        setLookError(`Could not find “${name}”. Add it by clicking the grid or typing coordinates.`);
        return;
      }
      onChange([
        ...stops,
        { name, note: "", status: "next", lat: found.lat, lng: found.lng },
      ]);
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
  const trimmedLink = link.trim();
  const effectiveLink = expanded && expanded.link === trimmedLink ? expanded.url : trimmedLink;

  // Read while typing: the service and the points are known before anything is
  // added, so the operator can see what the link says without committing to it.
  const parsedLink = useMemo(() => parseRouteLink(effectiveLink), [effectiveLink]);

  const linkStatus = !trimmedLink
    ? "Selected automatically from whichever link you paste."
    : resolving
      ? "Short link — expanding it to read the route…"
      : expandError
        ? expandError
        : parsedLink.message;

  useEffect(() => {
    if (!trimmedLink) {
      setExpanded(null);
      setExpandError("");
      return;
    }
    if (expanded?.link === trimmedLink) return;
    if (!parseRouteLink(trimmedLink).shortLink) {
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
      void siteApi
        .resolveMapLink(trimmedLink)
        .then((url) => {
          if (!cancelled) setExpanded({ link: trimmedLink, url });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setExpandError(
            error instanceof Error
              ? `${error.message} Open the short link and paste the address bar instead.`
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
  }, [trimmedLink, expanded?.link]);

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
   * half is looked up — the name from Nominatim's reverse lookup, the position
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
    let name = point.label;
    let state: string | undefined;

    if (lat === undefined || lng === undefined) {
      if (!name) return null;
      const found = await geocode(name);
      if (!found) return null;
      lat = found.lat;
      lng = found.lng;
    } else if (!name) {
      const looked = await reverseLookup(lat, lng);
      if (looked) {
        name = looked.name;
        state = looked.state;
      }
    }

    const role = index === 0 ? "Start" : index === total - 1 ? "Destination" : "On the way";
    const status: LiveStop["status"] = index === 0 ? "live" : "next";
    const stop: LiveStop = {
      name: name ?? `${lat.toFixed(3)}, ${lng.toFixed(3)}`,
      note: `${role} · from ${SOURCE_LABELS[source]}`,
      status,
      lat: round(lat),
      lng: round(lng),
    };
    if (state) stop.state = state;
    return stop;
  };

  const handleImport = async (mode: "add" | "replace") => {
    if (!parsedLink.ok || importing) return;
    setImporting(true);
    setImportError("");
    setImportNote("");

    const built: LiveStop[] = [];
    const unread: string[] = [];

    for (const [index, point] of parsedLink.points.entries()) {
      const resolved = await resolvePoint(point, index, parsedLink.points.length, parsedLink.source);
      if (resolved) built.push(resolved);
      else unread.push(point.label ?? `${point.lat}, ${point.lng}`);
    }

    setImporting(false);
    if (unread.length) {
      setImportError(`Could not place ${unread.join(", ")}. Add it by hand below and try the rest.`);
      return;
    }

    const existing = mode === "replace" ? [] : stops;
    // Only one stop can be "here now". Adding a route behind an existing one
    // must not claim PB is in two places, so the imported stops join as still
    // to come; a fresh route starts at its own start.
    if (existing.length) {
      for (const stop of built) stop.status = "next";
    }
    // Bookkeeping, not paranoia: a route imported twice should not double every
    // stop, and the same coordinate twice is the same place.
    const seen = new Set(existing.map((stop) => `${stop.lat.toFixed(4)},${stop.lng.toFixed(4)}`));
    let skipped = 0;
    const fresh = built.filter((stop, index) => {
      const key = `${stop.lat.toFixed(4)},${stop.lng.toFixed(4)}`;
      // The first and last points define the journey — a round trip that comes
      // back to a stop already on the tracker still needs its ride home.
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

    onChange([...existing, ...fresh]);
    // The stored road geometry belongs to the old stops; leaving it would draw
    // a route through points that are no longer on it.
    if (routeGeometry.length) onGeometryChange([]);
    setImportNote(
      `${mode === "replace" ? "Route replaced with" : "Added"} ${fresh.length} ${
        fresh.length === 1 ? "stop" : "stops"
      } from ${SOURCE_LABELS[parsedLink.source]}${
        skipped ? ` — ${skipped} already on the tracker` : ""
      }.${routeGeometry.length ? " Fetch the road route again below." : ""}`,
    );
    setLink("");
    setReplaceArmed(false);
  };

  const handleFetchRoad = async () => {
    if (stops.length < 2) return;
    setFetching(true);
    setFetchError("");
    const result = await fetchRoadGeometry(stops);
    setFetching(false);
    if (result.ok) {
      onGeometryChange(result.geometry);
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
            attributionClassName="pointer-events-none absolute bottom-1 right-1.5 text-[8px] text-zinc-500"
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
                onPointerUp={() => setDragIndex(null)}
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
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleFind();
              }
            }}
            placeholder="Add a stop by name — Anandpur Sahib"
            aria-label="Add a stop by name"
            className={inputCls}
          />
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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (!replaceArmed) {
                setReplaceArmed(true);
                return;
              }
              void handleImport("replace");
            }}
            disabled={!parsedLink.ok || importing}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-xs font-semibold transition-all duration-300 disabled:opacity-40",
              replaceArmed
                ? "border-saffron-400/60 bg-saffron-400/15 text-saffron-300"
                : "border-white/10 bg-white/[0.05] text-white hover:border-white/25",
            )}
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RouteIcon className="h-3.5 w-3.5" />}
            {replaceArmed ? `Replace all ${stops.length} stops?` : "Use as the route"}
          </button>
          <button
            type="button"
            onClick={() => void handleImport("add")}
            disabled={!parsedLink.ok || importing}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-xs font-semibold text-white transition-all duration-300 hover:border-white/25 disabled:opacity-40"
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add to the end
          </button>
        </div>
        {importError && <p className="mt-2 text-[11px] text-amber-200">{importError}</p>}
        {importNote && <p className="mt-2 text-[11px] text-emerald-300">{importNote}</p>}
      </div>

      {/* ── Road ── */}
      <div className="rounded-2xl border border-white/[0.08] bg-ink-950/50 p-4">
        <p className="flex items-center gap-2 text-xs font-bold text-white">
          <RouteIcon className="h-4 w-4 text-saffron-300" aria-hidden="true" />
          Road route
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          {routeGeometry.length
            ? `${routeGeometry.length} points of real road stored. Refetch after moving a stop so distances follow the road again.`
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
          {stops.length < 2 && (
            <span className="text-[11px] text-zinc-500">Needs at least two stops.</span>
          )}
        </div>
        {fetchError && <p className="mt-2 text-[11px] text-amber-200">{fetchError}</p>}
      </div>

      {/* ── Each stop ── */}
      {stops.map((stop, index) => {
        const role = roleOf(index, stops.length);
        return (
          <div key={`${stop.name}-${index}`} className="rounded-2xl border border-white/[0.08] bg-ink-950/50 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs font-bold text-white">
                <span
                  className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white ${
                    role === "start" ? "bg-emerald-500" : role === "end" ? "bg-red-500" : "bg-[#f5b301] text-ink-950"
                  }`}
                >
                  {index + 1}
                </span>
                {ROLE_COPY[role]} · {STATUS_COPY[stop.status]}
                <span className="font-normal text-zinc-500">{formatKm(totals[index] ?? 0)}</span>
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
                  onClick={() => onChange(stops.filter((_, i) => i !== index))}
                  aria-label={`Remove ${stop.name}`}
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
