import type { FooterColumn, FooterSettings, SectionEntry, SiteContent } from "../store/siteContent";

/*
 * Parent / child rules, enforced in the store so no edit path can leave a child
 * switched on under a switched-off parent.
 *
 * Lifting is one-way: a child explicitly switched on brings its parent on.
 * Only an explicit `enabled: true` counts. Items saved before the switches
 * existed have no flag, so they never re-enable a parent the admin turned off.
 */

/** Repeatable item lists inside each section type. These are the children. */
export const CHILD_LISTS: Partial<Record<string, string[]>> = {
  socialproof: ["stats"],
  features: ["items"],
  journey: ["destinations"],
  machine: ["hotspots", "gallery"],
  benefits: ["personas"],
  youtube: ["items"],
  instagram: ["items"],
  stories: ["items"],
  pricing: ["plans"],
  faq: ["items"],
};

const explicitOn = (item: unknown): boolean =>
  (item as { enabled?: unknown } | null | undefined)?.enabled === true;

/** A switched-off section with a switched-on child becomes on. */
export function liftSections(sections: SectionEntry[]): SectionEntry[] {
  let changed = false;
  const next = sections.map((s) => {
    if (s.enabled) return s;
    const lists = CHILD_LISTS[s.type] ?? [];
    const childOn = lists.some(
      (k) => Array.isArray(s.data[k]) && (s.data[k] as unknown[]).some(explicitOn)
    );
    if (!childOn) return s;
    changed = true;
    return { ...s, enabled: true };
  });
  return changed ? next : sections;
}

/** Link on lifts its column, column or social on lifts the footer. */
export function liftFooter(f: FooterSettings): FooterSettings {
  const columns = Array.isArray(f.columns) ? f.columns : [];
  const socials = Array.isArray(f.socials) ? f.socials : [];
  let colsChanged = false;
  const nextCols: FooterColumn[] = columns.map((c) => {
    if (c.enabled || !Array.isArray(c.links) || !c.links.some(explicitOn)) return c;
    colsChanged = true;
    return { ...c, enabled: true };
  });
  const footerOn = f.enabled || nextCols.some((c) => c.enabled === true) || socials.some(explicitOn);
  if (!colsChanged && footerOn === f.enabled) return f;
  return { ...f, columns: colsChanged ? nextCols : f.columns, enabled: footerOn };
}

/** Applies every parent/child lift to a draft. Returns the same object when nothing changes. */
export function liftAll(c: SiteContent): SiteContent {
  const sections = liftSections(c.sections);
  const footer = c.footer ? liftFooter(c.footer) : c.footer;
  if (sections === c.sections && footer === c.footer) return c;
  return { ...c, sections, footer };
}

/** A switched-off footer keeps every child off, so old saved data cannot re-enable it. */
export function lowerFooter(f: FooterSettings): FooterSettings {
  if (f.enabled) return f;
  const columns = Array.isArray(f.columns) ? f.columns : [];
  const socials = Array.isArray(f.socials) ? f.socials : [];
  return {
    ...f,
    columns: columns.map((c) => ({
      ...c,
      enabled: false,
      links: (c.links ?? []).map((l) => ({ ...l, enabled: false })),
    })),
    socials: socials.map((s) => ({ ...s, enabled: false })),
  };
}

/** Normalises content loaded from browser storage. */
export function normalizeLoaded(c: SiteContent): SiteContent {
  return c.footer ? { ...c, footer: lowerFooter(c.footer) } : c;
}

/**
 * Section data with every child switched on. Used when the countdown reveals a
 * section, so the revealed section is never empty.
 */
export function withChildrenOn(entry: SectionEntry): Record<string, unknown> {
  const data: Record<string, unknown> = { ...entry.data };
  for (const key of CHILD_LISTS[entry.type] ?? []) {
    const list = data[key];
    if (Array.isArray(list)) data[key] = list.map((item) => ({ ...(item as object), enabled: true }));
  }
  return data;
}
