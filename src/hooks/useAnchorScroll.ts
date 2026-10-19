import { useEffect } from "react";
import { scrollToAnchor } from "../utils/anchorScroll";
import { anchorIdFromHash } from "../utils/router";

/**
 * Land on an anchor that has only just been asked for.
 *
 * A menu click made from another page arrives here as a hash change while the
 * page that owns the section is still being built, so the target may not be in
 * the document yet. Keep trying briefly, and stop the moment the hash moves on.
 */
function settle(id: string): void {
  const startedAt = performance.now();
  const tick = () => {
    if (anchorIdFromHash(window.location.hash) !== id) return;
    if (scrollToAnchor(id)) return;
    if (performance.now() - startedAt < 1500) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Makes every in-page link land the section's name just under the header.
 *
 * Installed once, on the document, so it covers the menu, the footer, the
 * skip link and any page that grows a section list later, rather than each
 * link having to remember to behave.
 */
export function useAnchorScroll(): void {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const link = (event.target as HTMLElement | null)?.closest?.("a[href^='#']") as
        | HTMLAnchorElement
        | null;
      if (!link || link.target === "_blank") return;

      const href = link.getAttribute("href") ?? "";
      const id = anchorIdFromHash(href);
      if (!id) return;

      // Not on this page — let the hash change and the router take over; the
      // hashchange listener below picks the jump up once the page is up.
      if (!document.getElementById(id)) return;

      event.preventDefault();
      // The mobile menu locks the body while it is open, and a jump into a
      // locked body lands nowhere. It is being closed by this same click, so
      // wait for that to take effect before scrolling.
      requestAnimationFrame(() => {
        if (scrollToAnchor(id)) window.history.pushState(null, "", href);
      });
    };

    // Opened with the hash already on it, or arriving from another page.
    const onHashChange = () => {
      const id = anchorIdFromHash(window.location.hash);
      if (id) settle(id);
    };

    document.addEventListener("click", onClick);
    window.addEventListener("hashchange", onHashChange);
    onHashChange();

    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);
}
