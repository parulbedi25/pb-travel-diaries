/**
 * The phone's own fixes.
 *
 * The tracker, the live map and the nearby page all read `/api/live`, and a
 * free Android app (OwnTracks) posts to `/api/live/owntracks`. These tests drive
 * the real Express app against the in-memory repository, so the thing being
 * proved is the whole path a fix takes: token, validation, storage, and what a
 * visitor is allowed to see.
 *
 * What matters, in order:
 *  - Nothing is accepted before the owner switches it on, and a wrong token is
 *    refused — the endpoint is on the public internet.
 *  - The newest fix wins, even when an older one arrives later (a phone that
 *    was out of signal replays its queue).
 *  - Only a position and its quality leave the server; the device id and the
 *    battery level stay in the dashboard.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";

process.env.DB_DRIVER = "memory";
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_PER_MINUTE = "0";
process.env.BCRYPT_ROUNDS = "4";

const { createApp } = await import("../app.js");
const {
  CADENCE_CHOICES,
  MAX_CADENCE_MINUTES,
  fixFromPayload,
  liveTtlMs,
  normaliseCadence,
  pickShown,
  sameToken,
  tokenFromRequest,
} = await import("../routes/live.js");

const app = createApp();
let server;
let base;
let session = "";

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** A small client that carries the dashboard session, like a browser would. */
async function call(method, url, body, headers = {}) {
  const all = { ...headers };
  if (session) all.Cookie = `pb_session=${session}`;
  let payload;
  if (body !== undefined) {
    all["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(base + url, { method, headers: all, body: payload });
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const match = /pb_session=([^;]*)/.exec(line);
    if (match?.[1]) session = match[1];
  }
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

/** One OwnTracks message, as the Android app posts it. */
const ownTracksFix = (overrides = {}) => ({
  _type: "location",
  lat: 31.369,
  lon: 76.3729,
  tst: Math.floor(Date.now() / 1000),
  acc: 8,
  alt: 350,
  vel: 42,
  batt: 88,
  tid: "PB",
  ...overrides,
});

test("a site that has not switched this on refuses every fix", async () => {
  const res = await call("POST", "/api/live/owntracks", ownTracksFix(), {
    Authorization: "Bearer anything",
  });
  assert.equal(res.status, 403);
});

test("the newest fix is empty until a phone reports", async () => {
  const res = await call("GET", "/api/live");
  assert.equal(res.status, 200);
  assert.equal(res.json.fix, null);
});

test("the owner gets a token and a path to paste into the phone", async () => {
  const signup = await call("POST", "/api/auth/signup", {
    username: "parul",
    password: "ride2026",
    email: "parul@example.com",
  });
  assert.equal(signup.status, 201);
  assert.equal(signup.json.user.role, "owner");

  const setup = await call("GET", "/api/live/setup");
  assert.equal(setup.status, 200);
  assert.match(setup.json.token, /^[0-9a-f]{32}$/);
  assert.equal(setup.json.path, "/api/live/owntracks");
  assert.equal(setup.json.fix, null);
  // The token is stable: opening the panel again shows the same URL.
  const again = await call("GET", "/api/live/setup");
  assert.equal(again.json.token, setup.json.token);
});

test("a wrong token is refused, the right one is stored", async () => {
  const { token } = (await call("GET", "/api/live/setup")).json;

  const wrong = await call("POST", `/api/live/owntracks?token=${"0".repeat(32)}`, ownTracksFix());
  assert.equal(wrong.status, 401);
  assert.equal((await call("GET", "/api/live")).json.fix, null);

  const right = await call("POST", `/api/live/owntracks?token=${token}`, ownTracksFix());
  assert.equal(right.status, 200);
  // OwnTracks expects an array of messages back; an empty one is "received".
  assert.deepEqual(right.json, []);

  const seen = (await call("GET", "/api/live")).json.fix;
  assert.equal(seen.lat, 31.369);
  assert.equal(seen.lng, 76.3729);
  assert.equal(seen.accuracyM, 8);
  assert.equal(seen.altitudeM, 350);
  assert.equal(seen.speedKmh, 42);
  // Battery and device id are about a person, not about the road.
  assert.equal(seen.battery, undefined);
  assert.equal(seen.device, undefined);
});

test("the token is accepted as a HTTP Basic password and as a bearer header", async () => {
  const { token } = (await call("GET", "/api/live/setup")).json;
  const basic = `Basic ${Buffer.from(`pixel:${token}`).toString("base64")}`;

  const viaBasic = await call("POST", "/api/live/owntracks", ownTracksFix({ lat: 32.2432, lon: 77.1892, tst: Math.floor(Date.now() / 1000) + 5 }), {
    Authorization: basic,
  });
  assert.equal(viaBasic.status, 200);
  assert.equal((await call("GET", "/api/live")).json.fix.lat, 32.2432);

  const viaBearer = await call("POST", "/api/live/owntracks", ownTracksFix({ lat: 34.1526, lon: 77.5771, tst: Math.floor(Date.now() / 1000) + 10 }), {
    Authorization: `Bearer ${token}`,
  });
  assert.equal(viaBearer.status, 200);
  assert.equal((await call("GET", "/api/live")).json.fix.lat, 34.1526);
});

test("an older fix delivered late does not move the bike backwards", async () => {
  const { token } = (await call("GET", "/api/live/setup")).json;
  const now = Math.floor(Date.now() / 1000);
  await call("POST", `/api/live/owntracks?token=${token}`, ownTracksFix({ tst: now }));
  await call("POST", `/api/live/owntracks?token=${token}`, ownTracksFix({ lat: 30.9, lon: 75.8, tst: now - 3600 }));
  assert.notEqual((await call("GET", "/api/live")).json.fix.lat, 30.9);
});

test("messages that are not a position are acknowledged and ignored", async () => {
  const { token } = (await call("GET", "/api/live/setup")).json;
  for (const body of [
    { _type: "transition", lat: 31.4, lon: 76.4, tst: Math.floor(Date.now() / 1000) },
    { _type: "waypoint", lat: 31.4, lon: 76.4 },
    { _type: "lwt" },
  ]) {
    const res = await call("POST", `/api/live/owntracks?token=${token}`, body);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, []);
  }
  const encrypted = await call("POST", `/api/live/owntracks?token=${token}`, { _type: "encrypted" });
  assert.equal(encrypted.status, 400);
  assert.match(encrypted.json.error, /encryption/i);
});

test("a position off the planet is refused", async () => {
  const { token } = (await call("GET", "/api/live/setup")).json;
  const res = await call("POST", `/api/live/owntracks?token=${token}`, ownTracksFix({ lat: 991, lon: 0 }));
  assert.equal(res.status, 400);
});

test("a new token retires the old URL", async () => {
  const before = (await call("GET", "/api/live/setup")).json.token;
  const rotated = await call("POST", "/api/live/setup/token", {});
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.json.token, before);
  assert.match(rotated.json.token, /^[0-9a-f]{32}$/);

  const old = await call("POST", `/api/live/owntracks?token=${before}`, ownTracksFix());
  assert.equal(old.status, 401);
  assert.equal((await call("POST", `/api/live/owntracks?token=${rotated.json.token}`, ownTracksFix())).status, 200);
});

test("only the signed-in owner may read the setup or clear the fix", async () => {
  const saved = session;
  session = "";
  assert.equal((await call("GET", "/api/live/setup")).status, 401);
  assert.equal((await call("DELETE", "/api/live/fix")).status, 401);
  session = saved;

  const cleared = await call("DELETE", "/api/live/fix");
  assert.equal(cleared.status, 200);
  assert.equal((await call("GET", "/api/live")).json.fix, null);
});

/* ── the owner's rhythm ─────────────────────────────────────────────── */

test("a new site follows the phone live", async () => {
  const setup = await call("GET", "/api/live/setup");
  assert.equal(setup.json.cadenceMinutes, 0);
  assert.deepEqual(setup.json.choices, CADENCE_CHOICES);
  assert.equal(setup.json.maxCadenceMinutes, MAX_CADENCE_MINUTES);
});

test("the owner can slow the pin down, and only the owner", async () => {
  const saved = session;
  session = "";
  assert.equal((await call("POST", "/api/live/setup/cadence", { minutes: 30 })).status, 401);
  session = saved;

  const paced = await call("POST", "/api/live/setup/cadence", { minutes: 30 });
  assert.equal(paced.status, 200);
  assert.equal(paced.json.cadenceMinutes, 30);
  // Three hours of rhythm means a point is still "live" well past the old hour.
  assert.equal(paced.json.ttlMs, 60 * 60_000 + 30 * 60_000);
  assert.equal((await call("GET", "/api/live/setup")).json.cadenceMinutes, 30);
});

test("a nonsense rhythm is refused rather than stored", async () => {
  for (const minutes of [-5, "soon", "", null, MAX_CADENCE_MINUTES + 1]) {
    const res = await call("POST", "/api/live/setup/cadence", { minutes });
    assert.equal(res.status, 400, String(minutes));
  }
  // Still the 30 chosen above: a bad request changes nothing.
  assert.equal((await call("GET", "/api/live/setup")).json.cadenceMinutes, 30);
});

test("inside the rhythm the pin stays put while the phone keeps reporting", async () => {
  const { token } = (await call("GET", "/api/live/setup")).json;
  const now = Math.floor(Date.now() / 1000);

  // The first fix is always shown — a rhythm that never starts is not a rhythm.
  await call("POST", `/api/live/owntracks?token=${token}`, ownTracksFix({ lat: 31.1, lon: 76.1, tst: now }));
  assert.equal((await call("GET", "/api/live")).json.fix.lat, 31.1);

  // A newer fix arrives a second later: the phone has moved, the map has not.
  await call("POST", `/api/live/owntracks?token=${token}`, ownTracksFix({ lat: 31.5, lon: 76.5, tst: now + 1 }));
  const onMap = (await call("GET", "/api/live")).json;
  assert.equal(onMap.fix.lat, 31.1);
  assert.equal(onMap.cadenceMinutes, 30);
  assert.ok(onMap.nextUpdateAt, "the map knows when it may move next");

  // The dashboard shows both, which is what makes the pause explainable.
  const setup = (await call("GET", "/api/live/setup")).json;
  assert.equal(setup.shown.lat, 31.1);
  assert.equal(setup.fix.lat, 31.5);
});

test("switching back to live moves the pin on the next fix", async () => {
  const { token } = (await call("GET", "/api/live/setup")).json;
  await call("POST", "/api/live/setup/cadence", { minutes: 0 });
  const now = Math.floor(Date.now() / 1000) + 10;
  await call("POST", `/api/live/owntracks?token=${token}`, ownTracksFix({ lat: 32.7, lon: 77.7, tst: now }));

  const live = (await call("GET", "/api/live")).json;
  assert.equal(live.fix.lat, 32.7);
  assert.equal(live.cadenceMinutes, 0);
  assert.equal(live.nextUpdateAt, null);
  // And the dashboard no longer reports a point waiting behind the pin.
  const setup = (await call("GET", "/api/live/setup")).json;
  assert.equal(setup.shown.lat, setup.fix.lat);
});

test("clearing the fix clears the pin too", async () => {
  assert.equal((await call("DELETE", "/api/live/fix")).status, 200);
  assert.equal((await call("GET", "/api/live")).json.fix, null);
  const setup = (await call("GET", "/api/live/setup")).json;
  assert.equal(setup.fix, null);
  assert.equal(setup.shown, null);
});

/* ── the small pieces, on their own ─────────────────────────────────── */

test("fixFromPayload reads the app's field names and keeps the phone's time", () => {
  const fix = fixFromPayload({ _type: "location", lat: 31.369, lon: 76.3729, tst: 1_767_225_600 });
  assert.equal(fix.lat, 31.369);
  assert.equal(fix.lng, 76.3729);
  assert.equal(fix.updatedAt, new Date(1_767_225_600_000).toISOString());
  assert.equal(fix.source, "owntracks");
  // An iOS message may spell the position out in full.
  assert.equal(fixFromPayload({ latitude: -33.8688, longitude: 151.2093 }).lat, -33.8688);
  // Nothing usable is null, not a pin at 0,0 in the Gulf of Guinea.
  assert.equal(fixFromPayload({ _type: "location" }), null);
  assert.equal(fixFromPayload({ lat: 10 }), null);
});

test("sameToken compares whole tokens and refuses empties", () => {
  assert.equal(sameToken("abc123", "abc123"), true);
  assert.equal(sameToken("abc123", "abc124"), false);
  assert.equal(sameToken("abc", "abcd"), false);
  assert.equal(sameToken("", ""), false);
});

test("tokenFromRequest reads the query, the header and Basic's password", () => {
  const from = (headers, query = {}) => ({
    query,
    get: (name) => headers[name.toLowerCase()],
  });
  assert.equal(tokenFromRequest(from({}, { token: " q1 " })), "q1");
  assert.equal(tokenFromRequest(from({ authorization: "Bearer b2" })), "b2");
  assert.equal(
    tokenFromRequest(from({ authorization: `Basic ${Buffer.from("pixel:k3").toString("base64")}` })),
    "k3",
  );
  assert.equal(tokenFromRequest(from({ "x-pb-token": "h4" })), "h4");
  assert.equal(tokenFromRequest(from({})), "");
});

test("normaliseCadence keeps whole minutes in range", () => {
  assert.equal(normaliseCadence(0), 0);
  assert.equal(normaliseCadence(15), 15);
  assert.equal(normaliseCadence("30"), 30);
  assert.equal(normaliseCadence(12.7), 12);
  assert.equal(normaliseCadence(-3), 0);
  assert.equal(normaliseCadence("soon"), 0);
  assert.equal(normaliseCadence(null), 0);
  assert.equal(normaliseCadence(MAX_CADENCE_MINUTES + 500), MAX_CADENCE_MINUTES);
});

test("a slower rhythm stretches how long a point counts as live", () => {
  const hour = 60 * 60_000;
  assert.equal(liveTtlMs(0), hour);
  assert.equal(liveTtlMs(30), hour + 30 * 60_000);
  assert.equal(liveTtlMs(360), hour + 6 * 60 * 60_000);
});

test("pickShown paces the pin and never invents a position", () => {
  const at = (iso) => new Date(iso);
  const first = { lat: 31.1, lng: 76.1, updatedAt: "2026-10-30T10:00:00.000Z" };
  const second = { lat: 31.5, lng: 76.5, updatedAt: "2026-10-30T10:05:00.000Z" };

  // Nothing to show yet.
  assert.equal(pickShown({ latest: null, shown: null, cadenceMinutes: 30 }), null);

  // The first fix always goes on the map.
  const shownFirst = pickShown({ latest: first, shown: null, cadenceMinutes: 30, now: at("2026-10-30T10:00:05Z") });
  assert.equal(shownFirst.lat, 31.1);
  assert.equal(shownFirst.shownAt, "2026-10-30T10:00:05.000Z");

  // Five minutes into a thirty-minute rhythm: the pin holds.
  const held = pickShown({ latest: second, shown: shownFirst, cadenceMinutes: 30, now: at("2026-10-30T10:05:00Z") });
  assert.equal(held, shownFirst, "the same object — nothing moved");

  // Thirty-one minutes later: the map jumps to the fix that was waiting.
  const moved = pickShown({ latest: second, shown: shownFirst, cadenceMinutes: 30, now: at("2026-10-30T10:31:00Z") });
  assert.equal(moved.lat, 31.5);
  assert.equal(moved.shownAt, "2026-10-30T10:31:00.000Z");

  // Live mode never waits.
  assert.equal(
    pickShown({ latest: second, shown: shownFirst, cadenceMinutes: 0, now: at("2026-10-30T10:05:01Z") }).lat,
    31.5,
  );

  // A late, older fix must not drag the pin backwards.
  const backwards = pickShown({ latest: first, shown: moved, cadenceMinutes: 0, now: at("2026-10-30T10:40:00Z") });
  assert.equal(backwards, moved);

  // The same point again does not reset "on the map since".
  const same = pickShown({ latest: moved, shown: moved, cadenceMinutes: 30, now: at("2026-10-30T10:45:00Z") });
  assert.equal(same, moved);
});
