import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, Check, Timer, X } from "lucide-react";
import type { CountdownData } from "../store/siteContent";
import { cn } from "../utils/cn";
import { hasCountdownExpired } from "../utils/countdownTiming";
import { EASE } from "./ui/motion";
import ThemeToggle from "./ThemeToggle";

/** Shared ticking countdown used by the maintenance page and the countdown section. */
export function useCountdown(targetIso: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const target = targetIso ? new Date(targetIso).getTime() : NaN;
  const valid = Number.isFinite(target);
  const diff = valid ? Math.max(0, target - now) : 0;
  return {
    valid,
    done: valid && diff <= 0,
    totalMs: diff,
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff / 3600000) % 24),
    minutes: Math.floor((diff / 60000) % 60),
    seconds: Math.floor((diff / 1000) % 60),
    now,
  };
}

/** True once the target time has passed. Only re-renders when the value flips. */
export function useCountdownFinished(targetIso: string): boolean {
  const [status, setStatus] = useState(() => ({
    targetIso,
    finished: hasCountdownExpired(targetIso),
  }));

  // Saving a second countdown changes its target before effects run. Do not
  // expose the previous target's "finished" value during that first render.
  const finished = status.targetIso === targetIso
    ? status.finished
    : hasCountdownExpired(targetIso);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const check = () => {
      const nextFinished = hasCountdownExpired(targetIso);
      setStatus((previous) =>
        previous.targetIso === targetIso && previous.finished === nextFinished
          ? previous
          : { targetIso, finished: nextFinished }
      );
      return nextFinished;
    };

    if (check()) return;

    const deadline = Date.parse(targetIso);
    if (!Number.isFinite(deadline)) return;

    // Wake up on the deadline itself instead of polling. A once-a-second check
    // fired up to a second late, and the page kept showing a clock sitting at
    // zero in the meantime. The 25 ms is so the clock has actually passed the
    // deadline by the time we look. Long waits are capped at a minute, so the
    // same timer doubles as a safety net for a drifted or skipped wake-up.
    const schedule = () => {
      if (cancelled) return;
      const wait = Math.min(Math.max(deadline - Date.now(), 0) + 25, 60_000);
      timer = setTimeout(() => {
        if (!check()) schedule();
      }, wait);
    };
    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [targetIso]);

  return finished;
}

/* ───────────────── Day / Hour / Min / Sec tiles (used by Maintenance) ───────────────── */

export function CountdownDots({ target, size = "md" }: { target: string; size?: "sm" | "md" | "lg" }) {
  const c = useCountdown(target);
  if (!c.valid) return null;

  const units = [
    { v: c.days, l: "Days" },
    { v: c.hours, l: "Hours" },
    { v: c.minutes, l: "Mins" },
    { v: c.seconds, l: "Secs" },
  ];
  const pad = size === "lg" ? "px-4 py-4 sm:px-7 sm:py-6" : size === "sm" ? "px-2.5 py-2" : "px-3.5 py-3.5";
  const num = size === "lg" ? "text-3xl sm:text-5xl" : size === "sm" ? "text-base" : "text-xl sm:text-2xl";

  return (
    <div role="timer" aria-live="off" className="flex items-stretch gap-2 sm:gap-3">
      {units.map((u) => (
        <div
          key={u.l}
          className={cn("cd-tile min-w-0 rounded-2xl border text-center backdrop-blur-md", pad)}
        >
          <p className={cn("cd-ink font-display font-bold tabular-nums", num)}>
            {String(u.v).padStart(2, "0")}
          </p>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            {u.l}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ───────────────── Digital clock readout ───────────────── */

/** One digit that flips down when its value changes. */
function FlipDigit({ value, size }: { value: string; size: "md" | "lg" }) {
  const [display, setDisplay] = useState(value);
  const [flipping, setFlipping] = useState(false);
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    setFlipping(true);
    const t = setTimeout(() => {
      setDisplay(value);
      setFlipping(false);
    }, 160);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <span
      className={cn(
        /* .cd-tile keeps the plate readable in both themes: near-black on
           dark, a pale plate with a gold edge on light. */
        "cd-tile relative inline-grid place-items-center overflow-hidden rounded-lg border font-mono font-bold tabular-nums",
        size === "lg" ? "h-[4.6rem] w-12 text-5xl sm:h-24 sm:w-16 sm:text-7xl" : "h-12 w-8 text-2xl sm:h-14 sm:w-10 sm:text-3xl"
      )}
    >
      {/* horizontal split line for the flip-clock feel */}
      <span className="cd-split pointer-events-none absolute inset-x-0 top-1/2 h-px" aria-hidden />
      <span
        className={cn(
          "cd-digit transition-transform duration-150 ease-in will-change-transform",
          flipping ? "-translate-y-1 scale-y-75 opacity-40" : "translate-y-0 scale-y-100 opacity-100"
        )}
        style={{ transformOrigin: "50% 50%" }}
      >
        {display}
      </span>
    </span>
  );
}

function Colon({ size, on }: { size: "md" | "lg"; on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "cd-digit flex flex-col items-center justify-center gap-2 px-0.5 font-mono font-bold transition-opacity duration-200 sm:px-1",
        size === "lg" ? "text-5xl sm:text-7xl" : "text-2xl sm:text-3xl",
        on ? "opacity-100" : "opacity-25"
      )}
    >
      :
    </span>
  );
}

function fmtTarget(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Digital clock countdown — DD : HH : MM : SS as a flip-style LED readout,
 * with a blinking colon and the exact target shown underneath.
 */
export function DigitalClock({ target, size = "md" }: { target: string; size?: "md" | "lg" }) {
  const c = useCountdown(target);
  if (!c.valid) return null;

  const blink = c.seconds % 2 === 0;
  const dd = String(Math.min(c.days, 999)).padStart(c.days > 99 ? 3 : 2, "0");
  const hh = String(c.hours).padStart(2, "0");
  const mm = String(c.minutes).padStart(2, "0");
  const ss = String(c.seconds).padStart(2, "0");

  const groups: { label: string; digits: string }[] = [
    { label: "Days", digits: dd },
    { label: "Hrs", digits: hh },
    { label: "Min", digits: mm },
    { label: "Sec", digits: ss },
  ];

  return (
    <div className="inline-flex flex-col items-center">
      <div
        role="timer"
        aria-live="off"
        aria-label={`${c.days} days ${c.hours} hours ${c.minutes} minutes ${c.seconds} seconds remaining`}
        className={cn(
          "cd-panel inline-flex items-start rounded-[1.4rem] border backdrop-blur-xl",
          size === "lg" ? "gap-1 px-4 py-4 sm:gap-2 sm:px-6 sm:py-5" : "gap-0.5 px-3 py-3 sm:gap-1 sm:px-4"
        )}
      >
        {groups.map((g, gi) => (
          <div key={g.label} className="flex items-start">
            <div className="flex flex-col items-center">
              <div className="flex gap-1">
                {g.digits.split("").map((d, i) => (
                  <FlipDigit key={`${g.label}-${i}`} value={d} size={size} />
                ))}
              </div>
              <span className="mt-2 text-[9px] font-semibold uppercase tracking-[0.26em] text-zinc-500 sm:text-[10px]">
                {g.label}
              </span>
            </div>
            {gi < groups.length - 1 && (
              <div className={cn("flex", size === "lg" ? "h-[4.6rem] sm:h-24" : "h-12 sm:h-14")}>
                <Colon size={size} on={blink} />
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
        <CalendarClock className="h-3.5 w-3.5 text-saffron-300" />
        Counting down to <span className="font-medium text-zinc-300">{fmtTarget(target)}</span>
      </p>
    </div>
  );
}

/* ───────────────── In-page section ───────────────── */

/**
 * The countdown timer section. The page removes it the moment the timer
 * finishes, so visitors never see a shrunken clock at zero.
 */
export default function CountdownSection({ data }: { data: CountdownData }) {
  const c = useCountdown(data.targetDate);

  return (
    <section id="countdown" aria-labelledby="countdown-title" className="relative py-20 sm:py-28">
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-saffron-400/12 blur-[110px]"
        aria-hidden
      />
      <div className="relative mx-auto max-w-4xl px-5 sm:px-8">
        <div className="overflow-hidden rounded-[2.5rem] border border-white/10 bg-white/[0.03] p-8 text-center backdrop-blur-xl sm:p-12">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-saffron-300">
            <Timer className="h-3.5 w-3.5" />
            {data.badge}
          </span>
          <h2
            id="countdown-title"
            className="mx-auto mt-5 max-w-2xl font-display text-3xl font-semibold leading-[1.1] tracking-tight text-white sm:text-4xl text-balance"
          >
            {data.title}
          </h2>
          {data.sub && <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-zinc-400">{data.sub}</p>}

          {!data.targetDate && (
            <p className="cd-panel mt-8 rounded-2xl border px-5 py-3 text-xs text-zinc-500">
              Set a target date &amp; time in the dashboard to start the clock.
            </p>
          )}

          {c.valid && (
            <div className="mt-9 flex justify-center">
              <DigitalClock target={data.targetDate} />
            </div>
          )}

          {data.ctaLabel && (
            <a
              href={data.ctaHref || "#"}
              className="group mt-8 inline-flex items-center gap-2 rounded-full bg-saffron-400 px-7 py-4 font-display text-sm font-semibold text-on-gold shadow-xl shadow-saffron-400/30 transition-all duration-300 hover:brightness-110 active:scale-95"
            >
              {data.ctaLabel}
              <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

/* ───────────────── Full page (countdown is the only section) ───────────────── */

export function CountdownPage({ data }: { data: CountdownData }) {
  const c = useCountdown(data.targetDate);

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-ink-950 px-5 py-16">
      {/* Theme switch for everyone: this page replaces the whole site, so the
          header's toggle is not on screen to use. */}
      <ThemeToggle className="fixed right-4 top-4 z-50" />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-50 [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)]" aria-hidden />
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-96 w-[720px] -translate-x-1/2 rounded-full bg-saffron-400/20 blur-[130px]"
        aria-hidden
      />
      <div className="relative w-full max-w-4xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-saffron-300">
          <Timer className="h-3.5 w-3.5" />
          {data.badge}
        </span>
        <h1 className="mx-auto mt-6 max-w-2xl font-display text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl text-balance">
          {data.title}
        </h1>
        {data.sub && <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-zinc-400 sm:text-lg">{data.sub}</p>}

        {c.valid && (
          <div className="mt-12 flex justify-center">
            <DigitalClock target={data.targetDate} size="lg" />
          </div>
        )}

        {!data.targetDate && (
          <p className="cd-panel mx-auto mt-10 max-w-md rounded-2xl border px-5 py-3 text-xs text-zinc-500">
            Set a target date &amp; time in the dashboard to start the clock.
          </p>
        )}

        {data.ctaLabel && (
          <a
            href={data.ctaHref || "#"}
            className="group mt-10 inline-flex items-center gap-2 rounded-full bg-saffron-400 px-8 py-4 font-display text-base font-semibold text-on-gold shadow-xl shadow-saffron-400/30 transition-all duration-300 hover:brightness-110 active:scale-95"
          >
            {data.ctaLabel}
            <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
          </a>
        )}
      </div>
    </div>
  );
}

/* ───────────────── After the timer finishes ───────────────── */

/** Full page shown after a lone countdown finishes. Holds the done message. */
export function DonePage({ data }: { data: CountdownData }) {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-ink-950 px-5 py-16">
      {/* Theme switch for everyone: this page replaces the whole site, so the
          header's toggle is not on screen to use. */}
      <ThemeToggle className="fixed right-4 top-4 z-50" />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-50 [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)]" aria-hidden />
      <div className="relative w-full max-w-2xl text-center">
        <span className="mx-auto inline-grid h-14 w-14 place-items-center rounded-full border border-emerald-400/30 bg-emerald-400/10">
          <Check className="h-6 w-6 text-emerald-300" />
        </span>
        <h1 className="mx-auto mt-6 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl text-balance">
          {data.title}
        </h1>
        <p className="mx-auto mt-6 max-w-md rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-6 py-5 text-base leading-relaxed text-emerald-200">
          {data.doneMessage || "It's live now."}
        </p>
        {data.ctaLabel && (
          <a
            href={data.ctaHref || "#"}
            className="group mt-10 inline-flex items-center gap-2 rounded-full bg-saffron-400 px-8 py-4 font-display text-base font-semibold text-white shadow-xl shadow-saffron-400/30 transition-all duration-300 hover:brightness-110 active:scale-95"
          >
            {data.ctaLabel}
            <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
          </a>
        )}
      </div>
    </div>
  );
}

/** Banner shown over the page when the timer finishes alongside other sections. */
export function DoneToast({ message, onClose }: { message: string; onClose: () => void }) {
  if (!message.trim()) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[90] flex justify-center px-5">
      <motion.div
        role="status"
        aria-live="polite"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-emerald-400/30 bg-ink-950/90 p-4 shadow-2xl shadow-black/60 backdrop-blur-xl"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-400/15">
          <Check className="h-4 w-4 text-emerald-300" />
        </span>
        <p className="flex-1 text-sm leading-relaxed text-emerald-100">{message}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss message"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.07] text-zinc-400 transition-colors hover:bg-white/[0.15] hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </motion.div>
    </div>
  );
}
