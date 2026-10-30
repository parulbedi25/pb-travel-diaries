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
 */
import crypto from "node:crypto";
import express from "express";
import { getRepo } from "../db/index.js";
import { requireOwner } from "../lib/auth.js";

export const liveRouter = express.Router();

/** Where the phone posts. Also the path the dashboard shows. */
export const OWNTRACKS_PATH = "/api/live/owntracks";

/** Settings keys. The token is the phone's password; the fix is the last ping. */
const TOKEN_KEY = "live.token";
const FIX_KEY = "live.fix";

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

/* ── the site reads this ─────────────────────────────────────────────── */

/**
 * The newest fix, for anybody who may look at the map.
 *
 * Only what a map needs leaves the server: a position, when it was taken, how
 * good it was, and how fast the bike was going. The device id and the battery
 * level stay behind — they are about a person, not about the road.
 */
liveRouter.get("/live", async (_req, res, next) => {
  try {
    const fix = await readFix(await getRepo());
    if (!fix) return res.json({ fix: null });
    res.json({
      fix: {
        lat: fix.lat,
        lng: fix.lng,
        updatedAt: fix.updatedAt,
        accuracyM: fix.accuracyM ?? null,
        altitudeM: fix.altitudeM ?? null,
        speedKmh: fix.speedKmh ?? null,
      },
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
    if (!previous || Date.parse(fix.updatedAt) >= Date.parse(previous.updatedAt)) {
      await repo.setSetting(FIX_KEY, JSON.stringify(fix));
    }
    res.json([]);
  } catch (error) {
    next(error);
  }
});

/* ── the dashboard sets it up ────────────────────────────────────────── */

/** What to paste into the phone, and how the last fix looks. Owner only. */
liveRouter.get("/live/setup", requireOwner, async (_req, res, next) => {
  try {
    const repo = await getRepo();
    const token = await liveToken(repo);
    const fix = await readFix(repo);
    res.json({
      token,
      path: OWNTRACKS_PATH,
      ttlMs: FIX_TTL_MS,
      fix: fix
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
        : null,
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

/** Forget the last fix — for when sharing stops and the pin should go away. */
liveRouter.delete("/live/fix", requireOwner, async (_req, res, next) => {
  try {
    const repo = await getRepo();
    await repo.setSetting(FIX_KEY, "");
    res.json({ fix: null });
  } catch (error) {
    next(error);
  }
});
