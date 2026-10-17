import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Check } from "lucide-react";
import type { LiveStop } from "../store/siteContent";
import type { LiveStatus } from "../hooks/useLiveLocation";
import { cn } from "../utils/cn";
import { splitRouteAtProgress, type LatLng } from "../utils/routing";

/**
 * The live tracker's map.
 *
 * Real geography sits behind the route as a deliberately soft backdrop — the
 * point is to feel like the actual road, not to compete with the route drawn
 * on top of it. Tiles are blurred back; the route and the stops are not.
 *
 * The road comes from stored geometry (fetched once in the dashboard), split
 * into the part already ridden and the part still to come. When no geometry has
 * been fetched, straight segments between the stops stand in.
 *
 * Positions come from Leaflet's projection so the overlay lines up with the
 * map. If Leaflet cannot start — no layout, no tiles — a plain bounding-box fit
 * is used instead, which still places everything correctly, just without a map.
 */

const TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const PADDING = 64;

interface Point {
  x: number;
  y: number;
}

export interface TrackerMapProps {
  stops: LiveStop[];
  routeGeometry: LatLng[];
  live: { lat: number; lng: number };
  liveName: string;
  liveState: string;
  status: LiveStatus;
}

/** Straight segments between the stops, used until real road is fetched. */
function fallbackGeometry(stops: LiveStop[]): LatLng[] {
  return stops.map((s) => [s.lat, s.lng]);
}

/** Fit `points` into a width x height box, preserving aspect ratio. */
function boxFit(
  points: LatLng[],
  width: number,
  height: number,
): ((p: LatLng) => Point) | null {
  if (!points.length || !width || !height) return null;
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 0.0001;
  const spanLng = maxLng - minLng || 0.0001;
  const innerW = Math.max(width - PADDING * 2, 1);
  const innerH = Math.max(height - PADDING * 2, 1);
  // Equirectangular, scaled to whichever axis binds, so the shape is not skewed.
  const scale = Math.min(innerW / spanLng, innerH / spanLat);
  const offsetX = (width - spanLng * scale) / 2;
  const offsetY = (height - spanLat * scale) / 2;
  return ([lat, lng]: LatLng) => ({
    x: (lng - minLng) * scale + offsetX,
    y: (maxLat - lat) * scale + offsetY,
  });
}

function toPath(points: Point[]): string {
  if (!points.length) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

export default function TrackerMap({
  stops,
  routeGeometry,
  live,
  liveName,
  liveState,
  status,
}: TrackerMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(0);

  const geometry = useMemo(
    () => (routeGeometry.length >= 2 ? routeGeometry : fallbackGeometry(stops)),
    [routeGeometry, stops],
  );

  // Everything we want on the map: the road plus PB's current position.
  const allPoints = useMemo<LatLng[]>(
    () => [...geometry, [live.lat, live.lng]],
    [geometry, live.lat, live.lng],
  );
  const fitKey = useMemo(() => JSON.stringify(allPoints), [allPoints]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let map: L.Map | null = null;
    try {
      map = L.map(host, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
      });
      L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 20 }).addTo(map);
      mapRef.current = map;

      const bounds = L.latLngBounds(allPoints.map(([lat, lng]) => L.latLng(lat, lng)));
      map.fitBounds(bounds, { padding: [PADDING, PADDING] });

      const measure = () => {
        const next = map!.getSize();
        setSize({ width: next.x, height: next.y });
        setReady((value) => value + 1);
      };
      map.on("resize", measure);
      map.on("zoomend moveend", measure);
      map.whenReady(measure);
      measure();
    } catch {
      // Leaflet needs real layout. Without it we fall through to the box fit.
      mapRef.current = null;
    }
    return () => {
      try {
        map?.remove();
      } catch {
        // Nothing to clean up if Leaflet never started.
      }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // Track the host's size so the fallback fit (and the SVG viewBox) match.
  useEffect(() => {
    const host = hostRef.current?.parentElement;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
      setReady((value) => value + 1);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const projected = useMemo(() => {
    if (!size.width || !size.height) return null;
    const map = mapRef.current;
    const fallback = boxFit(allPoints, size.width, size.height);
    const viaMap = map
      ? ([lat, lng]: LatLng): Point => {
          const point = map.latLngToContainerPoint(L.latLng(lat, lng));
          return { x: point.x, y: point.y };
        }
      : null;

    // Leaflet's projection is the one that lines up with the tiles, so it is
    // the one we want. It needs a laid-out map though: ask it before the
    // container has a size and it answers with numbers far outside the panel,
    // which throws the route and every marker off screen. Fall back to a plain
    // bounding-box fit whenever its answers are not sane.
    const sane =
      viaMap !== null &&
      allPoints.every((point) => {
        const projectedPoint = viaMap(point);
        return (
          Number.isFinite(projectedPoint.x) &&
          Number.isFinite(projectedPoint.y) &&
          projectedPoint.x >= -size.width * 0.5 &&
          projectedPoint.x <= size.width * 1.5 &&
          projectedPoint.y >= -size.height * 0.5 &&
          projectedPoint.y <= size.height * 1.5
        );
      });
    const project: (p: LatLng) => Point =
      sane && viaMap !== null
        ? viaMap
        : (fallback ?? (() => ({ x: 0, y: 0 })));

    return {
      width: size.width,
      height: size.height,
      stops: stops.map((stop) => ({ stop, ...project([stop.lat, stop.lng]) })),
      live: project([live.lat, live.lng]),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ...(() => {
        const { covered, remaining } = splitRouteAtProgress(geometry, stops);
        return {
          covered: toPath(covered.map(project)),
          remaining: toPath(remaining.map(project)),
        };
      })(),
    };
    // `ready` is the signal that the map moved or the host resized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, size.width, size.height, geometry, stops, live.lat, live.lng]);

  return (
    <>
      {/* The map itself — decorative, blurred, non-interactive. */}
      <div ref={hostRef} className="tracker-map absolute inset-0" aria-hidden="true" />
      <div className="tracker-map-veil pointer-events-none absolute inset-0" aria-hidden="true" />

      {projected && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${projected.width} ${projected.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* Yet to come: dim and dashed, marching in the direction of travel. */}
          {projected.remaining && (
            <path
              d={projected.remaining}
              fill="none"
              stroke="var(--color-saffron-400)"
              strokeOpacity="0.38"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="9 7"
              className="animate-route-dash"
            />
          )}
          {/* Already ridden: solid. */}
          {projected.covered && (
            <path
              d={projected.covered}
              fill="none"
              stroke="var(--color-saffron-400)"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          )}
        </svg>
      )}

      {/* Radar rings, centred on wherever PB is rather than a fixed spot. */}
      {projected && (
        <>
          <div
            className="pointer-events-none absolute h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.05]"
            style={{ left: projected.live.x, top: projected.live.y }}
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.06]"
            style={{ left: projected.live.x, top: projected.live.y }}
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.08]"
            style={{ left: projected.live.x, top: projected.live.y }}
            aria-hidden="true"
          />
        </>
      )}

      {projected?.stops.map(({ stop, x, y }) =>
        stop.status === "live" ? (
          <span
            key={stop.name}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: x, top: y }}
          >
            <span
              className="relative grid place-items-center"
              role="status"
              aria-label={`PB's location: ${liveName}, ${liveState}`}
            >
              {status === "live" && (
                <>
                  <span className="absolute h-10 w-10 rounded-full bg-saffron-400/40 animate-radar" aria-hidden="true" />
                  <span className="absolute h-6 w-6 rounded-full bg-saffron-400/30 animate-ping" aria-hidden="true" />
                </>
              )}
              <span
                className={cn(
                  "relative grid h-5 w-5 place-items-center rounded-full border-2 border-white shadow-lg",
                  status === "live"
                    ? "bg-saffron-400 shadow-saffron-400/50"
                    : status === "stale"
                      ? "bg-amber-400"
                      : "bg-zinc-500",
                )}
              >
                <span
                  className={cn("h-1.5 w-1.5 rounded-full bg-white", status === "live" && "animate-blink")}
                />
              </span>
              <span className="absolute left-7 top-1/2 hidden -translate-y-1/2 whitespace-nowrap rounded-full bg-ink-950/80 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur-md sm:block">
                {liveName.toUpperCase()} ·{" "}
                {status === "live" ? "YOU ARE HERE" : status === "stale" ? "LAST KNOWN" : "PARKED"}
              </span>
            </span>
          </span>
        ) : (
          <div
            key={stop.name}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: x, top: y }}
          >
            <button type="button" className="group relative grid place-items-center focus:outline-none">
              <span
                className={cn(
                  "grid h-4.5 w-4.5 place-items-center rounded-full border transition-all duration-300 group-hover:scale-110",
                  stop.status === "done"
                    ? "border-emerald-300/40 bg-emerald-400/10 group-hover:border-emerald-400 group-hover:bg-emerald-400/20"
                    : "border-white/15 bg-white/[0.04] group-hover:border-saffron-400/50 group-hover:bg-saffron-400/10",
                )}
              >
                {stop.status === "done" && (
                  <Check className="h-2.5 w-2.5 text-emerald-400/60 transition-colors duration-300 group-hover:text-emerald-300" />
                )}
                {stop.status === "next" && (
                  <span className="h-1 w-1 rounded-full bg-zinc-500 transition-colors duration-300 group-hover:bg-saffron-300" />
                )}
              </span>
              <span
                className={cn(
                  "absolute top-6 whitespace-nowrap text-[10px] font-bold uppercase tracking-wide transition-all duration-300",
                  stop.status === "done"
                    ? "text-zinc-500/60 group-hover:text-emerald-300"
                    : "text-zinc-600/50 group-hover:text-saffron-300",
                )}
              >
                {stop.name}
              </span>
              <span className="pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-ink-950/95 px-2.5 py-1.5 text-[10px] font-semibold text-zinc-300 opacity-0 shadow-xl backdrop-blur-md transition-all duration-300 group-hover:block group-hover:opacity-100 group-focus:block group-focus:opacity-100">
                <span className="flex items-center gap-1">
                  {stop.status === "done" && <Check className="h-3 w-3 text-emerald-400" />}
                  <span className="text-white">{stop.name}</span>
                </span>
                <span className="mt-0.5 block text-[9px] font-normal text-zinc-500">{stop.note}</span>
              </span>
            </button>
          </div>
        ),
      )}

      <p
        className="pointer-events-none absolute bottom-2 right-3 text-[9px] text-zinc-500"
        aria-hidden="true"
      >
        Map data © OpenStreetMap contributors © CARTO
      </p>
    </>
  );
}
