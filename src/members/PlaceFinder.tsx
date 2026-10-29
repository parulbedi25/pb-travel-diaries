/**
 * The place finder under the member's map.
 *
 * It works the way the dashboard's live-tracker stop editor works: type a
 * place, press Find, and the lookup puts it on the ground. What happens next is
 * different, because this is the member's own notebook rather than the site's
 * route — the place is kept, listed below the box, and each entry opens to show
 * where it is and, on its own page, a map with just that pointer on it.
 *
 * The list is per member and lives in this browser (see `memberPlaces`), so
 * nothing here reaches the database and nothing here is visible to anyone else.
 * When the lookup cannot be reached — no signal, or a network that blocks the
 * geocoders — a coordinate pair can still be saved, because a rider often has
 * the numbers already.
 */

import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import RideMap from "./RideMap";
import { cn } from "../utils/cn";
import {
  findPlaceByName,
  loadSavedPlaces,
  newPlaceId,
  placeFromCoordinates,
  placeStops,
  storeSavedPlaces,
  type SavedPlace,
} from "./memberPlaces";
import type { MemberTheme } from "./memberTheme";

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-saffron-400/60 focus:outline-none focus:ring-2 focus:ring-saffron-400/20";
const labelCls = "text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500";

const when = (iso: string) => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

export default function PlaceFinder({
  ownerId,
  theme,
}: {
  ownerId: number | null;
  theme: MemberTheme;
}) {
  const [places, setPlaces] = useState<SavedPlace[]>(() => loadSavedPlaces(ownerId));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** The entry left open — clicking a saved place expands it. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** Shown after the lookup could not be reached, and on request. */
  const [manual, setManual] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");

  useEffect(() => {
    setPlaces(loadSavedPlaces(ownerId));
    setOpenId(null);
  }, [ownerId]);

  const commit = (next: SavedPlace[]) => {
    setPlaces(next);
    storeSavedPlaces(ownerId, next);
  };

  const save = (input: { name: string; address?: string; lat: number; lng: number }) => {
    const existing = places.find(
      (place) =>
        place.name.toLowerCase() === input.name.trim().toLowerCase() &&
        Math.abs(place.lat - input.lat) < 0.0005 &&
        Math.abs(place.lng - input.lng) < 0.0005,
    );
    if (existing) {
      setOpenId(existing.id);
      setError("");
      return;
    }
    const place: SavedPlace = {
      id: newPlaceId(),
      name: input.name.trim(),
      address: input.address,
      lat: input.lat,
      lng: input.lng,
      savedAt: new Date().toISOString(),
    };
    commit([place, ...places]);
    setOpenId(place.id);
    setError("");
  };

  const handleFind = async () => {
    const typed = query.trim();
    if (!typed) return;
    setBusy(true);
    setError("");
    try {
      const found = await findPlaceByName(typed);
      if (!found) {
        setError(
          `Could not find “${typed}”. Try the town and the state together — or save it by its coordinates.`,
        );
        setManual(true);
        return;
      }
      save(found);
      setQuery("");
    } finally {
      setBusy(false);
    }
  };

  const handleManual = () => {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    const found = placeFromCoordinates(query, lat, lng);
    if (!found) {
      setError("A latitude between -90 and 90 and a longitude between -180 and 180, please.");
      return;
    }
    save(found);
    setQuery("");
    setManualLat("");
    setManualLng("");
    setManual(false);
  };

  return (
    <div className="mt-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3">
      <label htmlFor="place-find" className={labelCls}>
        Find a place
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="place-find"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleFind();
            }
          }}
          placeholder="A town, a pass, a dhaba — Anandpur Sahib"
          aria-label="Find a place by name"
          className={inputCls}
        />
        <button
          type="button"
          onClick={() => void handleFind()}
          disabled={busy || !query.trim()}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-saffron-400 px-4 py-2.5 text-xs font-semibold text-on-gold transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Find
        </button>
        <button
          type="button"
          onClick={() => setManual((open) => !open)}
          aria-expanded={manual}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-white/25 hover:text-white"
        >
          <MapPin className="h-3.5 w-3.5" /> Coordinates
        </button>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
        A place found here is kept in your garage and listed below — private to you, and still there
        when you come back.
      </p>

      {manual && (
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input
            value={manualLat}
            onChange={(event) => setManualLat(event.target.value)}
            placeholder="Latitude"
            inputMode="decimal"
            aria-label="Latitude of the place"
            className={inputCls}
          />
          <input
            value={manualLng}
            onChange={(event) => setManualLng(event.target.value)}
            placeholder="Longitude"
            inputMode="decimal"
            aria-label="Longitude of the place"
            className={inputCls}
          />
          <button
            type="button"
            onClick={handleManual}
            disabled={!manualLat.trim() || !manualLng.trim()}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-white/[0.08] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/[0.16] disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Save place
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-[11px] font-medium text-amber-300">{error}</p>}

      {places.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-zinc-500">
          No places yet. Find one above and it will be listed here.
        </p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {places.map((place) => {
            const open = openId === place.id;
            return (
              <li
                key={place.id}
                className={cn(
                  "overflow-hidden rounded-xl border transition-colors",
                  open ? "border-saffron-400/40 bg-saffron-400/[0.05]" : "border-white/[0.07] bg-white/[0.02]",
                )}
              >
                <div className="flex items-center gap-2 p-1">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : place.id)}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/[0.08] text-saffron-300">
                      <MapPin className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">{place.name}</span>
                      <span className="block truncate font-mono text-[10px] text-zinc-500">
                        {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
                        {place.address ? ` · ${place.address}` : ""}
                      </span>
                    </span>
                    {open ? (
                      <ChevronUp className="h-4 w-4 shrink-0 text-zinc-500" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      commit(places.filter((row) => row.id !== place.id));
                      if (open) setOpenId(null);
                    }}
                    aria-label={`Remove ${place.name}`}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-zinc-500 transition-colors hover:bg-white/[0.08] hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {open && (
                  <div className="border-t border-white/[0.07] p-3">
                    <RideMap
                      stops={placeStops(place)}
                      height={220}
                      themeOverride={theme}
                      className="rounded-xl"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {place.address && (
                        <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-zinc-400">
                          {place.address}
                        </p>
                      )}
                      <span className="text-[10px] text-zinc-600">saved {when(place.savedAt)}</span>
                      <a
                        href={`#/ride/place/${place.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:border-white/25 hover:text-white"
                      >
                        <ExternalLink className="h-3 w-3" /> Open place page
                      </a>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
