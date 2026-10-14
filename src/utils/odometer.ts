/**
 * Odometer milestones for The Machine.
 *
 * Every rung is a cumulative reading on the bike's clock, not a per-stretch
 * goal: the first target is 100 km, and once that is crossed the bike starts
 * chasing 500 km while the reading keeps counting up from 100. The built-in
 * ladder ends at the half-lakh mark — past 50,000 km the rider files their own
 * rungs from the dashboard and those join the same ladder.
 */

export const ODOMETER_LADDER = [
  100, 500, 2_000, 5_000, 10_000, 15_000, 20_000, 30_000, 40_000, 50_000,
] as const;

export type MilestoneState = "cleared" | "active" | "upcoming";

export interface OdometerMilestone {
  /** The rung itself, in km. */
  value: number;
  state: MilestoneState;
  /** Km ridden inside this rung's own stretch. */
  travelled: number;
  /** Length of this rung's stretch — from the previous rung (or 0). */
  stretch: number;
  /** Km still to ride inside this stretch. */
  remaining: number;
  /** Progress inside this stretch, 0–100. */
  pct: number;
}

export interface OdometerProgress {
  /** The bike's total reading, in km. */
  reading: number;
  /** The last rung already crossed — 0 before the first one. */
  from: number;
  /** The rung being chased. Equals the final rung once the ladder is done. */
  target: number;
  /** Km ridden inside the current stretch (from → target). */
  travelled: number;
  /** Length of the current stretch, in km. */
  stretch: number;
  /** Km left before the next rung. */
  remaining: number;
  /** Progress inside the current stretch, 0–100. */
  pct: number;
  /** Progress across the whole ladder, 0–100. */
  overallPct: number;
  /** Every rung in ascending order, tagged with its state. */
  ladder: OdometerMilestone[];
  /** How many rungs are already behind the bike. */
  cleared: number;
  /** True once the reading has passed the final rung. */
  complete: boolean;
}

/** Drops junk and duplicates, then sorts ascending. */
function cleanRungs(values: readonly unknown[]): number[] {
  const out = new Set<number>();
  for (const value of values) {
    const n = Math.round(Number(value));
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Works out where the bike sits on the ladder. The target follows the reading,
 * so crossing a rung promotes the bike to the next one on its own.
 */
export function resolveOdometer(reading: unknown, extraMilestones?: unknown): OdometerProgress {
  const km = Math.max(0, Math.round(Number(reading) || 0));
  const rungs = cleanRungs([
    ...ODOMETER_LADDER,
    ...(Array.isArray(extraMilestones) ? extraMilestones : []),
  ]);
  const final = rungs[rungs.length - 1] ?? 0;
  const clearedRungs = rungs.filter((value) => value <= km);
  const from = clearedRungs.length ? clearedRungs[clearedRungs.length - 1] : 0;
  const target = rungs.find((value) => value > km) ?? final;
  const complete = km >= final;
  const stretch = Math.max(0, target - from);
  const travelled = Math.min(stretch, Math.max(0, km - from));
  const pct = complete ? 100 : stretch > 0 ? Math.round((travelled / stretch) * 100) : 0;

  return {
    reading: km,
    from,
    target,
    travelled,
    stretch,
    remaining: Math.max(0, target - km),
    pct: Math.min(100, Math.max(0, pct)),
    overallPct: final > 0 ? Math.min(100, Math.round((km / final) * 100)) : 0,
    // Per-rung detail, so the dashboard can list every milestone with how much
    // of that stretch the bike has already covered.
    ladder: rungs.map((value, i) => {
      const start = i === 0 ? 0 : rungs[i - 1];
      const span = Math.max(0, value - start);
      const done = Math.min(span, Math.max(0, km - start));
      return {
        value,
        state: value <= km ? "cleared" : value === target ? "active" : "upcoming",
        travelled: done,
        stretch: span,
        remaining: Math.max(0, span - done),
        pct: span > 0 ? Math.min(100, Math.round((done / span) * 100)) : value <= km ? 100 : 0,
      };
    }),
    cleared: clearedRungs.length,
    complete,
  };
}

/** Compact ladder label: 100 · 500 · 2k · 15k · 50k. */
export function formatMilestone(value: number): string {
  if (value >= 1000) {
    const k = value / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return String(value);
}
