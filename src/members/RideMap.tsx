/**
 * The map in the member's dashboard: where a ride is built by hand.
 *
 * It is the same basemap the site's own tracker draws (so the member sees the
 * look the owner chose) with a much simpler job on top: the stops as numbered
 * pins, a line between them, and a click that drops a new pin where the member
 * clicked.
 *
 * The projection comes from `utils/mercator`, the same one the tracker uses, so
 * a click lands exactly on the ground it looks like it landed on. Nothing here
 * pans or zooms by hand — the view fits the ride — because the only thing this
 * map is for is placing stops, and a lost map is a stopped rider.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import VectorBasemap from "../components/VectorBasemap";
import { fitViewExact, makeMercatorProjector } from "../utils/mercator";
import { cn } from "../utils/cn";

export interface RidePoint {
  name: string;
  lat: number;
  lng: number;
}

/** Somewhere central when there is nothing to fit yet: India, wide open. */
const EMPTY_VIEW = { lat: 22.5, lng: 79, zoom: 4 };
const SINGLE_VIEW = 11;

export default function RideMap({
  stops,
  selected,
  onPick,
  onSelect,
  height = 320,
  className,
}: {
  stops: RidePoint[];
  /** Index of the stop being edited, drawn larger. */
  selected?: number | null;
  /** A click on the map: add a stop here. */
  onPick?: (point: { lat: number; lng: number }) => void;
  /** A click on a pin: edit that stop. */
  onSelect?: (index: number) => void;
  height?: number;
  className?: string;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      if (width > 0) setSize({ width, height: element.clientHeight || height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [height]);

  const width = size.width || 640;
  const drawHeight = size.height || height;

  // The view is fitted to the ride, and only refitted when the ride changes —
  // not on every render, or a re-render mid-click would move the ground under
  // the pin the member just dropped.
  const stopKey = stops.map((stop) => `${stop.lat.toFixed(4)},${stop.lng.toFixed(4)}`).join("|");
  const view = useMemo(() => {
    if (stops.length === 0) return EMPTY_VIEW;
    if (stops.length === 1) return { lat: stops[0].lat, lng: stops[0].lng, zoom: SINGLE_VIEW };
    return fitViewExact(stops, width, drawHeight, { padX: 42, padY: 42 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopKey, width, drawHeight]);

  const projector = useMemo(
    () => makeMercatorProjector(view, width, drawHeight),
    [view, width, drawHeight],
  );

  const points = useMemo(
    () =>
      stops.map((stop) => {
        const projected = projector.toXY(stop);
        return { x: (projected.x / 100) * width, y: (projected.y / 100) * drawHeight };
      }),
    [stops, projector, width, drawHeight],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onPick) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      const { lat, lng } = projector.toLatLng(x, y);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      onPick({ lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 });
    },
    [onPick, projector],
  );

  return (
    <div
      ref={host}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/10 bg-ink-900",
        onPick && "cursor-crosshair",
        className,
      )}
      style={{ height: drawHeight, minHeight: 220 }}
      onClick={handleClick}
      role={onPick ? "application" : "img"}
      aria-label={onPick ? "Ride map — click to drop a stop" : "Ride map"}
    >
      {/*
        The basemap fills the frame from the inside and takes no pointer
        events: this map is for placing stops, and a camera the member could
        pan would slide out from under the pins, which are drawn from a view
        of our own. Clicks have to reach the frame, not the canvas.
      */}
      <VectorBasemap
        view={view}
        width={width}
        height={drawHeight}
        className="pointer-events-none absolute inset-0 h-full w-full"
        attributionClassName="pointer-events-none absolute bottom-1 right-2 text-[9px] leading-none text-zinc-400/70"
      />

      <svg
        className="pointer-events-none absolute inset-0"
        width={width}
        height={drawHeight}
        aria-hidden="true"
      >
        {points.length > 1 && (
          <polyline
            points={points.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke="#f6b93b"
            strokeWidth={2.5}
            strokeDasharray="7 6"
            strokeLinecap="round"
            opacity={0.85}
          />
        )}
      </svg>

      {points.map((point, index) => (
        <button
          key={`${stops[index]?.lat},${stops[index]?.lng},${index}`}
          type="button"
          onClick={(event) => {
            if (!onSelect) return;
            event.stopPropagation();
            onSelect(index);
          }}
          aria-label={`Stop ${index + 1}: ${stops[index]?.name ?? "unnamed"}`}
          className={cn(
            "absolute -translate-x-1/2 -translate-y-full",
            onSelect ? "cursor-pointer" : "cursor-default",
          )}
          style={{ left: point.x, top: point.y }}
        >
          <span
            className={cn(
              "grid h-7 w-7 place-items-center rounded-full border text-[11px] font-bold shadow-lg transition-transform",
              selected === index
                ? "scale-110 border-white bg-white text-ink-950"
                : "border-saffron-400/70 bg-ink-950/90 text-saffron-300",
            )}
          >
            {index + 1}
          </span>
          <span className="mt-1 block max-w-[9rem] truncate rounded-md bg-ink-950/85 px-1.5 py-0.5 text-center text-[10px] font-medium text-zinc-200">
            {stops[index]?.name || <MapPin className="mx-auto h-3 w-3" />}
          </span>
        </button>
      ))}

      {onPick && (
        <p className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-ink-950/80 px-3 py-1 text-[10px] font-medium text-zinc-400">
          Click the map to drop a stop
        </p>
      )}
    </div>
  );
}
