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
  /** Must match a social icon label: YouTube, Instagram, X (Twitter), Facebook */
  label: string;
  href: string;
  enabled: boolean;
}
export interface FooterSettings {
  /** Whole footer section on/off. */
  enabled: boolean;
  description: string;
  columns: FooterColumn[];
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

/* ── Theme colours: one palette for dark mode, one for light mode ── */
export interface ThemeTokens {
  background: string;
  surface: string;
  panel: string;
  heading: string;
  body: string;
  gold: string;
  goldSoft: string;
  warm: string;
  cool: string;
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
    warm: "#e8a200",
    cool: "#9c7414",
  },
  light: {
    background: "#f7f4ed",
    surface: "#efeae0",
    panel: "#e7e1d4",
    heading: "#171513",
    body: "#3a342b",
    gold: "#f5b301",
    goldSoft: "#ffdf8a",
    warm: "#e8a200",
    cool: "#9c7414",
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
  warm: "--color-flame-500",
  cool: "--color-orchid-500",
};

export function resolveThemeColors(tc?: Partial<ThemeColors>): ThemeColors {
  const light = { ...DEFAULT_THEME_COLORS.light, ...(tc?.light ?? {}) };
  // Upgrade previous default brown accents without resetting custom palettes.
  const previousDefaults = {
    gold: "#b07c00",
    goldSoft: "#8a6000",
    warm: "#8a6000",
    cool: "#6d5312",
  };
  (Object.keys(previousDefaults) as (keyof typeof previousDefaults)[]).forEach((key) => {
    if (light[key]?.toLowerCase() === previousDefaults[key]) {
      light[key] = DEFAULT_THEME_COLORS.light[key];
    }
  });
  return {
    dark: { ...DEFAULT_THEME_COLORS.dark, ...(tc?.dark ?? {}) },
    light,
  };
}

export interface SiteContent {
  v: 1;
  nav: NavItem[];
  sections: SectionEntry[];
  /** Optional custom loader icon (data URL or /media path). */
  loaderLogo?: string;
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
export interface MachineData {
  eyebrow: string;
  titleA: string;
  titleHi: string;
  titleB: string;
  sub: string;
  mainImage: string;
  mainImageAlt: string;
  km: number;
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
  /** ISO datetime; blank = no countdown shown. */
  expectedBack: string;
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
    "https://images.pexels.com/photos/17033846/pexels-photo-17033846.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
  cardAImage:
    "https://images.pexels.com/photos/12950219/pexels-photo-12950219.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
  cardBImage:
    "https://images.pexels.com/photos/20988783/pexels-photo-20988783.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
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
    { name: "Ladakh", state: "Jammu & Kashmir", tagline: "The Land of High Passes", description: "Eleven passes above 16,000 ft, Pangong turning gold at dawn, and mornings that smell of butter tea and diesel. Ladakh isn't a trip — it's a rite of passage. Full GPX, permit checklist and fuel strategy included.", image: "https://images.pexels.com/photos/39977289/pexels-photo-39977289.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", distance: "2,150 km", days: "12 days", season: "Jun – Sep", vibe: "High-altitude madness" },
    { name: "Nubra Valley", state: "Ladakh", tagline: "The Cold Desert", description: "Sand dunes wedged between snow peaks, double-humped camels at Hunder, and Turtuk — a Baltistan village India opened to the world only in 2010. The detour most riders skip, and never forget.", image: "https://images.pexels.com/photos/38087449/pexels-photo-38087449.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", distance: "480 km", days: "4 days", season: "Jun – Sep", vibe: "Otherworldly" },
    { name: "Spiti Valley", state: "Himachal Pradesh", tagline: "The Middle Land", description: "Raw, lunar, and humbling. Key Monastery at sunrise, Chandra Tal under the Milky Way, and the world's highest villages where time moves at 0.5x. My most requested route — mapped to the last kilometre.", image: "https://images.pexels.com/photos/5202009/pexels-photo-5202009.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", distance: "1,320 km", days: "9 days", season: "May – Oct", vibe: "Raw & spiritual" },
    { name: "Rajasthan", state: "The Desert Crown", tagline: "Forts, Dunes & Fury", description: "Amber Fort at golden hour, Jaisalmer's dunes under a full moon, and Udaipur's lakes at dusk. A 2,400 km loop through living palaces, thorn forests and the loudest thalis in India.", image: "https://images.pexels.com/photos/18881277/pexels-photo-18881277.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", distance: "2,400 km", days: "10 days", season: "Oct – Feb", vibe: "Royal & loud" },
    { name: "Varanasi", state: "Uttar Pradesh", tagline: "The Eternal City", description: "The oldest living city on earth doesn't photograph — it swallows you. Dawn boats on the Ganga, the thunder of the evening aarti, and kachori-sabzi breakfasts in lanes older than empires.", image: "https://images.pexels.com/photos/19272052/pexels-photo-19272052.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", distance: "620 km", days: "3 days", season: "Oct – Mar", vibe: "Intense & timeless" },
    { name: "Meghalaya", state: "Northeast India", tagline: "The Abode of Clouds", description: "Nohkalikai plunging 1,115 ft, living root bridges grown over 500 years, and Mawlynnong — Asia's cleanest village. India's wettest, greenest, most surprising corner, packed into one epic loop.", image: "https://images.pexels.com/photos/12233686/pexels-photo-12233686.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", distance: "1,180 km", days: "8 days", season: "Oct – Apr", vibe: "Lush & wild" },
    { name: "Kerala", state: "God's Own Country", tagline: "Slow Roads & Stiller Waters", description: "Houseboats drifting through Alappuzha, Munnar's tea carpeting every hill, and Fort Kochi's Chinese fishing nets at sunset. The antidote to burnout — best absorbed at 40 kmph, windows down.", image: "https://images.pexels.com/photos/12950219/pexels-photo-12950219.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", distance: "940 km", days: "7 days", season: "Sep – Mar", vibe: "Slow & green" },
    { name: "Goa", state: "The Coastal Pulse", tagline: "Beyond the Beach Shacks", description: "Everyone knows Baga. Almost nobody finds Kakolem. My Goa route trades crowds for hidden coves, spice-farm trails, Divar island ferry hops and the Saturday night market at Arpora.", image: "https://images.pexels.com/photos/39182453/pexels-photo-39182453.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", distance: "560 km", days: "5 days", season: "Nov – Feb", vibe: "Salty & free" },
  ],
};

const MACHINE: MachineData = {
  eyebrow: "The machine",
  titleA: "Meet ",
  titleHi: "طویل",
  titleB: " (Taweel) — Himalayan 450, Hanle Black.",
  sub: "32,000 km together across 19 states. One seized chain, zero regrets. Tap the + markers to highlight each accessory.",
  mainImage:
    "https://images.pexels.com/photos/27539736/pexels-photo-27539736.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
  mainImageAlt: "طویل (Taweel) — PB's Royal Enfield Himalayan 450 in Hanle Black, parked in the mountains",
  km: 32000,
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
    { src: "https://images.pexels.com/photos/33212453/pexels-photo-33212453.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", alt: "PB riding طویل (Taweel) on a Himalayan mountain road in Uttarakhand", cap: "Pithoragarh climb · 7,200 ft" },
    { src: "https://images.pexels.com/photos/37454960/pexels-photo-37454960.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", alt: "طویل (Taweel) parked before a Himalayan glacier backdrop", cap: "Glacier run · Day 9" },
    { src: "https://images.pexels.com/photos/39264485/pexels-photo-39264485.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200", alt: "Close-up of Taweel's TripperDash console and gauges", cap: "TripperDash · full-map nav" },
  ],
  hotspots: [
    {
      title: "Sherpa 450 engine",
      desc: "Royal Enfield's first liquid-cooled DOHC single. 452cc, 40.02 PS, 40 Nm — pulls cleanly above 12,000 ft where the old air-cooled lump used to gasp.",
      price: "OEM · ₹2,85,000 (bike)",
      image: "https://images.pexels.com/photos/39264485/pexels-photo-39264485.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
      link: "https://www.royalenfield.com/in/en/motorcycles/himalayan/",
      x: 42,
      y: 68,
    },
    {
      title: "TripperDash TFT",
      desc: '4" round TFT with Google Maps, music and calls mirrored from the phone. Readable even in Ladakhi noon glare.',
      price: "OEM · included",
      image: "https://images.pexels.com/photos/39264485/pexels-photo-39264485.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
      link: "https://www.royalenfield.com/in/en/motorcycles/himalayan/",
      x: 64,
      y: 26,
    },
    {
      title: "17L tank + 230mm clearance",
      desc: "Seventeen litres means Kaza-to-Manali thinking, not panicking. Showa USD forks and 230mm of clearance eat Spiti's water crossings for breakfast.",
      price: "OEM · ≈450 km range",
      image: "https://images.pexels.com/photos/27539736/pexels-photo-27539736.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
      link: "https://www.royalenfield.com/in/en/motorcycles/himalayan/",
      x: 50,
      y: 44,
    },
    {
      title: "74L aluminium panniers",
      desc: "Hard expedition boxes — crash-tested, lockable, and room for a week's kit plus a drone case. Every bolt earned over 32,000 km.",
      price: "₹18,490",
      image: "https://images.pexels.com/photos/39535265/pexels-photo-39535265.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
      link: "https://www.royalenfield.com/in/en/genuine-motorcycle-accessories/",
      x: 81,
      y: 60,
    },
    {
      title: "Aux LED fog lamps",
      desc: "Pair of 40W aux fogs on crash-bar mounts. Cuts fog on Rohtang and lights up water crossings after dark.",
      price: "₹4,250",
      image: "https://images.pexels.com/photos/8532493/pexels-photo-8532493.png?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
      link: "https://www.royalenfield.com/in/en/genuine-motorcycle-accessories/",
      x: 28,
      y: 58,
    },
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
  expectedBack: "",
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
  nav: [
    { id: "nav-live", label: "Live", href: "#/live-map", enabled: true },
    { id: "nav-journey", label: "The Journey", href: "#journey", enabled: true },
    { id: "nav-machine", label: "The Machine", href: "#machine", enabled: true },
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

function loadContent(): SiteContent {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_CONTENT);

    const parsed = JSON.parse(raw) as SiteContent;
    if (parsed?.v !== 1 || !Array.isArray(parsed.sections) || !Array.isArray(parsed.nav)) {
      return structuredClone(DEFAULT_CONTENT);
    }
    // Existing dashboards keep their order and edits; newly shipped built-in
    // sections are appended once so YouTube/Instagram appear without a reset.
    const knownIds = new Set(parsed.sections.map((s) => s.id));
    const missing = DEFAULT_CONTENT.sections
      .filter((s) => !knownIds.has(s.id))
      .map((s) => structuredClone(s));
    return normalizeLoaded({ ...parsed, sections: [...parsed.sections, ...missing] });
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
  const { loaderLogo, brand, footer, headerButtons, themeColors, ...page } = value;
  return {
    ...page,
    loaderLogo: loaderLogo ?? "",
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
    JSON.stringify([resolveHeaderButtons(draft.headerButtons), resolveThemeColors(draft.themeColors)]) !==
    JSON.stringify([resolveHeaderButtons(content.headerButtons), resolveThemeColors(content.themeColors)]),
  [draft.headerButtons, draft.themeColors, content.headerButtons, content.themeColors]);
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

  const commit = useCallback((nextContent: SiteContent, description: string): boolean => {
    let next: SiteContent;
    let nextRevisions: Revision[];
    try {
      next = structuredClone(withSettingsDefaults(nextContent));
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
      return false;
    }

    setContent(next);
    setRevisions(nextRevisions);
    setSaveError(null);
    return true;
  }, [content, revisions]);

  const saveDraft = useCallback((description = "Manual save") => {
    if (!hasChanges) return true;
    if (!commit(draft, description)) return false;
    setDraft(structuredClone(withSettingsDefaults(draft)));
    setEditedActions([]);
    return true;
  }, [commit, draft, hasChanges]);

  const saveBranding = useCallback((description = "Updated logo & branding") => {
    if (!hasBrandChanges && !hasChanges) return true;
    if (!commit(draft, description)) return false;
    setDraft(structuredClone(withSettingsDefaults(draft)));
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
    if (!commit(cloned, `Restored: ${rev.description}`)) return;
    setDraft(cloned);
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
    if (!commit(defaults, "Reset website to original defaults")) return;
    setDraft(defaults);
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
      keys.forEach((key) => {
        const value = patch[key] ?? existing[key];
        if (typeof value === "number" && value > 0) next[key] = value;
      });
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

  /** Reorder sections from the live site. Follows the same draft flow as the dashboard. */
  const moveSection = useCallback(
    (id: string, label: string, direction: -1 | 1) => {
      logAction(`Reordered position of: ${label}`);
      updateDraft((c) => {
        const sections = [...c.sections];
        const from = sections.findIndex((s) => s.id === id);
        const to = from + direction;
        if (from < 0 || to < 0 || to >= sections.length) return c;
        [sections[from], sections[to]] = [sections[to], sections[from]];
        return { ...c, sections };
      });
    },
    [logAction, updateDraft]
  );

  /** Show or hide one section, honouring the parent/child cascade. */
  const setSectionEnabled = useCallback(
    (id: string, label: string, enabled: boolean) => {
      logAction(`${enabled ? "Enabled" : "Disabled"}: ${label}`);
      updateDraft((c) => cascadeSection(c, id, enabled));
    },
    [logAction, updateDraft]
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
      if (!commit(next, "Countdown finished — disabled and reset checkmarks")) return false;
      setDraft(structuredClone(withSettingsDefaults(next)));
      setEditedActions([]);
      return true;
    },
    [commit, content]
  );

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
