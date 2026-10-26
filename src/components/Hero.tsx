import { motion, useReducedMotion } from "framer-motion";
import { Play, Star, MapPin, TrendingUp, BadgeCheck, Navigation, Crosshair } from "lucide-react";
import { resolveOrigin, type HeroData } from "../store/siteContent";
import { EASE, Reveal } from "./ui/motion";
import Photo from "./ui/Photo";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.35 } },
};
const item = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 1, ease: EASE } },
};


/**
 * Where the rider is from, written the way a map writes a place.
 *
 * A survey plate rather than another paragraph: a pin, the latitude and
 * longitude as two labelled readings, and the place filling the space to their
 * right. That last part matters — the hero's copy column is wider than a short
 * line of coordinates, so a narrow plate left a hole beside it. This one runs
 * the width of the paragraph above (same `max-w-xl`), and puts the place and
 * its small note on the far side of a hairline, right-aligned, so the whole row
 * reads as one instrument instead of a label with empty space after it.
 *
 * The coordinates are separated by a rule rather than a slash: a thin vertical
 * line is a map's own punctuation, and reads as "two readings" instead of a
 * fraction.
 *
 * Everything on it comes from the hero's own fields, so an owner who moves the
 * pin changes four values in the dashboard rather than hunting for a literal.
 */
function OriginPlate({ data }: { data: HeroData }) {
  const origin = resolveOrigin(data);

  return (
    <figure
      className="group relative mt-7 w-full max-w-xl overflow-hidden rounded-2xl border border-white/12 bg-white/[0.03] backdrop-blur-sm transition-colors duration-300 hover:border-saffron-400/40 hover:bg-saffron-400/[0.05]"
      title={origin.label}
    >
      {/* the graticule: faint grid, fading right so it never fights the text */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-grid opacity-[0.14] [mask-image:linear-gradient(90deg,black,transparent_88%)]"
      />
      {/* a warm pool of light behind the pin */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-8 top-1/2 h-28 w-28 -translate-y-1/2 rounded-full bg-saffron-400/10 opacity-70 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
      />

      {/* corner ticks — the four marks of a graticule */}
      {[
        "left-0 top-0 border-l border-t rounded-tl-2xl",
        "right-0 top-0 border-r border-t rounded-tr-2xl",
        "left-0 bottom-0 border-l border-b rounded-bl-2xl",
        "right-0 bottom-0 border-r border-b rounded-br-2xl",
      ].map((corner) => (
        <span
          key={corner}
          aria-hidden
          className={`pointer-events-none absolute h-2.5 w-2.5 border-saffron-400/60 transition-colors duration-300 group-hover:border-saffron-300 ${corner}`}
        />
      ))}

      <div className="relative flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5 sm:flex-nowrap sm:px-5">
        {/* the pin, with a slow ping so the plate feels like a live reading */}
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-saffron-400/30 bg-saffron-400/10 text-saffron-300">
          <Crosshair className="h-4 w-4" aria-hidden />
          <span className="absolute -right-1 -top-1 flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-saffron-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-saffron-400" />
          </span>
        </span>

        <figcaption className="flex items-center gap-3.5 font-mono sm:gap-4">
          <span className="block">
            <span className="block text-[9px] uppercase leading-none tracking-[0.3em] text-zinc-600">Lat</span>
            <span className="mt-1.5 block whitespace-nowrap text-[12px] leading-none tracking-[0.1em] text-zinc-100">
              {origin.lat}
            </span>
          </span>
          {/* the divider: a hairline, not an oblique */}
          <span aria-hidden className="h-7 w-px shrink-0 bg-white/15 transition-colors duration-300 group-hover:bg-saffron-400/40" />
          <span className="block">
            <span className="block text-[9px] uppercase leading-none tracking-[0.3em] text-zinc-600">Lng</span>
            <span className="mt-1.5 block whitespace-nowrap text-[12px] leading-none tracking-[0.1em] text-zinc-100">
              {origin.lng}
            </span>
          </span>
        </figcaption>

        {/* The place, and the quiet line after it.
            One line rather than two stacked ones: the coordinates beside it are
            a single row, so a two-line block on the right left the lower-left of
            the plate empty and made the whole thing look half-filled. Place and
            note now sit on the same baseline, divided by a small gold dot. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1 sm:justify-end">
          <p className="truncate text-[10px] font-medium uppercase tracking-[0.24em] text-zinc-300">
            {origin.place}
          </p>
          {origin.note && (
            <>
              <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-saffron-400/70" />
              <p className="min-w-0 truncate text-[10px] text-zinc-500">{origin.note}</p>
            </>
          )}
        </div>
      </div>
    </figure>
  );
}

export default function Hero({ data }: { data: HeroData }) {
  const reduce = useReducedMotion();
  const float = (delay: number, dist = 10) =>
    reduce
      ? {}
      : {
          animate: { y: [0, -dist, 0] },
          transition: { duration: 6 + delay, repeat: Infinity, ease: "easeInOut" as const, delay },
        };

  return (
    <section id="top" className="relative overflow-hidden pt-32 sm:pt-40">
      {/* ambient background */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0 bg-grid opacity-60 [mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,black,transparent)]" />
        <div className="glow absolute -top-32 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-saffron-400/10 blur-[100px] animate-pulse-soft" />
        <div className="glow absolute top-40 -left-40 h-96 w-96 rounded-full bg-saffron-400/8 blur-[100px]" />
        <div className="glow absolute top-64 -right-40 h-96 w-96 rounded-full bg-saffron-500/8 blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
          {/* ---------- Copy ---------- */}
          <motion.div variants={container} initial="hidden" animate="show" className="max-w-2xl">
            <motion.div variants={item}>
              <a
                href="#/live-map"
                className="group inline-flex items-center gap-2.5 rounded-full glass px-4 py-2 text-xs font-medium text-zinc-300 transition-all duration-300 hover:border-emerald-400/40 hover:bg-emerald-400/[0.07] hover:text-white"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                {data.liveTag}
                <Navigation className="h-3.5 w-3.5 text-emerald-300 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            </motion.div>

            <motion.h1
              variants={item}
              className="mt-7 font-display text-[2.65rem] font-semibold leading-[1.04] tracking-tight text-white sm:text-6xl lg:text-[4.35rem]"
            >
              {data.headA}
              <span className="text-gradient">{data.headHi}</span>
              {data.headB}
            </motion.h1>

            <motion.p
              variants={item}
              className="mt-6 max-w-xl text-base leading-relaxed text-zinc-400 sm:text-lg"
            >
              {data.sub}
            </motion.p>

            <motion.div variants={item}>
              <OriginPlate data={data} />
            </motion.div>

            <motion.div variants={item} className="mt-9 flex flex-wrap items-center gap-4">
              <a
                href={data.cta1Href || "#"}
                className="group relative inline-flex items-center gap-2.5 rounded-full bg-saffron-400 px-7 py-4 font-display text-[15px] font-semibold text-on-gold shadow-xl shadow-saffron-400/30 transition-all duration-300 hover:shadow-[0_8px_40px_rgba(245,179,1,0.45)] hover:brightness-110 active:scale-95"
              >
                <MapPin className="h-4.5 w-4.5" />
                {data.cta1}
              </a>
              <a
                href={data.cta2Href || "#"}
                className="group inline-flex items-center gap-3 rounded-full glass px-6 py-4 font-display text-[15px] font-semibold text-white transition-all duration-300 hover:border-white/25 hover:bg-white/[0.07] active:scale-95"
              >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 transition-all duration-300 group-hover:scale-110 group-hover:bg-saffron-400">
                  <Play className="h-3.5 w-3.5 fill-current" />
                </span>
                {data.cta2}
              </a>
            </motion.div>

            <motion.div variants={item} className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
              <div className="flex items-center">
                {["AM", "RK", "IS", "KB"].map((n, i) => (
                  <span
                    key={n}
                    className="grid h-9 w-9 place-items-center rounded-full border-2 border-ink-950 bg-saffron-400 text-[10px] font-bold text-on-gold"
                    style={{
                      marginLeft: i === 0 ? 0 : -10,
                      zIndex: 4 - i,
                    }}
                  >
                    {n}
                  </span>
                ))}
                <span className="ml-3 text-sm text-zinc-400">
                  <span className="font-semibold text-white">
                    {data.ratingText.split(" ").slice(0, 1).join(" ")}
                  </span>{" "}
                  {data.ratingText.split(" ").slice(1).join(" ")}
                </span>
              </div>
              <div className="hidden h-8 w-px bg-white/10 sm:block" />
              <div className="flex items-center gap-1.5 text-sm text-zinc-400">
                <TrendingUp className="h-4 w-4 text-emerald-400" />
                <span>
                  <span className="font-semibold text-white">
                    {data.tribeText.split(" ").slice(0, 1).join(" ")}
                  </span>{" "}
                  {data.tribeText.split(" ").slice(1).join(" ")}
                </span>
              </div>
            </motion.div>
          </motion.div>

          {/* ---------- Visual ---------- */}
          <div className="relative mx-auto w-full max-w-[560px] lg:max-w-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 1.2, ease: EASE, delay: 0.5 }}
              className="relative"
            >
              {/* main image */}
              <div className="relative overflow-hidden rounded-[2rem] border border-white/10 shadow-2xl shadow-black/60">
                <Photo
                  src={data.mainImage}
                  alt="Winding mountain road through the snowcapped Himalayas of Leh, Ladakh"
                  className="aspect-[4/3.4] w-full object-cover sm:aspect-[4/3]"
                  priority
                  label="Photo unavailable"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink-950/80 via-transparent to-ink-950/10" />
                {/* location chip */}
                <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-ink-950/60 px-3.5 py-2 text-xs font-medium text-white backdrop-blur-md">
                  <MapPin className="h-3.5 w-3.5 text-saffron-400" />
                  {data.chipLocation}
                </div>
                {/* bottom card */}
                <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-2xl bg-ink-950/55 p-3 backdrop-blur-xl">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-saffron-400">
                    <Play className="h-4 w-4 fill-white text-white" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{data.epTitle}</p>
                    <p className="text-xs text-zinc-400">{data.epMeta}</p>
                  </div>
                  <span className="ml-auto hidden shrink-0 items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[10px] font-semibold text-emerald-300 sm:flex">
                    <BadgeCheck className="h-3 w-3" /> New
                  </span>
                </div>
              </div>

              {/* floating card A */}
              <motion.div
                {...float(0.4, 12)}
                className="absolute -left-6 top-14 hidden w-44 overflow-hidden rounded-2xl border border-white/15 shadow-2xl shadow-black/50 sm:block lg:-left-12"
              >
                <Photo
                  src={data.cardAImage}
                  alt={data.cardATitle}
                  className="aspect-square w-full object-cover"
                  label="Photo unavailable"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950/90 to-transparent p-2.5 pt-6">
                  <p className="text-[11px] font-semibold text-white">{data.cardATitle}</p>
                  <p className="text-[10px] text-zinc-400">{data.cardAMeta}</p>
                </div>
              </motion.div>

              {/* floating card B */}
              <motion.div
                {...float(1.1, 14)}
                className="absolute -right-4 bottom-24 hidden w-40 overflow-hidden rounded-2xl border border-white/15 shadow-2xl shadow-black/50 sm:block lg:-right-10"
              >
                <Photo
                  src={data.cardBImage}
                  alt={data.cardBTitle}
                  className="aspect-square w-full object-cover"
                  label="Photo unavailable"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950/90 to-transparent p-2.5 pt-6">
                  <p className="text-[11px] font-semibold text-white">{data.cardBTitle}</p>
                  <p className="text-[10px] text-zinc-400">{data.cardBMeta}</p>
                </div>
              </motion.div>

              {/* floating stat chip */}
              <motion.div
                {...float(0.8, 10)}
                className="absolute -bottom-6 -left-4 hidden items-center gap-3 rounded-2xl glass px-4 py-3 shadow-xl shadow-black/40 md:flex lg:-left-14"
              >
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-400/15 text-emerald-300">
                  <TrendingUp className="h-4.5 w-4.5" />
                </span>
                <div>
                  <p className="font-display text-sm font-bold text-white">{data.statTop}</p>
                  <p className="text-[11px] text-zinc-400">{data.statSub}</p>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </div>

        {/* ---------- destination marquee ---------- */}
        <Reveal delay={0.2} className="relative mt-20 sm:mt-24">
          <div className="mask-fade-x overflow-hidden border-y border-white/[0.06] py-5">
            <div className="flex w-max animate-marquee gap-10">
              {[...data.marquee, ...data.marquee].map((d, i) => (
                <span
                  key={`${d}-${i}`}
                  aria-hidden={i >= data.marquee.length}
                  className="flex items-center gap-10 whitespace-nowrap font-display text-sm font-medium uppercase tracking-[0.3em] text-zinc-500"
                >
                  {d}
                  <Star className="h-3 w-3 fill-saffron-400/60 text-saffron-400/60" />
                </span>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
