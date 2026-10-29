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
