import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { liftAll, normalizeLoaded, withChildrenOn } from "../utils/cascadeRules";
import { setAt } from "../utils/objectPath";
import { cascadeChild, cascadeSection } from "../admin/cascade";
import { hasCountdownExpired } from "../utils/countdownTiming";

/* ═══════════════════════ Types ═══════════════════════ */

export type Theme = "dark" | "light";

export type SectionType =
  | "hero"
  | "socialproof"
  | "live"
  | "features"
  | "journey"
  | "machine"
  | "gears"
  | "riderkit"
  | "benefits"
  | "youtube"
  | "instagram"
  | "stories"
  | "pricing"
  | "faq"
  | "cta"
  | "maintenance"
  | "countdown"
  | "custom";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  enabled: boolean;
}

export interface SectionEntry {
  id: string;
  type: SectionType;
  label: string;
  enabled: boolean;
  data: Record<string, unknown>;
  /** Frame geometry set by an admin resizing the section on the live site. */
  layout?: {
    height?: number;
    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
  };
}

export interface BrandSettings {
  /** Uploaded logo (data URL or /media path). Empty = use text only. */
  logo: string;
  showLogo: boolean;
  showText: boolean;
  /** "PB" */
  textPrimary: string;
  /** "from" */
  textSecondary: string;
  /** "PB" */
  textTertiary: string;
  colorPrimary: string;
  colorSecondary: string;
  colorTertiary: string;
  /** Logo box tint behind the mark, blank = gradient */
  iconBg: string;
  /** Logo height in px */
  logoHeight: number;
  /** Hide the rounded gradient tile and show the raw image */
  plainLogo: boolean;
}

export const DEFAULT_BRAND: BrandSettings = {
  logo: "",
  showLogo: true,
  showText: true,
  textPrimary: "PB",
  textSecondary: "from",
  textTertiary: "PB",
  colorPrimary: "#ffffff",
  colorSecondary: "#7a7a8c",
  colorTertiary: "#ffffff",
  iconBg: "",
  logoHeight: 36,
  plainLogo: false,
};

export function resolveBrand(brand?: Partial<BrandSettings>): BrandSettings {
  return { ...DEFAULT_BRAND, ...brand };
}

/* ── Footer ── */
export interface FooterLink {
  id: string;
  label: string;
  href: string;
  enabled: boolean;
}
export interface FooterColumn {
  id: string;
  title: string;
  enabled: boolean;
  links: FooterLink[];
}
export interface FooterSocial {
  id: string;
  /** Free text shown as the accessible name, e.g. "YouTube". */
  label: string;
  /** Key into SOCIAL_ICONS. Optional: links saved before the icon picker fall
   *  back to matching `label` against the registry. */
  icon?: string;
  /** Optional custom colour for this icon, overriding the theme's. */
  color?: string;
  /** Shared profile URL used by matching social icons across the site. */
  href: string;
  /** Show or hide this platform's icons site-wide. */
  enabled: boolean;
}
export interface FooterSettings {
  /** Whole footer section on/off. */
  enabled: boolean;
  description: string;
  columns: FooterColumn[];
  /** Shared profile URLs and visibility for social icons across the site. */
  socials: FooterSocial[];
  copyright: string;
  credit: string;
  showBackToTop: boolean;
}

const fl = (id: string, label: string, href: string): FooterLink => ({
  id,
  label,
  href,
  enabled: true,
});

export const DEFAULT_FOOTER: FooterSettings = {
  enabled: true,
  description:
    "Decoding India, one honest mile at a time. Films, routes and stories from all 28 states — for the young, the restless and the permanently roadstruck.",
  columns: [
    {
      id: "col-explore",
      title: "Explore",
      enabled: true,
      links: [
        fl("l-live", "Live Tracker", "#live"),
        fl("l-journey", "The Journey", "#journey"),
        fl("l-machine", "The Machine", "#machine"),
        fl("l-route", "Route Library", "#features"),
        fl("l-showreel", "Showreel", "#showreel"),
        fl("l-stories", "Tribe Stories", "#stories"),
      ],
    },
    {
      id: "col-community",
      title: "Community",
      enabled: true,
      links: [
        fl("l-pricing", "Membership", "#pricing"),
        fl("l-rides", "Group Rides", "#faq"),
        fl("l-meetups", "Meetups", "#cta"),
        fl("l-collab", "Collaborate", "#cta"),
      ],
    },
    {
      id: "col-fine",
      title: "Fine Print",
      enabled: true,
      links: [
        fl("l-privacy", "Privacy Policy", "#top"),
        fl("l-terms", "Terms of Use", "#top"),
        fl("l-refund", "Refund Policy", "#top"),
        fl("l-safety", "Safety Standards", "#top"),
      ],
    },
  ],
  socials: [
    { id: "s-youtube", label: "YouTube", href: "#top", enabled: true },
    { id: "s-instagram", label: "Instagram", href: "#top", enabled: true },
    { id: "s-x", label: "X (Twitter)", href: "#top", enabled: true },
    { id: "s-facebook", label: "Facebook", href: "#top", enabled: true },
  ],
  copyright: "PB from PB. All roads reserved.",
  credit: "Made with ♥ somewhere on NH-44 · Imagery via Pexels",
  showBackToTop: true,
};

/** Fills in any missing footer fields so older saved content keeps working. */
export function resolveFooter(footer?: Partial<FooterSettings>): FooterSettings {
  const base = structuredClone(DEFAULT_FOOTER);
  if (!footer) return base;
  return {
    ...base,
    ...footer,
    columns: Array.isArray(footer.columns) ? footer.columns : base.columns,
    socials: Array.isArray(footer.socials) ? footer.socials : base.socials,
  };
}

export type RestoreScope = "header" | "footer" | "theme";

/* ── Header call-to-action buttons (e.g. "Join the Tribe") ── */
export interface HeaderButton {
  id: string;
  label: string;
  href: string;
  enabled: boolean;
  variant: "light" | "gold" | "outline";
  newTab: boolean;
}

export const DEFAULT_HEADER_BUTTONS: HeaderButton[] = [
  { id: "btn-join", label: "Join the Tribe", href: "#pricing", enabled: true, variant: "light", newTab: false },
];

function normalizeButton(b: Partial<HeaderButton>, i: number): HeaderButton {
  const variant = b.variant === "gold" || b.variant === "outline" ? b.variant : "light";
  return {
    id: typeof b.id === "string" && b.id ? b.id : `btn-${i}`,
    label: typeof b.label === "string" ? b.label : "",
    href: typeof b.href === "string" ? b.href : "#top",
    enabled: b.enabled !== false,
    variant,
    newTab: b.newTab === true,
  };
}

/** Fills in missing fields. A missing list falls back to the default button. */
export function resolveHeaderButtons(list?: unknown): HeaderButton[] {
  if (!Array.isArray(list)) return structuredClone(DEFAULT_HEADER_BUTTONS);
  return list.map((b, i) => normalizeButton((b ?? {}) as Partial<HeaderButton>, i));
}

/* ── Theme colours: one palette for dark mode, one for light mode ──
   Every token below drives a CSS variable the site actually consumes. The
   accent family is three shades of one colour plus the accent-text colour:
     gold      — solid fills: buttons, chips, dots, borders
     goldSoft  — pale accent text and labels
     goldDeep  — the deeper shade used for the soft background glows
     goldInk   — accent text that has to stay readable on the page background
   Keep this list in sync with THEME_TOKEN_VARS, with the css variables in
   index.css, and with the TOKENS list in the dashboard's Theme colours panel. */
export interface ThemeTokens {
  background: string;
  surface: string;
  panel: string;
  heading: string;
  body: string;
  gold: string;
  goldSoft: string;
  goldDeep: string;
  goldInk: string;
}
export interface ThemeColors {
  dark: ThemeTokens;
  light: ThemeTokens;
}

export const DEFAULT_THEME_COLORS: ThemeColors = {
  dark: {
    background: "#070707",
    surface: "#0d0d0d",
    panel: "#151514",
    heading: "#ffffff",
    body: "#d4d4d8",
    gold: "#f5b301",
    goldSoft: "#ffdf8a",
    goldDeep: "#d99700",
    // On matte black the accent itself is readable, so accent text matches it.
    goldInk: "#f5b301",
  },
  light: {
    background: "#f7f4ed",
    surface: "#efeae0",
    panel: "#e7e1d4",
    heading: "#171513",
    body: "#3a342b",
    gold: "#f5b301",
    goldSoft: "#ffdf8a",
    goldDeep: "#d99700",
    // #f5b301 on the cream background is only 1.7:1, so light mode uses a
    // deeper gold for text (4.7:1). See --gold-ink in index.css.
    goldInk: "#8f6700",
  },
};

/** Which CSS variable each theme token drives. */
export const THEME_TOKEN_VARS: Record<keyof ThemeTokens, string> = {
  background: "--color-ink-950",
  surface: "--color-ink-900",
  panel: "--color-ink-800",
  heading: "--color-white",
  body: "--color-zinc-300",
  gold: "--color-saffron-400",
  goldSoft: "--color-saffron-300",
  goldDeep: "--color-saffron-500",
  goldInk: "--gold-ink",
};

const TOKEN_KEYS = Object.keys(DEFAULT_THEME_COLORS.dark) as (keyof ThemeTokens)[];

/**
 * Keeps saved palettes to the current token set. Unknown keys left over from
 * older versions (the removed `warm` and `cool` accents) are dropped instead of
 * being carried forward forever.
 */
function pickTokens(defaults: ThemeTokens, saved?: Partial<ThemeTokens>): ThemeTokens {
  const out = {} as ThemeTokens;
  for (const key of TOKEN_KEYS) {
    const value = saved?.[key];
    out[key] = typeof value === "string" && value ? value : defaults[key];
  }
  return out;
}

export function resolveThemeColors(tc?: Partial<ThemeColors>): ThemeColors {
  const light = pickTokens(DEFAULT_THEME_COLORS.light, tc?.light);

  // Upgrade the old brown default accents to the current yellow without
  // touching palettes the user customised.
  const previousDefaults: Partial<Record<keyof ThemeTokens, string>> = {
    gold: "#b07c00",
    goldSoft: "#8a6000",
  };
  for (const key of Object.keys(previousDefaults) as (keyof ThemeTokens)[]) {
    if (light[key].toLowerCase() === previousDefaults[key]) {
      light[key] = DEFAULT_THEME_COLORS.light[key];
    }
  }

  const dark = pickTokens(DEFAULT_THEME_COLORS.dark, tc?.dark);
  // Unless it was set on purpose, dark-mode accent text follows the accent, so
  // changing the primary colour also changes the accent text.
  if (!tc?.dark?.goldInk) dark.goldInk = dark.gold;

  return { dark, light };
}

/* ── Loader animation ──
   How the loader's logo (or the built-in rider mark) moves while the site
   loads. "none" leaves an uploaded logo still; the built-in rider mark has its
   own motion baked into the artwork, so it never freezes. */
export const LOADER_ANIMATIONS = [
  "none",
  "pulse",
  "float",
  "bounce",
  "spin",
  "wobble",
  "glow",
  "orbit",
  "zoom",
] as const;
export type LoaderAnimation = (typeof LOADER_ANIMATIONS)[number];

export const LOADER_ANIMATION_LABELS: Record<LoaderAnimation, { label: string; hint: string }> = {
  none: { label: "Static", hint: "No extra motion" },
  pulse: { label: "Pulse", hint: "Breathes in and out" },
  float: { label: "Float", hint: "Drifts gently up and down" },
  bounce: { label: "Bounce", hint: "Springs off the ground" },
  spin: { label: "Spin", hint: "Turns continuously" },
  wobble: { label: "Wobble", hint: "Tilts side to side" },
  glow: { label: "Glow", hint: "Fades with a gold halo" },
  orbit: { label: "Orbit", hint: "Circles around its centre" },
  zoom: { label: "Zoom", hint: "Grows and shrinks" },
};

export function resolveLoaderAnimation(value?: unknown): LoaderAnimation {
  return typeof value === "string" &&
    (LOADER_ANIMATIONS as readonly string[]).includes(value)
    ? (value as LoaderAnimation)
    : "none";
}

export interface SiteContent {
  v: 1;
  /** Internal one-time migrations applied to browser-saved dashboard content. */
  migrations?: string[];
  nav: NavItem[];
  sections: SectionEntry[];
  /** Optional custom loader icon (data URL or /media path). */
  loaderLogo?: string;
  /** Motion applied to the loader logo/icon while the site loads. */
  loaderAnimation?: LoaderAnimation;
  brand?: BrandSettings;
  footer?: FooterSettings;
  headerButtons?: HeaderButton[];
  themeColors?: ThemeColors;
}

export interface Revision {
  id: string;
  timestamp: string; // ISO 8601
  description: string;
  content: SiteContent;
}

/* ── Per-section data shapes ── */
export interface HeroData {
  liveTag: string;
  headA: string;
  headHi: string;
  headB: string;
  sub: string;
  cta1: string;
  cta1Href: string;
  cta2: string;
  cta2Href: string;
  ratingText: string;
  tribeText: string;
  chipLocation: string;
  epTitle: string;
  epMeta: string;
  statTop: string;
  statSub: string;
  showreelHref: string;
  mainImage: string;
  cardAImage: string;
  cardBImage: string;
  cardATitle: string;
  cardAMeta: string;
  cardBTitle: string;
  cardBMeta: string;
  marquee: string[];
}
export interface SocialProofData {
  pressIntro: string;
  press: string[];
  stats: { value: number; suffix: string; label: string; sub: string }[];
}
export interface LiveData {
  eyebrow: string;
  titleA: string;
  titleHi: string;
  titleB: string;
  sub: string;
  note: string;
}
export interface FeatureItem {
  icon: string;
  title: string;
  desc: string;
  /** Icon tile colour (hex). Empty = the default gold/bronze gradient. */
  color?: string;
}
export interface FeaturesData {
  eyebrow: string;
  titleA: string;
  titleHi: string;
  titleB: string;
  sub: string;
  items: FeatureItem[];
}
export interface Destination {
  name: string;
  state: string;
  tagline: string;
  description: string;
  image: string;
  distance: string;
  days: string;
  season: string;
  vibe: string;
}
export interface JourneyData {
  eyebrow: string;
  titleA: string;
  titleHi: string;
  titleB: string;
  sub: string;
  destinations: Destination[];
}
export interface BikeHotspot {
  title: string;
  /** Pointer colour (hex). Empty = the default gold pointer. */
  color?: string;
  /** Colour of the pulsing ring / wave. Empty = matches the pointer colour. */
  pulseColor?: string;
  desc: string;
  price: string;
  image: string;
  link: string;
  x: number; // 0–100, left %
  y: number; // 0–100, top %
}
export interface MachineSubsectionLayout {
  /** Stable block ids ordered inside the Machine section only. */
  order: string[];
  /** Optional per-block pixel heights. Unset = natural content height. */
  heights: Record<string, number>;
  /** Grid-column span presets: 4, 6, 8 or 12 columns on wide screens. */
  widths: Record<string, number>;
  /** Blocks switched off by the admin. Visitors never see these. */
  hidden?: string[];
  /** The Click a part panel, positioned inside the bike-photo block. */
  partsPanel?: {
    top: number;
    right: number;
    bottom: number;
    width: number;
  };
}
/**
 * Odometer bookkeeping for The Machine. The reading itself lives in `km`;
 * this holds the rungs the rider adds once the built-in ladder is behind them.
 */
export interface MachineOdometer {
  /** Extra milestones (km) filed from the dashboard, used past 50,000 km. */
  extraMilestones?: number[];
  /** When the reading was last updated, as an ISO timestamp. */
  updatedAt?: string;
}
export interface MachineData {
  eyebrow: string;
  titleA: string;
  titleHi: string;
  titleB: string;
  sub: string;
  mainImage: string;
  mainImageAlt: string;
  km: number;
  /** Milestone bookkeeping behind the odometer card. */
  odometer?: MachineOdometer;
  namePlate: string;
  namePlateEn: string;
  plateSub: string;
  whyTitle: string;
  whyText: string;
  whyFoot: string;
  mods: string[];
  filmCta: string;
  pdfCta: string;
  /**
   * The file behind the setup-sheet button. Either a URL/path, or an
   * "idb:<id>" reference into the media library (any file type).
   */
  pdfFile: string;
  serviceLine: string;
  gallery: { src: string; alt: string; cap: string }[];
  hotspots: BikeHotspot[];
  subsectionLayout?: MachineSubsectionLayout;
}
export interface GearItem {
  /** Stable product ID, scoped to the catalog it belongs to. */
  id?: string;
  /** My Picks ID when this is an independent copy attached to The Gear map. */
  sourcePickId?: string;
  enabled?: boolean;
  /** A free-form wardrobe category, such as helmet, jacket, gloves or boots. */
  category: string;
  /** Optional body zone for the interactive rider map; blank infers it from category. */
  bodyPart?: string;
  name: string;
  brand: string;
  model: string;
  description: string;
  image: string;
  /**
   * Extra photos shown as a slider on the shop page. The first photo stays in
   * `image` so a product without a gallery behaves exactly as it always did.
   */
  images?: string[];
  imageAlt: string;
  highlights: string[];
  fit: string;
  usedFor: string;
  price: string;
  link: string;
}
export interface GearsData {
  eyebrow: string;
  titleA: string;
  titleHi: string;
  titleB: string;
  sub: string;
  emptyTitle: string;
  emptyText: string;
  items: GearItem[];
}

export function makeGearItemId(name: string, suffix?: string | number): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "item";
  return `gear-${slug}${suffix === undefined ? "" : `-${suffix}`}`;
}

export type RiderKitPointerZone = "head" | "torso" | "hands" | "waist" | "legs" | "feet" | "intercom";
export interface RiderKitPointer {
  id: string;
  label: string;
  /** Optional stable link to the product opened from this pointer. */
  gearId?: string;
  zone: RiderKitPointerZone;
  x: number;
  y: number;
  radius: number;
  /** Pointer colour (hex). Empty = the default gold pointer. */
  color?: string;
  /** Colour of the pulsing ring. Empty = matches the pointer colour. */
  pulseColor?: string;
  enabled?: boolean;
}
export interface RiderKitData {
  eyebrow: string;
  titleA: string;
  titleHi: string;
  titleB: string;
  sub: string;
  image: string;
  imageAlt: string;
  /** Independent product copies shown on the rider map; not tied to the Wardrobe section. */
  items: GearItem[];
  mapPointers: RiderKitPointer[];
}
export interface BenefitsData {
  eyebrow: string;
  titleA: string;
  titleHi: string;
  titleB: string;
  sub: string;
  videoLine: string;
  videoChips: string[];
  quote: string;
  personas: { tag: string; title: string; points: string[] }[];
}
export interface YouTubeItem {
  enabled?: boolean;
  title: string;
  url: string;
  description: string;
}
export interface YouTubeData {
  eyebrow: string;
  titleA: string;
  titleHi: string;
  titleB: string;
  sub: string;
  channelLabel: string;
  channelHref: string;
  items: YouTubeItem[];
}
export interface InstagramItem {
  enabled?: boolean;
  title: string;
  /** Public Instagram post/reel URL. */
  url: string;
  caption: string;
}
export interface InstagramData {
  eyebrow: string;
  titleA: string;
  titleHi: string;
  titleB: string;
  sub: string;
  profileLabel: string;
  profileHref: string;
  items: InstagramItem[];
}
export interface StoriesData {
  eyebrow: string;
  titleA: string;
  titleHi: string;
  titleB: string;
  sub: string;
  items: { name: string; age: string; quote: string }[];
}
export interface PricingData {
  eyebrow: string;
  titleA: string;
  titleHi: string;
  titleB: string;
  sub: string;
  fine: string;
  plans: {
    name: string;
    tagline: string;
    monthly: number;
    yearly: number;
    cta: string;
    featured: boolean;
    features: string[];
  }[];
}
export interface FaqData {
  eyebrow: string;
  titleA: string;
  titleHi: string;
  titleB: string;
  sub: string;
  discordLabel: string;
  discordMeta: string;
  emailLabel: string;
  email: string;
  emailMeta: string;
  items: { q: string; a: string }[];
}
export interface CtaData {
  badge: string;
  titleA: string;
  titleHi: string;
  sub: string;
  placeholder: string;
  btnLabel: string;
  success: string;
  fineprint: string;
  chips: string[];
}
export interface CustomData {
  eyebrow: string;
  title: string;
  sub: string;
  image: string;
  imageAlt: string;
  buttonLabel: string;
  buttonHref: string;
  layout: "image-left" | "image-right";
}
export interface MaintenanceData {
  badge: string;
  title: string;
  description: string;
  /** Optional override; blank = the saved website logo. */
  logo: string;
  /**
   * ISO datetime the site should take itself offline. Blank = no schedule.
   * Cleared once it fires, so a schedule only ever runs once.
   */
  scheduledAt: string;
  /** ISO datetime the site actually went offline. Stamped automatically. */
  startedAt: string;
  /** ISO datetime the site came back. Stamped automatically when switched off. */
  endedAt: string;
  note: string;
  email: string;
}
export interface CountdownData {
  badge: string;
  title: string;
  sub: string;
  /** ISO datetime the timer runs to. */
  targetDate: string;
  /** Text shown as a banner once the timer reaches zero. Empty = no banner. */
  doneMessage: string;
  /** Section ids that switch on automatically when the timer reaches zero. */
  revealSectionIds: string[];
  ctaLabel: string;
  ctaHref: string;
}

/* ═══════════════════════ Defaults ═══════════════════════ */

const showreelHref = "#showreel";

const HERO: HeroData = {
  liveTag: "Now riding the Spiti Circuit — new film every Sunday",
  headA: "Chasing ",
  headHi: "India",
  headB: ", one wild mile at a time.",
  sub: "I'm PB (Parul Bedi) — creator, rider, storyteller. Hailing from Nangal Dam, Punjab, for 8 years I've been decoding the subcontinent: cinematic films, road-tested routes, honest budgets and hidden gems from all 28 states. No filters. Just the road.",
  cta1: "Explore the Journey",
  cta1Href: "#journey",
  cta2: "Watch the Showreel",
  cta2Href: "#showreel",
  ratingText: "4.9 from 6,200+ travelers",
  tribeText: "480K+ tribe members",
  chipLocation: "Khardung La · 17,582 ft",
  epTitle: "EP. 214 — Spiti: The Middle Land",
  epMeta: "38:12 · Premieres Sunday, 7 PM IST",
  statTop: "1,412 days",
  statSub: "on the road since 2017",
  showreelHref,
  mainImage:
    "",
  cardAImage:
    "",
  cardBImage:
    "",
  cardATitle: "Alappuzha, Kerala",
  cardAMeta: "Day 3 · 212 km",
  cardBTitle: "Varanasi, UP",
  cardBMeta: "Dawn aarti · 5:40 AM",
  marquee: [
    "Ladakh", "Spiti", "Kashmir", "Rajasthan", "Kerala", "Meghalaya",
    "Goa", "Varanasi", "Rann of Kutch", "Andaman", "Nubra", "Coorg",
  ],
};

const SOCIALPROOF: SocialProofData = {
  pressIntro: "Featured by the people who love the road",
  press: [
    "Tripoto", "The Better India", "NatGeo Traveller", "CNN-News18",
    "Red Bull India", "Royal Enfield", "YourStory", "MTV India",
  ],
  stats: [
    { value: 28, suffix: "", label: "States conquered", sub: "All 28, zero shortcuts" },
    { value: 140, suffix: "K+", label: "Kilometres ridden", sub: "And counting every mile" },
    { value: 480, suffix: "K+", label: "Tribe members", sub: "Across YouTube & Insta" },
    { value: 96, suffix: "M+", label: "Film views", sub: "380+ stories published" },
  ],
};

const LIVE: LiveData = {
  eyebrow: "Live tracker",
  titleA: "PB is ",
  titleHi: "on the road",
  titleB: " right now.",
  sub: "A live GPS window into the current expedition. Location pings land every hour between 6:00 AM and 9:00 PM IST — straight from Taweel's handlebar mount to this page.",
  note: "Night halt at Key village — bonfire and a Milky Way shoot at 11 PM.",
};

const FEATURES: FeaturesData = {
  eyebrow: "Why wander with PB",
  titleA: "Not another travel page. ",
  titleHi: "A road-tested playbook.",
  titleB: "",
  sub: "Everything I wish existed when I started — distilled from 1.4 lakh kilometres, 28 states and more wrong turns than I can count.",
  items: [
    { icon: "clapperboard", title: "Cinematic Travel Films", desc: "Weekly episodes cut like mini-movies — drone lines, ambient sound, zero fluff. This is India the way it actually feels at 80 kmph." },
    { icon: "route", title: "Road-Tested Route Maps", desc: "GPX files + turn-by-turn notes for every ride. Fuel points, stays, permits and exits — mapped, ridden, verified." },
    { icon: "rupee", title: "Honest Budget Breakdowns", desc: "Every rupee accounted for — fuel, food, stays, repairs. Know exactly what a trip costs before you pack a bag." },
    { icon: "compass", title: "Hidden Gems Atlas", desc: "The spots 99% of tourists never find — Turtuk's alleys, Meghalaya's caves, Goa's secret coves. Members-only coordinates." },
    { icon: "backpack", title: "Gear That Survives India", desc: "Camera, riding and camping kit tested through dust, monsoon rain and 18,000 ft passes. Buy once, cry never." },
    { icon: "users", title: "Tribe Meetups & Rides", desc: "Group rides, film screenings and meetups across 40+ cities. The fastest way to find people who get it." },
  ],
};

const JOURNEY: JourneyData = {
  eyebrow: "The Journey",
  titleA: "Eight signature rides. ",
  titleHi: "One unforgettable India.",
  titleB: "",
  sub: "Every route below has been ridden, filmed and road-tested by PB — with maps, budgets and foul-weather exits published for members.",
  destinations: [
    { name: "Ladakh", state: "Jammu & Kashmir", tagline: "The Land of High Passes", description: "Eleven passes above 16,000 ft, Pangong turning gold at dawn, and mornings that smell of butter tea and diesel. Ladakh isn't a trip — it's a rite of passage. Full GPX, permit checklist and fuel strategy included.", image: "", distance: "2,150 km", days: "12 days", season: "Jun – Sep", vibe: "High-altitude madness" },
    { name: "Nubra Valley", state: "Ladakh", tagline: "The Cold Desert", description: "Sand dunes wedged between snow peaks, double-humped camels at Hunder, and Turtuk — a Baltistan village India opened to the world only in 2010. The detour most riders skip, and never forget.", image: "", distance: "480 km", days: "4 days", season: "Jun – Sep", vibe: "Otherworldly" },
    { name: "Spiti Valley", state: "Himachal Pradesh", tagline: "The Middle Land", description: "Raw, lunar, and humbling. Key Monastery at sunrise, Chandra Tal under the Milky Way, and the world's highest villages where time moves at 0.5x. My most requested route — mapped to the last kilometre.", image: "", distance: "1,320 km", days: "9 days", season: "May – Oct", vibe: "Raw & spiritual" },
    { name: "Rajasthan", state: "The Desert Crown", tagline: "Forts, Dunes & Fury", description: "Amber Fort at golden hour, Jaisalmer's dunes under a full moon, and Udaipur's lakes at dusk. A 2,400 km loop through living palaces, thorn forests and the loudest thalis in India.", image: "", distance: "2,400 km", days: "10 days", season: "Oct – Feb", vibe: "Royal & loud" },
    { name: "Varanasi", state: "Uttar Pradesh", tagline: "The Eternal City", description: "The oldest living city on earth doesn't photograph — it swallows you. Dawn boats on the Ganga, the thunder of the evening aarti, and kachori-sabzi breakfasts in lanes older than empires.", image: "", distance: "620 km", days: "3 days", season: "Oct – Mar", vibe: "Intense & timeless" },
    { name: "Meghalaya", state: "Northeast India", tagline: "The Abode of Clouds", description: "Nohkalikai plunging 1,115 ft, living root bridges grown over 500 years, and Mawlynnong — Asia's cleanest village. India's wettest, greenest, most surprising corner, packed into one epic loop.", image: "", distance: "1,180 km", days: "8 days", season: "Oct – Apr", vibe: "Lush & wild" },
    { name: "Kerala", state: "God's Own Country", tagline: "Slow Roads & Stiller Waters", description: "Houseboats drifting through Alappuzha, Munnar's tea carpeting every hill, and Fort Kochi's Chinese fishing nets at sunset. The antidote to burnout — best absorbed at 40 kmph, windows down.", image: "", distance: "940 km", days: "7 days", season: "Sep – Mar", vibe: "Slow & green" },
    { name: "Goa", state: "The Coastal Pulse", tagline: "Beyond the Beach Shacks", description: "Everyone knows Baga. Almost nobody finds Kakolem. My Goa route trades crowds for hidden coves, spice-farm trails, Divar island ferry hops and the Saturday night market at Arpora.", image: "", distance: "560 km", days: "5 days", season: "Nov – Feb", vibe: "Salty & free" },
  ],
};

const MACHINE: MachineData = {
  eyebrow: "The machine",
  titleA: "Meet ",
  titleHi: "طویل",
  titleB: " (Taweel) — Himalayan 450, Hanle Black.",
  sub: "32,000 km together across 19 states. One seized chain, zero regrets. Tap the + markers to highlight each accessory.",
  // Served from public/media, so a build never needs the internet to show the
  // bike. Swapping that file keeps every existing pointer position.
  mainImage: "/media/himalayan-450.png",
  mainImageAlt: "طویل (Taweel) — PB's Royal Enfield Himalayan 450 in Hanle Black, parked in the mountains",
  km: 32000,
  odometer: { extraMilestones: [], updatedAt: "" },
  namePlate: "طویل",
  namePlateEn: "Taweel",
  plateSub: "Named for the long roads out of Nangal Dam — طویل means long",
  whyTitle: "Why Hanle Black?",
  whyText: "Hanle, Ladakh — home to India's highest observatory and its darkest skies. PB shot the Milky Way timelapse of EP. 187 there, then ordered the matte-black طویل (Taweel) the same week. Zero chrome. All intent.",
  whyFoot: "32.78° N · 78.96° E · BORTLE 1 SKIES",
  mods: [
    "Engine crash guards", "74L aluminium panniers", "Aux LED fog lamps",
    "Tail rack + Rotopax", "Tubeless conversion", "Tank bag + 3-cam rig",
  ],
  filmCta: "Watch the Taweel film",
  pdfCta: "Free setup sheet (PDF)",
  pdfFile: "",
  serviceLine: "Service log public · 11 services · chain+sprocket at 24k",
  gallery: [
    { src: "", alt: "PB riding طویل (Taweel) on a Himalayan mountain road in Uttarakhand", cap: "Pithoragarh climb · 7,200 ft" },
    { src: "", alt: "طویل (Taweel) parked before a Himalayan glacier backdrop", cap: "Glacier run · Day 9" },
    { src: "", alt: "Close-up of Taweel's TripperDash console and gauges", cap: "TripperDash · full-map nav" },
  ],
  hotspots: [
    {
      title: "Sherpa 450 engine",
      desc: "Royal Enfield's first liquid-cooled DOHC single. 452cc, 40.02 PS, 40 Nm — pulls cleanly above 12,000 ft where the old air-cooled lump used to gasp.",
      price: "OEM · ₹2,85,000 (bike)",
      image: "",
      link: "https://www.royalenfield.com/in/en/motorcycles/himalayan/",
      x: 42,
      y: 68,
    },
    {
      title: "TripperDash TFT",
      desc: '4" round TFT with Google Maps, music and calls mirrored from the phone. Readable even in Ladakhi noon glare.',
      price: "OEM · included",
      image: "",
      link: "https://www.royalenfield.com/in/en/motorcycles/himalayan/",
      x: 64,
      y: 26,
    },
    {
      title: "17L tank + 230mm clearance",
      desc: "Seventeen litres means Kaza-to-Manali thinking, not panicking. Showa USD forks and 230mm of clearance eat Spiti's water crossings for breakfast.",
      price: "OEM · ≈450 km range",
      image: "",
      link: "https://www.royalenfield.com/in/en/motorcycles/himalayan/",
      x: 50,
      y: 44,
    },
    {
      title: "74L aluminium panniers",
      desc: "Hard expedition boxes — crash-tested, lockable, and room for a week's kit plus a drone case. Every bolt earned over 32,000 km.",
      price: "₹18,490",
      image: "",
      link: "https://www.royalenfield.com/in/en/genuine-motorcycle-accessories/",
      x: 81,
      y: 60,
    },
    {
      title: "Aux LED fog lamps",
      desc: "Pair of 40W aux fogs on crash-bar mounts. Cuts fog on Rohtang and lights up water crossings after dark.",
      price: "₹4,250",
      image: "",
      link: "https://www.royalenfield.com/in/en/genuine-motorcycle-accessories/",
      x: 28,
      y: 58,
    },
  ],
};

const GEARS: GearsData = {
  eyebrow: "My Picks",
  titleA: "Gear for ",
  titleHi: "the ride.",
  titleB: "",
  sub: "A curated gear collection from brands I ride with. Prices and availability can change; open each product page for current details.",
  emptyTitle: "No gear picks yet.",
  emptyText: "Add a pick from Dashboard → Shop → My Picks to start this collection.",
  items: [
    {
      enabled: true,
      category: "Helmet",
      bodyPart: "Head",
      id: "gear-optimus-dual-sport-helmet-black-gold",
      name: "Optimus Dual Sport Helmet — Black & Gold",
      brand: "Royal Enfield",
      model: "HEA240002 · Black & Gold",
      description: "A dual-sport full-face helmet with a removable, adjustable peak, listed with ISI and DOT certification.",
      image: "/images/gear/optimus-dual-sport-helmet-black-gold.webp",
      imageAlt: "Royal Enfield Optimus Dual Sport Helmet in black and gold",
      highlights: ["ISI + DOT", "Removable, adjustable peak", "Approx. 1450 ± 50 g"],
      fit: "Check the product page for current size availability",
      usedFor: "Urban · Touring · Adventure",
      price: "₹6,950",
      link: "https://royalenfield.store/in/en/stripe-optimus-ds-ff-id-abs-b-g-xl-62cm",
    },
    {
      enabled: true,
      category: "Intercom",
      bodyPart: "Head",
      id: "gear-super-meteor-650-x-sena-50s-intercom",
      name: "Super Meteor 650 X Sena Intercom",
      brand: "Royal Enfield × Sena",
      model: "50S · Black",
      description: "Helmet communication system with Sena Mesh Intercom and sound components developed with Harman Kardon.",
      image: "/images/gear/sena-50s-intercom.webp",
      imageAlt: "Royal Enfield and Sena 50S helmet intercom communicator",
      highlights: ["Sound by Harman Kardon", "Mesh Intercom · 9 channels", "Bluetooth 5.0 · 2 km stated range"],
      fit: "1 size",
      usedFor: "Helmet-mounted rider-to-rider communication",
      price: "₹35,990",
      link: "https://royalenfield.store/in/en/re-x-sena-50s-intercom-black-free-size",
    },
    {
      enabled: true,
      category: "Jacket",
      bodyPart: "Torso",
      id: "gear-nirvik-v2-print-class-a-riding-jacket-black-gold",
      name: "Nirvik V2 Print Class A Riding Jacket — Black & Gold",
      brand: "Royal Enfield",
      model: "JRA240005 · Black & Gold",
      description: "Two-weather riding jacket listed as Class A, with a rain jacket and protection for touring and adventure riding.",
      image: "/images/gear/nirvik-v2-jacket-black-gold.webp",
      imageAlt: "Rider wearing the Royal Enfield Nirvik V2 Print jacket in black and gold",
      highlights: ["Class A certified", "Two-layer 500D high-abrasion nylon", "Rain jacket included"],
      fit: "Sizes vary; check the official page",
      usedFor: "Urban · Touring · Adventure · Summer, winter and rain",
      price: "₹17,950",
      link: "https://royalenfield.store/in/en/nirvik-print-option-blk-gold-m-40cm",
    },
    {
      enabled: true,
      category: "Bags & carry",
      bodyPart: "Waist / hip",
      id: "gear-classic-sling-bag-rose-gold",
      name: "Classic Sling Gold",
      brand: "Royal Enfield",
      model: "BGA250007 · Rose Gold",
      description: "Compact cross-body sling shown in the supplied product image. Current Rose Gold store listing and price could not be verified.",
      image: "/images/gear/classic-sling-rose-gold.webp",
      imageAlt: "Royal Enfield Classic Sling Bag in Rose Gold",
      highlights: ["Moulded hard-shell upper", "Adjustable cross-body strap", "Free size"],
      fit: "Free size",
      usedFor: "Carrying small essentials",
      price: "₹990",
      link: "https://royalenfield.store/in/en/men/bags",
    },
    {
      enabled: true,
      category: "Gloves",
      bodyPart: "Hands",
      id: "gear-phoenix-gloves-brown",
      name: "Phoenix Gloves — Brown",
      brand: "Royal Enfield",
      model: "GLA240009 · Brown",
      description: "Royal Enfield lists these as L1-KP certified gloves for urban and touring, in summer, winter and rain.",
      image: "/images/gear/phoenix-gloves-brown.webp",
      imageAlt: "Royal Enfield Phoenix riding gloves in brown",
      highlights: ["L1-KP certified", "Urban & touring", "Summer, winter & rain"],
      fit: "Sizes XS–3XL listed",
      usedFor: "Urban · Touring · Summer, winter and rain",
      price: "₹2,390",
      link: "https://royalenfield.store/in/en/phoenix-gloves-tan-23-4-cm-xs",
    },
    {
      enabled: true,
      category: "Trousers",
      bodyPart: "Legs",
      id: "gear-gravel-riding-trouser",
      name: "Gravel Riding Trouser",
      brand: "Royal Enfield",
      model: "TAS250003 · Black",
      description: "Royal Enfield lists these as Class A certified trousers for urban, touring, adventure and cruising, in summer and rain.",
      image: "",
      imageAlt: "Royal Enfield Gravel riding trousers in black",
      highlights: ["Class A certified", "Urban, touring, adventure & cruising", "Summer & rain"],
      fit: "Sizes 28–44 listed",
      usedFor: "Urban · Touring · Adventure · Cruising · Summer & rain",
      price: "₹8,530",
      link: "https://royalenfield.store/in/en/dirt-pant-olive-32",
    },
    {
      enabled: true,
      category: "Boots",
      bodyPart: "Feet",
      id: "gear-wanderer-waterproof-boots",
      name: "Black Wanderer Waterproof Boots",
      brand: "Royal Enfield",
      model: "Black · CE certified",
      description: "The official product page lists these as waterproof riding boots for cruising and adventure use.",
      image: "/images/gear/wanderer-waterproof-boots.webp",
      imageAlt: "Black Wanderer Waterproof Boots from the Royal Enfield Store",
      highlights: ["CE certified", "Waterproof", "Cruising & adventure"],
      fit: "Sizes 4–12 listed",
      usedFor: "Cruising · Adventure · Summer, winter and rain",
      price: "₹9,990",
      link: "https://royalenfield.store/in/en/wanderer-wp-ing-boots-red-eu-46-uk-12-1720648806",
    },
  ],
};

const RIDERKIT: RiderKitData = {
  eyebrow: "The rider's kit",
  titleA: "One rider. ",
  titleHi: "Every layer, mapped.",
  titleB: "",
  sub: "An illustrative full-body gear map. Hover a gear area for a subtle zoom and to bring its matching item to the top; tap to pin it and open the details.",
  image: "/images/rider-kit-model-reference-v2.png",
  imageAlt: "Illustrative rider wearing a reference-matched black and gold helmet and jacket, tan gloves, black boots and a hip sling bag",
  items: GEARS.items.map((item) => ({ ...item, sourcePickId: item.id, highlights: [...item.highlights] })),
  mapPointers: [
    { enabled: true, id: "helmet", label: "Optimus helmet", gearId: "gear-optimus-dual-sport-helmet-black-gold", zone: "head", x: 52, y: 16, radius: 7 },
    { enabled: true, id: "helmet-intercom", label: "Helmet intercom", gearId: "gear-super-meteor-650-x-sena-50s-intercom", zone: "intercom", x: 64, y: 17, radius: 6 },
    { enabled: true, id: "jacket", label: "Nirvik jacket", gearId: "gear-nirvik-v2-print-class-a-riding-jacket-black-gold", zone: "torso", x: 55, y: 41, radius: 11 },
    { enabled: true, id: "left-glove", label: "Phoenix gloves", gearId: "gear-phoenix-gloves-brown", zone: "hands", x: 34, y: 66, radius: 9 },
    { enabled: true, id: "sling-bag", label: "Waist / hip bag", gearId: "gear-classic-sling-bag-rose-gold", zone: "waist", x: 61, y: 57, radius: 8 },
    { enabled: true, id: "trousers", label: "Riding trousers", gearId: "gear-gravel-riding-trouser", zone: "legs", x: 50, y: 71, radius: 14 },
    { enabled: true, id: "boots", label: "Riding boots", gearId: "gear-wanderer-waterproof-boots", zone: "feet", x: 50, y: 91, radius: 9 },

  ],
};

const BENEFITS: BenefitsData = {
  eyebrow: "Built for the way you move",
  titleA: "One journey. ",
  titleHi: "Three ways to live it.",
  titleB: "",
  sub: "Whether you shoot, ride, or just itch to get out of the city — there's a lane for you here.",
  videoLine: "8 years · 28 states · 140,000 km — in 40 seconds",
  videoChips: ["140K km", "380+ films", "28 states"],
  quote: "I packed my saddlebags in Nangal Dam in 2017 with one backpack and a secondhand camera. The road has been my home ever since.",
  personas: [
    { tag: "For vloggers", title: "Create as you go", points: ["Shot lists & storyboards from every episode", "Cinematic LUT packs graded for Indian light", "Collab ops — ride with the crew, get featured"] },
    { tag: "For adventure tourers", title: "Ride further, safer", points: ["GPX routes with fuel, stays & mechanic markers", "Permit desk — Ladakh, NE India, Rann handled", "Buddy system & 24×7 road support on group rides"] },
    { tag: "For the young & restless", title: "Escape the scroll", points: ["Weekend itineraries under ₹3,000 from 12 cities", "Hostel & stay discounts across 60+ partners", "A tribe of 480K — never travel solo again"] },
  ],
};

const YOUTUBE: YouTubeData = {
  eyebrow: "Watch on YouTube",
  titleA: "Road films, ",
  titleHi: "built for the big screen.",
  titleB: "",
  sub: "Fresh episodes, route breakdowns and the stories behind each ride.",
  channelLabel: "Visit the channel",
  channelHref: "https://www.youtube.com/",
  items: [],
};

const INSTAGRAM: InstagramData = {
  eyebrow: "From Instagram",
  titleA: "Small moments. ",
  titleHi: "Wild places.",
  titleB: "",
  sub: "Photos and reels sent from the road, between the longer films.",
  profileLabel: "Follow on Instagram",
  profileHref: "https://www.instagram.com/",
  items: [],
};

const STORIES: StoriesData = {
  eyebrow: "Tribe stories",
  titleA: "480,000 wanderers. ",
  titleHi: "Zero regrets.",
  titleB: "",
  sub: "From first solo trips to full-blown Ladakh expeditions — the tribe has stories, and they don't hold back.",
  items: [
    { name: "Aarav Mehta", age: "23 · Spiti circuit", quote: "Followed PB's Spiti GPX blind. Ten days, zero wrong turns, one flat tyre. The fuel-point markers alone saved us twice above 15,000 ft. Best trip of my life." },
    { name: "Meera Krishnan", age: "26 · Solo in Kerala", quote: "I was terrified to travel solo in India. PB's films made it feel possible — then his Kerala guide made it real. Seven days alone, came back a different person." },
    { name: "Rohan Banerjee", age: "29 · Vlogger, 84K subs", quote: "His route notes saved my Ladakh series — the permit checklist and golden-hour map are pure gold. Shot my best performing film to date on his trail." },
    { name: "Ishita Sharma", age: "22 · Goa meetup", quote: "From the Sunday newsletter to the Goa beach meetup — this tribe feels like family now. I've made more real friends here than in four years of college." },
    { name: "Kabir Singh", age: "31 · Adventure tourer", quote: "Done Rann, Spiti and Meghalaya on PB's maps. His weather-window alerts and exit routes are the difference between an epic and a disaster." },
    { name: "Ananya Iyer", age: "25 · Product designer", quote: "Every film is a mini vacation. Sunday evenings are sacred now — chai, headphones, and a new PB episode. It's the highlight of my week." },
  ],
};

const PRICING: PricingData = {
  eyebrow: "Membership",
  titleA: "Pick your pace. ",
  titleHi: "The road is the same.",
  titleB: "",
  sub: "Start free, upgrade when the wanderlust wins. Cancel anytime — no exit permits required.",
  fine: "Prices in INR, inclusive of taxes · Students get 40% off Explorer with a valid ID ·",
  plans: [
    { name: "Wanderer", tagline: "Dip your toes in", monthly: 0, yearly: 0, cta: "Start free", featured: false, features: ["Weekly cinematic vlogs", "Public route guides", "The Sunday Route newsletter", "Community access"] },
    { name: "Explorer", tagline: "For the regular wanderer", monthly: 499, yearly: 399, cta: "Become an Explorer", featured: true, features: ["Everything in Wanderer", "Full route library + GPX files", "Honest budget sheets per trip", "Ad-free films & early access", "Hidden Gems Atlas coordinates", "10% off group rides & merch"] },
    { name: "Legend", tagline: "For the obsessed", monthly: 1499, yearly: 1199, cta: "Go Legend", featured: false, features: ["Everything in Explorer", "Priority seats on 4 group rides/yr", "1:1 trip-planning call with PB", "Private tribe Discord", "Lifetime Legend badge"] },
  ],
};

const FAQ: FaqData = {
  eyebrow: "FAQ",
  titleA: "Asked at every ",
  titleHi: "meetup, ever.",
  titleB: "",
  sub: "Straight answers, no fine print. Still curious? The tribe Discord answers faster than I can.",
  discordLabel: "Join the tribe Discord",
  discordMeta: "48,000 members online daily",
  emailLabel: "",
  email: "hello@pbfrompb.in",
  emailMeta: "Replies within 72 hours",
  items: [
    { q: "How does the live tracker work?", a: "While PB is riding, a GPS ping lands every hour between 6:00 AM and 9:00 PM IST. Tap the blinking LIVE sign or the hero banner to open the live map page — it shows طویل (Taweel)'s real position with a pulsing marker. After 9 PM the tracker goes off-duty and wakes up again at 6 AM the next morning." },
    { q: "Who is PB, really?", a: "Parul Bedi ('PB') — a creator, rider and storyteller hailing from the scenic town of Nangal Dam, Punjab. In 2017, he hit the road to document India unfiltered. 8 years, all 28 states, 1.4 lakh kilometres and 380+ films later, the mission hasn't changed: make India feel reachable, one honest story at a time." },
    { q: "Do I need my own bike or car to follow the routes?", a: "No. Every route guide lists rental partners (with member discounts in 20+ cities), self-drive options and even public-transport alternates. Half the tribe does these trips on rented Himalayans, scooters and overnight buses." },
    { q: "Are the routes beginner-friendly?", a: "Each route carries a difficulty tag from 'Chill' to 'Expert', with daily distance caps, tarmac-vs-offroad ratios and bailout exits marked on the map. If a section needs experience, the guide says so in caps — I promise." },
    { q: "What exactly do I get with membership?", a: "Explorer unlocks the full route library with GPX files, budget sheets, the Hidden Gems Atlas and ad-free early access. Legend adds priority group-ride seats, a 1:1 trip-planning call with PB and the private tribe Discord. Wanderer is free forever." },
    { q: "Can we collaborate or invite PB to our event?", a: "Yes — brand collabs, college fests, podcasts and film screenings are all on the table. The one rule: it has to be honest. Use the contact mail below with 'Collab' in the subject line and the team responds within 72 hours." },
    { q: "How do the group rides work?", a: "Ride drops go out monthly to members first. Groups are capped at 12 machines, IDs are verified, and every ride includes a safety briefing, a backup mechanic and a sweeper vehicle. Zero egos, full throttle." },
  ],
};

const MAINTENANCE: MaintenanceData = {
  badge: "Down for the night",
  title: "The road is closed for now.",
  description:
    "PB is out riding the last stretch and the site is getting a fresh coat of polish. Thank you for your patience — everything will be back shortly, sharper and faster than before.",
  logo: "",
  scheduledAt: "",
  startedAt: "",
  endedAt: "",
  note: "For urgent queries, drop a line at hello@pbfrompb.in",
  email: "hello@pbfrompb.in",
};

const COUNTDOWN: CountdownData = {
  badge: "Expedition drops in",
  title: "Spiti Circuit — Episode 214",
  sub: "Twelve days over the world's highest villages, filmed on طویل (Taweel). Mark your calendar.",
  targetDate: "",
  doneMessage: "The wait is over — it's live now.",
  ctaLabel: "Watch the teaser",
  ctaHref: "#showreel",
  revealSectionIds: [],
};

const CTA: CtaData = {
  badge: "The Sunday Route — free forever",
  titleA: "The road is calling. ",
  titleHi: "Answer it.",
  sub: "One hidden gem, one tested route and one honest budget in your inbox every Sunday morning. Chai not included.",
  placeholder: "you@wanderlust.in",
  btnLabel: "Get the Sunday Route",
  success: "You're on the list. First route lands this Sunday, 7 AM.",
  fineprint: "48,000 subscribers · No spam, no selling your data · Unsubscribe anytime",
  chips: ["Free route guides", "480K+ tribe", "Cancel anytime"],
};

/* ═══════════════════════ Default content ═══════════════════════ */

export const DEFAULT_CONTENT: SiteContent = {
  v: 1,
  migrations: ["gears-nav-link-v1", "gears-store-picks-v1", "gear-item-ids-v1", "riderkit-nav-v1", "riderkit-attached-gear-v1", "riderkit-hover-zoom-v2", "riderkit-reference-image-v2", "riderkit-dashboard-pointers-v1", "riderkit-pointer-products-v1", "riderkit-product-pointer-list-v1", "riderkit-the-gear-label-v1", "shop-my-picks-nav-v1", "gears-my-picks-copy-v1", "riderkit-independent-products-v1", "phoenix-glove-photo-v1"],
  nav: [
    { id: "nav-live", label: "Live", href: "#/live-map", enabled: true },
    { id: "nav-journey", label: "The Journey", href: "#journey", enabled: true },
    { id: "nav-machine", label: "The Machine", href: "#machine", enabled: true },
    { id: "nav-gears", label: "Gears", href: "#gears", enabled: true },
    { id: "nav-shop", label: "My Picks", href: "#/shop", enabled: true },
    { id: "nav-riderkit", label: "Rider Kit", href: "#riderkit", enabled: true },
    { id: "nav-features", label: "Why PB", href: "#features", enabled: true },
    { id: "nav-stories", label: "Tribe Stories", href: "#stories", enabled: true },
    { id: "nav-pricing", label: "Membership", href: "#pricing", enabled: true },
    { id: "nav-faq", label: "FAQ", href: "#faq", enabled: true },
  ],
  sections: [
    { id: "sec-countdown", type: "countdown", label: "Countdown Timer", enabled: false, data: { ...COUNTDOWN } },
    { id: "sec-maintenance", type: "maintenance", label: "Maintenance Mode", enabled: false, data: { ...MAINTENANCE } },
    { id: "sec-hero", type: "hero", label: "Hero", enabled: true, data: { ...HERO } },
    { id: "sec-socialproof", type: "socialproof", label: "Social Proof & Stats", enabled: true, data: { ...SOCIALPROOF } },
    { id: "sec-live", type: "live", label: "Live Tracker", enabled: true, data: { ...LIVE } },
    { id: "sec-features", type: "features", label: "Why PB (Features)", enabled: true, data: { ...FEATURES } },
    { id: "sec-journey", type: "journey", label: "Journey Showcase", enabled: true, data: { ...JOURNEY } },
    { id: "sec-machine", type: "machine", label: "The Machine (طویل / Taweel)", enabled: true, data: { ...MACHINE } },
    { id: "sec-gears", type: "gears", label: "Riding Gear & Wardrobe", enabled: true, data: { ...GEARS } },
    { id: "sec-riderkit", type: "riderkit", label: "The Gear", enabled: true, data: { ...RIDERKIT } },
    { id: "sec-benefits", type: "benefits", label: "Benefits & Showreel", enabled: true, data: { ...BENEFITS } },
    { id: "sec-youtube", type: "youtube", label: "YouTube", enabled: false, data: { ...YOUTUBE } },
    { id: "sec-instagram", type: "instagram", label: "Instagram", enabled: false, data: { ...INSTAGRAM } },
    { id: "sec-stories", type: "stories", label: "Testimonials", enabled: true, data: { ...STORIES } },
    { id: "sec-pricing", type: "pricing", label: "Pricing", enabled: true, data: { ...PRICING } },
    { id: "sec-faq", type: "faq", label: "FAQ", enabled: true, data: { ...FAQ } },
    { id: "sec-cta", type: "cta", label: "Final CTA", enabled: true, data: { ...CTA } },
  ],
};

/* ═══════════════════════ Merge + persistence ═══════════════════════ */

const STORAGE_KEY = "pb_site_content_v1";
const THEME_KEY = "pb_theme_v1";
const REVISIONS_KEY = "pb_revisions_v1";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || override === undefined) {
    return (override === undefined ? base : (override as T));
  }
  if (!isPlainObject(override)) return override as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export function defaultDataFor(type: SectionType): Record<string, unknown> {
  const found = DEFAULT_CONTENT.sections.find((s) => s.type === type);
  return found ? structuredClone(found.data) : {};
}

/** Pure (hook-free) section data lookup — safe in early returns. */
export function sectionData<T>(content: SiteContent, type: SectionType): T {
  const entry = content.sections.find((s) => s.type === type);
  if (!entry) return structuredClone(defaultDataFor(type)) as T;
  return deepMerge(defaultDataFor(type), entry.data) as T;
}

/** True when a maintenance schedule has been set and its moment has arrived. */
export function maintenanceScheduleDue(data: Record<string, unknown> | undefined, now = Date.now()): boolean {
  const at = Date.parse(String(data?.scheduledAt ?? ""));
  return Number.isFinite(at) && at <= now;
}

/**
 * Applies a due maintenance schedule: switches the section on and clears the
 * schedule so it fires once. Returns the same object when there is nothing to
 * do, which lets callers skip an unnecessary save.
 */
function applyMaintenanceSchedule(content: SiteContent, now = Date.now()): SiteContent {
  const index = content.sections.findIndex((s) => s.type === "maintenance");
  if (index < 0) return content;
  const section = content.sections[index];
  if (section.enabled || !maintenanceScheduleDue(section.data, now)) return content;
  const at = new Date(now).toISOString();
  const next = [...content.sections];
  next[index] = {
    ...section,
    enabled: true,
    data: { ...section.data, scheduledAt: "", startedAt: at, endedAt: "" },
  };
  return { ...content, sections: next };
}

/**
 * Maintenance outage bookkeeping. Stamps the moment the site goes offline and
 * the moment it comes back, so the dashboard can report how long an outage
 * lasted. Switching on again clears the previous window.
 */
function stampMaintenanceWindow(
  previous: SiteContent,
  next: SiteContent,
  now = new Date().toISOString(),
): SiteContent {
  const index = next.sections.findIndex((s) => s.type === "maintenance");
  if (index < 0) return next;
  const wasOn = Boolean(previous.sections.find((s) => s.type === "maintenance")?.enabled);
  const section = next.sections[index];
  if (wasOn === Boolean(section.enabled)) return next;
  const data = { ...section.data };
  if (section.enabled) {
    data.startedAt = now;
    data.endedAt = "";
  } else if (data.startedAt) {
    data.endedAt = now;
  } else {
    return next;
  }
  const sections = [...next.sections];
  sections[index] = { ...section, data };
  return { ...next, sections };
}

/**
 * `commit` stamps the outage bookkeeping (startedAt / endedAt) as it publishes,
 * so a draft rebuilt alongside it does not carry the same values. The two then
 * differ by a single field, the dashboard stays dirty, and saving asks for a
 * second click that changes nothing.
 */
function adoptMaintenanceStamp(draft: SiteContent, published: SiteContent): SiteContent {
  const from = published.sections.find((s) => s.type === "maintenance");
  const index = draft.sections.findIndex((s) => s.type === "maintenance");
  if (!from || index < 0) return draft;
  const section = draft.sections[index];
  const data = { ...section.data };
  const stamped = { ...from.data };
  if (data.startedAt === stamped.startedAt && data.endedAt === stamped.endedAt) {
    return draft;
  }
  const sections = [...draft.sections];
  sections[index] = {
    ...section,
    data: { ...data, startedAt: stamped.startedAt, endedAt: stamped.endedAt },
  };
  return { ...draft, sections };
}

function loadContent(): SiteContent {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_CONTENT);

    const parsed = JSON.parse(raw) as SiteContent;
    if (parsed?.v !== 1 || !Array.isArray(parsed.sections) || !Array.isArray(parsed.nav)) {
      return structuredClone(DEFAULT_CONTENT);
    }
    // Existing dashboards keep their order and edits; newly shipped built-in
    // sections are added without resetting saved content. Keep the rider map
    // beside the existing Gears catalog when introducing it to an older site.
    const knownIds = new Set(parsed.sections.map((s) => s.id));
    const missing = DEFAULT_CONTENT.sections
      .filter((s) => !knownIds.has(s.id))
      .map((s) => structuredClone(s));

    // Add the Gears menu entry and official starter picks to old saved sites
    // once, while respecting later edits/removals from the dashboard.
    const appliedMigrations = Array.isArray(parsed.migrations) ? parsed.migrations : [];
    const gearsNavMigration = "gears-nav-link-v1";
    const gearsPicksMigration = "gears-store-picks-v1";
    const gearItemIdsMigration = "gear-item-ids-v1";
    const riderKitNavMigration = "riderkit-nav-v1";
    const riderKitGearMigration = "riderkit-attached-gear-v1";
    const riderKitInteractionMigration = "riderkit-hover-zoom-v2";
    const riderKitImageMigration = "riderkit-reference-image-v2";
    const riderKitPointerMigration = "riderkit-dashboard-pointers-v1";
    const riderKitProductLinkMigration = "riderkit-pointer-products-v1";
    const riderKitProductPointerListMigration = "riderkit-product-pointer-list-v1";
    const riderKitLabelMigration = "riderkit-the-gear-label-v1";
    const shopPicksNavMigration = "shop-my-picks-nav-v1";
    const gearsMyPicksCopyMigration = "gears-my-picks-copy-v1";
    const riderKitIndependentProductsMigration = "riderkit-independent-products-v1";
    const phoenixGlovePhotoMigration = "phoenix-glove-photo-v1";
    const shouldMigrateGearsNav = !appliedMigrations.includes(gearsNavMigration);
    const shouldSeedGears = !appliedMigrations.includes(gearsPicksMigration);
    const shouldMigrateGearItemIds = !appliedMigrations.includes(gearItemIdsMigration);
    const shouldMigrateRiderKitNav = !appliedMigrations.includes(riderKitNavMigration);
    const shouldMigrateRiderKitGear = !appliedMigrations.includes(riderKitGearMigration);
    const shouldMigrateRiderKitInteraction = !appliedMigrations.includes(riderKitInteractionMigration);
    const shouldMigrateRiderKitImage = !appliedMigrations.includes(riderKitImageMigration);
    const shouldMigrateRiderKitPointers = !appliedMigrations.includes(riderKitPointerMigration);
    const shouldMigrateRiderKitProductLinks = !appliedMigrations.includes(riderKitProductLinkMigration);
    const shouldMigratePhoenixGlovePhoto = !appliedMigrations.includes(phoenixGlovePhotoMigration);
    const shouldMigrateRiderKitProductPointerList = !appliedMigrations.includes(riderKitProductPointerListMigration);
    const shouldMigrateRiderKitLabel = !appliedMigrations.includes(riderKitLabelMigration);
    const shouldMigrateShopPicksNav = !appliedMigrations.includes(shopPicksNavMigration);
    const shouldMigrateGearsMyPicksCopy = !appliedMigrations.includes(gearsMyPicksCopyMigration);
    const shouldMigrateRiderKitIndependentProducts = !appliedMigrations.includes(riderKitIndependentProductsMigration);
    const allSections = [...parsed.sections, ...missing];
    const riderKitSection = missing.find((section) => section.type === "riderkit");
    if (riderKitSection) {
      const addedIndex = allSections.findIndex((section) => section.id === riderKitSection.id);
      const gearsIndex = allSections.findIndex((section) => section.type === "gears");
      if (addedIndex >= 0 && gearsIndex >= 0 && addedIndex !== gearsIndex + 1) {
        const [addedRiderKit] = allSections.splice(addedIndex, 1);
        const newGearsIndex = allSections.findIndex((section) => section.type === "gears");
        allSections.splice(newGearsIndex + 1, 0, addedRiderKit);
      }
    }
    if (shouldMigrateRiderKitInteraction) {
      const riderKitIndex = allSections.findIndex((section) => section.type === "riderkit");
      if (riderKitIndex >= 0 && allSections[riderKitIndex].data.sub === "An illustrative full-body gear map. Hover or tap a highlighted zone to bring its Royal Enfield store pick to the top and open the details.") {
        allSections[riderKitIndex] = {
          ...allSections[riderKitIndex],
          data: {
            ...allSections[riderKitIndex].data,
            sub: "An illustrative full-body gear map. Hover a gear area for a subtle zoom and to bring its matching item to the top; tap to pin it and open the details.",
          },
        };
      }
    }
    const defaultRiderKit = DEFAULT_CONTENT.sections.find((section) => section.type === "riderkit");
    if ((shouldMigrateRiderKitImage || shouldMigrateRiderKitPointers || shouldMigrateRiderKitProductLinks) && defaultRiderKit) {
      const riderKitIndex = allSections.findIndex((section) => section.type === "riderkit");
      if (riderKitIndex >= 0) {
        const riderKit = allSections[riderKitIndex];
        const nextData = { ...riderKit.data };
        const defaultImage = String(defaultRiderKit.data.image ?? "");
        const currentImage = nextData.image;
        if (shouldMigrateRiderKitImage && (currentImage === "/images/rider-kit-model.png" || currentImage === undefined)) {
          nextData.image = defaultImage;
          if (!nextData.imageAlt || nextData.imageAlt === "Illustrative rider in a full-face helmet, touring jacket, gloves, riding trousers and boots") {
            nextData.imageAlt = defaultRiderKit.data.imageAlt;
          }
        }
        if (shouldMigrateRiderKitPointers && (!Array.isArray(nextData.mapPointers) || nextData.mapPointers.length === 0)) {
          nextData.mapPointers = structuredClone(defaultRiderKit.data.mapPointers);
        }
        if (shouldMigrateRiderKitProductLinks && Array.isArray(nextData.mapPointers)) {
          const defaultLinks = new Map(
            (defaultRiderKit.data.mapPointers as RiderKitPointer[]).map((pointer) => [pointer.id, pointer.gearId])
          );
          nextData.mapPointers = (nextData.mapPointers as RiderKitPointer[]).map((pointer) => ({
            ...pointer,
            gearId: pointer.gearId ?? defaultLinks.get(pointer.id),
          }));
        }
        allSections[riderKitIndex] = { ...riderKit, data: nextData };
      }
    }
    if (shouldMigrateRiderKitLabel) {
      const riderKitIndex = allSections.findIndex((section) => section.type === "riderkit");
      if (riderKitIndex >= 0 && allSections[riderKitIndex].label === "Interactive Rider Kit") {
        allSections[riderKitIndex] = { ...allSections[riderKitIndex], label: "The Gear" };
      }
    }
    const defaultGears = DEFAULT_CONTENT.sections.find((s) => s.type === "gears");
    let seededGears = false;
    if (shouldSeedGears && defaultGears) {
      const gearIndex = allSections.findIndex((s) => s.type === "gears");
      const currentGears = gearIndex >= 0 ? allSections[gearIndex] : undefined;
      const currentItems = currentGears?.data.items;
      if (gearIndex >= 0 && (!Array.isArray(currentItems) || currentItems.length === 0)) {
        allSections[gearIndex] = {
          ...currentGears!,
          enabled: true,
          data: { ...currentGears!.data, items: structuredClone(defaultGears.data.items) },
        };
        seededGears = true;
      }
    }

    // Swap in the supplied Royal Enfield product photos on older saved
    // wardrobes once. This only updates image paths on items the site already
    // has — a pick you deleted stays deleted, and no product is re-added.
    if (shouldMigrateRiderKitGear && defaultGears) {
      const gearIndex = allSections.findIndex((section) => section.type === "gears");
      const currentGears = gearIndex >= 0 ? allSections[gearIndex] : undefined;
      if (currentGears) {
        const currentItems = Array.isArray(currentGears.data.items)
          ? [...(currentGears.data.items as GearItem[])]
          : [];
        // Keys cover both the current names and the ones these picks carried
        // before the catalogue was cut down, so a wardrobe saved under an older
        // build still gets its photo. Products dropped from the catalogue are
        // gone from here too.
        const suppliedPhotos: Record<string, string> = {
          "Wanderer Waterproof Boots": "/images/gear/wanderer-waterproof-boots.webp",
          "Black Wanderer Waterproof Boots": "/images/gear/wanderer-waterproof-boots.webp",
          "Optimus Dual Sport Helmet — Black & Gold": "/images/gear/optimus-dual-sport-helmet-black-gold.webp",
          "Nirvik V2 Print Class A Riding Jacket — Black & Gold": "/images/gear/nirvik-v2-jacket-black-gold.webp",
          "Classic Sling Bag — Rose Gold": "/images/gear/classic-sling-rose-gold.webp",
          "Classic Sling Gold": "/images/gear/classic-sling-rose-gold.webp",
          "Super Meteor 650 x Sena 50S Intercom": "/images/gear/sena-50s-intercom.webp",
          "Super Meteor 650 X Sena Intercom": "/images/gear/sena-50s-intercom.webp",
          "Phoenix Gloves — Brown": "/images/gear/phoenix-gloves-brown.webp",
        };
        const nextItems = currentItems.map((item) =>
          item && suppliedPhotos[item.name] ? { ...item, image: suppliedPhotos[item.name] } : item
        );
        allSections[gearIndex] = {
          ...currentGears,
          data: { ...currentGears.data, items: nextItems },
        };
      }
    }

    // The Phoenix gloves shipped pointing at a reseller photo that has since
    // been replaced by the official Royal Enfield shot, and the old file is
    // gone from the repo. Saved wardrobes still hold the stale path, which
    // leaves the card blank. Repoint them. This carries its own migration key
    // so it also reaches browsers that already ran the earlier photo swap.
    // Matched on id as well as name, since a copy saved under an older build
    // can predate the current id.
    if (shouldMigratePhoenixGlovePhoto && defaultGears) {
      const gearIndex = allSections.findIndex((section) => section.type === "gears");
      const currentGears = gearIndex >= 0 ? allSections[gearIndex] : undefined;
      if (currentGears) {
        const currentItems = Array.isArray(currentGears.data.items)
          ? [...(currentGears.data.items as GearItem[])]
          : [];
        const nextItems = currentItems.map((item) =>
          item &&
          (item.id === "gear-phoenix-gloves-brown" ||
            (typeof item.name === "string" && item.name.trim() === "Phoenix Gloves — Brown"))
            ? { ...item, image: "/images/gear/phoenix-gloves-brown.webp" }
            : item
        );
        if (nextItems.some((item, i) => item !== currentItems[i])) {
          allSections[gearIndex] = {
            ...currentGears,
            data: { ...currentGears.data, items: nextItems },
          };
        }
      }
    }

    if (shouldMigrateGearItemIds) {
      const gearIndex = allSections.findIndex((section) => section.type === "gears");
      const gearSection = gearIndex >= 0 ? allSections[gearIndex] : undefined;
      if (gearSection && Array.isArray(gearSection.data.items)) {
        const usedIds = new Set<string>();
        const items = (gearSection.data.items as GearItem[]).map((item, index) => {
          const base = item.id?.trim() || makeGearItemId(item.name?.trim() || `item-${index + 1}`);
          let id = base;
          let suffix = 2;
          while (usedIds.has(id)) id = `${base}-${suffix++}`;
          usedIds.add(id);
          return { ...item, id };
        });
        allSections[gearIndex] = { ...gearSection, data: { ...gearSection.data, items } };
      }
    }

    // Give The Gear its own product copies once. Older sites used the wardrobe
    // catalog as the map's backing store; seed the new independent list from
    // that saved list, then leave it independent from wardrobe visibility.
    if (shouldMigrateRiderKitIndependentProducts && defaultRiderKit) {
      const riderKitIndex = allSections.findIndex((section) => section.type === "riderkit");
      const gearIndex = allSections.findIndex((section) => section.type === "gears");
      const riderKit = riderKitIndex >= 0 ? allSections[riderKitIndex] : undefined;
      const gearSection = gearIndex >= 0 ? allSections[gearIndex] : undefined;
      if (riderKit) {
        const savedMapItems = Array.isArray(riderKit.data.items) ? riderKit.data.items as GearItem[] : undefined;
        const savedPickItems = Array.isArray(gearSection?.data.items) ? gearSection.data.items as GearItem[] : undefined;
        const itemsToCopy = savedMapItems ?? savedPickItems ?? defaultRiderKit.data.items as GearItem[];
        const copyingWardrobeItems = !savedMapItems && Boolean(savedPickItems);
        const mapItems = itemsToCopy.map((item) => ({
          ...item,
          // The old section cascade marked every wardrobe child off when the
          // Wardrobe parent was disabled. That must not disable the new map copy.
          ...(copyingWardrobeItems && gearSection?.enabled === false && item.enabled === false ? { enabled: true } : {}),
          sourcePickId: item.sourcePickId ?? item.id,
          highlights: Array.isArray(item.highlights) ? [...item.highlights] : [],
        }));
        allSections[riderKitIndex] = { ...riderKit, data: { ...riderKit.data, items: mapItems } };
      }
    }

    // Previously saved gear catalogs already contain products meant for The Gear.
    // Preserve those links on the first independent-copy migration; future picks
    // are added explicitly from Shop → My Picks using the "Add to The Gear" action.
    if (shouldMigrateRiderKitProductPointerList && defaultRiderKit) {
      const riderKitIndex = allSections.findIndex((section) => section.type === "riderkit");
      const gearIndex = allSections.findIndex((section) => section.type === "gears");
      const riderKit = riderKitIndex >= 0 ? allSections[riderKitIndex] : undefined;
      const gearSection = gearIndex >= 0 ? allSections[gearIndex] : undefined;
      if (riderKit && gearSection && Array.isArray(gearSection.data.items)) {
        const pointers = Array.isArray(riderKit.data.mapPointers)
          ? [...(riderKit.data.mapPointers as RiderKitPointer[])]
          : [];
        const usedGearIds = new Set<string>();
        const gearItems = (gearSection.data.items as GearItem[]).map((item, index) => {
          const base = item.id?.trim() || makeGearItemId(item.name?.trim() || `item-${index + 1}`);
          let id = base;
          let suffix = 2;
          while (usedGearIds.has(id)) id = `${base}-${suffix++}`;
          usedGearIds.add(id);
          return item.id === id ? item : { ...item, id };
        });
        allSections[gearIndex] = { ...gearSection, data: { ...gearSection.data, items: gearItems } };
        const defaultPointers = defaultRiderKit.data.mapPointers as RiderKitPointer[];
        const defaultPointByZone: Record<RiderKitPointerZone, { x: number; y: number; radius: number }> = {
          head: { x: 50, y: 16, radius: 8 },
          torso: { x: 50, y: 40, radius: 12 },
          hands: { x: 50, y: 67, radius: 9 },
          waist: { x: 61, y: 57, radius: 8 },
          legs: { x: 50, y: 71, radius: 12 },
          feet: { x: 50, y: 91, radius: 9 },
          intercom: { x: 64, y: 17, radius: 6 },
        };
        const inferGearPointerZone = (item: GearItem): RiderKitPointerZone => {
          const text = `${item.bodyPart ?? ""} ${item.category ?? ""} ${item.name ?? ""}`.toLocaleLowerCase();
          if (/intercom|sena|communicator/.test(text)) return "intercom";
          if (/head|helmet|visor|eyewear|goggle/.test(text)) return "head";
          if (/hand|glove|wrist/.test(text)) return "hands";
          if (/foot|feet|boot|shoe/.test(text)) return "feet";
          if (/waist|hip|sling|cross.?body|bag/.test(text)) return "waist";
          if (/leg|trouser|pant|knee/.test(text)) return "legs";
          return "torso";
        };
        const linkedIds = new Set(pointers.map((pointer) => pointer.gearId).filter((id): id is string => Boolean(id)));
        for (const item of gearItems) {
          const gearId = item.id?.trim();
          if (!gearId || linkedIds.has(gearId)) continue;
          const defaultPointer = defaultPointers.find((pointer) => pointer.gearId === gearId);
          const matchingPointerIndex = defaultPointer ? pointers.findIndex((pointer) => pointer.id === defaultPointer.id && !pointer.gearId) : -1;
          if (matchingPointerIndex >= 0 && defaultPointer) {
            pointers[matchingPointerIndex] = { ...pointers[matchingPointerIndex], gearId, zone: defaultPointer.zone };
          } else if (defaultPointer && !pointers.some((pointer) => pointer.id === defaultPointer.id)) {
            pointers.push(structuredClone(defaultPointer));
          } else {
            const zone = inferGearPointerZone(item);
            const sameZoneCount = pointers.filter((pointer) => pointer.zone === zone).length;
            const basePoint = defaultPointByZone[zone];
            const offset = ((sameZoneCount % 3) - 1) * 7;
            const id = `product-${gearId}`;
            pointers.push({
              enabled: item.enabled !== false,
              id,
              label: item.name?.trim() || "Riding gear",
              gearId,
              zone,
              x: Math.max(4, Math.min(96, basePoint.x + offset)),
              y: Math.max(4, Math.min(96, basePoint.y + Math.floor(sameZoneCount / 3) * 5)),
              radius: basePoint.radius,
            });
          }
          linkedIds.add(gearId);
        }
        allSections[riderKitIndex] = { ...riderKit, data: { ...riderKit.data, mapPointers: pointers } };
      }
    }

    if (shouldMigrateGearsMyPicksCopy) {
      const gearIndex = allSections.findIndex((section) => section.type === "gears");
      if (gearIndex >= 0) {
        const gearSection = allSections[gearIndex];
        const nextData = { ...gearSection.data };
        if (nextData.eyebrow === "Official store picks") nextData.eyebrow = GEARS.eyebrow;
        if (nextData.titleA === "Riding gear from " && nextData.titleHi === "Royal Enfield.") {
          nextData.titleA = GEARS.titleA;
          nextData.titleHi = GEARS.titleHi;
        }
        if (nextData.sub === "A starter edit from the official Royal Enfield Store. Prices and availability can change; open a product page for current details and sizing.") {
          nextData.sub = GEARS.sub;
        }
        if (nextData.emptyText === "Add an item from the dashboard to start this collection.") {
          nextData.emptyText = GEARS.emptyText;
        }
        allSections[gearIndex] = { ...gearSection, data: nextData };
      }
    }

    const hasGearsNav = parsed.nav.some((n) => n.id === "nav-gears");
    const gearsNav = DEFAULT_CONTENT.nav.find((n) => n.id === "nav-gears");
    const hasRiderKitNav = parsed.nav.some((n) => n.id === "nav-riderkit");
    const riderKitNav = DEFAULT_CONTENT.nav.find((n) => n.id === "nav-riderkit");
    const hasShopNav = parsed.nav.some((n) => n.id === "nav-shop");
    const shopNav = DEFAULT_CONTENT.nav.find((n) => n.id === "nav-shop");
    let migratedNav =
      shouldMigrateGearsNav && !hasGearsNav && gearsNav
        ? [...parsed.nav, structuredClone(gearsNav)]
        : parsed.nav;
    if (shouldMigrateRiderKitNav && !hasRiderKitNav && riderKitNav) {
      const gearNavIndex = migratedNav.findIndex((item) => item.id === "nav-gears");
      const insertAt = gearNavIndex >= 0 ? gearNavIndex + 1 : migratedNav.length;
      migratedNav = [
        ...migratedNav.slice(0, insertAt),
        structuredClone(riderKitNav),
        ...migratedNav.slice(insertAt),
      ];
    }
    if (shouldMigrateShopPicksNav && !hasShopNav && shopNav) {
      const gearNavIndex = migratedNav.findIndex((item) => item.id === "nav-gears");
      const riderKitNavIndex = migratedNav.findIndex((item) => item.id === "nav-riderkit");
      const insertAt = gearNavIndex >= 0
        ? gearNavIndex + 1
        : riderKitNavIndex >= 0
          ? riderKitNavIndex
          : migratedNav.length;
      migratedNav = [
        ...migratedNav.slice(0, insertAt),
        structuredClone(shopNav),
        ...migratedNav.slice(insertAt),
      ];
    } else if (shouldMigrateShopPicksNav && hasShopNav) {
      migratedNav = migratedNav.map((item) =>
        item.id === "nav-shop" && item.label.trim().toLocaleLowerCase() === "official store picks"
          ? { ...item, label: "My Picks", href: "#/shop" }
          : item
      );
    }
    if (seededGears) {
      migratedNav = migratedNav.map((n) =>
        n.id === "nav-gears" ? { ...n, enabled: true } : n
      );
    }
    const migrations = [
      ...appliedMigrations,
      ...(shouldMigrateGearsNav ? [gearsNavMigration] : []),
      ...(shouldSeedGears ? [gearsPicksMigration] : []),
      ...(shouldMigrateGearItemIds ? [gearItemIdsMigration] : []),
      ...(shouldMigrateRiderKitNav ? [riderKitNavMigration] : []),
      ...(shouldMigrateRiderKitGear ? [riderKitGearMigration] : []),
      ...(shouldMigrateRiderKitInteraction ? [riderKitInteractionMigration] : []),
      ...(shouldMigrateRiderKitImage ? [riderKitImageMigration] : []),
      ...(shouldMigrateRiderKitPointers ? [riderKitPointerMigration] : []),
      ...(shouldMigrateRiderKitProductLinks ? [riderKitProductLinkMigration] : []),
      ...(shouldMigrateRiderKitProductPointerList ? [riderKitProductPointerListMigration] : []),
      ...(shouldMigrateRiderKitLabel ? [riderKitLabelMigration] : []),
      ...(shouldMigrateShopPicksNav ? [shopPicksNavMigration] : []),
      ...(shouldMigrateGearsMyPicksCopy ? [gearsMyPicksCopyMigration] : []),
      ...(shouldMigrateRiderKitIndependentProducts ? [riderKitIndependentProductsMigration] : []),
      ...(shouldMigratePhoenixGlovePhoto ? [phoenixGlovePhotoMigration] : []),
    ];

    // A schedule whose moment has passed switches maintenance on before the
    // first paint, so the site never flashes live content and then go offline.
    const normalized = normalizeLoaded({
      ...parsed,
      migrations,
      sections: allSections,
      nav: migratedNav,
    });
    const scheduled = applyMaintenanceSchedule(normalized);
    if (scheduled !== normalized) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scheduled));
      } catch {
        /* The switch still applies for this visit even if it cannot be saved. */
      }
    }
    return scheduled;
  } catch {
    return structuredClone(DEFAULT_CONTENT);
  }
}

function loadRevisions(): Revision[] {
  try {
    const raw = localStorage.getItem(REVISIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Revision[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function withSettingsDefaults(value: SiteContent): SiteContent {
  const { loaderLogo, loaderAnimation, brand, footer, headerButtons, themeColors, ...page } = value;
  return {
    ...page,
    loaderLogo: loaderLogo ?? "",
    loaderAnimation: resolveLoaderAnimation(loaderAnimation),
    brand: resolveBrand(brand),
    footer: resolveFooter(footer),
    headerButtons: resolveHeaderButtons(headerButtons),
    themeColors: resolveThemeColors(themeColors),
  };
}

function sameContent(a: SiteContent, b: SiteContent): boolean {
  return JSON.stringify(withSettingsDefaults(a)) === JSON.stringify(withSettingsDefaults(b));
}

/* ═══════════════════════ Context ═══════════════════════ */

interface SiteContextValue {
  content: SiteContent; // The published/front-facing content
  draft: SiteContent;   // The working draft content modified inside admin
  loaderDraft: string;
  setLoaderDraft: (v: string) => void;
  brandDraft: BrandSettings;
  setBrandDraft: (patch: Partial<BrandSettings>) => void;
  updateDraft: (fn: (c: SiteContent) => SiteContent) => void;
  saveDraft: (description?: string) => boolean;
  saveBranding: (description?: string) => boolean;
  discardBranding: () => void;
  hasBrandChanges: boolean;
  saveError: string | null;
  discardDraft: () => void;
  hasChanges: boolean;
  editedActions: string[];
  logAction: (action: string) => void;
  revisions: Revision[];
  restoreRevision: (rev: Revision) => void;
  deleteRevision: (id: string) => void;
  resetContent: () => void;
  restoreScope: (scope: RestoreScope) => void;
  /** Resize one section's frame on the live site. Layout saves immediately. */
  setSectionLayout: (
    id: string,
    label: string,
    patch: Partial<NonNullable<SectionEntry["layout"]>>
  ) => boolean;
  /** Reorder sections from the live site. */
  moveSection: (id: string, label: string, direction: -1 | 1) => void;
  /** Show or hide one section from the live site (honours parent/child cascade). */
  setSectionEnabled: (id: string, label: string, enabled: boolean) => void;
  /** Edit a single field on a section from the live site. */
  updateSectionField: (id: string, label: string, path: string, value: unknown) => void;
  /** Toggle one child item (stat, destination, plan, FAQ entry...) from the live site. */
  toggleSectionChild: (
    id: string,
    label: string,
    key: string,
    index: number,
    enabled: boolean
  ) => void;
  /** Reorder/resize sub-sections contained within the Machine section. */
  setMachineSubsectionLayout: (layout: MachineSubsectionLayout, description: string) => boolean;
  /** Persist the one-way completion of a published countdown. */
  completeCountdown: (targetDate: string) => boolean;
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Frontend preview mode: when true, admin resizers are hidden so admin sees site as a normal user. */
  previewAsVisitor: boolean;
  setPreviewAsVisitor: (v: boolean | ((prev: boolean) => boolean)) => void;
}

const SiteContext = createContext<SiteContextValue | null>(null);

export function SiteProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<SiteContent>(loadContent);
  const [draft, setDraft] = useState<SiteContent>(() => structuredClone(content));
  const [revisions, setRevisions] = useState<Revision[]>(loadRevisions);
  const [editedActions, setEditedActions] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewAsVisitor, setPreviewAsVisitor] = useState(false);
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return stored === "light" || stored === "dark" ? stored : "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // The theme can still change when browser storage is unavailable.
    }
  }, [theme]);

  // Theme colours: the saved palette for the active mode drives every token.
  const activeTokens = useMemo(
    () => resolveThemeColors(content.themeColors)[theme],
    [content.themeColors, theme]
  );
  useEffect(() => {
    const root = document.documentElement;
    (Object.keys(THEME_TOKEN_VARS) as (keyof ThemeTokens)[]).forEach((key) => {
      root.style.setProperty(THEME_TOKEN_VARS[key], activeTokens[key]);
    });
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", activeTokens.background);
  }, [activeTokens]);

  // Settings are part of the same draft as sections, not detached editor state.
  const brandDraft = useMemo(() => resolveBrand(draft.brand), [draft.brand]);
  const loaderDraft = draft.loaderLogo ?? "";
  const hasBrandChanges = useMemo(
    () => {
      const savedBrand = resolveBrand(content.brand);
      return (Object.keys(DEFAULT_BRAND) as (keyof BrandSettings)[])
        .some((key) => brandDraft[key] !== savedBrand[key]);
    },
    [brandDraft, content.brand]
  );
  // Colour-picker input should not reserialize every section's uploaded images.
  const hasPageChanges = useMemo(() =>
    draft.v !== content.v ||
    JSON.stringify(draft.nav) !== JSON.stringify(content.nav) ||
    JSON.stringify(draft.sections) !== JSON.stringify(content.sections),
  [draft.v, draft.nav, draft.sections, content.v, content.nav, content.sections]);
  const hasFooterChanges = useMemo(() =>
    JSON.stringify(resolveFooter(draft.footer)) !== JSON.stringify(resolveFooter(content.footer)),
  [draft.footer, content.footer]);
  const hasSettingsChanges = useMemo(() =>
    JSON.stringify([
      resolveHeaderButtons(draft.headerButtons),
      resolveThemeColors(draft.themeColors),
      resolveLoaderAnimation(draft.loaderAnimation),
    ]) !==
    JSON.stringify([
      resolveHeaderButtons(content.headerButtons),
      resolveThemeColors(content.themeColors),
      resolveLoaderAnimation(content.loaderAnimation),
    ]),
  [draft.headerButtons, draft.themeColors, draft.loaderAnimation,
   content.headerButtons, content.themeColors, content.loaderAnimation]);
  const hasChanges =
    hasPageChanges || hasBrandChanges || hasFooterChanges || hasSettingsChanges || loaderDraft !== (content.loaderLogo ?? "");

  useEffect(() => {
    const syncSavedContent = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        const next = loadContent();
        setContent(next);
        // Refresh another open site tab without overwriting an admin's draft.
        setDraft((prev) => sameContent(prev, content) ? structuredClone(next) : prev);
      }
      if (event.key === REVISIONS_KEY || event.key === null) {
        setRevisions(loadRevisions());
      }
    };
    window.addEventListener("storage", syncSavedContent);
    return () => window.removeEventListener("storage", syncSavedContent);
  }, [content]);

  const logAction = useCallback((action: string) => {
    setEditedActions((prev) => {
      if (prev.includes(action)) return prev;
      return [...prev, action];
    });
  }, []);

  const updateDraft = useCallback((fn: (c: SiteContent) => SiteContent) => {
    // Parent/child rules run on every write, so no edit path can leave a child
    // on under a switched-off parent.
    setDraft((prev) => liftAll(fn(prev)));
    setSaveError(null);
  }, []);

  const commit = useCallback((
    nextContent: SiteContent,
    description: string,
  ): SiteContent | null => {
    let next: SiteContent;
    let nextRevisions: Revision[];
    try {
      next = structuredClone(withSettingsDefaults(stampMaintenanceWindow(content, nextContent)));
      const timestamp = new Date().toISOString();
      const id = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const previousRevisions = revisions.length ? revisions : [{
        id: `${id}-before`,
        timestamp,
        description: "Before first save",
        content: structuredClone(withSettingsDefaults(content)),
      }];

      // Full snapshots include uploaded images. Keep as many revisions as fit
      // comfortably in browser storage rather than duplicating large data URLs
      // fifteen times and freezing the tab on every resize release.
      const contentJson = JSON.stringify(next);
      const snapshotBudget = 2_000_000;
      const maxRevisions = Math.max(
        1,
        Math.min(15, Math.floor((snapshotBudget - contentJson.length) / (contentJson.length + 200)))
      );
      nextRevisions = [{ id, timestamp, description, content: next }, ...previousRevisions]
        .slice(0, maxRevisions);

      const previousHistory = localStorage.getItem(REVISIONS_KEY);
      for (;;) {
        try {
          localStorage.setItem(REVISIONS_KEY, JSON.stringify(nextRevisions));
          localStorage.setItem(STORAGE_KEY, contentJson);
          break;
        } catch (error) {
          // If storage is tight, retry with fewer *old* revisions. Never drop
          // the new revision or silently publish a site without a history.
          try {
            if (previousHistory === null) localStorage.removeItem(REVISIONS_KEY);
            else localStorage.setItem(REVISIONS_KEY, previousHistory);
          } catch {
            // The draft remains intact even if the browser won't restore history.
          }
          if (nextRevisions.length <= 1) throw error;
          nextRevisions = nextRevisions.slice(0, Math.max(1, Math.floor(nextRevisions.length / 2)));
        }
      }
    } catch {
      setSaveError("Could not save to this browser. Storage may be full or blocked. Your draft is intact; try a smaller logo or export a backup from Settings.");
      return null;
    }

    setContent(next);
    setRevisions(nextRevisions);
    setSaveError(null);
    return next;
  }, [content, revisions]);

  const saveDraft = useCallback((description = "Manual save") => {
    if (!hasChanges) return true;
    const publishedContent = commit(draft, description);
    if (!publishedContent) return false;
    // Sync from what was published rather than from the draft: commit stamps
    // the maintenance outage window as it saves, so rebuilding from the draft
    // leaves one field different and the dashboard asks for a second save.
    setDraft(structuredClone(publishedContent));
    setEditedActions([]);
    return true;
  }, [commit, draft, hasChanges]);

  const saveBranding = useCallback((description = "Updated logo & branding") => {
    if (!hasBrandChanges && !hasChanges) return true;
    const publishedContent = commit(draft, description);
    if (!publishedContent) return false;
    setDraft(structuredClone(publishedContent));
    setEditedActions([]);
    return true;
  }, [commit, draft, hasBrandChanges, hasChanges]);

  const discardBranding = useCallback(() => {
    setDraft((prev) => ({ ...prev, brand: resolveBrand(content.brand) }));
    setEditedActions((prev) => prev.filter((action) => action !== "Updated logo & branding"));
    setSaveError(null);
  }, [content.brand]);

  const discardDraft = useCallback(() => {
    setDraft(structuredClone(content));
    setEditedActions([]);
    setSaveError(null);
  }, [content]);

  const restoreRevision = useCallback((rev: Revision) => {
    const cloned = structuredClone(withSettingsDefaults(rev.content));
    const publishedContent = commit(cloned, `Restored: ${rev.description}`);
    if (!publishedContent) return;
    setDraft(structuredClone(publishedContent));
    setEditedActions([]);
  }, [commit]);

  const deleteRevision = useCallback((id: string) => {
    const next = revisions.filter((r) => r.id !== id);
    try {
      localStorage.setItem(REVISIONS_KEY, JSON.stringify(next));
      setRevisions(next);
      setSaveError(null);
    } catch {
      setSaveError("Could not update revision history. Check your browser storage settings.");
    }
  }, [revisions]);

  const resetContent = useCallback(() => {
    const defaults = structuredClone(withSettingsDefaults(DEFAULT_CONTENT));
    const publishedContent = commit(defaults, "Reset website to original defaults");
    if (!publishedContent) return;
    setDraft(structuredClone(publishedContent));
    setEditedActions([]);
  }, [commit]);

  const patchBrand = useCallback((patch: Partial<BrandSettings>) => {
    updateDraft((prev) => ({ ...prev, brand: { ...resolveBrand(prev.brand), ...patch } }));
    logAction("Updated logo & branding");
  }, [logAction, updateDraft]);

  const setLoaderDraft = useCallback((logo: string) => {
    updateDraft((prev) => ({ ...prev, loaderLogo: logo }));
    logAction("Updated loader icon");
  }, [logAction, updateDraft]);

  /** Restores one settings group to its original defaults. Goes into the draft. */
  const restoreScope = useCallback(
    (scope: RestoreScope) => {
      const label = scope === "header" ? "header navigation" : scope === "footer" ? "footer" : "theme colours";
      logAction(`Restored ${label} to defaults`);
      updateDraft((c) => {
        if (scope === "header") {
          return {
            ...c,
            nav: structuredClone(DEFAULT_CONTENT.nav),
            headerButtons: structuredClone(DEFAULT_HEADER_BUTTONS),
          };
        }
        if (scope === "footer") return { ...c, footer: structuredClone(DEFAULT_FOOTER) };
        return { ...c, themeColors: structuredClone(DEFAULT_THEME_COLORS) };
      });
    },
    [logAction, updateDraft]
  );

  // Frame sizes publish immediately (one revision per resize). Only the frame is
  // written to the draft, so unpublished section edits are left alone.
  /** Resize any section's frame from the live site. Layout saves immediately. */
  const setSectionLayout = useCallback(
    (id: string, label: string, patch: Partial<NonNullable<SectionEntry["layout"]>>) => {
      const existing = content.sections.find((s) => s.id === id)?.layout ?? {};
      const next: NonNullable<SectionEntry["layout"]> = {};
      const keys = ["height", "marginTop", "marginBottom", "marginLeft", "marginRight"] as const;
      // An empty patch is the toolbar's "reset to auto": it clears the saved
      // geometry instead of falling back to it.
      const isReset = Object.keys(patch).length === 0;
      if (!isReset) {
        keys.forEach((key) => {
          const value = patch[key] ?? existing[key];
          if (typeof value === "number" && value > 0) next[key] = value;
        });
      }
      const apply = (c: SiteContent): SiteContent => ({
        ...c,
        sections: c.sections.map((s) => (s.id === id ? { ...s, layout: next } : s)),
      });
      const description =
        Object.keys(patch).length > 0
          ? `Resized ${label} on the live site`
          : `Reset size of ${label} to auto`;
      if (!commit(apply(content), description)) return false;
      setDraft((prev) => apply(prev));
      return true;
    },
    [commit, content]
  );

  /** Reorder a section from the live customizer and publish that action immediately. */
  const moveSection = useCallback(
    (id: string, label: string, direction: -1 | 1) => {
      const reorder = (c: SiteContent) => {
        const sections = [...c.sections];
        const from = sections.findIndex((s) => s.id === id);
        if (from < 0) return c;
        // Step over entries visitors never see (switched-off sections, and the
        // countdown/maintenance switches parked at the top of the list). A
        // straight neighbour swap silently did nothing whenever the adjacent
        // entry was hidden.
        let to = from + direction;
        while (to >= 0 && to < sections.length && !sections[to].enabled) to += direction;
        if (to < 0 || to >= sections.length) return c;
        const [moved] = sections.splice(from, 1);
        sections.splice(to, 0, moved);
        return { ...c, sections };
      };
      const nextContent = reorder(content);
      if (nextContent === content) return;
      if (!commit(nextContent, `Moved section ${direction < 0 ? "up" : "down"}: ${label}`)) return;
      // Preserve unrelated unpublished edits already in the dashboard draft.
      setDraft((prev) => reorder(prev));
      logAction(`Reordered position of: ${label}`);
    },
    [commit, content, logAction]
  );

  /** Show or hide one section from the live customizer immediately, honouring the parent/child cascade. */
  const setSectionEnabled = useCallback(
    (id: string, label: string, enabled: boolean) => {
      const applyVisibility = (c: SiteContent) => cascadeSection(c, id, enabled);
      const nextContent = applyVisibility(content);
      const publishedContent = commit(nextContent, `${enabled ? "Enabled" : "Disabled"} section: ${label}`);
      if (!publishedContent) return;
      // Keep pending dashboard edits intact while syncing the same visibility
      // action, then take the published outage stamp — toggling maintenance is
      // exactly the case where commit adds a field of its own.
      setDraft((prev) => adoptMaintenanceStamp(applyVisibility(prev), publishedContent));
      logAction(`${enabled ? "Enabled" : "Disabled"}: ${label}`);
    },
    [commit, content, logAction]
  );

  /** Edit one section field from the live site, mirroring the dashboard editor. */
  const updateSectionField = useCallback(
    (id: string, label: string, path: string, value: unknown) => {
      const s = content.sections.find((x) => x.id === id);
      if (!s) return;
      const nextData = setAt(s.data, path, value);
      if (JSON.stringify(nextData) === JSON.stringify(s.data)) return;
      logAction(`Edited content of: ${label}`);
      const saved = content.sections.find((x) => x.id === id);
      const changedFromSaved =
        s.label !== saved?.label ||
        JSON.stringify(nextData) !== JSON.stringify(saved?.data ?? defaultDataFor(s.type));
      updateDraft((c) => {
        const sections = c.sections.map((entry) => {
          if (entry.id !== id) return entry;
          if (entry.type === "countdown") {
            return {
              ...entry,
              enabled: changedFromSaved ? true : Boolean(saved?.enabled),
              data: nextData,
            };
          }
          return { ...entry, data: nextData };
        });
        const current = sections.find((x) => x.id === id);
        const next = current?.enabled ? { ...c, sections } : cascadeSection({ ...c, sections }, id, true);
        return next;
      });
    },
    [content, logAction, updateDraft]
  );

  /**
   * Persist layout only inside The Machine. That keeps its internal modules
   * constrained to that section and preserves all other unsaved drafts.
   */
  const setMachineSubsectionLayout = useCallback(
    (layout: MachineSubsectionLayout, description: string) => {
      const current = content.sections.find((s) => s.type === "machine")?.data.subsectionLayout;
      if (JSON.stringify(current) === JSON.stringify(layout)) return true;
      const apply = (c: SiteContent): SiteContent => ({
        ...c,
        sections: c.sections.map((s) =>
          s.type === "machine"
            ? { ...s, data: { ...s.data, subsectionLayout: structuredClone(layout) } }
            : s
        ),
      });
      if (!commit(apply(content), description)) return false;
      setDraft((prev) => apply(prev));
      return true;
    },
    [commit, content]
  );

  /**
   * Countdown completion is a published state transition, not a draft edit:
   * turn its toggle off, clear the selected checkboxes and turn the selected
   * sections on. Persisting it means a later dashboard refresh stays correct.
   */
  const completeCountdown = useCallback(
    (targetDate: string) => {
      const countdown = content.sections.find((s) => s.type === "countdown");
      if (!countdown?.enabled || String(countdown.data.targetDate ?? "") !== targetDate) return true;
      // A caller's stale completion flag must never turn a newly saved future
      // countdown off or reveal its targets early. Only the real deadline wins.
      if (!hasCountdownExpired(targetDate)) return false;
      const revealIds = Array.isArray(countdown.data.revealSectionIds)
        ? (countdown.data.revealSectionIds as string[])
        : [];
      const next: SiteContent = {
        ...content,
        sections: content.sections.map((s) => {
          if (s.type === "countdown") {
            return { ...s, enabled: false, data: { ...s.data, revealSectionIds: [] } };
          }
          return revealIds.includes(s.id)
            ? { ...s, enabled: true, data: withChildrenOn(s) }
            : s;
        }),
      };
      const publishedContent = commit(next, "Countdown finished — disabled and reset checkmarks");
      if (!publishedContent) return false;
      setDraft(structuredClone(publishedContent));
      setEditedActions([]);
      return true;
    },
    [commit, content]
  );

  // A schedule can come due while the site is already open. Re-check on a slow
  // tick and let the switch in through the normal save path, so it lands in
  // revision history exactly like a manual toggle would.
  useEffect(() => {
    const check = () => {
      const maintenance = content.sections.find((section) => section.type === "maintenance");
      if (!maintenance || maintenance.enabled) return;
      if (!maintenanceScheduleDue(maintenance.data)) return;
      // Never clobber dashboard edits that have not been saved yet.
      if (hasChanges) return;
      const next = applyMaintenanceSchedule(content);
      if (next === content) return;
      const publishedContent = commit(next, "Scheduled maintenance switched on");
      if (!publishedContent) return;
      setDraft(structuredClone(publishedContent));
    };
    check();
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, [commit, content, hasChanges]);

  /** Child toggles from the live editor: hidden while its parent is switched off. */
  const toggleSectionChild = useCallback(
    (id: string, label: string, key: string, index: number, enabled: boolean) => {
      logAction(`${enabled ? "Enabled" : "Disabled"} item #${index + 1} in ${label}`);
      updateDraft((c) => {
        const next = cascadeChild(c, id, key, index, enabled);
        const section = next.sections.find((s) => s.id === id);
        if (!section?.enabled) return cascadeSection(next, id, true);
        return next;
      });
    },
    [logAction, updateDraft]
  );

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);

  return (
    <SiteContext.Provider
      value={{
        content,
        draft,
        loaderDraft,
        setLoaderDraft,
        brandDraft,
        setBrandDraft: patchBrand,
        updateDraft,
        saveDraft,
        saveBranding,
        discardBranding,
        hasBrandChanges,
        saveError,
        discardDraft,
        hasChanges,
        editedActions: editedActions.filter((action) =>
          action === "Updated logo & branding" ? hasBrandChanges
            : action === "Updated loader icon" ? loaderDraft !== (content.loaderLogo ?? "")
              : true
        ),
        logAction,
        revisions,
        restoreRevision,
        deleteRevision,
        resetContent,
        restoreScope,
        setSectionLayout,
        moveSection,
        setSectionEnabled,
        updateSectionField,
        toggleSectionChild,
        setMachineSubsectionLayout,
        completeCountdown,
        theme,
        setTheme,
        previewAsVisitor,
        setPreviewAsVisitor,
      }}
    >
      {children}
    </SiteContext.Provider>
  );
}

/** True while the admin is signed in on this browser. Same key the dashboard login uses. */
export function isAdminSession(): boolean {
  try {
    return localStorage.getItem("pb_admin_session") === "1";
  } catch {
    return false;
  }
}

export function useSite(): SiteContextValue {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error("useSite must be used inside <SiteProvider>");
  return ctx;
}

/** Merged (default + saved override) data for a section type. */
export function useSectionData<T>(type: SectionType): T {
  const { content } = useSite();
  const entry = content.sections.find((s) => s.type === type);
  if (!entry) return structuredClone(defaultDataFor(type)) as T;
  return deepMerge(defaultDataFor(type), entry.data) as T;
}
