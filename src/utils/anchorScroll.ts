/**
 * In-page jumps that land a section's name just under the header.
 *
 * The browser's own anchor jump aims at the top of whatever carries the id,
 * which for a section is the top of its padding. A section here carries 6rem
 * of padding above its name (8rem on wider screens), so the name ended up
 * something like 240px down the page — well below the header, with the tail of
 * the previous section above it. It reads as the scroll stopping in the middle
 * of nowhere, and the fix everyone reaches for is to nudge the page along by
 * hand afterwards.
 *
 * So the jump is aimed at the section's header block — eyebrow, name,
 * standfirst — rather than at the top of its padding, and the header's real
 * height is measured rather than guessed, because it shrinks as you scroll.
 */

/** Clear air left between the header and the name sitting under it. */
const GAP_PX = 12;

/** The same gap as a CSS length, for the browser's own anchor landing. */
export const ANCHOR_GAP_CSS = `${GAP_PX}px`;

/** The header is fixed, so its height has to be subtracted, not assumed. */
export function headerHeight(): number {
  const header = document.querySelector<HTMLElement>("[data-site-header]");
  if (header) {
    const height = header.getBoundingClientRect().height;
    if (height > 0) return height;
  }
  const fromVar = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--header-h"),
  );
  return Number.isFinite(fromVar) && fromVar > 0 ? fromVar : 80;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Scroll `id` into view with its name under the header.
 *
 * Returns false when there is nothing by that id, so the caller can leave the
 * click alone and let the browser do whatever it was going to do.
 */
export function scrollToAnchor(id: string): boolean {
  if (!id) return false;
  const target = document.getElementById(id);
  if (!target) return false;

  // The section's own block of eyebrow and name, not the padding above it.
  const anchor = target.querySelector<HTMLElement>("[data-section-anchor]") ?? target;
  const top = Math.max(
    0,
    window.scrollY + anchor.getBoundingClientRect().top - headerHeight() - GAP_PX,
  );

  window.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  return true;
}
