import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Gauge,
  Cog,
  MonitorSmartphone,
  Fuel,
  Luggage,
  Wrench,
  MoonStar,
  Play,
  Download,
  Plus,
  ExternalLink,
  X,
} from "lucide-react";
import type { BikeHotspot, MachineData } from "../store/siteContent";
import { SectionHeader, Reveal, Stagger, Item, CountUp, EASE } from "./ui/motion";
import { isOn } from "../utils/enabled";
import { cn } from "../utils/cn";

const SPECS = [
  { icon: Cog, v: "452cc", l: "Liquid-cooled Sherpa single" },
  { icon: Gauge, v: "40.02 PS", l: "@ 8,000 rpm · 40 Nm" },
  { icon: Fuel, v: "17 L", l: "Tank · ≈450 km range" },
  { icon: Wrench, v: "230 mm", l: "Ground clearance" },
  { icon: MonitorSmartphone, v: '4" TFT', l: "TripperDash + maps" },
  { icon: Luggage, v: "196 kg", l: "Kerb · switchable rear ABS" },
];

function clampPct(n: unknown, fallback = 50): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(100, Math.max(0, v));
}

function AccessoryBubble({
  spot,
  x,
  onClose,
}: {
  spot: BikeHotspot;
  x: number;
  onClose: () => void;
}) {
  const openLeft = x > 55;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      transition={{ duration: 0.28, ease: EASE }}
      className={cn(
        "absolute z-30 w-[240px] overflow-hidden rounded-2xl border border-white/15 bg-ink-950/95 shadow-2xl shadow-black/70 backdrop-blur-xl sm:w-[260px]",
        openLeft ? "right-[calc(100%+12px)]" : "left-[calc(100%+12px)]",
        "top-1/2 -translate-y-1/2"
      )}
      role="dialog"
      aria-label={spot.title}
    >
      {spot.image && (
        <div className="relative h-28 overflow-hidden sm:h-32">
          <img src={spot.image} alt={spot.title} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 to-transparent" />
        </div>
      )}
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-display text-sm font-semibold leading-snug text-white">{spot.title}</p>
            {spot.price && (
              <p className="mt-0.5 font-mono text-xs font-bold text-saffron-300">{spot.price}</p>
            )}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close accessory details"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-zinc-400 hover:bg-white/20 hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
        {spot.desc && (
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">{spot.desc}</p>
        )}
        {spot.link && (
          <a
            href={spot.link}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-saffron-400 px-3 py-2 text-[11px] font-bold text-white shadow-lg shadow-saffron-400/20 transition-all hover:brightness-110"
          >
            View product
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </motion.div>
  );
}

export default function BikeShowcase({ data }: { data: MachineData }) {
  const spots = Array.isArray(data.hotspots) ? data.hotspots.filter(isOn) : [];
  const [active, setActive] = useState<number | null>(spots.length ? 0 : null);
  const [open, setOpen] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!stageRef.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const select = (i: number) => {
    setActive(i);
    setOpen(i);
  };

  // Selected part slides to the first position; the rest keep their order.
  const indexed = spots.map((spot, idx) => ({ spot, idx }));
  const ordered =
    active === null || !indexed[active]
      ? indexed
      : [indexed[active], ...indexed.filter((o) => o.idx !== active)];

  const odoPct = Math.min(100, Math.round((data.km / 50000) * 100));

  return (
    <section id="machine" aria-labelledby="machine-title" className="relative scroll-mt-28 py-24 sm:py-32">
      <div
        className="pointer-events-none absolute right-0 top-24 h-96 w-96 rounded-full bg-saffron-400/10 blur-[130px]"
        aria-hidden
      />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeader
          eyebrow={data.eyebrow}
          id="machine-title"
          title={
            <>
              {data.titleA}
              <span className="text-gradient font-urdu" dir="rtl" lang="ur">
                {data.titleHi}
              </span>
              {data.titleB}
            </>
          }
          sub={data.sub}
        />

        <div className="mt-14 grid gap-6 lg:grid-cols-[1.12fr_0.88fr]">
          {/* ================= LEFT: bike visual + pointer guide ================= */}
          <Reveal className="flex h-full flex-col gap-5">
            <div
              ref={stageRef}
              className="relative shrink-0 overflow-hidden rounded-[2rem] border border-white/10 shadow-2xl shadow-black/50"
            >
              {/* Image sets the box size, so pointer % positions match the dashboard exactly */}
              <img
                src={data.mainImage}
                alt={data.mainImageAlt}
                className={cn(
                  "block h-auto w-full transition-all duration-700",
                  open !== null && "scale-[1.03] brightness-[0.72]"
                )}
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink-950/85 via-transparent to-ink-950/25" aria-hidden />

              <div className="absolute left-5 top-5 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-black/70 px-3.5 py-1.5 text-xs font-bold tracking-wide text-white backdrop-blur-md">
                  HANLE BLACK
                </span>
                <span className="rounded-full bg-ink-950/60 px-3.5 py-1.5 text-xs font-medium text-zinc-300 backdrop-blur-md">
                  Sherpa 450 · 2024
                </span>
              </div>

              {spots.map((h, i) => {
                const x = clampPct(h.x);
                const y = clampPct(h.y);
                const isOn = open === i || active === i;
                return (
                  <div
                    key={`${h.title}-${i}`}
                    className="absolute z-20"
                    style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
                    onMouseEnter={() => {
                      setActive(i);
                      setOpen(i);
                    }}
                  >
                    {isOn && (
                      <span
                        className="pointer-events-none absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full bg-saffron-400/20 blur-2xl ring-2 ring-saffron-300/50"
                        aria-hidden
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => select(i)}
                      aria-pressed={isOn}
                      aria-label={`Show ${h.title}`}
                      className="relative grid place-items-center"
                    >
                      {isOn && (
                        <span className="absolute h-12 w-12 rounded-full bg-saffron-400/35 animate-radar" aria-hidden />
                      )}
                      <span
                        className={cn(
                          "relative grid h-8 w-8 place-items-center rounded-full border backdrop-blur-md transition-all duration-300",
                          isOn
                            ? "scale-110 text-white shadow-lg shadow-saffron-400/50"
                            : "border-white/50 bg-ink-950/70 text-white hover:scale-105 hover:border-saffron-300",
                          isOn && !h.color && "border-saffron-300 bg-saffron-400"
                        )}
                        style={
                          h.color
                            ? {
                                background: isOn ? `linear-gradient(135deg, ${h.color}, ${h.color}99)` : undefined,
                                borderColor: h.color,
                                boxShadow: isOn ? `0 8px 24px ${h.color}66` : undefined,
                              }
                            : undefined
                        }
                      >
                        {isOn ? <span className="h-2 w-2 rounded-full bg-white" /> : <Plus className="h-4 w-4" />}
                      </span>
                    </button>
                    <AnimatePresence>
                      {open === i && (
                        <AccessoryBubble spot={h} x={x} onClose={() => setOpen(null)} />
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}

              <div className="absolute inset-x-5 bottom-5 z-10 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="flex flex-wrap items-baseline gap-x-2 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                    <span className="font-urdu text-3xl sm:text-4xl" dir="rtl" lang="ur">
                      {data.namePlate}
                    </span>
                    {data.namePlateEn && (
                      <span className="text-lg font-medium text-zinc-400 sm:text-xl">
                        ({data.namePlateEn})
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-400 sm:text-sm">{data.plateSub}</p>
                </div>
                <div className="rounded-2xl bg-ink-950/60 px-4 py-2.5 backdrop-blur-xl">
                  <p className="font-display text-lg font-bold text-white">
                    <CountUp to={data.km} /> <span className="text-sm font-medium text-zinc-400">km</span>
                  </p>
                  <p className="text-[11px] text-zinc-500">together since Jan '24</p>
                </div>
              </div>
            </div>

            {/* Fills the space under the bike image */}
            <div className="flex flex-1 flex-col justify-between gap-5 rounded-[2rem] glass p-6 sm:p-7">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Pointer guide
                </p>
                <p className="mt-1 text-[11px] text-zinc-600">Tap a chip — or a + on the bike</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {spots.map((h, i) => {
                    const isOn = active === i;
                    return (
                      <button
                        key={`${h.title}-chip-${i}`}
                        type="button"
                        onClick={() => select(i)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all duration-300",
                          isOn
                            ? "border-saffron-400/60 bg-saffron-400/15 text-white"
                            : "border-white/10 bg-white/[0.04] text-zinc-400 hover:border-white/25 hover:text-white"
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold",
                            isOn ? "bg-saffron-400 text-on-gold" : "bg-white/10 text-zinc-300"
                          )}
                        >
                          {i + 1}
                        </span>
                        {h.title}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-white/10 pt-4">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-zinc-300">Odometer to 50,000 km</span>
                  <span className="font-mono text-saffron-300">
                    {data.km.toLocaleString("en-IN")} km
                  </span>
                </div>
                <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className="h-full rounded-full bg-saffron-400"
                    style={{ width: `${odoPct}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-zinc-500">
                  {Math.max(0, 50000 - data.km).toLocaleString("en-IN")} km to the half-lakh
                  milestone
                </p>
              </div>
            </div>
          </Reveal>

          {/* ================= RIGHT: accessory list + specs ================= */}
          <div className="flex flex-col gap-5">
            <Reveal>
              <div className="rounded-[2rem] glass p-6 sm:p-7">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Click a part — here or on the bike
                </p>
                {spots.length === 0 ? (
                  <p className="mt-4 text-sm text-zinc-500">
                    No pointers yet — add them in the admin dashboard under The Machine.
                  </p>
                ) : (
                  <motion.ul layout className="mt-4 flex flex-col gap-2">
                    {ordered.map(({ spot: h, idx }) => {
                      const isOn = active === idx;
                      return (
                        <motion.li
                          key={`${h.title}-${idx}`}
                          layout
                          transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.7 }}
                          className={cn(
                            "overflow-hidden rounded-2xl border transition-colors duration-300",
                            isOn
                              ? "border-saffron-400/45 bg-saffron-400/[0.08] shadow-lg shadow-black/30"
                              : "border-transparent bg-white/[0.03] hover:border-white/10 hover:bg-white/[0.06]"
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => select(idx)}
                            aria-expanded={isOn}
                            className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                          >
                            <motion.span
                              layout
                              className={cn(
                                "grid shrink-0 overflow-hidden rounded-xl border transition-all duration-300",
                                isOn ? "h-14 w-14 border-saffron-400/50" : "h-10 w-10 border-white/10"
                              )}
                            >
                              {h.image ? (
                                <img src={h.image} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <span className="grid h-full w-full place-items-center text-zinc-500">
                                  <Plus className="h-4 w-4" />
                                </span>
                              )}
                            </motion.span>
                            <motion.span layout className="min-w-0 flex-1">
                              <span
                                className={cn(
                                  "block truncate font-semibold text-white transition-all duration-300",
                                  isOn ? "text-base" : "text-sm"
                                )}
                              >
                                {h.title}
                              </span>
                              <span className="block truncate text-[11px] text-saffron-300">
                                {h.price}
                              </span>
                            </motion.span>
                            {isOn && (
                              <motion.span
                                layout
                                className="shrink-0 rounded-full bg-saffron-400/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-saffron-300"
                              >
                                Selected
                              </motion.span>
                            )}
                          </button>

                          <AnimatePresence initial={false}>
                            {isOn && (
                              <motion.div
                                key="detail"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.38, ease: EASE }}
                                className="overflow-hidden"
                              >
                                <div className="border-t border-white/10 px-3.5 py-3.5">
                                  <p className="text-[13px] leading-relaxed text-zinc-400">{h.desc}</p>
                                  {h.link && (
                                    <a
                                      href={h.link}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-saffron-400 px-4 py-2 text-[11px] font-bold text-white shadow-lg shadow-saffron-400/20 transition-all hover:brightness-110"
                                    >
                                      View product
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.li>
                      );
                    })}
                  </motion.ul>
                )}
              </div>
            </Reveal>

            <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
              {SPECS.map((s) => (
                <Item key={s.l}>
                  <div className="group h-full rounded-2xl glass p-4 transition-all duration-300 hover:-translate-y-1 hover:border-white/20">
                    <s.icon className="h-4 w-4 text-saffron-300" />
                    <p className="mt-2.5 font-display text-lg font-bold text-white">{s.v}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{s.l}</p>
                  </div>
                </Item>
              ))}
            </Stagger>
          </div>
        </div>

        {/* ---------- story + mods + CTA ---------- */}
        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          <Reveal className="h-full">
            <div className="flex h-full flex-col justify-between gap-6 overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[0.07] to-transparent p-7">
              <div>
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-saffron-400/15 text-saffron-300">
                  <MoonStar className="h-5 w-5" />
                </span>
                <h3 className="mt-5 font-display text-xl font-semibold text-white">{data.whyTitle}</h3>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">{data.whyText}</p>
              </div>
              <p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500">{data.whyFoot}</p>
            </div>
          </Reveal>

          <Reveal delay={0.1} className="h-full">
            <div className="flex h-full flex-col rounded-[2rem] glass p-7">
              <h3 className="font-display text-xl font-semibold text-white">PB's expedition setup</h3>
              <p className="mt-1 text-xs text-zinc-500">Every bolt earned over {data.km.toLocaleString("en-IN")} km</p>
              <ul className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {data.mods.map((m) => (
                  <li
                    key={m}
                    className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-[13px] text-zinc-300"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-saffron-400" />
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={0.15} className="h-full">
            <div className="flex h-full flex-col rounded-[2rem] glass p-7">
              <h3 className="font-display text-xl font-semibold text-white">
                Take{" "}
                <span className="font-urdu" dir="rtl" lang="ur">
                  {data.namePlate}
                </span>{" "}
                ({data.namePlateEn}) for a spin
              </h3>
              <p className="mt-1 text-xs text-zinc-500">The full review + setup sheet</p>
              <div className="mt-5 flex flex-1 flex-col gap-3">
                <a
                  href="#showreel"
                  className="group inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-saffron-400 px-5 py-4 font-display text-sm font-semibold text-white shadow-xl shadow-saffron-400/25 transition-all duration-300 hover:brightness-110 active:scale-95"
                >
                  <Play className="h-4 w-4 fill-current" />
                  {data.filmCta}
                </a>
                <a
                  href="#cta"
                  className="group inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white/[0.06] px-5 py-4 font-display text-sm font-semibold text-white transition-all duration-300 hover:bg-white hover:text-ink-950 active:scale-95"
                >
                  <Download className="h-4 w-4" />
                  {data.pdfCta}
                </a>
              </div>
              <p className="mt-4 text-center text-[11px] text-zinc-500">{data.serviceLine}</p>
            </div>
          </Reveal>
        </div>

        {/* ---------- gallery ---------- */}
        <Stagger className="mt-5 grid gap-5 sm:grid-cols-3">
          {data.gallery.filter(isOn).map((g, i) => (
            <Item key={`${g.src}-${i}`}>
              <figure className="group relative overflow-hidden rounded-[1.75rem] border border-white/10">
                <img
                  src={g.src}
                  alt={g.alt}
                  loading="lazy"
                  className="aspect-[16/10] w-full object-cover transition-transform duration-[1.2s] ease-out group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink-950/80 via-transparent to-transparent" aria-hidden />
                <figcaption className="absolute bottom-4 left-4 rounded-full bg-ink-950/60 px-3.5 py-1.5 text-xs font-medium text-white backdrop-blur-md">
                  {g.cap}
                </figcaption>
              </figure>
            </Item>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
