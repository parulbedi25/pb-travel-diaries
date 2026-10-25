/**
 * Tests for expanding a shortened map link.
 *
 * The network is faked, on purpose: what is being checked is the walk through
 * redirects and the guards around it — which hosts are followed, how many hops,
 * and what happens when a redirect tries to leave for somewhere it should not.
 * The real Google is not involved, and the suite stays offline.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { MapLinkError, expandMapLink } from "../routes/maps.js";

/** A fetch that answers with the chain of redirects it is given. */
function fakeFetch(chain, { status = 307 } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const location = chain[url];
    return {
      status: location ? status : 200,
      headers: new Headers(location ? { location } : {}),
      body: null,
    };
  };
  return { fetchImpl, calls };
}

const SHORT = "https://maps.app.goo.gl/YJBuu2o9CKs3reLg9?g_st=aw";
const LONG =
  "https://www.google.com/maps/dir/Nangal/Gurudwara+Chati+Patshahi/Leh+laddakh/Manali/Nangal/data=!4m46";

test("a short link is expanded to the directions URL behind it", async () => {
  const { fetchImpl, calls } = fakeFetch({ [SHORT]: LONG });
  assert.equal(await expandMapLink(SHORT, fetchImpl), LONG);
  // Two requests: the short link, then the URL it points at, to find out
  // whether that redirects any further.
  assert.deepEqual(calls, [SHORT, LONG]);
});

test("a chain is followed, and a relative Location is resolved", async () => {
  const { fetchImpl, calls } = fakeFetch({
    "https://goo.gl/maps/abc": "https://maps.app.goo.gl/xyz",
    "https://maps.app.goo.gl/xyz": "/maps/dir/A/B",
  });
  const result = await expandMapLink("goo.gl/maps/abc", fetchImpl);
  assert.equal(result, "https://maps.app.goo.gl/maps/dir/A/B");
  // The two redirects, then the page that finally answers.
  assert.equal(calls.length, 3);
});

test("a link that is already the map comes back as itself", async () => {
  const { fetchImpl } = fakeFetch({});
  assert.equal(await expandMapLink(LONG, fetchImpl), LONG);
});

test("hosts outside the map services are refused without a request", async () => {
  const { fetchImpl, calls } = fakeFetch({});
  await assert.rejects(
    () => expandMapLink("https://example.com/not-a-map", fetchImpl),
    (error) => error instanceof MapLinkError && error.status === 400,
  );
  assert.equal(calls.length, 0, "a host it will never read must not be fetched");
});

test("a redirect that leaves the map services is not followed", async () => {
  const { fetchImpl, calls } = fakeFetch({
    "https://maps.app.goo.gl/evil": "http://169.254.169.254/latest/meta-data/",
  });
  await assert.rejects(
    () => expandMapLink("https://maps.app.goo.gl/evil", fetchImpl),
    (error) => error instanceof MapLinkError && error.status === 422,
  );
  assert.equal(calls.length, 1, "the internal address must never be requested");
});

test("a link that never settles is stopped after four hops", async () => {
  const loop = {};
  for (let i = 0; i < 10; i += 1) loop[`https://maps.app.goo.gl/${i}`] = `https://maps.app.goo.gl/${i + 1}`;
  const { fetchImpl, calls } = fakeFetch(loop);
  // The last hop has no Location, so it ends where the budget allows.
  const result = await expandMapLink("https://maps.app.goo.gl/0", fetchImpl);
  assert.equal(calls.length <= 4, true, `followed ${calls.length} hops`);
  assert.match(result, /^https:\/\/maps\.app\.goo\.gl\//);
});

test("a network that is down is a 502, a hang is a 504", async () => {
  const down = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    () => expandMapLink(SHORT, down),
    (error) => error instanceof MapLinkError && error.status === 502,
  );
  const hang = async () => {
    const error = new Error("timed out");
    error.name = "TimeoutError";
    throw error;
  };
  await assert.rejects(
    () => expandMapLink(SHORT, hang),
    (error) => error instanceof MapLinkError && error.status === 504,
  );
});

test("nothing at all is a 400", async () => {
  const { fetchImpl, calls } = fakeFetch({});
  await assert.rejects(
    () => expandMapLink("   ", fetchImpl),
    (error) => error instanceof MapLinkError && error.status === 400,
  );
  assert.equal(calls.length, 0);
});
