/**
 * The thirty-minute weather sweep.
 *
 * Every account on the site follows the same route, so the forecast for that
 * route is worth computing once, on the server, and storing — rather than each
 * member's browser deciding for itself what counts as weather worth knowing
 * about. The sweep reads the route out of the saved site content, asks
 * Open-Meteo once for every stop, turns the answer into alerts (see
 * weatherAlerts.js) and stores the new ones, ignoring the ones already there.
 *
 * It runs every half hour from the server's own timer, and on demand when a
 * member opens their alerts page and the last sweep is older than the interval
 * — so a site that was asleep catches up the moment somebody looks.
 */
import { alertsFromForecast, WEATHER_ALERT_HOURS } from "./weatherAlerts.js";

const API = "https://api.open-meteo.com/v1/forecast";
/** Half an hour, the interval the tracker's own weather refreshes on. */
export const SWEEP_MS = 30 * 60 * 1000;
const MAX_STOPS = 24;
const REQUEST_MS = 12_000;

let lastSweepAt = 0;
let inFlight = null;

/** The route the tracker is following, out of the saved site document. */
export function routeStopsFromContent(content) {
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
    const live = sections.find((section) => section?.type === "live");
    const stops = Array.isArray(live?.data?.stops) ? live.data.stops : [];
    const clean = stops
      .map((stop) => ({
        name: String(stop?.name ?? "").trim(),
        lat: Number(stop?.lat),
        lng: Number(stop?.lng),
      }))
      .filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lng))
      .slice(0, MAX_STOPS);
    const signature =
      typeof live?.data?.routeSignature === "string" && live.data.routeSignature
        ? live.data.routeSignature
        : clean.map((stop) => `${stop.lat.toFixed(4)},${stop.lng.toFixed(4)}`).join(";");
    return { stops: clean, signature };
  } catch {
    return { stops: [], signature: "" };
  }
}

/** One request for the whole route, the same one the tracker makes. */
export async function fetchForecasts(stops, { fetchImpl = globalThis.fetch, timeoutMs = REQUEST_MS } = {}) {
  if (!stops.length) return [];
  const params = new URLSearchParams({
    latitude: stops.map((stop) => stop.lat.toFixed(4)).join(","),
    longitude: stops.map((stop) => stop.lng.toFixed(4)).join(","),
    current: "temperature_2m,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    forecast_days: "3",
    timezone: "Asia/Kolkata",
  });
  const response = await fetchImpl(`${API}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`The weather service answered ${response.status}.`);
  const json = await response.json();
  return Array.isArray(json) ? json : [json];
}

/**
 * One sweep: read the route, ask for its weather, store what is worth knowing.
 *
 * Never throws into the caller's request path — a weather service that is down
 * must cost a member nothing but a quiet page.
 */
export async function sweepRouteAlerts({ repo, now = new Date(), fetchImpl = globalThis.fetch } = {}) {
  const saved = await repo.getContent();
  const { stops, signature } = routeStopsFromContent(saved?.content ?? null);
  if (stops.length < 1) return { stops: 0, raised: 0, inserted: 0, skipped: "no-route" };

  const forecasts = await fetchForecasts(stops, { fetchImpl });
  const expiresAt = new Date(now.getTime() + WEATHER_ALERT_HOURS * 3600 * 1000).toISOString();
  const drafts = alertsFromForecast(stops, forecasts, { now, routeSignature: signature }).map((alert) => ({
    ...alert,
    expiresAt,
  }));
  const inserted = drafts.length ? await repo.insertAlerts(drafts) : 0;
  lastSweepAt = now.getTime();
  return { stops: stops.length, raised: drafts.length, inserted };
}

/**
 * Sweep only if the last one is stale.
 *
 * Two members opening the page at the same moment share the one request, and a
 * sweep that just ran is not run again for any of them.
 */
export async function sweepIfStale({ repo, maxAgeMs = SWEEP_MS, now = new Date(), fetchImpl = globalThis.fetch } = {}) {
  if (Date.now() - lastSweepAt < maxAgeMs) return { skipped: "fresh" };
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      return await sweepRouteAlerts({ repo, now, fetchImpl });
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** When the next scheduled sweep is due, in milliseconds. */
export function msUntilNextSweep() {
  if (!lastSweepAt) return 0;
  return Math.max(0, SWEEP_MS - (Date.now() - lastSweepAt));
}

/**
 * The half-hourly timer.
 *
 * `setInterval` is deliberately not used: a long sweep would queue up behind
 * itself. Each tick asks whether a sweep is due and yields.
 */
export function startAlertScheduler({ repo, everyMs = 60_000 } = {}) {
  const tick = async () => {
    if (msUntilNextSweep() > 0) return;
    try {
      await sweepIfStale({ repo });
    } catch (error) {
      console.error(`[alerts] sweep failed: ${error.message}`);
    }
  };
  // A first sweep a minute after boot, so a restart does not stampede the
  // weather service while it is still opening the database.
  const first = setTimeout(tick, 60_000);
  const timer = setInterval(tick, everyMs);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
