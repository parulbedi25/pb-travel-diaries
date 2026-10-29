/**
 * Tests for outbound HTTP — the one thing in this app that leaves the box.
 *
 * Local servers stand in for the internet, so the suite stays offline while
 * still exercising the three shapes that matter: a direct connection, a proxy,
 * and a chunked page. The interesting assertions are about what the resolver
 * *sees* — the status, the address, the reason it failed — because those are
 * what turn "the short link could not be read" into a fact about the host.
 */
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { parseScutilProxy, proxyFor, request, routesFor } from "../lib/egress.js";

/** An origin that answers 302 then 200, with a chunked body. */
async function origin() {
  const server = http.createServer((req, res) => {
    if (req.url === "/short") {
      res.writeHead(302, { location: "/long?x=1" });
      res.end();
      return;
    }
    if (req.url === "/chunked") {
      res.writeHead(200, { "content-type": "text/html", "transfer-encoding": "chunked" });
      res.write('<html><meta http-equiv="refresh" content="0; url=https://www.google.com/maps/dir/A/B">');
      res.end("</html>");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html>landed</html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

/** A proxy that answers every request itself, noting what it was asked for. */
async function proxy() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html>via proxy</html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, seen, url: `http://127.0.0.1:${port}` };
}

test("a redirect is reported as a status and a location, unfollowed", async (t) => {
  const { server, base } = await origin();
  t.after(() => server.close());
  const result = await request(`${base}/short`);
  assert.equal(result.status, 302);
  assert.equal(result.headers.get("location"), "/long?x=1");
  assert.equal(result.error, undefined);
});

test("following a redirect reports the address that actually answered", async (t) => {
  const { server, base } = await origin();
  t.after(() => server.close());
  const result = await request(`${base}/short`, { follow: true });
  assert.equal(result.status, 200);
  assert.equal(result.url, `${base}/long?x=1`);
});

test("a chunked page is unwrapped, so a tag is never split", async (t) => {
  const { server, base } = await origin();
  t.after(() => server.close());
  const result = await request(`${base}/chunked`, { bodyLimit: 4096 });
  assert.match(result.text, /http-equiv="refresh"/);
  assert.doesNotMatch(result.text, /^[0-9a-f]{1,3}\r\n/i, "chunk lengths must be gone");
});

test("the proxy is used when one is configured, with the full address in the request", async (t) => {
  const { server, base } = await origin();
  const p = await proxy();
  t.after(() => {
    server.close();
    p.server.close();
    delete process.env.HTTP_PROXY;
    delete process.env.NO_PROXY;
  });
  process.env.HTTP_PROXY = p.url;
  const result = await request(`${base}/short`, { bodyLimit: 4096 });
  assert.equal(result.status, 200);
  assert.match(result.text, /via proxy/);
  assert.equal(p.seen[0], `${base}/short`, "a proxy is asked with the whole URL");
});

test("NO_PROXY exempts a host from the proxy", async (t) => {
  const { server, base } = await origin();
  const p = await proxy();
  t.after(() => {
    server.close();
    p.server.close();
    delete process.env.HTTP_PROXY;
    delete process.env.NO_PROXY;
  });
  process.env.HTTP_PROXY = p.url;
  process.env.NO_PROXY = "127.0.0.1";
  assert.equal(proxyFor(`${base}/short`), null);
  const result = await request(`${base}/short`);
  assert.equal(result.status, 302);
  assert.equal(p.seen.length, 0);
});

test("a host with nothing listening fails fast with a code, not a message", async () => {
  // Port 1 on loopback: nothing listens there, so the answer must be a refusal
  // code inside a moment — not a seven-second wait inside a resolver.
  const startedAt = Date.now();
  const result = await request("http://127.0.0.1:1/x", { timeoutMs: 2000 });
  assert.equal(result.status, 0);
  assert.ok(typeof result.error === "string" && result.error.length > 0);
  assert.ok(Date.now() - startedAt < 2000, "a refusal must not wait for the timeout");
});

/* ── the Mac's own proxy settings ─────────────────────────────────────── */

const SCUTIL = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  HTTPEnable : 0
  HTTPSEnable : 1
  HTTPSPort : 8080
  HTTPSProxy : proxy.corp.example
  ProxyAutoConfigEnable : 0
}`;

test("a Mac's system proxy is read from scutil, with its bypass list", () => {
  const parsed = parseScutilProxy(SCUTIL);
  assert.equal(parsed.proxy, "http://proxy.corp.example:8080");
  assert.deepEqual(parsed.exceptions, ["*.local", "169.254/16"]);
});

test("a Mac with no proxy says so, and a PAC file is reported rather than run", () => {
  const off = parseScutilProxy("<dictionary> {\n  HTTPEnable : 0\n  HTTPSEnable : 0\n}");
  assert.equal(off.proxy, null);
  assert.equal(off.pac, "");
  const pac = parseScutilProxy(
    "<dictionary> {\n  ProxyAutoConfigEnable : 1\n  ProxyAutoConfigURLString : http://wpad/wpad.dat\n}",
  );
  assert.equal(pac.proxy, null);
  assert.equal(pac.pac, "http://wpad/wpad.dat");
});

test("a reply carries the address family that answered", async (t) => {
  const { server, base } = await origin();
  t.after(() => server.close());
  const result = await request(`${base}/short`);
  // 0 means "the stack chose"; 4 means the IPv4 second chance was needed.
  assert.ok([0, 4, 6].includes(result.family), `unexpected family ${result.family}`);
});

/* ── a proxy that is configured but does not answer ───────────────────── */

test("a stale proxy is stepped over, and the direct connection answers", async (t) => {
  // The macOS story in one test: a proxy left enabled by a corporate profile or
  // a VPN app that is not running. Trusting it turns a working machine into a
  // timeout; trying it and then going direct does not.
  const { server, base } = await origin();
  t.after(() => {
    server.close();
    delete process.env.HTTP_PROXY;
  });
  process.env.HTTP_PROXY = "http://127.0.0.1:1";
  assert.deepEqual(
    routesFor(`${base}/short`).map((route) => route.kind),
    ["proxy", "direct"],
    "the configured proxy is tried first, the direct line behind it",
  );
  const result = await request(`${base}/short`, { timeoutMs: 2000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 302);
  assert.equal(result.route, "direct", "the answer came from the direct connection");
  assert.deepEqual(
    result.attempts.map((one) => one.route),
    ["proxy", "direct"],
    "both routes are reported, in the order they were tried",
  );
  assert.ok(result.attempts[0].error, "the dead proxy is named as the reason it was skipped");
});

test("with no proxy configured there is nothing to step over", async (t) => {
  const { server, base } = await origin();
  t.after(() => server.close());
  assert.deepEqual(
    routesFor(`${base}/short`).map((route) => route.kind),
    ["direct"],
  );
});
