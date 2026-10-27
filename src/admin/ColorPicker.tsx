import { useEffect, useMemo, useState } from "react";
import { cn } from "../utils/cn";
import { normalizeHex } from "../utils/pointerColors";

/**
 * The dashboard's colour picker: the swatch chart, as a real grid of cells.
 *
 * Layout matches the reference chart — a strip of greys along the top, then a
 * 12 × 8 field where the columns run blue → purple → magenta → red → orange →
 * yellow → green, the top rows are dark, the middle rows are vivid and the
 * bottom rows are pastel. Every cell is a discrete colour you click; there is
 * no canvas, no drag and nothing to aim at.
 *
 * The cells have rounded corners and a hairline gap rather than hard, aliased
 * edges, which is what keeps the chart soft against the dashboard's dark
 * panels. The selected cell is outlined in white, like the reference.
 *
 * One component, used everywhere a colour is chosen: the Machine and Gear
 * pointers, the brand mark, the theme tokens and the footer social icons.
 */

/* ── the chart ──────────────────────────────────────────────────────────── */

const COLS = 12;
const ROWS = 8;

// Blue at the left edge, green at the right, sweeping *up* through the wrap
// (240° → 480°) so the middle of the chart carries the magentas, reds and
// oranges. A sweep that stopped at green would have no warm colours at all.
const HUE_FROM = 240;
const HUE_TO = 480;
const SATURATION = 0.92;

/** Darkening toward the top of the chart. */
const DARK: [number, number][] = [
  [0, 0.9],
  [0.18, 0.55],
  [0.34, 0.2],
  [0.45, 0],
];

/** Whitening toward the bottom, which is what makes the pastel rows. */
const LIGHT: [number, number][] = [
  [0.5, 0],
  [0.66, 0.3],
  [0.84, 0.62],
  [1, 0.92],
];

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

/** Linear interpolation across a stop table, held flat beyond the ends. */
function sampleStops(stops: [number, number][], t: number): number {
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

/** One cell's colour: hue by column, dark→vivid→pastel by row. */
function cellHex(col: number, row: number): string {
  const hue = HUE_FROM + (HUE_TO - HUE_FROM) * (col / (COLS - 1));
  const t = row / (ROWS - 1);
  const base = hslToRgb(hue, SATURATION, 0.5);
  const dark = sampleStops(DARK, t);
  const light = sampleStops(LIGHT, t);
  return rgbToHex(base.map((c) => c * (1 - dark) * (1 - light) + 255 * light));
}

/** The grid, computed once. `[row][col]`. */
const CHART: string[][] = Array.from({ length: ROWS }, (_, row) =>
  Array.from({ length: COLS }, (_, col) => cellHex(col, row))
);

/** The greys across the top, white to black, as in the reference. */
const GREYS: string[] = Array.from({ length: COLS }, (_, i) => {
  const level = Math.round(255 * (1 - i / (COLS - 1)));
  return rgbToHex([level, level, level]);
});

/**
 * Which swatch is under the current colour.
 *
 * A dashboard colour is often something the chart cannot hit exactly — the site
 * gold, or a hex typed by hand — so the nearest cell is marked rather than
 * nothing at all. Clicking any cell still commits that cell's exact colour.
 */
function nearestCell(hex: string): string {
  const clean = normalizeHex(hex);
  if (!clean) return "";
  const target = [1, 3, 5].map((i) => parseInt(clean.slice(i, i + 2), 16));
  let best = "";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of [...GREYS, ...CHART.flat()]) {
    const rgb = [1, 3, 5].map((i) => parseInt(candidate.slice(i, i + 2), 16));
    // Weighted the way the eye notices a difference: green most, blue least.
    const distance =
      2 * (rgb[0] - target[0]) ** 2 + 4 * (rgb[1] - target[1]) ** 2 + 3 * (rgb[2] - target[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
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
  const marked = useMemo(() => (selected ? nearestCell(selected) : ""), [selected]);
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);

  const commit = (raw: string) => {
    setHex(raw);
    const next = normalizeHex(raw);
    if (next) onChange(next);
    else if (raw.trim() === "") onChange("");
  };

  // Square, rounded cells with a hairline gap. `aspect-square` keeps them
  // square at any panel width, so the chart never skews or wraps.
  const cell = cn(
    "relative grid aspect-square w-full place-items-center transition-[transform,box-shadow] duration-150",
    size === "sm" ? "rounded-[2px]" : "rounded-[3px]"
  );
  /** The reference marks the chosen swatch with a white box around it. */
  const ringOn = "z-10 outline-2 outline-white outline-offset-1";
  const gap = size === "sm" ? "gap-[2px]" : "gap-[3px]";

  return (
    <div className={cn("min-w-0", className)}>
      {/* ── greys ── */}
      <div
        role="group"
        aria-label={`${label} greys`}
        className={cn("grid", gap)}
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
      >
        {GREYS.map((grey) => {
          const isOn = marked === grey;
          return (
            <button
              key={grey}
              type="button"
              onClick={() => commit(grey)}
              aria-pressed={isOn}
              aria-label={`${label}: ${grey}`}
              title={grey.toUpperCase()}
              style={{ background: grey }}
              className={cn(cell, "border border-white/15", isOn ? ringOn : "hover:scale-110 hover:border-white/50")}
            />
          );
        })}
      </div>

      {/* ── the colour field ── */}
      <div
        role="group"
        aria-label={`${label} colours`}
        className={cn("mt-1 grid", gap)}
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
      >
        {CHART.map((row, rowIndex) =>
          row.map((colour, colIndex) => {
            const isOn = marked === colour;
            return (
              <button
                key={`${rowIndex}-${colIndex}`}
                type="button"
                onClick={() => commit(colour)}
                aria-pressed={isOn}
                aria-label={`${label}: ${colour}`}
                title={colour.toUpperCase()}
                style={{ background: colour }}
                className={cn(
                  cell,
                  "border border-black/10",
                  isOn ? ringOn : "hover:z-10 hover:scale-110 hover:border-white/50"
                )}
              />
            );
          })
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn("shrink-0 border border-white/20", size === "sm" ? "h-5 w-5 rounded" : "h-6 w-6 rounded-md")}
          style={{ background: selected ?? "transparent" }}
        />
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
