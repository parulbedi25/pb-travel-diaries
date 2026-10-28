import { useMemo, useState } from "react";
import {
  MapPin,
  MapPinned,
  Mountain,
  Thermometer,
  Fuel,
  Navigation,
  Compass,
  Route,
  Flag,
  ArrowUpRight,
  Sparkles,
  Images,
  type LucideIcon,
} from "lucide-react";
import type { LiveButton, LiveData } from "../store/siteContent";
import { SectionHeader, Reveal, Stagger, Item } from "./ui/motion";
import { externalLinkProps } from "./ui/SocialIcons";
import { ageLabel, useLiveLocation, type LiveLocationSeed } from "../hooks/useLiveLocation";
import { currentStopIndex } from "../utils/liveRoute";
import TrackerMap from "./TrackerMap";
import { cn } from "../utils/cn";
import { cumulativeKm, formatKm } from "../utils/routeProgress";
import { useRouteGeometry } from "../hooks/useRoadGeometry";
import { storedRoadFits } from "../utils/liveRoute";
import { useRouteWeather } from "../hooks/useRouteWeather";
import { WeatherBadge } from "./WeatherBadge";
import { WeatherCard } from "./WeatherBubble";
import { useWeatherDetails } from "../hooks/useWeatherDetails";

/**
 * The two distances on the card, in whole numbers once they are long enough
 * to need a comma. `formatKm` is shared with the stop list, where a decimal
 * matters; a journey of 1,552 km does not want to read as "1552 km".
 */
const journeyKm = (km: number): string =>
  km >= 100 ? `${Math.round(km).toLocaleString("en-IN")} km` : formatKm(km);

/**
 * The icons a tracker button may draw. The dashboard stores the key, so the
 * copy of a button is a text field rather than a code change; anything
 * unrecognised falls back to a pin instead of leaving the button blank.
 */
const TRACKER_ICONS: Record<string, LucideIcon> = {
  "map-pin": MapPin,
  "map-pinned": MapPinned,
  navigation: Navigation,
  compass: Compass,
  route: Route,
  flag: Flag,
  "arrow-up-right": ArrowUpRight,
  sparkles: Sparkles,
  images: Images,
};

function TrackerButton({
  cfg,
  fallback,
  primary,
}: {
  cfg: LiveButton | undefined;
  fallback: LiveButton;
  primary?: boolean;
}) {
  const button = { ...fallback, ...(cfg ?? {}) };
  if (!button.visible) return null;
  const Icon = TRACKER_ICONS[button.icon] ?? (primary ? MapPin : Navigation);
  const href = button.href.trim() || fallback.href;
  const external = /^https?:\/\//i.test(href);
  return (
    <a
      href={href}
      {...(external ? externalLinkProps(href) : {})}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-all duration-300 active:scale-95",
        primary
          ? "bg-white text-ink-950 hover:shadow-[0_0_28px_rgba(255,255,255,0.25)]"
          : "border border-white/15 text-white hover:border-white/30 hover:bg-white/[0.06]",
      )}
    >
      <Icon className={cn("h-4 w-4", !primary && "text-saffron-300")} />
      {button.label.trim() || fallback.label}
    </a>
  );
}

export default function LiveTracker({ data }: { data: LiveData }) {
  // Where the bike is comes from the route the dashboard owns: the stop marked
  // "Here now". The bundled LIVE_LOCATION is only the last resort, for a site
  // whose route has been emptied out.
  const here = useMemo(() => {
    const stops = data.stops ?? [];
    if (!stops.length) return null;
    const stop = stops[currentStopIndex(stops)];
    return stop
      ? ({ lat: stop.lat, lng: stop.lng, name: stop.name, state: stop.state, altitude: stop.altitude, note: stop.note } as LiveLocationSeed)
      : null;
  }, [data.stops]);
  const { location, status, ageSec, istTime } = useLiveLocation(here);
  const lat = location.lat.toFixed(4);
  const lng = location.lng.toFixed(4);
  const note = data.note.trim() ? data.note : location.note;

  // Everything the card says about the route is read from the stops, so it
  // stays true when the route is edited in the dashboard.
  const stops = data.stops;
  // The numbers below are measured along the road that is actually drawn:
  // geometry saved from the dashboard, or the road fetched here when none was
  // saved. Only when neither is available does this fall back to straight
  // lines — which is what made a 778 km ride read as 396 km.
  // A road stored for a longer list of stops — before some were deleted — is
  // not this route's road, and neither is the distance measured along it. The
  // signature written beside them says which stops they belong to; without a
  // match they are ignored and the road is measured for the stops on screen.
  const storedFits = storedRoadFits(stops, data.routeGeometry, data.routeSignature);
  const { geometry, byRoad, fetchedKm } = useRouteGeometry(stops, storedFits ? data.routeGeometry : []);
  // The routing service's own length for that road, when it was measured: the
  // stored line is a simplified copy and sums a little short of it.
  // When the road was measured here instead, use the service's figure for it:
  // summing a simplified line reads a little short of the drive.
  const officialKm = storedFits ? (data.routeDistanceKm ?? 0) : fetchedKm;
  const totals = useMemo(
    () => cumulativeKm(stops, geometry, { totalKm: officialKm }),
    [stops, geometry, officialKm],
  );
  // Weather at every checkpoint, one request for the whole route.
  const conditions = useRouteWeather(stops);
  // The same points again, with the rest of the forecast: the next three hours
  // and the coming week behind every temperature on this card. One request for
  // the route, cached, so opening one is a local action.
  const details = useWeatherDetails(stops);
  /** Which temperature in the list is open — one at a time, by stop index. */
  const [routePeek, setRoutePeek] = useState<number | null>(null);
  const [nextPeek, setNextPeek] = useState<number | null>(null);

  /** The card behind a tapping temperature: the place it belongs to, and its week. */
  const forecastFor = (index: number) => {
    const stop = stops[index];
    const detail = details?.[index];
    if (!stop || !detail) return null;
    const role = index === 0 ? "Start" : index === stops.length - 1 ? "Destination" : "On the way";
    return (
      <div className="mt-3 w-full">
        <WeatherCard
          eyebrow={`${role} · ${formatKm(totals[index] ?? 0)}`}
          title={stop.name}
          subtitle={detail.now.label}
          detail={detail}
          width="100%"
          style={{ position: "relative" }}
          onClose={() => {
            setRoutePeek(null);
            setNextPeek(null);
          }}
        />
      </div>
    );
  };
  const totalKm = totals[totals.length - 1] ?? 0;
  const liveIndex = stops.findIndex((stop) => stop.status === "live");
  const lastDone = stops.reduce((acc, stop, i) => (stop.status === "done" ? i : acc), -1);
  const progressIndex = liveIndex >= 0 ? liveIndex : lastDone >= 0 ? lastDone : 0;
  const coveredKm = totals[progressIndex] ?? 0;
  const progressPct = stops.length > 1 ? (progressIndex / (stops.length - 1)) * 100 : 0;
  const currentStop = stops[progressIndex];
  const nextStop = stops[progressIndex + 1];
  // What is left of the leg being ridden: the distance to the next stop, along
  // the same measure the totals use — road geometry when the dashboard has
  // fetched it, straight lines between stops when it has not.
  const toNextKm = nextStop ? Math.max(0, (totals[progressIndex + 1] ?? 0) - coveredKm) : 0;
  const upcoming = stops.slice(progressIndex + 1, progressIndex + 4);
  const hereWeather = conditions?.[progressIndex] ?? null;
  // Shown on the tracker's stop strip rather than floating over the map.
  const pingLabel =
    status === "live"
      ? `Ping ${ageLabel(ageSec)}`
      : status === "stale"
        ? `Last ping ${ageLabel(ageSec)}`
        : "Window closed · 6 AM IST";
  // Both calls to action are dashboard content now — label, link, icon and
  // whether they show at all — so the fallbacks below only matter for a site
  // saved before the buttons were configurable.

  return (
    <section id="live" aria-labelledby="live-title" className="relative py-24 sm:py-32">
      <div
        className="shrink-0 aspect-square pointer-events-none absolute -left-40 top-1/4 h-96 w-96 rounded-full bg-emerald-500/10 blur-[130px]"
        aria-hidden
      />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeader
          eyebrow={data.eyebrow}
          id="live-title"
          title={
            <>
              {data.titleA}
              <span className="text-gradient">{data.titleHi}</span>
              {data.titleB}
            </>
          }
          sub={data.sub}
        />

        <div className="mt-14 grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          {/* ---------- stylised live map ---------- */}
          <Reveal className="h-full">
            <div className="relative flex h-full min-h-[400px] flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-ink-900 shadow-2xl shadow-black/50 sm:min-h-[440px]">
              <div className="absolute inset-0 bg-grid opacity-70 [mask-image:radial-gradient(ellipse_80%_80%_at_50%_40%,black,transparent)]" aria-hidden />
              <div className="shrink-0 aspect-square absolute -left-24 top-10 h-72 w-72 rounded-full bg-saffron-400/8 blur-[100px]" aria-hidden />
              <div className="shrink-0 aspect-square absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-saffron-500/8 blur-[100px]" aria-hidden />
              <TrackerMap
                stops={data.stops}
                routeGeometry={storedFits ? data.routeGeometry : []}
                geometry={geometry}
                routeDistanceKm={officialKm}
                live={{ lat: location.lat, lng: location.lng }}
                liveName={location.name}
                liveState={location.state}
                status={status}
                pingLabel={pingLabel}
              />

              <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-5 sm:p-6">
                <a
                  href="#/live-map"
                  aria-label={`Live: PB is in ${location.name}, ${location.state}. Open the live map.`}
                  className="live-plate group flex items-center gap-3 rounded-2xl border-2 px-4 py-3 backdrop-blur-md transition-all duration-300 hover:scale-[1.03] active:scale-100"
                >
                  <span className="relative flex h-3 w-3 shrink-0">
                    <span
                      className={cn(
                        "absolute h-full w-full rounded-full animate-ping",
                        status === "live" ? "bg-red-500" : status === "stale" ? "bg-amber-400" : "bg-zinc-500"
                      )}
                      aria-hidden
                    />
                    <span
                      className={cn(
                        "shrink-0 aspect-square relative h-3 w-3 rounded-full animate-blink",
                        status === "live" ? "bg-red-500" : status === "stale" ? "bg-amber-400" : "bg-zinc-500"
                      )}
                      aria-hidden
                    />
                  </span>
                  <span>
                    <span
                      className={cn(
                        "block font-mono text-[13px] font-bold tracking-[0.18em] animate-blink",
                        status === "live" ? "text-gold-ink" : "text-zinc-300"
                      )}
                    >
                      {status === "live"
                        ? "● LIVE — ON THE ROAD"
                        : status === "stale"
                          ? "◌ SIGNAL STALE — LAST PING"
                          : "○ OFF DUTY — BACK 6 AM IST"}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-medium text-zinc-400">
                      {location.name}, {location.state} · tap to open live map
                    </span>
                  </span>
                  <ArrowUpRight className="live-plate-arrow h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </a>
              </div>

              <div className="absolute inset-x-0 bottom-0 border-t border-white/[0.07] bg-ink-950/70 p-4 backdrop-blur-xl sm:p-5">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] text-zinc-400 sm:text-xs">
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-saffron-400" />
                    {lat}° N · {lng}° E
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Mountain className="h-3.5 w-3.5 text-saffron-300" />
                    {location.altitude}
                  </span>
                  <span className="ml-auto hidden items-center gap-1.5 text-zinc-500 sm:flex">
                    IST {istTime}
                  </span>
                </div>
              </div>
            </div>
          </Reveal>

          {/* ---------- live detail card ---------- */}
          <Stagger className="flex flex-col gap-5">
            <Item>
              <div className="rounded-[2rem] glass p-7 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
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
                        <span className="shrink-0 aspect-square h-1.5 w-1.5 rounded-full bg-emerald-400 animate-blink" />
                      )}
                      {status === "live"
                        ? "Current location"
                        : status === "stale"
                          ? "Last known ping"
                          : "Parked for the night"}
                    </p>
                    <h3 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                      {location.name}
                    </h3>
                    <p className="mt-1 text-sm text-zinc-500">
                      {location.state} · {stops[0]?.name ?? "the start"} →{" "}
                      {stops[stops.length - 1]?.name ?? "the destination"}
                    </p>
                  </div>
                  <span className="rounded-full bg-white/[0.06] px-3.5 py-1.5 font-mono text-[11px] text-zinc-300">
                    IST {istTime}
                  </span>
                </div>

                {/* The two distances that answer "how long is this ride?" and
                    "how far to the next stop?" — the numbers a rider looks for
                    first, kept apart from the small facts below. */}
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
                    <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                      <Route className="h-3.5 w-3.5 text-saffron-300" aria-hidden="true" />
                      Whole journey
                    </p>
                    <p className="mt-2 font-display text-3xl font-bold tracking-tight text-white">
                      {journeyKm(totalKm)}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                      {stops[0]?.name ?? "Start"} → {stops[stops.length - 1]?.name ?? "Destination"}
                      {byRoad ? " · by road" : " · between the stops"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-saffron-400/25 bg-saffron-400/[0.06] p-4">
                    <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-saffron-300/80">
                      <MapPinned className="h-3.5 w-3.5 text-saffron-300" aria-hidden="true" />
                      To next stop
                    </p>
                    <p
                      className={cn(
                        "mt-2 font-display text-3xl font-bold tracking-tight",
                        nextStop ? "text-saffron-300" : "text-zinc-400",
                      )}
                    >
                      {nextStop ? journeyKm(toNextKm) : "—"}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                      {nextStop
                        ? `Left before ${nextStop.name}`
                        : "The last stop on this route — nothing left to ride."}
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { icon: Mountain, v: location.altitude, l: "Altitude" },
                    {
                      icon: Thermometer,
                      v: hereWeather ? (hereWeather.tempC === null ? "—" : `${hereWeather.tempC}°C`) : "—",
                      l: hereWeather ? hereWeather.label : "Weather",
                    },
                    { icon: Fuel, v: "68%", l: "Fuel · 210 km range" },
                    {
                      icon: Flag,
                      v: `${progressIndex + 1}/${stops.length || 1}`,
                      l: "Stop",
                    },
                  ].map((s) => (
                    <div key={s.l} className="rounded-2xl bg-white/[0.04] p-3.5">
                      <s.icon className="h-4 w-4 text-saffron-300" />
                      <p className="mt-2 font-display text-base font-bold text-white">{s.v}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">{s.l}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 rounded-2xl bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-300">
                      {nextStop
                        ? `Today · ${currentStop?.name ?? location.name} → ${nextStop.name}`
                        : `Final stretch · ${stops[stops.length - 1]?.name ?? "the destination"}`}
                    </span>
                    <span className="font-mono text-saffron-300">
                      {formatKm(coveredKm)} / {formatKm(totalKm)}
                    </span>
                  </div>
                  <div
                    className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.07]"
                    role="progressbar"
                    aria-valuenow={Math.round(progressPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Today's ride progress"
                  >
                    <div
                      className="h-full rounded-full bg-saffron-400 transition-all duration-700"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[11px] text-zinc-500">{note}</p>
                </div>

                {/* Weather at each checkpoint, start to finish. The map marks
                    them too; this is the version you can read without
                    squinting at a dot. */}
                {conditions && (
                  <div className="mt-4 rounded-2xl bg-white/[0.03] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                      Weather along the route
                    </p>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {stops.map((stop, index) => (
                        <li key={`${stop.name}-${index}`}>
                          <span className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] py-1 pl-2.5 pr-3">
                            <span className="max-w-[9rem] truncate text-[11px] font-medium text-zinc-300">
                              {stop.name}
                            </span>
                            {/* Every temperature opens its own forecast: what it
                                is doing there, the next three hours and the
                                week, with the place's name on the card. */}
                            <button
                              type="button"
                              data-weather-temp=""
                              onClick={() => setRoutePeek((current) => (current === index ? null : index))}
                              aria-expanded={routePeek === index}
                              aria-label={`Weather at ${stop.name}: open the next three hours and the coming week`}
                              className={cn(
                                "-my-1 -mr-1.5 rounded-full p-1 transition-transform duration-200 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron-400/70",
                                routePeek === index ? "scale-110" : "",
                              )}
                            >
                              <WeatherBadge conditions={conditions[index]} />
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {routePeek !== null && forecastFor(routePeek)}
                  </div>
                )}

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <TrackerButton
                    primary
                    cfg={data.buttons?.map}
                    fallback={{ label: "Open live map", href: "#/live-map", icon: "map-pin", visible: true }}
                  />
                  <TrackerButton
                    cfg={data.buttons?.nearby}
                    fallback={{ label: "Nearby places", href: "#/nearby", icon: "navigation", visible: true }}
                  />
                </div>
              </div>
            </Item>

            <Item>
              <div className="rounded-[2rem] glass p-6 sm:p-7">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                  Coming up next
                </p>
                <ul className="mt-4 flex flex-col">
                  {upcoming.map((stop, i) => (
                    <li key={stop.name} className="relative flex gap-4 pb-5 last:pb-0">
                      {i < upcoming.length - 1 && (
                        <span className="absolute left-[7px] top-5 h-full w-px bg-white/10" aria-hidden />
                      )}
                      <span className="mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2 border-saffron-400/70 bg-ink-950" aria-hidden />
                      <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="flex items-center gap-2 text-sm font-semibold text-white">
                            {stop.name}
                            <button
                              type="button"
                              data-weather-temp=""
                              onClick={() =>
                                setNextPeek((current) =>
                                  current === progressIndex + 1 + i ? null : progressIndex + 1 + i,
                                )
                              }
                              aria-expanded={nextPeek === progressIndex + 1 + i}
                              aria-label={`Weather at ${stop.name}: open the next three hours and the coming week`}
                              className={cn(
                                "rounded-full p-0.5 transition-transform duration-200 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron-400/70",
                                nextPeek === progressIndex + 1 + i ? "scale-110" : "",
                              )}
                            >
                              <WeatherBadge conditions={conditions?.[progressIndex + 1 + i]} compact />
                            </button>
                          </p>
                          <p className="text-xs text-zinc-500">
                            {stop.note || `${formatKm(totals[progressIndex + 1 + i] ?? 0)} from the start`}
                          </p>
                          {nextPeek === progressIndex + 1 + i && forecastFor(progressIndex + 1 + i)}
                        </div>
                        <span className="rounded-full bg-saffron-400/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-saffron-300">
                          {formatKm((totals[progressIndex + 1 + i] ?? 0) - coveredKm)}
                        </span>
                      </div>
                    </li>
                  ))}
                  {!upcoming.length && (
                    <li className="text-sm text-zinc-500">
                      {stops.length
                        ? `That is the last stop — the ride ends at ${stops[stops.length - 1].name}.`
                        : "Add stops in the dashboard and they show up here."}
                    </li>
                  )}
                </ul>
              </div>
            </Item>
          </Stagger>
        </div>
      </div>
    </section>
  );
}
