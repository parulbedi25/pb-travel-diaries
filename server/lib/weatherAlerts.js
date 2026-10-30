/**
 * Turning a forecast into the alerts a rider needs to see.
 *
 * The route in the live tracker is followed by everyone with an account, so a
 * thunderstorm over a pass, a night below freezing or a day of heavy rain on a
 * landslide-prone stretch is not decoration — it is the one thing on the site
 * worth interrupting somebody for. This module owns the judgement: which codes
 * are worth an alert, how bad they are, and how an alert is worded. It is pure
 * on purpose, so the rules can be tested without a network or a database.
 *
 * Everything cited here comes from the same Open-Meteo forecast the tracker
 * draws on: no second provider, no key, no guesswork about which of two
 * sources is right. Road closures that no forecast can see are posted by the
 * owner from the dashboard and stored in the same table — see routes/alerts.js.
 */

/** A stable identity for "this hazard at this place on this day". */
function dedupeKey(day, stopKey, kind) {
  return `wx:${day}:${stopKey}:${kind}`;
}

const hazardText = {
  thunder: {
    kind: "thunder",
    severity: "warning",
    title: "Thunderstorms",
    advice: "Lightning on a pass is not something to ride through. Plan to be off the high ground before it builds.",
  },
  heavyRain: {
    kind: "rain",
    severity: "warning",
    title: "Heavy rain",
    advice: "Heavy rain on these hills means falling rock and landslides. Expect the road to be blocked in places.",
  },
  heavySnow: {
    kind: "snow",
    severity: "warning",
    title: "Heavy snow",
    advice: "Passes close for less than this. Check the road is open before setting out, and carry chains.",
  },
  freezing: {
    kind: "ice",
    severity: "warning",
    title: "Freezing rain",
    advice: "Black ice on the road surface. Ride later in the day or not at all.",
  },
  fog: {
    kind: "fog",
    severity: "watch",
    title: "Poor visibility",
    advice: "Fog on this stretch. Lights on, speed down, and expect traffic to appear late.",
  },
  heat: {
    kind: "heat",
    severity: "watch",
    title: "Extreme heat",
    advice: "Ride early, carry water, and stop before the afternoon heat builds.",
  },
  cold: {
    kind: "cold",
    severity: "watch",
    title: "Hard freeze",
    advice: "Below freezing at this stop. Ice in the shaded corners and on bridges.",
  },
  wind: {
    kind: "wind",
    severity: "watch",
    title: "High wind",
    advice: "Gusts strong enough to move a loaded bike across the road.",
  },
};

/** The hazard a WMO code represents, if it deserves waking somebody up. */
export function hazardForCode(code) {
  if (typeof code !== "number") return null;
  if (code >= 95) return hazardText.thunder;
  if (code === 65 || code === 82) return hazardText.heavyRain;
  if (code === 75 || code === 86) return hazardText.heavySnow;
  if (code === 66 || code === 67 || code === 56 || code === 57) return hazardText.freezing;
  if (code === 45 || code === 48) return hazardText.fog;
  return null;
}

const day = (value) => String(value ?? "").slice(0, 10);

/**
 * Every alert worth raising from one forecast, in the order they matter.
 *
 * `points` are the route's stops — `{ name, lat, lng }` — and `forecasts` is
 * one Open-Meteo answer per stop, in the same order. A point whose forecast is
 * missing is skipped rather than guessed at: an alert that is wrong once is an
 * alert nobody reads again.
 */
export function alertsFromForecast(points, forecasts, { now = new Date(), routeSignature = "" } = {}) {
  const alerts = [];
  const stopKeys = new Set();

  points.forEach((point, index) => {
    const forecast = forecasts[index];
    if (!forecast) return;
    const stopKey = `${Number(point.lat).toFixed(3)},${Number(point.lng).toFixed(3)}`;
    if (stopKeys.has(stopKey)) return;
    stopKeys.add(stopKey);

    const name = String(point.name ?? "").trim() || "this stop";
    const current = forecast.current ?? {};

    // Today's worst code decides the day's headline, exactly as a rider would
    // read the forecast: a thunderstorm at four in the afternoon still means
    // "not today" when you are planning the morning.
    const daily = forecast.daily ?? {};
    const codes = Array.isArray(daily.weather_code) ? daily.weather_code : [];
    const dates = Array.isArray(daily.time) ? daily.time : [];
    const maxes = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [];
    const mins = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min : [];

    const seenKinds = new Set();
    codes.slice(0, 2).forEach((code, dayIndex) => {
      const hazard = hazardForCode(code);
      if (!hazard || seenKinds.has(hazard.kind)) return;
      seenKinds.add(hazard.kind);
      const date = day(dates[dayIndex] ?? now.toISOString());
      const high = Number.isFinite(maxes[dayIndex]) ? Math.round(maxes[dayIndex]) : null;
      const low = Number.isFinite(mins[dayIndex]) ? Math.round(mins[dayIndex]) : null;
      alerts.push({
        kind: "weather",
        severity: hazard.severity,
        title: `${hazard.title} at ${name}`,
        body: `${hazard.advice}${high != null && low != null ? ` Forecast ${low}° to ${high}°C.` : ""}`,
        place: name,
        lat: Number(point.lat),
        lng: Number(point.lng),
        source: "weather",
        dedupeKey: dedupeKey(date, stopKey, hazard.kind),
        routeSignature,
        expiresAt: null,
      });
    });

    // The current hour can already be worse than the day's summary.
    const live = hazardForCode(current.weather_code);
    if (live && !seenKinds.has(live.kind)) {
      const date = day(current.time ?? now.toISOString());
      alerts.push({
        kind: "weather",
        severity: live.severity,
        title: `${live.title} at ${name} now`,
        body: live.advice,
        place: name,
        lat: Number(point.lat),
        lng: Number(point.lng),
        source: "weather",
        dedupeKey: dedupeKey(date, stopKey, `${live.kind}-now`),
        routeSignature,
        expiresAt: null,
      });
    }

    // Heat, cold and wind are numbers rather than codes, and they are read off
    // today's range so a 3 a.m. minimum does not masquerade as afternoon cold.
    const high = Number.isFinite(maxes[0]) ? Math.round(maxes[0]) : null;
    const low = Number.isFinite(mins[0]) ? Math.round(mins[0]) : null;
    const date = day(dates[0] ?? now.toISOString());
    if (high != null && high >= 40) {
      alerts.push({
        kind: "weather",
        severity: "watch",
        title: `${high}°C at ${name}`,
        body: hazardText.heat.advice,
        place: name,
        lat: Number(point.lat),
        lng: Number(point.lng),
        source: "weather",
        dedupeKey: dedupeKey(date, stopKey, "heat"),
        routeSignature,
        expiresAt: null,
      });
    }
    if (low != null && low <= -5) {
      alerts.push({
        kind: "weather",
        severity: "watch",
        title: `${low}°C at ${name}`,
        body: hazardText.cold.advice,
        place: name,
        lat: Number(point.lat),
        lng: Number(point.lng),
        source: "weather",
        dedupeKey: dedupeKey(date, stopKey, "cold"),
        routeSignature,
        expiresAt: null,
      });
    }
    const wind = Number(current.wind_speed_10m);
    if (Number.isFinite(wind) && wind >= 50) {
      alerts.push({
        kind: "weather",
        severity: "watch",
        title: `${Math.round(wind)} km/h wind at ${name}`,
        body: hazardText.wind.advice,
        place: name,
        lat: Number(point.lat),
        lng: Number(point.lng),
        source: "weather",
        dedupeKey: dedupeKey(date, stopKey, "wind"),
        routeSignature,
        expiresAt: null,
      });
    }
  });

  const rank = { warning: 0, watch: 1, info: 2 };
  return alerts.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));
}

/** How long an alert is worth showing: hazards are good for a day, notices longer. */
export const WEATHER_ALERT_HOURS = 36;
