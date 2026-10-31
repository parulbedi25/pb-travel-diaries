import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  GripVertical,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { LiveStop } from "../store/siteContent";
import type { PlaceHit } from "../utils/placeSearch";
import { cn } from "../utils/cn";
import PlaceTypeahead from "./PlaceTypeahead";
import { formatKm } from "../utils/routeProgress";

/**
 * The route, as a list of places you can type into and drag.
 *
 * The dashboard used to keep the route in two places at once: a pair of boxes
 * for the ends, and a column of stop cards below them. The two never agreed —
 * choosing a new start changed the box but left the old start (and every town
 * that belonged to it) in the list underneath, which is exactly what "it is
 * not replacing the existing locations" looked like from the outside.
 *
 * There is one list now, and it is the route, the way a directions panel works
 * anywhere else:
 *
 *   ● Nangal            (start)
 *   │
 *   ○ Mandi             (a stop on the way)
 *   │
 *   ■ Leh               (destination)
 *
 * Every row is a real stop — the same stop shown on the map above and in the
 * detail cards below — so typing a new place into the start row *replaces* the
 * start, dragging a row moves that stop in the route, and removing a row takes
 * the stop off. Each of those hands the change straight back to the editor,
 * which measures the road again, so the distance and the drawn line follow the
 * rows rather than lagging behind them.
 */
export default function RouteDirections({
  stops,
  searchKey,
  totals,
  totalKm,
  byRoad,
  measuring,
  addTowns,
  onToggleTowns,
  onPlace,
  onPlaceText,
  onAdd,
  onRemove,
  onReorder,
  onFillTowns,
  fillBusy,
  note,
  error,
}: {
  stops: LiveStop[];
  /** The site's Geoapify key, if it has one; the suggestions fall back without. */
  searchKey: string;
  /** Kilometres from the start to each stop, measured along the road. */
  totals: number[];
  totalKm: number;
  /** True when those kilometres were measured on a road, not in a straight line. */
  byRoad: boolean;
  /** The road is being measured again for the current rows. */
  measuring: boolean;
  addTowns: boolean;
  onToggleTowns: (on: boolean) => void;
  /** A place was chosen for a row: that row becomes this place. */
  onPlace: (index: number, place: PlaceHit) => void;
  /** A name was typed into a row and Entered, without picking a suggestion. */
  onPlaceText: (index: number, name: string) => void;
  /** Insert an empty stop before the destination (or after the last row). */
  onAdd: () => void;
  onRemove: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  /** Fill in the towns on the road between the stops the owner chose. */
  onFillTowns: () => void;
  fillBusy: boolean;
  note?: string;
  error?: string;
}) {
  /** The row being dragged, and the row it would land on. */
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  /** Bumped after an add, so the new row's box takes the cursor. */
  const [focusRow, setFocusRow] = useState<{ index: number; tick: number } | null>(null);

  const count = stops.length;
  const empty = count === 0;

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-ink-950/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-bold text-white">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-saffron-400 text-[10px] font-bold text-on-gold">
            1
          </span>
          Your route
        </p>
        <span className="font-mono text-[10px] text-zinc-500">
          {count} {count === 1 ? "stop" : "stops"}
          {count >= 2 ? ` · ${formatKm(totalKm)}${byRoad ? " by road" : ""}` : ""}
        </span>
      </div>

      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
        Type a place, or drag a row to change the order. The road and the distance are measured again
        the moment a row changes — no button to press.
      </p>

      <ol className="mt-3 flex flex-col" aria-label="Stops on this route, in order">
        {stops.map((stop, index) => {
          const role =
            count === 1 ? "only" : index === 0 ? "start" : index === count - 1 ? "end" : "mid";
          const label =
            role === "start" || role === "only"
              ? "Start"
              : role === "end"
                ? "Destination"
                : `Stop ${index}`;
          return (
            <WaypointRow
              key={`${index}-${stop.lat}-${stop.lng}`}
              stop={stop}
              searchKey={searchKey}
              index={index}
              label={label}
              role={role}
              distanceKm={totals[index] ?? 0}
              dragging={dragFrom === index}
              dragOver={dragOver === index && dragFrom !== null && dragFrom !== index}
              onDragStart={() => setDragFrom(index)}
              onDragEnter={() => setDragOver(index)}
              onDrop={() => {
                if (dragFrom !== null && dragFrom !== index) onReorder(dragFrom, index);
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              onPick={(place) => onPlace(index, place)}
              onEnter={(name) => onPlaceText(index, name)}
              onRemove={() => onRemove(index)}
              onMoveUp={index > 0 ? () => onReorder(index, index - 1) : undefined}
              onMoveDown={index < count - 1 ? () => onReorder(index, index + 1) : undefined}
              focusTick={focusRow?.index === index ? focusRow.tick : 0}
            />
          );
        })}
      </ol>

      {empty && (
        <p className="rounded-xl border border-dashed border-white/12 px-3 py-6 text-center text-[11px] text-zinc-500">
          No stops yet. Add a start below, or click the map above to place one.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            onAdd();
            // The row is added at the end, so its index is the length the list
            // had a moment ago — not one before the last row.
            setFocusRow({ index: count, tick: Date.now() });
          }}
          className="flex items-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white transition-colors hover:border-white/30"
        >
          <Plus className="h-3.5 w-3.5" />
          {count === 0 ? "Add a start" : count === 1 ? "Add a destination" : "Add a stop"}
        </button>

        {measuring && (
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-saffron-300">
            <Loader2 className="h-3 w-3 animate-spin" /> Recalculating the road…
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <label className="flex items-start gap-2 text-[11px] text-zinc-300">
          <input
            type="checkbox"
            checked={addTowns}
            onChange={(event) => onToggleTowns(event.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-emerald-500"
          />
          <span>
            Add the cities and towns on the way
            <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">
              Every place the road goes through, whether the next one is 10 km on or 50. They go in
              green and can each be removed — anything you remove stays removed.
            </span>
          </span>
        </label>
        <button
          type="button"
          onClick={onFillTowns}
          disabled={fillBusy || count < 2}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-saffron-400 px-3 py-2 text-xs font-bold text-on-gold transition-all duration-300 hover:brightness-110 active:scale-95 disabled:opacity-40"
        >
          {fillBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {fillBusy ? "Finding towns…" : "Fill in the towns between"}
        </button>
      </div>

      {note && <p className="mt-2 text-[11px] leading-relaxed text-emerald-300">{note}</p>}
      {error && <p className="mt-2 text-[11px] leading-relaxed text-amber-200">{error}</p>}
    </div>
  );
}

/**
 * One row of the directions panel.
 *
 * Its text lives here rather than in the parent: the box has to follow what is
 * being typed, while the stop it stands for only changes when a place is picked
 * or the name is Entered. Keeping the draft in the row means a half-typed name
 * never becomes a stop, and a stop edited elsewhere (on the map, in the detail
 * card) still shows its new name here.
 */
function WaypointRow({
  stop,
  searchKey,
  index,
  label,
  role,
  distanceKm,
  dragging,
  dragOver,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
  onPick,
  onEnter,
  onRemove,
  onMoveUp,
  onMoveDown,
  focusTick,
}: {
  stop: LiveStop;
  searchKey: string;
  index: number;
  label: string;
  role: "start" | "mid" | "end" | "only";
  distanceKm: number;
  dragging: boolean;
  dragOver: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onPick: (place: PlaceHit) => void;
  onEnter: (name: string) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  focusTick: number;
}) {
  // A row that was just added has a placeholder for a name ("Stop 4"): the box
  // starts empty, the way an empty row does in a directions panel, so typing
  // into it reads as naming a place rather than editing a word.
  const shown = (name: string) => (/^stop \d+$/i.test(name.trim()) ? "" : name);
  const [text, setText] = useState(() => shown(stop.name));
  const typed = useRef(false);

  // A name changed anywhere else — a pin dragged on the map, a name looked up
  // for a pasted link — lands in the box too, unless the operator is midway
  // through typing a different one.
  useEffect(() => {
    if (!typed.current) setText(shown(stop.name));
  }, [stop.name]);

  useEffect(() => {
    if (focusTick) typed.current = false;
  }, [focusTick]);

  const marker =
    role === "start" || role === "only" ? (
      <span className="grid h-3.5 w-3.5 place-items-center rounded-full border-2 border-emerald-400 bg-ink-950" />
    ) : role === "end" ? (
      <span className="h-3.5 w-3.5 rounded-[3px] border-2 border-red-400 bg-ink-950" />
    ) : (
      <span className="h-3 w-3 rounded-full border-2 border-saffron-400/80 bg-ink-950" />
    );

  return (
    <li
      className={cn(
        "group relative flex gap-2 rounded-xl transition-colors",
        dragging && "opacity-40",
        dragOver && "bg-saffron-400/[0.10] ring-1 ring-saffron-400/40",
      )}
      onDragOver={(event) => {
        event.preventDefault();
        onDragEnter();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      {/* The rail: a marker per row and a line down to the next one. */}
      <div className="relative flex w-4 shrink-0 flex-col items-center pt-3.5">
        {marker}
        {role !== "end" && role !== "only" && (
          <span className="mt-1 w-px flex-1 bg-gradient-to-b from-white/25 to-white/10" aria-hidden />
        )}
      </div>

      <div className="min-w-0 flex-1 py-1">
        <div className="flex items-end gap-1.5">
          <div className="min-w-0 flex-1">
            <PlaceTypeahead
              value={text}
              onChange={(value) => {
                typed.current = true;
                setText(value);
              }}
              onPick={(place) => {
                typed.current = false;
                setText(place.name);
                onPick(place);
              }}
              onEnter={() => {
                const name = text.trim();
                if (!name) return;
                // Already this stop: nothing to look up.
                if (name.toLowerCase() === stop.name.trim().toLowerCase()) return;
                onEnter(name);
              }}
              options={{
                key: searchKey,
                country: "in",
                limit: 6,
                near: { lat: stop.lat, lng: stop.lng },
              }}
              label={label}
              hideLabel
              placeholder={
                role === "end"
                  ? "Choose a destination…"
                  : role === "start" || role === "only"
                    ? "Choose a starting point…"
                    : "Add a stop…"
              }
              focusTick={focusTick}
            />
          </div>

          <div className="flex shrink-0 items-center gap-0.5 pb-0.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              draggable
              onDragStart={(event) => {
                // Firefox will not start a drag without payload on the
                // transfer: the row itself is the payload.
                event.dataTransfer.setData("text/plain", String(index));
                event.dataTransfer.effectAllowed = "move";
                onDragStart();
              }}
              onDragEnd={onDragEnd}
              aria-label={`Drag ${stop.name} to change its place in the route`}
              title="Drag to change the order"
              className="grid h-7 w-6 cursor-grab place-items-center rounded text-zinc-400 hover:text-white active:cursor-grabbing"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!onMoveUp}
              aria-label={`Move ${stop.name} earlier`}
              className="grid h-7 w-6 place-items-center rounded text-zinc-400 transition-colors hover:text-white disabled:opacity-25"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!onMoveDown}
              aria-label={`Move ${stop.name} later`}
              className="grid h-7 w-6 place-items-center rounded text-zinc-400 transition-colors hover:text-white disabled:opacity-25"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${stop.name}`}
              title="Remove this stop — it can be put back from the red list"
              className="grid h-7 w-6 place-items-center rounded text-zinc-400 transition-colors hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <p className="mt-0.5 flex items-center gap-1.5 pl-0.5 text-[9.5px] uppercase tracking-[0.12em] text-zinc-600">
          <span>{label}</span>
          {index > 0 && (
            <span className="font-mono normal-case tracking-normal text-zinc-500">
              · {formatKm(distanceKm)} from the start
            </span>
          )}
          {stop.status === "live" && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-px text-[8.5px] font-bold text-emerald-300">
              <Check className="h-2.5 w-2.5" /> here now
            </span>
          )}
        </p>
      </div>
    </li>
  );
}
