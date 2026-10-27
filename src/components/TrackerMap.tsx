import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Satellite } from "lucide-react";
import type { LiveStop } from "../store/siteContent";
import type { LiveStatus } from "../hooks/useLiveLocation";
import { cn } from "../utils/cn";
import VectorBasemap from "./VectorBasemap";
import { fitViewExact, makeMercatorProjector } from "../utils/mercator";
import { cumulativeKm, formatKm } from "../utils/routeProgress";
import { fetchRoadGeometry, splitRouteAtProgress, type LatLng } from "../utils/routing";

/**
 * The live tracker's map.
 *
 * The map underneath is OpenStreetMap, drawn from tiles at a centre and zoom
 * we choose ourselves. That is what makes it possible to draw on top of it: we
 * know exactly how the map is projected (see utils/mercator.ts), so the
 * checkpoints and the line sit on the streets they belong to.
 *
 * The line is ours, not the map's: solid yellow over what is ridden, dashed
 * yellow marching towards the destination over what is still to come. It
 * follows the real road — the one stored in the dashboard if that has been
 * fetched, otherwise the one asked for here — and only falls back to straight
 * segments between the checkpoints when no road can be had at all.
 *
 * Everything drawn sits inside the band between the live badge across the top
 * of the panel and the route strip along the bottom, so no checkpoint is ever
 * hidden behind either.
 */

export interface TrackerMapProps {
  stops: LiveStop[];
  /** Road fetched in the dashboard; drawn instead of straight segments. */
  routeGeometry: LatLng[];
  live: { lat: number; lng: number };
  liveName: string;
  liveState: string;
  status: LiveStatus;
  /** "Ping 2m ago" / "Window closed · 6 AM IST" — shown on the strip. */
  pingLabel: string;
  /**
   * Draw each stop's name under its checkpoint.
   *
   * On by default, and the name is the one the rider typed into the dashboard —
   * Nangal, Anandpur Sahib, Ropar — never a name the basemap happens to have
   * for that ground. Those basemap names stay switched off (see VectorBasemap):
   * the map carries the rider's own checkpoints, and nothing else.
   */
  labels?: boolean;
}

/** Space the drawn route has to keep clear of. */
function useBandInsets(): { top: number; bottom: number } {
  // The badge across the top and the strip along the bottom; both grow a
  // little at the small breakpoint.
  const [insets, setInsets] = useState({ top: 92, bottom: 152 });
  useEffect(() => {
    const wide =
      typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 640px)") : null;
    const apply = () =>
      setInsets(wide?.matches ? { top: 110, bottom: 174 } : { top: 92, bottom: 152 });
    apply();
    wide?.addEventListener?.("change", apply);
    return () => wide?.removeEventListener?.("change", apply);
  }, []);
  return insets;
}

/**
 * North is up, and says so.
 *
 * The map is drawn north-up on purpose — the bearing is pinned to 0 so the
 * overlay's mercator placement and MapLibre's drawing can never disagree — so
 * this is not a control but a statement: a compass rose with a saffron north
 * needle, a muted south one and the cardinal ticks. It sits in the top-right
 * of the map panel, under the tile credit, where a compass belongs and where
 * it collides with nothing: the live plate owns the top-left, the route strip
 * owns the bottom.
 */
function MapCompass() {
  return (
    <div
      className="pointer-events-none absolute right-4 top-8 z-10 sm:right-5 sm:top-9"
      role="img"
      aria-label="Compass: north is up"
    >
      <div className="rounded-full border border-white/15 bg-ink-950/70 shadow-lg shadow-black/40 backdrop-blur-md">
        <svg viewBox="0 0 44 44" className="h-11 w-11" aria-hidden="true">
          {/* The ring, and a dotted inner line so it reads as an instrument. */}
          <circle cx="22" cy="22" r="21" fill="none" stroke="rgba(255,255,255,0.16)" />
          <circle
            cx="22"
            cy="22"
            r="16.5"
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeDasharray="1 3"
          />
          {/* The four cardinal ticks. */}
          <g stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" strokeLinecap="round">
            <line x1="22" y1="2.5" x2="22" y2="5" />
            <line x1="22" y1="39" x2="22" y2="41.5" />
            <line x1="2.5" y1="22" x2="5" y2="22" />
            <line x1="39" y1="22" x2="41.5" y2="22" />
          </g>
          {/* Needle: saffron for north, muted steel for south. */}
          <polygon points="22,12 25,22.5 19,22.5" fill="#f5b301" />
          <polygon points="22,32 19,22.5 25,22.5" fill="rgba(255,255,255,0.40)" />
          <text
            x="22"
            y="10"
            textAnchor="middle"
            fontSize="6.5"
            fontWeight="700"
            fill="#ffdf8a"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            N
          </text>
        </svg>
      </div>
    </div>
  );
}

const ROAD_CACHE_PREFIX = "pb_road_v1:";
const ROAD_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const roadKey = (stops: LiveStop[]): string =>
  ROAD_CACHE_PREFIX + stops.map((s) => `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`).join(";");

/**
 * The road the ride follows, if we can get hold of it.
 *
 * Geometry stored from the dashboard wins — that is the one with no third
 * party in the loop when a visitor loads the page. Failing that, ask the
 * routing service here so the line still hugs the road, and remember the
 * answer for a week so it is one request, not one per visit. When the service
 * cannot be reached the caller draws straight segments, which is why the
 * return value is allowed to be null.
 */
function useRoadGeometry(stops: LiveStop[], stored: LatLng[]): LatLng[] | null {
  const [road, setRoad] = useState<LatLng[] | null>(null);

  // Depend on what actually matters, not on array identity: the tracker
  // re-renders on every live ping, and a fresh `stops` array each time used to
  // re-run this effect — re-parsing localStorage and re-requesting the road
  // every second. The key changes only when a stop really moves.
  const stopsKey = roadKey(stops);
  const storedCount = stored.length;
  const stopsRef = useRef(stops);
  stopsRef.current = stops;

  useEffect(() => {
    if (storedCount >= 2 || stopsRef.current.length < 2) {
      setRoad(null);
      return;
    }

    // This is the one thing still kept in the browser, deliberately: a
    // disposable cache of a third-party road route, worth a network request
    // but not worth a database round-trip. It never holds site content,
    // accounts or history — those live in MariaDB.
    const key = stopsKey;
    try {
      const cached = window.localStorage.getItem(key);
      if (cached) {
        const parsed = JSON.parse(cached) as { t?: number; geometry?: LatLng[] };
        const fresh = parsed?.t && Date.now() - parsed.t < ROAD_CACHE_MAX_AGE_MS;
        if (fresh && Array.isArray(parsed.geometry) && parsed.geometry.length >= 2) {
          setRoad(parsed.geometry);
          return;
        }
      }
    } catch {
      // A missing or unreadable cache just means we ask again.
    }

    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchRoadGeometry(stopsRef.current);
        if (cancelled || !result.ok || result.geometry.length < 2) return;
        setRoad(result.geometry);
        try {
          window.localStorage.setItem(
            key,
            JSON.stringify({ t: Date.now(), geometry: result.geometry }),
          );
        } catch {
          // Storage may be full or blocked; the road still draws this visit.
        }
      } catch {
        // No road available — straight segments are an honest fallback.
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by coordinates on purpose
  }, [stopsKey, storedCount]);

  return road;
}

export default function TrackerMap({
  stops,
  routeGeometry,
  live,
  liveName,
  liveState,
  status,
  pingLabel,
  labels = true,
}: TrackerMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // The overlay has to match the map pixel for pixel, so the panel is measured
  // rather than assumed.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = (w?: number, h?: number) => {
      const width = w ?? host.clientWidth;
      const height = h ?? host.clientHeight;
      if (width > 0 && height > 0) setSize({ width, height });
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

  const width = size.width || 600;
  const height = size.height || 400;
  const insets = useBandInsets();

  const road = useRoadGeometry(stops, routeGeometry);
  const geometry = useMemo(
    () =>
      routeGeometry.length >= 2
        ? routeGeometry
        : road && road.length >= 2
          ? road
          : stops.map((s) => [s.lat, s.lng] as LatLng),
    [routeGeometry, road, stops],
  );

  // What has to stay in view: every checkpoint, plus wherever PB is. The road
  // is deliberately left out of the fit — it can run past the first and last
  // stop, and fitting to it would push the checkpoints towards the edges.
  const frame = useMemo(
    () => [...stops.map((s) => ({ lat: s.lat, lng: s.lng })), { lat: live.lat, lng: live.lng }],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stops, live.lat, live.lng],
  );

  // Fit into the band only, then slide the drawing down into it. The map still
  // fills the whole panel behind the badge and the strip.
  const bandHeight = Math.max(height - insets.top - insets.bottom, 140);
  // The exact zoom, not a whole level: these tiles are ours, so the route can
  // be made to fill the band edge to edge rather than landing on whatever
  // fraction of it a rounded-down zoom happens to give. The pad is just enough
  // for the pin and the name plate hanging under it.
  const view = useMemo(
    () => fitViewExact(frame, width, bandHeight, { padX: 24, padY: 28 }),
    [frame, width, bandHeight],
  );
  const offsetY = (insets.top - insets.bottom) / 2;
  const projector = useMemo(
    () => makeMercatorProjector(view, width, height, offsetY),
    [view, width, height, offsetY],
  );

  // The map is centred on whatever our overlay puts at the middle of the
  // panel, which is not the middle of the band.
  const mapCentre = projector.toLatLng(50, 50);
  // Re-centring fetches a fresh set of tiles, so wait for the view to settle
  // rather than pulling new ones on every step of a resize.
  const [mapView, setMapView] = useState(() => ({
    lat: mapCentre.lat,
    lng: mapCentre.lng,
    zoom: view.zoom,
  }));
  useEffect(() => {
    const timer = window.setTimeout(
      () => setMapView({ lat: mapCentre.lat, lng: mapCentre.lng, zoom: view.zoom }),
      500,
    );
    return () => window.clearTimeout(timer);
  }, [mapCentre.lat, mapCentre.lng, view.zoom]);

  const totals = useMemo(() => cumulativeKm(stops, routeGeometry), [stops, routeGeometry]);

  const toPx = useCallback(
    (point: LatLng) => {
      const projected = projector.toXY({ lat: point[0], lng: point[1] });
      return { x: (projected.x / 100) * width, y: (projected.y / 100) * height };
    },
    [projector, width, height],
  );
  const toPct = useCallback(
    (point: { lat: number; lng: number }) => projector.toXY(point),
    [projector],
  );

  const { covered, remaining } = useMemo(
    () => splitRouteAtProgress(geometry, stops),
    [geometry, stops],
  );
  const toPath = (points: LatLng[]) =>
    points.length
      ? points
          .map((point, index) => {
            const p = toPx(point);
            return `${index === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
          })
          .join(" ")
      : "";
  const coveredPath = toPath(covered);
  const remainingPath = toPath(remaining);

  const count = stops.length;
  const liveIndex = stops.findIndex((stop) => stop.status === "live");
  const lastDone = stops.reduce((acc, stop, i) => (stop.status === "done" ? i : acc), -1);
  const progressIndex = liveIndex >= 0 ? liveIndex : lastDone >= 0 ? lastDone : 0;
  const progressPct = count > 1 ? (progressIndex / (count - 1)) * 100 : 0;
  const edge = count > 0 ? 50 / count : 0;

  // A checkpoint marked "here now" in the dashboard is where PB is, so the
  // radar, the pin and the label all sit on it and agree with each other. The
  // GPS feed is only the fallback for when no checkpoint is marked live.
  const liveHere = liveIndex >= 0 ? stops[liveIndex] : live;
  const liveLabel = liveIndex >= 0 ? stops[liveIndex].name : `${liveName}, ${liveState}`;
  const livePoint = toPct(liveHere);

  return (
    <div ref={hostRef} className="absolute inset-0">
      {/* The map: OpenStreetMap with no place names on it, pointer-dead so
          the overlay stays true. */}
      <div className="tracker-map map-paper absolute inset-0 overflow-hidden">
        {count > 0 ? (
          <VectorBasemap
            view={mapView}
            width={width}
            height={height}
            className="absolute inset-0"
            attributionClassName="pointer-events-auto absolute right-3 top-3 text-[9px] text-zinc-500"
          />
        ) : (
          <div className="grid h-full w-full place-items-center px-6 text-center text-xs text-zinc-500">
            Add at least one stop in the dashboard and this panel becomes a live map of the route.
          </div>
        )}
      </div>

      {/* A soft edge top and bottom so the overlay plates stay readable. */}
      <div className="tracker-map-veil pointer-events-none absolute inset-0" aria-hidden="true" />

      {count > 0 && <MapCompass />}


      {/* PB's route: covered solid, still to come dashed and marching on. */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
      >
        {/* A dark casing under both halves, so the yellow reads on a light map. */}
        {remainingPath && (
          <path
            d={remainingPath}
            fill="none"
            stroke="rgba(9,9,9,0.5)"
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray="9 7"
          />
        )}
        {coveredPath && (
          <path d={coveredPath} fill="none" stroke="rgba(9,9,9,0.5)" strokeWidth={6} strokeLinecap="round" />
        )}
        {remainingPath && (
          <path
            d={remainingPath}
            fill="none"
            stroke="#f5b301"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray="9 7"
            className="animate-route-dash"
          />
        )}
        {coveredPath && (
          <path d={coveredPath} fill="none" stroke="#f5b301" strokeWidth={3.5} strokeLinecap="round" />
        )}
      </svg>

      {/* Radar rings on wherever PB actually is. */}
      {liveIndex >= 0 && (
        <>
          <div
            className="shrink-0 aspect-square pointer-events-none absolute h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.05]"
            style={{ left: `${livePoint.x}%`, top: `${livePoint.y}%` }}
            aria-hidden="true"
          />
          <div
            className="shrink-0 aspect-square pointer-events-none absolute h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.06]"
            style={{ left: `${livePoint.x}%`, top: `${livePoint.y}%` }}
            aria-hidden="true"
          />
          <div
            className="shrink-0 aspect-square pointer-events-none absolute h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.08]"
            style={{ left: `${livePoint.x}%`, top: `${livePoint.y}%` }}
            aria-hidden="true"
          />
        </>
      )}

      {/* The checkpoints. */}
      {stops.map((stop, index) => {
        const point = toPct(stop);
        const isStart = index === 0;
        const isEnd = index === count - 1;
        const isLive = stop.status === "live";
        return (
          <div
            key={`${stop.name}-${index}`}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
          >
            <button
              type="button"
              className="group relative grid place-items-center focus:outline-none"
              title={`${isStart ? "Start" : isEnd ? "Destination" : "Checkpoint"} · ${stop.name}${
                stop.note ? ` — ${stop.note}` : ""
              }`}
            >
              {isLive && status === "live" && (
                <>
                  <span className="shrink-0 aspect-square absolute h-10 w-10 rounded-full bg-saffron-400/40 animate-radar" aria-hidden="true" />
                  <span className="shrink-0 aspect-square absolute h-6 w-6 rounded-full bg-saffron-400/30 animate-ping" aria-hidden="true" />
                </>
              )}
              <span
                role={isLive ? "status" : undefined}
                aria-label={isLive ? `PB's location: ${liveLabel}` : undefined}
                className={cn(
                  "relative grid place-items-center rounded-full border-2 border-white shadow-lg ring-1 ring-black/50",
                  isStart
                    ? "h-5 w-5 bg-emerald-500 shadow-emerald-500/50"
                    : isEnd
                      ? "h-5 w-5 bg-red-500 shadow-red-500/50"
                      : isLive
                        ? "h-5 w-5 bg-saffron-400 shadow-saffron-400/50"
                        : stop.status === "done"
                          ? "h-4 w-4 bg-ridden"
                          : "h-4 w-4 bg-saffron-400",
                )}
              >
                {stop.status === "done" && !isStart && !isEnd ? (
                  <Check className="h-2.5 w-2.5 text-ridden-tick" aria-hidden="true" />
                ) : (
                  !isLive && <span className="shrink-0 aspect-square h-1.5 w-1.5 rounded-full bg-white" />
                )}
                {isLive && <span className="shrink-0 aspect-square h-1.5 w-1.5 rounded-full bg-white animate-blink" />}
              </span>
              {labels && (
                <span
                  className={cn(
                    "map-label absolute top-6 max-w-[9rem] truncate whitespace-nowrap text-[10px] font-bold uppercase tracking-wide",
                    isStart
                      ? "text-start-label"
                      : isEnd
                        ? "text-end-label"
                        : isLive
                          ? "text-live-label"
                          : "text-map-label",
                  )}
                >
                  {stop.name}
                </span>
              )}
            </button>
          </div>
        );
      })}

      {count > 0 && (
        <div className="absolute inset-x-0 bottom-[3.75rem] px-4 sm:bottom-[4.5rem] sm:px-5">
          <div className="rounded-2xl border border-white/10 bg-ink-950/85 px-3 py-2.5 shadow-xl shadow-black/40 backdrop-blur-xl sm:px-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                Route · {count} stop{count === 1 ? "" : "s"} ·{" "}
                {formatKm(totals[totals.length - 1] ?? 0)}
              </p>
              <div className="flex items-center gap-1">
                {/* A satellite, blinking while the ping is live — it is the
                    antenna talking, not a direction. It stops blinking when
                    the signal is stale or the tracker is asleep, so a still
                    icon means there is nothing arriving. */}
                <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-300">
                  <Satellite
                    className={cn(
                      "h-3 w-3",
                      status === "live" ? "text-emerald-300 animate-blink" : "text-amber-300",
                    )}
                    aria-hidden="true"
                  />
                  {pingLabel}
                </span>
              </div>
            </div>

            <div className="relative">
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-3"
                style={{ marginLeft: `${edge}%`, marginRight: `${edge}%` }}
                aria-hidden="true"
              >
                <div className="absolute inset-x-0 top-[5px] h-0.5 rounded-full bg-white/10" />
                <div
                  className="absolute left-0 top-[5px] h-0.5 rounded-full bg-saffron-400"
                  style={{ width: `${progressPct}%` }}
                />
                <div
                  className="absolute top-[5px] h-0.5 border-t-2 border-dashed border-saffron-400/40"
                  style={{ left: `${progressPct}%`, right: 0 }}
                />
              </div>

              <ol
                className="relative grid"
                style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
                aria-label="Stops on this ride"
              >
                {stops.map((stop, index) => {
                  const isStart = index === 0;
                  const isEnd = index === count - 1;
                  const isLive = stop.status === "live";
                  const isDone = stop.status === "done";
                  return (
                    <li key={`${stop.name}-${index}`} className="flex min-w-0 flex-col items-center">
                      <span
                        className="relative grid h-3 w-3 place-items-center"
                        role={isLive ? "status" : undefined}
                        aria-label={isLive ? `PB's location: ${liveLabel}` : undefined}
                      >
                        {isLive && (
                          <span
                            className="shrink-0 aspect-square absolute h-6 w-6 rounded-full bg-saffron-400/30 animate-radar"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          title={`${isStart ? "Start" : isEnd ? "Destination" : "Stop"} · ${
                            stop.name
                          }${stop.note ? ` — ${stop.note}` : ""}`}
                          className={cn(
                            "shrink-0 aspect-square relative grid h-3 w-3 place-items-center rounded-full ring-2 ring-black/40",
                            isStart
                              ? "bg-emerald-500"
                              : isEnd
                                ? "bg-red-500"
                                : isLive
                                  ? "bg-saffron-400"
                                  : isDone
                                    ? "bg-ridden"
                                    : "bg-saffron-400",
                          )}
                        >
                          {isDone && !isStart && !isEnd && (
                            <Check className="h-2 w-2 text-ridden-tick" aria-hidden="true" />
                          )}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "mt-1.5 max-w-full truncate text-center text-[9px] font-bold uppercase leading-tight tracking-wide sm:text-[10px]",
                          isStart
                            ? "text-emerald-300"
                            : isEnd
                              ? "text-red-300"
                              : isLive
                                ? "text-amber-300"
                                : isDone
                                  ? "text-zinc-400"
                                  : "text-zinc-500",
                        )}
                      >
                        {stop.name}
                      </span>
                      <span className="text-[9px] leading-tight text-zinc-600">
                        {isLive && status === "live" && index > 0
                          ? "here now"
                          : formatKm(totals[index] ?? 0)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
