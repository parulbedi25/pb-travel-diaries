import type {
  FooterColumn,
  FooterSettings,
  SectionEntry,
  SectionType,
  SiteContent,
} from "../store/siteContent";

/*
 * Parent → child rules used by the dashboard switches.
 *
 *  • Turning a parent OFF turns everything inside it OFF.
 *  • Turning a child ON turns every parent above it ON.
 *  • Turning a parent ON turns its children ON, so a section is never
 *    switched on with nothing visible inside it.
 *
 * Every function here is pure: it takes the draft and returns a new draft.
 */

/** Repeatable item lists inside each section type. These are the children. */
export const CHILD_LISTS: Partial<Record<SectionType, string[]>> = {
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

type Flag = { enabled?: boolean };

const flagged = (item: unknown, on: boolean): Flag => ({
  ...(item as Flag),
  enabled: on,
});

/** A section with all of its children set to `on`. */
function applySection(s: SectionEntry, on: boolean): SectionEntry {
  let data = s.data;
  for (const key of CHILD_LISTS[s.type] ?? []) {
    const list = data[key];
    if (Array.isArray(list)) data = { ...data, [key]: list.map((item) => flagged(item, on)) };
  }
  // The Machine's layout blocks are children too: switching the section on
  // clears any blocks hidden earlier, matching the other parent/child rules.
  if (on && s.type === "machine") {
    const layout = data.subsectionLayout as { hidden?: string[] } | undefined;
    if (layout?.hidden?.length) {
      data = { ...data, subsectionLayout: { ...layout, hidden: [] } };
    }
  }
  return { ...s, enabled: on, data };
}

/** Switch one section on or off, together with everything inside it. */
export function cascadeSection(c: SiteContent, id: string, on: boolean): SiteContent {
  return {
    ...c,
    sections: c.sections.map((s) => (s.id === id ? applySection(s, on) : s)),
  };
}

/** Switch every section on or off. Countdown and maintenance keep their own rules. */
export function cascadeAllSections(c: SiteContent, on: boolean): SiteContent {
  return {
    ...c,
    sections: c.sections.map((s) =>
      s.type === "countdown" || s.type === "maintenance" ? s : applySection(s, on)
    ),
  };
}

/** Switch one child item. Turning it on also switches its section on. */
export function cascadeChild(
  c: SiteContent,
  sectionId: string,
  key: string,
  index: number,
  on: boolean
): SiteContent {
  return {
    ...c,
    sections: c.sections.map((s) => {
      if (s.id !== sectionId) return s;
      const list = s.data[key];
      if (!Array.isArray(list)) return s;
      const next = list.map((item, i) => (i === index ? flagged(item, on) : item));
      return {
        ...s,
        enabled: on ? true : s.enabled,
        data: { ...s.data, [key]: next },
      };
    }),
  };
}

/* ───────────── Footer ───────────── */

const linksOf = (col: FooterColumn, on: boolean): FooterColumn => ({
  ...col,
  links: col.links.map((l) => ({ ...l, enabled: on })),
});

/** Whole footer on or off. Off hides every column, link and social icon. */
export function cascadeFooterSection(f: FooterSettings, on: boolean): FooterSettings {
  return {
    ...f,
    enabled: on,
    columns: f.columns.map((col) => ({ ...linksOf(col, on), enabled: on })),
    socials: f.socials.map((s) => ({ ...s, enabled: on })),
  };
}

/** One column on or off. Off hides its links; on shows them and the footer. */
export function cascadeFooterColumn(f: FooterSettings, colId: string, on: boolean): FooterSettings {
  return {
    ...f,
    enabled: on ? true : f.enabled,
    columns: f.columns.map((col) => (col.id === colId ? { ...linksOf(col, on), enabled: on } : col)),
  };
}

/** Show or hide every link inside one column. Showing also shows the column and footer. */
export function cascadeFooterColumnLinks(
  f: FooterSettings,
  colId: string,
  on: boolean
): FooterSettings {
  return {
    ...f,
    enabled: on ? true : f.enabled,
    columns: f.columns.map((col) =>
      col.id !== colId ? col : { ...linksOf(col, on), enabled: on ? true : col.enabled }
    ),
  };
}

/** One link on or off. On also shows its column and the footer. */
export function cascadeFooterLink(
  f: FooterSettings,
  colId: string,
  linkId: string,
  on: boolean
): FooterSettings {
  return {
    ...f,
    enabled: on ? true : f.enabled,
    columns: f.columns.map((col) =>
      col.id !== colId
        ? col
        : {
            ...col,
            enabled: on ? true : col.enabled,
            links: col.links.map((l) => (l.id === linkId ? { ...l, enabled: on } : l)),
          }
    ),
  };
}

/** Every link on or off. On also shows all columns and the footer. */
export function cascadeFooterLinks(f: FooterSettings, on: boolean): FooterSettings {
  return {
    ...f,
    enabled: on ? true : f.enabled,
    columns: f.columns.map((col) => ({ ...linksOf(col, on), enabled: on ? true : col.enabled })),
  };
}

/** One social icon on or off. On also shows the footer. */
export function cascadeFooterSocial(f: FooterSettings, id: string, on: boolean): FooterSettings {
  return {
    ...f,
    enabled: on ? true : f.enabled,
    socials: f.socials.map((s) => (s.id === id ? { ...s, enabled: on } : s)),
  };
}

/* ───────────── Header menu ───────────── */

/** Every header link on or off. */
export function cascadeNavAll(c: SiteContent, on: boolean): SiteContent {
  return { ...c, nav: c.nav.map((n) => ({ ...n, enabled: on })) };
}

/** Switch a section on together with all of its children (used when a countdown reveals it). */
export function enableWithChildren(s: SectionEntry): SectionEntry {
  return applySection(s, true);
}

/** One header link on or off. The header master switch reads from these. */
export function cascadeNavItem(c: SiteContent, id: string, on: boolean): SiteContent {
  return { ...c, nav: c.nav.map((n) => (n.id === id ? { ...n, enabled: on } : n)) };
}
