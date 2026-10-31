import { Compass, Minus, Plus } from "lucide-react";
import { cn } from "../utils/cn";

/**
 * The buttons on a map: zoom in, zoom out, and back to where the page put you.
 *
 * They exist because not every visitor has — or wants — a trackpad gesture: a
 * phone held in the sun, a keyboard, a browser whose pinch is taken by the
 * page. Each button is a real `<button>` with a name, a 36-pixel target and a
 * visible focus ring, so the map can be moved without a gesture at all.
 *
 * The map underneath listens for drags, but never for a press that starts on
 * one of these: `data-map-no-pan` is what tells it the difference.
 */
export default function MapControls({
  onZoomIn,
  onZoomOut,
  onReset,
  moved,
  resetLabel = "Back to the whole view",
  className,
  compact = false,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  /** Lit when the map is somewhere other than where the page put it. */
  moved: boolean;
  resetLabel?: string;
  /** Where the group sits. Position comes from the caller. */
  className?: string;
  /** Smaller buttons, for a map with less room to give. */
  compact?: boolean;
}) {
  const size = compact ? "h-8 w-8" : "h-9 w-9";
  const button = cn(
    size,
    "grid touch-auto place-items-center text-zinc-200 transition-colors hover:bg-white/[0.10] hover:text-white active:bg-white/[0.16] focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron-300",
  );

  return (
    <div
      data-map-no-pan
      className={cn(
        "absolute z-30 overflow-hidden rounded-xl border border-white/12 bg-ink-950/85 shadow-lg shadow-black/40 backdrop-blur-md",
        className,
      )}
    >
      <div className="flex flex-col divide-y divide-white/10">
        <button type="button" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in" className={button}>
          <Plus className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
        </button>
        <button type="button" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out" className={button}>
          <Minus className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onReset}
          aria-label={resetLabel}
          title={resetLabel}
          className={cn(button, moved ? "text-saffron-300" : "text-zinc-500")}
        >
          <Compass className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
