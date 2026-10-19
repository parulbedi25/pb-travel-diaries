import { useEffect, useLayoutEffect, useRef } from "react";
import { isAdminSession } from "../store/siteContent";
import { ADMIN_PATHS, anchorIdFromHash } from "../utils/router";
import {
  jumpWindowTo,
  rememberDashboardScroll,
  savedDashboardScroll,
} from "../utils/routeScroll";

/** Give a slow, lazily-loaded page long enough to grow to the remembered depth. */
const RESTORE_DEADLINE_MS = 4000;

function restoreWindowTo(top: number): void {
  const deadline = performance.now() + RESTORE_DEADLINE_MS;
  const tick = () => {
    jumpWindowTo(top);
    if (window.scrollY < top - 2 && performance.now() < deadline) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Opens each page where it should open.
 *
 * Frontend pages — home, My Picks, the live map — always open at the top.
 * The dashboard reopens where it was left, for as long as the tab is open.
 * A section jump (`#features`) is somebody else's job: `useAnchorScroll`
 * lands those, so this stays out of its way.
 */
export function useRouteScroll(route: string): void {
  const previousRoute = useRef<string | null>(null);
  const arrivedByClick = useRef(false);

  // A page swap is a hash change, so "the visitor asked for this" has to be
  // noted before the hash moves. Back and Forward arrive with no click, and
  // those keep the browser's own positioning.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const link = (event.target as HTMLElement | null)?.closest?.(
        "a[href^='#/']",
      ) as HTMLAnchorElement | null;
      if (!link) return;

      // Asking for the page you are already on puts it back to the top, the
      // same way arriving there would. Deferred by a frame: on a phone the
      // menu that is closing unlocks the body during this very click.
      if (link.getAttribute("href") === window.location.hash) {
        requestAnimationFrame(() => jumpWindowTo(0));
        return; // nothing is navigating, so nothing to mark
      }
      arrivedByClick.current = true;
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Where the dashboard was left. Recorded while it is open; the pending
  // frame is cancelled on the way out, so the page shrinking under the window
  // (which the browser clamps, firing a scroll) cannot overwrite it.
  useEffect(() => {
    if (!ADMIN_PATHS.has(route)) return;
    let frame = 0;
    const record = () => {
      frame = 0;
      // Only the dashboard remembers its place, never the login screen.
      if (isAdminSession()) rememberDashboardScroll(window.scrollY);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(record);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [route]);

  // Layout effect: the placement happens before the new page is painted, so a
  // page never appears at the old offset and then slides.
  useLayoutEffect(() => {
    const from = previousRoute.current;
    previousRoute.current = route;

    const asked = arrivedByClick.current;
    arrivedByClick.current = false;

    if (from === route) return;
    // A section id: the anchor landing owns this one.
    if (anchorIdFromHash(window.location.hash)) return;

    const dashboard = ADMIN_PATHS.has(route);

    // First load. The browser's own restoration is the right answer for the
    // frontend; the dashboard has nothing remembered this early, so it opens
    // at the top.
    if (from === null) {
      if (dashboard) jumpWindowTo(0);
      return;
    }

    // Back and Forward: leave the window to the browser.
    if (!asked) return;

    if (!dashboard) {
      jumpWindowTo(0);
      return;
    }

    const remembered = isAdminSession() ? savedDashboardScroll() : null;
    if (remembered === null) jumpWindowTo(0);
    else restoreWindowTo(remembered);
  }, [route]);
}
