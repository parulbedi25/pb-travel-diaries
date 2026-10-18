import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
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
import { fetchRoadGeometry, type LatLng } from "../utils/routing";
import { routeEmbedUrl, routeLinkUrl } from "../utils/mapEmbed";
import { fitViewExact, makeMercatorProjector } from "../utils/mercator";
import TileBasemap, { TileAttribution } from "../components/TileBasemap";
import { cumulativeKm, formatKm } from "../utils/routeProgress";

/**
 * Editor for the live tracker's route.
 *
 * Two surfaces, because a Google map cannot be drawn on:
 *
 *  1. "Route on Google Maps" — a real Google map of the route, rendered through
 *     the keyless embed endpoint. It is the honest geography, and it updates as
 *     you edit. You cannot click it for coordinates (it is a sealed iframe).
 *  2. "Place the stops" — the placement surface. A local grid with numbered,
 *     draggable pins: click to drop a stop, drag to move it. It draws only
 *     lines and pins, so it never depends on a tile server and can never come
 *     up blank.
 *
 * The order of the list is the order of the journey: the first stop is the
 * start, the last is the destination, and the tracker draws them green and red.
 */

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-saffron-400/60 focus:outline-none transition-colors";
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

export default function RouteStopsEditor({
  stops,
  routeGeometry,
  onChange,
  onGeometryChange,
}: {
  stops: LiveStop[];
  routeGeometry: LatLng[];
  onChange: (stops: LiveStop[]) => void;
  onGeometryChange: (geometry: LatLng[]) => void;
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

  const liveEmbedUrl = useMemo(() => routeEmbedUrl(stops), [stops]);
  const linkUrl = useMemo(() => routeLinkUrl(stops), [stops]);

  // Dragging changes coordinates many times a second; only reload the map once
  // the pin has settled.
  const [previewUrl, setPreviewUrl] = useState(liveEmbedUrl);
  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewUrl(liveEmbedUrl), 600);
    return () => window.clearTimeout(timer);
  }, [liveEmbedUrl]);

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
      {/* ── The real map ── */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-950/50">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <p className="flex items-center gap-2 text-xs font-bold text-white">
            <MapPinned className="h-4 w-4 text-saffron-300" aria-hidden="true" />
            Route on Google Maps
          </p>
          <a
            href={linkUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400 transition-all duration-300 hover:border-white/25 hover:text-white"
          >
            Open
            <RouteIcon className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
        <div className="map-frame map-paper relative h-[240px] w-full border-t border-white/[0.08] bg-ink-900">
          {stops.length ? (
            <iframe
              src={previewUrl}
              title="Google Maps preview of the route"
              className="h-full w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          ) : (
            <div className="grid h-full w-full place-items-center px-6 text-center text-xs text-zinc-500">
              Add a stop and the route appears here.
            </div>
          )}
        </div>
        <p className="border-t border-white/[0.08] px-4 py-2.5 text-[11px] leading-relaxed text-zinc-500">
          Google draws the road and the A/B markers. The exact pins below are yours — the first is
          the green start, the last is the red destination.
        </p>
      </div>

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
          <TileBasemap
            view={backdropView}
            width={size.width}
            height={size.height}
            className="pointer-events-none absolute inset-0 overflow-hidden"
          />
          <TileAttribution className="pointer-events-none absolute bottom-1 right-1.5 text-[8px] text-zinc-500" />

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
                  onChange={(event) => patch(index, { status: event.target.value as LiveStop["status"] })}
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
