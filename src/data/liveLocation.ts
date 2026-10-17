/**
 * Live location config for PB's tracker.
 *
 * Two ways to feed real coordinates:
 *  1. Set VITE_LIVE_FEED_URL in your .env to a JSON endpoint you control
 *     (GitHub gist, your server, etc.). It is polled every 60 seconds.
 *     Expected shape:
 *     {
 *       "lat": 31.369, "lng": 76.3729,
 *       "name": "Nangal", "state": "Punjab, India",
 *       "altitude": "1,150 ft", "note": "...",
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
  // Kept in step with the first stop of the live route (Nangal → Chandigarh),
  // so the tracker reads correctly before a feed takes over.
  lat: 31.369,
  lng: 76.3729,
  name: "Nangal",
  state: "Punjab, India",
  altitude: "1,150 ft",
  note: "Start of the Nangal to Chandigarh run — tank full, first light.",
  // Treated as "last ping received" until your feed takes over.
  updatedAt: new Date().toISOString(),
};
