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
