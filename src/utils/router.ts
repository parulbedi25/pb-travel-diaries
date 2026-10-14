import { useEffect, useState } from "react";

export const LIVE_MAP_PATH = "/live-map";
export const SHOP_PATH = "/shop";
export const ADMIN_PATH = "/admin";

/**
 * Every route that opens PB Control. Maintenance mode replaces the whole site,
 * so the dashboard needs a URL an admin can always type — the aliases are
 * memorable spellings of the same destination.
 */
export const ADMIN_PATHS = new Set<string>([ADMIN_PATH, "/pb-control", "/login"]);

/**
 * Minimal hash router.
 * "#/live-map" and "#/shop" are full pages; "#journey", "#pricing" etc.
 * stay in-page anchors. Works when the built single-file app is served statically.
 */
export function getHashRoute(): string {
  if (typeof window === "undefined") return "/";
  const hash = window.location.hash.replace(/^#/, "");
  return hash.startsWith("/") ? hash : "/";
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
