import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Clock, Compass, MapPin, Mountain } from "lucide-react";
import { useLiveLocation, type LiveStatus } from "../hooks/useLiveLocation";
import VectorBasemap from "./VectorBasemap";
import { makeMercatorProjector } from "../utils/mercator";
import { Logo } from "./Navbar";
import { cn } from "../utils/cn";

const STATUS_META: Record<
  LiveStatus,
  { label: string; dot: string; text: string; border: string }
> = {
  live: {
    label: "LIVE — ON THE ROAD",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
    border: "border-emerald-400/40",
  },
  stale: {
    label: "SIGNAL STALE — LAST KNOWN POSITION",
    dot: "bg-amber-400",
    text: "text-amber-300",
    border: "border-amber-400/40",
  },
  offduty: {
    label: "OFF DUTY — BACK AT 6:00 AM IST",
    dot: "bg-zinc-500",
    text: "text-zinc-400",
    border: "border-zinc-500/40",
  },
};

function formatAge(sec: number): string {
  if (sec < 90) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 90) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function StatusChip({ status }: { status: LiveStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-ink-950/70 px-3.5 py-1.5 text-[11px] font-bold tracking-[0.14em] backdrop-blur-md",
        meta.text,
        meta.border
      )}
    >
      <span className="relative flex h-2 w-2">
        {status === "live" && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        )}
        <span
          className={cn(
            "relative inline-flex h-2 w-2 rounded-full",
            meta.dot,
            status === "live" && "animate-blink"
          )}
        />
      </span>
      {meta.label}
    </span>
  );
}

/**
 * Where the bike is, on our own map.
 *
 * The same nameless OpenStreetMap the tracker uses, centred on the last ping,
 * with the radar drawn by us on top. That is the whole reason for not
 * embedding somebody else's map here: an iframe is sealed, so nothing of ours
 * could be drawn on it, and the only view we could have had was the one they
 * chose to give.
 */
function PositionMap({
  lat,
  lng,
  live,
  label,
}: {
  lat: number;
  lng: number;
  live: boolean;
  label: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // The pin has to sit on the exact spot the map puts that coordinate, so the
  // panel is measured rather than assumed.
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

  const width = size.width || 800;
  const height = size.height || 520;
  // Close enough to read the road he is on, wide enough to see where that is.
  const view = { lat, lng, zoom: 12 };
  const projector = useMemo(
    () => makeMercatorProjector(view, width, height, 0),
    [view.lat, view.lng, view.zoom, width, height], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const point = projector.toXY({ lat, lng });

  return (
    <div ref={hostRef} className="map-paper absolute inset-0 z-0 overflow-hidden">
      <VectorBasemap
        view={view}
        width={width}
        height={height}
        className="absolute inset-0"
        attributionClassName="pointer-events-none absolute bottom-3 right-3 text-[9px] text-zinc-500"
      />
      <div
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${point.x}%`, top: `${point.y}%` }}
      >
        {live && (
          <>
            <span
              className="absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.05]"
              aria-hidden="true"
            />
            <span
              className="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.07]"
              aria-hidden="true"
            />
          </>
        )}
        <span
          role="status"
          aria-label={`PB's current position: ${label}`}
          className={cn(
            "relative grid h-5 w-5 place-items-center rounded-full border-2 border-white shadow-lg ring-1 ring-black/50",
            live ? "bg-saffron-400 shadow-saffron-400/50" : "bg-zinc-500 shadow-zinc-500/50",
          )}
        >
          {live && (
            <span
              className="absolute inset-0 rounded-full bg-saffron-400/40 animate-radar"
              aria-hidden="true"
            />
          )}
          <span
            className={cn("h-1.5 w-1.5 rounded-full bg-white", live && "animate-blink")}
          />
        </span>
      </div>
    </div>
  );
}

export default function LiveMapPage() {
  const {
    location,
    status,
    ageSec,
    now,
    istTime,
    nextWindowOpenMs,
    windowCloseMs,
  } = useLiveLocation();

  return (
    <div className="flex min-h-screen flex-col bg-ink-950">
      {/* ---------- Top Bar ---------- */}
      <header className="relative z-20 border-b border-white/[0.07] bg-ink-950/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-5 py-3.5 sm:px-8">
          <a
            href="#/"
            className="group inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-xs font-semibold text-zinc-300 transition-all duration-300 hover:border-white/25 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-0.5" />
            pbfrompb.in
          </a>
          <Logo compact />
          <span className="hidden h-6 w-px bg-white/10 sm:block" aria-hidden />
          <h1 className="font-display text-sm font-semibold tracking-tight text-white sm:text-base">
            طویل (Taweel) · Live Map
          </h1>
          <span className="sm:ml-1">
            <StatusChip status={status} />
          </span>
        </div>
      </header>

      {/* ---------- The map ---------- */}
      <div className="relative min-h-[520px] flex-1">
        <PositionMap
          lat={location.lat}
          lng={location.lng}
          live={status === "live"}
          label={`${location.name}, ${location.state}`}
        />

        {/* ---------- Info Card ---------- */}
        <div className="absolute bottom-5 left-5 right-5 z-10 mx-auto max-w-7xl sm:left-8 sm:right-auto">
          <div className="w-full max-w-sm rounded-3xl glass p-5 shadow-2xl shadow-black/50 sm:p-6">
            <p
              className={cn(
                "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em]",
                status === "live"
                  ? "text-emerald-300"
                  : status === "stale"
                    ? "text-amber-300"
                    : "text-zinc-400"
              )}
            >
              {status === "live" && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-blink" />
              )}
              {status === "live"
                ? "Live position"
                : status === "stale"
                  ? "Last known ping"
                  : "Parked for the night"}
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {location.name}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">{location.state}</p>

            <ul className="mt-5 flex flex-col gap-2.5 text-xs text-zinc-300">
              <li className="flex items-center gap-2.5">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-saffron-300" />
                <span className="font-mono">
                  {location.lat.toFixed(5)}° N · {location.lng.toFixed(5)}° E
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <Mountain className="h-3.5 w-3.5 shrink-0 text-saffron-300" />
                {location.altitude}
              </li>
              <li className="flex items-center gap-2.5">
                <Clock className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                Updated {formatAge(ageSec)} · IST {istTime}
              </li>
              <li className="flex items-center gap-2.5">
                <Compass className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                OpenStreetMap · no names, no key, no tracking
              </li>
            </ul>

            {status === "offduty" && (
              <p className="mt-4 rounded-xl bg-white/[0.05] px-3.5 py-2.5 text-[11px] text-zinc-400">
                Tracker sleeps after 9 PM. Next window opens in{" "}
                <span className="font-semibold text-saffron-300">
                  {formatCountdown(nextWindowOpenMs - now.getTime())}
                </span>{" "}
                (6:00 AM IST).
              </p>
            )}
            {status === "live" && (
              <p className="mt-4 rounded-xl bg-white/[0.05] px-3.5 py-2.5 text-[11px] text-zinc-400">
                Window closes in{" "}
                <span className="font-semibold text-saffron-300">
                  {formatCountdown(windowCloseMs - now.getTime())}
                </span>{" "}
                (9:00 PM IST) — then طویل (Taweel) goes off-grid till morning.
              </p>
            )}
            {status === "stale" && (
              <p className="mt-4 rounded-xl bg-amber-400/10 px-3.5 py-2.5 text-[11px] text-amber-200">
                No fresh ping in over an hour — showing the last known position.
              </p>
            )}

            <p className="mt-4 border-t border-white/[0.07] pt-4 text-xs italic leading-relaxed text-zinc-500">
              "{location.note}"
            </p>
          </div>
        </div>

        {/* Machine info badge */}
        <div className="absolute bottom-5 right-14 z-10 hidden lg:block">
          <span className="inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-[11px] font-medium text-zinc-400">
            <Compass className="h-3.5 w-3.5 text-saffron-400" />
            طویل (Taweel) · Royal Enfield Himalayan 450 · Hanle Black
          </span>
        </div>
      </div>
    </div>
  );
}
