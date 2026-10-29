/**
 * Reading a site that was exported to plain files.
 *
 * `npm run export:static` writes the published content next to the page as
 * `content.json`, so the site can be uploaded to any static host and open
 * without a server behind it. There is no API there, so the store asks for this
 * file instead — before it decides that it could not load the saved site.
 *
 * The file is optional and its absence is normal: on a host running the server
 * the API answers first and this is never reached. It is fetched at most once,
 * and a host that answers it with the site's own HTML (a catch-all route, or a
 * 404 rewritten to the page) is treated exactly like a host with no such file,
 * which is why the parse is strict rather than trusting a 200.
 */

export interface BakedSite {
  /** The published content, as a visitor sees it. */
  content: unknown;
  theme?: string;
  title?: string;
}

let requested: Promise<BakedSite | null> | null = null;
let baked = false;

/**
 * The exported content, or null when this build is being served by the API.
 *
 * Memoised on purpose: the store asks once on load, and a page reload is the
 * only thing that should ever cause another read.
 */
export function loadBakedSite(): Promise<BakedSite | null> {
  if (!requested) {
    requested = (async () => {
      if (typeof fetch !== "function") return null;
      try {
        // Relative to the page rather than the route: every page of this site is
        // served from the root, and the hash is not part of a URL's path.
        const url = new URL("content.json", document.baseURI);
        const response = await fetch(url, { cache: "no-cache", credentials: "omit" });
        if (!response.ok) return null;
        const text = await response.text();
        const parsed = JSON.parse(text) as BakedSite;
        if (!parsed || typeof parsed !== "object" || !("content" in parsed)) return null;
        if (!parsed.content || typeof parsed.content !== "object") return null;
        baked = true;
        return parsed;
      } catch {
        // No file, a 404 page, or something that is not JSON: all the same here.
        return null;
      }
    })();
  }
  return requested;
}

/**
 * Whether the site being shown came from an exported file.
 *
 * Used to keep the dashboard out of an export: there is no server, so there is
 * nothing a sign-in could sign in to, and an admin page that can only fail is
 * worse than no admin page.
 */
export const isStaticBuild = () => baked;

/**
 * Whether this page is being served by a static host, with no API behind it.
 *
 * The difference matters to one sentence on the page: "could not load the saved
 * site" is true and useful when a server exists and misbehaved, and it is
 * noise when there is no server by design — an export with no `content.json`
 * simply shows the content compiled into the page.
 *
 * Asked by shape, not by guesswork: a host running the server answers
 * `/api/content` with JSON, a static host answers with its own page (a 200 that
 * is not JSON, from a catch-all rewrite) or a 404. A network failure is *not*
 * counted as static — that is a server being unreachable, and worth saying.
 */
let hosting: Promise<boolean> | null = null;

export function isStaticHosting(): Promise<boolean> {
  hosting ??= (async () => {
    if (typeof fetch !== "function") return false;
    try {
      const response = await fetch(new URL("api/content", document.baseURI), {
        cache: "no-store",
        credentials: "omit",
        headers: { accept: "application/json" },
      });
      if (!response.ok) return response.status === 404 || response.status === 405;
      // A catch-all static host answers with the page itself, and that is HTML.
      await response.json();
      return false;
    } catch {
      return false;
    }
  })();
  return hosting;
}
