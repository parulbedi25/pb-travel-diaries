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
 *  - **The row is the stop.** A place typed into row *n* replaces stop *n* —
 *    same index, same status, same place in the route. Nothing is appended
 *    under a list that already has a destination, because that was the bug the
 *    operator saw: a new start in the box, the old start and its towns still
 *    sitting underneath it.
 *  - **A removal is a note, not a hole.** Removing a stop returns the list
 *    *and* the stop with the place it came from, which is everything an undo
 *    needs. A red name with no payload would only be a complaint.
 */
import type { LiveStop } from "../store/siteContent";
import { insertAlong } from "./placeSearch";

/**
 * The note that marks a town the editor filled in from the road.
 *
 * A stop somebody typed is theirs, and survives every edit. A stop the fill
 * added lies between two ends and means nothing once one of them changes.
 * Marking it with a note is what lets a new start or destination throw the
 * derived towns away and fill the new stretch in, rather than leaving a row of
 * towns from the previous ride under a start they never belonged to.
 */
export const TOWN_NOTE = "Filled in from the road";

/**
 * Was this stop put here by the fill rather than by a person?
 *
 * Notes are the only field a stop has for this, and the older note written by
 * the first version of the fill is still out there in saved routes, so both
 * markers count.
 */
export function isDerivedTown(stop: LiveStop): boolean {
  const note = (stop.note ?? "").trim();
  return note.startsWith(TOWN_NOTE) || note.startsWith("Between your points");
}

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
 * Replace one stop in place, keeping the status it had.
 *
 * This is what typing a new place into a row of the directions panel does. The
 * index is the row, the row is the stop: a stop already ridden does not become
 * "still to come" because its name was corrected, and the route keeps its
 * order.
 */
export function replaceStopAt(
  stops: readonly LiveStop[],
  index: number,
  stop: LiveStop,
): StopEdit {
  if (index < 0 || index >= stops.length) return { stops: stops.map((item) => ({ ...item })) };
  const replaced = stops[index];
  const next = stops.map((item, i) =>
    i === index ? { ...stop, status: replaced.status } : { ...item },
  );
  const same =
    replaced.name.trim().toLowerCase() === stop.name.trim().toLowerCase() &&
    Math.abs(replaced.lat - stop.lat) < 0.01 &&
    Math.abs(replaced.lng - stop.lng) < 0.01;
  return { stops: next, removed: same ? undefined : { stop: replaced, index } };
}

/**
 * Drop the towns the editor filled in, keeping the stops a person chose.
 *
 * A filled-in town is derived: it belongs to the pair of ends the fill measured
 * between, and means nothing once one of those ends changes. Typing a new start
 * on a route of Nangal → … → Leh should give the towns of *that* ride, not the
 * towns of the old one left lying under a start they never belonged to. A stop
 * somebody typed — even one that sits between the same two ends — is theirs and
 * stays.
 */
export function dropDerivedStops(
  stops: readonly LiveStop[],
  isDerived: (stop: LiveStop) => boolean,
  keep = -1,
): LiveStop[] {
  return stops.filter((stop, index) => index === keep || !isDerived(stop));
}

/**
 * Insert a stop at an exact index, for a row that was just added.
 *
 * `insertStop` places by geography, which is right for a stop typed by name and
 * wrong for an empty row: a row appears where the operator asked for it, before
 * the destination.
 */
export function insertStopAt(
  stops: readonly LiveStop[],
  index: number,
  stop: LiveStop,
): LiveStop[] {
  const next = stops.map((item) => ({ ...item }));
  const at = Math.min(Math.max(Math.trunc(index) || 0, 0), next.length);
  next.splice(at, 0, { ...stop });
  return next;
}

/**
 * A placeholder stop halfway between the rows it is being inserted between.
 *
 * An empty row needs a position to be a stop at all — the pin has to sit
 * somewhere on the map — and the middle of the leg it lands on is the one place
 * that is never absurd: not at a pole, not on top of a stop that already
 * exists.
 */
export function midpointStop(
  stops: readonly LiveStop[],
  at: number,
  name: string,
): LiveStop {
  const before = stops[at - 1];
  const after = stops[at];
  const lat = before && after ? (before.lat + after.lat) / 2 : before ? before.lat + 0.05 : 31;
  const lng = before && after ? (before.lng + after.lng) / 2 : before ? before.lng + 0.05 : 76.5;
  return {
    name,
    note: "",
    status: "next",
    lat: Math.round(lat * 1e4) / 1e4,
    lng: Math.round(lng * 1e4) / 1e4,
  };
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
