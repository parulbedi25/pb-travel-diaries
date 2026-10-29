/**
 * The nearby search: what it asks, and what it does when a server says no.
 *
 * The whole point of moving this off the browser was that one answer cannot
 * be relied on, so most of these tests are about the fallbacks — a busy
 * Overpass mirror, a dead one, all three down and Nominatim answering, and
 * everything down with a Google key configured. The parsing and ranking are
 * checked on their own, with the shapes the real services return.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// The endpoint tests boot the real app, so the driver has to be the in-memory
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
process.env.GOOGLE_PLACES_API_KEY = "";

const {
  KIND_RADIUS_KM,
  overpassQuery,
  nominatimTerms,
  viewboxOf,
  itemFromTags,
  itemsFromOverpass,
  itemsFromNominatim,
  itemsFromGoogle,
  rankItems,
  photonTerms,
  tagsFromPhoton,
  itemsFromPhoton,
  searchNearby,
  searchNearbyCached,
  clearNearbyCache,
  OVERPASS_MIRRORS,
} = await import("../lib/nearbySearch.js");

const leh = { lat: 34.1526, lng: 77.5771 };

/** A fake Overpass answer in the shape the real one uses for both nodes and ways. */
const overpassBody = {
  elements: [
    { type: "node", id: 1, lat: 34.16, lon: 77.58, tags: { tourism: "hotel", name: "Grand Dragon", stars: "4" } },
    { type: "node", id: 2, lat: 34.17, lon: 77.59, tags: { tourism: "guest_house", name: "Chospa Guest House" } },
    { type: "node", id: 3, lat: 34.155, lon: 77.575, tags: { amenity: "fuel", name: "Indian Oil Leh", brand: "Indian Oil" } },
    { type: "node", id: 4, lat: 34.15, lon: 77.57, tags: { amenity: "hospital", name: "SNM Hospital", emergency: "yes" } },
    { type: "node", id: 5, lat: 34.16, lon: 77.57, tags: { shop: "motorcycle", name: "Royal Enfield Leh" } },
    { type: "node", id: 6, lat: 34.16, lon: 77.58, tags: { tourism: "hotel" } },
    { type: "node", id: 7, lat: 34.16, lon: 77.58, tags: { amenity: "cafe", name: "A cafe" } },
    { type: "way", id: 8, center: { lat: 34.14, lon: 77.56 }, tags: { amenity: "clinic", name: "Army Clinic" } },
  ],
};

/** A fetch that answers by URL, and records what it was asked for. */
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url: String(url), body: String(options?.body ?? ""), headers: options?.headers ?? {} });
    const answer = handler(String(url), options);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  impl.calls = calls;
  return impl;
}

const ok = (json) => ({ ok: true, status: 200, async json() { return json; } });
const bad = (status) => ({ ok: false, status, async json() { return {}; } });

test("each question is one Overpass query, with a radius that suits it", () => {
  assert.equal(KIND_RADIUS_KM.stays, 15);
  assert.equal(KIND_RADIUS_KM.essentials, 25);

  const stays = overpassQuery("stays", leh.lat, leh.lng, KIND_RADIUS_KM.stays);
  assert.match(stays, /\[out:json\]\[timeout:20\]/);
  assert.match(stays, /nwr\["tourism"~"\^\(hotel\|guest_house\|hostel\|motel\)\$"\]\(around:15000,34\.1526,77\.5771\)/);
  assert.match(stays, /out center 80;/);

  const essentials = overpassQuery("essentials", leh.lat, leh.lng, KIND_RADIUS_KM.essentials);
  for (const clause of ['nwr["amenity"="fuel"]', 'nwr["amenity"~"^(hospital|clinic)$"]', 'nwr["shop"="motorcycle"]', 'nwr["service:vehicle:motorcycle"="yes"]', 'nwr["name"~"Royal Enfield",i]']) {
    assert.ok(essentials.includes(clause), `${clause} is asked for`);
  }
  assert.match(essentials, /around:25000,/);
});

test("the question carries a box and terms for the fallback geocoder", () => {
  const box = viewboxOf(leh.lat, leh.lng, 15).split(",").map(Number);
  assert.equal(box.length, 4);
  const [west, north, east, south] = box;
  assert.ok(west < leh.lng && east > leh.lng, "the box spans the longitude");
  assert.ok(south < leh.lat && north > leh.lat, "and the latitude");
  assert.deepEqual(nominatimTerms("stays"), ["hotel", "guest house"]);
  assert.ok(nominatimTerms("essentials").includes("petrol station"));
});

test("an OpenStreetMap element is read for what it actually is", () => {
  const hotel = itemFromTags({ tourism: "hotel", name: "Grand Dragon", stars: "4" }, "n/1", 34.16, 77.58, leh);
  assert.equal(hotel.kind, "stay");
  assert.match(hotel.detail, /Hotel · 4★/);
  assert.equal(hotel.budget, undefined, "a hotel is not a budget bed");

  const guest = itemFromTags({ tourism: "guest_house", name: "Chospa" }, "n/2", 34.16, 77.58, leh);
  assert.equal(guest.budget, true);
  assert.match(guest.detail, /budget/);

  const pump = itemFromTags({ amenity: "fuel", brand: "Indian Oil" }, "n/3", 34.16, 77.58, leh);
  assert.equal(pump.title, "Fuel station", "an unnamed pump still has a name for the list");
  assert.match(pump.detail, /Indian Oil/);

  const re = itemFromTags({ shop: "motorcycle", name: "Royal Enfield Leh" }, "n/4", 34.16, 77.58, leh);
  assert.equal(re.royalEnfield, true);

  assert.equal(itemFromTags({ tourism: "hotel" }, "n/5", 34.16, 77.58, leh), null, "an unnamed bed is no use");
  assert.equal(itemFromTags({ amenity: "cafe", name: "A cafe" }, "n/6", 34.16, 77.58, leh), null, "not asked for");
  assert.equal(itemFromTags({ amenity: "fuel" }, "n/7", undefined, 77.58, leh), null, "no coordinates");
});

test("a whole Overpass answer becomes a list, cents-free distances and all", () => {
  const items = itemsFromOverpass(overpassBody, leh);
  const titles = items.map((item) => item.title);
  assert.deepEqual(titles, ["Grand Dragon", "Chospa Guest House", "Indian Oil Leh", "SNM Hospital", "Royal Enfield Leh", "Army Clinic"]);
  for (const item of items) {
    assert.ok(item.distanceKm > 0 && item.distanceKm < 5, `${item.title} is a few kilometres away`);
    assert.ok(Number.isFinite(item.lat) && Number.isFinite(item.lng));
  }
  assert.equal(items.find((i) => i.title === "Army Clinic").kind, "hospital", "a clinic is a hospital for the list");
});

test("beds are ranked cheap-first, essentials by the marque and then near", () => {
  const items = itemsFromOverpass(overpassBody, leh);
  const stays = rankItems(items.filter((i) => i.kind === "stay"), "stays");
  assert.deepEqual(stays.map((s) => s.title), ["Chospa Guest House", "Grand Dragon"]);

  const essentials = rankItems(items, "essentials");
  assert.equal(essentials[0].title, "Royal Enfield Leh", "the workshop that carries the marque comes first");
  const rest = essentials.slice(1).map((i) => i.distanceKm);
  assert.deepEqual(rest, [...rest].sort((a, b) => a - b), "everything else is ordered by how near it is");
  assert.ok(!essentials.some((i) => i.kind === "stay"), "a bed does not appear in the essentials list");
});

test("the same place tagged twice is listed once", () => {
  const twice = [
    { id: "a", kind: "fuel", title: "Indian Oil", lat: 34.1, lng: 77.5, distanceKm: 1, detail: "" },
    { id: "b", kind: "fuel", title: "indian oil", lat: 34.1001, lng: 77.5001, distanceKm: 1.1, detail: "" },
  ];
  assert.equal(rankItems(twice, "essentials").length, 1);
});

test("a busy mirror is skipped, and the next one answers", async () => {
  const fetchImpl = fakeFetch((url) => (url === OVERPASS_MIRRORS[0] ? bad(504) : ok(overpassBody)));
  const result = await searchNearby({ kind: "stays", ...leh, fetchImpl });

  assert.equal(result.source, "overpass");
  assert.equal(result.items.length, 2, "the two beds in the answer, and nothing else");
  assert.equal(fetchImpl.calls.length, 2, "the first mirror was tried, then the second");
  assert.match(result.notes[0], /504/);
  assert.equal(result.tried[0], "OpenStreetMap", "the page is told the source, not the mirror's name");
  assert.equal(fetchImpl.calls[0].headers["User-Agent"].includes("pb-travel-diaries"), true, "Overpass is told who is asking");
});

test("with every mirror down, the geocoder answers instead", async () => {
  const fetchImpl = fakeFetch((url) => {
    if (url.includes("overpass")) throw new Error("network down");
    return ok([
      { osm_type: "node", osm_id: 11, lat: "34.16", lon: "77.58", name: "Chospa Guest House", class: "tourism", type: "guest_house" },
      { osm_type: "node", osm_id: 12, lat: "34.17", lon: "77.59", name: "Grand Dragon", class: "tourism", type: "hotel" },
    ]);
  });

  const result = await searchNearby({ kind: "stays", ...leh, fetchImpl, mirrors: OVERPASS_MIRRORS });
  assert.equal(result.source, "nominatim");
  assert.equal(result.items.length, 2, "both terms were asked, and the two places are found once each");
  assert.equal(result.items[0].title, "Chospa Guest House", "the guest house still comes first");
  assert.match(fetchImpl.calls.at(-1).url, /nominatim\.openstreetmap\.org/);
  assert.equal(result.tried.filter((line) => line.includes("around")).length, 0);
  assert.ok(result.notes.some((line) => line.includes("overpass")), "the busy mirrors are on the record");
});

test("a configured key is spent first, on the same question", async () => {
  const fetchImpl = fakeFetch((url) => {
    if (url.includes("overpass") || url.includes("nominatim")) throw new Error("down");
    return ok({
      results: [
        {
          place_id: "g1",
          name: "Royal Enfield Service Leh",
          geometry: { location: { lat: 34.16, lng: 77.58 } },
          types: ["car_repair"],
        },
        {
          place_id: "g2",
          name: "Indian Oil Petrol Pump",
          geometry: { location: { lat: 34.15, lng: 77.57 } },
          types: ["gas_station"],
        },
      ],
    });
  });

  const result = await searchNearby({ kind: "essentials", ...leh, fetchImpl, googleKey: "test-key" });
  assert.equal(result.source, "google");
  assert.equal(fetchImpl.calls.every((call) => call.url.includes("googleapis")), true, "no mirror was asked first");
  assert.equal(result.items[0].title, "Royal Enfield Service Leh", "the marque still comes first");
  const googleCalls = fetchImpl.calls.filter((call) => call.url.includes("googleapis"));
  assert.ok(googleCalls.length >= 2, "fuel/hospitals and the workshop keyword were both asked");
  assert.ok(googleCalls.every((call) => call.url.includes("key=test-key")));
});

test("no key, no map service, no throw — an empty answer that says so", async () => {
  const fetchImpl = fakeFetch(() => {
    throw new Error("offline");
  });
  const result = await searchNearby({ kind: "stays", ...leh, fetchImpl, googleKey: "" });
  assert.equal(result.source, "none");
  assert.deepEqual(result.items, []);
  assert.equal(result.radiusKm, 15);
});

test("Google's own results are read into the same shape", () => {
  const items = itemsFromGoogle(
    [
      { place_id: "a", name: "The Grand Dragon Ladakh", geometry: { location: { lat: 34.17, lng: 77.59 } }, types: ["lodging"], rating: 4.6 },
      { place_id: "b", name: "Leh Hostel", geometry: { location: { lat: 34.16, lng: 77.58 } }, types: ["lodging"] },
      { place_id: "c", name: "Somewhere else", geometry: { location: { lat: 34.16, lng: 77.58 } }, types: ["restaurant"] },
    ],
    leh,
  );
  assert.equal(items.length, 2, "a restaurant is not a bed");
  assert.equal(items[1].budget, true, "a hostel is the cheap one");
  assert.equal(items[0].detail.includes("4.6★"), true);
});

test("nominatim's class and type are read as the tags they stand for", () => {
  const items = itemsFromNominatim(
    [
      { osm_type: "node", osm_id: 1, lat: "34.16", lon: "77.58", name: "Leh Fuel", class: "amenity", type: "fuel" },
      { osm_type: "node", osm_id: 2, lat: "34.16", lon: "77.58", name: "Bike Fix", class: "shop", type: "motorcycle" },
      { osm_type: "node", osm_id: 3, lat: "34.16", lon: "77.58", name: "A bakery", class: "shop", type: "bakery" },
    ],
    leh,
  );
  assert.deepEqual(items.map((i) => i.kind).sort(), ["fuel", "service"]);
});

test("the cache answers the second ask, and a failure is not remembered", async () => {
  clearNearbyCache();
  let calls = 0;
  const fetchImpl = fakeFetch(() => {
    calls += 1;
    return ok(overpassBody);
  });

  const first = await searchNearbyCached({ kind: "stays", ...leh, fetchImpl });
  assert.equal(first.cached, false);
  const again = await searchNearbyCached({ kind: "stays", ...leh, fetchImpl });
  assert.equal(again.cached, true, "the second ask is free");
  assert.equal(calls, 1);

  // A point nothing answered for is asked again next time rather than cached.
  const failing = fakeFetch(() => {
    calls += 1;
    throw new Error("down");
  });
  const failed = await searchNearbyCached({ kind: "stays", lat: 12.9, lng: 77.6, fetchImpl: failing, googleKey: "" });
  assert.equal(failed.source, "none");
  const retried = await searchNearbyCached({ kind: "stays", lat: 12.9, lng: 77.6, fetchImpl: failing, googleKey: "" });
  assert.equal(retried.cached, false, "nothing was remembered");
  clearNearbyCache();
});

/* ------------------------------------------------------------------ *
 * The endpoint the page calls
 * ------------------------------------------------------------------ */

test("the endpoint answers a page that asks for beds, and refuses nonsense", async () => {
  const { createApp } = await import("../app.js");
  clearNearbyCache();

  // The server's own outbound call is the only thing stubbed; the request to
  // the app itself still goes over the loopback.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("overpass") || String(url).includes("nominatim")) {
      return { ok: true, status: 200, async json() { return overpassBody; } };
    }
    return realFetch(url, options);
  };

  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const found = await fetch(`${base}/api/nearby?kind=stays&lat=34.1526&lng=77.5771`);
    assert.equal(found.status, 200);
    const body = await found.json();
    assert.equal(body.source, "overpass");
    assert.equal(body.radiusKm, 15);
    assert.equal(body.items.length, 2, "beds only");
    assert.equal(body.items[0].title, "Chospa Guest House");

    const essentials = await (await fetch(`${base}/api/nearby?kind=essentials&lat=34.1526&lng=77.5771`)).json();
    assert.equal(essentials.radiusKm, 25);
    assert.equal(essentials.items[0].title, "Royal Enfield Leh");

    // A second ask is served from the cache: one more outbound call would show
    // up as a different answer, and it does not.
    const again = await (await fetch(`${base}/api/nearby?kind=stays&lat=34.1526&lng=77.5771`)).json();
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

test("photon is asked by term, and its features read like any other map item", async () => {
  const fetchImpl = fakeFetch(() => ({
    ok: true,
    status: 200,
    async json() {
      return {
        features: [
          {
            geometry: { coordinates: [77.58, 34.16] },
            properties: { osm_type: "node", osm_id: 5, osm_key: "tourism", osm_value: "guest_house", name: "Chospa Guest House", opening_hours: "24/7" },
          },
          {
            geometry: { coordinates: [77.59, 34.17] },
            properties: { osm_type: "node", osm_id: 6, osm_key: "tourism", osm_value: "hotel", name: "Grand Dragon" },
          },
          {
            geometry: { coordinates: [77.60, 34.18] },
            properties: { osm_type: "node", osm_id: 7, osm_key: "shop", osm_value: "bakery", name: "Bakery" },
          },
        ],
      };
    },
  }));

  const result = await searchNearby({
    kind: "stays",
    ...leh,
    fetchImpl,
    mirrors: [],
    googleKey: "",
  });

  assert.equal(result.source, "photon");
  assert.deepEqual(result.items.map((i) => i.title), ["Chospa Guest House", "Grand Dragon"]);
  assert.equal(result.items[0].opening, "24/7");
  assert.ok(fetchImpl.calls.every((call) => call.url.includes("photon.komoot.io")));
  assert.ok(fetchImpl.calls.every((call) => call.url.includes("lat=34.1526")), "the point biases every term");
  assert.deepEqual(photonTerms("stays"), ["hotel", "guest house", "hostel"]);

  assert.deepEqual(tagsFromPhoton({ osm_key: "amenity", osm_value: "fuel", name: "Pump" }), { amenity: "fuel", name: "Pump" });
  assert.deepEqual(tagsFromPhoton({ osm_key: "tourism", osm_value: "hostel", name: "H" }), { tourism: "hostel", name: "H" });
  assert.deepEqual(tagsFromPhoton({ osm_key: "shop", osm_value: "motorcycle", name: "RE" }), { shop: "motorcycle", name: "RE" });
  assert.equal(itemsFromPhoton([{ geometry: { coordinates: [] } }], leh).length, 0);
});

test("photon is asked only after every mirror, and before nominatim", async () => {
  const fetchImpl = fakeFetch((url) => {
    if (url.includes("overpass")) throw new Error("down");
    if (url.includes("photon")) throw new Error("blocked");
    return ok([{ osm_type: "node", osm_id: 1, lat: "34.16", lon: "77.58", name: "Pump", class: "amenity", type: "fuel" }]);
  });
  const result = await searchNearby({ kind: "essentials", ...leh, fetchImpl, googleKey: "" });
  assert.equal(result.source, "nominatim");
  const order = fetchImpl.calls.map((call) =>
    call.url.includes("overpass") ? "overpass" : call.url.includes("photon") ? "photon" : "nominatim",
  );
  assert.deepEqual(order.slice(0, 4), ["overpass", "overpass", "overpass", "photon"]);
  assert.equal(order.at(-1), "nominatim");
});

test("an empty answer says what it tried, and whether a key was even available", async () => {
  const fetchImpl = fakeFetch(() => {
    throw new Error("offline");
  });
  const result = await searchNearby({ kind: "stays", ...leh, fetchImpl, googleKey: "" });
  assert.equal(result.source, "none");
  assert.equal(result.keyConfigured, false);
  assert.deepEqual(result.tried, ["OpenStreetMap", "Photon", "Nominatim"], "each source once, in the order tried");
  const notes = result.notes.join(" | ");
  for (const source of ["overpass-api.de", "photon", "nominatim"]) {
    assert.ok(notes.includes(source), `${source} is on the record`);
  }
});

test("the owner's Google key is stored, never echoed, and used for the search", async () => {
  const { createApp } = await import("../app.js");
  const { getRepo } = await import("../db/index.js");
  clearNearbyCache();

  const repo = await getRepo();
  await repo.setSetting("nearby_google_key", JSON.stringify(""));

  const realFetch = globalThis.fetch;
  const outbound = [];
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.includes("googleapis")) {
      outbound.push(href);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            results: [
              { place_id: "g1", name: "Royal Enfield Service Leh", geometry: { location: { lat: 34.16, lng: 77.58 } }, types: ["car_repair"] },
            ],
          };
        },
      };
    }
    if (href.includes("overpass") || href.includes("photon") || href.includes("nominatim")) {
      outbound.push(href);
      return { ok: false, status: 503, async json() { return {}; } };
    }
    return realFetch(url, options);
  };

  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const jar = { session: "" };
  const call = async (method, path, body) => {
    const headers = {};
    if (jar.session) headers.Cookie = `pb_session=${jar.session}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const match = /pb_session=([^;]*)/.exec(line);
      if (match) jar.session = match[1];
    }
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null };
  };

  try {
    // The first account is the owner; the second is a member who may not see the key.
    assert.equal((await call("POST", "/api/auth/signup", { username: "parul", password: "ride2026" })).status, 201);
    assert.equal((await call("PUT", "/api/settings/site", { title: "PB Travel Diaries", allowSignup: true })).status, 200);

    const before = await call("GET", "/api/nearby/key");
    assert.equal(before.status, 200);
    assert.equal(before.json.configured, false);

    const tooShort = await call("PUT", "/api/nearby/key", { key: "abc" });
    assert.equal(tooShort.status, 400);

    const key = "AIzaSyD-test-key-0123456789abcdefghij";
    const saved = await call("PUT", "/api/nearby/key", { key });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.hint, `…${key.slice(-4)}`, "only the last four characters come back");
    assert.ok(!JSON.stringify(saved.json).includes(key), "the key itself is never echoed");

    const after = await call("GET", "/api/nearby/key");
    assert.equal(after.json.configured, true);
    assert.ok(!JSON.stringify(after.json).includes(key));

    // With the key stored, the search uses Google and says so.
    clearNearbyCache();
    const search = await call("GET", "/api/nearby?kind=essentials&lat=34.1526&lng=77.5771");
    assert.equal(search.status, 200);
    assert.equal(search.json.source, "google");
    assert.equal(search.json.items[0].title, "Royal Enfield Service Leh");
    assert.equal(search.json.googleKey, true);
    assert.ok(outbound.some((url) => url.includes("key=AIza")), "the stored key was used");

    // A member is refused all three key endpoints.
    await repo.setSetting("nearby_google_key", JSON.stringify(""));
    const member = { session: "" };
    await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "parul", password: "ride2026" }) });
    const memberCall = async (method, path, body) => {
      const headers = { Cookie: `pb_session=${member.session}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const line of response.headers.getSetCookie?.() ?? []) {
        const match = /pb_session=([^;]*)/.exec(line);
        if (match) member.session = match[1];
      }
      return response.status;
    };
    // The owner is the only account here, so "not the owner" is a new sign-up.
    const other = { session: "" };
    const signup = await fetch(`${base}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "asha", password: "ride2026" }),
    });
    for (const line of signup.headers.getSetCookie?.() ?? []) {
      const match = /pb_session=([^;]*)/.exec(line);
      if (match) other.session = match[1];
    }
    const asMember = async (method, path, body) => {
      const headers = { Cookie: `pb_session=${other.session}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      return (await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })).status;
    };
    assert.equal(await asMember("GET", "/api/nearby/key"), 403);
    assert.equal(await asMember("PUT", "/api/nearby/key", { key }), 403);
    assert.equal(await asMember("DELETE", "/api/nearby/key"), 403);

    // And the owner can take it out again.
    assert.equal((await call("DELETE", "/api/nearby/key")).status, 200);
    assert.equal((await call("GET", "/api/nearby/key")).json.configured, false);
  } finally {
    globalThis.fetch = realFetch;
    await repo.setSetting("nearby_google_key", JSON.stringify(""));
    clearNearbyCache();
    await new Promise((resolve) => server.close(resolve));
  }
});
