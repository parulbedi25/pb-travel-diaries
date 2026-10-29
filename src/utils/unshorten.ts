/**
 * Expanding a shortened map link in the browser.
 *
 * The server is the right place for this: it can follow a redirect and read the
 * `Location` header, and a page cannot. But it is not always the *capable*
 * place. A laptop on a VPN, a Mac with a packet filter, a host with no outbound
 * route — in every one of those the browser still reaches Google, because it is
 * the browser's network that works and Node's that does not. When the server
 * cannot expand a link, this tries from the other side of the wire.
 *
 * A browser cannot read a cross-origin redirect itself, so it borrows a service
 * that will: a small set of public read-through proxies, each of which fetches
 * the link server-side and reports where it ended up. Only the final address is
 * used, nothing is stored, and the answer is checked against the same map hosts
 * the server checks — a proxy cannot steer this at somewhere else.
 *
 * Kept deliberately narrow: run only after the server has already failed, one
 * attempt per service, six seconds each, and the first believable map address
 * wins.
 */

/** The address a read-through proxy says the link ended at. */
export interface BrowserExpansion {
  url: string;
  /** Which service answered, so the panel can say where the answer came from. */
  via: string;
}

const TIMEOUT_MS = 6000;

/** Where a redirect is allowed to end up — the server's list, on purpose. */
const MAP_HOSTS = [
  "google.com",
  "google.co.in",
  "goo.gl",
  "g.co",
  "bing.com",
  "apple.com",
  "openstreetmap.org",
];

const allowed = (host: string) => MAP_HOSTS.some((base) => host === base || host.endsWith(`.${base}`));

/**
 * A whole map address rather than a share token.
 *
 * The same rule the server uses: a shortener token is one opaque segment and
 * means nothing without a redirect, so handing it back would only make a failed
 * expansion look like a success.
 */
export function looksLikeMapAddress(url: string): boolean {
  try {
    const { hostname, pathname, search } = new URL(url);
    const host = hostname.toLowerCase().replace(/^www\./, "");
    if (!allowed(host)) return false;
    if (!/^(maps\.app\.goo\.gl|goo\.gl|g\.co)$/.test(host)) return true;
    const segments = pathname.split("/").filter(Boolean);
    return segments.length > 1 || /maps|dir|place|search|@/.test(`${pathname}${search}`);
  } catch {
    return false;
  }
}

/** One service's idea of where the link goes, or "" when it has none. */
type Reader = (link: string, signal: AbortSignal) => Promise<BrowserExpansion | null>;

/**
 * allorigins: a read-through proxy that answers in JSON and says in
 * `status.url` where the fetch finally landed — which is exactly the piece a
 * browser cannot see for itself.
 */
const viaAllOrigins: Reader = async (link, signal) => {
  const endpoint = `https://api.allorigins.win/get?url=${encodeURIComponent(link)}`;
  const response = await fetch(endpoint, { signal, credentials: "omit" });
  if (!response.ok) return null;
  const payload = (await response.json()) as { status?: { url?: string } };
  const url = payload?.status?.url ?? "";
  return url ? { url, via: "allorigins" } : null;
};

/**
 * corsproxy.io: answers with the page itself, and the browser knows the address
 * it was fetched from — which is the same answer by another road.
 */
const viaCorsProxy: Reader = async (link, signal) => {
  const endpoint = `https://corsproxy.io/?${encodeURIComponent(link)}`;
  const response = await fetch(endpoint, { signal, credentials: "omit", redirect: "follow" });
  if (!response.ok) return null;
  const url = response.url && response.url !== endpoint ? response.url : "";
  // The proxy's own address never counts; only whether it moved somewhere else.
  return url ? { url, via: "corsproxy" } : null;
};

const READERS: Reader[] = [viaAllOrigins, viaCorsProxy];

/**
 * Ask the browser, through a read-through proxy, where a short link goes.
 *
 * Resolves to `null` when nothing believable comes back — never throws, because
 * this is a second chance and its failure must not replace the server's own
 * explanation with a worse one.
 */
export async function expandShortLinkInBrowser(link: string): Promise<BrowserExpansion | null> {
  if (!/^https?:\/\//i.test(link) || typeof fetch !== "function") return null;
  for (const read of READERS) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const found = await read(link, controller.signal);
      if (found && looksLikeMapAddress(found.url)) return found;
    } catch {
      // A service being down, slow or blocked is not news; the next one gets a go.
    } finally {
      window.clearTimeout(timer);
    }
  }
  return null;
}
