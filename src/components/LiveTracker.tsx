import { useMemo } from "react";
import {
  Satellite,
  MapPin,
  Mountain,
  Thermometer,
  Fuel,
  Navigation,
  BellPlus,
  Flag,
  ArrowUpRight,
} from "lucide-react";
import { resolveFooter, useSite, type LiveData } from "../store/siteContent";
import { SectionHeader, Reveal, Stagger, Item } from "./ui/motion";
import { InstagramIcon, externalLinkProps } from "./ui/SocialIcons";
import { useLiveLocation } from "../hooks/useLiveLocation";
import TrackerMap from "./TrackerMap";
import { cn } from "../utils/cn";

const NEXT_UPS = [
  { place: "Key Monastery", meta: "Tomorrow · 7:00 AM rollout", tag: "Sunrise shoot" },
  { place: "Chicham Bridge", meta: "Day 7 · Asia's highest bridge", tag: "Drone day" },
  { place: "Kibber Wildlife", meta: "Day 8 · snow-leopard trail", tag: "Full film" },
];

function ageLabel(sec: number): string {
  if (sec < 90) return `${sec}s ago`;
  if (sec < 5400) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

export default function LiveTracker({ data }: { data: LiveData }) {
  const { location, status, ageSec, istTime } = useLiveLocation();
  const lat = location.lat.toFixed(4);
  const lng = location.lng.toFixed(4);
  const note = data.note.trim() ? data.note : location.note;
  const { content } = useSite();
  const instagramHref = useMemo(() => {
    const instagram = resolveFooter(content.footer).socials.find((s) => s.label === "Instagram");
    return instagram?.enabled && instagram.href.trim() ? instagram.href.trim() : "";
  }, [content.footer]);
  const storyHref = status === "live" ? instagramHref : "";

  return (
    <section id="live" aria-labelledby="live-title" className="relative scroll-mt-28 py-24 sm:py-32">
      <div
        className="pointer-events-none absolute -left-40 top-1/4 h-96 w-96 rounded-full bg-emerald-500/10 blur-[130px]"
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
            <div className="relative flex h-full min-h-[440px] flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-ink-900 shadow-2xl shadow-black/50">
              <div className="absolute inset-0 bg-grid opacity-70 [mask-image:radial-gradient(ellipse_80%_80%_at_50%_40%,black,transparent)]" aria-hidden />
              <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-saffron-400/15 blur-[100px]" aria-hidden />
              <div className="absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-saffron-500/15 blur-[100px]" aria-hidden />
              <TrackerMap
                stops={data.stops}
                routeGeometry={data.routeGeometry}
                live={{ lat: location.lat, lng: location.lng }}
                liveName={location.name}
                liveState={location.state}
                status={status}
              />

              <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-5 sm:p-6">
                <a
                  href="#/live-map"
                  aria-label={`Live: PB is in ${location.name}, ${location.state}. Open the live Google Map.`}
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
                        "relative h-3 w-3 rounded-full animate-blink",
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
                <div className="hidden items-center gap-2 rounded-full bg-ink-950/70 px-3.5 py-2 text-[11px] font-medium text-zinc-300 backdrop-blur-md sm:flex">
                  <Satellite
                    className={cn(
                      "h-3.5 w-3.5",
                      status === "live" ? "text-emerald-300" : "text-amber-300"
                    )}
                  />
                  {status === "live"
                    ? `Ping ${ageLabel(ageSec)}`
                    : status === "stale"
                      ? `Last ping ${ageLabel(ageSec)}`
                      : "Window closed · 6 AM IST"}
                </div>
              </div>

              <div className="absolute right-5 top-24 grid h-11 w-11 place-items-center rounded-full glass" aria-hidden>
                <span className="flex flex-col items-center leading-none">
                  <Navigation className="h-3.5 w-3.5 fill-saffron-400 text-saffron-400" />
                  <span className="mt-0.5 text-[9px] font-bold text-zinc-400">N</span>
                </span>
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
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-blink" />
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
                      {location.state} · Day 6 of 12 · Spiti Circuit
                    </p>
                  </div>
                  <span className="rounded-full bg-white/[0.06] px-3.5 py-1.5 font-mono text-[11px] text-zinc-300">
                    IST {istTime}
                  </span>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { icon: Mountain, v: location.altitude, l: "Altitude" },
                    { icon: Thermometer, v: "-3°C", l: "Feels like" },
                    { icon: Fuel, v: "68%", l: "Fuel · 210 km range" },
                    { icon: Flag, v: "Day 6/12", l: "Expedition" },
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
                      Today · {location.name} → Key Monastery
                    </span>
                    <span className="font-mono text-saffron-300">29/42 km</span>
                  </div>
                  <div
                    className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.07]"
                    role="progressbar"
                    aria-valuenow={68}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Today's ride progress"
                  >
                    <div className="h-full w-[68%] rounded-full bg-saffron-400" />
                  </div>
                  <p className="mt-2 text-[11px] text-zinc-500">{note}</p>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <a
                    href="#/live-map"
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-ink-950 transition-all duration-300 hover:shadow-[0_0_28px_rgba(255,255,255,0.25)] active:scale-95"
                  >
                    <MapPin className="h-4 w-4" />
                    Open live Google Map
                  </a>
                  <a
                    href={storyHref || "#cta"}
                    {...(storyHref ? externalLinkProps(storyHref) : {})}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:border-white/30 hover:bg-white/[0.06] active:scale-95"
                  >
                    {storyHref ? <InstagramIcon className="h-4 w-4" /> : <BellPlus className="h-4 w-4 text-saffron-300" />}
                    {storyHref ? "Follow live stories" : "Get ping alerts"}
                  </a>
                </div>
              </div>
            </Item>

            <Item>
              <div className="rounded-[2rem] glass p-6 sm:p-7">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                  Coming up next
                </p>
                <ul className="mt-4 flex flex-col">
                  {NEXT_UPS.map((n, i) => (
                    <li key={n.place} className="relative flex gap-4 pb-5 last:pb-0">
                      {i < NEXT_UPS.length - 1 && (
                        <span className="absolute left-[7px] top-5 h-full w-px bg-white/10" aria-hidden />
                      )}
                      <span className="mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2 border-saffron-400/70 bg-ink-950" aria-hidden />
                      <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-white">{n.place}</p>
                          <p className="text-xs text-zinc-500">{n.meta}</p>
                        </div>
                        <span className="rounded-full bg-saffron-400/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-saffron-300">
                          {n.tag}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </Item>
          </Stagger>
        </div>
      </div>
    </section>
  );
}
