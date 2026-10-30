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

/**
 * The pages a menu link can open, in the words the dashboard uses for them.
 * A page is not a section: it has no anchor to scroll to and no entry in the
 * Sections tab, so it is named here instead of being derived.
 */
export const PAGE_TARGETS: Record<string, string> = {
  "/live-map": "Live map page",
  "/shop": "Shop page",
  "/nearby": "Nearby places page",
  "/members": "Members page",
  "/ride": "Ride builder page",
  "/admin": "Dashboard",
};

/** What a menu link opens, for the line of text under it in the dashboard. */
export type NavTarget =
  /** A section from the Sections tab, named exactly as that tab names it. */
  | { kind: "section"; label: string; section: SectionEntry; off: boolean }
  /** One of the app's own pages, such as the shop. */
  | { kind: "page"; label: string }
  /** Somebody else's site. */
  | { kind: "external"; label: string }
  /** An anchor or path that is neither — the operator typed it. */
  | { kind: "custom"; label: string };

/** Which section or page a menu link points at. */
export function navTargetOf(content: SiteContent, item: NavItem): NavTarget {
  const target = anchorTarget(item.href);
  if (target) {
    const matches = content.sections.filter((entry) => anchorsOf(entry).includes(target));
    if (matches.length) {
      const section = matches.find((entry) => entry.enabled) ?? matches[0];
      return { kind: "section", label: section.label, section, off: !matches.some((e) => e.enabled) };
    }
    return { kind: "custom", label: item.href.trim() };
  }
  const href = item.href.trim();
  if (/^https?:\/\//i.test(href)) return { kind: "external", label: href };
  const route = href.startsWith("#/") ? href.slice(1).split("?")[0] : "";
  const page = PAGE_TARGETS[route];
  if (page) return { kind: "page", label: page };
  return { kind: "custom", label: href };
}

/**
 * Sections that no menu link points at.
 *
 * These are the ones an owner opens the Header tab to find: the page has them,
 * the dashboard lists them, and the menu has no way to reach them. Hero,
 * countdown and maintenance are left out on purpose — the first is where every
 * logo already goes, and the other two take the whole page over rather than
 * being somewhere a menu can send you.
 */
const NOT_A_DESTINATION: ReadonlySet<SectionEntry["type"]> = new Set(["hero", "countdown", "maintenance"]);

export function sectionsWithoutNav(content: SiteContent): SectionEntry[] {
  const anchors = new Set(
    content.nav
      .map((item) => anchorTarget(item.href))
      .filter((target): target is string => Boolean(target)),
  );
  // A link that carries the section's own name counts as reaching it, even
  // when it opens a page of its own: the Live Tracker row in the header goes to
  // the full live map, and calling that "no link" would be wrong.
  const names = new Set(content.nav.map((item) => item.label.trim().toLocaleLowerCase()).filter(Boolean));
  return content.sections.filter(
    (entry) =>
      entry.enabled &&
      !NOT_A_DESTINATION.has(entry.type) &&
      !anchorsOf(entry).some((anchor) => anchors.has(anchor)) &&
      !names.has(entry.label.trim().toLocaleLowerCase()),
  );
}

/** The `href` that opens a section: the anchor its component actually carries. */
export function sectionHref(entry: SectionEntry): string {
  return `#${anchorsOf(entry)[0]}`;
}
