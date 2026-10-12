import { useEffect, useState } from "react";

export const LIVE_MAP_PATH = "/live-map";

/**
 * Minimal hash router.
 * "#/live-map" is a full page; "#journey", "#pricing" etc. stay in-page anchors.
 * Works when the built single-file app is served statically.
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
