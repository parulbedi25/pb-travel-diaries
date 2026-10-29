/**
 * The nearby search: what it asks, and what it does when a server says no.
 *
 * The whole point of moving this off the browser was that one answer cannot
 * be relied on, so most of these tests are about the fallbacks — a busy
 * Overpass mirror, a dead one, all three down and Nominatim answering, and
 * everything down at once. Google is asked first, without a key, by reading
 * the Maps page; its parser is checked on the shape that page ships.
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

const {
  KIND_RADIUS_KM,
  overpassQuery,
  areaFor,
  clearAreaCache,
  boundsFromNominatim,
  spanKmOf,
  nominatimTerms,
  viewboxOf,
  itemFromTags,
  itemsFromOverpass,
  itemsFromNominatim,
  googleTerms,
  googleStateFrom,
  itemsFromGoogleState,
  itemsFromGoogleMapsHtml,
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
const okHtml = (html) => ({
  ok: true,
  status: 200,
  async text() { return html; },
  async json() { return {}; },
});
const bad = (status) => ({ ok: false, status, async json() { return {}; }, async text() { return ""; } });

const isGoogle = (url) => url.includes("google.com/maps");

/** A page in the shape Google sends: one state array, then the flags. */
const googlePage = (state) =>
  `<!doctype html><html><body><script>window.APP_INITIALIZATION_STATE=${JSON.stringify(state)};window.APP_FLAGS={};</script></body></html>`;

/** A place record as Google packs it: coordinates, a name, a rating, an id. */
const placeRecord = ({ name, lat, lng, rating, types, id = "0x391ad0a2b:0x1f2ab3c" }) => [
  null, null, null, null, null, null, null, null, null,
  [null, null, lat, lng],
  null,
  name,
  null,
  rating ? [[rating, 248]] : null,
  id,
  types,
];

const googleState = [
  [null, null, [null, null, leh.lat, leh.lng]],
  [
    placeRecord({ name: "The Grand Dragon Ladakh", lat: 34.16, lng: 77.58, rating: 4.6, types: ["lodging", "hotel"] }),
    placeRecord({ name: "Leh Backpacker Hostel", lat: 34.155, lng: 77.575, rating: 4.2, types: ["lodging", "hostel"], id: "0x391ad0a2b:0x99" }),
    placeRecord({ name: "Tenzin Cafe", lat: 34.16, lng: 77.58, rating: 4.4, types: ["restaurant"], id: "0x391ad0a2b:0x77" }),
    [null, null, null, "0x391ad0a2b:0x55"],
  ],
];

test("each question is one Overpass query, over a box rather than a circle", () => {
  const bounds = { south: 34.0, north: 34.3, west: 77.4, east: 77.8 };
  const stays = overpassQuery("stays", bounds);
  assert.match(stays, /tourism/);
  assert.match(stays, /\(34\.0000,77\.4000,34\.3000,77\.8000\)/, "the box is south,west,north,east");
  assert.ok(!stays.includes("around:"), "no radius is asked for any more");
  assert.ok(!stays.includes("amenity\",\"fuel"), "a bed search does not ask for petrol");

  const essentials = overpassQuery("essentials", bounds);
  assert.match(essentials, /\(34\.0000,77\.4000,34\.3000,77\.8000\)/);
  for (const tag of ["fuel", "hospital", "shop\"=\"motorcycle", "Royal Enfield"]) {
    assert.ok(essentials.includes(tag), `${tag} is part of the question`);
  }

  // The radius survives only as the fallback for a town whose boundary could
  // not be named.
  assert.deepEqual(KIND_RADIUS_KM, { stays: 15, essentials: 25 });
});

test("a town's own boundary is looked up once, and covers the whole town", async () => {
  clearAreaCache();
  const nangal = { lat: 31.3832, lng: 76.3766 };
  const fetchImpl = fakeFetch((url) => {
    assert.match(url, /nominatim\.openstreetmap\.org\/search/);
    return ok([
      // The state is too wide to be a town, and is refused.
      { name: "Punjab", addresstype: "state", boundingbox: ["29.5", "32.6", "73.8", "76.9"], display_name: "Punjab, India" },
      {
        name: "Nangal",
        addresstype: "town",
        boundingbox: ["31.34", "31.43", "76.33", "76.42"],
        address: { town: "Nangal", state: "Punjab" },
        display_name: "Nangal, Punjab, India",
      },
      // Nearer the point, but a village inside the town: the town wins.
      { name: "Nangal Wetland", addresstype: "village", boundingbox: ["31.37", "31.39", "76.37", "76.39"], address: { village: "Nangal" } },
    ]);
  });

  const area = await areaFor({ place: "Nangal, Punjab", ...nangal, kind: "stays", fetchImpl });
  assert.equal(area.city, true, "a real boundary was found");
  assert.equal(area.label, "Nangal, Punjab");
  assert.deepEqual(area.bounds, { south: 31.34, north: 31.43, west: 76.33, east: 76.42 });
  assert.ok(spanKmOf(area.bounds) > 5, "it is a town, not a pin");

  // The second ask is free: a town does not move.
  const asksSoFar = fetchImpl.calls.length;
  const again = await areaFor({ place: "Nangal, Punjab", ...nangal, kind: "stays", fetchImpl });
  assert.deepEqual(again.bounds, area.bounds);
  assert.equal(fetchImpl.calls.length, asksSoFar, "the boundary was remembered");
  clearAreaCache();
});

test("a boundary that cannot be found falls back to a circle, and says so", async () => {
  clearAreaCache();
  const fetchImpl = fakeFetch(() => {
    throw new Error("offline");
  });
  const area = await areaFor({ place: "Somewhere", lat: 31.38, lng: 76.38, kind: "essentials", fetchImpl });
  assert.equal(area.city, false, "the page is told this is not the town's boundary");
  assert.equal(area.label, "Somewhere");
  assert.ok(area.spanKm > 0);

  // A box that does not contain the point is not the point's town.
  assert.equal(
    boundsFromNominatim({ boundingbox: ["10", "11", "20", "21"], addresstype: "city" }, { lat: 31.38, lng: 76.38 }),
    null,
  );
  // Nor is a whole state, even though it does contain the point.
  assert.equal(
    boundsFromNominatim({ boundingbox: ["29.5", "32.6", "73.8", "76.9"], addresstype: "state" }, { lat: 31.38, lng: 76.38 }),
    null,
    "a box wider than a city is refused",
  );
  clearAreaCache();
});

test("the question carries a box and terms for the fallback geocoder", () => {
  assert.deepEqual(nominatimTerms("stays"), ["hotel", "guest house"]);
  assert.equal(viewboxOf(34.1526, 77.5771, 15).split(",").length, 4);
  assert.deepEqual(googleTerms("stays"), ["hotels", "guest houses", "hostels"]);
  assert.ok(googleTerms("essentials").some((term) => /royal enfield/i.test(term)));
});

test("an OpenStreetMap element is read for what it actually is", () => {
  const fuel = itemFromTags({ amenity: "fuel", name: "Pump", brand: "IOC" }, "node/1", 34.16, 77.58, leh);
  assert.equal(fuel.kind, "fuel");
  assert.equal(fuel.detail, "Fuel · IOC");

  const stay = itemFromTags({ tourism: "guest_house", name: "Chospa" }, "node/2", 34.16, 77.58, leh);
  assert.equal(stay.kind, "stay");
  assert.equal(stay.budget, true, "a guest house is the cheap one");

  assert.equal(itemFromTags({ tourism: "hotel" }, "node/3", 34.16, 77.58, leh), null, "a nameless bed is no bed");
  assert.equal(itemFromTags({ amenity: "cafe", name: "Cafe" }, "node/4", 34.16, 77.58, leh), null);
  assert.equal(itemFromTags({ tourism: "hotel", name: "X" }, "node/5", "34.1", "77.5", leh), null, "no coordinates, no pin");
});

test("a whole Overpass answer becomes a list, distances and all", () => {
  const items = itemsFromOverpass(overpassBody, leh);
  assert.equal(items.length, 6, "the nameless hotel and the cafe are dropped");
  assert.equal(items.find((i) => i.title === "Army Clinic").kind, "hospital", "a clinic is a hospital for the list");
  assert.equal(items.find((i) => i.title === "Royal Enfield Leh").royalEnfield, true);
});

test("both lists are nearest first — one order for the list and the map", () => {
  const items = itemsFromOverpass(overpassBody, leh);
  const stays = rankItems(items.filter((i) => i.kind === "stay"), "stays");
  assert.deepEqual(stays.map((s) => s.title), ["Grand Dragon", "Chospa Guest House"]);

  const essentials = rankItems(items, "essentials");
  assert.equal(essentials[0].title, "Indian Oil Leh", "the nearest thing is first, whatever it is");
  const distances = essentials.map((i) => i.distanceKm);
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b), "ascending, all the way down");
  assert.ok(!essentials.some((i) => i.kind === "stay"), "a bed does not appear in the essentials list");
});

test("the same place tagged twice is listed once", () => {
  const twice = [
    { id: "a", kind: "fuel", title: "Indian Oil", lat: 34.1, lng: 77.5, distanceKm: 1, detail: "" },
    { id: "b", kind: "fuel", title: "indian oil", lat: 34.1001, lng: 77.5001, distanceKm: 1.1, detail: "" },
  ];
  assert.equal(rankItems(twice, "essentials").length, 1);
});

test("Google's page is read: beds with their rating, and nothing that is not a place", () => {
  const items = itemsFromGoogleState(googleState, leh);
  assert.deepEqual(items.map((i) => i.title), ["The Grand Dragon Ladakh", "Leh Backpacker Hostel"]);
  assert.equal(items[0].kind, "stay");
  assert.match(items[0].detail, /4\.6★/);
  assert.equal(items[1].budget, true, "a hostel is the cheap one");
  assert.ok(items.every((item) => item.distanceKm < 1), "both are within a kilometre of Leh");
  assert.ok(!items.some((i) => i.title === "Tenzin Cafe"), "a restaurant is not a bed");
});

test("a rating pair is not mistaken for a place's coordinates", () => {
  // Google packs a rating and its review count as a two-number array too; the
  // place is the pair near the point that was searched for.
  const record = [
    null, null, null, null, null, null, null, null,
    [4.6, 4.8],
    [null, null, 34.16, 77.58],
    "The Grand Dragon Ladakh",
    ["lodging"],
  ];
  const items = itemsFromGoogleState([record], leh);
  assert.equal(items.length, 1);
  assert.equal(items[0].lat, 34.16);
  assert.equal(items[0].lng, 77.58);
  assert.ok(items[0].distanceKm < 2, "measured from Leh, not from the middle of the Atlantic");
});

test("essentials are recognised from the words around the record", () => {
  const state = [
    [placeRecord({ name: "Indian Oil Pump", lat: 34.155, lng: 77.575, types: ["gas_station"] })],
    [placeRecord({ name: "SNM Hospital", lat: 34.15, lng: 77.57, types: ["hospital"], id: "0x1:0x2" })],
    [placeRecord({ name: "Royal Enfield Leh", lat: 34.16, lng: 77.57, types: ["car_repair"], id: "0x1:0x3" })],
  ];
  const items = itemsFromGoogleState(state, leh);
  assert.deepEqual(items.map((i) => i.kind).sort(), ["fuel", "hospital", "service"]);
  assert.equal(items.find((i) => i.kind === "service").royalEnfield, true);
});

test("a page with no data, or no page at all, is an empty answer and not a crash", () => {
  assert.equal(googleStateFrom("<html><body>no data here</body></html>"), null);
  assert.equal(googleStateFrom(undefined), null);
  assert.deepEqual(itemsFromGoogleMapsHtml("<html></html>", leh), []);
  assert.deepEqual(itemsFromGoogleMapsHtml(googlePage(googleState), leh).length, 2);
  // The same place under two searches is one pin.
  const twice = googlePage([[...googleState[1], ...googleState[1]]]);
  assert.equal(itemsFromGoogleMapsHtml(twice, leh).length, 2);
});

test("Google is asked without a key, and its answer is the one that is used", async () => {
  const fetchImpl = fakeFetch((url) => {
    if (isGoogle(url)) return okHtml(googlePage(googleState));
    throw new Error("the other sources are slower, or busy");
  });

  const result = await searchNearby({ kind: "stays", ...leh, fetchImpl });
  assert.equal(result.source, "google");
  assert.deepEqual(
    result.items.map((i) => i.title),
    ["Leh Backpacker Hostel", "The Grand Dragon Ladakh"],
    "nearest first: the hostel is closer than the hotel",
  );
  const googleCalls = fetchImpl.calls.filter((call) => isGoogle(call.url));
  assert.equal(googleCalls.length, googleTerms("stays").length, "one search page per kind of bed");
  assert.ok(fetchImpl.calls.every((call) => !call.url.includes("key=")), "no API key anywhere in the question");
  assert.equal(fetchImpl.calls.length > googleCalls.length, true, "the map sources were asked at the same time, not after");
  const first = fetchImpl.calls[0].url;
  assert.match(first, /google\.com\/maps\/search\/hotels\/@34\.15260,77\.57710,\d+z/);
});

test("a busy mirror does not hold the answer up: the others are asked at the same time", async () => {
  const fetchImpl = fakeFetch((url) => {
    if (isGoogle(url)) return okHtml("<html></html>");
    if (url.includes("photon")) throw new Error("blocked");
    return url === OVERPASS_MIRRORS[0] ? bad(504) : ok(overpassBody);
  });
  const result = await searchNearby({ kind: "stays", ...leh, fetchImpl });

  assert.equal(result.source, "overpass");
  assert.equal(result.items.length, 2, "the two beds in the answer, and nothing else");
  assert.equal(result.tried[0], "Google", "Google was asked, and had nothing");
  assert.equal(result.tried[1], "OpenStreetMap", "the page is told the source, not the mirror's name");
  assert.ok(result.notes.some((line) => /504/.test(line)), "the mirror's 504 is on the record");

  const mirrorCalls = fetchImpl.calls.filter((call) => call.url.includes("overpass"));
  assert.equal(mirrorCalls.length, OVERPASS_MIRRORS.length, "every mirror is asked at once, not one after another");
  assert.equal(mirrorCalls[0].headers["User-Agent"].includes("pb-travel-diaries"), true, "Overpass is told who is asking");
});

test("a slow, silent source cannot hold the page: the budget ends the wait", async () => {
  // Google and the mirrors never answer at all — a hung connection, not a
  // refusal. The budget is what turns that into an empty answer in a second,
  // instead of a spinner for minutes.
  const hang = () => new Promise(() => {});
  const fetchImpl = fakeFetch((url) => (url.includes("photon") ? ok({ features: [] }) : hang()));
  const started = Date.now();
  const result = await searchNearby({ kind: "stays", ...leh, fetchImpl, budgetMs: 250, timeoutMs: 200, fallbackBudgetMs: 150 });
  const elapsed = Date.now() - started;

  assert.equal(result.source, "none");
  assert.ok(elapsed < 2000, `the whole question took ${elapsed}ms, not minutes`);
  assert.deepEqual(result.tried, ["Google", "OpenStreetMap", "Photon", "Nominatim"]);
});

test("with every mirror down, the geocoder answers instead", async () => {
  const fetchImpl = fakeFetch((url) => {
    if (isGoogle(url)) return okHtml("<html></html>");
    if (url.includes("overpass")) throw new Error("network down");
    return ok([
      { osm_type: "node", osm_id: 11, lat: "34.16", lon: "77.58", name: "Chospa Guest House", class: "tourism", type: "guest_house" },
      { osm_type: "node", osm_id: 12, lat: "34.17", lon: "77.59", name: "Grand Dragon", class: "tourism", type: "hotel" },
    ]);
  });

  const result = await searchNearby({ kind: "stays", ...leh, fetchImpl, mirrors: OVERPASS_MIRRORS });
  assert.equal(result.source, "nominatim");
  assert.equal(result.items.length, 2, "both terms were asked, and the two places are found once each");
  assert.equal(result.items[0].title, "Chospa Guest House", "nearest first");
  assert.match(fetchImpl.calls.at(-1).url, /nominatim\.openstreetmap\.org/);
  assert.ok(result.notes.some((line) => line.includes("overpass")), "the busy mirrors are on the record");
});

test("nothing answering is an empty answer that says so, not a throw", async () => {
  const fetchImpl = fakeFetch(() => {
    throw new Error("offline");
  });
  const result = await searchNearby({ kind: "stays", ...leh, fetchImpl });
  assert.equal(result.source, "none");
  assert.deepEqual(result.items, []);
  assert.equal(result.area.city, false, "no boundary could be named, so a circle stood in for it");
  assert.ok(result.area.spanKm > 0);
  assert.deepEqual(result.tried, ["Google", "OpenStreetMap", "Photon", "Nominatim"], "each source once, in the order tried");
  const notes = result.notes.join(" | ");
  for (const source of ["google", "overpass-api.de", "photon", "nominatim"]) {
    assert.ok(notes.includes(source), `${source} is on the record`);
  }
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
  const fetchImpl = fakeFetch((url) => (isGoogle(url) ? okHtml("<html></html>") : ok(overpassBody)));

  const first = await searchNearbyCached({ kind: "stays", ...leh, fetchImpl });
  assert.equal(first.cached, false);
  const asksSoFar = fetchImpl.calls.length;
  const again = await searchNearbyCached({ kind: "stays", ...leh, fetchImpl });
  assert.equal(again.cached, true, "the second ask is free");
  assert.equal(fetchImpl.calls.length, asksSoFar, "nothing was asked a second time");

  // A point nothing answered for is asked again next time rather than cached.
  const failing = fakeFetch(() => {
    throw new Error("down");
  });
  const failed = await searchNearbyCached({ kind: "stays", lat: 12.9, lng: 77.6, fetchImpl: failing });
  assert.equal(failed.source, "none");
  const retried = await searchNearbyCached({ kind: "stays", lat: 12.9, lng: 77.6, fetchImpl: failing });
  assert.equal(retried.cached, false, "nothing was remembered");
  clearNearbyCache();
});

test("the whole town is searched: a bed 20 km out is in the list, if it is in the town", async () => {
  clearAreaCache();
  clearNearbyCache();
  const nangal = { lat: 31.3832, lng: 76.3766 };
  const fetchImpl = fakeFetch((url) => {
    if (url.includes("nominatim")) {
      return ok([
        {
          name: "Nangal",
          addresstype: "town",
          // A town about 35 km across — the old 15 km circle covered less than half.
          boundingbox: ["31.25", "31.52", "76.22", "76.54"],
          address: { town: "Nangal", state: "Punjab" },
        },
      ]);
    }
    if (url.includes("overpass")) {
      return ok({
        elements: [
          // 2 km out: inside any circle.
          { type: "node", id: 1, lat: 31.39, lon: 76.38, tags: { tourism: "hotel", name: "Near Hotel" } },
          // 20 km out: outside the old 15 km radius, still Nangal.
          { type: "node", id: 2, lat: 31.51, lon: 76.53, tags: { tourism: "guest_house", name: "Far Guest House" } },
          // 40 km out: not this town at all.
          { type: "node", id: 3, lat: 31.9, lon: 76.9, tags: { tourism: "hotel", name: "Another Town" } },
        ],
      });
    }
    throw new Error("down");
  });

  const result = await searchNearby({ kind: "stays", ...nangal, place: "Nangal, Punjab", fetchImpl });
  assert.equal(result.area.city, true);
  assert.equal(result.area.label, "Nangal, Punjab");
  const titles = result.items.map((item) => item.title);
  assert.deepEqual(titles, ["Near Hotel", "Far Guest House"], "the far side of town is included, the next town is not");
  assert.ok(result.items[1].distanceKm > 15, "the second one is further than the old radius");
  assert.ok(!titles.includes("Another Town"));

  // And Overpass was asked for the town's box, not a circle around the pin.
  const overpassCall = fetchImpl.calls.find((call) => call.url.includes("overpass"));
  const asked = decodeURIComponent(overpassCall.body);
  assert.match(asked, /\(31\.2500,76\.2200,31\.5200,76\.5400\)/, "the town's box was asked for");
  assert.ok(!asked.includes("around:"), "no circle was asked for");
  clearAreaCache();
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
    const href = String(url);
    if (isGoogle(href)) return okHtml("<html></html>");
    if (href.includes("overpass") || href.includes("nominatim")) {
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
    assert.equal("radiusKm" in body, false, "the answer is an area now, not a radius");
    assert.equal(body.area.city, false, "no boundary name was given, so a circle stood in for the town");
    assert.equal(body.items.length, 2, "beds only");
    assert.equal(body.items[0].title, "Grand Dragon", "nearest first");
    assert.equal("googleKey" in body, false, "there is no key to talk about");

    const essentials = await (await fetch(`${base}/api/nearby?kind=essentials&lat=34.1526&lng=77.5771`)).json();
    assert.ok(essentials.area.spanKm >= 25, "the fallback for essentials is the wider one");
    assert.equal(essentials.items[0].title, "Indian Oil Leh");

    // A second ask is served from the cache: one more outbound call would show
    // up as a different answer, and it does not.
    const again = await (await fetch(`${base}/api/nearby?kind=stays&lat=34.1526&lng=77.5771`)).json();
    assert.equal(again.cached, true);

    assert.equal((await fetch(`${base}/api/nearby?kind=shops&lat=34&lng=77`)).status, 400);
    assert.equal((await fetch(`${base}/api/nearby?kind=stays&lat=999&lng=77`)).status, 400);
    assert.equal((await fetch(`${base}/api/nearby?kind=stays&lat=34&lng=abc`)).status, 400);

    // The key endpoint is gone with the key: nothing is configured, nothing to
    // store, nothing to leak.
    assert.equal((await fetch(`${base}/api/nearby/key`)).status, 404);
  } finally {
    globalThis.fetch = realFetch;
    clearNearbyCache();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("photon is asked by term, and its features read like any other map item", async () => {
  const fetchImpl = fakeFetch((url) => {
    if (isGoogle(url)) return okHtml("<html></html>");
    return {
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
    };
  });

  const result = await searchNearby({
    kind: "stays",
    ...leh,
    fetchImpl,
    mirrors: [],
  });

  assert.equal(result.source, "photon");
  assert.deepEqual(result.items.map((i) => i.title), ["Chospa Guest House", "Grand Dragon"]);
  assert.equal(result.items[0].opening, "24/7");
  const photonCalls = fetchImpl.calls.filter((call) => call.url.includes("photon.komoot.io"));
  assert.ok(photonCalls.every((call) => call.url.includes("lat=34.1526")), "the point biases every term");
  assert.deepEqual(photonTerms("stays"), ["hotel", "guest house", "hostel"]);

  assert.deepEqual(tagsFromPhoton({ osm_key: "amenity", osm_value: "fuel", name: "Pump" }), { amenity: "fuel", name: "Pump" });
  assert.deepEqual(tagsFromPhoton({ osm_key: "tourism", osm_value: "hostel", name: "H" }), { tourism: "hostel", name: "H" });
  assert.deepEqual(tagsFromPhoton({ osm_key: "shop", osm_value: "motorcycle", name: "RE" }), { shop: "motorcycle", name: "RE" });
  assert.equal(itemsFromPhoton([{ geometry: { coordinates: [] } }], leh).length, 0);
});

test("photon is asked only after every mirror, and before nominatim", async () => {
  const fetchImpl = fakeFetch((url) => {
    if (isGoogle(url)) return okHtml("<html></html>");
    if (url.includes("overpass")) throw new Error("down");
    if (url.includes("photon")) throw new Error("blocked");
    return ok([{ osm_type: "node", osm_id: 1, lat: "34.16", lon: "77.58", name: "Pump", class: "amenity", type: "fuel" }]);
  });
  const result = await searchNearby({ kind: "essentials", ...leh, fetchImpl });
  assert.equal(result.source, "nominatim");
  const order = fetchImpl.calls
    .filter((call) => !isGoogle(call.url))
    .map((call) => (call.url.includes("overpass") ? "overpass" : call.url.includes("photon") ? "photon" : "nominatim"));
  assert.deepEqual(order.slice(0, 4), ["overpass", "overpass", "overpass", "photon"]);
  assert.equal(order.at(-1), "nominatim");
  assert.equal(isGoogle(fetchImpl.calls[0].url), true, "Google was asked before any of them");
});
