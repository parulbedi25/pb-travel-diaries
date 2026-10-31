import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Loader2, MapPin, X } from "lucide-react";
import { cn } from "../utils/cn";
import { searchPlaces, type PlaceHit, type PlaceSearchOptions } from "../utils/placeSearch";
import { inputCls } from "./fieldStyles";

/**
 * A place box that suggests places while you type.
 *
 * The dashboard used to make the operator type a whole place name and press
 * Find, then tell them afterwards that it could not be found. This asks as they
 * type — three characters is enough for Geoapify to answer — and shows the
 * names underneath, so a stop is picked rather than spelled.
 *
 * Three things matter for a box like this to be usable rather than clever:
 *
 *  - It never fires a request per keystroke. One timer, at most one request in
 *    flight, and the previous one is abandoned the moment the text changes, so
 *    "anandpur" is one answer rather than eight racing ones.
 *  - Arrows and Enter work, because a list you have to reach for a mouse to use
 *    is slower than typing the name out. Escape closes it without clearing.
 *  - A suggestion is a *choice*: picking one hands the caller a name, a region
 *    and coordinates, and stops guessing. Typing a name without picking one
 *    still works — the caller geocodes it as before.
 */
export default function PlaceTypeahead({
  value,
  onChange,
  onPick,
  onEnter,
  options,
  placeholder,
  label,
  hint,
  autoFocus,
}: {
  value: string;
  onChange: (text: string) => void;
  /** A suggestion was chosen: a real place with coordinates. */
  onPick: (place: PlaceHit) => void;
  /** Enter on a name that was not picked from the list. */
  onEnter?: () => void;
  /** The key, the country and the bias — the caller owns all three. */
  options: PlaceSearchOptions;
  placeholder?: string;
  label: string;
  hint?: string;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [active, setActive] = useState(-1);
  const [note, setNote] = useState("");
  /** The text the current answer belongs to, so a stale one can be ignored. */
  const answered = useRef("");
  const timer = useRef<number | undefined>(undefined);
  const box = useRef<HTMLDivElement | null>(null);

  // Close when the click lands outside — a list that stays open over the map
  // below it hides the thing the operator is about to click.
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (box.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const key = options.key.trim();

  const ask = (text: string) => {
    window.clearTimeout(timer.current);
    const term = text.trim();
    if (term.length < 3) {
      setHits([]);
      setNote(term ? "Type a little more…" : "");
      setBusy(false);
      return;
    }
    if (!key) {
      setHits([]);
      setNote("No place-search key is set — type the name and press Find.");
      setBusy(false);
      return;
    }
    setBusy(true);
    // Long enough that typing "Manali" asks once, short enough to feel live.
    timer.current = window.setTimeout(async () => {
      answered.current = term;
      const found = await searchPlaces(term, options);
      if (answered.current !== term) return;
      setBusy(false);
      setHits(found);
      setActive(found.length ? 0 : -1);
      setNote(found.length ? "" : `Nothing found for “${term}”.`);
    }, 280);
  };

  const choose = (place: PlaceHit) => {
    onPick(place);
    setOpen(false);
    setHits([]);
    setActive(-1);
    setNote("");
  };

  /** Enter: a highlighted suggestion, else the typed name as it stands. */
  const submit = () => {
    if (open && active >= 0 && hits[active]) {
      choose(hits[active]);
      return;
    }
    setOpen(false);
    onEnter?.();
  };

  const showList = open && (busy || hits.length > 0 || Boolean(note));

  const status = useMemo(() => {
    if (busy) return "Looking for places…";
    if (note) return note;
    if (hits.length) return `${hits.length} place${hits.length === 1 ? "" : "s"} found`;
    return "";
  }, [busy, hits.length, note]);

  return (
    <div ref={box} className="relative">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </label>
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <input
          value={value}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && hits[active] ? `${listId}-${active}` : undefined}
          placeholder={placeholder}
          onChange={(event) => {
            const text = event.target.value;
            onChange(text);
            setOpen(true);
            setActive(-1);
            ask(text);
          }}
          onFocus={() => {
            if (value.trim().length >= 3) {
              setOpen(true);
              if (!hits.length) ask(value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive((i) => (hits.length ? (i + 1) % hits.length : -1));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) => (hits.length ? (i - 1 + hits.length) % hits.length : -1));
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
              return;
            }
            if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          className={cn(inputCls, "pl-9 pr-9")}
        />
        {busy ? (
          <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-zinc-500" />
        ) : value ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setHits([]);
              setNote("");
              setOpen(false);
            }}
            aria-label={`Clear ${label}`}
            className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-zinc-500 transition-colors hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {hint && !showList && <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">{hint}</p>}

      {showList && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-white/12 bg-ink-900/95 shadow-2xl backdrop-blur-xl">
          <ul id={listId} role="listbox" aria-label={`${label} suggestions`} className="max-h-64 overflow-y-auto">
            {hits.map((place, index) => (
              <li key={`${place.name}-${place.lat}-${place.lng}`}>
                <button
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(place)}
                  className={cn(
                    "flex w-full items-baseline gap-2 px-3 py-2 text-left transition-colors",
                    index === active ? "bg-saffron-400/15" : "hover:bg-white/[0.06]",
                  )}
                >
                  <span className="truncate text-xs font-semibold text-white">{place.name}</span>
                  {place.region && (
                    <span className="truncate text-[10px] text-zinc-500">{place.region}</span>
                  )}
                  {place.kind && (
                    <span className="ml-auto shrink-0 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-zinc-400">
                      {place.kind}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {status && (
            <p
              className={cn(
                "border-t border-white/[0.06] px-3 py-1.5 text-[10px]",
                busy ? "text-zinc-500" : hits.length ? "text-zinc-500" : "text-amber-200/90",
              )}
            >
              {status}
              {!hits.length && onEnter && !busy && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onEnter();
                  }}
                  className="ml-2 rounded-full border border-white/15 px-2 py-0.5 font-semibold text-white transition-colors hover:bg-white/[0.08]"
                >
                  Use “{value.trim()}” anyway
                </button>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
