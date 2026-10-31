import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Satellite } from "lucide-react";
import type { LiveStop } from "../store/siteContent";
import type { LiveStatus } from "../hooks/useLiveLocation";
import { cn } from "../utils/cn";
import VectorBasemap from "./VectorBasemap";
import { cumulativeKm, formatKm } from "../utils/routeProgress";
import { splitRouteAtKm, splitRouteAtProgress, type LatLng } from "../utils/routing";
import { useRoadGeometry } from "../hooks/useRoadGeometry";
import { fitRouteToBand, routeFramePoints } from "../utils/routeFrame";
import { useRouteWeather } from "../hooks/useRouteWeather";
import { useWeatherDetails } from "../hooks/useWeatherDetails";
import { WeatherBadge } from "./WeatherBadge";
import { WeatherBubble, WeatherCardAt } from "./WeatherBubble";
import { kmMarksAlong } from "../utils/routeBubbles";

/** The smallest band the drawn route is allowed to have, in pixels. */
const MIN_BAND = 140;

/**
 * The live tracker's map.
 *
 * The map underneath is OpenStreetMap, drawn from tiles at a centre and zoom
 * we choose ourselves. That is what makes it possible to draw on top of it: we
 * know exactly how the map is projected (see utils/mercator.ts), so the
 * checkpoints and the line sit on the streets they belong to.
 *
 * The line is ours, not the map's: solid yellow over what is ridden, dashed
 * yellow marching towards the destination over what is still to come. It
 * follows the real road — the one stored in the dashboard if that has been
 * fetched, otherwise the one asked for here — and only falls back to straight
 * segments between the checkpoints when no road can be had at all.
 *
 * Everything drawn sits inside the band between the live badge across the top
 * of the panel and the route strip along the bottom, so no checkpoint is ever
 * hidden behind either.
 */

export interface TrackerMapProps {
  stops: LiveStop[];
  /** Road fetched in the dashboard; drawn instead of straight segments. */
  routeGeometry: LatLng[];
  live: { lat: number; lng: number };
  liveName: string;
  liveState: string;
  status: LiveStatus;
  /** "Ping 2m ago" / "Window closed · 6 AM IST" — shown on the strip. */
  pingLabel: string;
  /**
   * Draw each stop's name under its checkpoint.
   *
   * On by default, and the name is the one the rider typed into the dashboard —
   * Nangal, Anandpur Sahib, Ropar — never a name the basemap happens to have
   * for that ground. Those basemap names stay switched off (see VectorBasemap):
   * the map carries the rider's own checkpoints, and nothing else.
   */
  labels?: boolean;
  /**
   * The road already resolved by the panel around this map. Passing it in
   * keeps the drawing and the distance figures on the same geometry instead of
   * each asking the routing service for its own copy.
   */
  geometry?: LatLng[];
  /** Draw the current weather at each checkpoint. On unless told otherwise. */
  weather?: boolean;
  /**
   * How far down the panel the plate across the top reaches, in pixels.
   *
   * Measured by whoever draws that plate rather than guessed at here: the route
   * should start just under it, and a constant that is even slightly too big
   * leaves the visible gap this was reported for. The strip along the bottom is
   * measured here, because it belongs to this component.
   */
  topInset?: number;
  /**
   * The routing service's own length for the road, when the dashboard measured
   * it. The drawn line is simplified, so summing it reads a little short; this
   * is the number the legs are scaled to.
   */
  routeDistanceKm?: number;
  /**
   * The checkpoint whose weather is being read below the map.
   *
   * Selecting a pin is how the panel beside this one is told whose forecast to
   * lift to the top of its list, so the pin that is chosen has to look chosen.
   */
  selectedIndex?: number | null;
  /** A checkpoint was tapped — pin, name or the weather over it. */
  onSelectStop?: (index: number) => void;
  /**
   * Kilometres along the road where the rider actually is.
   *
   * The line used to be split at the stop marked "here now", which moves in
   * whole stops: ride three-quarters of the way to the next town and the map
   * still coloured the road ahead of you as ridden. Given the distance the
   * standing measured from the fix, the yellow ends under the pointer instead.
   */
  travelKm?: number;
  /**
   * The position is the phone's own fix rather than a stop, so the pin and its
   * radar rings are drawn there instead of on the nearest checkpoint.
   */
  liveIsFix?: boolean;
  /** The radius that makes a stop "here now", drawn as a faint ring. */
  arriveKm?: number;
}

/**
 * North is up, and says so.
 *
 * The map is drawn north-up on purpose — the bearing is pinned to 0 so the
 * overlay's mercator placement and MapLibre's drawing can never disagree — so
 * this is not a control but a statement: a compass rose with a saffron north
 * needle, a muted south one and the cardinal ticks. It sits in the top-right
 * of the map panel, under the tile credit, where a compass belongs and where
 * it collides with nothing: the live plate owns the top-left, the route strip
 * owns the bottom.
 */
function MapCompass() {
  return (
    <div
      className="pointer-events-none absolute right-4 top-8 z-10 sm:right-5 sm:top-9"
      role="img"
      aria-label="Compass: north is up"
    >
      <div className="rounded-full border border-white/15 bg-ink-950/70 shadow-lg shadow-black/40 backdrop-blur-md">
        <svg viewBox="0 0 44 44" className="h-11 w-11" aria-hidden="true">
          {/* The ring, and a dotted inner line so it reads as an instrument. */}
          <circle cx="22" cy="22" r="21" fill="none" stroke="rgba(255,255,255,0.16)" />
          <circle
            cx="22"
            cy="22"
            r="16.5"
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeDasharray="1 3"
          />
          {/* The four cardinal ticks. */}
          <g stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" strokeLinecap="round">
            <line x1="22" y1="2.5" x2="22" y2="5" />
            <line x1="22" y1="39" x2="22" y2="41.5" />
            <line x1="2.5" y1="22" x2="5" y2="22" />
            <line x1="39" y1="22" x2="41.5" y2="22" />
          </g>
          {/* Needle: saffron for north, muted steel for south. */}
          <polygon points="22,12 25,22.5 19,22.5" fill="#f5b301" />
          <polygon points="22,32 19,22.5 25,22.5" fill="rgba(255,255,255,0.40)" />
          <text
            x="22"
            y="10"
            textAnchor="middle"
            fontSize="6.5"
            fontWeight="700"
            fill="#ffdf8a"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            N
          </text>
        </svg>
      </div>
    </div>
  );
}

export default function TrackerMap({
  stops,
  routeGeometry,
  live,
  liveName,
  liveState,
  status,
  pingLabel,
  labels = true,
  geometry: givenGeometry,
  weather = true,
  routeDistanceKm = 0,
  topInset,
  selectedIndex = null,
  onSelectStop,
  travelKm,
  liveIsFix = false,
  arriveKm = 2,
}: TrackerMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  /** The route strip along the bottom — measured, so the route stops just above it. */
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  /** Which checkpoint's temperature is open, by index. */
  const [openStop, setOpenStop] = useState<number | null>(null);

  // The overlay has to match the map pixel for pixel, so the panel is measured
  // rather than assumed.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = (w?: number, h?: number) => {
      const width = w ?? host.clientWidth;
      const height = h ?? host.clientHeight;
      if (width > 0 && height > 0) setSize({ width, height });
    };
    measure();
    const observer = new ResizeObserver((entries) => {
      const rect = entries?.[0]?.contentRect;
      if (rect?.width && rect?.height) measure(rect.width, rect.height);
      else measure();
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const width = size.width || 600;
  const height = size.height || 400;
  // The strip along the bottom is this component's own furniture, so it is
  // measured here; the plate at the top is measured by the card that draws it
  // and arrives as `topInset`.
  const [stripInset, setStripInset] = useState(152);
  useEffect(() => {
    const host = hostRef.current;
    const strip = stripRef.current;
    if (!host || !strip) return;
    const measure = () => {
      const gap = Math.round(host.getBoundingClientRect().bottom - strip.getBoundingClientRect().top) + 8;
      if (gap > 40) setStripInset(gap);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [stops.length]);

  const insets = {
    top: Math.max(56, topInset ?? 92),
    bottom: stripInset,
  };

  const road = useRoadGeometry(stops, routeGeometry);
  const geometry = useMemo(
    () =>
      givenGeometry && givenGeometry.length >= 2
        ? givenGeometry
        : routeGeometry.length >= 2
          ? routeGeometry
          : road && road.geometry.length >= 2
            ? road.geometry
            : stops.map((s) => [s.lat, s.lng] as LatLng),
    [givenGeometry, routeGeometry, road, stops],
  );
  // Weather at every checkpoint, in one request for the whole route.
  const conditions = useRouteWeather(weather ? stops : []);

  // What has to stay in view: every checkpoint, the road between them, and
  // wherever PB is — but only when that fix belongs to this ride. Leaving the
  // road out of the fit is what let a looping route (Srinagar → Leh → Manali)
  // run off the edge of the panel while its stops sat comfortably inside.
  const frame = useMemo(
    () => routeFramePoints(stops, geometry, live),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stops, geometry, live.lat, live.lng],
  );

  // Fit into the band only, then slide the drawing down into it — inside the
  // same helper, so the zoom that fits and the projection that draws can never
  // disagree about where the band is. The map still fills the whole panel
  // behind the badge and the strip; only the drawing on top of it moves.
  //
  // The exact zoom, not a whole level: these tiles are ours, so the route can
  // be made to fill the band edge to edge rather than landing on whatever
  // fraction of it a rounded-down zoom happens to give. The pad leaves room for
  // the pin, its weather badge and the name plate hanging under it.
  const { view, projector } = useMemo(
    // padY is the temp badge above a pin and the name plate below it: enough
    // for both, and no more, so the top checkpoint sits just under the LIVE
    // plate and the bottom one just above the route strip.
    () => fitRouteToBand(frame, width, height, insets, { padX: 34, padY: 26, minBand: MIN_BAND }),
    [frame, width, height, insets.top, insets.bottom],
  );
  // The map is centred on whatever our overlay puts at the middle of the
  // panel, which is not the middle of the band.
  const mapCentre = projector.toLatLng(50, 50);
  // Re-centring fetches a fresh set of tiles, so wait for the view to settle
  // rather than pulling new ones on every step of a resize.
  const [mapView, setMapView] = useState(() => ({
    lat: mapCentre.lat,
    lng: mapCentre.lng,
    zoom: view.zoom,
  }));
  useEffect(() => {
    const timer = window.setTimeout(
      () => setMapView({ lat: mapCentre.lat, lng: mapCentre.lng, zoom: view.zoom }),
      500,
    );
    return () => window.clearTimeout(timer);
  }, [mapCentre.lat, mapCentre.lng, view.zoom]);

  // Measured along the same line that is drawn, so the strip and the map
  // cannot disagree about how long the ride is.
  const totals = useMemo(
    () => cumulativeKm(stops, geometry, { totalKm: routeDistanceKm }),
    [stops, geometry, routeDistanceKm],
  );
  const routeKm = totals[totals.length - 1] ?? 0;

  // A weather bubble every hundred kilometres of road, each with the forecast
  // for the place it stands on — one request for the lot.
  const marks = useMemo(
    () => (weather && stops.length > 0 ? kmMarksAlong(geometry, routeKm) : []),
    [weather, stops.length, geometry, routeKm],
  );
  const markWeather = useWeatherDetails(marks);
  // The same forecast, point by point, for the temperatures over each
  // checkpoint: one request for the route, cached for a quarter of an hour, so
  // tapping a temperature opens a card that is already filled in.
  const stopWeather = useWeatherDetails(weather ? stops : []);


  // A tapped temperature closes when the tap lands anywhere else on the panel.
  useEffect(() => {
    if (openStop === null) return;
    const onPointerDown = (event: PointerEvent | MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-weather-card]") || target?.closest?.("[data-weather-temp]")) return;
      setOpenStop(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [openStop]);

  const toPx = useCallback(
    (point: LatLng) => {
      const projected = projector.toXY({ lat: point[0], lng: point[1] });
      return { x: (projected.x / 100) * width, y: (projected.y / 100) * height };
    },
    [projector, width, height],
  );
  const toPct = useCallback(
    (point: { lat: number; lng: number }) => projector.toXY(point),
    [projector],
  );

  // A pill of icon + degrees is about forty pixels wide, and a hundred
  // kilometres of a two-thousand-kilometre ride is not: on a phone the whole
  // route can be ninety pixels tall, so every bubble would land on its
  // neighbour and the row would read as a smear. Bubbles are placed in order
  // and one that would sit on top of one already placed is left out — the
  // forecast for that stretch is still in the card of the bubble beside it,
  // and nothing overlaps at any screen size.
  const bubbleSpots = useMemo(() => {
    const gap = 40;
    const kept: { mark: (typeof marks)[number]; x: number; y: number }[] = [];
    for (const mark of marks) {
      const point = toPx([mark.lat, mark.lng]);
      if (kept.some((seen) => Math.hypot(seen.x - point.x, seen.y - point.y) < gap)) continue;
      kept.push({ mark, x: point.x, y: point.y });
    }
    return kept;
  }, [marks, toPx]);

  // Split at the rider when the caller knows where that is, at the checkpoint
  // otherwise — an older page, or a route nobody has ridden yet.
  const { covered, remaining } = useMemo(
    () =>
      typeof travelKm === "number" && Number.isFinite(travelKm)
        ? splitRouteAtKm(geometry, travelKm)
        : splitRouteAtProgress(geometry, stops),
    [geometry, stops, travelKm],
  );
  const toPath = (points: LatLng[]) =>
    points.length
      ? points
          .map((point, index) => {
            const p = toPx(point);
            return `${index === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
          })
          .join(" ")
      : "";
  const coveredPath = toPath(covered);
  const remainingPath = toPath(remaining);

  // Names hanging under checkpoints that sit almost on top of each other — the
  // three Srinagar stops on a 2,000 km route — would be drawn in the same place
  // and read as a smear. Each name that lands within a label's width of one
  // already placed drops a line lower. The pins stay where they belong; only
  // the plate under them moves.
  const labelRows = useMemo(() => {
    const placed = stops.map((stop) => projector.toXY(stop));
    const rows: number[] = [];
    for (let i = 0; i < placed.length; i += 1) {
      let row = 0;
      for (let j = 0; j < i; j += 1) {
        if (rows[j] !== row) continue;
        const dx = ((placed[i].x - placed[j].x) / 100) * width;
        const dy = ((placed[i].y - placed[j].y) / 100) * height;
        if (Math.hypot(dx, dy) < 34) row += 1;
      }
      rows.push(row);
    }
    return rows;
  }, [stops, projector, width, height]);

  const count = stops.length;
  const liveIndex = stops.findIndex((stop) => stop.status === "live");
  const lastDone = stops.reduce((acc, stop, i) => (stop.status === "done" ? i : acc), -1);
  const progressIndex = liveIndex >= 0 ? liveIndex : lastDone >= 0 ? lastDone : 0;
  // The thin line above the strip follows the same kilometre the road does:
  // part-ridden legs are part-ridden there too, not all-or-nothing per stop.
  const progressPct =
    typeof travelKm === "number" && Number.isFinite(travelKm) && routeKm > 0
      ? Math.min(100, Math.max(0, (travelKm / routeKm) * 100))
      : count > 1
        ? (progressIndex / (count - 1)) * 100
        : 0;
  const edge = count > 0 ? 50 / count : 0;

  // Where the pointer goes. With a phone fix that is the fix itself — the pin
  // should be where the bike is, not at the town it left an hour ago. A
  // checkpoint marked "here now" is the fallback, and it is what the radar, the
  // pin and the label all sit on so they agree with each other.
  const liveHere = liveIndex >= 0 && !liveIsFix ? stops[liveIndex] : live;
  const liveLabel =
    liveIsFix || liveIndex < 0 ? `${liveName}, ${liveState}` : stops[liveIndex].name;
  const livePoint = toPct(liveHere);

  return (
    <div ref={hostRef} className="absolute inset-0">
      {/* The map: OpenStreetMap with no place names on it, pointer-dead so
          the overlay stays true. */}
      <div className="tracker-map map-paper absolute inset-0 overflow-hidden">
        {count > 0 ? (
          <VectorBasemap
            view={mapView}
            width={width}
            height={height}
            className="absolute inset-0"
          />
        ) : (
          <div className="grid h-full w-full place-items-center px-6 text-center text-xs text-zinc-500">
            Add at least one stop in the dashboard and this panel becomes a live map of the route.
          </div>
        )}
      </div>

      {/* A soft edge top and bottom so the overlay plates stay readable. */}
      <div className="tracker-map-veil pointer-events-none absolute inset-0" aria-hidden="true" />

      {count > 0 && <MapCompass />}


      {/* PB's route: covered solid, still to come dashed and marching on. */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
      >
        {/* A dark casing under both halves, so the yellow reads on a light map. */}
        {remainingPath && (
          <path
            d={remainingPath}
            fill="none"
            stroke="rgba(9,9,9,0.5)"
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray="9 7"
          />
        )}
        {coveredPath && (
          <path d={coveredPath} fill="none" stroke="rgba(9,9,9,0.5)" strokeWidth={6} strokeLinecap="round" />
        )}
        {remainingPath && (
          <path
            d={remainingPath}
            fill="none"
            stroke="#f5b301"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray="9 7"
            className="animate-route-dash"
          />
        )}
        {coveredPath && (
          <path d={coveredPath} fill="none" stroke="#f5b301" strokeWidth={3.5} strokeLinecap="round" />
        )}
      </svg>

      {/* A weather bubble every hundred kilometres, each one opening into the
          forecast for its own stretch of road. */}
      {bubbleSpots.map((spot) => (
        <WeatherBubble
          key={`km-${spot.mark.km}`}
          mark={spot.mark}
          detail={markWeather?.[marks.indexOf(spot.mark)] ?? null}
          x={spot.x}
          y={spot.y}
          width={width}
          height={height}
        />
      ))}

      {/* Radar rings on wherever PB actually is. */}
      {(liveIndex >= 0 || liveIsFix) && (
        <>
          <div
            className="shrink-0 aspect-square pointer-events-none absolute h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.05]"
            style={{ left: `${livePoint.x}%`, top: `${livePoint.y}%` }}
            aria-hidden="true"
          />
          <div
            className="shrink-0 aspect-square pointer-events-none absolute h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.06]"
            style={{ left: `${livePoint.x}%`, top: `${livePoint.y}%` }}
            aria-hidden="true"
          />
          <div
            className="shrink-0 aspect-square pointer-events-none absolute h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.08]"
            style={{ left: `${livePoint.x}%`, top: `${livePoint.y}%` }}
            aria-hidden="true"
          />
        </>
      )}

      {/* The ring that decides the status: inside it a stop is "here now",
          outside it the stop behind is "ridden". Drawn faintly around the
          checkpoint being entered, so the rule the tracker follows is visible
          rather than only described. */}
      {liveIndex >= 0 && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-300/35 bg-emerald-400/[0.05]"
          style={{
            left: `${toPct(stops[liveIndex]).x}%`,
            top: `${toPct(stops[liveIndex]).y}%`,
            width: Math.max(46, Math.min(150, arriveKm * 22)),
            height: Math.max(46, Math.min(150, arriveKm * 22)),
          }}
          aria-hidden="true"
        />
      )}

      {/* The checkpoints. */}
      {stops.map((stop, index) => {
        const point = toPct(stop);
        const isStart = index === 0;
        const isEnd = index === count - 1;
        const isLive = stop.status === "live";
        return (
          <div
            key={`${stop.name}-${index}`}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
          >
            <div className="group relative grid place-items-center">
              {isLive && status === "live" && (
                <>
                  <span className="shrink-0 aspect-square absolute h-10 w-10 rounded-full bg-saffron-400/40 animate-radar" aria-hidden="true" />
                  <span className="shrink-0 aspect-square absolute h-6 w-6 rounded-full bg-saffron-400/30 animate-ping" aria-hidden="true" />
                </>
              )}
              <button
                type="button"
                title={`${isStart ? "Start" : isEnd ? "Destination" : "Checkpoint"} · ${stop.name}${
                  stop.note ? ` — ${stop.note}` : ""
                }`}
                aria-label={
                  isLive
                    ? `PB's location: ${liveLabel}`
                    : `Weather at ${stop.name}: bring it to the top of the list`
                }
                aria-pressed={selectedIndex === index}
                onClick={() => onSelectStop?.(index)}
                className={cn(
                  "relative grid place-items-center rounded-full border-2 border-white shadow-lg ring-1 ring-black/50 transition-transform duration-200 hover:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron-300",
                  isStart
                    ? "h-5 w-5 bg-emerald-500 shadow-emerald-500/50"
                    : isEnd
                      ? "h-5 w-5 bg-red-500 shadow-red-500/50"
                      : isLive
                        ? "h-5 w-5 bg-saffron-400 shadow-saffron-400/50"
                        : stop.status === "done"
                          ? "h-4 w-4 bg-ridden"
                          : "h-4 w-4 bg-saffron-400",
                  // The chosen checkpoint wears a ring of light, so the pin and
                  // the row at the top of the list below are visibly the same
                  // place.
                  selectedIndex === index
                    ? "scale-125 shadow-[0_0_0_3px_rgba(245,179,1,0.45),0_0_22px_rgba(245,179,1,0.55)]"
                    : "",
                )}
              >
                {stop.status === "done" && !isStart && !isEnd ? (
                  <Check className="h-2.5 w-2.5 text-ridden-tick" aria-hidden="true" />
                ) : (
                  !isLive && <span className="shrink-0 aspect-square h-1.5 w-1.5 rounded-full bg-white" />
                )}
                {isLive && <span className="shrink-0 aspect-square h-1.5 w-1.5 rounded-full bg-white animate-blink" />}
              </button>
              {weather && conditions?.[index] && (
                // Above the pin, centred on it — the name hangs below, the
                // temperature sits on top, and the two never argue for the
                // same pixels. Tapping it opens that place's forecast.
                <span className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2">
                  {stopWeather?.[index] ? (
                    <button
                      type="button"
                      data-weather-temp=""
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectStop?.(index);
                        setOpenStop((current) => (current === index ? null : index));
                      }}
                      aria-expanded={openStop === index}
                      aria-label={`Weather at ${stop.name}: open the next three hours and the coming week`}
                      className={cn(
                        "block rounded-full transition-transform duration-200 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron-400/70",
                        openStop === index ? "scale-110" : "",
                      )}
                    >
                      <WeatherBadge conditions={conditions[index]} compact />
                    </button>
                  ) : (
                    <WeatherBadge conditions={conditions[index]} compact />
                  )}
                </span>
              )}
              {labels && (
                <span
                  style={{ top: `${24 + (labelRows[index] ?? 0) * 13}px` }}
                  className={cn(
                    "map-label absolute max-w-[9rem] truncate whitespace-nowrap text-[10px] font-bold uppercase tracking-wide",
                    isStart
                      ? "text-start-label"
                      : isEnd
                        ? "text-end-label"
                        : isLive
                          ? "text-live-label"
                          : "text-map-label",
                  )}
                >
                  {stop.name}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* The forecast for a tapped checkpoint, placed so it stays inside the
          panel whichever edge the pin sits against. */}
      {openStop !== null && stops[openStop] && stopWeather?.[openStop] ? (
        <WeatherCardAt
          eyebrow={`${
            openStop === 0 ? "Start" : openStop === count - 1 ? "Destination" : "Checkpoint"
          } · ${formatKm(totals[openStop] ?? 0)}`}
          title={stops[openStop].name}
          subtitle={stopWeather[openStop]!.now.label}
          detail={stopWeather[openStop]!}
          x={toPx([stops[openStop].lat, stops[openStop].lng]).x}
          y={toPx([stops[openStop].lat, stops[openStop].lng]).y}
          width={width}
          height={height}
          onClose={() => setOpenStop(null)}
        />
      ) : null}

      {count > 0 && (
        <div
          ref={stripRef}
          className="absolute inset-x-0 bottom-[3.75rem] px-4 sm:bottom-[4.5rem] sm:px-5"
        >
          <div className="rounded-2xl border border-white/10 bg-ink-950/85 px-3 py-2.5 shadow-xl shadow-black/40 backdrop-blur-xl sm:px-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                Route · {count} stop{count === 1 ? "" : "s"} ·{" "}
                {formatKm(totals[totals.length - 1] ?? 0)}
              </p>
              <div className="flex items-center gap-1">
                {/* A satellite, blinking while the ping is live — it is the
                    antenna talking, not a direction. It stops blinking when
                    the signal is stale or the tracker is asleep, so a still
                    icon means there is nothing arriving. */}
                <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-300">
                  <Satellite
                    className={cn(
                      "h-3 w-3",
                      status === "live" ? "text-emerald-300 animate-blink" : "text-amber-300",
                    )}
                    aria-hidden="true"
                  />
                  {pingLabel}
                </span>
              </div>
            </div>

            <div className="relative">
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-3"
                style={{ marginLeft: `${edge}%`, marginRight: `${edge}%` }}
                aria-hidden="true"
              >
                <div className="absolute inset-x-0 top-[5px] h-0.5 rounded-full bg-white/10" />
                <div
                  className="absolute left-0 top-[5px] h-0.5 rounded-full bg-saffron-400"
                  style={{ width: `${progressPct}%` }}
                />
                <div
                  className="absolute top-[5px] h-0.5 border-t-2 border-dashed border-saffron-400/40"
                  style={{ left: `${progressPct}%`, right: 0 }}
                />
              </div>

              <ol
                className="relative grid"
                style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
                aria-label="Stops on this ride"
              >
                {stops.map((stop, index) => {
                  const isStart = index === 0;
                  const isEnd = index === count - 1;
                  const isLive = stop.status === "live";
                  const isDone = stop.status === "done";
                  return (
                    <li key={`${stop.name}-${index}`} className="min-w-0">
                      {/* The dot under the map is a pointer too: tapping it
                          picks the same checkpoint the pin above does. */}
                      <button
                        type="button"
                        onClick={() => onSelectStop?.(index)}
                        aria-pressed={selectedIndex === index}
                        aria-label={`Show the weather at ${stop.name}`}
                        className={cn(
                          "flex w-full min-w-0 flex-col items-center rounded-lg px-0.5 py-0.5 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron-300",
                          selectedIndex === index ? "bg-saffron-400/15" : "hover:bg-white/[0.05]",
                        )}
                      >
                      <span
                        className="relative grid h-3 w-3 place-items-center"
                        role={isLive ? "status" : undefined}
                        aria-label={isLive ? `PB's location: ${liveLabel}` : undefined}
                      >
                        {isLive && (
                          <span
                            className="shrink-0 aspect-square absolute h-6 w-6 rounded-full bg-saffron-400/30 animate-radar"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          title={`${isStart ? "Start" : isEnd ? "Destination" : "Stop"} · ${
                            stop.name
                          }${stop.note ? ` — ${stop.note}` : ""}`}
                          className={cn(
                            "shrink-0 aspect-square relative grid h-3 w-3 place-items-center rounded-full ring-2 ring-black/40",
                            isStart
                              ? "bg-emerald-500"
                              : isEnd
                                ? "bg-red-500"
                                : isLive
                                  ? "bg-saffron-400"
                                  : isDone
                                    ? "bg-ridden"
                                    : "bg-saffron-400",
                          )}
                        >
                          {isDone && !isStart && !isEnd && (
                            <Check className="h-2 w-2 text-ridden-tick" aria-hidden="true" />
                          )}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "mt-1.5 max-w-full truncate text-center text-[9px] font-bold uppercase leading-tight tracking-wide sm:text-[10px]",
                          isStart
                            ? "text-emerald-300"
                            : isEnd
                              ? "text-red-300"
                              : isLive
                                ? "text-amber-300"
                                : isDone
                                  ? "text-zinc-400"
                                  : "text-zinc-500",
                        )}
                      >
                        {stop.name}
                      </span>
                        <span
                          className={cn(
                            "text-[9px] leading-tight",
                            isLive && status === "live" ? "text-emerald-300" : "text-zinc-600",
                          )}
                        >
                          {isLive && status === "live" && index > 0
                            ? "here now"
                            : isDone && typeof travelKm === "number"
                              ? "ridden"
                              : formatKm(totals[index] ?? 0)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
