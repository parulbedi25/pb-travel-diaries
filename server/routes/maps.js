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
 *  - At most four hops, eight seconds, and the body is thrown away unread: all
 *    that is wanted is the address it ends at.
 *  - The answer is a *link*, never the page. The dashboard then parses it with
 *    the same code that reads a long link pasted by hand.
 */
import express from "express";
import { requireEditor } from "../lib/auth.js";

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

const MAX_HOPS = 4;
const TIMEOUT_MS = 8000;

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** A host is allowed if it *is* one of these or sits under it. */
const allowed = (host, list) => list.some((base) => host === base || host.endsWith(`.${base}`));

const shortAllowed = (host) => SHORT_HOSTS.has(host) || allowed(host, [...MAP_HOSTS]);
const mapAllowed = (host) => allowed(host, MAP_HOSTS);

export class MapLinkError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

/**
 * Follow a short link to the map URL it hides, or throw a `MapLinkError` that
 * says why it could not. `fetchImpl` is there so the tests can hand in a fake
 * network instead of talking to Google.
 */
export async function expandMapLink(raw, fetchImpl = globalThis.fetch) {
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

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    let response;
    try {
      response = await fetchImpl(current.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          // Google answers a bare request with a consent wall; a plain browser
          // user agent gets the redirect it would give a phone.
          "user-agent": "Mozilla/5.0 (compatible; pb-travel-diaries/1.0)",
          accept: "text/html,*/*",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new MapLinkError(
        timeout ? "The map service took too long to answer." : "The map service could not be reached.",
        timeout ? 504 : 502,
      );
    }

    // Only the address matters; the page itself is megabytes of map.
    try {
      await response.body?.cancel();
    } catch {
      /* already drained, or nothing to drain */
    }

    const location = response.headers.get("location");
    if (!location) {
      // Not a redirect any more: this is where it ends.
      return finish(current.toString());
    }

    let next;
    try {
      next = new URL(location, current);
    } catch {
      throw new MapLinkError("That short link points somewhere unreadable.", 422);
    }
    if (!/^https?:$/.test(next.protocol) || !mapAllowed(hostOf(next.toString()))) {
      // Looked at, not followed: a redirect is not allowed to leave the map
      // services, however it is spelled.
      throw new MapLinkError("That short link does not lead to a map.", 422);
    }
    current = next;
  }

  return finish(current.toString());
}

/** The end of the chain, as long as it really is a map. */
function finish(url) {
  if (!mapAllowed(hostOf(url))) {
    throw new MapLinkError("That short link does not lead to a map.", 422);
  }
  return url;
}

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
