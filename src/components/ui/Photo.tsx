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
 * Every photo is served from this app's own /media and /images folders, so
 * there are no cross-origin requests and no referrer rules to work around.
 */
export default function Photo({
  src,
  srcSet,
  sizes,
  alt,
  className,
  aspect,
  priority = false,
  label = "Photo unavailable",
}: {
  src: string;
  /**
   * Optional candidates at different widths, so a phone downloads the phone
   * file instead of the full-resolution one. Leave out when there is only one
   * file — the browser then simply uses `src`.
   */
  srcSet?: string;
  /** How wide the image is displayed, so the browser can pick a candidate. */
  sizes?: string;
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
  const [loaded, setLoaded] = useState(false);

  // A new URL deserves a fresh attempt.
  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

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
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      // The browser only fetches the candidate it needs, so an HD master is
      // never downloaded for a phone screen.
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      // The expected shape, held open until the bytes arrive. An <img> with no
      // dimensions is 0px tall until then, so a photo that sizes its own block
      // (the Machine photo) used to push the rest of the page down the moment
      // it loaded — mid-scroll, which is exactly when a lazy photo is fetched.
      // Once it has loaded the photo speaks for itself: a picture uploaded at a
      // different ratio keeps that ratio instead of being forced into this one.
      style={aspect && !loaded ? { aspectRatio: aspect } : undefined}
      className={cn("block w-full", className)}
    />
  );
}
