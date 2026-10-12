import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin,
  Calendar,
  Route as RouteIcon,
  Clock,
  ChevronRight,
  Pause,
  Play,
} from "lucide-react";
import type { JourneyData, Destination } from "../store/siteContent";
import { EASE, SectionHeader, Reveal } from "./ui/motion";
import { isOn } from "../utils/enabled";
import { cn } from "../utils/cn";

export default function Showcase({ data }: { data: JourneyData }) {
  const destinations: Destination[] = data.destinations.filter(isOn);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const safe = Math.min(active, destinations.length - 1);
  const dest = destinations[safe];

  useEffect(() => {
    if (paused || destinations.length < 2) return;
    const id = setInterval(() => setActive((a) => (a + 1) % destinations.length), 6000);
    return () => clearInterval(id);
  }, [paused, destinations.length]);

  return (
    <section id="journey" aria-labelledby="journey-title" className="relative scroll-mt-28 py-24 sm:py-32">
      <div
        className="pointer-events-none absolute right-0 top-24 h-80 w-80 rounded-full bg-saffron-500/10 blur-[120px]"
        aria-hidden
      />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeader
          eyebrow={data.eyebrow}
          id="journey-title"
          title={
            <>
              {data.titleA}
              <span className="text-gradient">{data.titleHi}</span>
              {data.titleB}
            </>
          }
          sub={data.sub}
        />

        {destinations.length === 0 ? (
          <p className="mt-14 rounded-2xl glass p-8 text-center text-sm text-zinc-500">
            No destinations added yet — add some from the admin dashboard.
          </p>
        ) : (
          <>
            {/* mobile tabs */}
            <div
              className="no-scrollbar mt-12 flex gap-2 overflow-x-auto pb-2 lg:hidden"
              role="tablist"
              aria-label="Destinations"
            >
              {destinations.map((d, i) => (
                <button
                  key={d.name}
                  role="tab"
                  aria-selected={i === safe}
                  onClick={() => {
                    setActive(i);
                    setPaused(true);
                  }}
                  className={cn(
                    "shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all duration-300",
                    i === safe
                      ? "bg-saffron-400 text-white shadow-lg shadow-saffron-400/25"
                      : "glass text-zinc-400"
                  )}
                >
                  {d.name}
                </button>
              ))}
            </div>

            <div
              className="relative mt-8 lg:mt-14"
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
            >
              {/* desktop list — layered inside the image, on the left */}
              <Reveal className="absolute inset-y-6 left-6 z-20 hidden w-[300px] lg:block">
                <div
                  role="tablist"
                  aria-label="Destinations"
                  className="no-scrollbar machine-dest-list flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto rounded-[1.5rem] border border-white/15 p-2 shadow-2xl shadow-black/50 backdrop-blur-xl"
                >
                  {destinations.map((d, i) => {
                    const isActive = i === safe;
                    return (
                      <button
                        key={d.name}
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setActive(i)}
                        className={cn(
                          "group relative flex items-center gap-4 rounded-2xl border px-5 py-4 text-left transition-all duration-400",
                          isActive
                            ? "border-white/20 bg-white/[0.06]"
                            : "border-transparent hover:border-white/10 hover:bg-white/[0.03]"
                        )}
                      >
                        {isActive && (
                          <motion.span
                            layoutId="dest-pill"
                            className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-full bg-saffron-400"
                            transition={{ type: "spring", stiffness: 380, damping: 32 }}
                          />
                        )}
                        <span
                          className={cn(
                            "grid h-9 w-9 shrink-0 place-items-center rounded-xl font-display text-xs font-bold transition-all duration-300",
                            isActive
                              ? "bg-saffron-400 text-white"
                              : "bg-white/[0.06] text-zinc-500 group-hover:text-zinc-300"
                          )}
                        >
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block truncate font-display text-[15px] font-semibold transition-colors duration-300",
                              isActive ? "text-white" : "text-zinc-300"
                            )}
                          >
                            {d.name}
                          </span>
                          <span className="block truncate text-xs text-zinc-500">
                            {d.state} · {d.distance}
                          </span>
                        </span>
                        <ChevronRight
                          className={cn(
                            "h-4 w-4 shrink-0 transition-all duration-300",
                            isActive
                              ? "translate-x-0 text-saffron-400 opacity-100"
                              : "-translate-x-1 text-zinc-600 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
                          )}
                        />
                      </button>
                    );
                  })}

                </div>
              </Reveal>

              {/* stage — full width; the list overlays it on the left */}
              <div className="relative">
                <div className="relative overflow-hidden rounded-[2rem] border border-white/10 shadow-2xl shadow-black/50">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={dest.name}
                      initial={{ opacity: 0, scale: 1.04 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.99 }}
                      transition={{ duration: 0.7, ease: EASE }}
                    >
                      <img
                        src={dest.image}
                        alt={`${dest.name} — ${dest.tagline}`}
                        className="aspect-[4/3.2] w-full object-cover sm:aspect-[16/9]"
                        loading="lazy"
                      />
                    </motion.div>
                  </AnimatePresence>
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/25 to-transparent" />

                  <div className="absolute left-5 top-5 flex items-center gap-2 lg:left-auto lg:right-[76px]">
                    <span className="rounded-full bg-ink-950/60 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur-md">
                      {dest.vibe}
                    </span>
                    <span className="hidden items-center gap-1.5 rounded-full bg-ink-950/60 px-3.5 py-1.5 text-xs font-medium text-zinc-300 backdrop-blur-md sm:flex">
                      <MapPin className="h-3.5 w-3.5 text-saffron-400" />
                      {dest.state}
                    </span>
                  </div>

                  {/* floating carousel control — top right */}
                  <button
                    type="button"
                    onClick={() => setPaused((p) => !p)}
                    aria-pressed={!paused}
                    aria-label={paused ? "Resume image carousel" : "Pause image carousel"}
                    title={paused ? "Resume carousel" : "Pause carousel"}
                    className="absolute right-5 top-5 z-30 grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-ink-950/60 text-white shadow-xl shadow-black/40 backdrop-blur-md transition-all duration-300 hover:scale-110 hover:border-saffron-300 hover:bg-ink-950/80 active:scale-95"
                  >
                    {paused ? (
                      <Play className="h-4 w-4 fill-current" />
                    ) : (
                      <Pause className="h-4 w-4 fill-current" />
                    )}
                  </button>

                  <div className="absolute inset-x-0 bottom-0 p-6 sm:p-9 lg:left-[332px] lg:pl-4">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={dest.name}
                        initial={{ opacity: 0, y: 22 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.55, ease: EASE }}
                      >
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-saffron-300">
                          {dest.tagline}
                        </p>
                        <h3 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                          {dest.name}
                        </h3>
                        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-300 sm:text-[15px]">
                          {dest.description}
                        </p>

                        <div className="mt-6 flex flex-wrap gap-x-7 gap-y-3">
                          {[
                            { icon: RouteIcon, label: dest.distance, sub: "Total distance" },
                            { icon: Clock, label: dest.days, sub: "Suggested pace" },
                            { icon: Calendar, label: dest.season, sub: "Best window" },
                          ].map((s) => (
                            <div key={s.sub} className="flex items-center gap-2.5">
                              <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.08] text-saffron-300 backdrop-blur-md">
                                <s.icon className="h-4 w-4" />
                              </span>
                              <div>
                                <p className="text-sm font-semibold text-white">{s.label}</p>
                                <p className="text-[11px] text-zinc-400">{s.sub}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-center gap-2 lg:hidden">
                  {destinations.map((d, i) => (
                    <button
                      key={d.name}
                      onClick={() => setActive(i)}
                      aria-label={`Show ${d.name}`}
                      className={cn(
                        "h-1.5 rounded-full transition-all duration-400",
                        i === safe ? "w-8 bg-saffron-400" : "w-1.5 bg-white/15"
                      )}
                    />
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
