import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "../utils/cn";
import { normalizeHex } from "../utils/pointerColors";

/**
 * The dashboard's colour picker: a colour chart, not a row of boxes.
 *
 * The reference is the classic palette chart — a strip of greys along the top
 * and a hue × lightness field underneath — but drawn as continuous gradients
 * rather than a matrix of hard-edged squares, so the colours melt into one
 * another with no visible seams. The little square under the cursor is the
 * selection ring, and it can be dragged anywhere in the field.
 *
 * Nothing is drawn per-pixel and there is no canvas: the field is three stacked
 * CSS gradients, and `chartHex()` below is the same maths in JavaScript, so the
 * colour reported when you click is the colour you can see under the cursor.
 * Row/column structure is suggested with a faint grid so the chart still reads
 * as a chart rather than a blur.
 *
 * Used everywhere a colour is chosen: the Machine and Gear pointers, the brand
 * mark, the theme tokens and the footer social icons.
 */

/* ── the field ──────────────────────────────────────────────────────────── */

// The reference chart runs blue → purple → magenta → red → orange → yellow →
// green from left to right, which is 240° swept *up* through the wrap (240 →
// 480). A sweep that stopped at green would have no reds or oranges at all.
const HUE_FROM = 240; // blue at the left edge
const HUE_TO = 480; // = 120°, green, at the right edge
const HUE_STOPS = 73; // dense enough that the hue band has no visible steps
const SATURATION = 0.94;

/** Darkening toward the top of the field. */
const DARK: [number, number][] = [
  [0, 0.93],
  [0.13, 0.63],
  [0.28, 0.26],
  [0.4, 0],
];

/** Whitening toward the bottom, which is what makes the pastel rows. */
const LIGHT: [number, number][] = [
  [0.46, 0],
  [0.64, 0.3],
  [0.82, 0.63],
  [1, 0.93],
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((((h % 360) + 360) % 360) / 60);
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

function rgbToHex(rgb: number[]): string {
  return (
    "#" +
    rgb
      .map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** The hue row, sampled once — both the CSS gradient and the picker read it. */
const HUE_ROW: [number, number, number][] = Array.from({ length: HUE_STOPS }, (_, i) => {
  const t = i / (HUE_STOPS - 1);
  return hslToRgb(HUE_FROM + (HUE_TO - HUE_FROM) * t, SATURATION, 0.5);
});

/** Linear interpolation across a stop table, held flat beyond the ends — exactly
    what a CSS gradient does. */
function sampleStops<T extends [number, number]>(stops: T[], t: number): number {
  if (t <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i += 1) {
    const [aAt, aValue] = stops[i - 1];
    const [bAt, bValue] = stops[i];
    if (t <= bAt) {
      const span = bAt - aAt || 1;
      return aValue + ((t - aAt) / span) * (bValue - aValue);
    }
  }
  return last[1];
}

function hueAt(x: number): [number, number, number] {
  const t = clamp01(x) * (HUE_STOPS - 1);
  const i = Math.min(HUE_STOPS - 1, Math.floor(t));
  const j = Math.min(HUE_STOPS - 1, i + 1);
  const f = t - i;
  const a = HUE_ROW[i];
  const b = HUE_ROW[j];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** The colour at a point in the field, 0–1 on each axis. Mirrors the CSS below. */
function chartHex(x: number, y: number): string {
  const base = hueAt(x);
  const dark = sampleStops(DARK, clamp01(y));
  const light = sampleStops(LIGHT, clamp01(y));
  return rgbToHex(base.map((c) => c * (1 - dark) * (1 - light) + 255 * light));
}

/* ── the stylesheet, built from the same numbers ────────────────────────── */

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

const HUE_GRADIENT = `linear-gradient(90deg, ${HUE_ROW.map(
  (rgb, i) => `${rgbToHex(rgb)} ${pct(i / (HUE_STOPS - 1))}`
).join(", ")})`;
const DARK_GRADIENT = `linear-gradient(180deg, ${DARK.map(
  ([at, a]) => `rgba(0, 0, 0, ${a}) ${pct(at)}`
).join(", ")})`;
const LIGHT_GRADIENT = `linear-gradient(180deg, ${LIGHT.map(
  ([at, a]) => `rgba(255, 255, 255, ${a}) ${pct(at)}`
).join(", ")})`;

/** The faint cell grid that keeps it reading as a chart. */
const CELL_GRID =
  "linear-gradient(90deg, rgba(0,0,0,0.09) 1px, transparent 1px), linear-gradient(180deg, rgba(0,0,0,0.09) 1px, transparent 1px)";
const CELL_SIZE = "8.333% 12.5%";

/* ── greys along the top, as in the reference ───────────────────────────── */

const GREYS = ["#ffffff", "#e8e8e8", "#d1d1d1", "#bababa", "#a3a3a3", "#8c8c8c", "#737373", "#5a5a5a", "#414141", "#282828", "#0a0a0a"];

type Point = { x: number; y: number };

/**
 * Where the selection ring belongs for a given colour: the closest point in a
 * sampled copy of the field. Sampling is cheap and only happens when the value
 * changes, so an exact inverse is not worth the extra code.
 */
function pointForHex(hex: string): Point | null {
  const clean = normalizeHex(hex);
  if (!clean) return null;
  const target = [1, 3, 5].map((i) => parseInt(clean.slice(i, i + 2), 16));
  let best: Point | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const stepsX = 60;
  const stepsY = 40;
  for (let xi = 0; xi <= stepsX; xi += 1) {
    for (let yi = 0; yi <= stepsY; yi += 1) {
      const x = xi / stepsX;
      const y = yi / stepsY;
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(chartHex(x, y).slice(i, i + 2), 16));
      // Weighted so a mismatch in green counts for more than in blue, the way
      // the eye notices it.
      const distance = 2 * (r - target[0]) ** 2 + 4 * (g - target[1]) ** 2 + 3 * (b - target[2]) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x, y };
      }
    }
  }
  return best;
}

export default function ColorPicker({
  label,
  value,
  onChange,
  /** The colour an empty value falls back to, offered as a "Default" chip. */
  fallback,
  fallbackLabel = "Default",
  size = "md",
  className,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  /** Set when an empty value is meaningful (e.g. pointers fall back to gold). */
  fallback?: string;
  fallbackLabel?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const selected = normalizeHex(value);
  const [hex, setHex] = useState(value);
  const [dragging, setDragging] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => setHex(value), [value]);
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const point = useMemo(() => (selected ? pointForHex(selected) : null), [selected]);

  const commit = (raw: string) => {
    setHex(raw);
    const next = normalizeHex(raw);
    if (next) onChange(next);
    else if (raw.trim() === "") onChange("");
  };

  /** Turn a pointer position into a colour and commit it, at most once a frame. */
  const pickAt = (clientX: number, clientY: number) => {
    const box = fieldRef.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return;
    const x = clamp01((clientX - box.left) / box.width);
    const y = clamp01((clientY - box.top) / box.height);
    const next = chartHex(x, y);
    setHex(next);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      onChange(next);
    });
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    pickAt(event.clientX, event.clientY);
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    pickAt(event.clientX, event.clientY);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
  };

  /** Arrow keys walk the field, so it can be used without a mouse. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const start = point ?? { x: 0.5, y: 0.5 };
    let { x, y } = start;
    if (event.key === "ArrowLeft") x -= step;
    else if (event.key === "ArrowRight") x += step;
    else if (event.key === "ArrowUp") y -= step;
    else if (event.key === "ArrowDown") y += step;
    else return;
    event.preventDefault();
    commit(chartHex(clamp01(x), clamp01(y)));
  };

  return (
    <div className={cn("min-w-0", className)}>
      {/* greys, exactly as in the reference chart */}
      <div
        role="group"
        aria-label={`${label} greys`}
        className="grid grid-cols-11 gap-[3px]"
      >
        {GREYS.map((grey) => {
          const isOn = selected === grey;
          return (
            <button
              key={grey}
              type="button"
              onClick={() => commit(grey)}
              aria-pressed={isOn}
              aria-label={`${label}: ${grey}`}
              title={grey.toUpperCase()}
              style={{ background: grey }}
              className={cn(
                "grid aspect-square w-full place-items-center rounded-[4px] border border-white/20 transition-transform",
                isOn ? "ring-2 ring-saffron-300 ring-offset-1 ring-offset-ink-950" : "hover:scale-105"
              )}
            >
              {isOn && (
                <Check
                  className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"}
                  style={{ color: parseInt(grey.slice(1, 3), 16) > 140 ? "#171513" : "#ffffff" }}
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* the colour field */}
      <div
        ref={fieldRef}
        tabIndex={0}
        role="group"
        aria-label={`${label}: colour field — click or drag to pick, arrow keys to nudge`}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        style={{
          backgroundImage: `${CELL_GRID}, ${LIGHT_GRADIENT}, ${DARK_GRADIENT}, ${HUE_GRADIENT}`,
          backgroundSize: `${CELL_SIZE}, auto, auto, auto`,
          backgroundRepeat: "repeat, no-repeat, no-repeat, no-repeat",
          touchAction: "none",
        }}
        className={cn(
          // Soft, rounded edges rather than a hard printed matrix — the colour
          // stops themselves are continuous, so there is nothing to seam.
          "relative mt-2 w-full cursor-crosshair select-none overflow-hidden rounded-[6px] border border-white/15 shadow-inner outline-none",
          "focus-visible:ring-2 focus-visible:ring-saffron-300/70",
          size === "sm" ? "aspect-[16/9] max-h-24" : "aspect-[3/2] max-h-36"
        )}
      >
        {point && (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-[3px] border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)] transition-[width,height] duration-150",
              dragging && "scale-110"
            )}
            style={{
              left: `${point.x * 100}%`,
              top: `${point.y * 100}%`,
              width: size === "sm" ? 10 : 13,
              height: size === "sm" ? 10 : 13,
              background: selected ?? "transparent",
            }}
          />
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={hex}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => {
            // Anything unreadable is put back rather than silently kept.
            if (hex.trim() && !normalizeHex(hex)) setHex(value);
          }}
          placeholder={fallback ? "Default" : "#f5b301"}
          maxLength={7}
          spellCheck={false}
          aria-label={`${label} hex`}
          aria-invalid={Boolean(hex.trim()) && !normalizeHex(hex)}
          className={cn(
            "min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.05] font-mono text-white placeholder:text-zinc-500 transition-colors focus:border-saffron-400/60 focus:outline-none",
            size === "sm" ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs",
            hex.trim() && !normalizeHex(hex) && "border-rose-400/60"
          )}
        />
        {fallback ? (
          <button
            type="button"
            onClick={() => commit("")}
            aria-pressed={selected === null}
            title={fallbackLabel}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 font-semibold transition-colors",
              size === "sm" ? "text-[10px]" : "text-[11px]",
              selected === null
                ? "border-saffron-300/70 bg-saffron-400/10 text-white"
                : "border-white/15 bg-white/[0.04] text-zinc-400 hover:border-white/35 hover:text-white"
            )}
          >
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 rounded border border-white/25"
              style={{
                background: `repeating-linear-gradient(135deg, rgba(255,255,255,0.16) 0 3px, transparent 3px 6px), ${fallback}`,
              }}
            />
            {fallbackLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
