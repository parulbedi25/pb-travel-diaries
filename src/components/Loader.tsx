import { useEffect, useState } from "react";
import {
  resolveLoaderAnimation,
  type LoaderAnimation,
} from "../store/siteContent";
import { cn } from "../utils/cn";

/**
 * The built-in loader mark: a single yellow line. A bright-headed segment
 * sweeps along a faint track with a halo breathing behind it — see .ldr-line
 * in index.css. `className` takes a size variant so the dashboard's animation
 * tiles can show it small.
 */
export function LineLoaderMark({ className }: { className?: string }) {
  return (
    <span className={cn("ldr-line-wrap", className)} aria-hidden>
      <span className="ldr-line" />
    </span>
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
          <LineLoaderMark />
        )}
      </span>
      {/* The built-in mark is a progress line in its own right, so the bar only
          sits under an uploaded logo — behind the line it was the same thing
          twice, one sliding above another. */}
      {logo && (
        <div className="h-[3px] w-40 overflow-hidden rounded-full bg-white/10">
          <div className="ldr-bar h-full rounded-full bg-saffron-400" />
        </div>
      )}
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
      <div className="shrink-0 aspect-square pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-saffron-500/8 blur-[110px]" />
    </>
  );
}
