/**
 * Live location config for PB's tracker.
 *
 * Two ways to feed real coordinates:
 *  1. Set VITE_LIVE_FEED_URL in your .env to a JSON endpoint you control
 *     (GitHub gist, your server, etc.). It is polled every 60 seconds.
 *     Expected shape:
 *     {
 *       "lat": 32.2265, "lng": 78.0644,
 *       "name": "Kaza", "state": "Spiti Valley, Himachal Pradesh",
 *       "altitude": "12,500 ft", "note": "...",
 *       "updatedAt": "2026-01-01T10:00:00+05:30"
 *     }
 *  2. Or edit the bundled fallback values below directly.
 *
 * Freshness rule: a ping is "live" for 1 hour, and only inside the daily
 * tracking window — 6:00 AM to 9:00 PM IST. Outside the window the tracker
 * shows an off-duty state until 6:00 AM IST the next day.
 */
export const LIVE_LOCATION = {
  feedUrl: (import.meta.env.VITE_LIVE_FEED_URL as string | undefined) ?? "",

  // Bundled fallback — used until/unless the feed above returns data.
  lat: 32.2265,
  lng: 78.0644,
  name: "Kaza",
  state: "Spiti Valley, Himachal Pradesh",
  altitude: "12,500 ft",
  note: "Night halt at Key village — bonfire and a Milky Way shoot at 11 PM.",
  // Treated as "last ping received" until your feed takes over.
  updatedAt: new Date().toISOString(),
};
