/**
 * The phone in your pocket, on the map.
 *
 * OwnTracks — the free Android/iOS app — can post one JSON message per fix to
 * any URL you paste into it ("HTTP mode"). This router *is* that URL: it checks
 * the device token, keeps the newest fix in the settings table, and hands it to
 * the site, where the live tracker, the live map and the nearby page all read
 * the same position (see `src/hooks/useLiveLocation.ts`).
 *
 * Nothing here trusts the caller beyond that token: a fix is one pair of
 * numbers in range plus the time the phone recorded it. The token is a secret
 * that only the owner ever sees, and it can be replaced from the dashboard,
 * which is what makes the old URL stop working.
 *
 * Two fixes are kept, not one. `live.fix` is the newest thing the phone said;
 * `live.shown` is the point currently on the map. They are the same while the
 * site follows the phone live, and they differ when the owner has asked for a
 * slower rhythm — "move the pin every 30 minutes" is a decision about the map,
 * not about the phone, so the fixes keep arriving and the map moves on the
 * owner's clock.
 */
import crypto from "node:crypto";
import express from "express";
import { getRepo } from "../db/index.js";
import { requireOwner } from "../lib/auth.js";

export const liveRouter = express.Router();

/** Where the phone posts. Also the path the dashboard shows. */
export const OWNTRACKS_PATH = "/api/live/owntracks";

/** Settings keys: the phone's password, the last ping, and the one on the map. */
const TOKEN_KEY = "live.token";
const FIX_KEY = "live.fix";
const SHOWN_KEY = "live.shown";
const CADENCE_KEY = "live.cadence";

/**
 * How often the pointer may move, in minutes. 0 means "live": every fix the
 * phone sends goes straight onto the map.
 *
 * This is the owner's choice, not a technical limit — a rider who wants the
 * live map to twitch with every turn keeps 0; one who would rather the site
 * update every half hour (a slower, calmer map, and less traffic) picks 30.
 * The longest offered rhythm is a day.
 */
export const MAX_CADENCE_MINUTES = 24 * 60;

/** The rhythms the dashboard offers, in minutes. 0 is "live". */
export const CADENCE_CHOICES = [0, 1, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440];

/** A stored cadence, cleaned: whole minutes in range, 0 when it is nonsense. */
export function normaliseCadence(value) {
  const minutes = Math.trunc(Number(value));
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.min(minutes, MAX_CADENCE_MINUTES);
}

/**
 * How long a point on the map is still worth calling live.
 *
 * The hour the tracker has always used, stretched by the owner's rhythm: a pin
 * that is allowed to move once every three hours is not "stale" after one.
 */
export function liveTtlMs(cadenceMinutes = 0) {
  return FIX_TTL_MS + normaliseCadence(cadenceMinutes) * 60_000;
}

/**
 * How long a fix is worth calling "live". The same hour the tracker uses: past
 * it the site falls back to the dashboard's own "here now" stop rather than
 * showing yesterday's village as today's position.
 */
export const FIX_TTL_MS = 60 * 60 * 1000;

/** A fresh device token: 128 random bits, hex, so it can be typed if needed. */
export function newLiveToken() {
  return crypto.randomBytes(16).toString("hex");
}

/** Compare two tokens without leaking their length of agreement. */
export function sameToken(left, right) {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * The token the phone sent.
 *
 * OwnTracks' HTTP mode has a URL field and optional Basic credentials, so all
 * three of the natural places are accepted: the query string (easiest to
 * paste), Basic's password (the app's own user/password boxes), a bearer header
 * (iOS "HTTP headers"), or an explicit `X-PB-Token`.
 */
export function tokenFromRequest(req) {
  const query = req.query?.token;
  if (typeof query === "string" && query.trim()) return query.trim();

  const auth = String(req.get("authorization") ?? "");
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearer) return bearer[1].trim();

  const basic = /^Basic\s+(.+)$/i.exec(auth);
  if (basic) {
    const decoded = Buffer.from(basic[1], "base64").toString("utf8");
    const password = decoded.slice(decoded.indexOf(":") + 1).trim();
    if (password) return password;
  }

  const header = req.get("x-pb-token");
  return header ? String(header).trim() : "";
}

/** A finite number, or null — OwnTracks omits fields it has no value for. */
function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const round = (value) => Math.round(value * 1e6) / 1e6;

/**
 * One OwnTracks message, as the fix the site will show — or null when it does
 * not carry a usable position.
 *
 * `tst` is the moment the phone took the fix (UNIX seconds, sometimes with a
 * fraction); it is what the site shows as "updated", because that is when the
 * position was true, not when the request happened to arrive.
 */
export function fixFromPayload(body, receivedAt = new Date()) {
  const lat = numberOrNull(body?.lat ?? body?.latitude);
  const lng = numberOrNull(body?.lon ?? body?.lng ?? body?.longitude);
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  const tst = numberOrNull(body?.tst);
  const takenAt = tst && tst > 0 ? new Date(tst * 1000) : receivedAt;
  const when = Number.isNaN(takenAt.getTime()) ? receivedAt : takenAt;

  return {
    lat: round(lat),
    lng: round(lng),
    updatedAt: when.toISOString(),
    accuracyM: numberOrNull(body?.acc),
    altitudeM: numberOrNull(body?.alt),
    speedKmh: numberOrNull(body?.vel),
    battery: numberOrNull(body?.batt),
    /** The phone's own short id, so two devices can be told apart later. */
    device: typeof body?.tid === "string" ? body.tid.slice(0, 8) : "",
    source: "owntracks",
    receivedAt: receivedAt.toISOString(),
  };
}

/** What the phone last said, or null. Bad JSON is treated as "nothing yet". */
export async function readFix(repo) {
  const raw = await repo.getSetting(FIX_KEY);
  if (!raw) return null;
  try {
    const fix = JSON.parse(raw);
    return Number.isFinite(fix?.lat) && Number.isFinite(fix?.lng) ? fix : null;
  } catch {
    return null;
  }
}

/**
 * Which point the map should show right now.
 *
 * `latest` is the newest fix the phone sent and `shown` is what is on the map.
 * With no cadence the newest fix wins at once; otherwise the map holds still
 * until the owner's interval has passed since the pin last moved, then jumps to
 * the freshest fix waiting for it. The first fix is always shown — a rhythm
 * that never starts is not a rhythm.
 *
 * Pure, so both the phone's POST and anybody's GET can ask the same question
 * and get the same answer, and so the rule can be tested without a clock.
 */
export function pickShown({ latest, shown, cadenceMinutes = 0, now = new Date() }) {
  if (!latest) return shown ?? null;
  const cadence = normaliseCadence(cadenceMinutes);
  if (!shown) return { ...latest, shownAt: now.toISOString() };
  // A phone replaying its offline queue can hand over a fix older than the one
  // already on the map. Neither rhythm moves the pin backwards for that.
  if (Date.parse(latest.updatedAt) < Date.parse(shown.updatedAt)) return shown;
  if (cadence === 0) {
    // Already the same point? Leave its shownAt alone so the panel's "on the
    // map since" does not reset on every duplicate fix.
    if (shown.updatedAt === latest.updatedAt && shown.lat === latest.lat && shown.lng === latest.lng) {
      return shown;
    }
    return { ...latest, shownAt: now.toISOString() };
  }
  const movedAt = Date.parse(shown.shownAt ?? shown.receivedAt ?? shown.updatedAt) || 0;
  if (now.getTime() - movedAt < cadence * 60_000) return shown;
  // The phone may have sent nothing new since the pin last moved: keeping the
  // same point is right, and it must not reset the interval either.
  if (Date.parse(latest.updatedAt) <= Date.parse(shown.updatedAt)) return shown;
  return { ...latest, shownAt: now.toISOString() };
}

/** The point stored as being on the map, or null when nothing is stored yet. */
export async function readShown(repo) {
  const raw = await repo.getSetting(SHOWN_KEY);
  if (!raw) return null;
  try {
    const shown = JSON.parse(raw);
    return Number.isFinite(shown?.lat) && Number.isFinite(shown?.lng) ? shown : null;
  } catch {
    return null;
  }
}

/**
 * The point to compare a new fix against.
 *
 * Normally that is the stored one. A site that was already reporting before the
 * owner's rhythm existed has no stored point, so the newest fix stands in — with
 * its own timestamp, never "now", otherwise a legacy site would look as though
 * the pin had just moved and would never move again.
 */
function shownOrLegacy(stored, latest) {
  if (stored) return stored;
  if (!latest) return null;
  return { ...latest, shownAt: latest.receivedAt ?? latest.updatedAt };
}

/** The rhythm the owner chose, in minutes. Unset means live. */
export async function readCadence(repo) {
  return normaliseCadence(await repo.getSetting(CADENCE_KEY));
}

/** The token that already exists, or "" — the phone's side of the question. */
export async function readToken(repo) {
  const saved = await repo.getSetting(TOKEN_KEY);
  return typeof saved === "string" ? saved.trim() : "";
}

/**
 * The device token, made on first use.
 *
 * It is created when the owner opens the panel rather than at install time, so
 * a site that never turns this on carries no unused secret.
 */
export async function liveToken(repo) {
  const saved = await readToken(repo);
  if (saved) return saved;
  const created = newLiveToken();
  await repo.setSetting(TOKEN_KEY, created);
  return created;
}

/** When the pin is allowed to move again, or null while the map is live. */
function nextUpdateAt(shown, cadenceMinutes) {
  const cadence = normaliseCadence(cadenceMinutes);
  if (!shown || cadence === 0) return null;
  const movedAt = Date.parse(shown.shownAt ?? shown.receivedAt ?? shown.updatedAt) || 0;
  return new Date(movedAt + cadence * 60_000).toISOString();
}

/* ── the site reads this ─────────────────────────────────────────────── */

/**
 * Where the pin is, for anybody who may look at the map.
 *
 * Only what a map needs leaves the server: a position, when it was taken, how
 * good it was, and how fast the bike was going. The device id and the battery
 * level stay behind — they are about a person, not about the road.
 *
 * `cadenceMinutes` and `nextUpdateAt` are here so the map can say when it will
 * move next instead of appearing frozen, and so a page can slow its own polling
 * down to the rhythm the owner chose.
 */
liveRouter.get("/live", async (_req, res, next) => {
  try {
    const repo = await getRepo();
    const latest = await readFix(repo);
    if (!latest) return res.json({ fix: null, cadenceMinutes: 0, ttlMs: FIX_TTL_MS });

    const cadenceMinutes = await readCadence(repo);
    const shown = pickShown({
      latest,
      shown: shownOrLegacy(await readShown(repo), latest),
      cadenceMinutes,
    });

    res.json({
      fix: shown
        ? {
            lat: shown.lat,
            lng: shown.lng,
            updatedAt: shown.updatedAt,
            accuracyM: shown.accuracyM ?? null,
            altitudeM: shown.altitudeM ?? null,
            speedKmh: shown.speedKmh ?? null,
          }
        : null,
      cadenceMinutes,
      ttlMs: liveTtlMs(cadenceMinutes),
      nextUpdateAt: nextUpdateAt(shown, cadenceMinutes),
    });
  } catch (error) {
    next(error);
  }
});

/* ── the phone posts this ────────────────────────────────────────────── */

/**
 * OwnTracks' HTTP endpoint.
 *
 * The app expects a JSON array back (messages for it to apply); an empty one
 * means "received, nothing for you". Anything that is not a location — a
 * region transition, a waypoint, a "last will", a configuration dump — is
 * acknowledged and dropped: the site shows where the bike is, nothing more.
 */
liveRouter.post("/live/owntracks", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const expected = await readToken(repo);
    // Nothing is accepted before the owner has switched this on, so an unset
    // site cannot be fed by whoever guesses the address.
    if (!expected) {
      return res.status(403).json({ error: "Live location is not set up on this site yet." });
    }
    if (!sameToken(tokenFromRequest(req), expected)) {
      return res.status(401).json({ error: "Wrong or missing device token." });
    }

    const body = req.body ?? {};
    if (body._type === "encrypted") {
      return res
        .status(400)
        .json({ error: "Turn encryption off in OwnTracks: the site cannot read an encrypted payload." });
    }
    if (body._type !== "location") return res.json([]);

    const fix = fixFromPayload(body);
    if (!fix) return res.status(400).json({ error: "That message has no usable position." });

    // A phone that has been offline can deliver old fixes after a new one has
    // already arrived; the newest position wins, not the last request.
    const previous = await readFix(repo);
    const latest =
      !previous || Date.parse(fix.updatedAt) >= Date.parse(previous.updatedAt) ? fix : previous;
    if (latest !== previous) await repo.setSetting(FIX_KEY, JSON.stringify(latest));

    // …and the pin moves only as often as the owner asked. A fix that arrives
    // early is kept, not dropped: it is what the map will jump to when the
    // interval is up.
    const cadenceMinutes = await readCadence(repo);
    const stored = await readShown(repo);
    const shown = shownOrLegacy(stored, previous);
    const next = pickShown({ latest, shown, cadenceMinutes });
    if (next && next !== stored) await repo.setSetting(SHOWN_KEY, JSON.stringify(next));

    res.json([]);
  } catch (error) {
    next(error);
  }
});

/* ── the dashboard sets it up ────────────────────────────────────────── */

/**
 * What to paste into the phone, and how the last fix looks. Owner only.
 *
 * Both positions are reported: `fix` is the newest thing the phone said and
 * `shown` is what the map has on it. They are the same in live mode, and the
 * difference is exactly what an owner setting a slower rhythm wants to see —
 * "the phone is here, the pin moves there in eleven minutes".
 */
liveRouter.get("/live/setup", requireOwner, async (_req, res, next) => {
  try {
    const repo = await getRepo();
    const token = await liveToken(repo);
    const latest = await readFix(repo);
    const cadenceMinutes = await readCadence(repo);
    const shown = latest
      ? pickShown({ latest, shown: shownOrLegacy(await readShown(repo), latest), cadenceMinutes })
      : null;

    const full = (fix) =>
      fix
        ? {
            lat: fix.lat,
            lng: fix.lng,
            updatedAt: fix.updatedAt,
            accuracyM: fix.accuracyM ?? null,
            altitudeM: fix.altitudeM ?? null,
            speedKmh: fix.speedKmh ?? null,
            battery: fix.battery ?? null,
            device: fix.device ?? "",
          }
        : null;

    res.json({
      token,
      path: OWNTRACKS_PATH,
      ttlMs: liveTtlMs(cadenceMinutes),
      cadenceMinutes,
      choices: CADENCE_CHOICES,
      maxCadenceMinutes: MAX_CADENCE_MINUTES,
      nextUpdateAt: nextUpdateAt(shown, cadenceMinutes),
      shown: full(shown),
      fix: full(latest),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * How often the pin may move. Owner only.
 *
 * `0` is live (every fix); anything else is whole minutes. The change takes
 * effect on the next fix: the pin is not yanked to the newest position the
 * moment the setting is saved, because the rhythm the owner chose is what
 * decides that, not the click.
 */
liveRouter.post("/live/setup/cadence", requireOwner, async (req, res, next) => {
  try {
    const raw = req.body?.minutes;
    // An absent or empty value is a mistake, not an instruction: reading it as
    // 0 would silently put a paced site back into live mode.
    const number = raw === undefined || raw === null || raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(number) || number < 0 || number > MAX_CADENCE_MINUTES) {
      return res.status(400).json({
        error: `Choose between 0 (live) and ${MAX_CADENCE_MINUTES} minutes.`,
      });
    }
    const repo = await getRepo();
    const cadenceMinutes = normaliseCadence(number);
    await repo.setSetting(CADENCE_KEY, String(cadenceMinutes));

    const latest = await readFix(repo);
    const shown = latest
      ? pickShown({ latest, shown: shownOrLegacy(await readShown(repo), latest), cadenceMinutes })
      : null;
    res.json({
      cadenceMinutes,
      ttlMs: liveTtlMs(cadenceMinutes),
      nextUpdateAt: nextUpdateAt(shown, cadenceMinutes),
      shown: shown ? { lat: shown.lat, lng: shown.lng, updatedAt: shown.updatedAt } : null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * A new token: the URL already in the phone stops working, and the dashboard
 * shows the one to paste instead. That is the whole point of having one.
 */
liveRouter.post("/live/setup/token", requireOwner, async (_req, res, next) => {
  try {
    const repo = await getRepo();
    const token = newLiveToken();
    await repo.setSetting(TOKEN_KEY, token);
    res.json({ token, path: OWNTRACKS_PATH });
  } catch (error) {
    next(error);
  }
});

/**
 * Forget the position — for when sharing stops and the pin should go away.
 *
 * Both are cleared: leaving the point behind on `live.shown` would keep a pin
 * on the map that no phone is reporting any more.
 */
liveRouter.delete("/live/fix", requireOwner, async (_req, res, next) => {
  try {
    const repo = await getRepo();
    await repo.setSetting(FIX_KEY, "");
    await repo.setSetting(SHOWN_KEY, "");
    res.json({ fix: null, shown: null });
  } catch (error) {
    next(error);
  }
});
