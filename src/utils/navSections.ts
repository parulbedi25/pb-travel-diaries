/**
 * The one-way link between a section and its menu item.
 *
 * A header link that points at a section which is switched off is a dead link:
 * the anchor it jumps to is not in the page. Rather than leaving a click that
 * goes nowhere, the *menu item* follows the section — it is shown disabled —
 * and that is all it does. Nothing here ever writes to a section.
 *
 * The reverse is deliberately not true: hiding a header link is a decision
 * about the menu, not about the page. A section stays exactly as it is on the
 * frontend when its menu item is hidden, renamed, re-linked or removed, which
 * is the behaviour anyone editing a menu expects.
 *
 * The rule is derived, never stored, so it cannot drift: turning the section
 * back on restores the link by itself, with no second edit and no migration of
 * saved content.
 *
 * The same one-way logic covers the lock. A members-only section is shut to
 * anybody who is not signed in, so its menu item is not offered to them either —
 * a menu of places you cannot go is worse than a short menu. Signing in (or
 * creating a read-only account) opens the section and brings its link back in
 * the same moment, because both read the same state rather than a stored copy.
 */

import type { NavItem, SectionEntry, SiteContent } from "../store/siteContent";

/**
 * The `id` each section's component puts on its `<section>`, which is what a
 * menu link actually jumps to. Most match their type; these two do not.
 */
const ANCHORS: Partial<Record<SectionEntry["type"], string>> = {
  hero: "top",
  benefits: "showreel",
};

/** Where a section can be reached: its anchor, and its own id for a direct link. */
export function anchorsOf(entry: SectionEntry): string[] {
  const anchor = ANCHORS[entry.type] ?? entry.type;
  return anchor === entry.id ? [anchor] : [anchor, entry.id];
}

/**
 * The section a menu link points at, or null when it points at something else
 * — another page (`#/live-map`), an external site, or a plain path.
 */
export function anchorTarget(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed.startsWith("#")) return null;
  // `#/live-map` and friends are routes the app renders, not sections.
  if (trimmed.startsWith("#/")) return null;
  const fragment = trimmed.slice(1).split("?")[0].trim();
  return fragment || null;
}

export interface NavItemState {
  /** The link is switched on, its section is too, and this visitor may open it. */
  shown: boolean;
  /** False when the link points at a section that is switched off. */
  available: boolean;
  /**
   * True when the section behind the link is members-only and nobody is signed
   * in — the place it points at is not open to this visitor yet.
   */
  locked: boolean;
  /** The section it points at, when it points at one. */
  section?: SectionEntry;
}

/** Whether a section asks for an account before it will show its content. */
function needsAccount(entry: SectionEntry): boolean {
  // `membersOnly` is the stored decision; `locked` is what the server stamps on
  // an anonymous copy. Either one means the same thing to a visitor.
  return Boolean(entry.membersOnly || entry.locked);
}

export interface NavViewer {
  /** Somebody is signed in, so members-only sections are open to them. */
  signedIn?: boolean;
}

/** What a header link should look like right now, given the sections behind it. */
export function navItemState(
  content: SiteContent,
  item: NavItem,
  viewer: NavViewer = {},
): NavItemState {
  const signedIn = viewer.signedIn === true;
  const target = anchorTarget(item.href);
  const matches = target
    ? content.sections.filter((entry) => anchorsOf(entry).includes(target))
    : [];
  // A link to something that is not a section is the operator's own business.
  if (!matches.length) return { shown: item.enabled, available: true, locked: false };
  const section = matches.find((entry) => entry.enabled) ?? matches[0];
  const on = matches.some((entry) => entry.enabled);
  // Signing in is what unlocks a members-only section, and the menu follows it
  // one way: the link is not there for a visitor who cannot open it, and it is
  // there again — with no second edit, and nothing written to the content — the
  // moment an account is signed in.
  const locked = on && !signedIn && needsAccount(section);
  return {
    shown: item.enabled && on && !locked,
    available: on,
    locked,
    section,
  };
}

/** Every link's state in one pass, for a component that renders them all. */
export function navStates(
  content: SiteContent,
  viewer: NavViewer = {},
): Map<string, NavItemState> {
  return new Map(content.nav.map((item) => [item.id, navItemState(content, item, viewer)]));
}
