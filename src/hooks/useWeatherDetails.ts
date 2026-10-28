import { useEffect, useState } from "react";
import { fetchWeatherDetails, type WeatherDetail } from "../utils/weather";

const CACHE_PREFIX = "pb_wx_detail_v1:";
/** Fifteen minutes: a forecast is still current, and the calls stay rare. */
const CACHE_MAX_AGE_MS = 15 * 60 * 1000;

const pointKey = (points: readonly { lat: number; lng: number }[]): string =>
  points.map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join(";");

const memory = new Map<string, (WeatherDetail | null)[]>();
const inFlight = new Map<string, Promise<(WeatherDetail | null)[]>>();

function readCache(key: string): (WeatherDetail | null)[] | null {
  const visited = memory.get(key);
  if (visited) return visited;
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t?: number; weather?: (WeatherDetail | null)[] };
    if (!parsed?.t || Date.now() - parsed.t >= CACHE_MAX_AGE_MS) return null;
    if (!Array.isArray(parsed.weather)) return null;
    memory.set(key, parsed.weather);
    return parsed.weather;
  } catch {
    return null;
  }
}

function writeCache(key: string, weather: (WeatherDetail | null)[]): void {
  memory.set(key, weather);
  try {
    window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), weather }));
  } catch {
    // A full or blocked localStorage only costs us a repeat request.
  }
}

async function ask(points: readonly { lat: number; lng: number }[]) {
  const key = pointKey(points);
  const cached = readCache(key);
  if (cached) return cached;
  const already = inFlight.get(key);
  if (already) return already;

  const request = (async () => {
    try {
      const weather = await fetchWeatherDetails(points);
      writeCache(key, weather);
      return weather;
    } catch {
      return points.map(() => null);
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, request);
  return request;
}

/**
 * Weather details for a set of points along the route — the bubbles every
 * hundred kilometres.
 *
 * One request for all of them, cached for a quarter of an hour: opening a
 * bubble is a local action and must never wait on the network. Null until the
 * answer arrives, and entries inside stay null for points the service could
 * not answer for, so a bubble with no data simply does not open.
 */
export function useWeatherDetails(
  points: readonly { lat: number; lng: number }[],
): (WeatherDetail | null)[] | null {
  const key = points.length ? pointKey(points) : "";
  const [weather, setWeather] = useState<(WeatherDetail | null)[] | null>(() =>
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
    void ask(points).then((result) => {
      if (!cancelled) setWeather(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by coordinates on purpose
  }, [key]);

  return weather;
}
