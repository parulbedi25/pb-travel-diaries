/**
 * Current weather at a place, from Open-Meteo.
 *
 * Open-Meteo is keyless, CORS-friendly and needs no account, which is what
 * makes it usable from a static build. It reports conditions as WMO weather
 * codes — integers such as 61 for "rain: slight" — so the mapping to something
 * a rider can read lives here, in one table, rather than being guessed at in
 * three components.
 *
 * The whole route is asked for in a single request: Open-Meteo accepts a
 * comma-separated list of coordinates and answers with one object per point,
 * in order. A ten-checkpoint route is still one call.
 */

export type WeatherKind =
  | "clear"
  | "partly"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunder"
  | "wind";

export interface StopWeather {
  /** Degrees Celsius, or null when the service did not report one. */
  tempC: number | null;
  kind: WeatherKind;
  /** "Light rain", "Clear sky" — the short human name of the code. */
  label: string;
}

/** WMO code → the nine kinds of weather this site draws. */
export function weatherKind(code: number): WeatherKind {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "thunder";
  return "cloudy";
}

const LABELS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Rain showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Snow showers",
  95: "Thunderstorm",
  96: "Storm with hail",
  99: "Storm with hail",
};

export function weatherLabel(code: number): string {
  return LABELS[code] ?? "Weather";
}

const API = "https://api.open-meteo.com/v1/forecast";

interface Point {
  lat: number;
  lng: number;
}

interface CurrentBlock {
  current?: { temperature_2m?: number; weather_code?: number };
}

/**
 * Ask for the weather at every point, in order.
 *
 * Each entry is null when the service had nothing to say about that point, so
 * the caller can leave one checkpoint's badge blank instead of losing them all.
 */
export async function fetchWeatherAt(
  points: readonly Point[],
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<(StopWeather | null)[]> {
  const usable = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!usable.length) return [];

  const url =
    `${API}?latitude=${usable.map((p) => p.lat.toFixed(4)).join(",")}` +
    `&longitude=${usable.map((p) => p.lng.toFixed(4)).join(",")}` +
    "&current=temperature_2m,weather_code";

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Weather service answered ${response.status}`);

  const json = (await response.json()) as CurrentBlock | CurrentBlock[];
  // One point comes back as a single object; several come back as an array.
  const blocks = Array.isArray(json) ? json : [json];

  return usable.map((_, index) => {
    const current = blocks[index]?.current;
    const code = current?.weather_code;
    if (typeof code !== "number") return null;
    return {
      tempC: typeof current?.temperature_2m === "number" ? Math.round(current.temperature_2m) : null,
      kind: weatherKind(code),
      label: weatherLabel(code),
    };
  });
}

/* ------------------------------------------------------------------ *
 * A point's weather, in detail
 * ------------------------------------------------------------------ */

export interface WeatherNow {
  /** Degrees Celsius, or null when the service did not report one. */
  tempC: number | null;
  /** What it feels like, which on a Ladakh pass is the number that matters. */
  feelsC: number | null;
  kind: WeatherKind;
  label: string;
  code: number;
  /** km/h, or null. */
  windKph: number | null;
  /** Percent, or null. */
  humidity: number | null;
}

export interface WeatherHour {
  /** ISO local time, `2026-10-28T14:00`. */
  time: string;
  tempC: number | null;
  kind: WeatherKind;
  label: string;
  code: number;
  /** Chance of precipitation, percent, or null. */
  rainPct: number | null;
}

export interface WeatherDay {
  /** ISO date, `2026-10-28`. */
  date: string;
  kind: WeatherKind;
  label: string;
  code: number;
  maxC: number | null;
  minC: number | null;
  rainPct: number | null;
}

/** Everything one weather bubble shows when it opens. */
export interface WeatherDetail {
  now: WeatherNow;
  /** The next few hours, starting with the one after this one. */
  hours: WeatherHour[];
  /** The coming week, today first. */
  days: WeatherDay[];
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

interface DetailedBlock {
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: (number | null)[];
    weather_code?: (number | null)[];
    precipitation_probability?: (number | null)[];
  };
  daily?: {
    time?: string[];
    weather_code?: (number | null)[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_probability_max?: (number | null)[];
  };
}

const HOUR = 3600 * 1000;

/**
 * Current conditions plus the next few hours and the coming week, for each
 * point, in one request.
 *
 * The hourly block starts at midnight of today, so "the next three hours" is a
 * matter of finding where the clock is in that list rather than assuming it
 * starts now. Each point gets its own slice.
 */
export async function fetchWeatherDetails(
  points: readonly Point[],
  { hours = 3, days = 7, timeoutMs = 12_000 }: { hours?: number; days?: number; timeoutMs?: number } = {},
): Promise<(WeatherDetail | null)[]> {
  const usable = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!usable.length) return [];

  const params = new URLSearchParams({
    latitude: usable.map((p) => p.lat.toFixed(4)).join(","),
    longitude: usable.map((p) => p.lng.toFixed(4)).join(","),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
    hourly: "temperature_2m,weather_code,precipitation_probability",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    forecast_days: String(days),
    // `auto` is only offered for a single point; the ride runs on IST.
    timezone: usable.length === 1 ? "auto" : "Asia/Kolkata",
  });

  const response = await fetch(`${API}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Weather service answered ${response.status}`);

  const json = (await response.json()) as DetailedBlock | DetailedBlock[];
  const blocks = Array.isArray(json) ? json : [json];

  return usable.map((_, index) => {
    const block = blocks[index];
    const code = block?.current?.weather_code;
    if (typeof code !== "number") return null;

    const hourly = block.hourly;
    const times = hourly?.time ?? [];
    // Where "now" sits in the hourly list, so the next few hours are the ones
    // after it rather than the ones after midnight.
    const nowText = block.current?.time ?? "";
    const nowMs = nowText ? new Date(nowText).getTime() : Date.now();
    let start = times.findIndex((time) => new Date(time).getTime() > nowMs - HOUR / 2);
    if (start < 0) start = 0;
    const picked: WeatherHour[] = [];
    for (let i = start; i < times.length && picked.length < hours; i += 1) {
      const hourCode = hourly?.weather_code?.[i];
      picked.push({
        time: times[i],
        tempC: num(hourly?.temperature_2m?.[i]),
        kind: weatherKind(typeof hourCode === "number" ? hourCode : 3),
        label: typeof hourCode === "number" ? weatherLabel(hourCode) : "Weather",
        code: typeof hourCode === "number" ? hourCode : 3,
        rainPct: num(hourly?.precipitation_probability?.[i]),
      });
    }

    const daily = block.daily;
    const dayList: WeatherDay[] = (daily?.time ?? []).slice(0, days).map((date, i) => {
      const dayCode = daily?.weather_code?.[i];
      return {
        date,
        kind: weatherKind(typeof dayCode === "number" ? dayCode : 3),
        label: typeof dayCode === "number" ? weatherLabel(dayCode) : "Weather",
        code: typeof dayCode === "number" ? dayCode : 3,
        maxC: num(daily?.temperature_2m_max?.[i]),
        minC: num(daily?.temperature_2m_min?.[i]),
        rainPct: num(daily?.precipitation_probability_max?.[i]),
      };
    });

    return {
      now: {
        tempC: num(block.current?.temperature_2m),
        feelsC: num(block.current?.apparent_temperature),
        kind: weatherKind(code),
        label: weatherLabel(code),
        code,
        windKph: num(block.current?.wind_speed_10m),
        humidity: num(block.current?.relative_humidity_2m),
      },
      hours: picked,
      days: dayList,
    };
  });
}
