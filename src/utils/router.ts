import { useEffect, useState } from "react";

export const LIVE_MAP_PATH = "/live-map";
export const NEARBY_PATH = "/nearby";
export const SHOP_PATH = "/shop";
export const ADMIN_PATH = "/admin";
export const COMMAND_CENTER_PATH = "/commandcenter";
export const MEMBERS_PATH = "/members";

/**
 * Every route that opens PB Control. Maintenance mode replaces the whole site,
 * so the dashboard needs a URL an admin can always type — the aliases are
 * memorable spellings of the same destination.
 */
export const ADMIN_PATHS = new Set<string>([ADMIN_PATH, COMMAND_CENTER_PATH, "/pb-control", "/login"]);

/**
 * Minimal hash router.
 * "#/live-map", "#/nearby" and "#/shop" are full pages; "#journey", "#pricing" etc.
 * stay in-page anchors. Works when the built single-file app is served statically.
 */
export function getHashRoute(): string {
  if (typeof window === "undefined") return "/";
  const hash = window.location.hash.replace(/^#/, "");
  return hash.startsWith("/") ? hash : "/";
}

/**
 * Routes live in the hash as well (`#/shop`, `#/admin`), so not every `#…` is
 * a jump to an element. Both kinds are told apart here, in one place.
 */
export function isRouteHash(hash: string): boolean {
  return !hash || hash === "#" || hash.startsWith("#/");
}

/** The element id a hash points at — "" when it is a route rather than a jump. */
export function anchorIdFromHash(hash: string): string {
  return isRouteHash(hash) ? "" : decodeURIComponent(hash.slice(1));
}

export function useHashRoute(): string {
  const [route, setRoute] = useState<string>(getHashRoute);
  useEffect(() => {
    const onChange = () => setRoute(getHashRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
