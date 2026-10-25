/**
 * The member's own garage and ride builder.
 *
 * This page is the whole members' tracker, and it is deliberately a separate
 * thing from the journal: it reads and writes nothing but the signed-in
 * member's own bikes and rides (see server/routes/member.js), so nothing here
 * can change a public page or the owner's dashboard. Two members signed in at
 * once see two different garages.
 *
 * What a member does here, in order:
 *
 *  1. **Signs up with a bike** — maker, model, purchase year, mileage. Leave
 *     the mileage blank and it is filled from the maker catalogue's average for
 *     that model and year, and plainly labelled as an estimate.
 *  2. **Adds more bikes** — a commuter and a weekend bike are the usual pair,
 *     and each keeps its own mileage, so their petrol figures stand ready side
 *     by side.
 *  3. **Builds a ride** — by clicking pins onto the map by hand, or by pasting
 *     a map link and having its stops read out (the same resolver the dashboard
 *     uses, short `maps.app.goo.gl` links included).
 *  4. **Reads the petrol** — litres for the one-way ride and for the round trip,
 *     for every bike in the garage, not just the one selected.
 *  5. **Writes it down** — a title, sticky-note notes, and photos in a gallery
 *     strip.
 *
 * Everything is saved by pressing Save on the ride; nothing here publishes to
 * the site, and nothing here is visible to anyone else.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bike,
  Camera,
  Check,
  Fuel,
  Link2,
  Loader2,
  LocateFixed,
  LogIn,
  MapPin,
  Pencil,
  Plus,
  Route as RouteIcon,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { describeApiError } from "../api/client";
import {
  memberApi,
  type CatalogueMaker,
  type GalleryItem,
  type MemberBike,
  type MemberJourney,
  type MemberStop,
} from "../api/memberApi";
import { useSite } from "../store/siteContent";
import { parseRouteLink } from "../utils/mapLinks";
import { cn } from "../utils/cn";
import RideMap from "./RideMap";
import { SchemaPendingNotice, useUpgradeRetry } from "./SchemaPending";
import { rideMaths } from "./rideMath";

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-saffron-400/60 focus:outline-none focus:ring-2 focus:ring-saffron-400/20";
const labelCls = "text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500";
const cardCls = "rounded-3xl glass p-5 sm:p-6";

/** Where a stop is dropped when a member asks for their own location. */
const MAX_GALLERY_BYTES = 1.6 * 1024 * 1024;

/* ── small helpers ───────────────────────────────────────────────────── */

const num = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value.trim() !== "" ? parsed : null;
};

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("That photo could not be read."));
    reader.readAsDataURL(file);
  });

/** A place name looked up the same way the dashboard looks one up. */
async function geocodeName(name: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(
    name,
  )}`;
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const rows = (await response.json()) as { lat: string; lon: string }[];
    const first = rows?.[0];
    if (!first) return null;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

/* ── garage ──────────────────────────────────────────────────────────── */

function MakerBadge({ maker, className }: { maker: { name: string; logo: string }; className?: string }) {
  return (
    <img
      src={maker.logo}
      alt={maker.name}
      loading="lazy"
      className={cn("h-8 w-auto rounded-md object-contain", className)}
    />
  );
}

function BikeForm({
  makers,
  initial,
  busy,
  onCancel,
  onSubmit,
  compact,
}: {
  makers: CatalogueMaker[];
  initial?: MemberBike | null;
  busy: boolean;
  onCancel?: () => void;
  onSubmit: (input: { maker: string; model: string; year: number | null; mileageKmpl: number | null }) => void;
  compact?: boolean;
}) {
  const initialMaker =
    makers.find((maker) => maker.name === initial?.maker)?.id ?? makers[0]?.id ?? "";
  const [makerId, setMakerId] = useState(initialMaker);
  const maker = makers.find((entry) => entry.id === makerId) ?? makers[0];
  const initialModel =
    maker?.models.find((model) => model.name === initial?.model)?.id ?? maker?.models[0]?.id ?? "";
  const [modelId, setModelId] = useState(initialModel);
  const [year, setYear] = useState(initial?.year ? String(initial.year) : "");
  const [mileage, setMileage] = useState(
    initial?.mileageSource === "manual" && initial.mileageKmpl ? String(initial.mileageKmpl) : "",
  );

  const model = maker?.models.find((entry) => entry.id === modelId) ?? maker?.models[0];
  const [showLogos, setShowLogos] = useState(!compact || !initial);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!maker || !model) return;
    onSubmit({
      maker: maker.name,
      model: model.name,
      year: num(year),
      mileageKmpl: num(mileage),
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <span className={labelCls}>Maker</span>
          <button
            type="button"
            onClick={() => setShowLogos((value) => !value)}
            className="text-[11px] font-semibold text-saffron-300 transition-colors hover:text-saffron-200"
          >
            {showLogos ? "Hide logos" : "Show all makers"}
          </button>
        </div>
        {showLogos ? (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {makers.map((entry) => {
              const on = entry.id === maker?.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setMakerId(entry.id);
                    const firstModel = entry.models[0]?.id ?? "";
                    setModelId((current) =>
                      entry.models.some((model) => model.id === current) ? current : firstModel,
                    );
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors",
                    on
                      ? "border-saffron-400/60 bg-saffron-400/[0.08]"
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/20",
                  )}
                >
                  <MakerBadge maker={entry} className="h-7" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-white">{entry.name}</span>
                    <span className="block truncate font-urdu text-[11px] text-zinc-500" dir="rtl" lang="ur">
                      {entry.urdu}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <select
            value={maker?.id ?? ""}
            onChange={(event) => {
              setMakerId(event.target.value);
              const next = makers.find((entry) => entry.id === event.target.value);
              setModelId(next?.models[0]?.id ?? "");
            }}
            className={cn(inputCls, "mt-2")}
          >
            {makers.map((entry) => (
              <option key={entry.id} value={entry.id} className="bg-ink-950">
                {entry.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={labelCls}>Model</span>
          <select
            value={model?.id ?? ""}
            onChange={(event) => setModelId(event.target.value)}
            className={inputCls}
          >
            {(maker?.models ?? []).map((entry) => (
              <option key={entry.id} value={entry.id} className="bg-ink-950">
                {entry.name} · {entry.cc} cc · ~{entry.kmpl} km/l
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className={labelCls}>Bought in</span>
          <input
            type="number"
            inputMode="numeric"
            min={1970}
            max={new Date().getFullYear() + 1}
            value={year}
            onChange={(event) => setYear(event.target.value)}
            placeholder={String(new Date().getFullYear())}
            className={inputCls}
          />
        </label>
      </div>

      <label className="grid gap-1.5">
        <span className={labelCls}>
          Mileage <span className="font-normal normal-case tracking-normal text-zinc-600">km per litre</span>
        </span>
        <input
          type="number"
          inputMode="decimal"
          min={1}
          max={200}
          step="0.1"
          value={mileage}
          onChange={(event) => setMileage(event.target.value)}
          placeholder={model ? `Leave blank — we use ~${model.kmpl} km/l` : "Leave blank to estimate"}
          className={inputCls}
        />
        <span className="text-[11px] leading-relaxed text-zinc-500">
          Blank is fine: the figure is estimated from what that model averages, then labelled an estimate.
          Type the number your own bike returns and it is used instead.
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy || !maker || !model}
          className="inline-flex items-center gap-2 rounded-xl bg-saffron-400 px-4 py-2.5 text-sm font-semibold text-on-gold transition-all hover:brightness-110 active:scale-95 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {initial ? "Save bike" : "Add to my garage"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-4 w-4" /> Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function GarageCard({
  bike,
  bikeCount,
  busy,
  onEdit,
  onDelete,
}: {
  bike: MemberBike;
  bikeCount: number;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold text-white">
            {bike.maker} {bike.model}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {bike.year ? `${bike.year} · ` : ""}
            {bike.mileageSource === "manual" ? "your own mileage" : "mileage estimated"}
          </p>
        </div>
        <Bike className="h-4 w-4 shrink-0 text-saffron-300" />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-xl bg-white/[0.04] px-2.5 py-2">
          <dt className="text-zinc-500">Mileage</dt>
          <dd className="font-display text-sm font-semibold text-white">
            {bike.mileageKmpl ?? "—"} <span className="text-[10px] font-normal text-zinc-500">km/l</span>
          </dd>
        </div>
        <div className="rounded-xl bg-white/[0.04] px-2.5 py-2">
          <dt className="text-zinc-500">Per 100 km</dt>
          <dd className="font-display text-sm font-semibold text-white">
            {bike.litresPer100Km ?? "—"} <span className="text-[10px] font-normal text-zinc-500">L</span>
          </dd>
        </div>
      </dl>

      {bike.estimateNote && (
        <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">{bike.estimateNote}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:bg-white/[0.12]"
        >
          <Pencil className="h-3 w-3" /> Mileage / bike
        </button>
        {bikeCount > 1 && (
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-zinc-500 transition-colors hover:text-red-300 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

/* ── gallery ─────────────────────────────────────────────────────────── */

function Gallery({
  items,
  onChange,
}: {
  items: GalleryItem[];
  onChange: (items: GalleryItem[]) => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState("");

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    const next: GalleryItem[] = [];
    for (const file of Array.from(files).slice(0, 12)) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > MAX_GALLERY_BYTES) {
        setError(`${file.name} is too large — photos need to be under 1.6 MB.`);
        continue;
      }
      try {
        next.push({ url: await fileToDataUrl(file), caption: "" });
      } catch (err) {
        setError(err instanceof Error ? err.message : "That photo could not be read.");
      }
    }
    if (next.length) onChange([...items, ...next].slice(0, 24));
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className={labelCls}>Gallery</span>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:bg-white/[0.12]"
        >
          <Camera className="h-3.5 w-3.5" /> Add photos
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          void addFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {items.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-[11px] text-zinc-500">
          Photos of the ride live here — the bikes, the road, the chai stop.
        </p>
      ) : (
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((item, index) => (
            <figure key={`${item.url.slice(-20)}-${index}`} className="group relative overflow-hidden rounded-xl border border-white/10">
              <img src={item.url} alt={item.caption || `Ride photo ${index + 1}`} className="h-24 w-full object-cover" />
              <input
                value={item.caption}
                onChange={(event) => {
                  const next = [...items];
                  next[index] = { ...item, caption: event.target.value };
                  onChange(next);
                }}
                placeholder="Caption"
                aria-label={`Caption for photo ${index + 1}`}
                className="w-full bg-ink-950/85 px-2 py-1 text-[10px] text-white placeholder:text-zinc-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => onChange(items.filter((_, at) => at !== index))}
                aria-label={`Remove photo ${index + 1}`}
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-ink-950/80 text-zinc-300 opacity-0 transition-opacity hover:text-white group-hover:opacity-100 focus:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </figure>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-[11px] font-medium text-red-400">{error}</p>}
    </div>
  );
}

/* ── the page ────────────────────────────────────────────────────────── */

export default function MemberTracker() {
  const { account, siteTitle } = useSite();

  const [makers, setMakers] = useState<CatalogueMaker[]>([]);
  const [bikes, setBikes] = useState<MemberBike[]>([]);
  const [journeys, setJourneys] = useState<MemberJourney[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /** The database is still being upgraded; the page waits rather than scolds. */
  const [upgrading, setUpgrading] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  /* builder state */
  const [editingRideId, setEditingRideId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [bikeId, setBikeId] = useState<number | null>(null);
  const [stops, setStops] = useState<MemberStop[]>([]);
  const [notes, setNotes] = useState("");
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [roundTrip, setRoundTrip] = useState(false);
  const [selectedStop, setSelectedStop] = useState<number | null>(null);
  const [link, setLink] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [stopName, setStopName] = useState("");
  const [stopLat, setStopLat] = useState("");
  const [stopLng, setStopLng] = useState("");

  /* garage editing */
  const [addingBike, setAddingBike] = useState(false);
  const [editingBike, setEditingBike] = useState<MemberBike | null>(null);

  /**
   * Reads the catalogue and this member's garage.
   *
   * Returns what happened, because one of the three answers needs a different
   * response from the page: `pending` means the database is still being
   * upgraded for the member tables, so the honest thing is to wait a moment and
   * try again rather than to show an error at someone whose data is fine.
   */
  const load = useCallback(async (): Promise<"ok" | "pending" | "error"> => {
    setLoading(true);
    setError("");
    try {
      const [catalogue, garage] = await Promise.all([memberApi.catalogue(), memberApi.garage()]);
      setMakers(catalogue);
      setBikes(garage.bikes);
      setJourneys(garage.journeys);
      setBikeId((current) => current ?? garage.bikes[0]?.id ?? null);
      setUpgrading(false);
      return "ok";
    } catch (err) {
      const pending = (err as { code?: string } | null)?.code === "schema_pending";
      if (pending) setUpgrading(true);
      else setError(describeApiError(err));
      return pending ? "pending" : "error";
    } finally {
      setLoading(false);
    }
  }, []);

  useUpgradeRetry(load, upgrading);

  useEffect(() => {
    if (!account) return;
    void load();
  }, [account, load]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  };

  const resetBuilder = () => {
    setEditingRideId(null);
    setTitle("");
    setStops([]);
    setNotes("");
    setGallery([]);
    setRoundTrip(false);
    setSelectedStop(null);
    setLink("");
    setLinkError("");
  };

  const chosenBike = bikes.find((bike) => bike.id === bikeId) ?? null;
  const local = useMemo(() => rideMaths(stops, chosenBike?.mileageKmpl ?? null), [stops, chosenBike]);
  const perBike = useMemo(
    () =>
      bikes.map((bike) => ({
        bike,
        maths: rideMaths(stops, bike.mileageKmpl ?? null),
      })),
    [bikes, stops],
  );

  const addStop = (stop: MemberStop) => {
    setStops((current) => [...current, stop]);
    setSelectedStop(stops.length);
  };

  const dropPin = ({ lat, lng }: { lat: number; lng: number }) => {
    addStop({
      name: `Stop ${stops.length + 1}`,
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
    });
    flash("Stop dropped — rename it below if you like.");
  };

  const addStopFromForm = () => {
    const lat = num(stopLat);
    const lng = num(stopLng);
    if (lat === null || lng === null) {
      setLinkError("A stop needs both a latitude and a longitude.");
      return;
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setLinkError("That coordinate is outside the map.");
      return;
    }
    addStop({ name: stopName.trim() || `Stop ${stops.length + 1}`, lat, lng });
    setStopName("");
    setStopLat("");
    setStopLng("");
    setLinkError("");
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setLinkError("This browser cannot share a location.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Math.round(position.coords.latitude * 1e5) / 1e5;
        const lng = Math.round(position.coords.longitude * 1e5) / 1e5;
        setStopLat(String(lat));
        setStopLng(String(lng));
        if (!stopName.trim()) setStopName("My location");
        flash("Location filled in — add the stop when you are ready.");
      },
      () => setLinkError("Your browser would not share a location. Type the coordinates instead."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const importLink = async () => {
    const raw = link.trim();
    setLinkError("");
    if (!raw) {
      setLinkError("Paste a map or directions link first.");
      return;
    }
    setLinkBusy(true);
    try {
      let text = raw;
      let parsed = parseRouteLink(text);
      if (parsed.shortLink) {
        text = await memberApi.expandLink(text);
        parsed = parseRouteLink(text);
      }
      if (!parsed.ok || parsed.points.length === 0) {
        setLinkError(parsed.message || "No stops could be read from that link.");
        return;
      }

      const imported: MemberStop[] = [];
      for (const point of parsed.points) {
        let lat = point.lat;
        let lng = point.lng;
        if ((lat === undefined || lng === undefined) && point.label) {
          const found = await geocodeName(point.label);
          if (found) {
            lat = found.lat;
            lng = found.lng;
          }
        }
        if (lat === undefined || lng === undefined) continue;
        imported.push({
          name: point.label || `${lat.toFixed(3)}, ${lng.toFixed(3)}`,
          lat: Math.round(lat * 1e5) / 1e5,
          lng: Math.round(lng * 1e5) / 1e5,
        });
      }

      if (imported.length === 0) {
        setLinkError("The link was read, but no stop in it had coordinates we can use.");
        return;
      }
      setStops(imported);
      setSelectedStop(null);
      if (!title.trim()) setTitle(`${imported[0].name} → ${imported[imported.length - 1]?.name ?? ""}`);
      flash(`${imported.length} stops imported — check them on the map.`);
    } catch (err) {
      setLinkError(describeApiError(err));
    } finally {
      setLinkBusy(false);
    }
  };

  const saveRide = async () => {
    if (stops.length < 2) {
      setLinkError("A ride needs at least two stops.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await memberApi.saveJourney(
        {
          title: title.trim() || `${stops[0].name} → ${stops[stops.length - 1]?.name ?? ""}`,
          bikeId,
          stops,
          notes,
          gallery,
          roundTrip,
        },
        editingRideId ?? undefined,
      );
      setJourneys((current) => {
        const without = current.filter((journey) => journey.id !== saved.id);
        return [saved, ...without];
      });
      flash(editingRideId ? "Ride updated." : "Ride saved to your garage.");
      resetBuilder();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const editRide = (journey: MemberJourney) => {
    setEditingRideId(journey.id);
    setTitle(journey.title);
    setBikeId(journey.bikeId ?? bikes[0]?.id ?? null);
    setStops(journey.stops);
    setNotes(journey.notes);
    setGallery(journey.gallery);
    setRoundTrip(journey.roundTrip);
    setSelectedStop(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const removeRide = async (journey: MemberJourney) => {
    if (!window.confirm(`Delete "${journey.title}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await memberApi.deleteJourney(journey.id);
      setJourneys((current) => current.filter((entry) => entry.id !== journey.id));
      if (editingRideId === journey.id) resetBuilder();
      flash("Ride deleted.");
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const addBike = async (input: { maker: string; model: string; year: number | null; mileageKmpl: number | null }) => {
    setBusy(true);
    setError("");
    try {
      const { bike, bikes: next } = await memberApi.addBike(input);
      setBikes(next);
      setAddingBike(false);
      setBikeId(bike.id);
      flash(`${bike.maker} ${bike.model} added — its petrol figures are ready.`);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const updateBike = async (id: number, input: { maker: string; model: string; year: number | null; mileageKmpl: number | null }) => {
    setBusy(true);
    setError("");
    try {
      const { bikes: next } = await memberApi.updateBike(id, input);
      setBikes(next);
      setEditingBike(null);
      flash("Bike updated.");
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const removeBike = async (bike: MemberBike) => {
    if (!window.confirm(`Remove ${bike.maker} ${bike.model} from your garage?`)) return;
    setBusy(true);
    try {
      const { bikes: next } = await memberApi.deleteBike(bike.id);
      setBikes(next);
      if (bikeId === bike.id) setBikeId(next[0]?.id ?? null);
      flash("Bike removed.");
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  /* ── not signed in ─────────────────────────────────────────────────── */

  if (!account) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-950 px-5 py-16 text-white">
        <div className="w-full max-w-md rounded-3xl glass p-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-saffron-400 text-on-gold">
            <Bike className="h-6 w-6" />
          </span>
          <h1 className="mt-5 font-display text-xl font-semibold">Your garage is members-only</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Sign in to keep your bikes, your rides and their petrol figures. Nothing in here is public, and
            nothing in here changes {siteTitle}.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a
              href="#/members"
              className="inline-flex items-center gap-2 rounded-xl bg-saffron-400 px-5 py-3 text-sm font-semibold text-on-gold transition-all hover:brightness-110 active:scale-95"
            >
              <LogIn className="h-4 w-4" /> Sign in
            </a>
            <button
              type="button"
              onClick={() => {
                window.location.hash = "#/members?signup";
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-5 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              Create an account <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <a href="#/" className="mt-6 inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to the journal
          </a>
        </div>
      </div>
    );
  }

  const totalKm = journeys.reduce((sum, journey) => sum + (journey.maths?.oneWayKm ?? 0), 0);

  return (
    <div className="min-h-screen bg-ink-950 pb-20 text-white">
      <header className="border-b border-white/[0.07] bg-ink-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3">
            <a
              href="#/"
              className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-zinc-400 transition-colors hover:bg-white/[0.12] hover:text-white"
              aria-label="Back to the journal"
            >
              <ArrowLeft className="h-4 w-4" />
            </a>
            <div>
              <h1 className="font-display text-lg font-semibold leading-tight">
                {account.username}&apos;s garage
              </h1>
              <p className="text-[11px] text-zinc-500">
                Private to you ·{" "}
                <span className="font-urdu urdu-inline text-[12px] text-zinc-400" dir="rtl" lang="ur">
                  میرا گیراج
                </span>
              </p>
            </div>
          </div>
          <dl className="flex items-center gap-4 text-right">
            <div>
              <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Bikes</dt>
              <dd className="font-display text-sm font-semibold">{bikes.length}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Rides</dt>
              <dd className="font-display text-sm font-semibold">{journeys.length}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Planned</dt>
              <dd className="font-display text-sm font-semibold">{totalKm.toFixed(1)} km</dd>
            </div>
          </dl>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        {notice && (
          <p className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/[0.08] px-4 py-2.5 text-xs font-medium text-emerald-200">
            <Check className="h-3.5 w-3.5" /> {notice}
          </p>
        )}
        {upgrading && <SchemaPendingNotice onRetry={() => void load()} />}
        {error && (
          <p className="mb-4 rounded-xl border border-red-400/25 bg-red-500/[0.08] px-4 py-2.5 text-xs font-medium text-red-200">
            {error}
          </p>
        )}
        {loading && (
          <p className="flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening your garage…
          </p>
        )}

        {/* ── the garage ────────────────────────────────────────────── */}
        <section className={cn(cardCls, "mt-2")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold">My garage</h2>
              <p className="text-[11px] text-zinc-500">
                Every bike keeps its own mileage, so both sets of petrol figures are ready before you choose.
              </p>
            </div>
            {!addingBike && !editingBike && (
              <button
                type="button"
                onClick={() => setAddingBike(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-white/[0.06] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/[0.12]"
              >
                <Plus className="h-3.5 w-3.5" /> Add another bike
              </button>
            )}
          </div>

          {bikes.length === 0 && !addingBike && (
            <p className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-zinc-500">
              No bike yet. Add one and its mileage, and every ride will cost its petrol in litres.
            </p>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bikes.map((bike) =>
              editingBike?.id === bike.id ? (
                <div key={bike.id} className="rounded-2xl border border-saffron-400/40 bg-white/[0.03] p-4 sm:col-span-2 lg:col-span-3">
                  <BikeForm
                    makers={makers}
                    initial={bike}
                    busy={busy}
                    compact
                    onCancel={() => setEditingBike(null)}
                    onSubmit={(input) => void updateBike(bike.id, input)}
                  />
                </div>
              ) : (
                <GarageCard
                  key={bike.id}
                  bike={bike}
                  bikeCount={bikes.length}
                  busy={busy}
                  onEdit={() => {
                    setEditingBike(bike);
                    setAddingBike(false);
                  }}
                  onDelete={() => void removeBike(bike)}
                />
              ),
            )}
          </div>

          {addingBike && (
            <div className="mt-4 rounded-2xl border border-saffron-400/40 bg-white/[0.03] p-4">
              <BikeForm
                makers={makers}
                busy={busy}
                onCancel={() => setAddingBike(false)}
                onSubmit={(input) => void addBike(input)}
              />
            </div>
          )}
        </section>

        {/* ── ride builder ──────────────────────────────────────────── */}
        <section className={cn(cardCls, "mt-4")} id="build">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold">
                {editingRideId ? "Editing a ride" : "Plan a ride"}
              </h2>
              <p className="text-[11px] text-zinc-500">
                Drop pins on the map by hand, or paste a map link and let its stops come in.
              </p>
            </div>
            {editingRideId && (
              <button
                type="button"
                onClick={resetBuilder}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-2 text-[11px] font-semibold text-zinc-200 hover:bg-white/[0.12]"
              >
                <X className="h-3.5 w-3.5" /> Start a new ride
              </button>
            )}
          </div>

          <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
            <div className="min-w-0">
              <RideMap
                stops={stops}
                selected={selectedStop}
                onPick={dropPin}
                onSelect={(index) => {
                  setSelectedStop(index);
                  const stop = stops[index];
                  if (stop) {
                    setStopName(stop.name);
                    setStopLat(String(stop.lat));
                    setStopLng(String(stop.lng));
                  }
                }}
                height={330}
              />

              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <input
                    value={stopName}
                    onChange={(event) => setStopName(event.target.value)}
                    placeholder="Stop name"
                    aria-label="Stop name"
                    className={inputCls}
                  />
                  <input
                    value={stopLat}
                    onChange={(event) => setStopLat(event.target.value)}
                    placeholder="Latitude"
                    inputMode="decimal"
                    aria-label="Latitude"
                    className={inputCls}
                  />
                  <input
                    value={stopLng}
                    onChange={(event) => setStopLng(event.target.value)}
                    placeholder="Longitude"
                    inputMode="decimal"
                    aria-label="Longitude"
                    className={inputCls}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={addStopFromForm}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/[0.08] px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/[0.16]"
                  >
                    <MapPin className="h-3.5 w-3.5" /> Add stop
                  </button>
                  <button
                    type="button"
                    onClick={useMyLocation}
                    title="Use my current location"
                    aria-label="Use my current location"
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-saffron-300 transition-colors hover:bg-white/[0.12]"
                  >
                    <LocateFixed className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3">
                <label htmlFor="ride-link" className={labelCls}>
                  Import stops from a link
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    id="ride-link"
                    value={link}
                    onChange={(event) => setLink(event.target.value)}
                    placeholder="https://maps.app.goo.gl/… or a Google Maps directions link"
                    className={cn(inputCls, "min-w-0 flex-1")}
                  />
                  <button
                    type="button"
                    onClick={() => void importLink()}
                    disabled={linkBusy}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-saffron-400 px-4 py-2.5 text-xs font-semibold text-on-gold transition-all hover:brightness-110 active:scale-95 disabled:opacity-60"
                  >
                    {linkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                    Import
                  </button>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                  Short share links are expanded on the server first — the same resolver the site&apos;s own
                  dashboard uses. Importing replaces the stops on this ride.
                </p>
                {linkError && <p className="mt-2 text-[11px] font-medium text-amber-300">{linkError}</p>}
              </div>

              {stops.length > 0 && (
                <ol className="mt-3 grid gap-2">
                  {stops.map((stop, index) => (
                    <li
                      key={`${stop.lat},${stop.lng},${index}`}
                      className={cn(
                        "flex items-center gap-2 rounded-xl border px-3 py-2",
                        selectedStop === index
                          ? "border-saffron-400/50 bg-saffron-400/[0.07]"
                          : "border-white/[0.07] bg-white/[0.02]",
                      )}
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/[0.08] text-[10px] font-bold text-saffron-300">
                        {index + 1}
                      </span>
                      <input
                        value={stop.name}
                        aria-label={`Name of stop ${index + 1}`}
                        onChange={(event) => {
                          const next = [...stops];
                          next[index] = { ...stop, name: event.target.value };
                          setStops(next);
                        }}
                        className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-zinc-600 focus:outline-none"
                      />
                      <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                        {stop.lat.toFixed(3)}, {stop.lng.toFixed(3)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setStops(stops.filter((_, at) => at !== index));
                          setSelectedStop(null);
                        }}
                        aria-label={`Remove stop ${index + 1}`}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-zinc-500 transition-colors hover:bg-white/[0.08] hover:text-red-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {/* ── the figures ─────────────────────────────────────── */}
            <div className="grid content-start gap-3">
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                <label className={labelCls} htmlFor="ride-title">
                  Ride name
                </label>
                <input
                  id="ride-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Nangal → Leh"
                  className={cn(inputCls, "mt-2")}
                />
                <span className={cn(labelCls, "mt-3 block")}>Bike for this ride</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {bikes.length === 0 && (
                    <p className="text-[11px] text-zinc-500">Add a bike to see this ride&apos;s petrol.</p>
                  )}
                  {bikes.map((bike) => (
                    <button
                      key={bike.id}
                      type="button"
                      aria-pressed={bikeId === bike.id}
                      onClick={() => setBikeId(bike.id)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors",
                        bikeId === bike.id
                          ? "bg-saffron-400 text-on-gold"
                          : "bg-white/[0.06] text-zinc-300 hover:text-white",
                      )}
                    >
                      {bike.maker} {bike.model}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-saffron-400/25 bg-saffron-400/[0.05] p-4">
                <div className="flex items-center gap-2 text-saffron-200">
                  <Fuel className="h-4 w-4" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Petrol for this ride</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-ink-950/50 px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">One way</p>
                    <p className="font-display text-lg font-semibold text-white">{local.oneWayKm.toFixed(1)} km</p>
                    <p className="text-[11px] text-saffron-200">
                      {local.litresOneWay === null ? "add a bike" : `${local.litresOneWay.toFixed(2)} L`}
                    </p>
                  </div>
                  <div className="rounded-xl bg-ink-950/50 px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Round trip</p>
                    <p className="font-display text-lg font-semibold text-white">
                      {local.roundTripKm.toFixed(1)} km
                    </p>
                    <p className="text-[11px] text-saffron-200">
                      {local.litresRoundTrip === null ? "add a bike" : `${local.litresRoundTrip.toFixed(2)} L`}
                    </p>
                  </div>
                </div>

                <label className="mt-3 flex items-center gap-2 text-[11px] font-medium text-zinc-300">
                  <input
                    type="checkbox"
                    checked={roundTrip}
                    onChange={(event) => setRoundTrip(event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-white/25 bg-transparent accent-saffron-400"
                  />
                  This ride comes back home
                </label>

                {perBike.length > 1 && (
                  <table className="mt-3 w-full text-left text-[11px]">
                    <thead>
                      <tr className="text-zinc-500">
                        <th className="py-1 font-medium">Bike</th>
                        <th className="py-1 text-right font-medium">km/l</th>
                        <th className="py-1 text-right font-medium">1 way</th>
                        <th className="py-1 text-right font-medium">Round</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perBike.map(({ bike, maths }) => (
                        <tr
                          key={bike.id}
                          className={cn(
                            "border-t border-white/[0.06]",
                            bikeId === bike.id ? "text-white" : "text-zinc-400",
                          )}
                        >
                          <td className="py-1.5">
                            {bike.model}
                            {bike.mileageSource === "estimated" && (
                              <span className="ml-1 text-[9px] text-zinc-500">est.</span>
                            )}
                          </td>
                          <td className="py-1.5 text-right">{bike.mileageKmpl ?? "—"}</td>
                          <td className="py-1.5 text-right">{maths.litresOneWay ?? "—"} L</td>
                          <td className="py-1.5 text-right">{maths.litresRoundTrip ?? "—"} L</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {local.legs.length > 0 && (
                  <ul className="mt-3 grid gap-1 border-t border-white/[0.08] pt-2 text-[10px] text-zinc-400">
                    {local.legs.map((leg, index) => (
                      <li key={`${leg.from}-${leg.to}-${index}`} className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <RouteIcon className="h-3 w-3 shrink-0 text-zinc-600" />
                          <span className="truncate">
                            {leg.from} → {leg.to}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono">{leg.km.toFixed(1)} km</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-2xl border border-white/[0.08] bg-amber-100/[0.06] p-4">
                <label className={labelCls} htmlFor="ride-notes">
                  Notes
                </label>
                <textarea
                  id="ride-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={5}
                  placeholder="Where to stop for chai, the road to avoid, what to carry…"
                  className={cn(
                    inputCls,
                    "mt-2 resize-y border-amber-200/20 bg-amber-100/[0.06] font-urdu text-[13px] leading-loose text-amber-50/90",
                  )}
                />
                <p className="mt-1.5 text-[10px] text-amber-200/60">
                  Notes take Urdu as well as English — type either.
                </p>
              </div>

              <Gallery items={gallery} onChange={setGallery} />

              <button
                type="button"
                onClick={() => void saveRide()}
                disabled={busy || stops.length < 2}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-saffron-400 px-5 py-3 text-sm font-semibold text-on-gold shadow-lg shadow-saffron-400/25 transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {editingRideId ? "Save changes" : "Save this ride"}
              </button>
            </div>
          </div>
        </section>

        {/* ── saved rides ───────────────────────────────────────────── */}
        <section className="mt-6">
          <h2 className="font-display text-base font-semibold">My rides</h2>
          <p className="text-[11px] text-zinc-500">
            Only you can see these. Each one keeps the petrol figures for every bike in the garage.
          </p>

          {journeys.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-xs text-zinc-500">
              No rides yet. Build one above — two pins are enough to get a distance.
            </p>
          ) : (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {journeys.map((journey) => (
                <article key={journey.id} className="rounded-3xl border border-white/[0.08] bg-white/[0.02] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-sm font-semibold text-white">{journey.title}</h3>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {journey.maths.from}
                        {journey.maths.to ? ` → ${journey.maths.to}` : ""} · {journey.maths.stops} stops
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => editRide(journey)}
                        aria-label={`Edit ${journey.title}`}
                        className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-zinc-300 transition-colors hover:bg-white/[0.12] hover:text-white"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeRide(journey)}
                        aria-label={`Delete ${journey.title}`}
                        className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 transition-colors hover:bg-white/[0.08] hover:text-red-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-zinc-300">
                      {journey.maths.oneWayKm.toFixed(1)} km one way
                    </span>
                    <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-zinc-300">
                      {journey.maths.roundTripKm.toFixed(1)} km round trip
                    </span>
                    {journey.roundTrip && (
                      <span className="rounded-full bg-saffron-400/15 px-2.5 py-1 text-saffron-200">returns home</span>
                    )}
                  </div>

                  <table className="mt-3 w-full text-left text-[11px]">
                    <thead>
                      <tr className="text-zinc-500">
                        <th className="py-1 font-medium">Petrol by bike</th>
                        <th className="py-1 text-right font-medium">1 way</th>
                        <th className="py-1 text-right font-medium">Round</th>
                      </tr>
                    </thead>
                    <tbody>
                      {journey.perBike.length === 0 && (
                        <tr>
                          <td className="py-1.5 text-zinc-500" colSpan={3}>
                            No bike chosen for this ride.
                          </td>
                        </tr>
                      )}
                      {journey.perBike.map((row) => (
                        <tr
                          key={row.bikeId}
                          className={cn(
                            "border-t border-white/[0.06]",
                            row.bikeId === journey.bikeId ? "text-white" : "text-zinc-400",
                          )}
                        >
                          <td className="py-1.5">
                            {row.maker} {row.model}
                            <span className="ml-1 text-[9px] text-zinc-500">{row.kmpl ?? "—"} km/l</span>
                          </td>
                          <td className="py-1.5 text-right">{row.litresOneWay ?? "—"} L</td>
                          <td className="py-1.5 text-right">{row.litresRoundTrip ?? "—"} L</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {journey.notes && (
                    <p className="mt-3 whitespace-pre-wrap rounded-xl border border-amber-200/15 bg-amber-100/[0.05] px-3 py-2.5 text-[12px] leading-relaxed text-amber-50/85">
                      {journey.notes}
                    </p>
                  )}

                  {journey.gallery.length > 0 && (
                    <div className="mt-3 grid grid-cols-4 gap-1.5">
                      {journey.gallery.slice(0, 8).map((item, index) => (
                        <img
                          key={`${journey.id}-${index}`}
                          src={item.url}
                          alt={item.caption || `${journey.title} photo ${index + 1}`}
                          className="h-16 w-full rounded-lg object-cover"
                        />
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
