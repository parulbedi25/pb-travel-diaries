/**
 * Alerts about the road ahead.
 *
 * Three things are checked here, in the order they happen: the judgement
 * (which forecast is worth waking somebody up for), the sweep (route in, alerts
 * stored) and the API a member actually calls — including that a member cannot
 * post a notice, and that one member reading their alerts does not read
 * anybody else's.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-alerts-media-"));
const distDir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-alerts-dist-"));
process.env.DB_DRIVER = "memory";
process.env.MEDIA_DIR = mediaDir;
process.env.DIST_DIR = distDir;
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_PER_MINUTE = "0";
process.env.BCRYPT_ROUNDS = "4";
process.env.SETUP_LOCKED = "0";

const { createApp } = await import("../app.js");
const { getRepo } = await import("../db/index.js");
const { alertsFromForecast, hazardForCode, WEATHER_ALERT_HOURS } = await import("../lib/weatherAlerts.js");
const { routeStopsFromContent, sweepRouteAlerts, fetchForecasts } = await import("../lib/alertSweeper.js");

const app = createApp();
let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(mediaDir, { recursive: true, force: true });
  await fs.rm(distDir, { recursive: true, force: true });
});

function client() {
  const jar = { session: "" };
  return async function call(method, url, body) {
    const headers = {};
    if (jar.session) headers.Cookie = `pb_session=${jar.session}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(base + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const match = /pb_session=([^;]*)/.exec(line);
      if (match) jar.session = match[1];
    }
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  };
}

const nangal = { name: "Nangal, Punjab", lat: 31.3832213, lng: 76.3765753 };
const leh = { name: "Leh", lat: 34.1629883, lng: 77.5856195 };

/** One stop's forecast, in Open-Meteo's shape. */
const forecast = ({ temp = 12, code = 0, wind = 8, min = 6, max = 18 } = {}) => ({
  current: { temperature_2m: temp, weather_code: code, wind_speed_10m: wind },
  daily: {
    weather_code: [code, code, code],
    temperature_2m_max: [max, max, max],
    temperature_2m_min: [min, min, min],
  },
});

test("the forecast is read for the weather a rider would turn back for", () => {
  assert.equal(hazardForCode(0), null, "a clear sky is not news");
  assert.equal(hazardForCode(3), null);
  assert.equal(hazardForCode(95).kind, "thunder");
  assert.equal(hazardForCode(65).kind, "rain");
  assert.equal(hazardForCode(75).kind, "snow");
  assert.equal(hazardForCode(66).kind, "ice");
  assert.equal(hazardForCode(45).kind, "fog");
  // The codes a mountain pass actually throws at you: a 95 at Leh outranks a
  // 61 at Nangal, because severity, not distance, decides the order.
  const alerts = alertsFromForecast(
    [nangal, leh],
    [forecast({ code: 65, temp: 24 }), forecast({ code: 95, temp: 4, wind: 62 })],
    { now: new Date("2026-10-28T06:00:00Z"), routeSignature: "sig" },
  );
  const warnings = alerts.filter((alert) => alert.severity === "warning");
  assert.equal(warnings.length, 2, "both stops are a warning");
  assert.equal(warnings[0].place, "Nangal, Punjab");
  assert.match(warnings[0].title, /Heavy rain/i);
  assert.equal(warnings[1].place, "Leh");
  assert.match(warnings[1].title, /Thunderstorm/i);
  assert.match(alerts.at(-1).title, /wind at Leh/i, "the wind at Leh is a watch, below them");
  for (const alert of alerts) {
    assert.match(alert.dedupeKey, /^wx:\d{4}-\d{2}-\d{2}:/, "the key names the day");
    assert.equal(alert.routeSignature, "sig");
    assert.ok(WEATHER_ALERT_HOURS > 0);
  }
});

test("heat, hard frost and wind are alerts even under a clear sky", () => {
  const alerts = alertsFromForecast(
    [nangal, leh],
    [forecast({ temp: 43, code: 0, max: 43 }), forecast({ temp: -8, code: 0, min: -9, wind: 55 })],
    { now: new Date("2026-06-01T06:00:00Z"), routeSignature: "sig2" },
  );
  const titles = alerts.map((alert) => alert.title).join(" | ");
  assert.match(titles, /43°C at Nangal/, "43°C is worth a word");
  assert.match(titles, /-9°C at Leh/);
  assert.ok(alerts.every((alert) => alert.severity === "watch"));
});

test("the same weather twice is stored once", async () => {
  const repo = { rows: [], async insertAlerts(rows) { const fresh = rows.filter((row) => !this.rows.some((seen) => seen.dedupeKey === row.dedupeKey)); this.rows.push(...fresh); return fresh.length; } };
  const content = {
    sections: [
      { type: "live", data: { stops: [nangal, leh], routeSignature: "abc" } },
    ],
  };
  const fakeRepo = { ...repo, async getContent() { return { content: JSON.stringify(content) }; } };
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return [forecast({ code: 95, temp: 5 }), forecast({ code: 0, temp: 2 })];
    },
  });

  const first = await sweepRouteAlerts({ repo: fakeRepo, now: new Date("2026-10-28T06:00:00Z"), fetchImpl });
  assert.deepEqual({ stops: first.stops, raised: first.raised, inserted: first.inserted }, { stops: 2, raised: 1, inserted: 1 });

  const again = await sweepRouteAlerts({ repo: fakeRepo, now: new Date("2026-10-28T06:30:00Z"), fetchImpl });
  assert.equal(again.inserted, 0, "the second sweep of the same weather adds nothing");
  assert.equal(fakeRepo.rows.length, 1);
});

test("a site with no route asks the weather service for nothing", async () => {
  const repo = { async getContent() { return { content: JSON.stringify({ sections: [] }) }; }, async insertAlerts() { throw new Error("should not be called"); } };
  const result = await sweepRouteAlerts({ repo, fetchImpl: () => { throw new Error("no network either"); } });
  assert.equal(result.skipped, "no-route");
  assert.deepEqual(routeStopsFromContent(JSON.stringify({ sections: [] })), { stops: [], signature: "" });
});

test("the request carries every stop in one call", async () => {
  let seen = null;
  const fetchImpl = async (url) => {
    seen = url;
    return { ok: true, async json() { return [forecast(), forecast()]; } };
  };
  const forecasts = await fetchForecasts([nangal, leh], { fetchImpl });
  assert.equal(forecasts.length, 2);
  const params = new URL(seen).searchParams;
  assert.equal(params.get("latitude"), "31.3832,34.1630");
  assert.ok(params.get("current").includes("weather_code"));
  assert.equal(params.get("timezone"), "Asia/Kolkata");
});

let owner;
let asha;
let ravi;

test("only a signed-in account sees the alert list", async () => {
  owner = client();
  asha = client();
  ravi = client();

  const anonymous = await client()("GET", "/api/alerts");
  assert.equal(anonymous.status, 401);

  assert.equal((await owner("POST", "/api/auth/signup", { username: "parul", password: "ride2026" })).status, 201);
  assert.equal((await owner("PUT", "/api/settings/site", { title: "PB Travel Diaries", allowSignup: true })).status, 200);
  assert.equal((await asha("POST", "/api/auth/signup", { username: "asha", password: "ride2026" })).status, 201);
  assert.equal((await ravi("POST", "/api/auth/signup", { username: "ravi", password: "ride2026" })).status, 201);

  const empty = await asha("GET", "/api/alerts");
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.alerts, []);
  assert.equal(empty.json.unread, 0);
  assert.equal(empty.json.canPost, false, "a member cannot post a road notice");
  assert.equal((await owner("GET", "/api/alerts")).json.canPost, true);
});

test("a member cannot post a road closure", async () => {
  const res = await asha("POST", "/api/alerts", { title: "NH-503 blocked at Ropar", hours: 6 });
  assert.equal(res.status, 403);
});

test("the owner posts a closure and every member sees it", async () => {
  const res = await owner("POST", "/api/alerts", {
    title: "NH-503 blocked at Ropar",
    body: "Landslide near the Ropar bend; diversions through Morinda.",
    place: "Ropar, Punjab",
    hours: 6,
    severity: "warning",
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.inserted, 1);

  for (const member of [asha, ravi]) {
    const list = await member("GET", "/api/alerts");
    assert.equal(list.status, 200);
    const road = list.json.alerts.find((alert) => alert.kind === "road");
    assert.ok(road, "the notice is in the member's list");
    assert.equal(road.read, false);
    assert.equal(list.json.unread, 1);
    assert.ok(road.expiresAt, "and it expires on its own");
  }
});

test("one member reading their list leaves the other's unread", async () => {
  const read = await asha("POST", "/api/alerts/read", {});
  assert.equal(read.status, 200);
  assert.ok(read.json.marked >= 1);

  const ashaList = await asha("GET", "/api/alerts");
  assert.equal(ashaList.json.unread, 0, "read for Asha");
  const raviList = await ravi("GET", "/api/alerts");
  assert.equal(raviList.json.unread, 1, "still unread for Ravi");
});

test("a notice put up without a headline is refused in words", async () => {
  const res = await owner("POST", "/api/alerts", { title: "  ", hours: 6 });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /headline/i);

  const tooLong = await owner("POST", "/api/alerts", { title: "Closed ".repeat(40), hours: 6 });
  assert.equal(tooLong.status, 400);

  const badHours = await owner("POST", "/api/alerts", { title: "Bridge out at Sundernagar", hours: 0 });
  assert.equal(badHours.status, 400);
});

test("a road reopens and the notice comes down", async () => {
  const list = await owner("GET", "/api/alerts");
  const road = list.json.alerts.find((alert) => alert.kind === "road");
  assert.ok(road);
  assert.equal((await owner("DELETE", `/api/alerts/${road.id}`)).status, 200);
  assert.equal((await owner("DELETE", `/api/alerts/${road.id}`)).status, 404, "the second time it is already gone");

  const after = await ravi("GET", "/api/alerts");
  assert.equal(after.json.alerts.some((alert) => alert.id === road.id), false);
});

test("the repository keeps alerts ordered, deduped and expiring", async () => {
  const repo = await getRepo();
  const now = Date.now();
  const inserted = await repo.insertAlerts([
    { kind: "weather", severity: "watch", title: "Fog at Mandi", place: "Mandi", dedupeKey: "r1", expiresAt: new Date(now + 30_000).toISOString() },
    { kind: "weather", severity: "warning", title: "Snow at Rohtang", place: "Rohtang", dedupeKey: "r2", expiresAt: new Date(now + 60_000).toISOString() },
    { kind: "weather", severity: "watch", title: "Fog at Mandi", place: "Mandi", dedupeKey: "r1", expiresAt: new Date(now + 30_000).toISOString() },
  ]);
  assert.equal(inserted, 2, "a duplicate key is not stored twice");

  const list = await repo.listAlerts({ now: new Date(now).toISOString() });
  assert.equal(list.length, 2);
  assert.equal(list[0].title, "Snow at Rohtang", "newest first");

  const pruned = await repo.pruneAlerts(new Date(now + 45_000).toISOString());
  assert.equal(pruned, 1, "only the expired one is cleared out");
  assert.deepEqual((await repo.listAlerts({ now: new Date(now).toISOString() })).map((alert) => alert.place), ["Rohtang"]);
});
