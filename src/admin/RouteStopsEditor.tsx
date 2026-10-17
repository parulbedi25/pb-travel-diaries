import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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
 * Stops are placed by clicking the map, the way pointers are placed on the
 * rider image — drag a marker to move it. The order they were added in is the
 * order of the journey: the first is the start, the last is the destination,
 * and the tracker draws them green and red respectively.
 *
 * The road itself comes from the routing service, fetched here in the
 * dashboard and stored with the content, so visitors render stored coordinates
 * and never depend on a third party being reachable. Failing to fetch is not
 * fatal: the tracker falls back to straight segments between the stops.
 */

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-saffron-400/60 focus:outline-none transition-colors";
const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500";

const TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const STATUSES: LiveStop["status"][] = ["done", "live", "next"];

const STATUS_COPY: Record<LiveStop["status"], string> = {
  done: "Ridden",
  live: "Here now",
  next: "Still to come",
};

const ROLE_COPY = { start: "Start", end: "Destination", mid: "On the way" } as const;

type Role = keyof typeof ROLE_COPY;

const roleOf = (index: number, total: number): Role =>
  index === 0 ? "start" : index === total - 1 ? "end" : "mid";

const round = (n: number) => Math.round(n * 1e4) / 1e4;

/** A numbered pin: green at the start, red at the destination, gold between. */
function stopIcon(index: number, role: Role): L.DivIcon {
  return L.divIcon({
    className: "route-stop-marker",
    html: `<span class="route-stop-dot route-stop-dot--${role}">${index + 1}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const stopsRef = useRef(stops);
  const draggingRef = useRef(false);
  const fittedRef = useRef<string | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    stopsRef.current = stops;
  }, [stops]);

  const patch = useCallback(
    (index: number, part: Partial<LiveStop>) =>
      onChange(stopsRef.current.map((stop, i) => (i === index ? { ...stop, ...part } : stop))),
    [onChange],
  );

  const addStop = useCallback(
    (lat: number, lng: number) => {
      const current = stopsRef.current;
      onChange([
        ...current,
        { name: `Stop ${current.length + 1}`, note: "", status: "next", lat: round(lat), lng: round(lng) },
      ]);
    },
    [onChange],
  );

  // The map is built once; markers are redrawn whenever the stops change.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let map: L.Map | null = null;
    try {
      map = L.map(host, {
        zoomControl: true,
        attributionControl: false,
        scrollWheelZoom: false,
      }).setView([31.6, 77.4], 6);
      L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      map.on("click", (event) => {
        const { lat, lng } = (event as L.LeafletMouseEvent).latlng;
        addStop(lat, lng);
      });
    } catch {
      mapRef.current = null;
      layerRef.current = null;
      setMapFailed(true);
    }
    return () => {
      try {
        map?.remove();
      } catch {
        // Nothing to tear down if Leaflet never started.
      }
      mapRef.current = null;
      layerRef.current = null;
      fittedRef.current = null;
    };
  }, [addStop]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    // Rebuilding mid-drag would yank the marker out from under the cursor.
    if (draggingRef.current) return;

    layer.clearLayers();
    stops.forEach((stop, index) => {
      const role = roleOf(index, stops.length);
      const marker = L.marker([stop.lat, stop.lng], {
        icon: stopIcon(index, role),
        draggable: true,
        keyboard: false,
        title: `${index + 1}. ${stop.name}`,
      });
      marker.on("dragstart", () => {
        draggingRef.current = true;
      });
      marker.on("dragend", () => {
        const position = marker.getLatLng();
        draggingRef.current = false;
        patch(index, { lat: round(position.lat), lng: round(position.lng) });
      });
      marker.addTo(layer);
    });

    // Only re-fit when the coordinates actually change, so typing a name or
    // changing a status does not throw away where the editor was looking.
    const key = JSON.stringify(stops.map((s) => [s.lat, s.lng]));
    if (fittedRef.current === key) return;
    fittedRef.current = key;
    if (stops.length > 1) {
      map.fitBounds(L.latLngBounds(stops.map((s) => [s.lat, s.lng])), {
        padding: [44, 44],
        maxZoom: 13,
      });
    } else if (stops.length === 1) {
      map.setView([stops[0].lat, stops[0].lng], Math.max(map.getZoom(), 9));
    }
  }, [stops, patch]);

  const move = (index: number, delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= stops.length) return;
    const reordered = [...stops];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    onChange(reordered);
  };

  const addAtCentre = () => {
    const map = mapRef.current;
    const centre = map ? map.getCenter() : { lat: 31.6, lng: 77.4 };
    addStop(centre.lat, centre.lng);
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
      {/* ── Place the stops ── */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <p className="flex items-center gap-2 text-xs font-bold text-white">
            <MapPinned className="h-4 w-4 text-saffron-300" />
            Place the stops
          </p>
          <span className="text-[10px] text-zinc-500">{stops.length} stop{stops.length === 1 ? "" : "s"}</span>
        </div>
        {mapFailed ? (
          <p className="px-4 pb-4 text-[11px] leading-relaxed text-amber-300">
            The map could not start here. You can still add and edit stops by their coordinates below.
          </p>
        ) : (
          <>
            <div ref={hostRef} className="route-stop-map h-64 w-full" />
            <p className="px-4 pb-3 pt-2 text-[11px] leading-relaxed text-zinc-400">
              Click the map to drop a stop. Drag a marker to move it. The first stop is the start
              (green), the last is the destination (red).
            </p>
          </>
        )}
      </div>

      {/* ── Road route ── */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="flex items-center gap-2 text-xs font-bold text-white">
          <RouteIcon className="h-4 w-4 text-saffron-300" />
          Road route
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
          {routeGeometry.length
            ? `${routeGeometry.length} points of real road stored. Refetch after moving a stop so the line follows the road again.`
            : "No road geometry yet — the tracker draws straight lines between the stops. Fetch the road to follow the actual route."}
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

      {/* ── Edit each stop ── */}
      {stops.map((stop, index) => {
        const role = roleOf(index, stops.length);
        return (
          <div key={`${stop.name}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                <span
                  className={`grid h-4 w-4 place-items-center rounded-full text-[9px] text-ink-950 ${
                    role === "start" ? "bg-emerald-500" : role === "end" ? "bg-red-500" : "bg-saffron-400"
                  }`}
                >
                  {index + 1}
                </span>
                {ROLE_COPY[role]} · {STATUS_COPY[stop.status] ?? stop.status}
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
        );
      })}

      <button
        type="button"
        onClick={addAtCentre}
        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 py-3 text-xs font-semibold text-zinc-400 transition-colors hover:border-saffron-400/50 hover:text-white"
      >
        <Plus className="h-3.5 w-3.5" /> Add stop
      </button>

      <p className="text-[9px] text-zinc-500">Map data © OpenStreetMap contributors © CARTO</p>
    </div>
  );
}
