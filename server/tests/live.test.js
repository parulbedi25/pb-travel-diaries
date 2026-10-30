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
const { fixFromPayload, sameToken, tokenFromRequest } = await import("../routes/live.js");

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
