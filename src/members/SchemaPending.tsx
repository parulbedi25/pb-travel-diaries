/**
 * What a member sees while the database catches up with the code.
 *
 * The site never stops for a schema upgrade: tables and columns are added while
 * the old code keeps serving, and the new code only starts using them once they
 * exist. The one seam a member can meet is the minute between the new code
 * being deployed and `npm run db:migrate` (or the boot-time upgrade) finishing.
 *
 * When that happens the server answers `503 { code: "schema_pending" }` instead
 * of a 500 — "not yet", not "broken". The notice below says exactly that, and
 * the hook behind it keeps trying on its own so the member usually never has to
 * press anything.
 */
import { useEffect } from "react";

/** The calm version of "wait a minute". */
export function SchemaPendingNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mb-4 rounded-xl border border-amber-400/25 bg-amber-500/[0.08] px-4 py-3 text-xs text-amber-100">
      <p className="font-semibold text-amber-200">Your garage is being brought up to date</p>
      <p className="mt-1 leading-relaxed text-amber-100/80">
        The website has just been updated and the database is catching up. Your bikes and rides are safe — nothing is
        lost. This normally takes under a minute.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded-full border border-amber-300/40 px-3 py-1 font-medium text-amber-100 hover:bg-amber-400/10"
      >
        Try now
      </button>
    </div>
  );
}

/**
 * Retries `load` while the answer is "the database is still being upgraded".
 *
 * The delays grow, so a roomful of members refreshing after a deploy is a
 * handful of requests rather than a stampede. After the last delay it stops and
 * leaves the button in the notice to the member.
 */
export function useUpgradeRetry(
  load: () => Promise<"ok" | "pending" | "error">,
  pending: boolean,
  { delays = [1000, 2500, 5000, 10000, 20000, 30000] }: { delays?: number[] } = {},
) {
  useEffect(() => {
    if (!pending) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const tick = async () => {
      const result = await load();
      if (cancelled) return;
      // Keep trying, more slowly each time, while the answer is "not yet".
      if (result === "pending" && attempt < delays.length) {
        timer = setTimeout(tick, delays[attempt]);
        attempt += 1;
      }
    };

    timer = setTimeout(tick, delays[0]);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // `load` is wrapped in useCallback by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
}
