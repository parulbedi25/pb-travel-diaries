/**
 * Outbound HTTP, through whatever the host actually has.
 *
 * One feature in this app reaches out to somebody else's server: expanding a
 * shortened map link. Everything else is either local or the visitor's own
 * browser. That makes this file the whole of the site's outbound story, and it
 * exists because "the server cannot reach Google" has three quite different
 * causes that all look identical from inside a `catch`:
 *
 *  1. **No route at all** — a locked-down host, an `ENOTFOUND`, a reset. No
 *     amount of retrying helps, and the operator needs to know immediately.
 *  2. **A proxy** — most shared hosting and every corporate network insists on
 *     one. Node's built-in `fetch` ignores `HTTPS_PROXY`, so a link that works
 *     perfectly in a browser fails in Node with a bare `ECONNRESET`. This file
 *     honours the standard proxy variables: `HTTPS_PROXY`, `https_proxy`,
 *     `HTTP_PROXY`, `http_proxy`, `ALL_PROXY`, `all_proxy`, and `NO_PROXY`.
 *  3. **A slow-but-working network** — worth one retry, never worth hanging.
 *
 * Nothing here is clever: no connection pooling, no HTTP/2, no dependency. It
 * asks for a URL, reads the status line and the headers, and stops — which is
 * all a redirect chain needs. Bodies are read only when a caller explicitly
 * asks, and only up to a cap.
 */

import { execFileSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";

/** The usual suspects, in the order curl and npm read them. */
const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
const NO_PROXY_VARS = ["NO_PROXY", "no_proxy"];

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

/** Whether a host is exempted by `NO_PROXY` (comma-separated, `*.example.com` too). */
function bypassed(host) {
  if (!host) return true;
  const raw = NO_PROXY_VARS.map((name) => process.env[name]).find(Boolean);
  if (!raw) return false;
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") return true;
      const bare = entry.replace(/^\./, "").replace(/^\*\./, "");
      return host === bare || host.endsWith(`.${bare}`);
    });
}

/**
 * The proxy macOS itself is using, read from the system settings.
 *
 * A Mac's proxy lives in System Settings, not in the environment, so a server
 * started from a shell inherits nothing — and a machine that reaches the
 * internet happily in Safari reaches it not at all from Node. `scutil --proxy`
 * is the documented way to ask, it needs no privileges, and it costs one short
 * subprocess. Read for a few seconds at most: settings do not change mid-route,
 * and a request should never wait on a process spawn more than once.
 */
let systemCache = { at: 0, value: null };
const SYSTEM_TTL_MS = 20_000;

export function parseScutilProxy(text) {
  const read = (key) => {
    const match = text.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, "m"));
    return match ? match[1].trim() : "";
  };
  const httpsOn = read("HTTPSEnable") === "1";
  const httpOn = read("HTTPEnable") === "1";
  const host = httpsOn ? read("HTTPSProxy") : httpOn ? read("HTTPProxy") : "";
  const port = httpsOn ? read("HTTPSPort") : httpOn ? read("HTTPPort") : "";
  if (!host) {
    return {
      proxy: null,
      // A PAC file cannot be evaluated here, but saying so beats pretending the
      // machine has no proxy at all.
      pac: read("ProxyAutoConfigEnable") === "1" ? read("ProxyAutoConfigURLString") : "",
      exceptions: [],
    };
  }
  const exceptions = [...text.matchAll(/^\s*\d+\s*:\s*(.+)$/gm)].map((match) => match[1].trim());
  return { proxy: `http://${host}${port ? `:${port}` : ""}`, pac: "", exceptions };
}

function systemProxy() {
  if (process.platform !== "darwin") return { proxy: null, pac: "", exceptions: [] };
  if (Date.now() - systemCache.at < SYSTEM_TTL_MS) return systemCache.value;
  let parsed = { proxy: null, pac: "", exceptions: [] };
  try {
    parsed = parseScutilProxy(execFileSync("scutil", ["--proxy"], { timeout: 500, encoding: "utf8" }));
  } catch {
    /* no scutil, or it answered too slowly: carry on without it */
  }
  systemCache = { at: Date.now(), value: parsed };
  return parsed;
}

/**
 * The proxy to use for a URL, or null when the host wants a direct connection.
 *
 * Read at call time rather than at import time: a host panel sets these on the
 * running process, and a cached `null` from boot would outlive the fix. The
 * environment wins; a Mac's system settings are the fallback, because that is
 * where a Mac keeps the proxy the browser has been using all along.
 */
export function proxyFor(url) {
  const host = hostOf(url);
  if (bypassed(host)) return null;
  for (const name of PROXY_VARS) {
    const value = process.env[name];
    if (!value || !value.trim()) continue;
    const text = /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim()) ? value.trim() : `http://${value.trim()}`;
    try {
      const parsed = new URL(text);
      if (!parsed.hostname) continue;
      return parsed;
    } catch {
      /* a malformed variable is not a proxy */
    }
  }
  const system = systemProxy();
  if (!system.proxy) return null;
  // The Mac's own "bypass proxy for these hosts" list, honoured the same way.
  const skipped = system.exceptions.some((entry) => {
    const bare = entry.replace(/^\*?\./, "").replace(/\/.*$/, "").trim().toLowerCase();
    return bare && (host === bare || host.endsWith(`.${bare}`));
  });
  if (skipped) return null;
  try {
    const parsed = new URL(system.proxy);
    return parsed.hostname ? parsed : null;
  } catch {
    return null;
  }
}

/** Whether this process was told about a proxy at all, for the dashboard. */
export const proxyConfigured = () => Boolean(proxyFor("https://example.com/"));

/**
 * A Mac's PAC file, when it has one and we cannot follow it.
 *
 * The system's "automatic proxy configuration" is a JavaScript function that
 * decides per URL. Evaluating it here would mean running somebody's script
 * inside the server, so it is reported instead — a person can then either set
 * `HTTPS_PROXY` by hand or switch the Mac to a fixed proxy.
 */
export const systemPac = () => (process.platform === "darwin" ? systemProxy().pac : "");

const authHeader = (proxy) =>
  proxy.username
    ? {
        "proxy-authorization": `Basic ${Buffer.from(
          `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password ?? "")}`,
        ).toString("base64")}`,
      }
    : {};

/**
 * Chunked transfer encoding, unwrapped.
 *
 * A server is free to send a page in pieces, each prefixed with its length in
 * hex and followed by a blank line. Left in, those prefixes land in the middle
 * of the HTML and can split the very tag this is looking for — so a page is
 * unwrapped before it is searched, not after it fails to match.
 */
function dechunk(buffer) {
  const out = [];
  let at = 0;
  while (at < buffer.length) {
    const lineEnd = buffer.indexOf("\r\n", at);
    if (lineEnd < 0) break;
    const size = parseInt(buffer.subarray(at, lineEnd).toString("latin1").split(";")[0], 16);
    if (!Number.isFinite(size) || size < 0) return buffer;
    if (size === 0) break;
    const start = lineEnd + 2;
    out.push(buffer.subarray(start, Math.min(start + size, buffer.length)));
    at = start + size + 2;
  }
  return out.length ? Buffer.concat(out) : buffer;
}

/** Plain-text header block → status, location, and the rest of the headers. */
function parseHead(raw) {
  const text = raw.toString("latin1");
  const end = text.indexOf("\r\n\r\n");
  const head = end >= 0 ? text.slice(0, end) : text;
  const lines = head.split("\r\n");
  const statusLine = lines.shift() ?? "";
  const status = Number(statusLine.split(" ")[1] ?? 0) || 0;
  const headers = new Map();
  for (const line of lines) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const name = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    headers.set(name, headers.has(name) ? `${headers.get(name)}, ${value}` : value);
  }
  return { status, headers, statusLine };
}

/**
 * One request down one route: the status, the headers, and (when asked) some of
 * the body.
 *
 * `follow` is not a fetch option here — it is a loop in `request` below — so a
 * caller always knows which address answered. That matters: this module is used
 * to prove *where* a short link goes.
 *
 * The route is passed in rather than decided here, because a machine can offer
 * more than one and only trying them in order settles which one works.
 */
function attempt(url, route, { headers = {}, timeoutMs = 4000, bodyLimit = 0 } = {}) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      resolve({ status: 0, headers: new Map(), text: "", error: "EBADURL" });
      return;
    }
    const secure = target.protocol === "https:";
    if (!secure && target.protocol !== "http:") {
      resolve({ status: 0, headers: new Map(), text: "", error: "EBADPROTOCOL" });
      return;
    }
    const proxy = route.proxy;
    const port = target.port || (secure ? "443" : "80");
    const path = `${target.pathname}${target.search}`;
    const requestHeaders = {
      host: target.host,
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "accept-encoding": "identity",
      connection: "close",
      ...headers,
    };

    let settled = false;
    /** Which address family finally answered: 0 chosen by the stack, 4, or 6. */
    let lastFamily = 0;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve({ family: lastFamily, route: route.kind, ...value });
    };
    const fail = (error) => finish({ status: 0, headers: new Map(), text: "", error });

    /** Send the request down an already-open socket and read the head. */
    const exchange = (socket) => {
      socket.setTimeout(timeoutMs, () => {
        socket.destroy();
        fail("ETIMEDOUT");
      });
      socket.on("error", (error) => fail(error?.code || "ENETWORK"));

      const lines = [`GET ${path} HTTP/1.1`];
      for (const [name, value] of Object.entries(requestHeaders)) {
        lines.push(`${name}: ${value}`);
      }
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);

      let raw = Buffer.alloc(0);
      const onData = (chunk) => {
        raw = Buffer.concat([raw, chunk]);
        const end = raw.indexOf("\r\n\r\n");
        if (end < 0) {
          // Nothing sensible is this long before a header block ends.
          if (raw.length > 64_000) {
            socket.destroy();
            fail("EHEADERS");
          }
          return;
        }
        const { status, headers: parsed } = parseHead(raw.subarray(0, end + 2));
        // Only a successful answer has a body worth reading, and only a
        // chunked one needs unwrapping before a page can be searched.
        if (bodyLimit <= 0 || status < 200 || status >= 300) {
          socket.destroy();
          finish({ status, headers: parsed, text: "", url });
          return;
        }
        let body = raw.subarray(end + 4);
        const done = () => {
          socket.destroy();
          const chunked = (parsed.get("transfer-encoding") ?? "").includes("chunked");
          const text = (chunked ? dechunk(body) : body).subarray(0, bodyLimit).toString("utf8");
          finish({ status, headers: parsed, text, url });
        };
        if (body.length >= bodyLimit) return done();
        socket.on("data", (more) => {
          body = Buffer.concat([body, more]);
          if (body.length >= bodyLimit) done();
        });
        socket.on("end", done);
        socket.on("close", done);
      };
      socket.on("data", onData);
    };

    if (!proxy) {
      void dial(target.hostname, Number(port), secure, timeoutMs).then(({ socket, error, family }) => {
        if (!socket) {
          fail(error);
          return;
        }
        // Recorded so a hang can be explained later: "it answered over IPv4"
        // is the sentence that ends a week of guessing.
        lastFamily = family;
        socket.on("error", (issue) => fail(issue?.code || "ENETWORK"));
        exchange(socket);
      });
      return;
    }

    // Through a proxy: HTTPS needs a CONNECT tunnel, plain HTTP can be asked
    // for outright with the full address in the request line.
    if (!secure) {
      const req = http.request(
        {
          host: proxy.hostname,
          port: proxy.port || "80",
          method: "GET",
          path: target.toString(),
          headers: { ...requestHeaders, host: target.host, ...authHeader(proxy) },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            if (body.length < bodyLimit) body += chunk;
          });
          res.on("end", () =>
            finish({
              status: res.statusCode ?? 0,
              headers: new Map(Object.entries(res.headers).map(([k, v]) => [k, String(v)])),
              text: body.slice(0, bodyLimit || 0),
              url,
            }),
          );
        },
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        fail("ETIMEDOUT");
      });
      req.on("error", (error) => {
        const code = error?.cause?.code || error?.code || "ENETWORK";
        fail(code === 501 || code === 407 ? "EPROXY" : code);
      });
      req.end();
      return;
    }

    const tunnel = http.request({
      host: proxy.hostname,
      port: proxy.port || "80",
      method: "CONNECT",
      path: `${target.hostname}:${port}`,
      headers: { host: `${target.hostname}:${port}`, ...authHeader(proxy) },
    });
    tunnel.setTimeout(timeoutMs, () => {
      tunnel.destroy();
      fail("ETIMEDOUT");
    });
    tunnel.on("error", (error) => fail(error?.cause?.code || error?.code || "ENETWORK"));
    tunnel.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        fail(res.statusCode === 407 ? "EPROXYAUTH" : "EPROXY");
        return;
      }
      const tlsSocket = tls.connect({ socket, servername: target.hostname }, () => exchange(tlsSocket));
      tlsSocket.on("error", (error) => fail(error?.code || "ETLS"));
    });
    tunnel.end();
  });
}

/** A bare TCP socket, so the two branches above read the same way. */
function httpRequestSocket(host, port, family = 0) {
  return net.connect({ host, port, family, autoSelectFamily: family === 0 });
}

/**
 * Failures that mean "try the other address family", not "give up".
 *
 * A Mac on a network that advertises IPv6 but cannot carry it prefers IPv6 and
 * then hangs: the name resolves, the connection is attempted, and nothing comes
 * back. Windows on the same network often has IPv6 switched off at the adapter
 * and never notices. That is the whole of the "it worked on Windows" story —
 * nothing to do with the operating system, everything to do with which address
 * family the machine tries first. Asking again in IPv4 takes one line and turns
 * a hang into a map.
 */
const RETRY_V4 = new Set(["ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN", "ECONNRESET"]);

/** Open a connection, with one IPv4-only attempt after a connectivity failure. */
function dial(host, port, secure, timeoutMs) {
  return new Promise((resolve) => {
    const attempt = (family) => {
      let settled = false;
      const socketFor = (socket) => {
        socket.setTimeout(timeoutMs, () => {
          if (settled) return;
          settled = true;
          socket.destroy();
          retryOrFail("ETIMEDOUT", family);
        });
        socket.once("error", (error) => {
          if (settled) return;
          settled = true;
          retryOrFail(error?.code || "ENETWORK", family);
        });
      };
      const retryOrFail = (code, tried) => {
        if (tried !== 4 && RETRY_V4.has(code)) {
          attempt(4);
          return;
        }
        resolve({ socket: null, error: code, family: tried });
      };

      if (!secure) {
        const socket = httpRequestSocket(host, port, family);
        socketFor(socket);
        socket.once("connect", () => {
          if (settled) return;
          settled = true;
          socket.setTimeout(0);
          socket.removeAllListeners("error");
          resolve({ socket, error: "", family });
        });
        return;
      }

      const socket = tls.connect({ host, port, servername: host, family });
      socketFor(socket);
      socket.once("secureConnect", () => {
        if (settled) return;
        settled = true;
        socket.setTimeout(0);
        socket.removeAllListeners("error");
        resolve({ socket, error: "", family });
      });
    };
    attempt(0);
  });
}

/**
 * The ways out this machine actually has, best first.
 *
 * A configured proxy is tried first — somebody set it for a reason — with a
 * direct connection behind it. That second chance is the whole point: a Mac
 * keeps its proxy in System Settings, and a stale entry left by a corporate
 * profile or a VPN app that is not running is still there, still enabled, and
 * still pointed at nothing. Reading it and trusting it turns a working machine
 * into `ETIMEDOUT`; reading it, trying it, and *not believing it* when it does
 * not answer does not.
 */
export function routesFor(url) {
  const direct = { kind: "direct", proxy: null };
  const proxy = proxyFor(url);
  return proxy ? [{ kind: "proxy", proxy }, direct] : [direct];
}

/**
 * Failures worth another route.
 *
 * Anything that means "this route could not deliver the request" belongs here.
 * A status code does not: an answer is an answer, even a 404, and asking a
 * second way would only produce a second, confusing answer.
 */
const RETRY_ROUTE = new Set([
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETWORK",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPROXY",
  "EPROXYAUTH",
  "ETLS",
]);

/**
 * One request, trying each route in turn until one answers.
 *
 * The first route gets the larger share of the budget and the rest split what
 * remains, so a dead proxy costs about half of one attempt rather than the whole
 * of it. The attempts are reported back with the answer: "the proxy timed out,
 * the direct connection answered in 180 ms" is a diagnosis, and a caller that
 * only knows "it failed" has to guess again.
 */
async function once(url, options = {}) {
  const { timeoutMs = 4000 } = options;
  const routes = routesFor(url);
  const tried = [];
  let latest = null;
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    // The first of two gets 40% and the rest gets the remainder, because a dead
    // proxy costs the whole of whatever it is given: a redirect through a proxy
    // that is actually working answers in well under a second, while a proxy
    // that is not there will use every millisecond offered and return nothing.
    const share =
      index === 0 && routes.length > 1 ? Math.max(1200, Math.round(timeoutMs * 0.4)) : timeoutMs;
    latest = await attempt(url, route, { ...options, timeoutMs: share });
    tried.push({ route: route.kind, error: latest.error || "", family: latest.family ?? 0 });
    if (!latest.error) break;
    if (!RETRY_ROUTE.has(latest.error)) break;
  }
  return { ...latest, attempts: tried };
}

/**
 * A URL, one hop at a time or followed to its end.
 *
 * Returns `{ status, headers, text, url, error }`; `url` is the address that
 * actually answered, which is what a redirect chain is being read for. Errors
 * are codes, not messages, so a caller can tell "no route" from "slow" without
 * parsing English out of a stack.
 */
export async function request(url, options = {}) {
  const { follow = false, maxHops = 8, timeoutMs = 4000 } = options;
  if (!follow) return once(url, options);
  let current = url;
  for (let hop = 0; hop < maxHops; hop += 1) {
    const result = await once(current, options);
    if (result.error) return result;
    const location = result.headers.get("location");
    if (!location || result.status < 300 || result.status >= 400) return result;
    try {
      current = new URL(location, current).toString();
    } catch {
      return result;
    }
  }
  return { status: 0, headers: new Map(), text: "", error: "ETOOMANYHOPS" };
}

/** Whether this process can reach the network at all, for the dashboard. */
export const egressSummary = () => ({
  proxy: proxyConfigured() ? proxyFor("https://example.com/")?.host ?? "configured" : "",
  node: process.version,
});
