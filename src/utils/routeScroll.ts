/**
 * Where the window sits when a page opens.
 *
 * Every page swap here is a hash change (`#/shop`, `#/admin`), and no element
 * carries that id — so the browser has nothing to scroll to and keeps the
 * window exactly where it was while the new page is rendered underneath that
 * offset. Arrive from the bottom of a long page and the new one opens at its
 * bottom, or is clamped there because the new page is shorter. So every
 * arrival is placed deliberately.
 */

/**
 * The dashboard's remembered position.
 *
 * Module scope: it lasts as long as this page in this tab, which is exactly
 * the session the dashboard restores into. A reload or a fresh login starts
 * from nothing and opens at the top.
 */
let dashboardY: number | null = null;

export function rememberDashboardScroll(y: number): void {
  dashboardY = y;
}

export function savedDashboardScroll(): number | null {
  return dashboardY;
}

/** Called when logging out, so the next sign-in starts at the top. */
export function forgetDashboardScroll(): void {
  dashboardY = null;
}

/**
 * Move the window at once, whatever `scroll-behavior` says. An arrival must
 * not be watched sliding up the page.
 */
export function jumpWindowTo(top: number): void {
  window.scrollTo({ top: Math.max(0, top), left: 0, behavior: "instant" });
}
