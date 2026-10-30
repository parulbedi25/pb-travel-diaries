/**
 * Where to go once the bootstrap has finished.
 *
 * PHP has created the database, the tables and the owner, and has nothing else
 * to offer — it never signs anybody in. So the handover is a navigation, and the
 * destination needs thinking about, because there are two addresses in play:
 *
 *   the site      the folder of files this page arrived from — where a person
 *                 reads the site, signs in and opens the dashboard
 *   the API       the Node app, in a subfolder, which answers `/api/…` only
 *
 * Sending somebody to the API's address was a mistake worth keeping a function
 * for: on a static deployment that address is Node's, and whether it also
 * serves the pages is a separate deployment detail — one that, when it is not
 * true, dumps the new owner on a 404 while the countdown keeps firing, so every
 * button appears dead. The site's own address always serves the site.
 *
 * Signing in on the site works because the session cookie is set for the whole
 * domain (`Path=/`), so signing in through the API leaves the page signed in.
 */

export interface HandoffTargets {
  /** The site itself, with the members/sign-in route open. */
  signIn: string;
  /** The dashboard on the site. */
  dashboard: string;
  /** The API's health check — what to look at when the dashboard will not open. */
  apiHealth: string;
  /** The folder the site is served from, without a trailing slash. */
  site: string;
}

/**
 * The folder this page came from: everything up to its last slash.
 *
 * A page at `https://example.com/` gives `https://example.com`; one at
 * `https://example.com/travel/` gives `https://example.com/travel`, so an export
 * uploaded into a subfolder still points at itself rather than at the domain.
 */
function siteRoot(origin: string, pathname: string): string {
  const withoutFile = pathname.replace(/[^/]*$/, "");
  const trimmed = withoutFile.replace(/\/+$/, "");
  return `${origin.replace(/\/+$/, "")}${trimmed}`;
}

export function handoffTargets({
  apiUrl,
  origin,
  pathname,
}: {
  apiUrl: string;
  origin: string;
  pathname: string;
}): HandoffTargets {
  const site = siteRoot(origin, pathname);
  const api = apiUrl.replace(/\/+$/, "");
  return {
    site,
    signIn: `${site}/#/members`,
    dashboard: `${site}/#/admin`,
    apiHealth: api ? `${api}/api/health` : `${site}/api/health`,
  };
}

/**
 * Navigate to a route on this same site — and actually reload.
 *
 * Assigning a URL that differs only in the `#fragment` does not reload the page,
 * so the visitor would be left looking at the handover screen with the address
 * bar claiming they had moved. That is the second half of "the buttons do
 * nothing": the route changed and the screen did not.
 */
export function goToSiteRoute(target: string): void {
  if (typeof window === "undefined") return;
  const { origin, pathname } = window.location;
  const samePage = target.startsWith(`${origin}${pathname.split("#")[0].split("?")[0]}`);
  if (samePage) {
    window.location.replace(target);
    window.location.reload();
    return;
  }
  window.location.assign(target);
}
