import { motion, useReducedMotion } from "framer-motion";
import { Play, Star, MapPin, TrendingUp, BadgeCheck, Navigation } from "lucide-react";
import type { HeroData } from "../store/siteContent";
import { EASE, Reveal } from "./ui/motion";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.35 } },
};
const item = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 1, ease: EASE } },
};

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
        <div className="glow absolute -top-32 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-gradient-to-r from-saffron-500/25 via-flame-500/20 to-orchid-500/25 blur-[100px] animate-pulse-soft" />
        <div className="glow absolute top-40 -left-40 h-96 w-96 rounded-full bg-orchid-500/15 blur-[100px]" />
        <div className="glow absolute top-64 -right-40 h-96 w-96 rounded-full bg-saffron-500/15 blur-[100px]" />
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

            <motion.div variants={item} className="mt-9 flex flex-wrap items-center gap-4">
              <a
                href={data.cta1Href || "#"}
                className="group relative inline-flex items-center gap-2.5 overflow-hidden rounded-full bg-gradient-to-r from-saffron-400 via-flame-500 to-orchid-500 px-7 py-4 font-display text-[15px] font-semibold text-white shadow-xl shadow-flame-500/30 transition-all duration-300 hover:shadow-[0_8px_40px_rgba(255,77,109,0.5)] hover:brightness-110 active:scale-95"
              >
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                <MapPin className="h-4.5 w-4.5" />
                {data.cta1}
              </a>
              <a
                href={data.cta2Href || "#"}
                className="group inline-flex items-center gap-3 rounded-full glass px-6 py-4 font-display text-[15px] font-semibold text-white transition-all duration-300 hover:border-white/25 hover:bg-white/[0.07] active:scale-95"
              >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 transition-all duration-300 group-hover:scale-110 group-hover:bg-gradient-to-br group-hover:from-saffron-400 group-hover:to-flame-500">
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
                    className="grid h-9 w-9 place-items-center rounded-full border-2 border-ink-950 bg-gradient-to-br text-[10px] font-bold text-white"
                    style={{
                      marginLeft: i === 0 ? 0 : -10,
                      backgroundImage: `linear-gradient(135deg, ${
                        ["#ffab5e", "#ff5d7e", "#8b5cf6", "#2dd4bf"][i]
                      }, ${["#ff5d7e", "#8b5cf6", "#2dd4bf", "#ffab5e"][i]})`,
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
                <img
                  src={data.mainImage}
                  alt="Winding mountain road through the snowcapped Himalayas of Leh, Ladakh"
                  className="aspect-[4/3.4] w-full object-cover sm:aspect-[4/3]"
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  width={1200}
                  height={627}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink-950/80 via-transparent to-ink-950/10" />
                {/* location chip */}
                <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-ink-950/60 px-3.5 py-2 text-xs font-medium text-white backdrop-blur-md">
                  <MapPin className="h-3.5 w-3.5 text-saffron-400" />
                  {data.chipLocation}
                </div>
                {/* bottom card */}
                <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-2xl bg-ink-950/55 p-3 backdrop-blur-xl">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-saffron-400 to-flame-500">
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
                <img
                  src={data.cardAImage}
                  alt={data.cardATitle}
                  className="aspect-square w-full object-cover"
                  loading="lazy"
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
                <img
                  src={data.cardBImage}
                  alt={data.cardBTitle}
                  className="aspect-square w-full object-cover"
                  loading="lazy"
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
