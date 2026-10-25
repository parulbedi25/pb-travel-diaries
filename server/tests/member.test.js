/**
 * The members' garage, end to end.
 *
 * The real Express app against the in-memory repository: two members sign up,
 * each gets a garage, and neither can see or touch the other's. The sums are
 * checked against a straight-line distance we know by hand, because litres of
 * petrol are the whole point of the feature and a wrong number here would be
 * wrong quietly.
 *
 * The last tests are the ones that matter most: nothing a member does may
 * change the published site.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-member-media-"));
const distDir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-member-dist-"));
process.env.DB_DRIVER = "memory";
process.env.MEDIA_DIR = mediaDir;
process.env.DIST_DIR = distDir;
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_PER_MINUTE = "0";
process.env.BCRYPT_ROUNDS = "4";
process.env.SETUP_LOCKED = "0";

const { createApp } = await import("../app.js");
const { journeyMath, haversineKm } = await import("../lib/tripMath.js");
const { estimateMileage, BIKE_MAKERS } = await import("../lib/bikeCatalogue.js");
const { getRepo } = await import("../db/index.js");

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

/** A client per member: each keeps its own session cookie. */
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

const nangal = { lat: 31.3832213, lng: 76.3765753 };
const chandigarh = { lat: 30.7333, lng: 76.7794 };

let asha;
let ravi;
let ashaBikeId;

test("the catalogue lists the makers a rider in India chooses between", async () => {
  asha = client();
  const res = await asha("GET", "/api/member/catalogue");
  assert.equal(res.status, 200);
  const ids = res.json.makers.map((maker) => maker.id);
  for (const maker of ["hero", "honda", "bajaj", "tvs", "royal-enfield", "yamaha", "suzuki", "ktm"]) {
    assert.ok(ids.includes(maker), `${maker} is offered`);
  }
  for (const maker of res.json.makers) {
    assert.ok(maker.logo.startsWith("/media/bike-makers/"), `${maker.name} has a local logo`);
    assert.ok(maker.urdu.length > 0);
    assert.ok(maker.models.length > 0);
  }
});

test("a mileage left blank is estimated rather than refused", () => {
  const estimate = estimateMileage({ maker: "Hero", model: "Splendor Plus", year: 2022 });
  assert.equal(estimate.source, "estimated");
  assert.ok(estimate.kmpl > 50 && estimate.kmpl <= 70);

  const older = estimateMileage({ maker: "Hero", model: "Splendor Plus", year: 2006 });
  assert.ok(older.kmpl < estimate.kmpl, "an older bike is estimated a little thirstier");

  const unknown = estimateMileage({ maker: "Nobody", model: "Nothing" });
  assert.equal(unknown.kmpl, 45);
});

test("signing up with a bike starts a garage", async () => {
  // The first account is the owner; the second is the member we care about.
  const owner = client();
  assert.equal((await owner("POST", "/api/auth/signup", { username: "parul", password: "ride2026" })).status, 201);
  // Members join by signing up, so the owner opens the door first.
  const opened = await owner("PUT", "/api/settings/site", { title: "PB Travel Diaries", allowSignup: true });
  assert.equal(opened.status, 200);

  const res = await asha("POST", "/api/auth/signup", {
    username: "asha",
    password: "himalaya2026",
    bikeMaker: "Royal Enfield",
    bikeModel: "Himalayan 450",
    bikeYear: 2024,
    bikeMileage: "",
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.user.role, "reader");

  const garage = await asha("GET", "/api/member/garage");
  assert.equal(garage.status, 200);
  assert.equal(garage.json.bikes.length, 1);
  const [bike] = garage.json.bikes;
  ashaBikeId = bike.id;
  assert.equal(bike.maker, "Royal Enfield");
  assert.equal(bike.model, "Himalayan 450");
  assert.equal(bike.year, 2024);
  assert.equal(bike.mileageSource, "estimated");
  assert.ok(bike.mileageKmpl > 0);
});

test("a second bike keeps its own mileage", async () => {
  const res = await asha("POST", "/api/member/bikes", {
    maker: "Hero",
    model: "Splendor Plus",
    year: 2021,
    mileageKmpl: 62,
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.bike.mileageSource, "manual");
  assert.equal(res.json.bike.mileageKmpl, 62);
  assert.equal(res.json.bikes.length, 2);

  const garage = await asha("GET", "/api/member/garage");
  const mileages = garage.json.bikes.map((bike) => bike.mileageKmpl);
  assert.equal(new Set(mileages).size, 2, "both bikes have their own figure");
});

test("a ride is measured one way and round trip, and in litres per bike", async () => {
  const res = await asha("POST", "/api/member/journeys", {
    title: "Nangal to Chandigarh",
    bikeId: ashaBikeId,
    stops: [
      { name: "Nangal", ...nangal },
      { name: "Chandigarh", ...chandigarh },
    ],
    notes: "Chai at Ropar.",
    gallery: [],
    roundTrip: false,
  });
  assert.equal(res.status, 201);
  const { journey } = res.json;

  const expected = haversineKm(nangal, chandigarh);
  assert.ok(Math.abs(journey.maths.oneWayKm - expected) < 0.2, "the distance is the straight line");
  assert.ok(Math.abs(journey.maths.roundTripKm - expected * 2) < 0.4);
  assert.equal(journey.maths.stops, 2);
  assert.equal(journey.maths.legs.length, 1);
  assert.equal(journey.maths.from, "Nangal");

  // Every bike in the garage is measured, not just the chosen one.
  assert.equal(journey.perBike.length, 2);
  for (const row of journey.perBike) {
    assert.ok(row.litresOneWay > 0);
    assert.ok(Math.abs(row.litresRoundTrip - row.litresOneWay * 2) < 0.05);
  }
  const chosen = journey.perBike.find((row) => row.bikeId === ashaBikeId);
  assert.equal(chosen.litresOneWay, journey.maths.litresOneWay);
});

test("petrol arithmetic holds on a ride with no bike chosen", async () => {
  const maths = journeyMath(
    [
      { name: "A", lat: 0, lng: 0 },
      { name: "B", lat: 0, lng: 1 },
    ],
    { kmpl: 0 },
  );
  assert.ok(maths.oneWayKm > 110 && maths.oneWayKm < 112, "a degree of longitude at the equator");
  assert.equal(maths.litresOneWay, null);
  assert.equal(maths.litresRoundTrip, null);
});

test("another member's garage is invisible and untouchable", async () => {
  ravi = client();
  const res = await ravi("POST", "/api/auth/signup", {
    username: "ravi",
    password: "spiti2026",
    bikeMaker: "Honda",
    bikeModel: "SP 125",
  });
  assert.equal(res.status, 201);

  const garage = await ravi("GET", "/api/member/garage");
  assert.equal(garage.json.bikes.length, 1);
  assert.equal(garage.json.bikes[0].model, "SP 125");
  assert.equal(garage.json.journeys.length, 0, "none of Asha's rides leak in");

  // Asha's bike cannot be deleted by Ravi, and the answer does not confirm it exists.
  const del = await ravi("DELETE", `/api/member/bikes/${ashaBikeId}`);
  assert.equal(del.status, 404);
  const still = await asha("GET", "/api/member/bikes");
  assert.equal(still.json.bikes.length, 2);

  // A ride cannot be pinned to a bike outside the member's own garage.
  const bad = await ravi("POST", "/api/member/journeys", {
    title: "Borrowed bike",
    bikeId: ashaBikeId,
    stops: [
      { name: "Nangal", ...nangal },
      { name: "Chandigarh", ...chandigarh },
    ],
  });
  assert.equal(bad.status, 400);
});

test("signed out, the garage does not exist", async () => {
  const anon = client();
  for (const [method, url] of [
    ["GET", "/api/member/garage"],
    ["GET", "/api/member/bikes"],
    ["GET", "/api/member/journeys"],
    ["POST", "/api/member/bikes"],
  ]) {
    const res = await anon(method, url, method === "POST" ? {} : undefined);
    assert.equal(res.status, 401, `${method} ${url} is signed-in only`);
  }
});

test("removing a bike keeps the rides it was used for", async () => {
  const before = await asha("GET", "/api/member/journeys");
  assert.equal(before.json.journeys.length, 1);

  const del = await asha("DELETE", `/api/member/bikes/${ashaBikeId}`);
  assert.equal(del.status, 200);
  assert.equal(del.json.bikes.length, 1);

  const after = await asha("GET", "/api/member/journeys");
  assert.equal(after.json.journeys.length, 1, "the ride survives");
  assert.equal(after.json.journeys[0].bikeId, null, "it just no longer points at a bike");
  assert.ok(after.json.journeys[0].maths.oneWayKm > 0, "and still knows its distance");
});

test("deleting an account takes its garage with it", async () => {
  const owner = client();
  assert.equal((await owner("POST", "/api/auth/login", { username: "parul", password: "ride2026" })).status, 200);

  const roster = await owner("GET", "/api/auth/users");
  const ravi = roster.json.users.find((user) => user.username === "ravi");
  assert.ok(ravi, "Ravi has an account");

  const repo = await getRepo();
  assert.equal((await repo.listBikes(ravi.id)).length, 1, "his bike is there to begin with");

  assert.equal((await owner("DELETE", `/api/auth/users/${ravi.id}`)).status, 200);
  assert.deepEqual(await repo.listBikes(ravi.id), [], "the garage went with him");
  assert.deepEqual(await repo.listJourneys(ravi.id), []);
});

test("a member's rides never publish to the site", async () => {
  const content = await asha("GET", "/api/content");
  assert.equal(content.json.content, null, "nothing was written to the site's content");

  // And the dashboard's own write path still refuses a reader.
  const publish = await asha("PUT", "/api/content", {
    content: { v: 1, sections: [], nav: [] },
    description: "nope",
    revisionId: "rev-member-test",
  });
  assert.equal(publish.status, 403);
});

test("every maker's models carry a mileage worth estimating from", () => {
  for (const maker of BIKE_MAKERS) {
    for (const model of maker.models) {
      assert.ok(model.kmpl > 15 && model.kmpl < 120, `${maker.name} ${model.name}`);
      assert.ok(model.cc > 0);
    }
  }
});
