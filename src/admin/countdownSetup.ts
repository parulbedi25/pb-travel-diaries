import type { SectionEntry, SiteContent } from "../store/siteContent";
import { cascadeSection } from "./cascade";

export interface CountdownTarget {
  id: string;
  label: string;
}

/** Check the actual draft switches, not whether the previous timer expired. */
export function getActiveCountdownTargets(
  sections: SectionEntry[],
  revealIds: unknown
): CountdownTarget[] {
  const selected = new Set(Array.isArray(revealIds) ? revealIds.filter((id) => typeof id === "string") : []);
  return sections
    .filter((section) =>
      selected.has(section.id) && section.enabled &&
      section.type !== "countdown" && section.type !== "maintenance"
    )
    .map(({ id, label }) => ({ id, label }));
}

/** Confirming resets only selected active parents (and their children). */
export function resetActiveTargetsForCountdown(
  draft: SiteContent,
  countdown: SectionEntry
): SiteContent {
  if (countdown.type !== "countdown") return draft;
  const targets = getActiveCountdownTargets(draft.sections, countdown.data.revealSectionIds);
  const reset = targets.reduce((current, target) => cascadeSection(current, target.id, false), draft);
  return {
    ...reset,
    sections: reset.sections.map((section) =>
      section.id === countdown.id ? { ...countdown, enabled: true } : section
    ),
  };
}

/** Cancel only the countdown setup. Never change the reveal targets' switches. */
export function cancelCountdownSetup(
  draft: SiteContent,
  saved: SiteContent,
  countdownId: string
): SiteContent {
  const baseline = saved.sections.find((section) => section.id === countdownId && section.type === "countdown");
  return {
    ...draft,
    sections: draft.sections.map((section) => {
      if (section.id !== countdownId || section.type !== "countdown") return section;
      return {
        ...section,
        label: baseline?.label ?? section.label,
        enabled: false,
        data: baseline ? structuredClone(baseline.data) : { ...section.data, revealSectionIds: [] },
      };
    }),
  };
}