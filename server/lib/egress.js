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

import http from "node:http";
import net from "node:net";
import tls from "node:tls";

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
 * The proxy to use for a URL, or null when the host wants a direct connection.
 *
 * Read at call time rather than at import time: a host panel sets these on the
 * running process, and a cached `null` from boot would outlive the fix.
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
  return null;
}

/** Whether this process was told about a proxy at all, for the dashboard. */
export const proxyConfigured = () => Boolean(proxyFor("https://example.com/"));

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
 * One request: the status, the headers, and (when asked) some of the body.
 *
 * `follow` is not a fetch option here — it is a loop in `request` below — so a
 * caller always knows which address answered. That matters: this module is used
 * to prove *where* a short link goes.
 */
function once(url, { headers = {}, timeoutMs = 4000, bodyLimit = 0 } = {}) {
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
    const proxy = proxyFor(url);
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
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
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
      const socket = (secure
        ? tls.connect({ host: target.hostname, port, servername: target.hostname })
        : httpRequestSocket(target.hostname, port)
      ).on("error", (error) => fail(error?.code || "ENETWORK"));
      socket.once(secure ? "secureConnect" : "connect", () => exchange(socket));
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
function httpRequestSocket(host, port) {
  return net.connect({ host, port });
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
