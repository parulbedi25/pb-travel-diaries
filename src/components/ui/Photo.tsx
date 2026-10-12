import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "../../utils/cn";

/**
 * An image that can never collapse the layout.
 *
 * The Machine and Journey blocks are sized by the photo's own height, so a
 * blocked, rate-limited or slow URL used to shrink the whole block to a sliver
 * — the section looked empty. This renders the <img> while it works and a
 * same-shape placeholder when it does not, so the section keeps its size and
 * still says what belongs there.
 *
 * Remote photos (Pexels) are sent without a referrer, which avoids the
 * referrer-based blocking some image CDNs apply to hotlinked requests.
 */
export default function Photo({
  src,
  alt,
  className,
  aspect,
  priority = false,
  label = "Photo unavailable",
}: {
  src: string;
  alt: string;
  className?: string;
  /**
   * Placeholder shape, only needed when the real image derives its height from
   * its own pixels. If the caller already sizes with an `aspect-*` class, leave
   * this out so the placeholder matches that exactly.
   */
  aspect?: string;
  /** Load immediately at high priority (above-the-fold images). */
  priority?: boolean;
  label?: string;
}) {
  const [failed, setFailed] = useState(false);

  // A new URL deserves a fresh attempt.
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        style={aspect ? { aspectRatio: aspect } : undefined}
        className={cn(
          "grid w-full place-items-center overflow-hidden bg-ink-900",
          aspect && "relative",
          className
        )}
      >
        <div className="flex flex-col items-center gap-2.5 px-6 text-center">
          <ImageOff className="h-7 w-7 text-saffron-400/70" />
          <p className="font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">
            {label}
          </p>
        </div>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("block w-full", className)}
    />
  );
}
