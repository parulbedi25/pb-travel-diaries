import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  CalendarClock,
  ShieldCheck,
  Copy,
  Download,
  Eye,
  FileText,
  Video,
  Gauge,
  Crosshair,
  DatabaseBackup,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileType,
  FolderOpen,
  GripVertical,
  ImageOff,
  Presentation,
  History,
  Image as ImageIcon,
  Images,
  KeyRound,
  LayoutList,
  Map as MapIcon,
  Palette,
  Link2,
  Power,
  PowerOff,
  List,
  Loader2,
  Lock,
  LogOut,
  Moon,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Settings,
  ShoppingBag,
  Sun,
  Trash2,
  Unlock,
  Upload,
  User,
  UserPlus,
  X,
} from "lucide-react";
import {
  useSite,
  defaultDataFor,
  resolveFooter,
  makeGearItemId,
  type BikeHotspot,
  type BrandSettings,
  type GearItem,
  type CountdownData,
  type MachineData,
  type MaintenanceData,
  type FooterColumn,
  type FooterLink,
  type FooterSettings,
  type FooterSocial,
  type LiveStop,
  type RiderKitPointer,
  type SectionEntry,
  type SectionType,
  type SiteContent,
  type LoaderAnimation,
  LOADER_ANIMATIONS,
  LOADER_ANIMATION_LABELS,
  LEGACY_STORAGE_KEYS,
  normaliseSavedContent,
  resolveLoaderAnimation,
} from "../store/siteContent";
import BrandLogo from "../components/BrandLogo";
import { FooterView } from "../components/Footer";
import { useCountdown, useCountdownFinished } from "../components/CountdownSection";
import { cn } from "../utils/cn";
import { formatMilestone, resolveOdometer, type MilestoneState } from "../utils/odometer";
import { pointerColors } from "../utils/pointerColors";
import { forgetDashboardScroll } from "../utils/routeScroll";
import type { LatLng } from "../utils/routing";
import ImageField from "./ImageField";
import ImagesField from "./ImagesField";
import BlockComposer from "./BlockComposer";
import SocialIconsEditor from "./SocialIconsEditor";
import RouteStopsEditor from "./RouteStopsEditor";
import { navStates } from "../utils/navSections";
import type { MapLinkSource } from "../utils/mapLinks";
import Switch from "./Switch";
import ColorPicker from "./ColorPicker";
import { createBlock, type SectionBlock } from "../blocks/types";
import FileField from "./FileField";
import CountdownSetupDialog from "./CountdownSetupDialog";
import {
  cancelCountdownSetup,
  getActiveCountdownTargets,
  resetActiveTargetsForCountdown,
} from "./countdownSetup";
import { ThemePanel, MapPanel, HeaderButtonsEditor, RestoreBar } from "./SettingsExtras";
import { isOn } from "../utils/enabled";
import {
  cascadeAllSections,
  cascadeChild,
  cascadeFooterColumn,
  cascadeFooterColumnLinks,
  cascadeFooterLink,
  cascadeFooterLinks,
  cascadeFooterSection,
  cascadeFooterSocial,
  cascadeNavAll,
  cascadeNavItem,
  cascadeSection,
} from "./cascade";
import { LineLoaderMark, LoaderBackdrop, LoaderStage } from "../components/Loader";
import {
  addAnyMediaFile,
  formatAdded,
  formatAddedFull,
  formatBytes,
  kindOf,
  KIND_META,
  LOADER_LOGO_BUDGET,
  type MediaKind,
  listMedia,
  MEDIA_ACCEPT,
  removeMedia,
  type MediaItem,
} from "./mediaLibrary";
import ConfirmDialog from "./ConfirmDialog";
import MediaLightbox from "./MediaLightbox";
import { siteApi, type Account, type AuthEvent, type BackupState } from "../api/siteApi";
import { describeApiError } from "../api/client";
import { inputCls } from "./fieldStyles";

/* ═══════════════ Admin auth ═══════════════
   Accounts live in the database. The browser holds nothing but an httpOnly
   session cookie it cannot read, and every call goes to the API in server/. */

/* ═══════════════ Field descriptors for the generic editor ═══════════════ */

export interface Field {
  path: string;
  label: string;
  kind: "text" | "textarea" | "number" | "image" | "images" | "toggle" | "strings" | "items" | "datetime" | "reveal" | "color" | "file";
  hint?: string;
  fields?: Field[];
  template?: unknown;
  /** Set on a product photo, so its preview is shown on the shop's white plate. */
  plate?: boolean;
}

const T = (path: string, label: string, hint?: string): Field => ({ path, label, kind: "text", hint });
const DT = (path: string, label: string, hint?: string): Field => ({ path, label, kind: "datetime", hint });
const CLR = (path: string, label: string, hint?: string): Field => ({ path, label, kind: "color", hint });
const FILE = (path: string, label: string, hint?: string): Field => ({ path, label, kind: "file", hint });

function isoToLocalInput(iso: string): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
const TA = (path: string, label: string, hint?: string): Field => ({ path, label, kind: "textarea", hint });
const IMG = (path: string, label: string, hint?: string): Field => ({ path, label, kind: "image", hint });
const IMAGES = (path: string, label: string, hint?: string): Field => ({ path, label, kind: "images", hint });
/** A product photo: previewed on the white plate the shop puts behind it. */
const PRODUCT_IMG = (path: string, label: string, hint?: string): Field => ({
  ...IMG(path, label, hint),
  plate: true,
});
const PRODUCT_IMAGES = (path: string, label: string, hint?: string): Field => ({
  ...IMAGES(path, label, hint),
  plate: true,
});
const STR = (path: string, label: string, hint?: string): Field => ({ path, label, kind: "strings", hint });

const GEAR_ITEM_FIELDS: Field[] = [
  T("category", "Category", "Helmet, jacket, gloves, pants, boots, bag, intercom, etc."),
  T("bodyPart", "Body zone", "Head, torso, hands, waist/hip, legs or feet. Leave blank to infer."),
  T("name", "Gear name"),
  T("brand", "Brand"),
  T("model", "Model"),
  PRODUCT_IMG("image", "Gear photo"),
  PRODUCT_IMAGES(
    "images",
    "More photos",
    "Optional. Every photo here joins the main one as a slider on the shop page — the first slide is the photo above.",
  ),
  T("imageAlt", "Photo alt text"),
  TA("description", "Why I wear it / notes"),
  STR("highlights", "Highlights / specs", "One per line"),
  T("fit", "Fit / size", "Optional"),
  T("usedFor", "Used for / conditions", "Optional, e.g. monsoon touring or high-altitude rides"),
  T("price", "Price", "Optional"),
  T("link", "Product / affiliate link", "Official store URL or future affiliate URL; opens in a new tab"),
];
const GEAR_ITEM_TEMPLATE = {
  id: "",
  enabled: true,
  category: "Helmet",
  bodyPart: "",
  name: "New gear item",
  brand: "",
  model: "",
  description: "",
  image: "",
  images: [],
  imageAlt: "",
  highlights: [],
  fit: "",
  usedFor: "",
  price: "",
  link: "",
};

export const SECTION_FIELDS: Record<Exclude<SectionType, "custom">, Field[]> = {
  hero: [
    T("liveTag", "Live banner text", "Links to the live map page"),
    T("headA", "Headline — before highlight"),
    T("headHi", "Headline — highlighted word(s)"),
    T("headB", "Headline — after highlight"),
    TA("sub", "Subheadline"),
    T("cta1", "Primary button label"),
    T("cta1Href", "Primary button link", "e.g. #journey or a full URL"),
    T("cta2", "Secondary button label"),
    T("cta2Href", "Secondary button link"),
    T("ratingText", "Rating line", "e.g. 4.9 from 6,200+ travelers"),
    T("tribeText", "Tribe line", "e.g. 480K+ tribe members"),
    T("chipLocation", "Location chip on photo"),
    T("originLat", "Origin — latitude", "Where the rider is from; e.g. 31.3832 shows as 31.3832° N"),
    T("originLng", "Origin — longitude", "e.g. 76.3766 shows as 76.3766° E"),
    T("originPlace", "Origin — place", "Shown under the coordinates, e.g. Nangal Dam · Punjab"),
    T("originNote", "Origin — small line", "Optional, e.g. Home base — where every route begins"),
    T("epTitle", "Episode title on photo card"),
    T("epMeta", "Episode meta on photo card"),
    T("statTop", "Floating stat — big line"),
    T("statSub", "Floating stat — small line"),
    IMG("mainImage", "Main hero image", "URL of the image"),
    IMG("cardAImage", "Floating card A image"),
    IMG("cardBImage", "Floating card B image"),
    T("cardATitle", "Card A title"),
    T("cardAMeta", "Card A meta"),
    T("cardBTitle", "Card B title"),
    T("cardBMeta", "Card B meta"),
    STR("marquee", "Marquee words", "One per line"),
  ],
  socialproof: [
    T("pressIntro", "Press row caption"),
    STR("press", "Press / brand names", "One per line"),
    {
      path: "stats",
      label: "Stat cards",
      kind: "items",
      fields: [
        { path: "value", label: "Number", kind: "number" },
        T("suffix", "Suffix", "e.g. K+"),
        T("label", "Label"),
        T("sub", "Subtext"),
      ],
      template: { value: 10, suffix: "", label: "New stat", sub: "Context line" },
    },
  ],
  live: [
    T("eyebrow", "Eyebrow label"),
    T("titleA", "Title — before highlight"),
    T("titleHi", "Title — highlighted"),
    T("titleB", "Title — after highlight"),
    TA("sub", "Subtitle"),
    TA("note", "Today's ride note", "Overrides the live feed note when set"),
    {
      path: "stops",
      label: "Route stops",
      kind: "items",
      hint: "Real coordinates, in journey order. Mark one stop as \"Here now\" and every stop before it becomes Ridden, every stop after it Still to come — the road is drawn through them.",
      fields: [],
    },
    {
      path: "buttons.map.visible",
      label: "Show the first tracker button",
      kind: "toggle",
      hint: "Opens the live map — the single current location, no place list.",
    },
    T("buttons.map.label", "First button — label", "Its default is Open live map"),
    T("buttons.map.href", "First button — link", "e.g. #/live-map, or a full https:// URL"),
    T("buttons.map.icon", "First button — icon", "map-pin · map-pinned · navigation · compass · route · flag · arrow-up-right · sparkles · images"),
    {
      path: "buttons.nearby.visible",
      label: "Show the second tracker button",
      kind: "toggle",
      hint: "Opens the nearby-places page: the top places around the current location.",
    },
    T("buttons.nearby.label", "Second button — label", "Its default is Nearby places"),
    T("buttons.nearby.href", "Second button — link", "e.g. #/nearby, or a full https:// URL"),
    T("buttons.nearby.icon", "Second button — icon", "map-pin · map-pinned · navigation · compass · route · flag · arrow-up-right · sparkles · images"),
    T("nearby.heading", "Nearby page — heading"),
    TA("nearby.intro", "Nearby page — intro line"),
    {
      path: "nearby.radiusKm",
      label: "Nearby page — search radius (km)",
      kind: "number",
      hint: "How far around the current location to look. 1–10 km; 10 is the maximum.",
    },
    {
      path: "nearby.count",
      label: "Nearby page — how many places",
      kind: "number",
      hint: "5–10 places, nearest first, fetched live from Wikipedia.",
    },
  ],
  features: [
    T("eyebrow", "Eyebrow label"),
    T("titleA", "Title — before highlight"),
    T("titleHi", "Title — highlighted"),
    T("titleB", "Title — after highlight"),
    TA("sub", "Subtitle"),
    {
      path: "items",
      label: "Feature cards",
      kind: "items",
      hint: "Icon keys: clapperboard · route · rupee · compass · backpack · users",
      fields: [
        T("icon", "Icon key"),
        CLR("color", "Icon colour", "Empty = default gold"),
        T("title", "Title"),
        TA("desc", "Description"),
      ],
      template: { icon: "compass", title: "New feature", desc: "Describe it here." },
    },
  ],
  journey: [
    T("eyebrow", "Eyebrow label"),
    T("titleA", "Title — before highlight"),
    T("titleHi", "Title — highlighted"),
    T("titleB", "Title — after highlight"),
    TA("sub", "Subtitle"),
    {
      path: "destinations",
      label: "Destinations",
      kind: "items",
      fields: [
        T("name", "Name"),
        T("state", "State / region"),
        T("tagline", "Tagline"),
        TA("description", "Description"),
        IMG("image", "Image URL"),
        T("distance", "Distance"),
        T("days", "Suggested pace"),
        T("season", "Best window"),
        T("vibe", "Vibe chip"),
      ],
      template: { name: "New destination", state: "State", tagline: "Tagline", description: "Describe the route.", image: "", distance: "0 km", days: "0 days", season: "Jan – Mar", vibe: "Vibe" },
    },
  ],
  machine: [
    T("eyebrow", "Eyebrow label"),
    T("titleA", "Title — before highlight"),
    T("titleHi", "Title — highlighted"),
    T("titleB", "Title — after highlight"),
    TA("sub", "Subtitle"),
    IMG("mainImage", "Main bike image", "URL of the image"),
    T("mainImageAlt", "Main image alt text"),
    { path: "km", label: "Kilometres ridden (odometer)", kind: "number" },
    T("namePlate", "Name plate (Urdu)", "e.g. تسکین"),
    T("namePlateEn", "Name plate (English)", "e.g. Taskeen"),
    T("plateSub", "Name plate subtext"),
    T("whyTitle", "Story card title"),
    TA("whyText", "Story card text"),
    T("whyFoot", "Story card footer line"),
    STR("mods", "Mod list", "One per line"),
    T("filmCta", "Film button label"),
    T("pdfCta", "PDF button label"),
    FILE("pdfFile", "Setup sheet file", "PDF, Word, Excel or an image — visitors download it from the button"),
    T("serviceLine", "Service log line"),
    {
      path: "hotspots",
      label: "Bike pointers / accessories",
      kind: "items",
      hint: "x and y are percentages (0–100) from the top-left of the bike photo. Add as many pointers as you like.",
      fields: [
        T("title", "Accessory name"),
        TA("desc", "Description"),
        T("price", "Price", "e.g. ₹4,250 or OEM · included"),
        CLR("color", "Pointer colour", "Empty = default gold"),
        CLR("pulseColor", "Pulsing ring colour", "The wave that ripples out of the dot. Empty = matches the pointer colour"),
        PRODUCT_IMG("image", "Product image URL"),
        T("link", "Product link", "Opens in a new tab"),
        { path: "x", label: "X position % (0–100, left → right)", kind: "number" },
        { path: "y", label: "Y position % (0–100, top → bottom)", kind: "number" },
      ],
      template: {
        title: "New accessory",
        desc: "What it is and why it's on the bike.",
        price: "₹0",
        image: "",
        link: "https://",
        x: 50,
        y: 50,
      },
    },
    {
      path: "gallery",
      label: "Gallery photos",
      kind: "items",
      fields: [
        IMG("src", "Image URL"),
        T("alt", "Alt text"),
        T("cap", "Caption chip"),
      ],
      template: { src: "", alt: "Photo", cap: "Caption" },
    },
  ],
  gears: [
    T("eyebrow", "Eyebrow label"),
    T("titleA", "Title — before highlight"),
    T("titleHi", "Title — highlighted"),
    T("titleB", "Title — after highlight"),
    TA("sub", "Subtitle", "Manage My Picks in Shop. The Gear has independent product copies; edit or reposition them in its rider-pointer tiles."),
    T("emptyTitle", "Empty-state heading"),
    TA("emptyText", "Empty-state message"),
  ],
  riderkit: [
    T("eyebrow", "Eyebrow label"),
    T("titleA", "Title — before highlight"),
    T("titleHi", "Title — highlighted"),
    T("titleB", "Title — after highlight"),
    TA("sub", "Subtitle"),
    IMG("image", "Full-body rider image", "Upload or select the hero image. The draggable pointer editor appears below."),
    T("imageAlt", "Image alt text"),
    {
      path: "mapPointers",
      label: "Rider image pointers",
      kind: "items",
      hint: "Click the image preview below to add a pointer, then drag numbered dots to position them. Edit each pointer's gear zone, label and hit radius here.",
      fields: [
        T("id", "Pointer ID", "Keep IDs unique"),
        T("label", "Pointer label"),
        T("zone", "Mapped gear zone", "head, torso, hands, waist, legs, feet, or intercom"),
        { path: "x", label: "Horizontal position (%)", kind: "number" },
        { path: "y", label: "Vertical position (%)", kind: "number" },
        { path: "radius", label: "Hover / click radius (%)", kind: "number" },
        CLR("color", "Pointer colour", "Empty = default gold"),
        CLR("pulseColor", "Pulsing ring colour", "The ring that pulses around the dot. Empty = matches the pointer colour"),
      ],
      template: { enabled: true, id: "new-pointer", label: "New pointer", zone: "torso", x: 50, y: 40, radius: 12, color: "", pulseColor: "" },
    },
  ],
  benefits: [
    T("eyebrow", "Eyebrow label"),
    T("titleA", "Title — before highlight"),
    T("titleHi", "Title — highlighted"),
    T("titleB", "Title — after highlight"),
    TA("sub", "Subtitle"),
    FILE("videoSrc", "Section film (loops, muted)", "MP4 or WebM. Leave empty for no film. Pick the bundled drone shot or upload your own."),
    IMG("videoPoster", "Film poster", "Shown before the film starts, and instead of it on a slow connection."),
    T("videoLine", "Showreel headline line"),
    STR("videoChips", "Showreel chips", "One per line"),
    TA("quote", "PB portrait quote"),
    {
      path: "personas",
      label: "Persona cards",
      kind: "items",
      fields: [
        T("tag", "Tag", "e.g. For vloggers"),
        T("title", "Title"),
        STR("points", "Points", "One per line"),
      ],
      template: { tag: "For ...", title: "Title", points: ["Point one", "Point two", "Point three"] },
    },
  ],
  youtube: [
    T("eyebrow", "Eyebrow label"),
    T("titleA", "Title — before highlight"),
    T("titleHi", "Title — highlighted"),
    T("titleB", "Title — after highlight"),
    TA("sub", "Subtitle"),
    T("channelLabel", "Channel button label"),
    T("channelHref", "YouTube channel URL"),
    {
      path: "items",
      label: "YouTube videos",
      kind: "items",
      fields: [
        T("title", "Video title"),
        T("url", "YouTube video URL", "youtube.com/watch?v=… or youtu.be/…"),
        TA("description", "Description"),
      ],
      template: {
        title: "New YouTube video",
        url: "https://www.youtube.com/watch?v=",
        description: "Describe the film.",
      },
    },
  ],
  instagram: [
    T("eyebrow", "Eyebrow label"),
    T("titleA", "Title — before highlight"),
    T("titleHi", "Title — highlighted"),
    T("titleB", "Title — after highlight"),
    TA("sub", "Subtitle"),
    T("profileLabel", "Profile button label"),
    T("profileHref", "Instagram profile URL"),
    {
      path: "items",
      label: "Instagram posts / reels",
      kind: "items",
      fields: [
        T("title", "Title"),
        T("url", "Public Instagram URL", "instagram.com/p/… or instagram.com/reel/…"),
        TA("caption", "Caption"),
      ],
      template: {
        title: "New Instagram post",
        url: "https://www.instagram.com/p/",
        caption: "A moment from the road.",
      },
    },
  ],
  stories: [
    T("eyebrow", "Eyebrow label"),
    T("titleA", "Title — before highlight"),
    T("titleHi", "Title — highlighted"),
    T("titleB", "Title — after highlight"),
    TA("sub", "Subtitle"),
    {
      path: "items",
      label: "Testimonials",
      kind: "items",
      fields: [T("name", "Name"), T("age", "Age · trip"), TA("quote", "Quote")],
      template: { name: "New person", age: "25 · trip name", quote: "What they said." },
    },
  ],
  pricing: [
    T("eyebrow", "Eyebrow label"),
    T("titleA", "Title — before highlight"),
    T("titleHi", "Title — highlighted"),
    T("titleB", "Title — after highlight"),
    TA("sub", "Subtitle"),
    T("fine", "Fine print (before 'Questions?')"),
    {
      path: "plans",
      label: "Plans",
      kind: "items",
      fields: [
        T("name", "Plan name"),
        T("tagline", "Tagline"),
        { path: "monthly", label: "Monthly price (₹)", kind: "number" },
        { path: "yearly", label: "Yearly price / mo (₹)", kind: "number" },
        T("cta", "Button label"),
        { path: "featured", label: "Most popular", kind: "toggle" },
        STR("features", "Features", "One per line"),
      ],
      template: { name: "New plan", tagline: "Tagline", monthly: 0, yearly: 0, cta: "Choose", featured: false, features: ["Feature one", "Feature two"] },
    },
  ],
  faq: [
    T("eyebrow", "Eyebrow label"),
    T("titleA", "Title — before highlight"),
    T("titleHi", "Title — highlighted"),
    T("titleB", "Title — after highlight"),
    TA("sub", "Subtitle"),
    T("discordLabel", "Discord card label"),
    T("discordMeta", "Discord card meta"),
    T("email", "Contact email"),
    T("emailMeta", "Email card meta"),
    {
      path: "items",
      label: "Questions",
      kind: "items",
      fields: [T("q", "Question"), TA("a", "Answer")],
      template: { q: "New question?", a: "Answer it here." },
    },
  ],
  maintenance: [
    T("badge", "Badge label"),
    T("title", "Headline"),
    TA("description", "Message"),
    IMG("logo", "Logo override", "Leave empty to use the website logo from Logo & brand"),
    DT("scheduledAt", "Go offline at", "Pick a date and time and the site takes itself offline, without you lifting a finger. Leave empty to switch maintenance on and off by hand."),
    T("note", "Footer note"),
    T("email", "Contact email"),
  ],
  countdown: [
    T("badge", "Badge label"),
    T("title", "Headline"),
    TA("sub", "Subtitle"),
    DT("targetDate", "Target date & time", "When the timer reaches zero. Set a new future date to run it again."),
    T("doneMessage", "Message after zero", "Shown as a banner when the timer finishes. Leave empty for none."),
    { path: "revealSectionIds", label: "Sections to show after zero", kind: "reveal" },
    T("ctaLabel", "Button label"),
    T("ctaHref", "Button link"),
  ],
  cta: [
    T("badge", "Badge text"),
    T("titleA", "Title — before highlight"),
    T("titleHi", "Title — highlighted"),
    TA("sub", "Subtitle"),
    T("placeholder", "Email input placeholder"),
    T("btnLabel", "Button label"),
    T("success", "Success message"),
    T("fineprint", "Fine print under form"),
    STR("chips", "Checkmark chips", "One per line"),
  ],
};

export const CUSTOM_FIELDS: Field[] = [
  T("eyebrow", "Eyebrow label", "Optional"),
  T("title", "Title"),
  TA("sub", "Subtitle"),
  IMG("image", "Image URL", "Optional — leave empty for text-only"),
  T("imageAlt", "Image alt text"),
  T("buttonLabel", "Button label", "Optional"),
  T("buttonHref", "Button link"),
  T("layout", "Image side", "image-left or image-right"),
];

/* ═══════════════ Path helpers ═══════════════ */

function getAt(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[k];
  }, obj);
}

function setAt<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const clone: unknown = structuredClone(obj);
  let cur = clone as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof cur[k] !== "object" || cur[k] === null || Array.isArray(cur[k])) {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
  return clone as T;
}

/* ═══════════════ Small UI bits ═══════════════ */

export function FieldRow({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {field.label}
      </label>
      {field.kind === "textarea" ? (
        <textarea
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={cn(inputCls, "resize-y leading-relaxed")}
        />
      ) : field.kind === "number" ? (
        <input
          type="number"
          value={Number.isFinite(Number(value)) ? Number(value) : 0}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className={inputCls}
        />
      ) : field.kind === "datetime" ? (
        <input
          type="datetime-local"
          value={isoToLocalInput(String(value ?? ""))}
          onChange={(e) => onChange(localInputToIso(e.target.value))}
          className={cn(inputCls, "[color-scheme:dark]")}
        />
      ) : field.kind === "toggle" ? (
        <Switch on={Boolean(value)} onChange={onChange} label={field.label} />
      ) : field.kind === "strings" ? (
        <textarea
          value={Array.isArray(value) ? (value as string[]).join("\n") : ""}
          onChange={(e) => onChange(e.target.value.split("\n"))}
          rows={4}
          className={cn(inputCls, "font-mono text-xs leading-relaxed")}
          placeholder={"One item per line"}
        />
      ) : field.kind === "color" ? (
        // A swatch of the applied colour that opens the chart — never the
        // browser's drag picker. Empty means "use the site gold".
        <ColorPicker
          label={field.label}
          value={String(value ?? "")}
          onChange={(hex) => onChange(hex)}
          fallback="#f5b301"
          fallbackLabel="Default gold"
        />
      ) : field.kind === "file" ? (
        <FileField
          value={(value as string) ?? ""}
          onChange={(v) => onChange(v)}
          hint={field.hint}
        />
      ) : field.kind === "image" ? (
        <ImageField
          value={(value as string) ?? ""}
          onChange={(v) => onChange(v)}
          hint={field.hint}
          plate={field.plate}
        />
      ) : field.kind === "images" ? (
        <ImagesField
          value={(value as string[]) ?? []}
          onChange={(v) => onChange(v)}
          hint={field.hint}
          plate={field.plate}
        />
      ) : (
        <input
          type="text"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      )}
      {/* Image, images and file fields print their own hint, so a generic one
          here would show every such note twice. */}
      {field.kind !== "image" && field.kind !== "images" && field.kind !== "file" && field.hint && (
        <p className="mt-1.5 text-[11px] text-zinc-600">{field.hint}</p>
      )}
    </div>
  );
}

export function ItemsField({
  field,
  value,
  onChange,
  onItemToggle,
}: {
  field: Field;
  value: unknown[];
  onChange: (v: unknown) => void;
  onItemToggle?: (index: number, enabled: boolean) => void;
}) {
  const items = Array.isArray(value) ? value : [];
  const addItem = () => {
    const nextItem = structuredClone(field.template ?? { name: "New item" });
    const isGearItem = field.fields?.some((sub) => sub.path === "bodyPart") && field.fields?.some((sub) => sub.path === "highlights");
    if (isGearItem && typeof nextItem === "object" && nextItem !== null) {
      const record = nextItem as Record<string, unknown>;
      record.id = makeGearItemId(String(record.name ?? "New gear item"), `${Date.now().toString(36)}-${items.length}`);
    }
    onChange([...items, nextItem]);
  };
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
          {field.label}
        </label>
        <span className="text-[11px] text-zinc-600">{items.length} items</span>
      </div>
      {field.hint && <p className="mb-2 text-[11px] text-zinc-600">{field.hint}</p>}
      <div className="flex flex-col gap-3">
        {items.map((item, i) => (
          <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2.5">
                <span className="text-xs font-bold text-saffron-300">#{i + 1}</span>
                {onItemToggle && (
                  <Switch
                    on={isOn(item)}
                    onChange={(v) => onItemToggle(i, v)}
                    label={`Show item ${i + 1}`}
                  />
                )}
              </span>
              <button
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" /> Remove
              </button>
            </div>
            <div className="grid gap-3">
              {(field.fields ?? []).map((sub) => (
                <FieldRow
                  key={sub.path}
                  field={sub}
                  value={getAt(item, sub.path)}
                  onChange={(v) =>
                    onChange(items.map((it, j) => (j === i ? setAt(it, sub.path, v) : it)))
                  }
                />
              ))}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-4 py-3 text-xs font-semibold text-zinc-400 transition-all duration-300 hover:border-saffron-400/50 hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" /> Add item
        </button>
      </div>
    </div>
  );
}

/* ═══════════════ Login ═══════════════ */

function Login({ onLogin }: { onLogin: (user: Account) => void }) {
  const { theme, setTheme } = useSite();
  const [checking, setChecking] = useState(true);
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // A fresh database has no accounts, so the first screen is "create the
  // owner account" rather than a sign-in nobody could pass.
  useEffect(() => {
    let alive = true;
    siteApi
      .status()
      .then((status) => {
        if (!alive) return;
        setCreating(status.users === 0);
        setChecking(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(describeApiError(err));
        setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (creating && password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const user = creating
        ? await siteApi.signup(username.trim(), password, email.trim() || undefined)
        : await siteApi.login(username.trim(), password);
      onLogin(user);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-950 px-5">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-50 [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)]" aria-hidden />
      <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[640px] -translate-x-1/2 rounded-full bg-saffron-400/15 blur-[120px]" aria-hidden />

      <div className="relative w-full max-w-sm">
        <button
          onClick={() => (window.location.hash = "#/")}
          className="mb-8 inline-flex items-center gap-2 text-xs font-medium text-zinc-500 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to site
        </button>
        <div className="rounded-3xl glass p-8">
          <div className="flex items-center gap-3">
            <span className="grid aspect-square h-11 w-11 shrink-0 place-items-center rounded-full bg-saffron-400 font-display text-sm font-bold text-on-gold shadow-lg shadow-saffron-400/30">
              PB
            </span>
            <div>
              <h1 className="font-display text-lg font-semibold text-white">PB Control</h1>
              <p className="text-xs text-zinc-500">
                {creating ? "Create the owner account" : "Admin sign in"}
              </p>
            </div>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
              className="shrink-0 aspect-square ml-auto grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-zinc-400 transition-colors hover:text-white"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>

          <form onSubmit={submit} className="mt-7 flex flex-col gap-3">
            <label htmlFor="admin-user" className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Username
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                id="admin-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                placeholder="parul"
                className={cn(inputCls, "pl-10")}
              />
            </div>

            <label htmlFor="admin-pw" className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Password
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                id="admin-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={creating ? "new-password" : "current-password"}
                placeholder="••••••••"
                className={cn(inputCls, "pl-10")}
              />
            </div>

            {creating && (
              <>
                <label htmlFor="admin-pw2" className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  Repeat password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    id="admin-pw2"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className={cn(inputCls, "pl-10")}
                  />
                </div>
                <label htmlFor="admin-email" className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  Email <span className="font-normal normal-case tracking-normal text-zinc-600">(optional)</span>
                </label>
                <input
                  id="admin-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  className={inputCls}
                />
              </>
            )}

            {error && <p className="text-xs font-medium text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={busy || checking}
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-saffron-400 px-5 py-3 font-display text-sm font-semibold text-on-gold shadow-lg shadow-saffron-400/30 transition-all duration-300 hover:brightness-110 active:scale-95 disabled:opacity-60"
            >
              {checking ? "Checking…" : busy ? "Working…" : creating ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="mt-5 rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-[11px] leading-relaxed text-zinc-500">
            {creating
              ? "This is the first account on this site, so it becomes the owner. Use at least 8 characters with a letter and a number."
              : "Accounts and passwords are stored in the site's database, and every sign-in is recorded in the access history."}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ Bike pointer editor (The Machine) ═══════════════ */

const roundPct = (n: number) => Math.min(100, Math.max(0, Math.round(n * 10) / 10));

export function HotspotEditor({
  spots,
  mainImage,
  onChange,
  onItemToggle,
}: {
  spots: BikeHotspot[];
  mainImage: string;
  onChange: (next: BikeHotspot[]) => void;
  onItemToggle: (index: number, enabled: boolean) => void;
}) {
  const { logAction } = useSite();
  const fields = SECTION_FIELDS.machine.find((f) => f.path === "hotspots")?.fields ?? [];
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ idx: number; x: number; y: number; moved: boolean } | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);

  /** Convert a pointer position into a % of the bike image (0–100). */
  const pctFrom = (clientX: number, clientY: number) => {
    const el = wrapRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: roundPct(((clientX - r.left) / r.width) * 100),
      y: roundPct(((clientY - r.top) / r.height) * 100),
    };
  };

  const addAt = (x: number, y: number) => {
    const next: BikeHotspot = {
      title: `New pointer ${spots.length + 1}`,
      desc: "",
      price: "",
      image: "",
      link: "",
      x,
      y,
    };
    onChange([...spots, next]);
    setOpenIdx(spots.length);
    logAction(`Added bike pointer: ${next.title}`);
  };

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const p = pctFrom(e.clientX, e.clientY);
    if (p) addAt(p.x, p.y);
  };

  const startDrag = (e: React.PointerEvent<HTMLButtonElement>, idx: number) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ idx, x: spots[idx].x, y: spots[idx].y, moved: false });
  };

  const moveDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const p = pctFrom(e.clientX, e.clientY);
    if (!p) return;
    const base = spots[drag.idx];
    setDrag({
      ...drag,
      x: p.x,
      y: p.y,
      moved: drag.moved || p.x !== base.x || p.y !== base.y,
    });
  };

  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) {
      suppressClick.current = true;
      logAction(`Moved bike pointer: ${spots[drag.idx].title}`);
      onChange(spots.map((s, j) => (j === drag.idx ? { ...s, x: drag.x, y: drag.y } : s)));
    }
    setDrag(null);
  };

  const updateItem = (i: number, path: string, v: unknown) => {
    logAction(`Edited bike pointer: ${spots[i].title}`);
    onChange(spots.map((s, j) => (j === i ? (setAt(s, path, v) as BikeHotspot) : s)));
  };

  const removeItem = (i: number) => {
    logAction(`Removed bike pointer: ${spots[i].title}`);
    onChange(spots.filter((_, j) => j !== i));
    setOpenIdx(null);
  };

  const reorder = (from: number, to: number) => {
    if (from === to || to < 0 || to >= spots.length) return;
    const arr = [...spots];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    logAction(`Reordered bike pointers: ${moved.title} → position ${to + 1}`);
    onChange(arr);
    setOpenIdx(openIdx === from ? to : null);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-white">
            <Crosshair className="h-3.5 w-3.5 text-saffron-300" />
            Bike pointers
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            Click anywhere on the bike to add a pointer · drag a numbered dot to move it · drag rows
            in the list to reorder
          </p>
        </div>
        <button
          type="button"
          onClick={() => addAt(50, 50)}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/[0.12]"
        >
          <Plus className="h-3.5 w-3.5" /> Add blank pointer
        </button>
      </div>

      {mainImage ? (
        <div
          ref={wrapRef}
          onClick={handleImageClick}
          className="relative w-full cursor-crosshair select-none overflow-hidden rounded-xl border border-white/10 bg-black/40"
          role="group"
          aria-label="Main bike image. Click to add a pointer."
        >
          <img
            src={mainImage}
            alt=""
            draggable={false}
            className="pointer-events-none block h-auto w-full"
          />
          {spots.map((s, i) => {
            const isDragging = drag?.idx === i;
            const dx = isDragging && drag ? drag.x : s.x;
            const dy = isDragging && drag ? drag.y : s.y;
            const isOpen = openIdx === i;
            return (
              <button
                key={i}
                type="button"
                aria-label={`Pointer ${i + 1}: ${s.title}`}
                onPointerDown={(e) => startDrag(e, i)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onClick={(e) => {
                  e.stopPropagation();
                  suppressClick.current = false;
                  setOpenIdx(isOpen ? null : i);
                }}
                className={cn(
                  "shrink-0 aspect-square absolute z-10 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full border-2 text-[10px] font-bold shadow-lg transition-colors",
                  isOpen
                    ? "border-white bg-saffron-400 text-on-gold"
                    : "border-white bg-ink-950/85 text-white hover:border-saffron-300",
                  isDragging ? "cursor-grabbing scale-110" : "cursor-grab"
                )}
                style={{
                  left: `${dx}%`,
                  top: `${dy}%`,
                  // Numbered pin shows the pointer's own colours while editing.
                  ...(isOpen ? {} : { borderColor: pointerColors(s.color, s.pulseColor).pulse }),
                }}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid h-40 place-items-center rounded-xl border border-dashed border-white/15 px-6 text-center text-xs text-zinc-500">
          Upload the main bike image above, then click on the bike to add pointers.
        </div>
      )}

      <div className="mt-5 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Pointer list · {spots.length}
        </p>
        <p className="text-[11px] text-zinc-600">Shown on the site in this order</p>
      </div>

      {spots.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-zinc-600">
          No pointers yet — click the bike image to add the first one.
        </p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2.5">
          {spots.map((s, i) => {
            const isOpen = openIdx === i;
            return (
              <li
                key={i}
                onDragOver={(e) => {
                  if (dragFrom === null) return;
                  e.preventDefault();
                  setDragOver(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom !== null) reorder(dragFrom, i);
                  setDragFrom(null);
                  setDragOver(null);
                }}
                className={cn(
                  "rounded-2xl border bg-white/[0.03] transition-all duration-200",
                  isOpen ? "border-saffron-400/40" : "border-white/[0.07]",
                  dragOver === i && dragFrom !== null && dragFrom !== i && "border-saffron-400 bg-saffron-400/10",
                  dragFrom === i && "opacity-50"
                )}
              >
                <div
                  draggable
                  onDragStart={(e) => {
                    setDragFrom(i);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(i));
                  }}
                  onDragEnd={() => {
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  className="flex cursor-grab items-center gap-2.5 p-2.5 active:cursor-grabbing"
                >
                  <GripVertical className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />
                  <span className="aspect-square grid h-6 w-6 shrink-0 place-items-center rounded-full bg-saffron-400 text-[10px] font-bold text-on-gold">
                    {i + 1}
                  </span>
                  <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/[0.05]">
                    {s.image ? (
                      <img src={s.image} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Plus className="h-4 w-4 text-zinc-600" />
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpenIdx(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm font-semibold text-white">
                      {s.title || "Untitled"}
                    </span>
                    <span className="block truncate text-[11px] text-zinc-500">
                      {s.price || "No price"} · x {s.x}% · y {s.y}%
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => reorder(i, i - 1)}
                      disabled={i === 0}
                      aria-label="Move up"
                      className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 hover:bg-white/[0.12] hover:text-white disabled:opacity-30"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => reorder(i, i + 1)}
                      disabled={i === spots.length - 1}
                      aria-label="Move down"
                      className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 hover:bg-white/[0.12] hover:text-white disabled:opacity-30"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <Switch
                      on={isOn(s)}
                      onChange={(v) => onItemToggle(i, v)}
                      label={`Show ${s.title}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      aria-label={`Remove ${s.title}`}
                      className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 hover:bg-red-500/15 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="grid gap-3.5 border-t border-white/[0.07] p-3.5">
                    {fields.map((f) => (
                      <FieldRow
                        key={f.path}
                        field={f}
                        value={getAt(s, f.path)}
                        onChange={(v) => updateItem(i, f.path, v)}
                      />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/* ═══════════════ Rider-map pointer editor (The Gear) ═══════════════ */

export function RiderKitPointerEditor({
  pointers,
  image,
  gearItems,
  onChange,
  onItemToggle,
  onGearItemChange,
  onAddProduct,
  onRemovePointer,
}: {
  pointers: RiderKitPointer[];
  image: string;
  gearItems: GearItem[];
  onChange: (next: RiderKitPointer[]) => void;
  onItemToggle: (index: number, enabled: boolean) => void;
  onGearItemChange: (gearId: string, path: string, value: unknown) => void;
  onAddProduct: (pointerIndex?: number) => void;
  onRemovePointer: (pointerIndex: number) => void;
}) {
  const { logAction } = useSite();
  const fields = SECTION_FIELDS.riderkit.find((field) => field.path === "mapPointers")?.fields ?? [];
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ idx: number; x: number; y: number; moved: boolean } | null>(null);
  const [rowDragFrom, setRowDragFrom] = useState<number | null>(null);
  const [rowDragOver, setRowDragOver] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);

  const pctFrom = (clientX: number, clientY: number) => {
    const el = wrapRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: roundPct(((clientX - rect.left) / rect.width) * 100),
      y: roundPct(((clientY - rect.top) / rect.height) * 100),
    };
  };

  const addAt = (x: number, y: number) => {
    const next: RiderKitPointer = {
      enabled: true,
      id: `gear-pointer-${Date.now()}-${pointers.length + 1}`,
      label: `Gear pointer ${pointers.length + 1}`,
      zone: "torso",
      x,
      y,
      radius: 12,
    };
    onChange([...pointers, next]);
    setOpenIdx(pointers.length);
    logAction(`Added The Gear image pointer: ${next.label}`);
  };

  const handleImageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const point = pctFrom(event.clientX, event.clientY);
    if (point) addAt(point.x, point.y);
  };

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ idx: index, x: pointers[index].x, y: pointers[index].y, moved: false });
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const point = pctFrom(event.clientX, event.clientY);
    if (!point) return;
    const origin = pointers[drag.idx];
    setDrag({ ...drag, x: point.x, y: point.y, moved: drag.moved || point.x !== origin.x || point.y !== origin.y });
  };

  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) {
      suppressClick.current = true;
      const pointer = pointers[drag.idx];
      onChange(pointers.map((item, index) => index === drag.idx ? { ...item, x: drag.x, y: drag.y } : item));
      logAction(`Moved The Gear image pointer: ${pointer?.label ?? `#${drag.idx + 1}`}`);
    }
    setDrag(null);
  };

  const updatePointer = (index: number, path: string, value: unknown) => {
    const pointer = pointers[index];
    logAction(`Edited The Gear image pointer: ${pointer?.label ?? `#${index + 1}`}`);
    onChange(pointers.map((item, itemIndex) => itemIndex === index ? setAt(item, path, value) as RiderKitPointer : item));
  };

  const linkProduct = (index: number, gearId: string) => {
    const linked = gearItems.find((item) => item.id === gearId);
    onChange(pointers.map((item, itemIndex) => itemIndex === index
      ? { ...item, gearId: gearId || undefined, ...(linked ? { label: linked.name } : {}) }
      : item));
    logAction(`Linked The Gear pointer to ${linked?.name || "automatic zone matching"}`);
  };

  const reorderPointers = (from: number, to: number) => {
    if (from === to || to < 0 || to >= pointers.length) return;
    const next = [...pointers];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    logAction(`Reordered The Gear product pointers: ${moved?.label ?? `#${from + 1}`} → ${to + 1}`);
    onChange(next);
    if (openIdx === from) setOpenIdx(to);
    else if (openIdx !== null && from < to && openIdx > from && openIdx <= to) setOpenIdx(openIdx - 1);
    else if (openIdx !== null && from > to && openIdx >= to && openIdx < from) setOpenIdx(openIdx + 1);
  };

  const removePointer = (index: number) => {
    logAction(`Removed The Gear product pointer: ${pointers[index]?.label ?? `#${index + 1}`}`);
    onRemovePointer(index);
    setOpenIdx(null);
  };

  const position = (value: number) => Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 0));

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-white">
            <Crosshair className="h-3.5 w-3.5 text-saffron-300" /> Rider image pointers
          </p>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-zinc-500">
            Click the image to add a blank pin · drag map dots to position · expand a product tile to edit its photo, description, specs, price and buy link · drag the grip at left to reorder.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setOpenIdx(pointers.length);
              onAddProduct();
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-saffron-400 px-3.5 py-2 text-xs font-bold text-on-gold hover:brightness-110"
          >
            <Plus className="h-3.5 w-3.5" /> Add product
          </button>
          <button
            type="button"
            onClick={() => addAt(50, 50)}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/[0.12]"
          >
            <Crosshair className="h-3.5 w-3.5" /> Add blank pointer
          </button>
        </div>
      </div>

      {image ? (
        <div
          ref={wrapRef}
          onClick={handleImageClick}
          className="relative aspect-[2/3] w-full cursor-crosshair select-none overflow-hidden rounded-xl border border-white/10 bg-black/40"
          role="group"
          aria-label="Rider gear map preview. Click to add a pointer and drag dots to position them."
        >
          <img src={image} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/30" aria-hidden="true" />
          {pointers.map((pointer, index) => {
            const isDragging = drag?.idx === index;
            const x = isDragging && drag ? drag.x : position(pointer.x);
            const y = isDragging && drag ? drag.y : position(pointer.y);
            const isOpen = openIdx === index;
            return (
              <button
                key={`${pointer.id}-${index}`}
                type="button"
                aria-label={`Pointer ${index + 1}: ${pointer.label}`}
                title={`${pointer.label} · ${pointer.zone}`}
                onPointerDown={(event) => startDrag(event, index)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onClick={(event) => {
                  event.stopPropagation();
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  setOpenIdx(isOpen ? null : index);
                }}
                className={cn(
                  "shrink-0 aspect-square absolute z-10 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full border-2 border-white bg-ink-950/90 text-[10px] font-bold text-white shadow-lg transition-colors",
                  isOpen ? "bg-saffron-400 text-on-gold" : "hover:border-saffron-300",
                  isDragging ? "cursor-grabbing scale-110" : "cursor-grab",
                  isOn(pointer) ? "opacity-100" : "opacity-45"
                )}
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  ...(isOpen ? {} : { borderColor: pointerColors(pointer.color, pointer.pulseColor).pulse }),
                }}
              >
                {index + 1}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid h-40 place-items-center rounded-xl border border-dashed border-white/15 px-6 text-center text-xs text-zinc-500">
          Upload the full-body rider image above, then click it to add pointers.
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Product pointer list · {pointers.length}</p>
        <p className="text-right text-[11px] text-zinc-600">Drag the grip to change product order</p>
      </div>
      {pointers.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-zinc-600">
          No product pointers yet — add a product or click the image to add a blank pin.
        </p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2.5">
          {pointers.map((pointer, index) => {
            const isOpen = openIdx === index;
            const linkedProduct = gearItems.find((item) => item.id === pointer.gearId);
            const tileTitle = linkedProduct?.name || pointer.label || "Unlinked pointer";
            return (
              <li
                key={`${pointer.id}-row-${index}`}
                onDragOver={(event) => {
                  if (rowDragFrom === null) return;
                  event.preventDefault();
                  setRowDragOver(index);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (rowDragFrom !== null) reorderPointers(rowDragFrom, index);
                  setRowDragFrom(null);
                  setRowDragOver(null);
                }}
                className={cn(
                  "rounded-2xl border bg-white/[0.03] transition-colors",
                  isOpen ? "border-saffron-400/40" : "border-white/[0.07]",
                  rowDragOver === index && rowDragFrom !== null && rowDragFrom !== index && "border-saffron-400 bg-saffron-400/10",
                  rowDragFrom === index && "opacity-50"
                )}
              >
                <div className="flex flex-wrap items-center gap-2 p-2.5">
                  <button
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      setRowDragFrom(index);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", String(index));
                    }}
                    onDragEnd={() => {
                      setRowDragFrom(null);
                      setRowDragOver(null);
                    }}
                    aria-label={`Drag ${tileTitle} to reorder`}
                    title="Drag to reorder products"
                    className="grid h-8 w-6 shrink-0 cursor-grab place-items-center text-zinc-600 active:cursor-grabbing"
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenIdx(isOpen ? null : index)}
                    aria-expanded={isOpen}
                    aria-label={`Edit ${tileTitle}`}
                    title="Click to edit this product and its pointer"
                    className="flex min-w-[8rem] flex-1 items-center gap-2 text-left"
                  >
                    <span className="aspect-square grid h-6 w-6 shrink-0 place-items-center rounded-full bg-saffron-400 text-[10px] font-bold text-on-gold">{index + 1}</span>
                    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.05]">
                      {linkedProduct?.image ? (
                        <img src={linkedProduct.image} alt="" className="h-full w-full object-contain" />
                      ) : (
                        <Crosshair className="h-4 w-4 text-zinc-600" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">{tileTitle}</span>
                      <span className="block truncate text-[11px] text-zinc-500">{pointer.zone} · x {position(pointer.x)}% · y {position(pointer.y)}%</span>
                    </span>
                  </button>
                  <div className="ml-auto flex basis-full shrink-0 items-center justify-end gap-1 sm:basis-auto">
                    <button
                      type="button"
                      onClick={() => reorderPointers(index, index - 1)}
                      disabled={index === 0}
                      aria-label={`Move ${tileTitle} up`}
                      className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 hover:bg-white/[0.12] hover:text-white disabled:opacity-30"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => reorderPointers(index, index + 1)}
                      disabled={index === pointers.length - 1}
                      aria-label={`Move ${tileTitle} down`}
                      className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 hover:bg-white/[0.12] hover:text-white disabled:opacity-30"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <Switch on={isOn(pointer)} onChange={(enabled) => onItemToggle(index, enabled)} label={`Show ${tileTitle}`} />
                    <button
                      type="button"
                      onClick={() => removePointer(index)}
                      aria-label={`Remove ${tileTitle}`}
                      className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 hover:bg-red-500/15 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div className="grid gap-3.5 border-t border-white/[0.07] p-3.5">
                    {fields.map((field) => (
                      <FieldRow
                        key={field.path}
                        field={field}
                        value={getAt(pointer, field.path)}
                        onChange={(value) => updatePointer(index, field.path, value)}
                      />
                    ))}
                    <div className="grid gap-3 border-t border-white/[0.08] pt-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300">{linkedProduct ? "Product details" : "Link a product"}</p>
                          <p className="mt-1 text-[11px] text-zinc-600">This product tile owns its image, description, specs, price and buy link.</p>
                        </div>
                        {!linkedProduct && (
                          <button
                            type="button"
                            onClick={() => onAddProduct(index)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-saffron-400 px-3 py-2 text-[11px] font-bold text-on-gold hover:brightness-110"
                          >
                            <Plus className="h-3 w-3" /> Create product here
                          </button>
                        )}
                      </div>
                      <label className="grid gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                        Linked product
                        <select
                          value={pointer.gearId ?? ""}
                          onChange={(event) => linkProduct(index, event.target.value)}
                          aria-label={`Product linked to ${pointer.label}`}
                          className={cn(inputCls, "normal-case tracking-normal")}
                        >
                          <option value="">Auto-map by gear zone</option>
                          {gearItems.map((item, itemIndex) => (
                            <option key={`${item.id ?? item.name}-${itemIndex}`} value={item.id ?? ""}>
                              {item.name || item.category || `Gear item ${itemIndex + 1}`}
                            </option>
                          ))}
                        </select>
                      </label>
                      {linkedProduct ? (
                        <div className="grid gap-3 rounded-xl border border-white/[0.07] bg-black/20 p-3">
                          <p className="text-[11px] font-semibold text-saffron-200">Editing · {linkedProduct.name || linkedProduct.category}</p>
                          {GEAR_ITEM_FIELDS.map((field) => (
                            <FieldRow
                              key={`product-${field.path}`}
                              field={field}
                              value={getAt(linkedProduct, field.path)}
                              onChange={(value) => onGearItemChange(linkedProduct.id ?? "", field.path, value)}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-zinc-600">
                          Create a product here or select an existing one; its fields will appear inside this tile.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/* ═══════════════ Countdown reveal picker ═══════════════ */

export function RevealPicker({
  value,
  sections,
  onChange,
}: {
  value: unknown;
  sections: { id: string; label: string; type: string; enabled: boolean }[];
  onChange: (ids: string[]) => void;
}) {
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const options = sections.filter((s) => s.type !== "countdown" && s.type !== "maintenance");

  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
        Sections to show after zero
      </label>
      <p className="mb-3 text-[11px] leading-relaxed text-zinc-600">
        Tick one or more sections to reveal at zero. If a selected section is already ON, you will be asked to switch it OFF before setting the countdown.
      </p>
      {options.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 px-4 py-4 text-center text-xs text-zinc-600">
          No sections to choose from.
        </p>
      ) : (
        <div className="grid gap-2">
          {options.map((s) => {
            const on = ids.includes(s.id);
            return (
              <label
                key={s.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors",
                  on ? "border-saffron-400/40 bg-saffron-400/10" : "border-white/10 bg-white/[0.03] hover:border-white/20"
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onChange(on ? ids.filter((x) => x !== s.id) : [...ids, s.id])}
                  className="h-4 w-4 accent-[#f5b301]"
                />
                <span className="flex-1 text-sm text-zinc-200">{s.label}</span>
                <span className="text-[10px] text-zinc-500">{s.enabled ? "on now" : "off now"}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Compact live status shown at the top of the Countdown editor. */
/** Splits a millisecond span into a compact "2d 3h 4m 5s" string. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const total = Math.floor(ms / 1000);
  return [
    total >= 86400 ? `${Math.floor(total / 86400)}d` : "",
    total >= 3600 ? `${Math.floor((total % 86400) / 3600)}h` : "",
    total >= 60 ? `${Math.floor((total % 3600) / 60)}m` : "",
    `${total % 60}s`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Counts up from a timestamp, ticking once a second. */
function useElapsed(sinceIso: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!sinceIso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sinceIso]);
  const start = Date.parse(sinceIso ?? "");
  const valid = Number.isFinite(start);
  const span = valid ? Math.max(0, now - start) : 0;
  return {
    valid,
    span,
    days: Math.floor(span / 86400000),
    hours: Math.floor((span / 3600000) % 24),
    minutes: Math.floor((span / 60000) % 60),
    seconds: Math.floor((span / 1000) % 60),
  };
}

/** D/H/M/S plates. .cd-chip / .cd-ink keep them readable on both themes. */
function TimePlates({
  units,
  label,
  ariaLabel,
}: {
  units: { value: number; label: string }[];
  label: string;
  ariaLabel: string;
}) {
  return (
    <div className="text-right">
      <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">{label}</p>
      <div role="timer" aria-label={ariaLabel} className="flex gap-1.5">
        {units.map((u) => (
          <span key={u.label} className="cd-chip rounded-lg px-2 py-1.5 text-center">
            <span className="cd-ink block font-mono text-sm font-bold tabular-nums">
              {String(u.value).padStart(2, "0")}
            </span>
            <span className="block text-[8px] font-bold uppercase text-zinc-600">{u.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Maintenance status: how long the site has been offline, or how long the last
 * outage lasted. Dashboard only — the public page carries no timer.
 */
function MaintenanceStatusPanel({
  data,
  enabled,
  onClearSchedule,
}: {
  data: MaintenanceData;
  enabled: boolean;
  onClearSchedule: () => void;
}) {
  const scheduledAt = data.scheduledAt ?? "";
  const startedAt = data.startedAt ?? "";
  const endedAt = data.endedAt ?? "";

  const timer = useCountdown(scheduledAt);
  const elapsed = useElapsed(startedAt);

  const live = Boolean(enabled);
  const scheduled = !live && timer.valid && !timer.done;
  const lastSpan = !live && startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : NaN;
  const ended = !live && Number.isFinite(lastSpan) && lastSpan >= 0;

  const when = (iso: string) =>
    iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "medium" }) : "";

  const heading = live
    ? "Maintenance is live"
    : scheduled
      ? "Scheduled to go offline"
      : ended
        ? "Last maintenance window"
        : "No schedule set";

  const detail = live
    ? startedAt
      ? `Offline since ${when(startedAt)}`
      : "Visitors see the maintenance page now."
    : scheduled
      ? `The site takes itself offline on ${when(scheduledAt)}.`
      : ended
        ? `${when(startedAt)} → ${when(endedAt)}`
        : "Pick a date and time below to switch maintenance on automatically.";

  const plates = live
    ? [
        { value: elapsed.days, label: "D" },
        { value: elapsed.hours, label: "H" },
        { value: elapsed.minutes, label: "M" },
        { value: elapsed.seconds, label: "S" },
      ]
    : scheduled
      ? [
          { value: timer.days, label: "D" },
          { value: timer.hours, label: "H" },
          { value: timer.minutes, label: "M" },
          { value: timer.seconds, label: "S" },
        ]
      : null;

  return (
    <div
      className={cn(
        "mb-5 rounded-2xl border p-4 transition-colors",
        live
          ? "border-emerald-400/40 bg-emerald-400/[0.08]"
          : scheduled
            ? "border-saffron-400/25 bg-saffron-400/[0.06]"
            : "border-white/[0.07] bg-white/[0.03]",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p
            className={cn(
              "flex items-center gap-1.5 text-xs font-semibold",
              live ? "text-emerald-300" : "text-white",
            )}
          >
            {live ? (
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            ) : scheduled ? (
              <CalendarClock className="h-3.5 w-3.5 text-saffron-400" />
            ) : (
              <CalendarClock className="h-3.5 w-3.5 text-zinc-500" />
            )}
            <span>{heading}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">{detail}</p>
        </div>
        {plates ? (
          <TimePlates
            units={plates}
            label={live ? "Offline for" : "Goes offline in"}
            ariaLabel={live ? "Time since maintenance started" : "Time until scheduled maintenance"}
          />
        ) : (
          <span
            className={cn(
              "rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider",
              ended ? "bg-emerald-400/20 text-emerald-300" : "bg-white/[0.06] text-zinc-500",
            )}
          >
            {ended ? formatDuration(lastSpan) : "Not scheduled"}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-3">
        <p className="text-[11px] text-zinc-500">
          {live
            ? `Total time offline: ${formatDuration(elapsed.span)}`
            : ended
              ? `Site was down for ${formatDuration(lastSpan)}`
              : scheduled
                ? "The schedule clears itself once it fires."
                : "Switch the section on to start recording an outage."}
        </p>
        {scheduled ? (
          <button
            type="button"
            onClick={onClearSchedule}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3.5 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-white/[0.12] hover:text-white"
          >
            <X className="h-3 w-3" /> Cancel schedule
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CountdownEditorStatus({
  data,
  enabled,
  sections,
}: {
  data: CountdownData;
  enabled: boolean;
  sections: SectionEntry[];
}) {
  const timer = useCountdown(data.targetDate);
  const names = (data.revealSectionIds ?? [])
    .map((id) => sections.find((s) => s.id === id)?.label)
    .filter((v): v is string => Boolean(v));

  const units = [
    { value: timer.days, label: "D" },
    { value: timer.hours, label: "H" },
    { value: timer.minutes, label: "M" },
    { value: timer.seconds, label: "S" },
  ];

  const isDone = timer.done || (timer.valid && timer.totalMs <= 0);

  return (
    <div
      className={cn(
        "mb-5 rounded-2xl border p-4 transition-colors",
        isDone
          ? "border-emerald-400/40 bg-emerald-400/[0.08]"
          : "border-saffron-400/25 bg-saffron-400/[0.06]"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={cn("text-xs font-semibold flex items-center gap-1.5", isDone ? "text-emerald-300" : "text-white")}>
            {isDone ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span>Timer Finished · Complete</span>
              </>
            ) : (
              <span>Countdown preview</span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {isDone ? "Sections revealed · Checkmarks reset to uncheck" : enabled ? "Draft toggle is ON" : "Draft toggle is OFF"}
          </p>
        </div>
        {timer.valid && !isDone ? (
          <div role="timer" aria-label="Countdown editor preview" className="flex gap-1.5">
            {units.map((u) => (
              /* .cd-chip / .cd-ink keep the preview readable on both themes:
                 pale plate with a gold edge in light, dark plate in dark. */
              <span key={u.label} className="cd-chip rounded-lg px-2 py-1.5 text-center">
                <span className="cd-ink block font-mono text-sm font-bold tabular-nums">
                  {String(u.value).padStart(2, "0")}
                </span>
                <span className="block text-[8px] font-bold uppercase text-zinc-600">{u.label}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className={cn(
            "rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider",
            isDone ? "bg-emerald-400/20 text-emerald-300" : "bg-white/[0.06] text-zinc-500"
          )}>
            {isDone ? "Finished · Reset" : "Set a target date"}
          </span>
        )}
      </div>
      <div className="mt-3 border-t border-white/[0.07] pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
          At zero
        </p>
        <p className={cn("mt-1 text-xs leading-relaxed", isDone ? "text-emerald-200/80" : "text-zinc-400")}>
          {isDone
            ? "Countdown ended. Selected sections were enabled and checkboxes reset."
            : names.length
              ? names.join(" · ")
              : "No sections selected yet"}
        </p>
      </div>
    </div>
  );
}

/* ═══════════════ Odometer editor (The Machine) ═══════════════ */

/** Ladder chip for the dashboard: cleared, in progress or still ahead. */
function OdometerChip({ value, state }: { value: number; state: MilestoneState }) {
  return (
    <span
      title={`${value.toLocaleString("en-IN")} km — ${state === "cleared" ? "cleared" : state === "active" ? "in progress" : "upcoming"}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-1 font-mono text-[10px] font-bold",
        state === "cleared" && "border-saffron-400/45 bg-saffron-400/15 text-saffron-300",
        state === "active" && "border-saffron-400 bg-saffron-400 text-on-gold",
        state === "upcoming" && "border-white/10 bg-white/[0.04] text-zinc-500"
      )}
    >
      {state === "cleared" && <Check className="h-2.5 w-2.5" />}
      {formatMilestone(value)}
    </span>
  );
}

/**
 * The Machine's odometer. One reading chases a ladder of milestones: the
 * target follows the reading, so crossing 100 km hands the bike 500 km and so
 * on up to 50,000 km. Past the last built-in rung the rider files their own
 * targets here, and those join the same ladder.
 */
export function OdometerEditor({
  km,
  extraMilestones,
  updatedAt,
  onChange,
}: {
  km: number;
  extraMilestones: number[];
  updatedAt: string;
  onChange: (patch: { km?: number; extraMilestones?: number[] }) => void;
}) {
  const progress = resolveOdometer(km, extraMilestones);
  const [reading, setReading] = useState(String(km));
  const [rung, setRung] = useState("");

  // Re-sync when the value changes elsewhere (reset to original, undo), but
  // never while the typed text still means the same number.
  useEffect(() => {
    setReading((prev) => (Number(prev) === km ? prev : String(km)));
  }, [km]);

  const commitReading = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "");
    setReading(digits);
    onChange({ km: Number(digits) || 0 });
  };

  const addRung = () => {
    const value = Math.round(Number(rung.replace(/[^0-9]/g, "")) || 0);
    if (value <= 0) return;
    if (!extraMilestones.includes(value)) {
      onChange({ extraMilestones: [...extraMilestones, value].sort((a, b) => a - b) });
    }
    setRung("");
  };

  const logged = updatedAt
    ? new Date(updatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "";

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-white">
        <Gauge className="h-3.5 w-3.5 text-saffron-400" /> Odometer &amp; milestones
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
        The reading chases a ladder: 100 → 500 → 2,000 km … up to 50,000 km. Cross a rung and the
        next one takes over by itself — past the half-lakh mark you file your own rungs below.
      </p>

      <label
        htmlFor="odo-reading"
        className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500"
      >
        Current odometer reading (km)
      </label>
      <input
        id="odo-reading"
        inputMode="numeric"
        value={reading}
        onChange={(e) => commitReading(e.target.value)}
        placeholder="e.g. 32000"
        className={cn(inputCls, "mt-1.5")}
      />

      <div
        className={cn(
          "mt-4 rounded-xl border p-3.5 transition-colors",
          progress.complete
            ? "border-emerald-400/40 bg-emerald-400/[0.08]"
            : "border-saffron-400/25 bg-saffron-400/[0.06]"
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <p
            className={cn(
              "text-xs font-semibold",
              progress.complete ? "text-emerald-300" : "text-white"
            )}
          >
            {progress.complete
              ? "Every rung cleared"
              : `Chasing ${progress.target.toLocaleString("en-IN")} km`}
          </p>
          <span className="font-mono text-xs font-bold text-saffron-300">{progress.pct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="h-full rounded-full bg-saffron-400 transition-all duration-500"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
          {progress.complete
            ? "Add your next target below to keep the counter moving."
            : `${progress.travelled.toLocaleString("en-IN")} of ${progress.stretch.toLocaleString("en-IN")} km on this stretch · ${progress.remaining.toLocaleString("en-IN")} km to go`}
        </p>
        {logged && <p className="mt-1.5 text-[10px] text-zinc-600">Last logged {logged}</p>}
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {progress.ladder.map((m) => (
          <OdometerChip key={m.value} value={m.value} state={m.state} />
        ))}
      </div>

      {/* Every rung listed with how much of that stretch is already ridden. */}
      <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.07]">
        <div className="max-h-64 overflow-y-auto no-scrollbar">
          <table className="w-full border-collapse text-left text-[11px]">
            <thead className="sticky top-0 bg-ink-900/95 text-[9px] uppercase tracking-[0.14em] text-zinc-500 backdrop-blur-md">
              <tr>
                <th className="px-3 py-2 font-semibold">Milestone</th>
                <th className="px-3 py-2 font-semibold">Ridden</th>
                <th className="px-3 py-2 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {progress.ladder.map((m) => (
                <tr
                  key={m.value}
                  className={cn(
                    "border-t border-white/[0.06]",
                    m.state === "active" && "bg-saffron-400/[0.07]"
                  )}
                >
                  <td className="whitespace-nowrap px-3 py-2 font-mono font-bold text-zinc-200">
                    {m.value.toLocaleString("en-IN")} km
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-400">
                    {m.travelled.toLocaleString("en-IN")} / {m.stretch.toLocaleString("en-IN")}
                    {m.state === "active" && (
                      <span className="ml-2 text-saffron-300">{m.pct}%</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {m.state === "cleared" && (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                        <Check className="h-3 w-3" /> Cleared
                      </span>
                    )}
                    {m.state === "active" && (
                      <button
                        type="button"
                        onClick={() => onChange({ km: m.value })}
                        title={`Log the reading as ${m.value.toLocaleString("en-IN")} km`}
                        className="rounded-full bg-saffron-400 px-2.5 py-1 text-[10px] font-bold text-on-gold transition-all hover:brightness-110 active:scale-95"
                      >
                        Mark reached
                      </button>
                    )}
                    {m.state === "upcoming" && (
                      <span className="text-zinc-600">
                        {Math.max(0, m.value - progress.reading).toLocaleString("en-IN")} km away
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 border-t border-white/[0.07] pt-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
          Past 50,000 km — your own rungs
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={rung}
            inputMode="numeric"
            onChange={(e) => setRung(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              addRung();
            }}
            placeholder="e.g. 60000"
            aria-label="New milestone in kilometres"
            className={cn(inputCls, "flex-1 py-2 text-sm")}
          />
          <button
            type="button"
            onClick={addRung}
            disabled={!rung}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-saffron-400 px-4 py-2 text-xs font-bold text-on-gold shadow-lg shadow-saffron-400/25 transition-all duration-300 hover:brightness-110 active:scale-95 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
        {extraMilestones.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {extraMilestones.map((value) => (
              <li
                key={value}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 font-mono text-[10px] font-bold text-zinc-300"
              >
                {value.toLocaleString("en-IN")} km
                <button
                  type="button"
                  onClick={() =>
                    onChange({ extraMilestones: extraMilestones.filter((v) => v !== value) })
                  }
                  aria-label={`Remove the ${value.toLocaleString("en-IN")} km milestone`}
                  className="text-zinc-500 transition-colors hover:text-red-400"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ═══════════════ Sections tab ═══════════════ */

function SectionsPanel() {
  const { content, draft, updateDraft, resetContent, logAction, completeCountdown } = useSite();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [countdownConflict, setCountdownConflict] = useState<{
    entry: SectionEntry;
    action: string;
  } | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // On wide screens the editor is sticky beside the list, so it's already in
  // view. On narrow screens it stacks below the list, so bring it into view.
  useEffect(() => {
    if (!selectedId || !editorRef.current) return;
    const stacked = !window.matchMedia("(min-width: 1280px)").matches;
    if (stacked) {
      editorRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedId]);

  const sections = draft.sections;
  const selected = sections.find((s) => s.id === selectedId) ?? null;

  // Collective switch: every section except Countdown Timer and Maintenance Mode,
  // which keep their own rules.
  const isBulkTarget = (s: SectionEntry) => s.type !== "countdown" && s.type !== "maintenance";
  const bulkIds = sections.filter(isBulkTarget).map((s) => s.id);
  const bulkOn = sections.some((s) => isBulkTarget(s) && s.enabled);
  const setBulk = (enabled: boolean) => {
    logAction(`${enabled ? "Enabled" : "Disabled"} all sections (except countdown & maintenance)`);
    updateDraft((c) => cascadeAllSections(c, enabled));
  };

  // Countdown completion follows the last *published* timer. Draft edits must
  // never reveal sections before the countdown is saved and actually expires.
  const cdEntry = sections.find((s) => s.type === "countdown");
  const savedCdEntry = content.sections.find((s) => s.type === "countdown");
  const draftCountdownFinished = useCountdownFinished(String(cdEntry?.data.targetDate ?? ""));
  const savedCountdownFinished = useCountdownFinished(String(savedCdEntry?.data.targetDate ?? ""));
  const revealIds = (cdEntry?.data.revealSectionIds as string[] | undefined) ?? [];

  // Once the timer has passed, reconcile the switches in the draft: countdown
  // off, selected sections on. This runs once per target date, so it works
  // whether the timer finished while the dashboard was open or long before you
  // opened it. It never repeats after that, so re-enabling the countdown
  // yourself is never overridden.
  const reconciledTarget = useRef<string | null>(null);
  const targetKey = String(savedCdEntry?.data.targetDate ?? "");
  const revealKey = ((savedCdEntry?.data.revealSectionIds as string[] | undefined) ?? []).join(",");
  useEffect(() => {
    if (!savedCdEntry?.enabled || !savedCountdownFinished || !targetKey) return;
    if (reconciledTarget.current === targetKey) return;
    if (completeCountdown(targetKey)) reconciledTarget.current = targetKey;
  }, [savedCdEntry?.enabled, savedCountdownFinished, targetKey, revealKey, completeCountdown]);

  const requestCountdownSetup = (entry: SectionEntry, action: string) => {
    const activeTargets = getActiveCountdownTargets(sections, entry.data.revealSectionIds);
    if (entry.enabled && activeTargets.length > 0) {
      // Defer the attempted change. Nothing turns off until the admin confirms.
      setCountdownConflict({ entry: structuredClone(entry), action });
      return;
    }
    logAction(action);
    updateDraft((c) => ({
      ...c,
      sections: c.sections.map((s) => s.id === entry.id ? entry : s),
    }));
  };

  const confirmCountdownReset = () => {
    if (!countdownConflict) return;
    const { entry, action } = countdownConflict;
    const activeTargets = getActiveCountdownTargets(sections, entry.data.revealSectionIds);
    activeTargets.forEach((target) => logAction(`Disabled: ${target.label} (countdown setup)`));
    logAction(action);
    logAction("Configured countdown with inactive reveal sections");
    updateDraft((c) => resetActiveTargetsForCountdown(c, entry));
    setCountdownConflict(null);
  };

  const cancelPendingCountdown = () => {
    if (!countdownConflict) return;
    const id = countdownConflict.entry.id;
    updateDraft((c) => cancelCountdownSetup(c, content, id));
    logAction("Cancelled countdown setup");
    setCountdownConflict(null);
  };

  /** Visitors see a locked card; signed-in accounts see the section. */
  const setMembersOnly = (id: string, membersOnly: boolean) => {
    const entry = sections.find((s) => s.id === id);
    if (!entry) return;
    logAction(`${membersOnly ? "Members only" : "Public"}: ${entry.label}`);
    updateDraft((c) => ({
      ...c,
      sections: c.sections.map((s) => (s.id === id ? { ...s, membersOnly } : s)),
    }));
  };

  const setEnabled = (id: string, enabled: boolean) => {
    const s = sections.find((x) => x.id === id);
    if (s?.type === "countdown" && enabled) {
      requestCountdownSetup({ ...s, enabled: true }, `Enabled: ${s.label}`);
      return;
    }
    if (s) logAction(`${enabled ? "Enabled" : "Disabled"}: ${s.label}`);
    updateDraft((c) => cascadeSection(c, id, enabled));
  };

  const move = (i: number, dir: -1 | 1) => {
    const s = sections[i];
    if (s) logAction(`Reordered position of: ${s.label}`);
    updateDraft((c) => {
      const arr = [...c.sections];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return c;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...c, sections: arr };
    });
  };

  const addSection = () => {
    logAction("Added a composed section");
    const id = `sec-custom-${Date.now()}`;
    updateDraft((c) => ({
      ...c,
      sections: [
        ...c.sections,
        {
          id,
          type: "custom",
          label: "New section",
          enabled: true,
          // A section starts as an empty canvas plus one heading and one
          // paragraph, so it is immediately editable rather than blank.
          data: {
            blocks: [
              { ...createBlock("heading"), data: { eyebrow: "", text: "A fresh section", level: "h2", align: "left" } },
              {
                ...createBlock("text"),
                data: {
                  body: "Describe it here — visitors will see this right on the page.",
                  align: "left",
                  columns: "1",
                  size: "base",
                },
              },
            ],
          },
        },
      ],
    }));
    setSelectedId(id);
  };

  const removeSection = (id: string) => {
    logAction("Removed a Custom Section block");
    updateDraft((c) => ({ ...c, sections: c.sections.filter((s) => s.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  };

  // Any edit inside a section's editor switches that section on, so what you
  // edit is always live in the draft. Only the edited section is affected.
  // Making a content change always leaves that section switched on.
  const ensureOn = (c: SiteContent, id: string): SiteContent =>
    c.sections.find((x) => x.id === id)?.enabled ? c : cascadeSection(c, id, true);

  // Switch one child item on or off (feature, destination, stat, plan, pointer...).
  const toggleChild = (sectionId: string, key: string, index: number, on: boolean) => {
    const s = sections.find((x) => x.id === sectionId);
    if (s) logAction(`${on ? "Enabled" : "Disabled"} item #${index + 1} in ${s.label}`);
    updateDraft((c) => cascadeChild(c, sectionId, key, index, on));
  };

  const touchEnable = (id: string) => {
    const s = sections.find((x) => x.id === id);
    if (s && !s.enabled) logAction(`Enabled: ${s.label}`);
  };

  const renameSection = (id: string, label: string) => {
    const entry = sections.find((s) => s.id === id);
    if (entry?.type === "countdown") {
      if (entry.label === label) return;
      const saved = content.sections.find((s) => s.id === id);
      const changed = label !== saved?.label ||
        JSON.stringify(entry.data) !== JSON.stringify(saved?.data ?? defaultDataFor("countdown"));
      requestCountdownSetup(
        { ...entry, label, enabled: changed ? true : Boolean(saved?.enabled) },
        `Renamed section label to: ${label}`
      );
      return;
    }
    touchEnable(id);
    logAction(`Renamed section label to: ${label}`);
    updateDraft((c) => {
      const next = ensureOn(c, id);
      return { ...next, sections: next.sections.map((s) => (s.id === id ? { ...s, label } : s)) };
    });
  };

  const writeSectionData = (id: string, nextData: Record<string, unknown>) => {
    const s = sections.find((x) => x.id === id);
    if (!s) return;
    // Focus/no-op changes do not arm the countdown.
    if (JSON.stringify(nextData) === JSON.stringify(s.data)) return;
    if (s.type === "countdown") {
      const saved = content.sections.find((x) => x.id === id);
      const changedFromSaved =
        s.label !== saved?.label ||
        JSON.stringify(nextData) !== JSON.stringify(saved?.data ?? defaultDataFor("countdown"));
      requestCountdownSetup(
        { ...s, enabled: changedFromSaved ? true : Boolean(saved?.enabled), data: nextData },
        `Edited content of: ${s.label}`
      );
      return;
    }
    logAction(`Edited content of: ${s.label}`);
    updateDraft((c) => {
      touchEnable(id);
      const next = ensureOn(c, id);
      return {
        ...next,
        sections: next.sections.map((entry) => (entry.id === id ? { ...entry, data: nextData } : entry)),
      };
    });
  };

  const setSectionData = (id: string, path: string, v: unknown) => {
    const s = sections.find((x) => x.id === id);
    if (!s) return;
    writeSectionData(id, setAt(s.data, path, v) as Record<string, unknown>);
  };

  /**
   * Odometer writes touch two fields at once (the reading and its bookkeeping),
   * so they go through the shared writer as one revision.
   */
  const setMachineOdometer = (patch: { km?: number; extraMilestones?: number[] }) => {
    if (!selected) return;
    const data = selected.data as unknown as MachineData;
    const next: MachineData = {
      ...data,
      km: typeof patch.km === "number" ? Math.max(0, Math.round(patch.km)) : data.km,
      odometer: {
        ...(data.odometer ?? {}),
        ...(patch.extraMilestones ? { extraMilestones: patch.extraMilestones } : {}),
        updatedAt: new Date().toISOString(),
      },
    };
    writeSectionData(selected.id, next as unknown as Record<string, unknown>);
  };

  // A `custom` section carrying a `blocks` array is composed from the
  // component palette. The older fixed fields still drive sections that were
  // built before the composer existed, so those keep rendering untouched.
  const composedBlocks =
    selected && Array.isArray(selected.data?.blocks) ? (selected.data.blocks as SectionBlock[]) : null;

  const fields = selected
    ? selected.type === "custom"
      ? composedBlocks
        ? []
        : CUSTOM_FIELDS
      : SECTION_FIELDS[selected.type]
    : [];

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[400px_1fr]">
      {/* list */}
      <div>
        {sections.some((s) => s.type === "maintenance" && s.enabled) && (
          <div
            role="alert"
            className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4"
          >
            <p className="flex items-center gap-2 text-xs font-bold text-amber-300">
              <RefreshCcw className="h-3.5 w-3.5" /> Maintenance mode is ON
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200/80">
              Visitors see only the maintenance page — no header, no footer, no other sections.
              Turn Maintenance Mode off here to bring the site back.
            </p>
          </div>
        )}
        <div className="mb-4 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-xs text-zinc-500">
              {sections.filter((s) => s.enabled).length} of {sections.length} visible — order matches the page
            </p>
            <button
              type="button"
              onClick={() => setBulk(!bulkOn)}
              disabled={bulkIds.length === 0}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:bg-white/[0.12] disabled:opacity-40"
            >
              <Power className="h-3 w-3" />
              {bulkOn ? "Disable all sections" : "Enable all sections"}
            </button>
            <p className="mt-1 text-[10px] text-zinc-600">
              Applies to every section except Countdown Timer and Maintenance Mode.
            </p>
          </div>
          <button
            onClick={addSection}
            className="inline-flex items-center gap-1.5 rounded-full bg-saffron-400 px-4 py-2 text-xs font-bold text-on-gold shadow-lg shadow-saffron-400/25 transition-all duration-300 hover:brightness-110 active:scale-95"
          >
            <Plus className="h-3.5 w-3.5" /> Add section
          </button>
        </div>
        <div className="flex flex-col gap-2.5">
          {sections.map((entry, i) => (
            <div
              key={entry.id}
              className={cn(
                "rounded-2xl border p-4 transition-all duration-300",
                selectedId === entry.id
                  ? "border-saffron-400/50 bg-white/[0.06]"
                  : "border-white/[0.07] bg-white/[0.02] hover:border-white/15"
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-lg font-display text-[11px] font-bold",
                    entry.enabled
                      ? "bg-white/[0.08] text-zinc-300"
                      : "bg-white/[0.03] text-zinc-600"
                  )}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-semibold", entry.enabled ? "text-white" : "text-zinc-500")}>
                    {entry.label}
                  </p>
                  <p className="text-[11px] text-zinc-600">
                    {entry.type}
                    {entry.type === "custom" ? " · movable block" : ""}
                    {entry.type === "countdown" &&
                      draftCountdownFinished &&
                      (entry.enabled ? " · finished — set a future date to run again" : " · timer finished")}
                    {entry.type !== "countdown" &&
                      !entry.enabled &&
                      revealIds.includes(entry.id) &&
                      " · opens when countdown ends"}
                    {!entry.enabled && " · hidden"}
                    {entry.membersOnly && " · members only"}
                  </p>
                </div>
                <Switch
                  on={entry.enabled}
                  onChange={(v) => setEnabled(entry.id, v)}
                  label={`${entry.enabled ? "Disable" : "Enable"} ${entry.label}`}
                />
              </div>
              <div className="mt-3 flex items-center gap-1.5">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                  className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-30"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === sections.length - 1}
                  aria-label="Move down"
                  className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-30"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setMembersOnly(entry.id, !entry.membersOnly)}
                  aria-label={`${entry.membersOnly ? "Make public" : "Make members only"}: ${entry.label}`}
                  title={entry.membersOnly ? "Members only — click to make public" : "Make this section members only"}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
                    entry.membersOnly
                      ? "bg-saffron-400/15 text-saffron-300 hover:bg-saffron-400/25"
                      : "bg-white/[0.05] text-zinc-400 hover:bg-white/[0.12] hover:text-white"
                  )}
                >
                  {entry.membersOnly ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                  {entry.membersOnly ? "Members" : "Public"}
                </button>
                <button
                  onClick={() => setSelectedId(selectedId === entry.id ? null : entry.id)}
                  className={cn(
                    "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-300",
                    selectedId === entry.id
                      ? "bg-saffron-400/15 text-saffron-300"
                      : "bg-white/[0.05] text-zinc-300 hover:bg-white/[0.12] hover:text-white"
                  )}
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
                {entry.type === "custom" && (
                  <button
                    onClick={() => removeSection(entry.id)}
                    aria-label="Delete custom section"
                    className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 transition-colors hover:bg-red-500/15 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* editor — sticks to the viewport so it's always beside the section you're editing */}
      <div ref={editorRef} className="xl:sticky xl:top-24 xl:self-start">
        {selected ? (
          <div className="rounded-3xl glass p-6 sm:p-7">
            <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-white/[0.07] pb-5">
              <div className="min-w-0 flex-1">
                <input
                  value={selected.label}
                  onChange={(e) => renameSection(selected.id, e.target.value)}
                  aria-label="Section label"
                  className="w-full max-w-xs rounded-lg bg-transparent font-display text-base font-semibold text-white focus:outline-none focus:underline"
                />
                <p className="text-[11px] text-zinc-600">
                  Editing <span className="text-saffron-300">{selected.type}</span> · saves instantly
                  to draft buffer
                </p>
              </div>
              {selected.type !== "custom" ? (
                <button
                  onClick={() => {
                    touchEnable(selected.id);
                    updateDraft((c) => ({
                      ...c,
                      sections: c.sections.map((s) =>
                        s.id === selected.id
                          ? { ...s, enabled: true, data: defaultDataFor(s.type) }
                          : s
                      ),
                    }));
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-4 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/[0.12] hover:text-white"
                >
                  <RefreshCcw className="h-3 w-3" /> Reset to original
                </button>
              ) : null}
              <button
                onClick={() => setSelectedId(null)}
                aria-label="Close editor"
                className="shrink-0 aspect-square grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-zinc-400 transition-colors hover:bg-white/[0.15] hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {selected.type === "maintenance" && (
              <MaintenanceStatusPanel
                data={{
                  ...(defaultDataFor("maintenance") as unknown as MaintenanceData),
                  ...(selected.data as unknown as MaintenanceData),
                }}
                enabled={selected.enabled}
                onClearSchedule={() => setSectionData(selected.id, "scheduledAt", "")}
              />
            )}
            {selected.type === "countdown" && (
              <CountdownEditorStatus
                data={{
                  ...(defaultDataFor("countdown") as unknown as CountdownData),
                  ...(selected.data as unknown as CountdownData),
                }}
                enabled={selected.enabled}
                sections={sections}
              />
            )}
            <div className="grid max-h-[65vh] gap-5 overflow-y-auto pr-2 no-scrollbar">
              {composedBlocks && selected && (
                <BlockComposer
                  blocks={composedBlocks}
                  sectionLabel={selected.label}
                  onChange={(next) => setSectionData(selected.id, "blocks", next)}
                />
              )}
              {fields.map((f) => {
                if (selected.type === "countdown" && f.kind === "reveal") {
                  return (
                    <RevealPicker
                      key="reveal"
                      value={getAt(selected.data, f.path)}
                      sections={sections}
                      onChange={(ids) => setSectionData(selected.id, f.path, ids)}
                    />
                  );
                }
                if (selected.type === "machine" && f.path === "hotspots") {
                  return (
                    <HotspotEditor
                      key="hotspots"
                      spots={(getAt(selected.data, "hotspots") as BikeHotspot[]) ?? []}
                      mainImage={(getAt(selected.data, "mainImage") as string) ?? ""}
                      onChange={(v) => setSectionData(selected.id, "hotspots", v)}
                      onItemToggle={(i, on) => toggleChild(selected.id, "hotspots", i, on)}
                    />
                  );
                }
                if (selected.type === "machine" && f.path === "km") {
                  return (
                    <OdometerEditor
                      key="km"
                      km={Number(getAt(selected.data, "km") ?? 0)}
                      extraMilestones={
                        (getAt(selected.data, "odometer.extraMilestones") as number[] | undefined) ?? []
                      }
                      updatedAt={String(getAt(selected.data, "odometer.updatedAt") ?? "")}
                      onChange={setMachineOdometer}
                    />
                  );
                }
                if (selected.type === "live" && f.path === "stops") {
                  return (
                    <RouteStopsEditor
                      key="stops"
                      stops={(getAt(selected.data, "stops") as LiveStop[]) ?? []}
                      routeGeometry={(getAt(selected.data, "routeGeometry") as LatLng[]) ?? []}
                      routeDistanceKm={Number(getAt(selected.data, "routeDistanceKm") ?? 0)}
                      mapSource={(getAt(selected.data, "mapSource") as MapLinkSource) ?? "google"}
                      onChange={(value) => setSectionData(selected.id, "stops", value)}
                      onGeometryChange={(value) => setSectionData(selected.id, "routeGeometry", value)}
                      onDistanceChange={(value) => setSectionData(selected.id, "routeDistanceKm", value)}
                      onMapSourceChange={(value) => setSectionData(selected.id, "mapSource", value)}
                    />
                  );
                }
                if (selected.type === "riderkit" && f.path === "mapPointers") {
                  const gearItems = Array.isArray(getAt(selected.data, "items")) ? getAt(selected.data, "items") as GearItem[] : [];
                  const pointers = Array.isArray(getAt(selected.data, "mapPointers")) ? getAt(selected.data, "mapPointers") as RiderKitPointer[] : [];
                  const updateRiderKitData = (nextItems: GearItem[], nextPointers: RiderKitPointer[]) => {
                    touchEnable(selected.id);
                    updateDraft((contentDraft) => {
                      const next = ensureOn(contentDraft, selected.id);
                      return {
                        ...next,
                        sections: next.sections.map((section) => section.id === selected.id
                          ? { ...section, enabled: true, data: { ...section.data, items: nextItems, mapPointers: nextPointers } }
                          : section),
                      };
                    });
                  };
                  const onGearItemChange = (gearId: string, path: string, value: unknown) => {
                    const nextItems = gearItems.map((item) => item.id === gearId ? setAt(item, path, value) as GearItem : item);
                    const nextPointers = path === "name"
                      ? pointers.map((pointer) => pointer.gearId === gearId ? { ...pointer, label: String(value ?? "") } : pointer)
                      : pointers;
                    logAction(`Edited The Gear product: ${gearItems.find((item) => item.id === gearId)?.name || gearId}`);
                    updateRiderKitData(nextItems, nextPointers);
                  };
                  const onAddProduct = (pointerIndex?: number) => {
                    const attachedPointer = pointerIndex === undefined ? undefined : pointers[pointerIndex];
                    if (pointerIndex !== undefined && !attachedPointer) return;
                    const zone = attachedPointer?.zone ?? "torso";
                    const categoryByZone: Record<RiderKitPointer["zone"], string> = {
                      head: "Helmet",
                      torso: "Jacket",
                      hands: "Gloves",
                      waist: "Bags & carry",
                      legs: "Riding pants",
                      feet: "Boots",
                      intercom: "Intercom",
                    };
                    const bodyPart = zone === "intercom" ? "Head" : zone[0].toLocaleUpperCase() + zone.slice(1);
                    const name = `New ${categoryByZone[zone].toLocaleLowerCase()} product`;
                    const id = makeGearItemId(name, `${Date.now().toString(36)}-${gearItems.length + 1}`);
                    const newItem: GearItem = {
                      ...GEAR_ITEM_TEMPLATE,
                      id,
                      name,
                      category: categoryByZone[zone],
                      bodyPart,
                      highlights: ["Add a key specification", "Add a second specification"],
                    };
                    const pointByZone: Record<RiderKitPointer["zone"], { x: number; y: number; radius: number }> = {
                      head: { x: 50, y: 16, radius: 8 },
                      torso: { x: 50, y: 40, radius: 12 },
                      hands: { x: 50, y: 67, radius: 9 },
                      waist: { x: 61, y: 57, radius: 8 },
                      legs: { x: 50, y: 71, radius: 12 },
                      feet: { x: 50, y: 91, radius: 9 },
                      intercom: { x: 64, y: 17, radius: 6 },
                    };
                    const nextPointers = pointerIndex === undefined
                      ? [...pointers, { enabled: true, id: `product-pointer-${id}`, label: name, gearId: id, zone, ...pointByZone[zone] }]
                      : pointers.map((pointer, index) => index === pointerIndex ? { ...pointer, gearId: id, label: name } : pointer);
                    logAction(`Added product to The Gear pointer list: ${name}`);
                    updateRiderKitData([...gearItems, newItem], nextPointers);
                  };
                  const onRemovePointer = (pointerIndex: number) => {
                    const pointer = pointers[pointerIndex];
                    const nextPointers = pointers.filter((_, index) => index !== pointerIndex);
                    const nextItems = pointer?.gearId && !nextPointers.some((item) => item.gearId === pointer.gearId)
                      ? gearItems.filter((item) => item.id !== pointer.gearId)
                      : gearItems;
                    logAction(`Removed The Gear pointer: ${pointer?.label ?? `#${pointerIndex + 1}`}`);
                    updateRiderKitData(nextItems, nextPointers);
                  };
                  return (
                    <RiderKitPointerEditor
                      key="riderkit-pointers"
                      pointers={pointers}
                      image={(getAt(selected.data, "image") as string) ?? ""}
                      gearItems={gearItems}
                      onChange={(value) => setSectionData(selected.id, "mapPointers", value)}
                      onItemToggle={(i, on) => toggleChild(selected.id, "mapPointers", i, on)}
                      onGearItemChange={onGearItemChange}
                      onAddProduct={onAddProduct}
                      onRemovePointer={onRemovePointer}
                    />
                  );
                }
                return f.kind === "items" ? (
                  <ItemsField
                    key={f.path}
                    field={f}
                    value={getAt(selected.data, f.path) as unknown[]}
                    onItemToggle={(i, on) => toggleChild(selected.id, f.path, i, on)}
                    onChange={(v) => setSectionData(selected.id, f.path, v)}
                  />
                ) : (
                  <FieldRow
                    key={f.path}
                    field={f}
                    value={getAt(selected.data, f.path)}
                    onChange={(v) => setSectionData(selected.id, f.path, v)}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
            <Pencil className="h-6 w-6 text-zinc-600" />
            <p className="mt-3 text-sm font-semibold text-zinc-400">Pick a section to edit</p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-600">
              Change any text, image or item. Toggle a section off to hide it, or move blocks up and
              down to rearrange the page.
            </p>
          </div>
        )}

        {/* reset all */}
        <div className="mt-6 flex items-center justify-between rounded-2xl border border-white/[0.07] bg-white/[0.02] px-5 py-4">
          <p className="text-xs text-zinc-500">
            Restore every section, menu and setting to the original defaults.
          </p>
          <button
            onClick={() => {
              if (confirmReset) {
                resetContent();
                setConfirmReset(false);
                setSelectedId(null);
              } else {
                setConfirmReset(true);
                setTimeout(() => setConfirmReset(false), 4000);
              }
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-all duration-300",
              confirmReset
                ? "bg-red-500 text-white"
                : "bg-white/[0.06] text-zinc-300 hover:bg-red-500/15 hover:text-red-400"
            )}
          >
            <RefreshCcw className="h-3 w-3" />
            {confirmReset ? "Click again to confirm" : "Reset everything"}
          </button>
        </div>
      </div>
      {countdownConflict && (
        <CountdownSetupDialog
          activeSections={getActiveCountdownTargets(sections, countdownConflict.entry.data.revealSectionIds)}
          onReset={confirmCountdownReset}
          onCancel={cancelPendingCountdown}
        />
      )}
    </div>
  );
}

/* ═══════════════ Header menu tab ═══════════════ */

export function MenuPanel() {
  const { draft, updateDraft, logAction } = useSite();
  // Section-first, one way: a link whose section is switched off reads as
  // disabled in the header. Hiding a link here never touches its section.
  const states = navStates(draft);
  const shownCount = draft.nav.filter((n) => states.get(n.id)?.shown).length;
  const restingCount = draft.nav.filter((n) => !states.get(n.id)?.available).length;

  const setItem = (id: string, patch: Partial<{ label: string; href: string; enabled: boolean }>) => {
    logAction("Edited Header Menu links");
    updateDraft((c) =>
      patch.enabled !== undefined
        ? cascadeNavItem(c, id, patch.enabled)
        : { ...c, nav: c.nav.map((n) => (n.id === id ? { ...n, ...patch } : n)) }
    );
  };

  // The master reads "on" while any link is shown, so one link on lights it up.
  const anyOn = draft.nav.some((n) => n.enabled);
  const setAll = (enabled: boolean) => {
    logAction(`${enabled ? "Enabled" : "Disabled"} all Header Menu links`);
    updateDraft((c) => cascadeNavAll(c, enabled));
  };

  const move = (i: number, dir: -1 | 1) => {
    logAction("Reordered Header Menu items");
    updateDraft((c) => {
      const arr = [...c.nav];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return c;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...c, nav: arr };
    });
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl glass p-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-zinc-200">Header menu</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {shownCount} of {draft.nav.length} links shown · rename, relink, reorder or hide any item
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            A link whose section is switched off reads as disabled in the header.
            {restingCount > 0 && (
              <span className="text-amber-200/80">
                {" "}
                {restingCount} {restingCount === 1 ? "link is" : "links are"} waiting on a section.
              </span>
            )}{" "}
            Hiding a link here never hides its section on the site — a menu is not the page.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold text-zinc-400">
            {anyOn ? "Disable all" : "Enable all"}
          </span>
          <Switch on={anyOn} onChange={setAll} label="Show all header menu links" />
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <RestoreBar scope="header" label="header navigation" />
        <HeaderButtonsEditor />
        {draft.nav.map((n, i) => {
          const state = states.get(n.id);
          return (
          <div
            key={n.id}
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-2xl border p-4 transition-colors",
              n.enabled && state?.available
                ? "border-white/[0.08] bg-white/[0.03]"
                : "border-white/[0.05] bg-white/[0.01]"
            )}
          >
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
                className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-30"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === draft.nav.length - 1}
                aria-label="Move down"
                className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-30"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
            <input
              value={n.label}
              onChange={(e) => setItem(n.id, { label: e.target.value })}
              aria-label="Menu label"
              className={cn(inputCls, "w-40")}
            />
            <input
              value={n.href}
              onChange={(e) => setItem(n.id, { href: e.target.value })}
              aria-label="Menu link"
              placeholder="#anchor or /path or https://…"
              className={cn(inputCls, "min-w-0 flex-1 font-mono text-xs")}
            />
            {!state?.available && (
              <span
                className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-200/90"
                title="Its section is switched off, so the header link is disabled until the section is on again. This switch does not touch the section."
              >
                Section off
              </span>
            )}
            <Switch on={n.enabled} onChange={(v) => setItem(n.id, { enabled: v })} label={`Show ${n.label}`} />
            <button
              onClick={() => {
                logAction(`Removed Header Menu link: ${n.label}`);
                updateDraft((c) => ({ ...c, nav: c.nav.filter((x) => x.id !== n.id) }));
              }}
              aria-label={`Remove ${n.label}`}
              className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 transition-colors hover:bg-red-500/15 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          );
        })}
      </div>
      <button
        onClick={() => {
          logAction("Added a new Header Menu link");
          updateDraft((c) => ({
            ...c,
            nav: [
              ...c.nav,
              {
                id: `nav-${Date.now()}`,
                label: "New link",
                href: "#top",
                enabled: true,
              },
            ],
          }));
        }}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-saffron-400 px-5 py-2.5 text-xs font-bold text-on-gold shadow-lg shadow-saffron-400/25 transition-all duration-300 hover:brightness-110 active:scale-95"
      >
        <Plus className="h-3.5 w-3.5" /> Add menu item
      </button>
    </div>
  );
}

/* ═══════════════ Settings tab ═══════════════ */

function BrandColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="mt-2">
      <ColorPicker label={label} value={value} onChange={onChange} />
    </div>
  );
}

function BrandingPanel() {
  const { brandDraft, setBrandDraft, hasBrandChanges, saveDraft, discardBranding } = useSite();
  const b = brandDraft;
  const set = (patch: Partial<BrandSettings>) => {
    setBrandDraft(patch);
  };

  const isDirty = hasBrandChanges;

  const handleSaveBranding = () => {
    saveDraft("Updated logo & branding");
  };

  return (
    <div className="max-w-3xl">
      <div className="z-20 rounded-3xl border border-white/10 bg-ink-950/95 p-5 backdrop-blur-xl sm:p-6 lg:sticky lg:top-24">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base font-semibold text-white">Live branding preview</h2>
          <span role="status" className="inline-flex items-center gap-1.5 text-[11px] font-medium text-saffron-300">
            {hasBrandChanges ? <Pencil className="h-3 w-3" /> : <Check className="h-3 w-3" />}
            {hasBrandChanges ? "Unsaved preview" : "Saved branding"}
          </span>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="grid min-h-28 place-items-center rounded-2xl border border-[#ffffff1a] bg-[#070707] p-4">
              <BrandLogo brand={b} />
            </div>
            <p className="mt-2 text-center text-[11px] text-zinc-500">On dark background</p>
          </div>
          <div>
            <div className="grid min-h-28 place-items-center rounded-2xl border border-[#1715131a] bg-[#f7f4ed] p-4">
              <BrandLogo brand={b} />
            </div>
            <p className="mt-2 text-center text-[11px] text-zinc-500">On light background</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-zinc-400">
          Logo, text, colours, and size update here as you edit. Your website keeps its saved branding until you save.
        </p>
      </div>

      {/* visibility */}
      <div className="mt-5 rounded-3xl glass p-6">
        <h3 className="font-display text-base font-semibold text-white">What to show</h3>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-200">Logo image</p>
              <p className="text-[11px] text-zinc-500">Your uploaded mark, or the default PB tile</p>
            </div>
            <Switch
              on={b.showLogo}
              onChange={(v) => set({ showLogo: v })}
              label="Show logo image"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-200">Text wordmark</p>
              <p className="text-[11px] text-zinc-500">The "PB from PB" text</p>
            </div>
            <Switch
              on={b.showText}
              onChange={(v) => set({ showText: v })}
              label="Show text wordmark"
            />
          </div>
          {b.showLogo && (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-200">Plain logo</p>
                <p className="text-[11px] text-zinc-500">
                  No rounded tile behind the image. Best for a transparent PNG.
                </p>
              </div>
              <Switch
                on={b.plainLogo}
                onChange={(v) => set({ plainLogo: v })}
                label="Plain logo"
              />
            </div>
          )}
        </div>
      </div>

      {/* logo upload */}
      {b.showLogo && (
        <div className="mt-5 rounded-3xl glass p-6">
          <h3 className="font-display text-base font-semibold text-white">Logo image</h3>
          <div className="mt-4">
            <ImageField value={b.logo} onChange={(v) => set({ logo: v })} />
          </div>
          <div className="mt-4">
            <label htmlFor="brand-logo-height" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Logo size · {b.logoHeight}px
            </label>
            <input
              id="brand-logo-height"
              type="range"
              min={20}
              max={72}
              value={b.logoHeight}
              onChange={(e) => set({ logoHeight: Number(e.target.value) })}
              className="w-full accent-saffron-400"
            />
          </div>
        </div>
      )}

      {/* text + colours */}
      {b.showText && (
        <div className="mt-5 rounded-3xl glass p-6">
          <h3 className="font-display text-base font-semibold text-white">Text &amp; colours</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Each word has its own label and colour.
          </p>
          <div className="mt-4 grid gap-3.5 sm:grid-cols-3">
            {[
              { key: "textPrimary", colorKey: "colorPrimary", label: "Word 1" },
              { key: "textSecondary", colorKey: "colorSecondary", label: "Word 2" },
              { key: "textTertiary", colorKey: "colorTertiary", label: "Word 3" },
            ].map((row) => (
              <div key={row.key}>
                <label htmlFor={`brand-${row.key}`} className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  {row.label}
                </label>
                <input
                  id={`brand-${row.key}`}
                  type="text"
                  value={String(b[row.key as keyof BrandSettings] ?? "")}
                  onChange={(e) => set({ [row.key]: e.target.value } as Partial<BrandSettings>)}
                  className={inputCls}
                />
                <BrandColorInput
                  label={row.label}
                  value={String(b[row.colorKey as keyof BrandSettings] ?? "#ffffff")}
                  onChange={(color) =>
                    set({ [row.colorKey]: color } as Partial<BrandSettings>)
                  }
                />
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                set({
                  colorPrimary: "#ffffff",
                  colorSecondary: "#7a7a8c",
                  colorTertiary: "#ffffff",
                })
              }
              className="rounded-full bg-white/[0.07] px-3.5 py-2 text-[11px] font-semibold text-zinc-300 hover:bg-white/[0.12]"
            >
              Default
            </button>
            <button
              type="button"
              onClick={() =>
                set({
                  colorPrimary: "#f5b301",
                  colorSecondary: "#c3cad6",
                  colorTertiary: "#f5b301",
                })
              }
              className="rounded-full bg-white/[0.07] px-3.5 py-2 text-[11px] font-semibold text-zinc-300 hover:bg-white/[0.12]"
            >
              Hanle gold
            </button>
            <button
              type="button"
              onClick={() =>
                set({
                  colorPrimary: "#ffffff",
                  colorSecondary: "#f5b301",
                  colorTertiary: "#ffffff",
                })
              }
              className="rounded-full bg-white/[0.07] px-3.5 py-2 text-[11px] font-semibold text-zinc-300 hover:bg-white/[0.12]"
            >
              Gold middle
            </button>
          </div>
        </div>
      )}

      {!b.showLogo && !b.showText && (
        <p className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-5 py-4 text-xs text-amber-200">
          Both logo and text are off, so the site falls back to the plain "PB from PB" wordmark.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
        <div className="max-w-sm">
          <p className="text-sm font-semibold text-white">
            {isDirty ? "Ready to save your branding?" : "Your branding is saved"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            {isDirty
              ? "Click Save Branding to publish your logo, text, and colours to the live website."
              : "The navbar and footer are using this saved branding."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {isDirty ? (
            <>
              <button
                type="button"
                onClick={discardBranding}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-3 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white active:scale-95"
              >
                <RefreshCcw className="h-3.5 w-3.5" /> Discard branding
              </button>
              <button
                type="button"
                onClick={handleSaveBranding}
                className="inline-flex items-center gap-2 rounded-full bg-[#f5b301] px-5 py-3 text-sm font-bold text-[#171513] shadow-lg shadow-saffron-400/15 transition-all hover:bg-[#ffce49] active:scale-95 animate-pulse"
              >
                <Save className="h-4 w-4" /> Save Branding
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-3.5 py-1.5 text-xs font-bold text-emerald-400">
                <Check className="h-3.5 w-3.5" /> Up to date
              </span>
              <a
                href="#/"
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-ink-950 transition-transform active:scale-95 shadow-lg shadow-white/5"
              >
                <Eye className="h-4 w-4" /> View Website
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


/* ═══════════════ Accounts & access history ═══════════════ */

const EVENT_LABELS: Record<AuthEvent["event"], string> = {
  signup: "Signed up",
  login: "Signed in",
  logout: "Signed out",
  failed_login: "Failed sign-in",
  password_change: "Password changed",
  user_created: "Account created",
  user_deleted: "Account deleted",
};

function whenLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Anything this browser still holds from the pre-database version. */
function legacySnapshot(): SiteContent | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEYS.content);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SiteContent;
    return parsed?.v === 1 && Array.isArray(parsed.sections) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Accounts, sign-in history, and the one-time import of a site that was saved
 * in this browser before the move to a database.
 */
function AccessPanel() {
  const { account } = useSite();
  const [users, setUsers] = useState<Account[]>([]);
  const [events, setEvents] = useState<AuthEvent[]>([]);
  const [form, setForm] = useState({
    username: "",
    password: "",
    email: "",
    role: "admin" as "admin" | "reader",
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [legacy, setLegacy] = useState<SiteContent | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, log] = await Promise.all([siteApi.listUsers(), siteApi.authEvents(50)]);
      setUsers(list);
      setEvents(log);
    } catch (error) {
      setMsg({ ok: false, text: describeApiError(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
    setLegacy(legacySnapshot());
  }, [refresh]);

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await siteApi.createUser(
        form.username.trim(),
        form.password,
        form.email.trim() || undefined,
        form.role,
      );
      setForm({ username: "", password: "", email: "", role: form.role });
      setMsg({ ok: true, text: "Account created." });
      await refresh();
    } catch (error) {
      setMsg({ ok: false, text: describeApiError(error) });
    } finally {
      setBusy(false);
    }
  };

  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);
  const [pendingDisable, setPendingDisable] = useState<Account | null>(null);

  /**
   * Switch an account off. The server drops every session it had, so the
   * members-only sections close on their very next request — no reload and no
   * waiting for the cookie to expire.
   */
  const setDisabled = async (user: Account, disabled: boolean) => {
    setPendingDisable(null);
    setMsg(null);
    try {
      await siteApi.setUserDisabled(user.id, disabled);
      await refresh();
      setMsg({
        ok: true,
        text: disabled
          ? `${user.username} can no longer sign in and can only read the public site.`
          : `${user.username} can sign in again.`,
      });
    } catch (error) {
      setMsg({ ok: false, text: describeApiError(error) });
    }
  };

  const removeUser = async (user: Account) => {
    setPendingDelete(null);
    try {
      await siteApi.deleteUser(user.id);
      await refresh();
    } catch (error) {
      setMsg({ ok: false, text: describeApiError(error) });
    }
  };

  const importLegacy = async () => {
    if (!legacy) return;
    setBusy(true);
    setMsg(null);
    try {
      const content = normaliseSavedContent(legacy);
      await siteApi.publish({
        content,
        description: "Imported from this browser",
        revisionId: `rev-${Date.now()}`,
      });
      localStorage.removeItem(LEGACY_STORAGE_KEYS.content);
      localStorage.removeItem(LEGACY_STORAGE_KEYS.revisions);
      setLegacy(null);
      setMsg({ ok: true, text: "Imported. Reloading the dashboard with the database copy…" });
      setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setMsg({ ok: false, text: describeApiError(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6">
      <div className="rounded-3xl glass p-6">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold text-white">
          <UserPlus className="h-4 w-4 text-saffron-300" /> Accounts
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          Accounts created here can edit the site (admin) or only read the members-only sections
          (reader). Public sign-up creates readers. Disabling an account signs it out everywhere and
          closes the members-only sections to it — the public site stays open. Passwords are bcrypt
          hashes in the database, never in this browser.
        </p>

        <ul className="mt-4 grid gap-2">
          {users.map((user) => (
            <li key={user.id} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
              <span className="font-display text-sm font-semibold text-white">{user.username}</span>
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                {user.role}
              </span>
              {account?.id === user.id && (
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">you</span>
              )}
              {user.disabled && (
                <span className="rounded-full border border-red-400/25 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-red-300">
                  disabled
                </span>
              )}
              {user.email && <span className="truncate text-xs text-zinc-500">{user.email}</span>}
              {user.role !== "owner" && account?.id !== user.id && (
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPendingDisable(user)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition-colors",
                      user.disabled
                        ? "bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
                        : "bg-white/[0.05] text-zinc-400 hover:bg-amber-400/15 hover:text-amber-200",
                    )}
                    aria-label={`${user.disabled ? "Enable" : "Disable"} ${user.username}`}
                  >
                    {user.disabled ? <Power className="h-3 w-3" /> : <PowerOff className="h-3 w-3" />}
                    {user.disabled ? "Enable" : "Disable"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(user)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    aria-label={`Delete ${user.username}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </li>
          ))}
          {users.length === 0 && <li className="text-xs text-zinc-500">No accounts yet.</li>}
        </ul>

        <form onSubmit={addUser} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            placeholder="Username"
            aria-label="New username"
            className={inputCls}
          />
          <input
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="Email (optional)"
            aria-label="New email"
            className={inputCls}
          />
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            placeholder="Password"
            aria-label="New password"
            className={inputCls}
          />
          <select
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as "admin" | "reader" }))}
            aria-label="New account role"
            className={cn(inputCls, "[&>option]:bg-ink-950")}
          >
            <option value="admin">Admin — can edit the site</option>
            <option value="reader">Reader — members-only access</option>
          </select>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/[0.08] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white hover:text-ink-950 disabled:opacity-60 sm:col-span-2"
          >
            <Plus className="h-4 w-4" /> Add account
          </button>
        </form>
        {msg && (
          <p className={cn("mt-3 text-xs font-medium", msg.ok ? "text-emerald-300" : "text-red-400")}>{msg.text}</p>
        )}
      </div>

      <div className="rounded-3xl glass p-6">
        <h3 className="font-display text-base font-semibold text-white">Access history</h3>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          The last 50 sign-ups, sign-ins, sign-outs and failed attempts, with the address and browser they came from.
        </p>
        <div className="mt-4 max-h-72 overflow-y-auto no-scrollbar">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-ink-950/80 text-[10px] uppercase tracking-[0.14em] text-zinc-500 backdrop-blur">
              <tr>
                <th className="py-2 pr-3 font-semibold">When</th>
                <th className="py-2 pr-3 font-semibold">Event</th>
                <th className="py-2 pr-3 font-semibold">Account</th>
                <th className="py-2 font-semibold">From</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-white/[0.05] text-zinc-400">
                  <td className="whitespace-nowrap py-2 pr-3">{whenLabel(event.createdAt)}</td>
                  <td className={cn("py-2 pr-3 font-medium", event.event === "failed_login" ? "text-red-400" : "text-white")}>
                    {EVENT_LABELS[event.event] ?? event.event}
                    {event.detail ? <span className="ml-1 text-zinc-600">· {event.detail}</span> : null}
                  </td>
                  <td className="py-2 pr-3">{event.username || "—"}</td>
                  <td className="py-2">
                    <span className="font-mono text-[11px]">{event.ip || "—"}</span>
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-zinc-500">Nothing recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pendingDisable && (
        <ConfirmDialog
          title={`${pendingDisable.disabled ? "Enable" : "Disable"} ${pendingDisable.username}?`}
          message={
            pendingDisable.disabled
              ? "They will be able to sign in again and read the members-only sections."
              : "They are signed out everywhere, cannot sign in, and can only read the public site. You can switch them back on at any time."
          }
          confirmLabel={pendingDisable.disabled ? "Enable account" : "Disable account"}
          onConfirm={() => void setDisabled(pendingDisable, !pendingDisable.disabled)}
          onCancel={() => setPendingDisable(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.username}?`}
          message="They are signed out everywhere and the account is removed."
          confirmLabel="Delete account"
          onConfirm={() => void removeUser(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {legacy && (
        <div className="rounded-3xl border border-saffron-300/25 bg-saffron-400/[0.06] p-6">
          <h3 className="font-display text-base font-semibold text-white">Bring this browser's site into the database</h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            This browser still holds a site saved by the old version. Import it once and the database becomes the only copy.
            Anything already published from another device is replaced by what is here.
          </p>
          <button
            type="button"
            onClick={() => void importLegacy()}
            disabled={busy}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-saffron-400 px-5 py-3 font-display text-sm font-semibold text-on-gold shadow-lg shadow-saffron-400/30 transition-all hover:brightness-110 active:scale-95 disabled:opacity-60"
          >
            <Download className="h-4 w-4" /> Import this browser's site
          </button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════ Settings ═══════════════ */

/**
 * One place for everything that belongs to the site as a whole.
 *
 * Settings used to be a short list of leftovers while the logo, the colours,
 * the map and the backups each had their own place in the dashboard — four
 * buttons for one idea. They are all here now, in a short sub-list, so
 * "change how the site looks" and "change how it behaves" both start from the
 * same button. Nothing was rewritten to move: each section renders the same
 * panel as before, so every control keeps doing exactly what it did.
 *
 * The sub-list is deliberately small enough to read at a glance: identity,
 * looks (brand, colours, map, loader), the owner's own account, backups, and
 * the revision history.
 */
type SettingsSection =
  | "identity"
  | "brand"
  | "colours"
  | "map"
  | "loader"
  | "account"
  | "backup"
  | "history";

const SETTINGS_SECTIONS: { id: SettingsSection; label: string; hint: string; icon: typeof List }[] = [
  {
    id: "identity",
    label: "Site & sign-up",
    hint: "The website title, and who is allowed to create an account.",
    icon: Settings,
  },
  {
    id: "brand",
    label: "Logo & brand",
    hint: "The logo, the wordmark beside it, and the colour it is drawn in.",
    icon: ImageIcon,
  },
  {
    id: "colours",
    label: "Theme colours",
    hint: "The dark and light colour sets the whole site is painted with.",
    icon: Palette,
  },
  {
    id: "map",
    label: "Map look",
    hint: "One basemap for every map on the site — the tracker, the live page and a member's rides.",
    icon: MapIcon,
  },
  {
    id: "loader",
    label: "Loader screen",
    hint: "The mark shown for the moment while the site loads.",
    icon: Play,
  },
  {
    id: "account",
    label: "Password & accounts",
    hint: "Your own password, and who may edit the site.",
    icon: KeyRound,
  },
  {
    id: "backup",
    label: "Backups",
    hint: "The nightly archive of everything, plus exporting and importing the content.",
    icon: DatabaseBackup,
  },
  {
    id: "history",
    label: "Revision history",
    hint: "Every save, what changed, and how to go back to an earlier one.",
    icon: History,
  },
];

/** A quiet line under a section heading: what this panel changes, and where. */
function SectionNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-[11px] leading-relaxed text-zinc-500">
      {children}
    </p>
  );
}

/**
 * The Settings page: a short sub-list on the left, the section on the right.
 *
 * The list becomes a row of buttons on a narrow screen so nothing is hidden
 * behind a menu, and sticks to the top on a wide one so switching sections
 * never means scrolling back.
 */
/**
 * A backup holds every account's password hash, every email address and the
 * database password, so it belongs to the owner alone — the server refuses it
 * for anybody else, and the dashboard does not offer it either. Everybody can
 * still change their own password: that part of the account section stays.
 */
const OWNER_ONLY_SECTIONS: SettingsSection[] = ["backup"];

function SettingsPanel() {
  const { account } = useSite();
  const owner = account?.role === "owner";
  const sections = owner
    ? SETTINGS_SECTIONS
    : SETTINGS_SECTIONS.filter((s) => !OWNER_ONLY_SECTIONS.includes(s.id));
  const [section, setSection] = useState<SettingsSection>("identity");
  const active = sections.find((s) => s.id === section) ?? sections[0];

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[230px_minmax(0,1fr)]">
      <nav aria-label="Settings sections" className="flex flex-wrap gap-2 xl:sticky xl:top-24 xl:flex-col">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            aria-pressed={section === s.id}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-left text-xs font-semibold transition-colors duration-200",
              section === s.id
                ? "border-saffron-400 bg-saffron-400/10 text-white"
                : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/25 hover:bg-white/[0.06] hover:text-white"
            )}
          >
            <s.icon className="h-3.5 w-3.5 shrink-0" />
            {s.label}
          </button>
        ))}
      </nav>

      <div className="min-w-0">
        <SectionNote>{active.hint}</SectionNote>
        {section === "identity" && <SettingsIdentity />}
        {section === "brand" && <SettingsBrand />}
        {section === "colours" && <SettingsColours />}
        {section === "map" && <SettingsMap />}
        {section === "loader" && <SettingsLoader />}
        {section === "account" && <SettingsAccount />}
        {section === "backup" && owner && <SettingsBackup />}
        {section === "history" && <SettingsHistory />}
      </div>
    </div>
  );
}

/** The title in the browser tab, and whether strangers may sign up. */
function SettingsIdentity() {
  const { setSiteTitle } = useSite();
  const [site, setSite] = useState<{ title: string; allowSignup: boolean } | null>(null);
  const [siteMsg, setSiteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingSite, setSavingSite] = useState(false);

  useEffect(() => {
    let alive = true;
    siteApi
      .getSiteSettings()
      .then((next) => alive && setSite(next))
      .catch(() => {
        /* the card simply stays hidden until the API answers */
      });
    return () => {
      alive = false;
    };
  }, []);

  const saveSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!site) return;
    setSavingSite(true);
    setSiteMsg(null);
    try {
      const saved = await siteApi.saveSiteSettings(site);
      setSite(saved);
      setSiteTitle(saved.title);
      document.title = saved.title;
      setSiteMsg({ ok: true, text: "Saved. The browser tab and sign-in screens use this title." });
    } catch (error) {
      setSiteMsg({ ok: false, text: describeApiError(error) });
    } finally {
      setSavingSite(false);
    }
  };

  return (
    <div className="max-w-2xl">
      {site && (
            <form onSubmit={saveSite} className="rounded-3xl glass p-6">
              <h3 className="font-display text-base font-semibold text-white">Site &amp; sign-up</h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                The title appears in the browser tab and on the sign-in screens. Public sign-up lets
                anybody create a read-only account from the members page.
              </p>
              <label htmlFor="site-title" className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                Website title
              </label>
              <input
                id="site-title"
                value={site.title}
                onChange={(e) => setSite((v) => (v ? { ...v, title: e.target.value } : v))}
                maxLength={120}
                className={cn(inputCls, "mt-1.5")}
              />
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
                <Switch
                  on={site.allowSignup}
                  onChange={(allowSignup) => setSite((v) => (v ? { ...v, allowSignup } : v))}
                  label="Allow public sign-up"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">Allow public sign-up</p>
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    New accounts get read-only access. Off means the owner adds everybody from this
                    panel.
                  </p>
                </div>
              </div>
              {siteMsg && (
                <p className={cn("mt-3 text-xs font-medium", siteMsg.ok ? "text-emerald-300" : "text-red-400")}>
                  {siteMsg.text}
                </p>
              )}
              <button
                type="submit"
                disabled={savingSite}
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-white/[0.08] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white hover:text-ink-950 disabled:opacity-60"
              >
                <Save className="h-4 w-4" /> {savingSite ? "Saving…" : "Save site settings"}
              </button>
            </form>
      )}
      {!site && <p className="text-xs text-zinc-500">Reading the site settings…</p>}
    </div>
  );
}

/** Logo, wordmark and brand colour — the same editor the dashboard had. */
function SettingsBrand() {
  return (
    <div>
      <SectionNote>
        Saving here republishes the brand everywhere it appears: the header, the loader, the footer
        and the shared link preview.
      </SectionNote>
      <BrandingPanel />
    </div>
  );
}

/** The colour sets, and the day/night switch for this browser. */
function SettingsColours() {
  const { theme, setTheme } = useSite();

  return (
    <div className="grid gap-5">
      <ThemePanel />

      <div className="rounded-3xl glass p-6">
        <h3 className="font-display text-base font-semibold text-white">Day or night, for you</h3>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          The colours above are the palette; this is which half of it you are looking at. It applies
          across the whole site, including the live map page, and is remembered per visitor — so
          your choice does not decide a reader&apos;s.
        </p>
        <div className="mt-4 flex gap-2">
          {(["dark", "light"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              aria-pressed={theme === t}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold capitalize transition-all duration-300",
                theme === t
                  ? "border-saffron-400/60 bg-saffron-400/10 text-white"
                  : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white"
              )}
            >
              {t === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Which basemap the maps draw with. */
function SettingsMap() {
  return <MapPanel />;
}

/** The mark shown for the moment the site takes to load. */
function SettingsLoader() {
  const { updateDraft, logAction, draft, loaderDraft, setLoaderDraft } = useSite();
  const [previewOpen, setPreviewOpen] = useState(false);

  // The loader animation lives on the draft, so it publishes with Save Changes.
  const loaderAnimation = resolveLoaderAnimation(draft.loaderAnimation);
  const setLoaderAnimation = (next: LoaderAnimation) => {
    logAction(`Changed loader animation to ${LOADER_ANIMATION_LABELS[next].label}`);
    updateDraft((c) => ({ ...c, loaderAnimation: next }));
  };

  // Esc closes the loader preview.
  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewOpen]);

  return (
    <div className="max-w-3xl">
          <div className="rounded-3xl glass p-6">
            <h3 className="font-display text-base font-semibold text-white">Loader screen</h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Shown while the site loads. Upload your own mark, pick one from the media folder, or
              leave it empty for the default rider crossing the mountains. Large images are
              accepted and compressed to under 2 MB automatically, and the compressed copy is what
              the loader displays.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-[200px_1fr] sm:items-start">
              {/* Fixed 16/9 viewport, so a very tall or very wide logo still
                  previews in the same space as everything else. */}
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                <div className="grid place-items-center p-3" style={{ aspectRatio: "16 / 9" }}>
                  <span
                    className={cn(
                      "grid place-items-center",
                      loaderAnimation !== "none" && `ldr-anim-${loaderAnimation}`
                    )}
                  >
                    {loaderDraft ? (
                      <img
                        src={loaderDraft}
                        alt=""
                        className="max-h-[64px] max-w-[150px] object-contain"
                      />
                    ) : (
                      <LineLoaderMark />
                    )}
                  </span>
                </div>
              </div>
              <div>
                <ImageField
                  value={loaderDraft}
                  onChange={setLoaderDraft}
                  budget={LOADER_LOGO_BUDGET}
                  previewNote="Loader mark · compressed on upload"
                />
                {loaderDraft && (
                  <button
                    type="button"
                    onClick={() => setLoaderDraft("")}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-[11px] font-semibold text-zinc-400 hover:bg-red-500/15 hover:text-red-400"
                  >
                    <RefreshCcw className="h-3 w-3" /> Use default rider mark
                  </button>
                )}
              </div>
            </div>

            {/* animation picker */}
            <div className="mt-6 border-t border-white/[0.07] pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
                  Animation
                </h4>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-white/[0.1] hover:text-white"
                >
                  <Play className="h-3 w-3" /> Preview full screen
                </button>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                How the mark moves while loading. Hover a tile to see it, or pick one to apply it
                to the loader and this preview.
              </p>

              <div
                role="group"
                aria-label="Loader animation"
                className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3"
              >
                {LOADER_ANIMATIONS.map((a) => {
                  const on = loaderAnimation === a;
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setLoaderAnimation(a)}
                      aria-pressed={on}
                      className={cn(
                        "group flex flex-col items-center gap-2 rounded-2xl border px-3 py-3 text-center transition-colors",
                        on
                          ? "border-saffron-400/60 bg-saffron-400/10"
                          : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]"
                      )}
                    >
                      <span className="grid h-11 w-full place-items-center overflow-hidden">
                        <span
                          className={cn(
                            "grid place-items-center",
                            a !== "none" && `ldr-anim-${a}`,
                            // Only animate on hover unless it's the chosen one,
                            // so a grid of tiles is not permanently in motion.
                            !on && "group-hover:[animation-play-state:running] [animation-play-state:paused]"
                          )}
                        >
                          {loaderDraft ? (
                            <img src={loaderDraft} alt="" className="max-h-10 max-w-[72px] object-contain" />
                          ) : (
                            <LineLoaderMark className="ldr-line-sm" />
                          )}
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span
                          className={cn(
                            "block text-xs font-semibold",
                            on ? "text-white" : "text-zinc-300"
                          )}
                        >
                          {LOADER_ANIMATION_LABELS[a].label}
                        </span>
                        <span className="mt-0.5 block text-[10px] leading-tight text-zinc-500">
                          {LOADER_ANIMATION_LABELS[a].hint}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

      {/* full-screen loader preview — the real component, on a local timer */}
      {previewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Loader preview"
          className="fixed inset-0 z-[200] grid place-items-center bg-ink-950"
        >
          <LoaderBackdrop />
          <LoaderStage logo={loaderDraft} animation={loaderAnimation} />
          <button
            type="button"
            autoFocus
            onClick={() => setPreviewOpen(false)}
            className="absolute right-5 top-5 inline-flex items-center gap-2 rounded-full glass px-4 py-2.5 text-xs font-semibold text-zinc-200 transition-colors hover:text-white"
          >
            <X className="h-3.5 w-3.5" /> Close preview
          </button>
          <p className="absolute bottom-8 text-[11px] text-zinc-600">
            This is the real loader screen · Esc to close
          </p>
        </div>
      )}
    </div>
  );
}

/** The owner's own password, and who may edit the site. */
function SettingsAccount() {
  const { account } = useSite();
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [cf, setCf] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (nw !== cf) {
      setMsg({ ok: false, text: "New passwords don't match." });
      return;
    }
    setSavingPw(true);
    try {
      await siteApi.changePassword(cur, nw);
      setCur("");
      setNw("");
      setCf("");
      setMsg({ ok: true, text: "Password updated. Other browsers have been signed out." });
    } catch (error) {
      setMsg({ ok: false, text: describeApiError(error) });
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="grid max-w-2xl gap-5">
          <form onSubmit={changePassword} className="rounded-3xl glass p-6">
            <h3 className="flex items-center gap-2 font-display text-base font-semibold text-white">
              <KeyRound className="h-4 w-4 text-saffron-300" /> Change admin password
            </h3>
            <div className="mt-4 grid gap-3">
              <input
                type="password"
                value={cur}
                onChange={(e) => setCur(e.target.value)}
                placeholder="Current password"
                aria-label="Current password"
                className={inputCls}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="password"
                  value={nw}
                  onChange={(e) => setNw(e.target.value)}
                  placeholder="New password"
                  aria-label="New password"
                  className={inputCls}
                />
                <input
                  type="password"
                  value={cf}
                  onChange={(e) => setCf(e.target.value)}
                  placeholder="Confirm new password"
                  aria-label="Confirm new password"
                  className={inputCls}
                />
              </div>
              {msg && (
                <p className={cn("text-xs font-medium", msg.ok ? "text-emerald-300" : "text-red-400")}>
                  {msg.text}
                </p>
              )}
              <button
                type="submit"
                disabled={savingPw}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/[0.08] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white hover:text-ink-950 disabled:opacity-60"
              >
                <Check className="h-4 w-4" /> {savingPw ? "Updating…" : "Update password"}
              </button>
            </div>
          </form>

      {/* The account list is every editor's name and email address, and only
          the owner may add, disable or delete one. The server enforces it; this
          keeps an admin from being offered a panel that would only 403. */}
      {account?.role === "owner" ? (
        <AccessPanel />
      ) : (
        <p className="rounded-3xl glass p-5 text-xs leading-relaxed text-zinc-500">
          Accounts are managed by the site owner. Ask them to add, disable or remove an editor —
          you can still change your own password above.
        </p>
      )}
    </div>
  );
}

/**
 * Backups, in one section.
 *
 * The server's nightly archive and the content export/import are two halves of
 * the same idea — a copy of the site you can put back — so they sit together
 * rather than in two different corners of the dashboard.
 */
function SettingsBackup() {
  return (
    <div className="grid gap-5">
      <BackupsPanel />
      <BackupTransferCard />
    </div>
  );
}

/**
 * Export, copy or import the published content as JSON.
 *
 * This is the content half of a backup: text, images references, sections and
 * settings, without the database itself. It is what moves a design from one
 * installation to another.
 */
function BackupTransferCard() {
  const { updateDraft, draft, loaderDraft } = useSite();
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

    /** The editor's working copy, exactly as it would be published. */
    const snapshotJson = () =>
      JSON.stringify({ ...draft, loaderLogo: loaderDraft }, null, 2);

    const exportJson = () => {
      try {
        const blob = new Blob([snapshotJson()], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "pb-site-content-draft.json";
        a.rel = "noopener";
        // Firefox and Safari only start a programmatic download when the anchor
        // is in the document, and revoking the URL in the same tick can cancel a
        // download that has not begun yet — between them the button silently did
        // nothing. Append, click, remove, then release the blob later.
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        setBackupMsg({ ok: true, text: "Exported — check your downloads folder." });
      } catch {
        setBackupMsg({
          ok: false,
          text: "Export failed. Use Copy JSON instead, or allow downloads for this site.",
        });
      }
    };

    const copyJson = async () => {
      const json = snapshotJson();
      try {
        await navigator.clipboard.writeText(json);
        setBackupMsg({
          ok: true,
          text: `Copied ${Math.round(json.length / 1024)} KB of JSON to your clipboard.`,
        });
      } catch {
        setBackupMsg({
          ok: false,
          text: "The browser blocked the clipboard. Export the file instead.",
        });
      }
    };

    const importJson = (file: File) => {
      const reader = new FileReader();
      reader.onerror = () =>
        setBackupMsg({ ok: false, text: "Couldn't read that file — try exporting it again." });
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result)) as {
            v?: number;
            nav?: unknown[];
            sections?: unknown[];
          };
          if (parsed?.v !== 1 || !Array.isArray(parsed.sections) || !Array.isArray(parsed.nav)) {
            setBackupMsg({ ok: false, text: "That file doesn't look like a valid PB content export." });
            return;
          }
          updateDraft(() => parsed as never);
          setBackupMsg({ ok: true, text: "Imported into the editor. Press Save Changes to publish it." });
        } catch {
          setBackupMsg({ ok: false, text: "Couldn't read that file — is it valid JSON?" });
        }
      };
      reader.readAsText(file);
    };


  return (
    <div className="rounded-3xl glass p-6">
        {/* export / import */}
        <div className="rounded-3xl glass p-6">
          <h3 className="font-display text-base font-semibold text-white">Backup &amp; transfer</h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            The site is stored in the database. Export a JSON snapshot for an extra copy, or to move
            content between installations — import it back any time.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={exportJson}
              className="inline-flex items-center gap-2 rounded-xl bg-white/[0.08] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white hover:text-ink-950"
            >
              <Download className="h-4 w-4" /> Export JSON
            </button>
            <button
              onClick={copyJson}
              className="inline-flex items-center gap-2 rounded-xl bg-white/[0.08] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white hover:text-ink-950"
            >
              <Copy className="h-4 w-4" /> Copy JSON
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl bg-white/[0.08] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white hover:text-ink-950"
            >
              <Upload className="h-4 w-4" /> Import JSON
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJson(f);
                e.target.value = "";
              }}
            />
          </div>
          {backupMsg && (
            <p
              className={cn(
                "mt-3 text-xs font-medium",
                backupMsg.ok ? "text-emerald-300" : "text-red-400",
              )}
            >
              {backupMsg.text}
            </p>
          )}
        </div>
    </div>
  );
}

/** Everything that has been saved, newest first. */
function SettingsHistory() {
  return (
    <div className="min-w-0">
      <RevisionsPanel />
    </div>
  );
}

/* ═══════════════ Revision history ═══════════════ */

/** "3h ago" / "2d ago" shorthand for a timestamp. */
function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * Which parts of the site actually differ from the snapshot saved before this
 * one, so a card says more than just when it was saved.
 */
function changedLabels(current: SiteContent, previous: SiteContent | undefined): string[] {
  if (!previous) return [];
  const before = new Map(previous.sections.map((s) => [s.id, s]));
  const out: string[] = [];
  for (const section of current.sections) {
    const prev = before.get(section.id);
    if (!prev) {
      out.push(section.label);
      continue;
    }
    if (prev.enabled !== section.enabled || JSON.stringify(prev.data) !== JSON.stringify(section.data)) {
      out.push(section.label);
    }
  }
  if (JSON.stringify(previous.nav ?? []) !== JSON.stringify(current.nav ?? [])) out.push("Menu");
  return out;
}

function RevisionsPanel() {
  const { revisions, restoreRevision, deleteRevision } = useSite();

  // Revisions are newest-first, so the one after this card is the older state.
  const changes = useMemo(
    () => revisions.map((r, i) => changedLabels(r.content, revisions[i + 1]?.content)),
    [revisions],
  );

  return (
    /* Same card shell as the neighbouring Theme and Loader screen panels. The
       heading sits outside the scroller, so it stays put while only the list
       moves — no opaque strip needed on top of the glass. */
    <div className="rounded-3xl glass p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold text-white">
          <History className="h-4.5 w-4.5 text-saffron-300" /> Revision History
        </h3>
        {revisions.length > 0 && (
          <span className="rounded-full bg-saffron-400/15 px-2.5 py-0.5 text-[10px] font-bold text-saffron-300">
            {revisions.length}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Every saved state, newest first. Tap a card to revert the website instantly.
      </p>

      {revisions.length === 0 ? (
        <p className="mt-5 text-center text-xs italic text-zinc-600">No revisions logged yet.</p>
      ) : (
        <div className="mt-5 flex max-h-[60vh] flex-col gap-2.5 overflow-y-auto overscroll-contain pr-1 no-scrollbar">
            {revisions.map((r, i) => {
              const touched = changes[i];
              const fullTime = new Date(r.timestamp).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "medium",
              });
              return (
                <div
                  key={r.id}
                  className="rounded-2xl border border-white/[0.05] bg-white/[0.02] p-3.5 hover:border-white/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 text-xs font-semibold text-white">{r.description}</p>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        onClick={() => restoreRevision(r)}
                        className="inline-flex items-center gap-1 rounded-lg bg-saffron-400/10 px-2.5 py-1 text-[10px] font-bold text-saffron-300 hover:bg-saffron-400/20"
                      >
                        Revert
                      </button>
                      <button
                        onClick={() => deleteRevision(r.id)}
                        aria-label={`Delete revision: ${r.description}`}
                        className="grid h-6 w-6 place-items-center rounded-lg bg-white/[0.05] text-zinc-500 hover:bg-red-500/15 hover:text-red-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  <p className="mt-0.5 text-[10px] text-zinc-500">
                    {fullTime} · {relativeTime(r.timestamp)}
                    {i === 0 && <span className="ml-1.5 text-emerald-400">· latest</span>}
                  </p>

                  {touched.length > 0 ? (
                    <p className="mt-2 text-[10px] leading-relaxed text-zinc-400">
                      <span className="font-semibold text-saffron-300">{touched.length}</span>{" "}
                      {touched.length === 1 ? "area" : "areas"} changed:{" "}
                      {touched.slice(0, 2).join(", ")}
                      {touched.length > 2 ? ` +${touched.length - 2} more` : ""}
                    </p>
                  ) : (
                    <p className="mt-2 text-[10px] text-zinc-600">
                      {i === revisions.length - 1
                        ? "First saved state"
                        : "No content differences since the previous save"}
                    </p>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════ Media folder tab ═══════════════ */

/** Icon for a stored file, by format family. */
function KindIcon({ kind, broken }: { kind: MediaKind; broken?: boolean }) {
  const cls = "h-8 w-8 text-saffron-300";
  if (broken) return <ImageOff className={cls} />;
  switch (kind) {
    case "image": return <FileImage className={cls} />;
    case "excel": return <FileSpreadsheet className={cls} />;
    case "powerpoint": return <Presentation className={cls} />;
    case "archive": return <FileArchive className={cls} />;
    case "pdf": return <FileType className={cls} />;
    case "video": return <Video className={cls} />;
    default: return <FileText className={cls} />;
  }
}

function MediaPanel() {
  const { draft } = useSite();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Item awaiting delete confirmation. */
  const [pendingDelete, setPendingDelete] = useState<MediaItem | null>(null);
  /** Images the browser could not paint — shown as files instead of broken frames. */
  const [broken, setBroken] = useState<Record<string, true>>({});
  /** The photo open in the preview panel, if any. */
  const [viewing, setViewing] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => listMedia().then(setItems);

  useEffect(() => {
    void refresh();
  }, []);

  const uploadFiles = async (files: FileList | File[]) => {
    setBusy(true);
    setError("");
    const failed: string[] = [];
    try {
      for (const file of Array.from(files)) {
        try {
          await addAnyMediaFile(file);
        } catch (e) {
          failed.push(`${file.name}: ${e instanceof Error ? e.message : "upload failed"}`);
        }
      }
      await refresh();
    } finally {
      setBusy(false);
    }
    if (failed.length) setError(failed.join(" · "));
  };

  /**
   * Deleting is confirmed first. Anything already placed on the site is called
   * out, because removing the file leaves that field pointing at nothing.
   */
  const confirmedDelete = async (item: MediaItem) => {
    const ref = `idb:${item.id}`;
    const usedEverywhere = JSON.stringify(draft).split(ref).length - 1;
    setPendingDelete(null);
    await removeMedia(item.id);
    await refresh();
    if (usedEverywhere > 0) {
      setError(
        `Deleted ${item.name}. It was in use in ${usedEverywhere} place${usedEverywhere === 1 ? "" : "s"} — those fields now point at a missing file.`
      );
    }
  };

  const usageCount = (item: MediaItem) => {
    return JSON.stringify(draft).split(`idb:${item.id}`).length - 1;
  };

  /** Only photos open in the preview panel — a PDF is still a new tab. */
  const photos = items.filter((item) => kindOf(item) === "image" && !broken[item.id]);

  return (
    <div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
        }}
        className="rounded-[2rem] border border-dashed border-white/15 bg-white/[0.02] p-8 text-center"
      >
        <FolderOpen className="mx-auto h-8 w-8 text-saffron-300" />
        <h3 className="mt-3 font-display text-lg font-semibold text-white">Media folder</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-400">
          Upload photos (PNG, JPG, WEBP, GIF, AVIF, SVG), videos (MP4, WEBM) and documents
          (PDF, Word, Excel, PowerPoint, CSV, TXT, ZIP) from your computer. They stay in this browser and can be
          picked on any image or file field. You can also drop files into{" "}
          <code className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[11px] text-saffron-300">
            public/media/
          </code>{" "}
          and use <code className="font-mono text-[11px] text-zinc-300">/media/filename.pdf</code>.
        </p>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-saffron-400 px-6 py-3 text-sm font-bold text-on-gold shadow-lg shadow-saffron-400/25 disabled:opacity-60"
        >
          <Upload className="h-4 w-4" />
          {busy ? "Uploading…" : "Upload files"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {error && (
          <p role="alert" className="mx-auto mt-3 max-w-lg text-xs leading-relaxed text-red-400">
            {error}
          </p>
        )}
      </div>

      {items.length === 0 ? (
        <p className="mt-8 text-center text-xs text-zinc-500">No files in the media library yet.</p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((m) => {
            const kind = kindOf(m);
            const meta = KIND_META[kind];
            const isImage = kind === "image" && !broken[m.id];
            const isVideo = kind === "video";
            const inUse = usageCount(m);
            return (
              <figure
                key={m.id}
                className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"
              >
                <span className="relative block">
                  {isImage ? (
                    <button
                      type="button"
                      onClick={() => setViewing(m.id)}
                      aria-label={`Open ${m.name}`}
                      className="block w-full cursor-zoom-in"
                      title="Open in the preview panel"
                    >
                      <img
                        src={m.dataUrl}
                        alt={m.name}
                        loading="lazy"
                        onError={() => setBroken((b) => ({ ...b, [m.id]: true }))}
                        className="aspect-[4/3] w-full object-cover transition-opacity hover:opacity-85"
                      />
                    </button>
                  ) : isVideo ? (
                    <video
                      src={m.dataUrl}
                      muted
                      playsInline
                      preload="metadata"
                      className="aspect-[4/3] w-full bg-black object-cover"
                      aria-label={m.name}
                    />
                  ) : (
                    <span className="grid aspect-[4/3] w-full place-items-center bg-white/[0.04]">
                      <span className="flex flex-col items-center gap-2">
                        <KindIcon kind={kind} broken={isImage === false && broken[m.id] === true} />
                        <span className="rounded-full bg-saffron-400/15 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-saffron-300">
                          {(m.ext || meta.badge).toUpperCase()}
                        </span>
                      </span>
                    </span>
                  )}
                  {inUse > 0 && (
                    <span
                      className="media-in-use absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[9px] font-bold text-saffron-300 backdrop-blur-md"
                      title={`Used in ${inUse} place${inUse === 1 ? "" : "s"} on the site`}
                    >
                      IN USE
                    </span>
                  )}
                </span>

                <figcaption className="flex flex-1 flex-col p-3">
                  <span className="block truncate text-xs font-medium text-zinc-200" title={m.name}>
                    {m.name}
                  </span>
                  <span className="mt-0.5 text-[10px] text-zinc-500">
                    {meta.label} · {formatBytes(m.size)}
                  </span>
                  <span
                    className="text-[10px] text-zinc-600"
                    title={formatAddedFull(m.addedAt)}
                  >
                    Added {formatAdded(m.addedAt)}
                  </span>
                  <span className="mt-3 flex items-center gap-1.5">
                    {isImage ? (
                      <button
                        type="button"
                        onClick={() => setViewing(m.id)}
                        className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/[0.06] text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-white/[0.12] hover:text-white"
                      >
                        <Eye className="h-3.5 w-3.5" /> Open
                      </button>
                    ) : (
                      <a
                        href={m.dataUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/[0.06] text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-white/[0.12] hover:text-white"
                      >
                        <Eye className="h-3.5 w-3.5" /> Open
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setPendingDelete(m)}
                      disabled={m.bundled}
                      title={
                        m.bundled
                          ? "Ships with the website — choose another photo in the section editor"
                          : "Delete this file"
                      }
                      aria-label={`Delete ${m.name}`}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-zinc-400 transition-colors hover:bg-red-500/15 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}

      {viewing && photos.some((m) => m.id === viewing) && (
        <MediaLightbox
          images={photos}
          startId={viewing}
          usageOf={usageCount}
          onClose={() => setViewing(null)}
          // Saved tags or a re-encoded image come back as the whole item, so the
          // card behind the panel updates without a round trip to the server.
          onSaved={(saved) =>
            setItems((list) => list.map((m) => (m.id === saved.id ? { ...m, ...saved } : m)))
          }
          onDeleted={(gone) => setItems((list) => list.filter((m) => m.id !== gone.id))}
          onDelete={(goner) => confirmedDelete(goner)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this file?"
          message={`“${pendingDelete.name}” (${KIND_META[kindOf(pendingDelete)].label.toLowerCase()}, ${formatBytes(pendingDelete.size)}) will be removed from the media folder. This cannot be undone.`}
          detail={
            usageCount(pendingDelete) > 0
              ? `It is currently used in ${usageCount(pendingDelete)} place${usageCount(pendingDelete) === 1 ? "" : "s"} on the site — those fields will point at a missing file.`
              : undefined
          }
          confirmLabel="Delete file"
          onConfirm={() => void confirmedDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

/* ═══════════════ Footer tab ═══════════════ */

const footerMiniBtn =
  "grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-30";

function moveIn<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

function FooterPanel() {
  const { draft, updateDraft, logAction } = useSite();
  const f = resolveFooter(draft.footer);

  /** Every footer edit goes through here: it logs the change and writes the draft. */
  const write = (action: string, fn: (cur: FooterSettings) => FooterSettings) => {
    logAction(action);
    updateDraft((c) => ({ ...c, footer: fn(resolveFooter(c.footer)) }));
  };
  const setCols = (action: string, fn: (cols: FooterColumn[]) => FooterColumn[]) =>
    write(action, (cur) => ({ ...cur, columns: fn(cur.columns) }));
  const setField = (patch: Partial<FooterSettings>) =>
    write("Edited footer text", (cur) => ({ ...cur, ...patch }));
  const setSection = (enabled: boolean) =>
    write(`${enabled ? "Enabled" : "Disabled"} the footer section`, (cur) => cascadeFooterSection(cur, enabled));

  // Collective link switch across every column.
  const allLinks = f.columns.flatMap((c) => c.links);
  const anyLinkOn = allLinks.some((l) => l.enabled);
  const setAllLinks = (enabled: boolean) =>
    write(`${enabled ? "Enabled" : "Disabled"} all footer links`, (cur) =>
      cascadeFooterLinks(cur, enabled)
    );

  // Columns
  const addColumn = () =>
    setCols("Added a footer column", (cols) => [
      ...cols,
      {
        id: newId("col"),
        title: "New column",
        enabled: true,
        links: [{ id: newId("l"), label: "New link", href: "#top", enabled: true }],
      },
    ]);
  const setColumn = (id: string, patch: Partial<FooterColumn>) =>
    patch.enabled !== undefined
      ? write(`${patch.enabled ? "Enabled" : "Disabled"} footer column`, (cur) =>
          cascadeFooterColumn(cur, id, patch.enabled as boolean)
        )
      : setCols("Edited footer column", (cols) => cols.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const removeColumn = (id: string, title: string) =>
    setCols(`Removed footer column: ${title}`, (cols) => cols.filter((c) => c.id !== id));
  const moveColumn = (i: number, dir: -1 | 1) =>
    setCols("Reordered footer columns", (cols) => moveIn(cols, i, dir));
  const setColumnLinks = (id: string, title: string, enabled: boolean) =>
    write(`${enabled ? "Enabled" : "Disabled"} all links in ${title}`, (cur) =>
      cascadeFooterColumnLinks(cur, id, enabled)
    );

  // Links inside one column
  const mapLinks =
    (colId: string, fn: (links: FooterLink[]) => FooterLink[]) =>
    (cols: FooterColumn[]): FooterColumn[] =>
      cols.map((c) => (c.id === colId ? { ...c, links: fn(c.links) } : c));
  const setLink = (colId: string, linkId: string, patch: Partial<FooterLink>) =>
    patch.enabled !== undefined
      ? write(`${patch.enabled ? "Enabled" : "Disabled"} footer link`, (cur) =>
          cascadeFooterLink(cur, colId, linkId, patch.enabled as boolean)
        )
      : setCols(
          "Edited footer links",
          mapLinks(colId, (ls) => ls.map((l) => (l.id === linkId ? { ...l, ...patch } : l)))
        );
  const moveLink = (colId: string, i: number, dir: -1 | 1) =>
    setCols("Reordered footer links", mapLinks(colId, (ls) => moveIn(ls, i, dir)));
  const removeLink = (colId: string, linkId: string, label: string) =>
    setCols(`Removed footer link: ${label}`, mapLinks(colId, (ls) => ls.filter((l) => l.id !== linkId)));
  const addLink = (colId: string) =>
    setCols(
      "Added a footer link",
      mapLinks(colId, (ls) => [...ls, { id: newId("l"), label: "New link", href: "#top", enabled: true }])
    );

  // Social links
  const setSocials = (next: FooterSocial[], action: string) =>
    write(action, (cur) => ({ ...cur, socials: next }));

  const setSocial = (id: string, patch: Partial<FooterSocial>) =>
    write("Edited site-wide social links", (cur) =>
      patch.enabled !== undefined
        ? cascadeFooterSocial(cur, id, patch.enabled)
        : { ...cur, socials: cur.socials.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
    );

  return (
    <div>
      <RestoreBar scope="footer" label="footer" />

      {/* whole-section switch */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-3xl glass p-5">
        <div>
          <p className="text-sm font-semibold text-white">Footer section</p>
          <p className="mt-1 text-[11px] text-zinc-500">
            {f.enabled
              ? "Visible on the site. Switch off to hide the whole footer."
              : "Hidden on the site. Switch on to show it again."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold text-zinc-400">{f.enabled ? "Disable all" : "Enable all"}</span>
          <Switch on={f.enabled} onChange={setSection} label="Show footer section" />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
        {/* ───── left: editor ───── */}
        <div className="flex min-w-0 flex-col gap-5">
          <div className="rounded-3xl glass p-5">
            <label
              htmlFor="footer-desc"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500"
            >
              Brand text
            </label>
            <textarea
              id="footer-desc"
              value={f.description}
              onChange={(e) => setField({ description: e.target.value })}
              rows={3}
              className={cn(inputCls, "resize-y leading-relaxed")}
            />
          </div>

          <div className="rounded-3xl glass p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-semibold text-white">Link columns</h3>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Reorder, rename, hide or add columns and links
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-semibold text-zinc-400">
                  {anyLinkOn ? "Disable all links" : "Enable all links"}
                </span>
                <Switch on={anyLinkOn} onChange={setAllLinks} label="Show all footer links" />
                <button
                  type="button"
                  onClick={addColumn}
                  className="inline-flex items-center gap-1.5 rounded-full bg-saffron-400 px-4 py-2 text-xs font-bold text-on-gold shadow-lg shadow-saffron-400/25 transition-all duration-300 hover:brightness-110 active:scale-95"
                >
                  <Plus className="h-3.5 w-3.5" /> Add column
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {f.columns.map((col, ci) => {
                const colOn = col.links.length > 0 && col.links.every((l) => l.enabled);
                return (
                  <div
                    key={col.id}
                    className={cn(
                      "rounded-2xl border p-4 transition-colors",
                      col.enabled
                        ? "border-white/[0.08] bg-white/[0.03]"
                        : "border-white/[0.05] bg-white/[0.01] opacity-80"
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveColumn(ci, -1)}
                          disabled={ci === 0}
                          aria-label="Move column up"
                          className={footerMiniBtn}
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveColumn(ci, 1)}
                          disabled={ci === f.columns.length - 1}
                          aria-label="Move column down"
                          className={footerMiniBtn}
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <input
                        value={col.title}
                        onChange={(e) => setColumn(col.id, { title: e.target.value })}
                        aria-label="Column title"
                        className={cn(inputCls, "min-w-0 flex-1 basis-40 font-semibold")}
                      />
                      <Switch
                        on={col.enabled}
                        onChange={(v) => setColumn(col.id, { enabled: v })}
                        label={`Show ${col.title} column`}
                      />
                      <button
                        type="button"
                        onClick={() => setColumnLinks(col.id, col.title, !colOn)}
                        disabled={col.links.length === 0}
                        className="rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-white/[0.12] disabled:opacity-40"
                      >
                        {colOn ? "Disable links" : "Enable links"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeColumn(col.id, col.title)}
                        aria-label={`Remove ${col.title}`}
                        className={cn(footerMiniBtn, "hover:bg-red-500/15 hover:text-red-400")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <ul className="mt-3 flex flex-col gap-2">
                      {col.links.map((l, li) => (
                        <li
                          key={l.id}
                          className={cn(
                            "flex flex-wrap items-center gap-2 rounded-xl border p-2",
                            l.enabled ? "border-white/[0.06]" : "border-white/[0.04] opacity-70"
                          )}
                        >
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => moveLink(col.id, li, -1)}
                              disabled={li === 0}
                              aria-label="Move link up"
                              className={footerMiniBtn}
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveLink(col.id, li, 1)}
                              disabled={li === col.links.length - 1}
                              aria-label="Move link down"
                              className={footerMiniBtn}
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <input
                            value={l.label}
                            onChange={(e) => setLink(col.id, l.id, { label: e.target.value })}
                            aria-label="Link label"
                            className={cn(inputCls, "w-36 py-2 text-xs")}
                          />
                          <input
                            value={l.href}
                            onChange={(e) => setLink(col.id, l.id, { href: e.target.value })}
                            aria-label="Link address"
                            placeholder="#section or https://…"
                            className={cn(inputCls, "min-w-0 flex-1 py-2 font-mono text-xs")}
                          />
                          <Switch
                            on={l.enabled}
                            onChange={(v) => setLink(col.id, l.id, { enabled: v })}
                            label={`Show ${l.label}`}
                          />
                          <button
                            type="button"
                            onClick={() => removeLink(col.id, l.id, l.label)}
                            aria-label={`Remove ${l.label}`}
                            className={cn(footerMiniBtn, "hover:bg-red-500/15 hover:text-red-400")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>

                    <button
                      type="button"
                      onClick={() => addLink(col.id)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-dashed border-white/15 px-3 py-2 text-xs font-semibold text-zinc-400 transition-all hover:border-saffron-400/50 hover:text-white"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add link
                    </button>
                  </div>
                );
              })}
              {f.columns.length === 0 && (
                <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-zinc-600">
                  No columns yet. Add one to start building the footer.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-3xl glass p-5">
            <h3 className="font-display text-base font-semibold text-white">Site-wide social icons</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Set each profile URL and visibility for the footer, showreel card, and live tracker.
            </p>
            <SocialIconsEditor
              socials={f.socials}
              onPatch={(id, patch) => setSocial(id, patch)}
              onChange={(next, action) => setSocials(next, action)}
            />
          </div>

          <div className="grid gap-4 rounded-3xl glass p-5">
            <div>
              <label
                htmlFor="footer-copy"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500"
              >
                Copyright text
              </label>
              <input
                id="footer-copy"
                value={f.copyright}
                onChange={(e) => setField({ copyright: e.target.value })}
                className={inputCls}
              />
              <p className="mt-1.5 text-[11px] text-zinc-600">Shown after the © year</p>
            </div>
            <div>
              <label
                htmlFor="footer-credit"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500"
              >
                Credit line
              </label>
              <input
                id="footer-credit"
                value={f.credit}
                onChange={(e) => setField({ credit: e.target.value })}
                className={inputCls}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-200">Back to top button</p>
                <p className="text-[11px] text-zinc-500">Show the button on the right of the bottom bar</p>
              </div>
              <Switch
                on={f.showBackToTop}
                onChange={(v) => setField({ showBackToTop: v })}
                label="Show back to top button"
              />
            </div>
          </div>
        </div>

        {/* ───── right: live preview ───── */}
        <div className="min-w-0 xl:sticky xl:top-28 xl:self-start">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Live preview
          </p>
          {f.enabled ? (
            <div className="max-h-[78vh] overflow-y-auto rounded-3xl border border-white/10 bg-ink-950">
              {/* inert: preview links must not navigate away from the dashboard */}
              <div inert>
                <FooterView settings={f} preview />
              </div>
            </div>
          ) : (
            <div className="grid h-40 place-items-center rounded-3xl border border-dashed border-white/10 text-xs text-zinc-600">
              The footer is hidden, so visitors will not see it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ShopPanel() {
  const { draft, updateDraft, logAction } = useSite();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const gearSection = draft.sections.find((section) => section.type === "gears");
  const riderKitSection = draft.sections.find((section) => section.type === "riderkit");
  const items = Array.isArray(gearSection?.data.items) ? gearSection.data.items as GearItem[] : [];
  const mapItems = Array.isArray(riderKitSection?.data.items) ? riderKitSection.data.items as GearItem[] : [];
  const mappedPickIds = new Set(mapItems.map((item) => item.sourcePickId).filter((id): id is string => Boolean(id)));
  const productKey = (item: GearItem, index: number) => item.id || `${item.name || item.category || "pick"}-${index}`;

  const patchProduct = (index: number, path: string, value: unknown) => {
    if (!gearSection || !items[index]) return;
    const product = items[index];
    const productName = String(product.name || product.brand || product.category || `Pick ${index + 1}`);
    logAction(`Edited My Picks product: ${productName}`);
    updateDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id !== gearSection.id) return section;
        const currentItems = Array.isArray(section.data.items) ? section.data.items as GearItem[] : [];
        return {
          ...section,
          data: {
            ...section.data,
            items: currentItems.map((item, itemIndex) => itemIndex === index ? setAt(item, path, value) as GearItem : item),
          },
        };
      }),
    }));
  };

  const reorderProducts = (from: number, to: number) => {
    if (!gearSection || from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    const nextItems = [...items];
    const [moved] = nextItems.splice(from, 1);
    nextItems.splice(to, 0, moved);
    logAction(`Reordered My Picks: ${moved?.name || moved?.brand || `Pick ${from + 1}`} → ${to + 1}`);
    updateDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => section.id === gearSection.id
        ? { ...section, data: { ...section.data, items: nextItems } }
        : section),
    }));
  };

  const addPickToGear = (pick: GearItem, index: number) => {
    if (!gearSection || !riderKitSection || !isOn(pick)) return;
    const title = pick.name?.trim() || [pick.brand, pick.model].filter(Boolean).join(" ") || `Pick ${index + 1}`;
    const now = Date.now().toString(36);
    const sourcePickId = pick.id || makeGearItemId(title, `shop-${now}-${index + 1}`);
    if (mappedPickIds.has(sourcePickId) || mapItems.some((item) => item.sourcePickId === sourcePickId)) return;

    const zoneText = `${pick.bodyPart ?? ""} ${pick.category ?? ""} ${pick.name ?? ""} ${pick.brand ?? ""}`.toLocaleLowerCase();
    const zone: RiderKitPointer["zone"] = /intercom|communicator|sena/.test(zoneText)
      ? "intercom"
      : /head|helmet|visor|eyewear|goggle/.test(zoneText)
        ? "head"
        : /hand|glove|wrist/.test(zoneText)
          ? "hands"
          : /foot|feet|boot|shoe/.test(zoneText)
            ? "feet"
            : /waist|hip|sling.?bag|cross.?body|belt.?bag/.test(zoneText)
              ? "waist"
              : /leg|trouser|pant|legging|knee/.test(zoneText)
                ? "legs"
                : "torso";
    const initialPosition: Record<RiderKitPointer["zone"], { x: number; y: number }> = {
      head: { x: 52, y: 16 },
      torso: { x: 50, y: 40 },
      hands: { x: 68, y: 68 },
      waist: { x: 61, y: 57 },
      legs: { x: 50, y: 71 },
      feet: { x: 50, y: 91 },
      intercom: { x: 64, y: 17 },
    };
    const targetId = makeGearItemId(title, `map-${now}-${index + 1}`);
    const mapCopy: GearItem = {
      ...pick,
      id: targetId,
      sourcePickId,
      enabled: true,
      highlights: Array.isArray(pick.highlights) ? [...pick.highlights] : [],
    };
    const point = initialPosition[zone];
    const pointer: RiderKitPointer = {
      id: `${targetId}-pointer`,
      label: title,
      gearId: targetId,
      zone,
      x: point.x,
      y: point.y,
      radius: 10,
      enabled: true,
    };
    updateDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id === gearSection.id) {
          const currentItems = Array.isArray(section.data.items) ? section.data.items as GearItem[] : [];
          return {
            ...section,
            data: {
              ...section.data,
              items: currentItems.map((item, itemIndex) => itemIndex === index && !item.id ? { ...item, id: sourcePickId } : item),
            },
          };
        }
        if (section.id === riderKitSection.id) {
          const currentItems = Array.isArray(section.data.items) ? section.data.items as GearItem[] : [];
          const currentPointers = Array.isArray(section.data.mapPointers) ? section.data.mapPointers as RiderKitPointer[] : [];
          return {
            ...section,
            data: {
              ...section.data,
              items: [...currentItems, mapCopy],
              mapPointers: [...currentPointers, pointer],
            },
          };
        }
        return section;
      }),
    }));
    logAction(`Copied ${title} from My Picks to The Gear with a rider pointer`);
  };

  const addAffiliatePick = () => {
    if (!gearSection) return;
    const id = makeGearItemId("affiliate-pick", `${Date.now().toString(36)}-${items.length + 1}`);
    const product: GearItem = {
      ...GEAR_ITEM_TEMPLATE,
      id,
      enabled: false,
      category: "",
      bodyPart: "",
      name: "",
      brand: "",
      model: "",
      description: "",
      image: "",
      imageAlt: "",
      highlights: [],
      fit: "",
      usedFor: "",
      price: "",
      link: "",
    };
    updateDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id !== gearSection.id) return section;
        const currentItems = Array.isArray(section.data.items) ? section.data.items as GearItem[] : [];
        return { ...section, data: { ...section.data, items: [...currentItems, product] } };
      }),
    }));
    setOpenKey(id);
    logAction("Added a hidden affiliate pick");
  };

  const removePick = (index: number) => {
    if (!gearSection || !items[index]) return;
    const product = items[index];
    const key = productKey(product, index);
    const title = product.name || product.brand || `Pick ${index + 1}`;
    updateDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id !== gearSection.id) return section;
        const currentItems = Array.isArray(section.data.items) ? section.data.items as GearItem[] : [];
        return { ...section, data: { ...section.data, items: currentItems.filter((_, itemIndex) => itemIndex !== index) } };
      }),
    }));
    setOpenKey((current) => current === key ? null : current);
    logAction(`Removed My Picks product: ${title}`);
  };

  return (
    <div className="min-w-0">
      <section className="min-w-0 rounded-3xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.08] pb-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-saffron-300">Shop · My Picks</p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-white">My Picks</h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-500">Arrange picks by dragging the left grip. Edit each pick here; use Add to The Gear to create a separate product copy and rider-image pointer that you can reposition independently. New affiliate picks stay hidden until enabled.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="#/shop"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-saffron-300/40 hover:text-white"
            >
              <Eye className="h-3.5 w-3.5" /> Preview shop page
            </a>
            <button
              type="button"
              onClick={addAffiliatePick}
              className="inline-flex items-center gap-2 rounded-full bg-saffron-400 px-4 py-2.5 text-xs font-bold text-on-gold transition hover:brightness-110"
            >
              <Plus className="h-3.5 w-3.5" /> Add affiliate pick
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
          <span>Current My Picks · {items.length} {items.length === 1 ? "product" : "products"}</span>
          <span>Changes stay in the dashboard draft until saved</span>
        </div>

        {items.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-white/12 px-5 py-12 text-center">
            <ShoppingBag className="mx-auto h-6 w-6 text-zinc-600" />
            <p className="mt-3 text-sm font-semibold text-zinc-300">No products in My Picks</p>
            <p className="mt-1 text-xs text-zinc-600">No sample products are preloaded. Add an affiliate pick only when you have a product to feature.</p>
          </div>
        ) : (
          <ol className="mt-4 flex flex-col gap-3">
            {items.map((item, index) => {
              const key = productKey(item, index);
              const title = item.name?.trim() || [item.brand, item.model].filter(Boolean).join(" ") || `Untitled pick ${index + 1}`;
              const open = openKey === key;
              const isPublished = isOn(item);
              return (
                <li
                  key={key}
                  onDragOver={(event) => {
                    if (dragFrom === null) return;
                    event.preventDefault();
                    setDragOver(index);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragFrom !== null) reorderProducts(dragFrom, index);
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  className={cn(
                    "overflow-hidden rounded-2xl border bg-white/[0.025] transition-colors",
                    open ? "border-saffron-300/35" : "border-white/[0.08]",
                    dragOver === index && dragFrom !== null && dragFrom !== index && "border-saffron-400 bg-saffron-400/10",
                    dragFrom === index && "opacity-50"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-3 sm:p-3">
                    <button
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        setDragFrom(index);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", String(index));
                      }}
                      onDragEnd={() => {
                        setDragFrom(null);
                        setDragOver(null);
                      }}
                      aria-label={`Drag ${title} to reorder My Picks`}
                      title="Drag to arrange My Picks"
                      className="grid h-9 w-6 shrink-0 cursor-grab place-items-center text-zinc-600 active:cursor-grabbing"
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenKey(open ? null : key)}
                      aria-expanded={open}
                      aria-label={`Edit ${title}`}
                      className="flex min-w-[8rem] flex-1 items-center gap-3 rounded-xl p-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-saffron-300"
                    >
                      {/* `product-plate` is a literal #ffffff, not the `white`
                          token: the light theme remaps white to near-black, so
                          a wide product photo used to sit on a black band in
                          the dashboard. Same plate the shop puts behind it. */}
                      <span className="product-plate grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/10">
                        {item.image ? <img src={item.image} alt="" className="h-full w-full object-contain" /> : <ImageOff className="h-4 w-4 text-zinc-500" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-white">{title}</span>
                          {!isPublished && <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-amber-200">Hidden draft</span>}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-zinc-500">{item.category || "Select a product category"}{item.brand ? ` · ${item.brand}` : ""}</span>
                      </span>
                      {item.price?.trim() && <span className="hidden shrink-0 font-mono text-xs font-semibold text-saffron-200 sm:block">{item.price}</span>}
                      <ChevronDown className={cn("h-4 w-4 shrink-0 text-zinc-500 transition-transform", open && "rotate-180")} />
                    </button>
                    <div className="ml-auto flex basis-full shrink-0 items-center justify-end gap-1 sm:basis-auto">
                      <button
                        type="button"
                        onClick={() => reorderProducts(index, index - 1)}
                        disabled={index === 0}
                        aria-label={`Move ${title} up`}
                        className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 hover:bg-white/[0.12] hover:text-white disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => reorderProducts(index, index + 1)}
                        disabled={index === items.length - 1}
                        aria-label={`Move ${title} down`}
                        className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 hover:bg-white/[0.12] hover:text-white disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <Switch on={isPublished} onChange={(enabled) => patchProduct(index, "enabled", enabled)} label={`Show ${title} in My Picks`} />
                      <button
                        type="button"
                        onClick={() => removePick(index)}
                        aria-label={`Remove ${title} from My Picks`}
                        className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 hover:bg-red-500/15 hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {open && (
                    <div className="grid gap-3.5 border-t border-white/[0.07] p-3.5 sm:p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-saffron-200">Edit this pick</p>
                          <p className="mt-1 text-[10px] text-zinc-500">The Gear receives a separate copy; later edits here will not change it.</p>
                        </div>
                        {mappedPickIds.has(item.id ?? "") ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 text-[10px] font-semibold text-emerald-300">
                            <Check className="h-3.5 w-3.5" /> Copied to The Gear
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => addPickToGear(item, index)}
                            disabled={!isPublished || !riderKitSection}
                            title={!isPublished ? "Enable this My Picks product before adding it to The Gear" : !riderKitSection ? "The Gear section is not configured" : "Create an independent The Gear product and rider pointer"}
                            className="inline-flex items-center gap-2 rounded-full border border-saffron-300/30 bg-saffron-300/[0.08] px-3.5 py-2 text-[10px] font-bold text-saffron-200 transition hover:border-saffron-300/60 hover:bg-saffron-300/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Crosshair className="h-3.5 w-3.5" /> {isPublished ? "Add to The Gear" : "Enable pick first"}
                          </button>
                        )}
                      </div>
                      {GEAR_ITEM_FIELDS.map((field) => (
                        <FieldRow
                          key={field.path}
                          field={field}
                          value={getAt(item, field.path)}
                          onChange={(value) => patchProduct(index, field.path, value)}
                        />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
/* ═══════════════ Backups ═══════════════ */

/**
 * The daily zip, as the server sees it: the schedule, the archives on disk, a
 * button for taking one now, and a download link each. Restoring happens on
 * the first-run setup screen — this is the half you use while the site is live.
 */
function BackupsPanel() {
  const [state, setState] = useState<BackupState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await siteApi.listBackups());
    } catch (error) {
      setMsg({ ok: false, text: describeApiError(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const backupNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const backup = await siteApi.createBackup();
      setMsg({ ok: true, text: `Wrote ${backup.name} (${formatBytes(backup.bytes)}).` });
      await refresh();
    } catch (error) {
      setMsg({ ok: false, text: describeApiError(error) });
    } finally {
      setBusy(false);
    }
  };

  const hour = String(state?.hour ?? 2).padStart(2, "0");

  return (
    <div className="grid gap-6">
      <div className="rounded-3xl glass p-6">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold text-white">
          <DatabaseBackup className="h-4 w-4 text-saffron-300" /> Backups
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          Every day at {hour}:00 the server writes a zip into <span className="text-zinc-300">backup/</span>{" "}
          at the root of the installation and keeps the newest {state?.keep ?? 10}. Each zip holds the
          whole database (accounts included, with their password hashes), every uploaded file, and the
          application itself — so a redeploy can restore from it alone.
        </p>

        <div className="mt-4 grid gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3 sm:grid-cols-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">Schedule</p>
            <p className="mt-1 text-sm font-semibold text-white">
              {state?.enabled === false ? "Off" : `Daily at ${hour}:00`}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">Last backup</p>
            <p className="mt-1 text-sm font-semibold text-white">
              {state?.lastBackupAt ? whenLabel(state.lastBackupAt) : "Never yet"}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">Next one</p>
            <p className="mt-1 text-sm font-semibold text-white">
              {state?.nextRunAt ? whenLabel(state.nextRunAt) : "—"}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void backupNow()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-saffron-400 px-5 py-3 font-display text-sm font-semibold text-on-gold shadow-lg shadow-saffron-400/25 transition-all hover:brightness-110 active:scale-95 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />}
            {busy ? "Archiving…" : "Back up now"}
          </button>
          <p className="text-[11px] leading-relaxed text-zinc-600">
            Stored in <span className="font-mono text-zinc-400">{state?.dir ?? "backup/"}</span>. Keep a
            copy somewhere else too — a backup on the same disk is not a backup.
          </p>
        </div>

        {msg && (
          <p className={cn("mt-3 text-xs font-medium", msg.ok ? "text-emerald-300" : "text-red-400")}>
            {msg.text}
          </p>
        )}

        <ul className="mt-5 grid gap-2">
          {(state?.backups ?? []).map((backup) => (
            <li
              key={backup.name}
              className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3"
            >
              <FileArchive className="h-4 w-4 shrink-0 text-zinc-500" />
              <div className="min-w-0">
                <p className="truncate font-mono text-[11px] text-zinc-300">{backup.name}</p>
                <p className="text-[10px] text-zinc-600">
                  {whenLabel(backup.createdAt)} · {formatBytes(backup.bytes)}
                </p>
              </div>
              <a
                href={`/api/backups/${encodeURIComponent(backup.name)}`}
                download
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-2.5 py-1.5 text-[10px] font-bold text-zinc-300 transition-colors hover:bg-white/[0.1] hover:text-white"
              >
                <Download className="h-3 w-3" /> Download
              </a>
            </li>
          ))}
          {state && state.backups.length === 0 && (
            <li className="text-xs text-zinc-500">No archives yet. The first one runs tonight.</li>
          )}
        </ul>

        <div className="mt-5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Restoring one
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
            Deploy the application on the new server without the <span className="text-zinc-300">data/</span>{" "}
            folder, open the site, and choose <span className="text-zinc-300">Restore a backup</span> on the
            setup screen. Upload the zip; the database details it carries are filled in and can be edited
            before anything is written. The archive&apos;s{" "}
            <span className="font-mono text-zinc-400">pb-restore.json</span> can also be edited by hand if
            you prefer.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ Page shell ═══════════════ */

/**
 * The dashboard's top-level list.
 *
 * Everything that belongs to the site as a whole — the logo and brand, the
 * theme colours, the map look, the loader, the backups, the revision history —
 * is one button now: Settings. They used to be five separate ones beside the
 * page sections, which made the list long without making anything easier to
 * find. Settings holds them in a short sub-list instead.
 */
type Tab = "sections" | "shop" | "menu" | "footer" | "media" | "settings";

const TABS: { id: Tab; label: string; icon: typeof List }[] = [
  { id: "sections", label: "Sections", icon: List },
  { id: "shop", label: "Shop", icon: ShoppingBag },
  { id: "menu", label: "Header", icon: Link2 },
  { id: "footer", label: "Footer", icon: LayoutList },
  { id: "media", label: "Media folder", icon: Images },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function AdminPage() {
  const { content, draft, updateDraft, logAction, theme, setTheme, hasChanges, saveDraft, saveBranding, saveError, discardDraft, editedActions } = useSite();
  const { account, setAccount } = useSite();
  const authed = Boolean(account);
  const [tab, setTab] = useState<Tab>("sections");
  const [saveDesc, setSaveDesc] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveScope, setSaveScope] = useState<"all" | "brand">("all");
  const [countdownSaveConflict, setCountdownSaveConflict] = useState<SectionEntry | null>(null);

  if (!authed) {
    return <Login onLogin={(user) => setAccount(user)} />;
  }

  // Read-only accounts sign in through the members page. They may never reach
  // the editor, even by typing #/admin themselves.
  if (account?.role === "reader") {
    const leave = () => {
      void siteApi.logout().catch(() => undefined);
      setAccount(null);
      window.location.hash = "#/members";
    };
    return (
      <div className="grid min-h-screen place-items-center bg-ink-950 px-5 text-white">
        <div className="w-full max-w-md rounded-3xl glass p-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.06] text-saffron-300">
            <Lock className="h-5 w-5" />
          </span>
          <h1 className="mt-5 font-display text-xl font-semibold">Read-only account</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            This account can read the members-only sections of the site, but it cannot edit
            anything. Ask the owner if you need editor access.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <a
              href="#/"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-saffron-400 px-5 py-3 text-sm font-semibold text-on-gold transition-all duration-300 hover:brightness-110"
            >
              Back to the site
            </a>
            <button
              type="button"
              onClick={leave}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/12 px-5 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const logout = () => {
    // Clear the server session; the browser keeps nothing to clear.
    void siteApi.logout().catch(() => {
      /* the cookie expires on its own; the screen still signs out */
    });
    // The next sign-in opens at the top, not where this session was.
    forgetDashboardScroll();
    setAccount(null);
  };

  const openSaveModal = (scope: "all" | "brand" = "all") => {
    setSaveScope(scope);
    const defaultText = scope === "brand" ? "Updated logo & branding" : editedActions.join(" · ");
    setSaveDesc(defaultText || "Website Update");
    const countdown = draft.sections.find((s) => s.type === "countdown" && s.enabled);
    if (countdown && getActiveCountdownTargets(draft.sections, countdown.data.revealSectionIds).length > 0) {
      setCountdownSaveConflict(structuredClone(countdown));
      setShowSaveModal(false);
      return;
    }
    setShowSaveModal(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    // Re-check at publishing too: a target may have been switched on after
    // the reveal checklist was configured, or updated in another open tab.
    const countdown = draft.sections.find((s) => s.type === "countdown" && s.enabled);
    if (countdown && getActiveCountdownTargets(draft.sections, countdown.data.revealSectionIds).length > 0) {
      setCountdownSaveConflict(structuredClone(countdown));
      setShowSaveModal(false);
      return;
    }
    const saved = saveScope === "brand"
      ? saveBranding(saveDesc.trim() || "Updated logo & branding")
      : saveDraft(saveDesc.trim() || "Website Update");
    if (!saved) return;
    setSaveDesc("");
    setShowSaveModal(false);
  };

  const resetCountdownBeforeSave = () => {
    if (!countdownSaveConflict) return;
    const activeTargets = getActiveCountdownTargets(draft.sections, countdownSaveConflict.data.revealSectionIds);
    activeTargets.forEach((target) => logAction(`Disabled: ${target.label} (countdown setup)`));
    updateDraft((c) => resetActiveTargetsForCountdown(c, countdownSaveConflict));
    if (activeTargets.length) {
      setSaveDesc((text) => `${text} · Reset active countdown targets: ${activeTargets.map((target) => target.label).join(", ")}`);
    }
    setCountdownSaveConflict(null);
    // Open the normal save confirmation only after the draft has been reset.
    setShowSaveModal(true);
  };

  const cancelCountdownBeforeSave = () => {
    if (!countdownSaveConflict) return;
    updateDraft((c) => cancelCountdownSetup(c, content, countdownSaveConflict.id));
    logAction("Cancelled countdown setup");
    setCountdownSaveConflict(null);
    setShowSaveModal(false);
    setSaveDesc("");
  };

  return (
    <div className="relative min-h-screen bg-ink-950 pb-20">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" aria-hidden />

      {/* ---------- Header bar (Sticky and Beautiful, just like landing page) ---------- */}
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-ink-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-5 py-4 sm:px-8">
          <a href="#/" aria-label="Back to site" className="group inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-xs font-semibold text-zinc-300 transition-all duration-300 hover:border-white/25 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-0.5" />
            Site
          </a>
          <div className="flex items-center gap-3">
            <span className="relative grid aspect-square h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-saffron-400 font-display text-sm font-bold text-on-gold shadow-lg shadow-saffron-400/25 transition-transform duration-300 group-hover:scale-105 group-hover:rotate-3">
              PB
            </span>
            <div>
              <h1 className="font-display text-sm font-semibold text-white">PB Control</h1>
              <p className="text-[11px] text-zinc-500">Frontend dashboard</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* One slot, two jobs: Save Changes while the draft is dirty, View
                Website when it is not. There is no separate Preview button —
                that switch lives in the site header. */}
            {hasChanges ? (
              <div className="flex items-center gap-2.5">
                <button
                  onClick={discardDraft}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-4 py-2 text-xs font-semibold text-zinc-300 border border-white/10 transition-colors hover:bg-white/[0.12] hover:text-white active:scale-95"
                >
                  <RefreshCcw className="h-3.5 w-3.5" /> Discard
                </button>
                <button
                  onClick={() => openSaveModal()}
                  className="inline-flex items-center gap-1.5 rounded-full bg-saffron-400 px-4 py-2 text-xs font-bold text-on-gold shadow-xl shadow-saffron-400/30 transition-all duration-300 hover:brightness-110 animate-pulse active:scale-95"
                >
                  <Save className="h-3.5 w-3.5" /> Save Changes
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <span className="hidden items-center gap-1.5 rounded-full bg-emerald-400/10 px-3 py-1 text-[11px] font-bold text-emerald-400 sm:inline-flex">
                  <Check className="h-3.5 w-3.5" /> Up to date
                </span>
                <a
                  href="#/"
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-ink-950 shadow-lg shadow-white/10 transition-all duration-300 hover:shadow-[0_0_24px_rgba(255,255,255,0.25)] active:scale-95"
                >
                  <Eye className="h-3.5 w-3.5" /> View Website
                </a>
              </div>
            )}

            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
              className="shrink-0 aspect-square grid h-9 w-9 place-items-center rounded-full glass text-zinc-300 transition-colors hover:text-white"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={logout}
              className="inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:text-red-400"
            >
              <LogOut className="h-3.5 w-3.5" /> Logout
            </button>
          </div>
        </div>
      </header>

      {/* ---------- Main dashboard content ---------- */}
      <div className="relative mx-auto flex max-w-7xl flex-col gap-8 px-5 py-8 sm:px-8 lg:flex-row">
        {/*
          The option list sticks below the header on wide screens, so switching
          tabs never requires scrolling back up. `self-start` stops the flex row
          from stretching it to the full column height (which would leave no
          room to stick).

          The max-height is deliberately more conservative than the raw viewport
          space: a sticky box is also capped by its container's bottom edge, so
          at the very end of the page a too-tall list gets pushed up behind the
          header. Leaving the extra `rem` of slack keeps every option visible,
          and the list scrolls on its own when it is taller than that.
        */}
        <nav
          aria-label="Dashboard"
          className="grid w-full shrink-0 grid-cols-4 justify-items-center gap-2 lg:sticky lg:top-24 lg:w-48 lg:flex lg:flex-col lg:items-stretch lg:self-start lg:gap-2"
        >
          {TABS.map((t) => (
            <div key={t.id} className="flex w-full shrink-0 flex-col items-center lg:items-stretch">
              <button
                type="button"
                onClick={() => setTab(t.id)}
                aria-label={t.label}
                title={t.label}
                aria-pressed={tab === t.id}
                className={cn(
                  "dashboard-nav-option inline-flex h-11 w-11 items-center justify-center rounded-xl border p-0 text-sm font-semibold transition-colors duration-200 lg:h-auto lg:w-full lg:justify-start lg:gap-2.5 lg:px-4 lg:py-3",
                  tab === t.id
                    ? "border-saffron-400 bg-saffron-400/10 text-white"
                    : "border-white/25 bg-white/[0.03] text-zinc-300 hover:border-white/40 hover:bg-white/[0.06] hover:text-white"
                )}
              >
                <t.icon className="h-4 w-4 shrink-0" />
                <span className="hidden lg:inline">{t.label}</span>
              </button>
            </div>
          ))}
        </nav>

        <main className="min-w-0 flex-1">
          {saveError && !showSaveModal && (
            <p role="alert" className="mb-5 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-400">
              {saveError}
            </p>
          )}
          {tab === "sections" && <SectionsPanel />}
          {tab === "shop" && <ShopPanel />}
          {tab === "menu" && <MenuPanel />}
          {tab === "footer" && <FooterPanel />}
          {tab === "media" && <MediaPanel />}
          {tab === "settings" && <SettingsPanel />}
        </main>
      </div>

      {countdownSaveConflict && (
        <CountdownSetupDialog
          activeSections={getActiveCountdownTargets(draft.sections, countdownSaveConflict.data.revealSectionIds)}
          onReset={resetCountdownBeforeSave}
          onCancel={cancelCountdownBeforeSave}
        />
      )}

      {/* ---------- Save description dialog ---------- */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5 backdrop-blur-sm animate-fade-in">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-dialog-title"
            aria-describedby="save-dialog-description"
            onKeyDown={(e) => { if (e.key === "Escape") setShowSaveModal(false); }}
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-ink-950 p-6 shadow-2xl shadow-black/80"
          >
            <div className="flex items-center justify-between border-b border-white/[0.07] pb-4">
              <h3 id="save-dialog-title" className="flex items-center gap-2 font-display text-base font-semibold text-white">
                <Save className="h-4.5 w-4.5 text-saffron-300" />
                {saveScope === "brand" ? "Save your branding?" : "Save changes to website?"}
              </h3>
              <button
                onClick={() => setShowSaveModal(false)}
                aria-label="Close dialog"
                className="shrink-0 aspect-square grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-zinc-400 transition-colors hover:bg-white/[0.15] hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-5">
              <label htmlFor="save-desc" className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500 block mb-2">
                What did you change? (Revision label)
              </label>
              <input
                id="save-desc"
                type="text"
                required
                value={saveDesc}
                onChange={(e) => setSaveDesc(e.target.value)}
                placeholder="e.g. Updated Spiti details & updated pricing plan names"
                className={inputCls}
                autoFocus
              />
              <p id="save-dialog-description" className="mt-2 text-xs leading-relaxed text-zinc-400">
                {saveScope === "brand"
                  ? "This saves only your logo, text, and colours. Other edits remain in your draft. A revision is kept so you can revert later."
                  : "This saves all pending changes, including branding. The description helps you find this edit in Revision History."}
              </p>

              {saveError && <p role="alert" className="mt-3 text-xs leading-relaxed text-red-400">{saveError}</p>}

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowSaveModal(false)}
                  className="rounded-xl bg-white/[0.05] px-4 py-2.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/[0.12] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#f5b301] px-5 py-2.5 text-xs font-bold text-[#171513] shadow-lg shadow-saffron-400/25 transition-all duration-300 hover:brightness-110 active:scale-95"
                >
                  {saveScope === "brand" ? "Confirm & Save Branding" : "Confirm & Publish"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
