/**
 * Colours for the interactive pointers on the rider map (The Gear) and the
 * bike photo (The Machine). Both sections read the same two fields:
 *
 *  - `color`      the pointer itself — dot, border and icon
 *  - `pulseColor` the pulsing ring / wave around it (falls back to `color`)
 *
 * Anything empty falls back to the site gold, so existing pointers keep their
 * look until a colour is picked in the dashboard.
 */

export const DEFAULT_POINTER_COLOR = "#f5b301";

/** Accepts `abc`, `#abc` or `#aabbcc` and returns a lower-case `#rrggbb`. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    const [r, g, b] = raw.split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
  return null;
}

/** Turns a hex colour into `rgba()` at the given alpha (0–1). */
export function withAlpha(hex: string, alpha: number): string {
  const clean = normalizeHex(hex) ?? DEFAULT_POINTER_COLOR;
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Resolves one pointer's two colours, filling in the defaults. */
export function pointerColors(color?: unknown, pulseColor?: unknown): { dot: string; pulse: string } {
  const dot = normalizeHex(color) ?? DEFAULT_POINTER_COLOR;
  return { dot, pulse: normalizeHex(pulseColor) ?? dot };
}

/**
 * Staggers a pointer's pulse by how far across the image it sits, so the
 * pointers ripple from left to right like a wave instead of blinking together.
 * `sweep` is how long the wave takes to travel the full width, in seconds.
 */
export function waveDelay(x: unknown, sweep = 1.1): number {
  const raw = typeof x === "number" ? x : Number(x);
  const pct = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0;
  return Number(((pct / 100) * sweep).toFixed(3));
}
