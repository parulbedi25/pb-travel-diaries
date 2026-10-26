import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, PackageOpen } from "lucide-react";
import Photo from "./ui/Photo";
import { cn } from "../utils/cn";

/**
 * The photos for one product, as a slider.
 *
 * A single photo renders exactly as it always did — no controls, no chrome.
 * Only once there are two or more do the arrows and dots appear. Slides cross
 * fade rather than slide, so nothing shifts under a thumb that is about to tap
 * the price or the buy button.
 */
export default function ProductGallery({
  images,
  alt,
  plate = false,
  label = "Product image unavailable",
}: {
  /** Main photo first, then the gallery. Empty entries are dropped. */
  images: string[];
  alt: string;
  /** Product shots sit on white; a non-product photo fills the tile instead. */
  plate?: boolean;
  label?: string;
}) {
  const shots = useMemo(
    () => (Array.isArray(images) ? images : []).map((s) => s?.trim()).filter(Boolean),
    [images],
  );
  const [index, setIndex] = useState(0);

  // A photo can be removed in the dashboard while the card is on screen, so
  // the slider must never stay parked past the end of a shorter list.
  useEffect(() => {
    setIndex((i) => (shots.length ? Math.min(i, shots.length - 1) : 0));
  }, [shots.length]);

  if (shots.length === 0) {
    return (
      <div className="grid h-full w-full place-items-center bg-white/[0.03] photo-empty-mark">
        <PackageOpen className="h-7 w-7" aria-hidden="true" />
      </div>
    );
  }

  const go = (delta: number) =>
    setIndex((i) => (i + delta + shots.length) % shots.length);

  return (
    <div className="relative h-full w-full">
      {shots.map((src, i) => (
        <div
          key={`${i}-${src}`}
          aria-hidden={i !== index}
          className={cn(
            "absolute inset-0 transition-opacity duration-500",
            i === index ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <Photo
            src={src}
            alt={i === index ? alt : ""}
            className={cn(
              "h-full w-full transition-transform duration-500 group-hover:scale-[1.035]",
              plate ? "object-contain" : "object-cover",
            )}
            label={label}
            priority={i === 0}
          />
        </div>
      ))}

      {shots.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous photo"
            className="shrink-0 aspect-square absolute left-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-ink-950/70 text-white backdrop-blur-md transition-colors hover:bg-ink-950/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron-300"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next photo"
            className="shrink-0 aspect-square absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-ink-950/70 text-white backdrop-blur-md transition-colors hover:bg-ink-950/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron-300"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5">
            {shots.map((src, i) => (
              <button
                key={`dot-${i}-${src}`}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show photo ${i + 1} of ${shots.length}`}
                aria-current={i === index}
                className={cn(
                  "h-1.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron-300",
                  i === index
                    ? "w-5 bg-saffron-400"
                    : "w-1.5 bg-white/40 hover:bg-white/70",
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
