/**
 * The sequence edits behind the route builder.
 *
 * A route is a list, and every button in the editor is one operation on that
 * list: set the start, set the destination, drop a stop where it belongs,
 * remove one, put one back. Written out here as pure functions for two
 * reasons — they can be checked without a browser, and the dashboard and any
 * future surface share one definition of what "remove" and "undo" mean.
 *
 * Two rules run through all of it:
 *
 *  - **The ends stay the ends.** Setting a start never reorders the middle of
 *    the route; setting a destination replaces the last stop rather than
 *    appending a second destination.
 *  - **A removal is a note, not a hole.** Removing a stop returns the list
 *    *and* the stop with the place it came from, which is everything an undo
 *    needs. A red name with no payload would only be a complaint.
 */
import type { LiveStop } from "../store/siteContent";
import { insertAlong } from "./placeSearch";

/** A stop that left the route, and the index it left from. */
export interface StopRemoval {
  stop: LiveStop;
  index: number;
}

/** The route after an edit, plus whatever the edit took off it. */
export interface StopEdit {
  stops: LiveStop[];
  removed?: StopRemoval;
}

/**
 * Set the start or the destination.
 *
 * An empty route becomes a single stop. A one-stop route gains a second. On
 * any longer route the chosen stop replaces that end and keeps the status the
 * owner had given it — moving the start to a new town does not un-ride the
 * road behind it.
 */
export function replaceEndpoint(
  stops: readonly LiveStop[],
  stop: LiveStop,
  which: "start" | "end",
): StopEdit {
  if (!stops.length) return { stops: [{ ...stop }] };
  if (which === "end" && stops.length === 1) return { stops: [...stops.map((s) => ({ ...s })), { ...stop }] };

  const index = which === "start" ? 0 : stops.length - 1;
  const replaced = stops[index];
  const next = stops.map((existing, i) =>
    i === index ? { ...stop, status: replaced.status } : { ...existing },
  );
  // Replacing an end with the very same place is not a removal.
  const same =
    replaced.name.trim().toLowerCase() === stop.name.trim().toLowerCase() &&
    Math.abs(replaced.lat - stop.lat) < 0.01 &&
    Math.abs(replaced.lng - stop.lng) < 0.01;
  return { stops: next, removed: same ? undefined : { stop: replaced, index } };
}

/**
 * Drop a stop into the leg of the route it sits nearest to.
 *
 * "Mandi" typed last belongs between Nangal and Manali, not after Leh: the
 * sequence is the road, and the road decides where a place goes.
 */
export function insertStop(stops: readonly LiveStop[], stop: LiveStop): StopEdit {
  return { stops: insertAlong(stops, { ...stop }) };
}

/** Take one stop off the route. */
export function removeStopAt(stops: readonly LiveStop[], index: number): StopEdit {
  if (index < 0 || index >= stops.length) return { stops: stops.map((stop) => ({ ...stop })) };
  return {
    stops: stops.filter((_, i) => i !== index).map((stop) => ({ ...stop })),
    removed: { stop: stops[index], index },
  };
}

/**
 * Put one stop back where it was.
 *
 * The index is clamped rather than trusted: the route may have shrunk since
 * the stop was removed, and a stop near the end of a shorter list belongs at
 * the end, not at an index that no longer exists.
 */
export function restoreStop(
  stops: readonly LiveStop[],
  stop: LiveStop,
  index: number,
): LiveStop[] {
  const next = stops.map((existing) => ({ ...existing }));
  const at = Math.min(Math.max(Math.trunc(index) || 0, 0), next.length);
  next.splice(at, 0, { ...stop });
  return next;
}

/**
 * Put every removed stop back.
 *
 * Reinserted in the order they were listed, so a route cleared with "Clear all
 * stops" comes back as the route it was rather than in whatever order the red
 * names happen to be clicked.
 */
export function restoreStops(
  stops: readonly LiveStop[],
  removals: readonly StopRemoval[],
): LiveStop[] {
  const ordered = [...removals].sort((a, b) => a.index - b.index);
  return ordered.reduce<LiveStop[]>(
    (current, removal) => restoreStop(current, removal.stop, removal.index),
    stops.map((stop) => ({ ...stop })),
  );
}

/** Remove every stop, keeping each one with its place for the undo. */
export function removeAllStops(stops: readonly LiveStop[]): {
  stops: LiveStop[];
  removals: StopRemoval[];
} {
  return {
    stops: [],
    removals: stops.map((stop, index) => ({ stop, index })),
  };
}
