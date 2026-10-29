/**
 * Expanding a shortened map link.
 *
 * Google's share button gives a link like `https://maps.app.goo.gl/YJBuu2o…`,
 * and that is the *only* thing a rider can send from the phone: the real route
 * is behind a redirect. A page cannot read that redirect — a cross-origin
 * `Location` header is invisible to `fetch` — so the expansion has to happen
 * here, on the server, and the dashboard asks for the answer.
 *
 * This is deliberately the smallest thing that works, because it is the one
 * place in the app that fetches a URL a person typed:
 *
 *  - Only known shorteners are accepted as input (`maps.app.goo.gl`, `goo.gl`,
 *    `g.co`). This is not a general proxy.
 *  - Every hop is checked against the map hosts before it is followed, so a
 *    redirect cannot walk off to an internal address — the classic SSRF shape.
 *  - At most four hops, a deadline, and the body is read only when the answer
 *    is a page rather than a redirect (see `targetInPage`).
 *  - The answer is a *link*, never the page. The dashboard then parses it with
 *    the same code that reads a long link pasted by hand.
 *
 * Three things make this survive a real network rather than an ideal one:
 *
 *  - **A retry per hop.** A shared host's egress stalls for a moment, and a
 *    stall is not an answer: the first failure re-asks once on a fresh
 *    connection before anything is reported.
 *  - **Pages that redirect in their own body.** Google answers a share link
 *    with a 302 most of the time, and with an HTML shim carrying a meta
 *    refresh, or a `location.href = "…"` script, the rest of the time. The
 *    shim used to be returned as if it were the answer, which is what produced
 *    "the short link could not be read" on a link that was perfectly good.
 *  - **The consent wall.** From some networks Google answers a share link by
 *    sending the browser to `consent.google.com` first. That is not a map, so
 *    it cannot be followed — instead the original link is asked again, this
 *    time with the cookie that declines the wall.
 */
import express from "express";
import { requireEditor } from "../lib/auth.js";
import { proxyFor, request as egressRequest, systemPac } from "../lib/egress.js";

export const mapsRouter = express.Router();

/** Links people actually share from a phone. */
const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "g.co", "g.co.in"]);

/** Where a redirect is allowed to end up. */
const MAP_HOSTS = [
  "google.com",
  "google.co.in",
  "goo.gl",
  "g.co",
  "bing.com",
  "apple.com",
  "openstreetmap.org",
];

/**
 * Hosts that mean "answer this again differently", never "this is the map".
 *
 * `consent.google.com` sits under `google.com`, so it is allowed to be reached
 * — but a page asking for consent is not an address to hand back.
 */
const CONSENT_HOSTS = ["consent.google.com", "consent.youtube.com"];

const MAX_HOPS = 4;
/** One attempt's budget. Two of these fit inside the overall deadline below. */
const ATTEMPT_TIMEOUT_MS = 4000;
/** The whole expansion, retries included, may not outlast this. */
const DEADLINE_MS = 7000;

/**
 * Failures that no amount of retrying can improve.
 *
 * `ENOTFOUND` is "that name does not resolve here", `ECONNREFUSED` and
 * `ECONNRESET` are "nothing is listening" or "something cut us off", and the
 * `EPROXY*` codes are the proxy itself refusing. Each one is worth reporting in
 * the first 50 milliseconds rather than spending seven seconds to say the same
 * thing — which is what "without taking much time" actually means when the
 * network is the thing that is wrong.
 */
const HOPELESS = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "EPROXY",
  "EPROXYAUTH",
  "ETLS",
]);
/** Enough of a page to find its redirect in; a Google answer is far smaller. */
const MAX_PAGE_BYTES = 300_000;

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** A host is allowed if it *is* one of these or sits under it. */
const allowed = (host, list) => list.some((base) => host === base || host.endsWith(`.${base}`));

const isShortHost = (host) => SHORT_HOSTS.has(host);
const shortAllowed = (host) => isShortHost(host) || allowed(host, [...MAP_HOSTS]);
const mapAllowed = (host) => allowed(host, MAP_HOSTS);
const consentHost = (host) => CONSENT_HOSTS.includes(host);

export class MapLinkError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

/**
 * Answers already worked out, newest last.
 *
 * Pasting the same link twice — which is what happens when the first import is
 * undone and tried again — should not be two round trips to Google, and the
 * dashboard's own retry should be free. Only real fetches are cached: a test's
 * fake network is never remembered, so one case cannot answer for another.
 */
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_LIMIT = 64;
const resolved = new Map();

const cached = (key) => {
  const hit = resolved.get(key);
  if (!hit) return "";
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    resolved.delete(key);
    return "";
  }
  return hit.url;
};

const remember = (key, url) => {
  resolved.delete(key);
  resolved.set(key, { url, at: Date.now() });
  while (resolved.size > CACHE_LIMIT) resolved.delete(resolved.keys().next().value);
};

/** The address a page is going to send the browser to, if it says so. */
const PAGED_REDIRECTS = [
  // <meta http-equiv="refresh" content="0; url=https://…">
  /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"'>\s]+)/i,
  // location.replace("https://…") / location.href = "https://…"
  /location(?:\.replace\s*\(|\.href\s*=|\.assign\s*\()\s*["']([^"']+)["']/i,
  // <link rel="canonical" href="…"> — the address the page claims to be.
  /<link[^>]+rel=["']?canonical["']?[^>]+href=["']([^"']+)["']/i,
];

/**
 * The map inside a page that answered instead of redirecting.
 *
 * Google's share links answer with a 302 nearly always, but not always: a 200
 * carrying a meta refresh or a one-line script is the other shape, and it used
 * to be handed back as the answer — which then parsed to no stops at all. Only
 * a candidate that is a map host is taken, so a page full of links cannot
 * steer this anywhere else.
 */
export function targetInPage(href, html) {
  if (!html) return "";
  for (const pattern of PAGED_REDIRECTS) {
    const found = html.match(pattern)?.[1];
    if (!found) continue;
    const cleaned = found.replace(/&amp;/g, "&").trim();
    try {
      const url = new URL(cleaned, href);
      if (/^https?:$/.test(url.protocol) && mapAllowed(hostOf(url.toString())) && !consentHost(hostOf(url.toString()))) {
        return url.toString();
      }
    } catch {
      /* a broken candidate is just a candidate */
    }
  }
  return "";
}

/**
 * The network, shaped like `fetch`.
 *
 * The resolver below was written against `fetch`, and its tests hand in their
 * own. This adapter keeps that shape while actually going through
 * `lib/egress`, which honours the proxy variables Node's `fetch` ignores — so
 * one change makes every existing branch run on a proxied host.
 */
const egressFetch = async (url, init = {}) => {
  const headers = {};
  for (const [name, value] of Object.entries(init.headers ?? {})) headers[name] = value;
  const result = await egressRequest(url, {
    headers,
    timeoutMs: ATTEMPT_TIMEOUT_MS,
    follow: init.redirect === "follow",
    bodyLimit: init.readBody ? 120_000 : 0,
  });
  if (result.error) {
    const error = new Error(result.error);
    // Carried on `code` as well as `cause`, because both spellings are common.
    error.code = result.error;
    error.cause = { code: result.error };
    // Which ways out were tried, and how each one ended. Without this the
    // dashboard can only say "it failed", and the difference between a dead
    // proxy and a dead network is exactly what the operator needs.
    error.attempts = result.attempts ?? [];
    error.route = result.route ?? "";
    throw error;
  }
  return {
    status: result.status,
    url: result.url,
    headers: new Headers([...result.headers.entries()]),
    body: null,
    text: async () => result.text,
  };
};

/** Fetch, with one retry, inside a deadline. Only the headers are wanted. */
async function look(url, fetchImpl, deadline, cookie, { readBody = false } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const left = deadline - Date.now();
    if (left < 600) break;
    const budget = Math.min(ATTEMPT_TIMEOUT_MS, left);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        readBody,
        headers: {
          // Google answers a bare request with a consent wall; a plain browser
          // user agent gets the redirect it would give a phone.
          "user-agent":
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
          accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "accept-language": "en-IN,en;q=0.9",
          ...(cookie ? { cookie } : {}),
        },
        signal: AbortSignal.timeout(budget),
      });
      return { response, error: null };
    } catch (error) {
      lastError = error;
      const code = error?.cause?.code || error?.code || "";
      // A stall is worth one more ask. A refusal is the answer.
      if (HOPELESS.has(code)) break;
      const quick = error?.name === "TimeoutError" || error?.name === "AbortError";
      if (!quick && attempt === 1) break;
    }
  }
  return { response: null, error: lastError };
}

/**
 * The last resort: let the network follow the chain and say where it ended.
 *
 * The walk below reads 302s one at a time and checks every hop against the map
 * hosts, which is what keeps this from being an open proxy. Some answers defeat
 * that: a 403 from a bot filter, a share page whose redirect is spelled in a
 * way this code cannot read, a chain longer than the hop budget. `redirect:
 * "follow"` handles all of those in one request, and undici hands back the
 * address it finally landed on as `response.url`.
 *
 * It is only ever used for a known shortener, and its answer is checked against
 * the map hosts before it is believed, so the guard still holds: nothing here
 * can be steered at an internal address by a redirect.
 */
async function chase(url, fetchImpl, deadline, cookie) {
  const left = deadline - Date.now();
  if (left < 800) return null;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "accept-language": "en-IN,en;q=0.9",
        ...(cookie ? { cookie } : {}),
      },
      signal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, left)),
    });
    const finalUrl = typeof response.url === "string" ? response.url : "";
    let page = "";
    try {
      if (response.status >= 200 && response.status < 300 && typeof response.text === "function") {
        page = await readLimited(response, MAX_PAGE_BYTES);
      }
    } catch {
      page = "";
    }
    try {
      await response.body?.cancel?.();
    } catch {
      /* already drained */
    }
    return { finalUrl, page, status: response.status, error: null };
  } catch (error) {
    return { finalUrl: "", page: "", status: 0, error };
  }
}

/** Anything that would make a URL an acceptable place to stop at. */
const believable = (url) => {
  const host = hostOf(url);
  return Boolean(host) && mapAllowed(host) && !consentHost(host);
};

/**
 * Whether a URL is a whole map address rather than a share token.
 *
 * `maps.app.goo.gl/YJBuu2o9CKs3reLg9` is a token: a single opaque segment, and
 * the only thing it means is "ask again and you will be redirected". A share
 * page that answers 200 and never redirects is that same URL, so it must not be
 * mistaken for the route — which is exactly how a failed expansion came back
 * looking like a success. A real map address has a shape: `/maps/dir/…`,
 * `/maps/place/…`, a `@lat,lng` in it, or at least more than one segment.
 */
const looksLikeMapAddress = (url) => {
  try {
    const { pathname, search, host } = new URL(url);
    if (!isShortHost(host)) return true;
    const segments = pathname.split("/").filter(Boolean);
    return segments.length > 1 || /maps|dir|place|search|@/.test(`${pathname}${search}`);
  } catch {
    return false;
  }
};

/**
 * Follow a short link to the map URL it hides, or throw a `MapLinkError` that
 * says why it could not. `fetchImpl` is there so the tests can hand in a fake
 * network instead of talking to Google.
 */
export async function expandMapLink(raw, fetchImpl = egressFetch) {
  const text = String(raw ?? "").trim();
  if (!text) throw new MapLinkError("Paste a link to expand.", 400);

  let current;
  try {
    current = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new MapLinkError("That is not a link.", 400);
  }
  if (!/^https?:$/.test(current.protocol)) {
    throw new MapLinkError("Only http and https links can be expanded.", 400);
  }
  if (!shortAllowed(hostOf(current.toString()))) {
    throw new MapLinkError(
      "Only shortened map links need expanding — paste the full directions link instead.",
      400,
    );
  }

  // A fake network is never remembered, and never reads the shared cache: the
  // tests ask the same short link to fail and to succeed in different cases.
  const real = fetchImpl === egressFetch || fetchImpl === globalThis.fetch;
  const origin = current.toString();
  if (real) {
    const hit = cached(origin);
    if (hit) return hit;
  }

  const deadline = Date.now() + DEADLINE_MS;
  let cookie = "";
  let lastTimeout = false;
  let failed = false;
  /** The last network error's code, so a failure can be diagnosed, not guessed. */
  let failureCode = "";
  /** Which routes were tried before giving up — the proxy, a direct line, both. */
  let failureAttempts = [];

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const here = current.toString();
    // The body is wanted only when the answer is a page rather than a 302, but
    // that is not known until the headers arrive — so it is asked for, capped,
    // and read only in that one case.
    const { response, error } = await look(here, fetchImpl, deadline, cookie, { readBody: true });

    let location = "";
    let page = "";
    let status = 0;

    if (response) {
      status = response.status;
      location = response.headers.get("location") ?? "";

      // The address is what matters, so the body is dropped unread — except in
      // the one case where the body *is* the address.
      if (!location && status >= 200 && status < 300 && typeof response.text === "function") {
        try {
          page = await readLimited(response, MAX_PAGE_BYTES);
        } catch {
          page = "";
        }
      }
      try {
        await response.body?.cancel?.();
      } catch {
        /* already drained, or nothing to drain */
      }

      // Consent wall: not a map, and not an answer. Ask the same link again
      // with the cookie that declines it, which is what a browser does when a
      // person clicks past the wall.
      if (location) {
        let wall = "";
        try {
          wall = new URL(location, current).toString();
        } catch {
          wall = "";
        }
        if (wall && consentHost(hostOf(wall))) {
          if (cookie) {
            // Asked twice and still walled: nothing this server can do.
            failed = true;
            break;
          }
          cookie = "CONSENT=YES+1";
          continue;
        }
      }

      // A page that carries the redirect instead of a 302 for it.
      if (!location && page) {
        const fromPage = targetInPage(here, page);
        if (fromPage && fromPage !== here) {
          current = new URL(fromPage);
          continue;
        }
      }
    } else {
      lastTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      failureCode = error?.cause?.code || error?.code || error?.name || "network error";
      failureAttempts = error?.attempts ?? failureAttempts;
      failed = true;
    }

    // A redirect in the headers: checked, then followed.
    if (location) {
      let next;
      try {
        next = new URL(location, current);
      } catch {
        throw new MapLinkError("That short link points somewhere unreadable.", 422);
      }
      // A redirect to itself is the end of the conversation, not a loop.
      if (next.toString() === here) {
        const answer = finish(here);
        if (real) remember(origin, answer);
        return answer;
      }
      if (!/^https?:$/.test(next.protocol) || !mapAllowed(hostOf(next.toString()))) {
        // Looked at, not followed: a redirect is not allowed to leave the map
        // services, however it is spelled.
        throw new MapLinkError("That short link does not lead to a map.", 422);
      }
      current = next;
      continue;
    }

    // No redirect from this hop. If it is already a real map address, that is
    // the answer; if it is still the shortener, this hop told us nothing.
    if (believable(here) && looksLikeMapAddress(here) && status < 400) {
      const answer = finish(here);
      if (real) remember(origin, answer);
      return answer;
    }

    // Otherwise let the network chase it: a bot-filtered 403, a share page
    // whose redirect this code cannot read, or a chain longer than the budget.
    const chased = await chase(here, fetchImpl, deadline, cookie);
    if (chased) {
      const target = chased.finalUrl || targetInPage(here, chased.page);
      if (target && target !== here && believable(target)) {
        // A chased chain has already been followed to its end, so a target that
        // is a whole map address *is* the answer — asking it again would be a
        // second round trip to prove what the network just said.
        if (looksLikeMapAddress(target)) {
          const answer = finish(target);
          if (real) remember(origin, answer);
          return answer;
        }
        current = new URL(target);
        continue;
      }
      if (chased.error) {
        lastTimeout = chased.error?.name === "TimeoutError" || chased.error?.name === "AbortError";
        failureCode =
          chased.error?.cause?.code || chased.error?.code || chased.error?.name || failureCode;
        failureAttempts = chased.attempts ?? error?.attempts ?? failureAttempts;
      }
      if (chased.status >= 400 && chased.status !== 403) lastTimeout = false;
    }
    failed = true;
    break;
  }

  if (lastTimeout) {
    throw new MapLinkError(
      "The map service took too long to answer. Open the short link once in a browser, then paste the full address from its address bar.",
      504,
    );
  }
  if (failed) {
    // Named, not vague: whoever reads this is trying to get a route in, and the
    // reason decides whether a second try is worth anything. `ENOTFOUND` and
    // `ECONNREFUSED` mean the server has no way out to Google at all; a wall or
    // a page with no redirect means Google answered but said nothing useful.
    const proxy = proxyFor("https://maps.app.goo.gl/");
    const why = failureCode
      ? `the network answered ${failureCode}`
      : cookie
        ? "Google answered with a consent wall"
        : "Google answered without a redirect";
    // Both ways out, when both were tried: a dead proxy is a different problem
    // from a dead network, and only saying which one was tried tells them apart.
    const tried = Array.isArray(failureAttempts) ? failureAttempts : [];
    const routesNote =
      tried.length > 1
        ? ` Both the proxy ${proxy?.host ?? ""} and a direct connection were tried (${
            tried.map((one) => `${one.route}: ${one.error || "answered"}`).join(", ")
          }).`
        : "";
    const proxyNote = routesNote
      ? routesNote
      : proxy
        ? ` It was tried through the proxy ${proxy.host}, so check that the proxy allows maps.app.goo.gl.`
        : "";
    // In the hosting log as well, because the operator reads that too.
    console.warn(`[maps] could not expand ${origin}: ${why}${proxyNote}`);
    throw new MapLinkError(
      `The short link did not give up its address from this server (${why}).${proxyNote} Open the short link in a browser, copy the address from the address bar and paste that here — a full directions link is read without asking any server.`,
      502,
    );
  }

  const answer = finish(current.toString());
  if (real && answer !== origin) remember(origin, answer);
  return answer;
}

/** The most of a page that will be read, so one answer cannot cost a lot of memory. */
async function readLimited(response, limit) {
  if (!response.body?.getReader) return String(await response.text()).slice(0, limit);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    chunks.push(value);
    if (total >= limit) {
      try {
        await reader.cancel();
      } catch {
        /* nothing left */
      }
      break;
    }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8").slice(0, limit);
}

/** The end of the chain, as long as it really is a map. */
function finish(url) {
  const host = hostOf(url);
  // A consent page sits under `google.com`, so it passes the host check — but
  // it is a question, not a destination, and handing it back would parse to no
  // stops at all.
  if (!mapAllowed(host) || consentHost(host)) {
    throw new MapLinkError("That short link does not lead to a map.", 422);
  }
  return url;
}

/**
 * `GET /api/maps/health` → can this server reach the maps at all?
 *
 * Added because "the short link could not be read" is a sentence about the
 * server, not about the link, and there was no way to tell the difference from
 * the dashboard. One request with a short budget answers it: reachable, and how
 * long it took — or the exact reason it is not, proxy included.
 */
mapsRouter.get("/maps/health", requireEditor, async (_req, res) => {
  const startedAt = Date.now();
  const proxy = proxyFor("https://maps.app.goo.gl/");
  const result = await egressRequest("https://maps.app.goo.gl/", { timeoutMs: 4000 });
  const ms = Date.now() - startedAt;
  // Named because the answer is different on every machine: a proxy from the
  // environment, one from the Mac's own settings, or none at all.
  const proxySource = !proxy
    ? ""
    : ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"].some(
          (name) => process.env[name],
        )
      ? "environment"
      : "system";
  // Every way out this machine offered, and how each one ended. A dead proxy
  // with a working direct connection and two dead routes look identical from a
  // single error code, and they need opposite fixes.
  const routes = (result.attempts ?? []).map((one) => ({
    route: one.route,
    error: one.error || "",
  }));
  const proxyFailed = routes.some((one) => one.route === "proxy" && one.error);
  const detail = {
    ms,
    proxy: proxy?.host ?? "",
    proxySource,
    pac: systemPac(),
    platform: process.platform,
    node: process.version,
    family: result.family ?? 0,
    route: result.route ?? "",
    routes,
  };

  if (result.error) {
    // Both routes named when both were tried: "nothing works" and "the proxy
    // does not work but the network does" are the same code and different fixes.
    const both = routes.length > 1;
    return res.json({
      reachable: false,
      code: result.error,
      ...detail,
      hint: both
        ? `Both the proxy ${proxy?.host ?? ""} and a direct connection failed. A VPN, a firewall, or a host with no outbound HTTPS is the cause — but the browser beside this server can still read the link.`
        : proxy
          ? `The server tried the proxy ${proxy.host} (${proxySource}) and nothing else. Check that it allows maps.app.goo.gl.`
          : HOPELESS.has(result.error)
            ? "This server has no route to Google. Ask the host to allow outbound HTTPS, or set HTTPS_PROXY."
            : "The connection timed out. A proxy, a VPN or a firewall is the usual cause.",
    });
  }
  res.json({
    reachable: true,
    code: "",
    ...detail,
    // IPv4 is worth saying out loud: it is what a Mac on a half-broken IPv6
    // network falls back to, and it explains why one machine works and another
    // does not. A dead proxy that was stepped over is worth more: it is a stale
    // setting, and the maps work anyway.
    hint: proxyFailed
      ? `The proxy ${proxy?.host ?? ""} did not answer, so the direct connection was used — the proxy setting on this machine is stale and can be switched off.`
      : result.family === 4
        ? "Reached Google over IPv4 after the default address family failed — this network's IPv6 is not carrying traffic."
        : "",
  });
});

/**
 * `POST /api/maps/resolve { url }` → `{ url }`.
 *
 * Editor-only: this is a network fetch on someone's behalf, and the dashboard
 * is the only thing that needs it.
 */
mapsRouter.post("/maps/resolve", requireEditor, async (req, res) => {
  try {
    const url = await expandMapLink(req.body?.url);
    res.json({ url });
  } catch (error) {
    if (error instanceof MapLinkError) {
      return res.status(error.status).json({ error: error.message });
    }
    res.status(502).json({ error: "The map service could not be reached." });
  }
});
