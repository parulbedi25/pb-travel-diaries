import { useEffect, useState } from "react";
import { fetchWeatherAt, type StopWeather } from "../utils/weather";

const CACHE_PREFIX = "pb_wx_v1:";
/**
 * Half an hour: quick enough to still be "now", slow enough to be one call.
 *
 * The badge is not merely re-read when this passes — the tracker asks again, so
 * a page left open through a mountain afternoon shows the afternoon's sky
 * rather than the morning's. That is the whole point of the interval.
 */
export const WEATHER_REFRESH_MS = 30 * 60 * 1000;

const pointKey = (stops: readonly { lat: number; lng: number }[]): string =>
  stops.map((s) => `${s.lat.toFixed(3)},${s.lng.toFixed(3)}`).join(";");

const memory = new Map<string, { at: number; weather: (StopWeather | null)[] }>();
const inFlight = new Map<string, Promise<(StopWeather | null)[]>>();

/** When this set of points was last answered for, in ms since the epoch. */
function writtenAt(key: string): number {
  const visited = memory.get(key);
  if (visited) return visited.at;
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { t?: number };
    return Number(parsed?.t) || 0;
  } catch {
    return 0;
  }
}

function readCache(key: string): (StopWeather | null)[] | null {
  const visited = memory.get(key);
  if (visited) return Date.now() - visited.at < WEATHER_REFRESH_MS ? visited.weather : null;
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t?: number; weather?: (StopWeather | null)[] };
    if (!parsed?.t || Date.now() - parsed.t >= WEATHER_REFRESH_MS) return null;
    if (!Array.isArray(parsed.weather)) return null;
    memory.set(key, { at: parsed.t, weather: parsed.weather });
    return parsed.weather;
  } catch {
    return null;
  }
}

function writeCache(key: string, weather: (StopWeather | null)[]): void {
  memory.set(key, { at: Date.now(), weather });
  try {
    window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), weather }));
  } catch {
    // A full or blocked localStorage only costs us a repeat request.
  }
}

async function ask(stops: readonly { lat: number; lng: number }[], force = false): Promise<(StopWeather | null)[]> {
  const key = pointKey(stops);
  if (!force) {
    const cached = readCache(key);
    if (cached) return cached;
  }
  const already = inFlight.get(key);
  if (already && !force) return already;

  const request = (async () => {
    try {
      const weather = await fetchWeatherAt(stops);
      writeCache(key, weather);
      return weather;
    } catch {
      return stops.map(() => null);
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, request);
  return request;
}

/**
 * One timer per set of points, shared by everything on the page that shows the
 * weather. The tracker draws the badges in two places — the map and the list —
 * and both ask for the same stops, so they share one refresh rather than racing
 * each other for the same answer.
 */
const subscribers = new Map<string, Set<(weather: (StopWeather | null)[]) => void>>();
const timers = new Map<string, number>();

const pointList = new Map<string, readonly { lat: number; lng: number }[]>();

function publish(key: string, weather: (StopWeather | null)[]): void {
  for (const listener of subscribers.get(key) ?? []) listener(weather);
}

/** The next refresh is due half an hour after the last answer arrived. */
function scheduleRefresh(key: string): void {
  const previous = timers.get(key);
  if (previous) window.clearTimeout(previous);
  const age = Date.now() - writtenAt(key);
  const wait = Math.min(WEATHER_REFRESH_MS, Math.max(60_000, WEATHER_REFRESH_MS - age));
  timers.set(
    key,
    window.setTimeout(() => {
      timers.delete(key);
      void refreshNow(key);
    }, wait),
  );
}

function stopRefresh(key: string): void {
  const timer = timers.get(key);
  if (timer) window.clearTimeout(timer);
  timers.delete(key);
}

async function refreshNow(key: string): Promise<void> {
  const stops = pointList.get(key);
  if (!stops) return;
  const weather = await ask(stops, true);
  publish(key, weather);
  if (subscribers.get(key)?.size) scheduleRefresh(key);
}

/**
 * The current weather at every checkpoint, in the order they were given.
 *
 * Null until it arrives, and an entry inside is null when the service could
 * not answer for that point — a missing badge is better than a false one.
 * Weather is decoration on top of the tracker, so nothing here is allowed to
 * throw or block the ride.
 *
 * The values are refreshed every half hour without a reload, and immediately
 * when a tab that was in the background comes back to the front holding an
 * answer older than that.
 */
export function useRouteWeather(
  stops: readonly { lat: number; lng: number }[],
): (StopWeather | null)[] | null {
  const key = stops.length ? pointKey(stops) : "";
  const [weather, setWeather] = useState<(StopWeather | null)[] | null>(() =>
    key ? readCache(key) : null,
  );

  useEffect(() => {
    if (!key) {
      setWeather(null);
      return;
    }
    pointList.set(key, stops);

    const listeners = subscribers.get(key) ?? new Set<(weather: (StopWeather | null)[]) => void>();
    subscribers.set(key, listeners);
    const listener = (next: (StopWeather | null)[]) => setWeather(next);
    listeners.add(listener);

    const cached = readCache(key);
    if (cached) {
      setWeather(cached);
      if (!timers.has(key)) scheduleRefresh(key);
    } else if (!timers.has(key)) {
      void ask(stops).then((result) => {
        publish(key, result);
        if (subscribers.get(key)?.size) scheduleRefresh(key);
      });
    }

    // A phone that was in a pocket on the climb should not come back to the
    // morning's sky.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!readCache(key)) void refreshNow(key);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      listeners.delete(listener);
      document.removeEventListener("visibilitychange", onVisible);
      if (listeners.size === 0) {
        subscribers.delete(key);
        pointList.delete(key);
        stopRefresh(key);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by coordinates on purpose
  }, [key]);

  return weather;
}
