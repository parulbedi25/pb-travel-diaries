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
  /** The link is switched on and its section is too — show it as a working link. */
  shown: boolean;
  /** False when the link points at a section that is switched off. */
  available: boolean;
  /** The section it points at, when it points at one. */
  section?: SectionEntry;
}

/** What a header link should look like right now, given the sections behind it. */
export function navItemState(content: SiteContent, item: NavItem): NavItemState {
  const target = anchorTarget(item.href);
  const matches = target
    ? content.sections.filter((entry) => anchorsOf(entry).includes(target))
    : [];
  // A link to something that is not a section is the operator's own business.
  if (!matches.length) return { shown: item.enabled, available: true };
  const on = matches.some((entry) => entry.enabled);
  return {
    shown: item.enabled && on,
    available: on,
    section: matches.find((entry) => entry.enabled) ?? matches[0],
  };
}

/** Every link's state in one pass, for a component that renders them all. */
export function navStates(content: SiteContent): Map<string, NavItemState> {
  return new Map(content.nav.map((item) => [item.id, navItemState(content, item)]));
}
