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
 * Where the rider is from — and who is already travelling along.
 *
 * One plate, two rows, because they are the same statement: this is the place
 * the road starts from, and this is how many people are on it. The coordinates
 * used to be a one-line chip with the tribe and rating row sitting separately
 * under the buttons; two thin strips of information with a gap between them
 * read as clutter, and both left empty space on the right.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ ⊙•  31.3832° N   76.3766° E     NANGAL DAM · PUNJAB · …  │
 *   │ ────────────────────────────────────────────────────────  │
 *   │ (AM)(RK)(IS)(KB)  4.9 from 6,200+ travelers  |  480K+ …  │
 *   └──────────────────────────────────────────────────────────┘
 *
 * There is no slash or rule between the two coordinates: `° N` and `° E`
 * already separate them, and a plain gap reads cleaner than punctuation. The
 * place and its note take the right-hand half of the first row, the rating and
 * the tribe the whole of the second — so nothing is left hanging in empty space.
 *
 * Every value comes from the hero's own fields, so an owner who moves the pin
 * changes four values in the dashboard rather than hunting for a literal.
 */
function OriginPlate({ data }: { data: HeroData }) {
  const origin = resolveOrigin(data);
  const [ratingLead, ...ratingRest] = data.ratingText.split(" ");
  const [tribeLead, ...tribeRest] = data.tribeText.split(" ");

  return (
    <figure
      className="group relative mt-7 w-full max-w-xl overflow-hidden rounded-2xl border border-white/12 bg-white/[0.03] backdrop-blur-sm transition-colors duration-300 hover:border-saffron-400/40 hover:bg-saffron-400/[0.05] lg:max-w-2xl"
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
        className="shrink-0 aspect-square pointer-events-none absolute -left-8 top-1/3 h-28 w-28 -translate-y-1/2 rounded-full bg-saffron-400/10 opacity-70 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
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

      {/* ── row one: the point on the map ── */}
      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-5">
        {/* the pin, with a slow ping so the plate feels like a live reading */}
        <span className="relative grid aspect-square h-9 w-9 shrink-0 place-items-center rounded-full border border-saffron-400/30 bg-saffron-400/10 text-saffron-300">
          <Crosshair className="h-4 w-4" aria-hidden />
          <span className="absolute -right-1 -top-1 flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-saffron-400 opacity-60" />
            <span className="shrink-0 aspect-square relative inline-flex h-2 w-2 rounded-full bg-saffron-400" />
          </span>
        </span>

        {/* The two readings, separated by nothing but space: ° N and ° E say
            which is which, and the gap is wider than the space inside a value
            so they read as two figures rather than one long number. */}
        <figcaption className="flex shrink-0 items-center gap-5 whitespace-nowrap font-mono text-[12px] tracking-[0.08em]">
          <span className="text-zinc-100">{origin.lat}</span>
          <span className="text-zinc-300">{origin.lng}</span>
        </figcaption>

        {/* place and note fill the rest of the row, on the same baseline */}
        <div className="flex min-w-0 flex-1 items-baseline gap-x-2">
          <p className="shrink-0 text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-300">
            {origin.place}
          </p>
          {origin.note && (
            <p className="min-w-0 truncate text-[9.5px] text-zinc-500">
              <span aria-hidden className="shrink-0 aspect-square mr-2 inline-block h-1 w-1 rounded-full bg-saffron-400/70 align-middle" />
              {origin.note}
            </p>
          )}
        </div>
      </div>

      {/* ── row two: who is already on the road ── */}
      <div className="relative flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.08] px-4 py-2.5 sm:px-5">
        <div className="flex shrink-0 items-center">
          {["AM", "RK", "IS", "KB"].map((n, i) => (
            <span
              key={n}
              className="shrink-0 aspect-square grid h-7 w-7 place-items-center rounded-full border-2 border-ink-950 bg-saffron-400 text-[9px] font-bold text-on-gold transition-transform duration-300 hover:scale-110"
              style={{ marginLeft: i === 0 ? 0 : -9, zIndex: 4 - i }}
            >
              {n}
            </span>
          ))}
        </div>

        <p className="text-[11px] text-zinc-400">
          <span className="font-semibold text-white">{ratingLead}</span>{" "}
          <span className="uppercase tracking-[0.1em]">{ratingRest.join(" ")}</span>
        </p>

        <span aria-hidden className="h-4 w-px bg-white/12" />

        <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
          <span>
            <span className="font-semibold text-white">{tribeLead}</span>{" "}
            <span className="uppercase tracking-[0.1em]">{tribeRest.join(" ")}</span>
          </span>
        </p>
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
        <div className="glow absolute -top-24 left-1/2 h-[300px] w-[min(100%,520px)] -translate-x-1/2 rounded-full bg-saffron-400/10 blur-[70px] animate-pulse-soft sm:-top-32 sm:h-[480px] sm:w-[820px] sm:blur-[100px]" />
        <div className="shrink-0 aspect-square glow absolute top-40 -left-40 h-72 w-72 rounded-full bg-saffron-400/8 blur-[80px] sm:h-96 sm:w-96 sm:blur-[100px]" />
        <div className="shrink-0 aspect-square glow absolute top-64 -right-40 h-72 w-72 rounded-full bg-saffron-500/8 blur-[80px] sm:h-96 sm:w-96 sm:blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        {/* The gap on lg is wider than it looks: the photo's floating cards
            hang off its left edge, and that overhang has to stay inside the
            gap. At 48px the widest one (32px) keeps 16px of clear air from the
            copy column, so a tile can never sit on top of the text. */}
        <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-x-12 lg:gap-y-10">
          {/* ---------- Copy ---------- */}
          <motion.div variants={container} initial="hidden" animate="show" className="min-w-0 max-w-2xl">
            <motion.div variants={item}>
              <a
                href="#/live-map"
                className="group inline-flex items-center gap-2.5 rounded-full glass px-4 py-2 text-xs font-medium text-zinc-300 transition-all duration-300 hover:border-emerald-400/40 hover:bg-emerald-400/[0.07] hover:text-white"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="shrink-0 aspect-square relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
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
                <span className="shrink-0 aspect-square grid h-8 w-8 place-items-center rounded-full bg-white/10 transition-all duration-300 group-hover:scale-110 group-hover:bg-saffron-400">
                  <Play className="h-3.5 w-3.5 fill-current" />
                </span>
                {data.cta2}
              </a>
            </motion.div>

            <motion.div variants={item}>
              <OriginPlate data={data} />
            </motion.div>
          </motion.div>

          {/* ---------- Visual ---------- */}
          <div className="relative mx-auto min-w-0 w-full max-w-[560px] lg:max-w-none">
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
                <div className="absolute left-4 top-4 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-full bg-ink-950/60 px-3.5 py-2 text-xs font-medium text-white backdrop-blur-md">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-saffron-400" />
                  <span className="truncate">{data.chipLocation}</span>
                </div>
                {/* bottom card */}
                <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-2xl bg-ink-950/55 p-3 backdrop-blur-xl">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-saffron-400">
                    <Play className="h-4 w-4 fill-white text-white" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{data.epTitle}</p>
                    <p className="truncate text-xs text-zinc-400">{data.epMeta}</p>
                  </div>
                  <span className="ml-auto hidden shrink-0 items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[10px] font-semibold text-emerald-300 sm:flex">
                    <BadgeCheck className="h-3 w-3" /> New
                  </span>
                </div>
              </div>

              {/* floating card A — top-left, over the photo's edge.
                  It overhangs by 32px at most, which is inside the column gap,
                  and stops well above the episode card below it. */}
              <motion.div
                {...float(0.4, 12)}
                className="absolute -left-4 top-14 hidden w-40 overflow-hidden rounded-2xl border border-white/15 shadow-2xl shadow-black/50 sm:block lg:-left-8"
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
                className="absolute -right-3 bottom-24 hidden w-36 overflow-hidden rounded-2xl border border-white/15 shadow-2xl shadow-black/50 sm:block sm:w-40 lg:-right-6"
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

            </motion.div>
            {/*
              Stat chip. Floating it on the photo's bottom-left put it straight
              through the episode card, which sits in the same corner. Below
              `xl` there is not enough photo height for both, so it is a normal
              card under the photo — outside the wrapper the tiles are
              positioned against, so it cannot move them. From `xl` the photo is
              tall enough and it floats in the clear band above that card.
            */}
            <motion.div
              {...float(0.8, 10)}
              className="mt-4 flex items-center gap-3 rounded-2xl glass px-4 py-3 shadow-xl shadow-black/40 xl:absolute xl:-left-8 xl:bottom-24 xl:mt-0"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-400/15 text-emerald-300">
                <TrendingUp className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0">
                <p className="font-display text-sm font-bold text-white">{data.statTop}</p>
                <p className="text-[11px] text-zinc-400">{data.statSub}</p>
              </div>
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
