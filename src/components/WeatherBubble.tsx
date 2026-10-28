import { useEffect, useRef, useState } from "react";
import { Clock, Droplets, Thermometer, Umbrella, Wind, X } from "lucide-react";
import { cn } from "../utils/cn";
import type { WeatherDetail } from "../utils/weather";
import { WeatherIcon, weatherTone } from "./WeatherBadge";
import type { KmMark } from "../utils/routeBubbles";

/**
 * A weather bubble on the route, and the card behind it.
 *
 * The rides this site follows cross weather, not just country: it can be 30°C
 * in Nangal and snowing on a pass four hundred kilometres later, so a forecast
 * for the start is no guide to the road. One bubble is dropped every hundred
 * kilometres, and each opens into the weather *there* — what it is doing now,
 * what the next three hours hold, and the coming week.
 *
 * Opening is hover on a pointer and a tap on a phone; a tapped bubble stays
 * open until it is tapped again or closed, so a finger does not have to hold
 * the screen. The card places itself on whichever side of the bubble has room
 * and is clamped inside the panel — a bubble near an edge must still be able
 * to show a whole forecast.
 */

const CARD_WIDTH = 272;
/** Enough for now + three hours + a week, and used only to place the card. */
const CARD_HEIGHT = 344;

function hourLabel(time: string): string {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return time.slice(11, 16);
  return date
    .toLocaleTimeString("en-IN", { hour: "numeric", hour12: true })
    .replace(/\s/g, "")
    .toLowerCase();
}

function dayLabel(date: string, index: number): string {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-IN", { weekday: "short" });
}

/** `Now · 300 km` — where on the ride this bubble sits. */
export function WeatherBubble({
  mark,
  detail,
  x,
  y,
  width,
  height,
}: {
  mark: KmMark;
  detail: WeatherDetail | null;
  /** The bubble's position in the panel, in pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const open = (hovered || pinned) && Boolean(detail);

  // A tapped bubble closes when the tap lands anywhere else on the page.
  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (event: PointerEvent | MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setPinned(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [pinned]);

  const cardWidth = Math.max(Math.min(CARD_WIDTH, width - 16), 200);
  const left = Math.min(Math.max(8, x - cardWidth / 2), Math.max(8, width - cardWidth - 8));
  const below = y + 20 + CARD_HEIGHT <= height - 8;
  const top = Math.min(
    Math.max(8, below ? y + 20 : y - CARD_HEIGHT - 20),
    Math.max(8, height - CARD_HEIGHT - 8),
  );

  if (!detail) {
    // Nothing to say yet: the bubble is there so the distance is marked, but
    // it does not pretend to know the weather.
    return (
      <div
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${(x / width) * 100}%`, top: `${(y / height) * 100}%` }}
        aria-hidden="true"
      >
        <span className="grid h-5 w-5 place-items-center rounded-full border border-dashed border-white/25 bg-ink-950/60" />
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="absolute"
      style={{ left: `${(x / width) * 100}%`, top: `${(y / height) * 100}%` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={() => setPinned((value) => !value)}
        aria-expanded={open}
        aria-label={`Weather ${mark.km} km along the route: ${detail.now.label}, ${
          detail.now.tempC ?? "—"
        } degrees`}
        className={cn(
          "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border p-[3px] transition-transform duration-200",
          "border-white/25 bg-ink-950/85 shadow-lg shadow-black/40 backdrop-blur-md hover:scale-110",
          open ? "scale-110 border-white/60" : "",
        )}
        title={`${mark.km} km · ${detail.now.label}`}
      >
        <WeatherIcon kind={detail.now.kind} className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          className="absolute z-30 rounded-2xl border border-white/15 bg-ink-950/95 p-3 shadow-2xl shadow-black/60 backdrop-blur-xl"
          style={{ left: left - x, top: top - y, width: cardWidth }}
          role="dialog"
          aria-label={`Weather ${mark.km} km along the route`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-saffron-300">
                {mark.km} km along the route
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-white">
                <WeatherIcon kind={detail.now.kind} className="h-4 w-4" />
                {detail.now.label}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setPinned(false);
                setHovered(false);
              }}
              aria-label="Close weather"
              className="rounded-full p-1 text-zinc-500 transition-colors hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-300">
            <span className="flex items-center gap-1">
              <Thermometer className={cn("h-3 w-3", weatherTone(detail.now.kind))} />
              {detail.now.tempC === null ? "—" : `${detail.now.tempC}°C`}
              {detail.now.feelsC !== null && (
                <span className="text-zinc-500">feels {detail.now.feelsC}°</span>
              )}
            </span>
            {detail.now.windKph !== null && (
              <span className="flex items-center gap-1">
                <Wind className="h-3 w-3 text-sky-300" />
                {Math.round(detail.now.windKph)} km/h
              </span>
            )}
            {detail.now.humidity !== null && (
              <span className="flex items-center gap-1">
                <Droplets className="h-3 w-3 text-sky-300" />
                {Math.round(detail.now.humidity)}%
              </span>
            )}
          </div>

          {detail.hours.length > 0 && (
            <div className="mt-3">
              <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                <Clock className="h-3 w-3" aria-hidden="true" /> Next three hours
              </p>
              <ul className="mt-1.5 grid grid-cols-3 gap-1.5">
                {detail.hours.slice(0, 3).map((hour) => (
                  <li
                    key={hour.time}
                    className="rounded-lg border border-white/[0.07] bg-white/[0.04] px-1.5 py-1.5 text-center"
                  >
                    <p className="font-mono text-[9px] uppercase text-zinc-500">{hourLabel(hour.time)}</p>
                    <WeatherIcon kind={hour.kind} className="mx-auto mt-0.5 h-3.5 w-3.5" />
                    <p className="mt-0.5 text-[11px] font-semibold text-white">
                      {hour.tempC === null ? "—" : `${hour.tempC}°`}
                    </p>
                    {hour.rainPct !== null && (
                      <p className="text-[9px] text-sky-300">{Math.round(hour.rainPct)}%</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {detail.days.length > 0 && (
            <div className="mt-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                The coming week
              </p>
              <ul className="mt-1.5 flex flex-col">
                {detail.days.slice(0, 7).map((day, index) => (
                  <li
                    key={day.date}
                    className="flex items-center gap-2 border-b border-white/[0.05] py-1 last:border-0"
                  >
                    <span className="w-14 shrink-0 text-[10px] font-semibold text-zinc-300">
                      {dayLabel(day.date, index)}
                    </span>
                    <WeatherIcon kind={day.kind} className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1 truncate text-[10px] text-zinc-500" title={day.label}>
                      {day.label}
                    </span>
                    {day.rainPct !== null && day.rainPct > 0 && (
                      <span className="flex items-center gap-0.5 text-[9px] text-sky-300">
                        <Umbrella className="h-2.5 w-2.5" />
                        {Math.round(day.rainPct)}%
                      </span>
                    )}
                    <span className="w-14 shrink-0 text-right font-mono text-[10px] text-zinc-300">
                      {day.maxC === null ? "—" : `${Math.round(day.maxC)}°`}
                      <span className="text-zinc-500"> / {day.minC === null ? "—" : `${Math.round(day.minC)}°`}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default WeatherBubble;
