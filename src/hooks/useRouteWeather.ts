import { useEffect, useState } from "react";
import { fetchWeatherAt, type StopWeather } from "../utils/weather";

const CACHE_PREFIX = "pb_wx_v1:";
/** Half an hour: quick enough to still be "now", slow enough to be one call. */
const CACHE_MAX_AGE_MS = 30 * 60 * 1000;

const pointKey = (stops: readonly { lat: number; lng: number }[]): string =>
  stops.map((s) => `${s.lat.toFixed(3)},${s.lng.toFixed(3)}`).join(";");

const memory = new Map<string, (StopWeather | null)[]>();
const inFlight = new Map<string, Promise<(StopWeather | null)[]>>();

function readCache(key: string): (StopWeather | null)[] | null {
  const visited = memory.get(key);
  if (visited) return visited;
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t?: number; weather?: (StopWeather | null)[] };
    if (!parsed?.t || Date.now() - parsed.t >= CACHE_MAX_AGE_MS) return null;
    if (!Array.isArray(parsed.weather)) return null;
    memory.set(key, parsed.weather);
    return parsed.weather;
  } catch {
    return null;
  }
}

function writeCache(key: string, weather: (StopWeather | null)[]): void {
  memory.set(key, weather);
  try {
    window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), weather }));
  } catch {
    // A full or blocked localStorage only costs us a repeat request.
  }
}

async function ask(stops: readonly { lat: number; lng: number }[]): Promise<(StopWeather | null)[]> {
  const key = pointKey(stops);
  const cached = readCache(key);
  if (cached) return cached;
  const already = inFlight.get(key);
  if (already) return already;

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
 * The current weather at every checkpoint, in the order they were given.
 *
 * Null until it arrives, and an entry inside is null when the service could
 * not answer for that point — a missing badge is better than a false one.
 * Weather is decoration on top of the tracker, so nothing here is allowed to
 * throw or block the ride.
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
    const cached = readCache(key);
    if (cached) {
      setWeather(cached);
      return;
    }
    let cancelled = false;
    void ask(stops).then((result) => {
      if (!cancelled) setWeather(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by coordinates on purpose
  }, [key]);

  return weather;
}
