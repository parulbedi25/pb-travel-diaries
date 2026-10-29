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
import type { Theme } from "../store/siteContent";
import { fitViewExact, makeMercatorProjector } from "../utils/mercator";
import { cn } from "../utils/cn";

export interface RidePoint {
  name: string;
  lat: number;
  lng: number;
}

/** Somewhere central when there is nothing to fit yet: India, wide open. */
const EMPTY_VIEW = { lat: 22.5, lng: 79, zoom: 4 };

/**
 * The room a pin needs, in pixels: the badge sits above its point and the name
 * plate hangs below it, so a ride fitted to the bare coordinates puts the outer
 * pins' plates under the frame's edge, where `overflow-hidden` cuts them off.
 * Reserving half the plate's width either side and the badge-plus-plate above
 * and below is what keeps every pin and every name inside the box — on the
 * short one-pin map in the notebook as much as on the tall one in the builder.
 */
const PIN_PAD_X = 84;
const PIN_PAD_Y = 58;

/**
 * How much ground a single stop is given.
 *
 * A one-pin map used to be drawn at a fixed zoom, which is wrong on both counts:
 * on a 220-pixel box it showed a speck of a town, and on a tall one it was a
 * different map altogether. It is now fitted to a small box around the point, so
 * the zoom follows the box the way every other fit on the site does.
 */
const SINGLE_HALF_SPAN = 0.02;

/** A stop that can actually be drawn: real numbers, on the planet. */
const drawable = (point: { lat: number; lng: number }): boolean =>
  Number.isFinite(point.lat) &&
  Number.isFinite(point.lng) &&
  Math.abs(point.lat) <= 90 &&
  Math.abs(point.lng) <= 180;

export default function RideMap({
  stops,
  selected,
  onPick,
  onSelect,
  height = 320,
  className,
  themeOverride,
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
  /**
   * Draw the basemap as if the page were in this theme. The member's garage has
   * a theme of its own, which may differ from the site's, and the map should
   * match the room it is in.
   */
  themeOverride?: Theme;
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
  /**
   * The stops that can be drawn, each with the index it has in the list.
   *
   * The index travels with the stop rather than being counted again here: a
   * coordinate that cannot be drawn — a blank row, a typo in the form — must
   * leave a gap in the map, never renumber the pins above and below it, which
   * is how a pin ends up labelled with another stop's number.
   */
  const pins = useMemo(
    () =>
      stops
        .map((stop, index) => ({ stop, index }))
        .filter(({ stop }) => drawable(stop)),
    [stops],
  );

  const pinKey = pins.map(({ stop }) => `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`).join("|");

  const view = useMemo(() => {
    if (pins.length === 0) return EMPTY_VIEW;
    if (pins.length === 1) {
      const [only] = pins;
      const fitted = fitViewExact(
        [
          { lat: only.stop.lat - SINGLE_HALF_SPAN, lng: only.stop.lng - SINGLE_HALF_SPAN },
          { lat: only.stop.lat + SINGLE_HALF_SPAN, lng: only.stop.lng + SINGLE_HALF_SPAN },
        ],
        width,
        drawHeight,
        { padX: PIN_PAD_X, padY: PIN_PAD_Y },
      );
      // Centred on the stop itself, at the zoom the box was given.
      return { lat: only.stop.lat, lng: only.stop.lng, zoom: fitted.zoom };
    }
    return fitViewExact(
      pins.map(({ stop }) => stop),
      width,
      drawHeight,
      { padX: PIN_PAD_X, padY: PIN_PAD_Y },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinKey, width, drawHeight]);

  const projector = useMemo(
    () => makeMercatorProjector(view, width, drawHeight),
    [view, width, drawHeight],
  );

  const points = useMemo(
    () =>
      pins.map(({ stop, index }) => {
        const projected = projector.toXY(stop);
        return { index, x: (projected.x / 100) * width, y: (projected.y / 100) * drawHeight };
      }),
    [pins, projector, width, drawHeight],
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
        attributionClassName="pointer-events-none absolute bottom-1 right-2"
        themeOverride={themeOverride}
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

      {/* Each marker is anchored by its top edge and its badge lifted by half
          the badge's height, so the circle lands on the stop itself and the
          name hangs below it. Centring the whole button instead would put the
          point halfway between the badge and its label. */}
      {points.map(({ index, x, y }) => (
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
            "absolute block -translate-x-1/2",
            onSelect ? "cursor-pointer" : "cursor-default",
          )}
          style={{ left: x, top: y }}
        >
          <span
            className={cn(
              "-mt-3.5 shrink-0 aspect-square grid h-7 w-7 place-items-center rounded-full border text-[11px] font-bold shadow-lg transition-transform",
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
