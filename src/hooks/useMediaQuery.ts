import { useEffect, useState } from "react";

/**
 * Follows one CSS media query in React.
 *
 * Used where a rule can't be expressed in CSS — the rider map's zoom factor is
 * an inline `scale()` on the photo, and a phone needs a gentler one than a
 * desktop so the part being zoomed to stays inside the frame.
 *
 * Starts `false` on the first render (there is no `window` while the page is
 * being built), then reads the real answer as soon as it mounts.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}
