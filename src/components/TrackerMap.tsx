import { useMemo, useState } from "react";
import { ArrowUpRight, Check, Lock, MapPinned } from "lucide-react";
import type { LiveStop } from "../store/siteContent";
import type { LiveStatus } from "../hooks/useLiveLocation";
import { cn } from "../utils/cn";
import { routeEmbedUrl, routeLinkUrl } from "../utils/mapEmbed";
import { cumulativeKm, formatKm } from "../utils/routeProgress";
import type { LatLng } from "../utils/routing";

/**
 * The live tracker's map.
 *
 * The map itself is Google Maps, embedded through the endpoint Google hands out
 * from Maps → Share → "Embed a map" — free, no API key, no billing. Google
 * draws the real road and the real A-to-B route, so the geography is always
 * right and the panel is never blank.
 *
 * The trade-off: an iframe is a sealed box, so nothing can be drawn on top of
 * it. The stops therefore live in the strip along the bottom of the panel,
 * which keeps everything the tracker promised — every stop visible, the first
 * one green, the last one red, and the road split into what is ridden and what
 * is still to come.
 *
 * The map ignores the pointer until you ask for it ("Move map"), so scrolling
 * the page past a full-width map never turns into zooming the map instead.
 */

export interface TrackerMapProps {
  stops: LiveStop[];
  /** Road fetched in the dashboard; used to measure the ride honestly. */
  routeGeometry: LatLng[];
  liveName: string;
  liveState: string;
  status: LiveStatus;
}

export default function TrackerMap({
  stops,
  routeGeometry,
  liveName,
  liveState,
  status,
}: TrackerMapProps) {
  const [interactive, setInteractive] = useState(false);

  const embedUrl = useMemo(() => routeEmbedUrl(stops), [stops]);
  const linkUrl = useMemo(() => routeLinkUrl(stops), [stops]);
  const totals = useMemo(() => cumulativeKm(stops, routeGeometry), [stops, routeGeometry]);

  const count = stops.length;

  // Where the ride currently is: the stop marked live, else the last one
  // ridden. Everything before it is covered; everything after is to come.
  const liveIndex = stops.findIndex((stop) => stop.status === "live");
  const lastDone = stops.reduce((acc, stop, i) => (stop.status === "done" ? i : acc), -1);
  const progressIndex = liveIndex >= 0 ? liveIndex : lastDone >= 0 ? lastDone : 0;
  const progressPct = count > 1 ? (progressIndex / (count - 1)) * 100 : 0;

  // The track runs from the centre of the first dot to the centre of the last,
  // so it is inset by half a column at each end.
  const edge = count > 0 ? 50 / count : 0;

  return (
    <>
      {/* The real map — crisp, and pointer-dead until asked for. */}
      <div className={cn("tracker-google absolute inset-0", interactive && "is-interactive")}>
        {embedUrl ? (
          <iframe
            src={embedUrl}
            title={`Google Maps: the route from ${stops[0]?.name ?? "the start"} to ${
              stops[count - 1]?.name ?? "the destination"
            }`}
            className="h-full w-full border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        ) : (
          <div className="grid h-full w-full place-items-center px-6 text-center text-xs text-zinc-500">
            Add at least one stop in the dashboard and this panel becomes a live Google Map of the
            route.
          </div>
        )}
      </div>

      {/* A soft edge top and bottom so the overlay plates stay readable over
          the map without hiding it. */}
      <div className="tracker-google-veil pointer-events-none absolute inset-0" aria-hidden="true" />

      {count > 0 && (
        <div className="absolute inset-x-0 bottom-[3.75rem] px-4 sm:bottom-[4.5rem] sm:px-5">
          <div className="rounded-2xl border border-white/10 bg-ink-950/85 px-3 py-2.5 shadow-xl shadow-black/40 backdrop-blur-xl sm:px-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                Route · {count} stop{count === 1 ? "" : "s"} ·{" "}
                {formatKm(totals[totals.length - 1] ?? 0)}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setInteractive((value) => !value)}
                  className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400 transition-all duration-300 hover:border-white/25 hover:text-white"
                  aria-pressed={interactive}
                >
                  {interactive ? (
                    <Lock className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <MapPinned className="h-3 w-3" aria-hidden="true" />
                  )}
                  {interactive ? "Lock map" : "Move map"}
                </button>
                <a
                  href={linkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400 transition-all duration-300 hover:border-white/25 hover:text-white"
                >
                  Google Maps
                  <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                </a>
              </div>
            </div>

            <div className="relative">
              {/* Track: solid behind PB, dashed still to come. */}
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
                        aria-label={
                          isLive ? `PB's location: ${liveName}, ${liveState}` : undefined
                        }
                      >
                        {isLive && (
                          <span
                            className="absolute h-6 w-6 rounded-full bg-saffron-400/30 animate-radar"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          title={`${isStart ? "Start" : isEnd ? "Destination" : "Stop"} · ${
                            stop.name
                          }${stop.note ? ` — ${stop.note}` : ""}`}
                          className={cn(
                            "relative grid h-3 w-3 place-items-center rounded-full ring-2 ring-ink-950",
                            isStart
                              ? "bg-emerald-500"
                              : isEnd
                                ? "bg-red-500"
                                : isLive
                                  ? "bg-saffron-400"
                                  : isDone
                                    ? "bg-emerald-400/70"
                                    : "bg-zinc-600",
                          )}
                        >
                          {isDone && !isStart && !isEnd && (
                            <Check className="h-2 w-2 text-ink-950" aria-hidden="true" />
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
                                ? "text-saffron-300"
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
    </>
  );
}
