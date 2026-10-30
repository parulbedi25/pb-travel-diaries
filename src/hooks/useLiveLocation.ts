import { useEffect, useMemo, useState } from "react";
import { LIVE_LOCATION } from "../data/liveLocation";
import { apiUrl } from "../api/client";
import type { LiveFix } from "../api/siteApi";

export type LiveStatus = "live" | "stale" | "offduty";

export interface LiveLocationData {
  lat: number;
  lng: number;
  name: string;
  state: string;
  altitude: string;
  note: string;
  updatedAt: string; // ISO 8601
  /**
   * Where this position came from: the phone's own fix ("phone"), the JSON feed
   * set in `data/liveLocation.ts` ("feed"), the stop the dashboard marked "here
   * now" ("dashboard"), or the values bundled with the build ("default").
   */
  source?: "phone" | "feed" | "dashboard" | "default";
  /** How sure the phone was, in metres — shown only when it says. */
  accuracyM?: number | null;
}

/**
 * Where the dashboard says the bike is.
 *
 * The tracker's route stops are the source of truth for the current position:
 * the stop marked "Here now" wins. This is the handful of fields the tracker
 * needs from that stop, with everything optional so an older saved route —
 * written before stops carried a state or an altitude — still works.
 */
export interface LiveLocationSeed {
  lat: number;
  lng: number;
  name?: string;
  state?: string;
  altitude?: string;
  note?: string;
}

const IST_OFFSET_MIN = 330; // Asia/Kolkata = UTC+5:30 (no DST)
const WINDOW_START_MIN = 6 * 60; // 6:00 AM IST
const WINDOW_END_MIN = 21 * 60; // 9:00 PM IST
const FRESH_TTL_MS = 60 * 60 * 1000; // a ping stays "live" for 1 hour

function istParts(date: Date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MIN * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    minutesOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** Convert wall-clock IST components to a UTC epoch ms. */
function istToUtcMs(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number
): number {
  return Date.UTC(year, month, day, hours, minutes) - IST_OFFSET_MIN * 60000;
}

/**
 * Live location state for PB's tracker.
 *
 * - The position comes from the dashboard: pass `seed` (the stop marked
 *   "Here now") and that is where the bike is shown.
 * - Polls LIVE_LOCATION.feedUrl (if set) every 60s for fresh pings. A live GPS
 *   feed still beats a hand-set stop — it is the one thing that can move the
 *   bike without an edit — but with no feed configured the dashboard wins.
 * - A ping is LIVE only within the daily window: 6:00 AM – 9:00 PM IST,
 *   and only for 1 hour after it was received (hourly updates).
 * - Outside the window the status is "offduty" until 6:00 AM IST next day.
 */
export function useLiveLocation(seed?: LiveLocationSeed | null) {
  const [now, setNow] = useState(() => new Date());
  const [remote, setRemote] = useState<LiveLocationData | null>(null);

  // 1s clock — drives the IST window, "updated Xs ago" and countdowns
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Ask for the newest position. A JSON feed set in data/liveLocation.ts is an
  // override; with none set, the site's own API is asked, which is where the
  // phone's OwnTracks app has been posting (see server/routes/live.js). A page
  // exported as static files with no API behind it simply keeps the dashboard's
  // stop — a failed poll is not an error worth showing anybody.
  useEffect(() => {
    const feedUrl = LIVE_LOCATION.feedUrl;
    if (!feedUrl) {
      let cancelled = false;
      const pullFromApi = async () => {
        try {
          // Deliberately a plain fetch, not `api.get`: on a host with no server
          // that route answers with the site's own 404 page, and the API client
          // would take any answer under 500 as proof that a server exists —
          // which would put the dashboard back into a static export.
          const response = await fetch(apiUrl("/api/live"), {
            cache: "no-store",
            credentials: "omit",
            headers: { accept: "application/json" },
          });
          if (!response.ok) return;
          const { fix } = (await response.json()) as { fix: LiveFix | null };
          if (cancelled || !fix) return;
          setRemote({
            lat: fix.lat,
            lng: fix.lng,
            // A phone fix carries no place name; `useSiteLiveLocation` fills
            // that in from the nearest stop on the route.
            name: "",
            state: "",
            altitude: altitudeLabel(fix.altitudeM),
            note: "",
            updatedAt: fix.updatedAt,
            source: "phone",
            accuracyM: fix.accuracyM,
          });
        } catch {
          /* no API here — the dashboard's stop stays in charge */
        }
      };
      void pullFromApi();
      const id = setInterval(() => void pullFromApi(), 30_000);
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetch(feedUrl, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as Partial<LiveLocationData>;
        if (cancelled || typeof json.lat !== "number" || typeof json.lng !== "number") {
          return;
        }
        setRemote({
          lat: json.lat,
          lng: json.lng,
          name: json.name ?? LIVE_LOCATION.name,
          state: json.state ?? LIVE_LOCATION.state,
          altitude: json.altitude ?? LIVE_LOCATION.altitude,
          note: json.note ?? LIVE_LOCATION.note,
          updatedAt:
            typeof json.updatedAt === "string"
              ? json.updatedAt
              : new Date().toISOString(),
          source: "feed",
        });
      } catch {
        /* feed unreachable — keep using bundled/fallback data */
      }
    };
    void pull();
    const id = setInterval(() => void pull(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // The dashboard's stop, stamped once per mount: a hand-set position is the
  // latest word there is, so it reads as a fresh ping rather than as the age of
  // whatever was bundled with the build.
  const seeded = useMemo<LiveLocationData | null>(() => {
    if (!seed) return null;
    return {
      lat: seed.lat,
      lng: seed.lng,
      name: seed.name?.trim() || LIVE_LOCATION.name,
      state: seed.state?.trim() || LIVE_LOCATION.state,
      altitude: seed.altitude?.trim() || LIVE_LOCATION.altitude,
      note: seed.note?.trim() || LIVE_LOCATION.note,
      updatedAt: new Date().toISOString(),
      source: "dashboard",
    };
    // Re-stamp only when the position itself changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.lat, seed?.lng, seed?.name, seed?.state, seed?.altitude, seed?.note]);

  const fallback: LiveLocationData = {
    lat: LIVE_LOCATION.lat,
    lng: LIVE_LOCATION.lng,
    name: LIVE_LOCATION.name,
    state: LIVE_LOCATION.state,
    altitude: LIVE_LOCATION.altitude,
    note: LIVE_LOCATION.note,
    updatedAt: LIVE_LOCATION.updatedAt,
    source: "default",
  };

  // A remote fix leads only while it is still worth calling live. Once the
  // phone has been quiet for longer than the tracker's own hour, the stop the
  // dashboard marked "here now" is the better answer — it is a place somebody
  // chose, not a place a flat battery left behind.
  const remoteFresh =
    remote !== null && now.getTime() - (Date.parse(remote.updatedAt) || 0) <= FRESH_TTL_MS;
  const location: LiveLocationData = (remoteFresh ? remote : null) ?? seeded ?? fallback;

  const parts = istParts(now);
  const inWindow =
    parts.minutesOfDay >= WINDOW_START_MIN && parts.minutesOfDay < WINDOW_END_MIN;

  const updatedMs = useMemo(
    () => Date.parse(location.updatedAt) || 0,
    [location.updatedAt]
  );
  const ageMs = Math.max(0, now.getTime() - updatedMs);
  const fresh = ageMs <= FRESH_TTL_MS;

  const status: LiveStatus = !inWindow ? "offduty" : fresh ? "live" : "stale";

  // Next 6:00 AM IST (today if before 6 AM, otherwise tomorrow)
  const nextWindowOpenMs = useMemo(() => {
    if (parts.minutesOfDay < WINDOW_START_MIN) {
      return istToUtcMs(parts.year, parts.month, parts.day, 6, 0);
    }
    return istToUtcMs(parts.year, parts.month, parts.day + 1, 6, 0);
  }, [parts.year, parts.month, parts.day, parts.minutesOfDay]);

  // Next 9:00 PM IST (today if before 9 PM, otherwise tomorrow)
  const windowCloseMs = useMemo(() => {
    if (parts.minutesOfDay < WINDOW_END_MIN) {
      return istToUtcMs(parts.year, parts.month, parts.day, 21, 0);
    }
    return istToUtcMs(parts.year, parts.month, parts.day + 1, 21, 0);
  }, [parts.year, parts.month, parts.day, parts.minutesOfDay]);

  return {
    location,
    status,
    inWindow,
    ageMs,
    ageSec: Math.floor(ageMs / 1000),
    now,
    istTime: now.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }),
    nextWindowOpenMs,
    windowCloseMs,
  };
}

/**
 * "1,150 ft" from the metres a phone reports.
 *
 * The tracker has always shown altitude in feet; the phone speaks metres, so
 * the conversion lives here rather than in the three components that print it.
 */
export function altitudeLabel(metres: number | null | undefined): string {
  if (typeof metres !== "number" || !Number.isFinite(metres)) return "";
  const feet = Math.round(metres * 3.28084);
  return `${feet.toLocaleString("en-IN")} ft`;
}

/** "2m ago" — how old the last ping is, in the shortest honest form. */
export function ageLabel(sec: number): string {
  if (sec < 90) return `${sec}s ago`;
  if (sec < 5400) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}
