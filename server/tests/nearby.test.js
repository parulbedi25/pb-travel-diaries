/**
 * The nearby search: what it asks Geoapify, and what it does when the answer is
 * a refusal, an empty town or no town at all.
 *
 * Two questions decide everything here — is this a settlement, and what is
 * inside its boundary — so most of these tests are about the boundary: a
 * county must not be mistaken for a town, a boundary wider than the cap must
 * not be used, and a town with nothing in it must come back empty rather than
 * answering with the next town's places.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// The endpoint test boots the real app, so the driver has to be the in-memory
// one before anything imports the database.
const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-nearby-media-"));
const distDir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-nearby-dist-"));
process.env.DB_DRIVER = "memory";
process.env.MEDIA_DIR = mediaDir;
process.env.DIST_DIR = distDir;
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_PER_MINUTE = "0";
process.env.BCRYPT_ROUNDS = "4";
process.env.SETUP_LOCKED = "0";
delete process.env.GEOAPIFY_KEY;

const {
  KINDS,
  KIND_CATEGORIES,
  MAX_AREA_SPAN_KM,
  boundsFromBbox,
  spanKmOf,
  kmBetween,
  areaFor,
  itemFromFeature,
  rankItems,
  searchNearby,
  searchNearbyCached,
  clearNearbyCache,
} = await import("../lib/nearbySearch.js");

const KEY = "test-key";
const leh = { lat: 34.1526, lng: 77.5771 };

/* ── fakes ───────────────────────────────────────────────────────────── */

const ok = (body) => ({ ok: true, status: 200, async json() { return body; } });
const fail = (status) => ({ ok: false, status, async json() { return {}; } });

/** A geocode hit for Leh, in the shape Geoapify returns. */
const LEH_HIT = {
  name: "Leh",
  city: "Leh",
  result_type: "city",
  place_id: "leh-boundary",
  bbox: { lon1: 77.4, lat1: 34.0, lon2: 77.8, lat2: 34.3 },
};

/** One Geoapify feature, the way the Places API ships it. */
function feature({ name, categories, coord = [77.58, 34.16], tags = {}, ...rest }) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: coord },
    properties: {
      name,
      categories,
      place_id: `${name}-${coord.join(",")}`,
      datasource: { sourcename: "openstreetmap", raw: { name, ...tags } },
      ...rest,
    },
  };
}

const isGeocode = (url) => url.includes("/v1/geocode/");
const isPlaces = (url) => url.includes("/v2/places");

/** A fetch that answers the two endpoints from one handler each. */
function fakeFetch(handler) {
  const calls = [];
  const run = async (url) => {
    calls.push(String(url));
    return handler(String(url));
  };
  run.calls = calls;
  return run;
}

/* ── the maths ───────────────────────────────────────────────────────── */

test("a box is read from its corners, whichever way round they arrive", () => {
  const bounds = boundsFromBbox({ lon1: 77.8, lat1: 34.3, lon2: 77.4, lat2: 34.0 });
  assert.deepEqual(bounds, { south: 34.0, north: 34.3, west: 77.4, east: 77.8 });
  assert.equal(boundsFromBbox({ lon1: "x" }), null);
});

test("a box is as wide as its longer side, not its diagonal", () => {
  // One degree of latitude is ~111 km; a degree of longitude at this latitude
  // is a good deal less, so the height is the longer side.
  const span = spanKmOf({ south: 34, north: 35, west: 77, east: 77.1 });
  assert.ok(span > 110 && span < 112, `expected about 111 km, got ${span}`);
});

test("distance is great-circle kilometres", () => {
  const km = kmBetween({ lat: 31.3832, lng: 76.3766 }, { lat: 31.3832, lng: 76.3766 });
  assert.equal(km, 0);
  assert.ok(kmBetween({ lat: 31.38, lng: 76.37 }, { lat: 32.24, lng: 77.19 }) > 100);
});

/* ── the town ────────────────────────────────────────────────────────── */

test("the town is asked for as a city, and its boundary is what comes back", async () => {
  const fetchImpl = fakeFetch(() => ok({ results: [LEH_HIT] }));
  const area = await areaFor({ place: "Leh", ...leh, key: KEY, fetchImpl });
  assert.equal(area.city, true);
  assert.equal(area.label, "Leh");
  assert.equal(area.placeId, "leh-boundary");
  assert.ok(area.spanKm > 0 && area.spanKm <= MAX_AREA_SPAN_KM);
  assert.match(fetchImpl.calls[0], /type=city/);
});

test("a county is not a town, and is not accepted as one", async () => {
  const fetchImpl = fakeFetch(() =>
    ok({
      results: [
        { ...LEH_HIT, result_type: "county", city: "Rupnagar", place_id: "county-1" },
        { ...LEH_HIT, result_type: "state", place_id: "state-1" },
      ],
    }),
  );
  const area = await areaFor({ place: "Rupnagar", ...leh, key: KEY, fetchImpl });
  assert.equal(area.bounds, null, "no settlement, no area");
  assert.equal(area.placeId, null);
  assert.equal(area.city, false);
});

test("a boundary wider than the cap is a district wearing a town's name", async () => {
  const huge = { ...LEH_HIT, bbox: { lon1: 74.0, lat1: 30.0, lon2: 79.0, lat2: 35.0 } };
  const fetchImpl = fakeFetch(() => ok({ results: [huge] }));
  const area = await areaFor({ place: "Punjab", ...leh, key: KEY, fetchImpl });
  assert.equal(area.placeId, null);
  assert.ok(spanKmOf(boundsFromBbox(huge.bbox)) > MAX_AREA_SPAN_KM);
});

test("when no city matches, the open question is asked and its own type read", async () => {
  const fetchImpl = fakeFetch((url) =>
    url.includes("type=city")
      ? ok({ results: [] })
      : ok({ results: [{ ...LEH_HIT, result_type: "village", name: "Kiratpur", city: "Kiratpur" }] }),
  );
  const area = await areaFor({ place: "Kiratpur Sahib", ...leh, key: KEY, fetchImpl });
  assert.equal(area.city, true);
  assert.equal(area.label, "Kiratpur");
  assert.equal(fetchImpl.calls.length, 2, "the second question is only asked when the first is empty");
});

test("a stop with no name is placed by its own coordinates", async () => {
  const fetchImpl = fakeFetch((url) => {
    assert.ok(url.includes("/reverse"), "a reverse lookup, not a forward one");
    return ok({ results: [LEH_HIT] });
  });
  const area = await areaFor({ place: "", ...leh, key: KEY, fetchImpl });
  assert.equal(area.city, true);
});

test("a geocoder that cannot be reached is no area, not a crash", async () => {
  const fetchImpl = fakeFetch(() => fail(503));
  const area = await areaFor({ place: "Leh", ...leh, key: KEY, fetchImpl });
  assert.equal(area.bounds, null);
  assert.equal(area.city, false);
});

/* ── one place ───────────────────────────────────────────────────────── */

test("a hotel is read as a bed, with its star class and its distance", () => {
  const item = itemFromFeature(
    feature({ name: "Grand Dragon", categories: ["accommodation", "accommodation.hotel"], tags: { stars: "4" }, opening_hours: "24/7" }),
    leh,
  );
  assert.equal(item.kind, "stay");
  assert.equal(item.detail, "Hotel · 4★");
  assert.equal(item.opening, "24/7");
  assert.equal(item.rating, 4);
  assert.ok(item.distanceKm > 0);
});

test("a guest house, a lodge and a homestay are budget beds", () => {
  const guest = itemFromFeature(
    feature({ name: "Chospa Guest House", categories: ["accommodation", "accommodation.guest_house"] }),
    leh,
  );
  assert.equal(guest.budget, true);
  assert.equal(guest.detail, "Guest house · budget");

  const lodge = itemFromFeature(
    feature({ name: "Neelam Lodge", categories: ["accommodation"] }),
    leh,
  );
  assert.equal(lodge.budget, true);
  assert.equal(lodge.detail, "Lodge · budget");
});

test("an eatery keeps the word on its sign — a dhaba is not a restaurant", () => {
  const dhaba = itemFromFeature(
    feature({ name: "Rana Vaishnavo Dhaba", categories: ["catering", "catering.restaurant"] }),
    leh,
  );
  assert.equal(dhaba.kind, "eat");
  assert.equal(dhaba.detail, "Dhaba");

  const cafe = itemFromFeature(
    feature({ name: "Namza Cafe", categories: ["catering", "catering.cafe"], tags: { cuisine: "tibetan;indian" } }),
    leh,
  );
  assert.equal(cafe.detail, "Cafe · tibetan, indian");
});

test("a pump carries its brand, a hospital its emergency room", () => {
  const fuel = itemFromFeature(
    feature({ name: "Indian Oil", categories: ["service", "service.vehicle", "service.vehicle.fuel"], rest: undefined, brand: "Indian Oil" }),
    leh,
  );
  assert.equal(fuel.kind, "fuel");
  assert.equal(fuel.detail, "Fuel · Indian Oil");

  const hospital = itemFromFeature(
    feature({ name: "Civil Hospital", categories: ["healthcare", "healthcare.hospital"], tags: { emergency: "yes" } }),
    leh,
  );
  assert.equal(hospital.kind, "hospital");
  assert.equal(hospital.detail, "Hospital · emergency");
});

test("a Royal Enfield workshop is named as one, whatever its shop tag says", () => {
  const re = itemFromFeature(
    feature({ name: "Royal Enfield Service Centre", categories: ["commercial", "commercial.vehicle"] }),
    leh,
  );
  assert.equal(re.kind, "service");
  assert.equal(re.royalEnfield, true);
  assert.equal(re.detail, "Royal Enfield · service centre");

  const motorcycle = itemFromFeature(
    feature({ name: "Bike Point", categories: ["commercial", "commercial.vehicle"], commercial: { type: "motorcycle" } }),
    leh,
  );
  assert.equal(motorcycle.detail, "Motorcycle workshop");
  assert.equal(motorcycle.royalEnfield, undefined);
});

test("an unnamed bed is dropped; an unnamed pump is a pump", () => {
  const anonymousBed = itemFromFeature(feature({ name: "", categories: ["accommodation", "accommodation.hotel"] }), leh);
  assert.equal(anonymousBed, null);

  const anonymousFuel = itemFromFeature(
    feature({ name: "", categories: ["service", "service.vehicle", "service.vehicle.fuel"] }),
    leh,
  );
  assert.equal(anonymousFuel.title, "Fuel station");
});

test("a place outside the three tabs is not an item at all", () => {
  assert.equal(itemFromFeature(feature({ name: "Somewhere", categories: ["tourism", "tourism.attraction"] }), leh), null);
});

test("both lists are nearest first, and the marque leads the service tab", () => {
  const items = [
    { title: "Far", kind: "service", distanceKm: 9, lat: 1, lng: 1 },
    { title: "Royal Enfield", kind: "service", distanceKm: 8, lat: 2, lng: 2, royalEnfield: true },
    { title: "Near", kind: "service", distanceKm: 1, lat: 3, lng: 3 },
  ];
  assert.deepEqual(rankItems(items, "essentials").map((item) => item.title), ["Royal Enfield", "Near", "Far"]);
  assert.deepEqual(rankItems(items, "stays").map((item) => item.title), ["Near", "Royal Enfield", "Far"], "distance alone");
});

/* ── the search ──────────────────────────────────────────────────────── */

test("the places question is clipped to the town's own boundary, never a radius", async () => {
  const fetchImpl = fakeFetch((url) => {
    if (isGeocode(url)) return ok({ results: [LEH_HIT] });
    return ok({ features: [feature({ name: "Grand Dragon", categories: ["accommodation", "accommodation.hotel"] })] });
  });
  const result = await searchNearby({ kind: "stays", ...leh, place: "Leh", key: KEY, fetchImpl });

  assert.equal(result.source, "geoapify");
  assert.equal(result.items.length, 1);
  const placesCall = fetchImpl.calls.find(isPlaces);
  assert.match(placesCall, /filter=place(3A|%3A)leh-boundary/);
  assert.equal(/circle:/.test(placesCall), false, "no circle anywhere");
  assert.match(placesCall, /apiKey=test-key/);
  assert.equal(KIND_CATEGORIES.stays.join(","), "accommodation");
});

test("a town with nothing in it answers empty — it does not borrow the next town", async () => {
  const fetchImpl = fakeFetch((url) => (isGeocode(url) ? ok({ results: [LEH_HIT] }) : ok({ features: [] })));
  const result = await searchNearby({ kind: "food", ...leh, place: "Leh", key: KEY, fetchImpl });
  assert.equal(result.items.length, 0);
  assert.equal(result.source, "geoapify");
  assert.equal(result.area.label, "Leh");
});

test("no boundary means no list, and the reason is said out loud", async () => {
  const fetchImpl = fakeFetch(() => ok({ results: [] }));
  const result = await searchNearby({ kind: "stays", ...leh, place: "Nowhere", key: KEY, fetchImpl });
  assert.equal(result.reason, "no-area");
  assert.deepEqual(result.items, []);
  assert.equal(result.source, "none");
});

test("no key is stated plainly rather than asked for and refused", async () => {
  const fetchImpl = fakeFetch(() => ok({ results: [LEH_HIT] }));
  const result = await searchNearby({ kind: "stays", ...leh, place: "Leh", key: "", fetchImpl });
  assert.equal(result.source, "none");
  assert.match(result.notes.join(" "), /no key/);
  assert.equal(fetchImpl.calls.length, 0);
});

test("a refused or broken answer is an empty answer that says so, not a throw", async () => {
  const fetchImpl = fakeFetch((url) => (isGeocode(url) ? ok({ results: [LEH_HIT] }) : fail(429)));
  const result = await searchNearby({ kind: "essentials", ...leh, place: "Leh", key: KEY, fetchImpl });
  assert.equal(result.source, "none");
  assert.deepEqual(result.items, []);
  assert.match(result.notes.join(" "), /429/);
});

test("the cache answers the second ask, and a failure is not remembered", async () => {
  clearNearbyCache();
  let calls = 0;
  const fetchImpl = fakeFetch((url) => {
    if (isGeocode(url)) return ok({ results: [LEH_HIT] });
    calls += 1;
    return ok({ features: [feature({ name: "Grand Dragon", categories: ["accommodation", "accommodation.hotel"] })] });
  });

  const first = await searchNearbyCached({ kind: "stays", ...leh, place: "Leh", key: KEY, fetchImpl });
  const second = await searchNearbyCached({ kind: "stays", ...leh, place: "Leh", key: KEY, fetchImpl });
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);

  // A different town is a different question.
  await searchNearbyCached({ kind: "stays", ...leh, place: "Nangal", key: KEY, fetchImpl });
  assert.equal(calls, 2);
  clearNearbyCache();
});

test("the endpoint answers a page that asks for beds, and refuses nonsense", async () => {
  const { createApp } = await import("../app.js");
  clearNearbyCache();

  // The server's own outbound call is the only thing stubbed; the request to
  // the app itself still goes over the loopback.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (isGeocode(href)) return ok({ results: [LEH_HIT] });
    if (isPlaces(href)) {
      return ok({
        features: [
          feature({ name: "Grand Dragon", categories: ["accommodation", "accommodation.hotel"], coord: [77.58, 34.16] }),
          feature({ name: "Chospa Guest House", categories: ["accommodation", "accommodation.guest_house"], coord: [77.60, 34.18] }),
        ],
      });
    }
    return realFetch(url, options);
  };

  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const found = await fetch(`${base}/api/nearby?kind=stays&lat=34.1526&lng=77.5771&place=Leh`);
    assert.equal(found.status, 200);
    const body = await found.json();
    assert.equal(body.source, "geoapify");
    assert.equal("radiusKm" in body, false, "the answer is an area now, not a radius");
    assert.equal(body.area.city, true);
    assert.equal(body.area.label, "Leh");
    assert.equal(body.items.length, 2);
    assert.equal(body.items[0].title, "Grand Dragon", "nearest first");

    const again = await (await fetch(`${base}/api/nearby?kind=stays&lat=34.1526&lng=77.5771&place=Leh`)).json();
    assert.equal(again.cached, true);

    assert.equal((await fetch(`${base}/api/nearby?kind=shops&lat=34&lng=77`)).status, 400);
    assert.equal((await fetch(`${base}/api/nearby?kind=stays&lat=999&lng=77`)).status, 400);
    assert.equal((await fetch(`${base}/api/nearby?kind=stays&lat=34&lng=abc`)).status, 400);
  } finally {
    globalThis.fetch = realFetch;
    clearNearbyCache();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("every tab asks for a category set Geoapify actually publishes", () => {
  const known = new Set(["accommodation", "catering", "service.vehicle", "commercial.vehicle", "healthcare"]);
  for (const kind of KINDS) {
    for (const category of KIND_CATEGORIES[kind]) {
      assert.ok(known.has(category), `${kind} asks for an unknown category: ${category}`);
    }
  }
});
