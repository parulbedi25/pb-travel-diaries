import { useEffect, useState } from "react";
import {
  resolveLoaderAnimation,
  type LoaderAnimation,
} from "../store/siteContent";
import { cn } from "../utils/cn";

/** Animated "riding through the mountains" default loader mark. */
export function BikeLoaderMark() {
  return (
    <svg viewBox="0 0 200 90" className="h-16 w-auto" aria-hidden>
      <defs>
        <linearGradient id="ldr-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f5b301" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#f5b301" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* sun */}
      <circle cx="150" cy="26" r="8" fill="#f5b301" opacity="0.75" />

      {/* mountains */}
      <path d="M0 78 L34 40 L58 66 L82 34 L112 70 L138 48 L166 76 L200 56 L200 90 L0 90 Z" fill="#2a2c33" />
      <path d="M0 84 L44 58 L74 80 L104 60 L134 84 L200 72 L200 90 L0 90 Z" fill="#1d1f25" />
      <rect x="0" y="72" width="200" height="18" fill="url(#ldr-sky)" />

      {/* road */}
      <line x1="0" y1="82" x2="200" y2="82" stroke="#3a3d45" strokeWidth="1.5" />

      {/* rider — scrolls right to left */}
      <g className="ldr-ride">
        <g transform="scale(0.42) translate(150 60)">
          <circle cx="24" cy="46" r="13" fill="none" stroke="#c3cad6" strokeWidth="3.5" />
          <circle cx="76" cy="46" r="13" fill="none" stroke="#c3cad6" strokeWidth="3.5" />
          <path d="M24 46 L42 46 L52 30 L66 30" fill="none" stroke="#c3cad6" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M42 46 L60 46 L66 30" fill="none" stroke="#c3cad6" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M58 26 L70 26" stroke="#c3cad6" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="57" cy="17" r="6" fill="#f5b301" />
        </g>
      </g>
    </svg>
  );
}

/**
 * The moving part of the loader: the logo (or the built-in mark) plus the
 * progress bar and wordmark. Shared by the real loader and the dashboard
 * preview, so what you pick in the dashboard is exactly what ships.
 */
export function LoaderStage({
  logo,
  animation,
}: {
  logo?: string;
  animation?: LoaderAnimation | string;
}) {
  const anim = resolveLoaderAnimation(animation);

  return (
    <div className="relative flex flex-col items-center gap-5">
      <span className={cn("grid place-items-center", anim !== "none" && `ldr-anim-${anim}`)}>
        {logo ? (
          <img src={logo} alt="" className="h-20 w-auto max-w-[70vw] object-contain" />
        ) : (
          <BikeLoaderMark />
        )}
      </span>
      <div className="h-[3px] w-40 overflow-hidden rounded-full bg-white/10">
        <div className="ldr-bar h-full rounded-full bg-saffron-400" />
      </div>
      <p className="font-mono text-[11px] tracking-[0.28em] text-zinc-500">PB FROM PB</p>
    </div>
  );
}

export default function Loader({
  logo,
  animation,
}: {
  logo?: string;
  animation?: LoaderAnimation | string;
}) {
  const [fade, setFade] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setFade(true), 420);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading PB from PB"
      className={`fixed inset-0 z-[200] grid place-items-center bg-ink-950 transition-opacity duration-500 ${
        fade ? "opacity-0" : "opacity-100"
      }`}
    >
      <LoaderBackdrop />
      <LoaderStage logo={logo} animation={animation} />
    </div>
  );
}

/** The grid + gold wash behind the loader mark. */
export function LoaderBackdrop() {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-saffron-500/15 blur-[110px]" />
    </>
  );
}
