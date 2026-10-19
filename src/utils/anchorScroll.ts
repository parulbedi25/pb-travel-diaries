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
 *
 * A single `scrollTo` is not enough on its own. The page is still filling in
 * while the jump runs: photos below the fold are fetched lazily, so the first
 * one to come into view lands its height in the document, and everything after
 * it — including the section being jumped to — moves down. A destination
 * measured once, before that happened, is then several hundred pixels short,
 * and the jump appears to stop inside the previous section (My Picks, when the
 * target is the Rider Kit below it). The jump therefore re-measures while it
 * runs and keeps following the section for a moment after it arrives.
 */

/** Clear air left between the header and the name sitting under it. */
const GAP_PX = 12;

/** The same gap as a CSS length, for the browser's own anchor landing. */
export const ANCHOR_GAP_CSS = `${GAP_PX}px`;

/** How long a jump may take, and how long a short one still takes. */
const MIN_MS = 90;
const MAX_MS = 900;
const MS_PER_PX = 0.42;

/** Under this, the page is treated as having arrived. */
const SETTLE_PX = 1.5;

/**
 * A target that moves this far while the page is settling is followed rather
 * than left behind. Photos above the section finishing their lazy load are the
 * usual reason it moves at all.
 */
const DRIFT_PX = 6;

/** How long the page keeps following the section after first arriving. */
const WATCH_MS = 1500;

/** No jump may keep the page in motion longer than this. */
const MAX_RUN_MS = 6000;

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

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const travelMs = (distance: number) =>
  Math.min(MAX_MS, Math.max(MIN_MS, MIN_MS + Math.abs(distance) * MS_PER_PX));

/** Move the window at once, whatever `scroll-behavior` says. */
function moveTo(top: number): void {
  window.scrollTo({ top, left: 0, behavior: "instant" });
}

/**
 * `html { scroll-behavior: smooth }` is what makes every link glide, but it
 * also turns each frame of the jump below into a glide of its own on a browser
 * that does not honour `behavior: "instant"`. Suspending it for the length of
 * the jump keeps the frames exact; it is put back as soon as the jump ends.
 */
function suspendSmooth(root: HTMLElement): () => void {
  const previous = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  return () => {
    root.style.scrollBehavior = previous;
  };
}

/** The jump in flight, so a second click can stop the first one. */
let active: { cancel: () => void } | null = null;

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

  /* Where the window has to end up, measured now. Clamped to the document, so
     the last section on a short page still settles instead of aiming past the
     end and never arriving. */
  const aim = () => {
    const furthest = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const wanted = window.scrollY + anchor.getBoundingClientRect().top - headerHeight() - GAP_PX;
    return Math.min(furthest, Math.max(0, wanted));
  };

  // A second click wins; the first jump stops where it is.
  active?.cancel();
  active = null;

  if (prefersReducedMotion()) {
    moveTo(aim());
    return true;
  }

  const startedAt = performance.now();
  const firstAim = aim();
  if (Math.abs(firstAim - window.scrollY) <= SETTLE_PX) {
    moveTo(firstAim);
    return true;
  }

  const restoreSmooth = suspendSmooth(document.documentElement);
  let raf = 0;
  let finished = false;
  let phase: "travel" | "watch" = "travel";
  let fromY = window.scrollY;
  let fromAt = startedAt;
  let toY = firstAim;
  let duration = travelMs(toY - fromY);
  let arrivedAt = 0;
  let arrivedAim = firstAim;
  /** Where the last frame of the jump put the window, for telling the two apart. */
  let expectedY = window.scrollY;

  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("wheel", onInput);
    window.removeEventListener("touchstart", onInput);
    window.removeEventListener("keydown", onInput);
    window.removeEventListener("scroll", onScroll);
    restoreSmooth();
    if (active?.cancel === finish) active = null;
  };

  /**
   * A window that moved on its own — a dragged scrollbar, a browser "find",
   * the reader taking over some other way. The jump is following a section,
   * not holding the page, so it stands down.
   */
  const onScroll = () => {
    if (Math.abs(window.scrollY - expectedY) > 4) finish();
  };

  // Any deliberate scroll wins: the jump is a courtesy, not a lock on the page.
  const onInput = (event: Event) => {
    if (event.type === "keydown") {
      const key = (event as KeyboardEvent).key;
      if (![" ", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(key)) {
        return;
      }
    }
    finish();
  };

  /** Start a fresh leg from where the window is now. */
  const rebase = (now: number) => {
    fromY = window.scrollY;
    fromAt = now;
    toY = aim();
    duration = travelMs(toY - fromY);
  };

  const tick = (now: number) => {
    if (finished) return;
    if (now - startedAt > MAX_RUN_MS) {
      finish();
      return;
    }
    // The page changed under the jump (a menu link to another page, a section
    // that was edited away). Its coordinates are meaningless now.
    if (anchor.isConnected === false) {
      finish();
      return;
    }

    const destination = aim();

    if (phase === "travel") {
      // The page grew or shrank under the jump. Aim again rather than finish
      // short — this is what used to leave the reader in the previous section.
      if (Math.abs(destination - toY) > DRIFT_PX) rebase(now);

      const t = duration <= 0 ? 1 : Math.min(1, (now - fromAt) / duration);
      moveTo(fromY + (toY - fromY) * easeInOutCubic(t));
      expectedY = window.scrollY;

      if (t >= 1) {
        if (Math.abs(destination - window.scrollY) <= SETTLE_PX) {
          phase = "watch";
          arrivedAt = now;
          arrivedAim = destination;
        } else {
          // Clamped by the document, or the target slipped again mid-frame.
          rebase(now);
        }
      }
      raf = requestAnimationFrame(tick);
      return;
    }

    // Arrived. Keep following the section for a moment: the photos above it
    // are often still arriving, and every one of them pushes it down. Only a
    // section that has moved is followed — a reader who scrolls away is left
    // alone, and `onScroll` above has already stood the jump down.
    if (Math.abs(destination - arrivedAim) > DRIFT_PX) {
      phase = "travel";
      rebase(now);
      raf = requestAnimationFrame(tick);
      return;
    }
    if (now - arrivedAt > WATCH_MS) {
      finish();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  active = { cancel: finish };
  window.addEventListener("wheel", onInput, { passive: true });
  window.addEventListener("touchstart", onInput, { passive: true });
  window.addEventListener("keydown", onInput);
  window.addEventListener("scroll", onScroll, { passive: true });
  raf = requestAnimationFrame(tick);
  return true;
}
