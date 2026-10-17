import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  MapPinned,
  Plus,
  Route as RouteIcon,
  Trash2,
} from "lucide-react";
import type { LiveStop } from "../store/siteContent";
import { fetchRoadGeometry, type LatLng } from "../utils/routing";

/**
 * Editor for the live tracker's route.
 *
 * Stops carry real coordinates rather than percentages, because the tracker now
 * draws the road on a map. The road geometry itself comes from the routing
 * service and is fetched here, in the dashboard, then stored with the content —
 * visitors render the stored coordinates and never call a third party.
 *
 * The fetch is best-effort: if the service is unreachable the previous geometry
 * is kept and the tracker falls back to straight segments between the stops.
 */

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-saffron-400/60 focus:outline-none transition-colors";
const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500";

const STATUSES: LiveStop["status"][] = ["done", "live", "next"];

const STATUS_COPY: Record<LiveStop["status"], string> = {
  done: "Ridden",
  live: "Here now",
  next: "Still to come",
};

export default function RouteStopsEditor({
  stops,
  routeGeometry,
  onChange,
  onGeometryChange,
}: {
  stops: LiveStop[];
  routeGeometry: LatLng[];
  onChange: (stops: LiveStop[]) => void;
  onGeometryChange: (geometry: LatLng[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const patch = (index: number, part: Partial<LiveStop>) =>
    onChange(stops.map((stop, i) => (i === index ? { ...stop, ...part } : stop)));

  const move = (index: number, delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= stops.length) return;
    const reordered = [...stops];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    onChange(reordered);
  };

  const add = () => {
    const last = stops[stops.length - 1];
    onChange([
      ...stops,
      {
        name: "New stop",
        note: "",
        status: "next",
        lat: last ? last.lat : 32.2,
        lng: last ? last.lng : 78.0,
      },
    ]);
  };

  const fetchRoute = async () => {
    setBusy(true);
    setMessage(null);
    const result = await fetchRoadGeometry(stops);
    setBusy(false);
    setMessage({ ok: result.ok, text: result.message });
    if (result.ok) onGeometryChange(result.geometry);
  };

  return (
    <div className="grid gap-3">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="flex items-center gap-2 text-xs font-bold text-white">
          <RouteIcon className="h-4 w-4 text-saffron-300" />
          Road route
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
          {routeGeometry.length
            ? `${routeGeometry.length} points of real road stored. Refetch after moving a stop so the line follows the road again.`
            : "No road geometry yet — the tracker is drawing straight lines between the stops. Fetch the road to follow the actual route."}
        </p>
        <button
          type="button"
          onClick={fetchRoute}
          disabled={busy || stops.length < 2}
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-saffron-400 px-4 py-2 text-xs font-bold text-on-gold transition-all duration-300 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPinned className="h-3.5 w-3.5" />}
          {routeGeometry.length ? "Refetch road route" : "Fetch road route"}
        </button>
        {message && (
          <p
            className={`mt-2.5 text-[11px] font-semibold ${message.ok ? "text-emerald-300" : "text-red-400"}`}
            role="status"
          >
            {message.text}
          </p>
        )}
      </div>

      {stops.map((stop, index) => (
        <div key={`${stop.name}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
              Stop {index + 1} · {STATUS_COPY[stop.status] ?? stop.status}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Move ${stop.name} earlier`}
                className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-30"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === stops.length - 1}
                aria-label={`Move ${stop.name} later`}
                className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-30"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onChange(stops.filter((_, i) => i !== index))}
                aria-label={`Remove ${stop.name}`}
                className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 transition-colors hover:bg-red-500/20 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor={`stop-name-${index}`}>
                Name
              </label>
              <input
                id={`stop-name-${index}`}
                className={inputCls}
                value={stop.name}
                onChange={(e) => patch(index, { name: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor={`stop-status-${index}`}>
                Status
              </label>
              <select
                id={`stop-status-${index}`}
                className={inputCls}
                value={stop.status}
                onChange={(e) => patch(index, { status: e.target.value as LiveStop["status"] })}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status} className="bg-ink-950">
                    {STATUS_COPY[status]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor={`stop-lat-${index}`}>
                Latitude
              </label>
              <input
                id={`stop-lat-${index}`}
                type="number"
                step="0.0001"
                className={inputCls}
                value={stop.lat}
                onChange={(e) => patch(index, { lat: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor={`stop-lng-${index}`}>
                Longitude
              </label>
              <input
                id={`stop-lng-${index}`}
                type="number"
                step="0.0001"
                className={inputCls}
                value={stop.lng}
                onChange={(e) => patch(index, { lng: Number(e.target.value) })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor={`stop-note-${index}`}>
                Note
              </label>
              <input
                id={`stop-note-${index}`}
                className={inputCls}
                value={stop.note}
                onChange={(e) => patch(index, { note: e.target.value })}
              />
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 py-3 text-xs font-semibold text-zinc-400 transition-colors hover:border-saffron-400/50 hover:text-white"
      >
        <Plus className="h-3.5 w-3.5" /> Add stop
      </button>
    </div>
  );
}
