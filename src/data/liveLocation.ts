/**
 * Live location config for PB's tracker.
 *
 * Three ways to feed real coordinates, in the order they are tried:
 *
 *  0. The rider's phone. OwnTracks (Android/iOS) posts one JSON message per fix
 *     to this site, and `/api/live` hands the newest one to the tracker, the
 *     live map and the nearby page. Nothing here needs configuring for that —
 *     Dashboard → Settings → Live location shows the URL to paste into the
 *     phone. This file only holds the fallbacks below.
 *
 *  1. Set feedUrl below to a JSON endpoint you control
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
 * When the phone has been quiet for an hour, the site goes back to the stop the
 * dashboard marked "Here now" — a place somebody chose beats a stale pin.
 *
 * Freshness rule: a ping is "live" for 1 hour, and only inside the daily
 * tracking window — 6:00 AM to 9:00 PM IST. Outside the window the tracker
 * shows an off-duty state until 6:00 AM IST the next day.
 */
export const LIVE_LOCATION = {
  feedUrl: "",

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
