/**
 * A member's own dark/light choice for their garage.
 *
 * The site's theme is the owner's: switching it in the dashboard saves it on
 * the server, so every visitor sees the change. A member reading their own
 * rides is not editing the site, so their choice is kept in this browser only
 * and painted on the garage's own wrapper — never through `setTheme`, which
 * would repaint the whole site for everybody.
 *
 * Because the choice lives on a wrapper rather than on `<html>`, the tokens
 * that mode needs are handed to that wrapper as CSS variables (see
 * `memberThemeStyle`), taken from the site's own palette for that mode. So a
 * member picking light gets the owner's light colours, customised or not, even
 * while the site itself stays dark.
 */

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  THEME_TOKEN_VARS,
  resolveThemeColors,
  type ThemeColors,
  type ThemeTokens,
} from "../store/siteContent";

export type MemberTheme = "dark" | "light";

/** Per member, so two people signing in on one browser keep their own choice. */
const storageKey = (ownerId: number | string | null | undefined) =>
  `pb:member:theme:v1:${ownerId ?? "guest"}`;

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private mode, or storage turned off: the choice simply is not kept.
    return null;
  }
}

function writeStore(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* nothing to do — the toggle still works for this visit */
  }
}

export function readMemberTheme(ownerId: number | string | null | undefined): MemberTheme | null {
  const saved = readStore(storageKey(ownerId));
  return saved === "light" || saved === "dark" ? saved : null;
}

/** The CSS class that switches the light palette on for a subtree. */
export const memberThemeClass = (theme: MemberTheme) => `member-theme-${theme}`;

/**
 * The palette tokens for one mode, as inline variables for the garage wrapper.
 * Identical keys to the ones the site store sets on `<html>`, so a member theme
 * is the same palette shown in that mode rather than a second design.
 */
export function memberThemeStyle(
  themeColors: Partial<ThemeColors> | undefined,
  theme: MemberTheme,
): CSSProperties {
  const tokens = resolveThemeColors(themeColors)[theme];
  const style: Record<string, string> = { colorScheme: theme };
  (Object.keys(THEME_TOKEN_VARS) as (keyof ThemeTokens)[]).forEach((key) => {
    style[THEME_TOKEN_VARS[key]] = tokens[key];
  });
  return style as CSSProperties;
}

/**
 * The member's theme, and the switch for it.
 *
 * Before a member has ever chosen, the garage opens in whatever the site is
 * wearing — the page should not surprise anyone on first visit. The moment they
 * pick, that choice is theirs alone and stays put across visits, whatever the
 * site does afterwards.
 */
export function useMemberTheme(
  ownerId: number | string | null | undefined,
  siteTheme: MemberTheme,
): { theme: MemberTheme; setTheme: (theme: MemberTheme) => void; toggle: () => void } {
  const [theme, setThemeState] = useState<MemberTheme>(() => readMemberTheme(ownerId) ?? siteTheme);

  // A different member (or the first sign-in) on this browser reads their own
  // saved choice, not the previous person's.
  useEffect(() => {
    setThemeState(readMemberTheme(ownerId) ?? siteTheme);
  }, [ownerId, siteTheme]);

  const setTheme = useCallback(
    (next: MemberTheme) => {
      setThemeState(next);
      writeStore(storageKey(ownerId), next);
    },
    [ownerId],
  );

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  return { theme, setTheme, toggle };
}
