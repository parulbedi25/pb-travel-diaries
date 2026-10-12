import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FileText,
  Crosshair,
  FolderOpen,
  GripVertical,
  History,
  Image as ImageIcon,
  Images,
  KeyRound,
  LayoutList,
  Palette,
  Link2,
  Power,
  List,
  Lock,
  LogOut,
  Moon,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Settings,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  useSite,
  defaultDataFor,
  resolveFooter,
  type BikeHotspot,
  type BrandSettings,
  type CountdownData,
  type FooterColumn,
  type FooterLink,
  type FooterSettings,
  type FooterSocial,
  type SectionEntry,
  type SectionType,
  type SiteContent,
} from "../store/siteContent";
import BrandLogo from "../components/BrandLogo";
import { FooterView } from "../components/Footer";
import { useCountdown, useCountdownFinished } from "../components/CountdownSection";
import { cn } from "../utils/cn";
import ImageField from "./ImageField";
import FileField from "./FileField";
import CountdownSetupDialog from "./CountdownSetupDialog";
import {
  cancelCountdownSetup,
  getActiveCountdownTargets,
  resetActiveTargetsForCountdown,
} from "./countdownSetup";
import { ThemePanel, HeaderButtonsEditor, RestoreBar } from "./SettingsExtras";
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
import { BikeLoaderMark } from "../components/Loader";
import {
  addAnyMediaFile,
  formatBytes,
  listMedia,
  removeMedia,
  type MediaItem,
} from "./mediaLibrary";

/* ═══════════════ Admin auth (client-side, static hosting) ═══════════════ */

const DEFAULT_PASSWORD = "pbadmin";
const HASH_KEY = "pb_admin_hash";
const SESSION_KEY = "pb_admin_session";

async function hashPass(pw: string): Promise<string> {
  try {
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    /* fall through */
  }
  let h = 5381;
  for (let i = 0; i < pw.length; i++) h = ((h << 5) + h) ^ pw.charCodeAt(i);
  return "djb2_" + (h >>> 0).toString(16);
}

async function verifyPassword(pw: string): Promise<boolean> {
  const stored = localStorage.getItem(HASH_KEY);
  const target = stored ?? (await hashPass(DEFAULT_PASSWORD));
  return (await hashPass(pw)) === target;
}

/* ═══════════════ Field descriptors for the generic editor ═══════════════ */

export interface Field {
  path: string;
  label: string;
  kind: "text" | "textarea" | "number" | "image" | "toggle" | "strings" | "items" | "datetime" | "reveal" | "color" | "file";
  hint?: string;
  fields?: Field[];
  template?: unknown;
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
const STR = (path: string, label: string, hint?: string): Field => ({ path, label, kind: "strings", hint });

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
    T("namePlate", "Name plate (Urdu)", "e.g. طویل"),
    T("namePlateEn", "Name plate (English)", "e.g. Taweel"),
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
        IMG("image", "Product image URL"),
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
  benefits: [
    T("eyebrow", "Eyebrow label"),
    T("titleA", "Title — before highlight"),
    T("titleHi", "Title — highlighted"),
    T("titleB", "Title — after highlight"),
    TA("sub", "Subtitle"),
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
    DT("expectedBack", "Expected back", "Leave empty to hide the return countdown"),
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

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-saffron-400/60 focus:outline-none transition-colors";

function Switch({
  on,
  onChange,
  label,
  disabled = false,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!on);
      }}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300",
        disabled && "cursor-not-allowed opacity-50",
        on ? "bg-saffron-400" : "bg-white/15"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-300",
          on ? "left-[22px]" : "left-0.5"
        )}
      />
    </button>
  );
}

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
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(String(value ?? "")) ? String(value) : "#f5b301"}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${field.label} colour`}
            className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent p-0.5"
          />
          <input
            type="text"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Default"
            maxLength={7}
            spellCheck={false}
            aria-label={`${field.label} hex`}
            className={cn(inputCls, "min-w-0 font-mono text-xs")}
          />
          {value ? (
            <button
              type="button"
              onClick={() => onChange("")}
              className="shrink-0 rounded-lg bg-white/[0.06] px-2.5 py-2 text-[11px] font-semibold text-zinc-400 hover:text-white"
            >
              Default
            </button>
          ) : null}
        </div>
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
        />
      ) : (
        <input
          type="text"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      )}
      {field.kind !== "image" && field.hint && (
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
          onClick={() =>
            onChange([...items, structuredClone(field.template ?? { name: "New item" })])
          }
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-4 py-3 text-xs font-semibold text-zinc-400 transition-all duration-300 hover:border-saffron-400/50 hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" /> Add item
        </button>
      </div>
    </div>
  );
}

/* ═══════════════ Login ═══════════════ */

function Login({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { theme, setTheme } = useSite();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const ok = await verifyPassword(pw);
    setBusy(false);
    if (ok) {
      localStorage.setItem(SESSION_KEY, "1");
      onLogin();
    } else {
      setError("Wrong password. Try again.");
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
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-saffron-400 font-display text-sm font-bold text-on-gold shadow-lg shadow-saffron-400/30">
              PB
            </span>
            <div>
              <h1 className="font-display text-lg font-semibold text-white">PB Control</h1>
              <p className="text-xs text-zinc-500">Admin sign in</p>
            </div>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
              className="ml-auto grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-zinc-400 transition-colors hover:text-white"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>

          <form onSubmit={submit} className="mt-7 flex flex-col gap-3">
            <label htmlFor="admin-pw" className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Password
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                id="admin-pw"
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoFocus
                placeholder="••••••••"
                className={cn(inputCls, "pl-10")}
              />
            </div>
            {error && <p className="text-xs font-medium text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-saffron-400 px-5 py-3 font-display text-sm font-semibold text-on-gold shadow-lg shadow-saffron-400/30 transition-all duration-300 hover:brightness-110 active:scale-95 disabled:opacity-60"
            >
              {busy ? "Checking…" : "Enter dashboard"}
            </button>
          </form>

          <p className="mt-5 rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-[11px] leading-relaxed text-zinc-500">
            First time? The default password is{" "}
            <code className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-saffron-300">
              {DEFAULT_PASSWORD}
            </code>{" "}
            — change it in Settings right after logging in.
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
                  "absolute z-10 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full border-2 text-[10px] font-bold shadow-lg transition-colors",
                  isOpen
                    ? "border-white bg-saffron-400 text-on-gold"
                    : "border-white bg-ink-950/85 text-white hover:border-saffron-300",
                  isDragging ? "cursor-grabbing scale-110" : "cursor-grab"
                )}
                style={{ left: `${dx}%`, top: `${dy}%` }}
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
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-saffron-400 text-[10px] font-bold text-on-gold">
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
              <span key={u.label} className="rounded-lg bg-black/45 px-2 py-1.5 text-center">
                <span className="block font-mono text-sm font-bold tabular-nums text-saffron-300">
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
    logAction("Added a Custom Section block");
    const id = `sec-custom-${Date.now()}`;
    updateDraft((c) => ({
      ...c,
      sections: [
        ...c.sections,
        {
          id,
          type: "custom",
          label: "Custom section",
          enabled: true,
          data: {
            eyebrow: "New section",
            title: "A fresh story block",
            sub: "Describe it here — visitors will see this right on the page.",
            image: "",
            imageAlt: "",
            buttonLabel: "Learn more",
            buttonHref: "#top",
            layout: "image-right",
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

  const setSectionData = (id: string, path: string, v: unknown) => {
    const s = sections.find((x) => x.id === id);
    if (!s) return;
    const nextData = setAt(s.data, path, v);
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

  const fields = selected
    ? selected.type === "custom"
      ? CUSTOM_FIELDS
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
                className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-zinc-400 transition-colors hover:bg-white/[0.15] hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
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

function MenuPanel() {
  const { draft, updateDraft, logAction } = useSite();

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
            {draft.nav.filter((n) => n.enabled).length} of {draft.nav.length} links shown · rename,
            relink, reorder or hide any item
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
        {draft.nav.map((n, i) => (
          <div
            key={n.id}
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-2xl border p-4 transition-colors",
              n.enabled ? "border-white/[0.08] bg-white/[0.03]" : "border-white/[0.05] bg-white/[0.01]"
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
        ))}
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
  const [hex, setHex] = useState(value);
  const validHex = /^#[0-9a-f]{6}$/i;

  useEffect(() => setHex(value), [value]);

  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="color"
        value={validHex.test(value) ? value : "#ffffff"}
        onInput={(e) => onChange(e.currentTarget.value)}
        onChange={(e) => onChange(e.currentTarget.value)}
        aria-label={`${label} colour`}
        className="h-10 w-11 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent p-0.5"
      />
      <input
        type="text"
        value={hex}
        onChange={(e) => {
          setHex(e.target.value);
          if (validHex.test(e.target.value)) onChange(e.target.value);
        }}
        onBlur={() => { if (!validHex.test(hex)) setHex(value); }}
        aria-label={`${label} hex colour`}
        aria-invalid={!validHex.test(hex)}
        placeholder="#ffffff"
        maxLength={7}
        spellCheck={false}
        className={cn(inputCls, "min-w-0 font-mono text-xs")}
      />
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

function SettingsPanel() {
  const { theme, setTheme, updateDraft, draft, loaderDraft, setLoaderDraft } = useSite();
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [cf, setCf] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const ok = await verifyPassword(cur);
    if (!ok) {
      setMsg({ ok: false, text: "Current password is wrong." });
      return;
    }
    if (nw.length < 4) {
      setMsg({ ok: false, text: "New password must be at least 4 characters." });
      return;
    }
    if (nw !== cf) {
      setMsg({ ok: false, text: "New passwords don't match." });
      return;
    }
    localStorage.setItem(HASH_KEY, await hashPass(nw));
    setCur("");
    setNw("");
    setCf("");
    setMsg({ ok: true, text: "Password updated. Use it next time you sign in." });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ ...draft, loaderLogo: loaderDraft }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pb-site-content-draft.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as {
          v?: number;
          nav?: unknown[];
          sections?: unknown[];
        };
        if (parsed?.v !== 1 || !Array.isArray(parsed.sections) || !Array.isArray(parsed.nav)) {
          setMsg({ ok: false, text: "That file doesn't look like a valid PB content export." });
          return;
        }
        updateDraft(() => parsed as never);
        setMsg({ ok: true, text: "Content imported successfully." });
      } catch {
        setMsg({ ok: false, text: "Couldn't read that file — is it valid JSON?" });
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="max-w-2xl">
      <div className="flex flex-col gap-5">
        {/* theme */}
        <div className="rounded-3xl glass p-6">
          <h3 className="font-display text-base font-semibold text-white">Theme</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Applies across the whole site, including the live map page. Saved per visitor.
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

        {/* loader icon */}
        <div className="rounded-3xl glass p-6">
          <h3 className="font-display text-base font-semibold text-white">Loader icon</h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            Shown while the site loads. Upload your own mark, pick one from the media folder, or
            leave it empty for the default animated rider crossing the mountains.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-[180px_1fr] sm:items-start">
            <div className="grid h-28 place-items-center rounded-2xl border border-white/10 bg-black/40">
              {loaderDraft ? (
                <img src={loaderDraft} alt="" className="max-h-24 max-w-full object-contain" />
              ) : (
                <BikeLoaderMark />
              )}
            </div>
            <div>
              <ImageField value={loaderDraft} onChange={setLoaderDraft} />
              {loaderDraft && (
                <button
                  type="button"
                  onClick={() => setLoaderDraft("")}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-[11px] font-semibold text-zinc-400 hover:bg-red-500/15 hover:text-red-400"
                >
                  <RefreshCcw className="h-3 w-3" /> Use default rider animation
                </button>
              )}
            </div>
          </div>
        </div>

        {/* password */}
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
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/[0.08] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white hover:text-ink-950"
            >
              <Check className="h-4 w-4" /> Update password
            </button>
          </div>
        </form>

        {/* export / import */}
        <div className="rounded-3xl glass p-6">
          <h3 className="font-display text-base font-semibold text-white">Backup &amp; transfer</h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            All edits live in this browser (localStorage). Export a JSON snapshot to back up your
            content or move it to another device — import it back any time.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={exportJson}
              className="inline-flex items-center gap-2 rounded-xl bg-white/[0.08] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white hover:text-ink-950"
            >
              <Download className="h-4 w-4" /> Export JSON
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
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ Revisions Drawer ═══════════════ */

function RevisionsPanel() {
  const { revisions, restoreRevision, deleteRevision } = useSite();

  return (
    <div className="rounded-3xl glass p-6">
      <h3 className="flex items-center gap-2 font-display text-base font-semibold text-white">
        <History className="h-4.5 w-4.5 text-saffron-300" /> Revision History
      </h3>
      <p className="mt-1 text-xs text-zinc-500">
        List of previously saved states. Tap a revision card to revert the website instantly.
      </p>

      {revisions.length === 0 ? (
        <p className="mt-5 text-center text-xs italic text-zinc-600">No revisions logged yet.</p>
      ) : (
        <div className="mt-5 flex flex-col gap-2.5 max-h-[500px] overflow-y-auto pr-1 no-scrollbar">
          {revisions.map((r) => {
            const timeStr = new Date(r.timestamp).toLocaleString("en-IN", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            return (
              <div
                key={r.id}
                className="flex items-start justify-between gap-3 rounded-2xl border border-white/[0.05] bg-white/[0.02] p-3.5 hover:border-white/10"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white truncate">{r.description}</p>
                  <p className="mt-0.5 text-[10px] text-zinc-500">{timeStr}</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => restoreRevision(r)}
                    className="inline-flex items-center gap-1 rounded-lg bg-saffron-400/10 px-2.5 py-1 text-[10px] font-bold text-saffron-300 hover:bg-saffron-400/20"
                  >
                    Revert
                  </button>
                  <button
                    onClick={() => deleteRevision(r.id)}
                    aria-label="Delete revision"
                    className="grid h-6 w-6 place-items-center rounded-lg bg-white/[0.05] text-zinc-500 hover:bg-red-500/15 hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════ Media folder tab ═══════════════ */

function MediaPanel() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => listMedia().then(setItems);

  useEffect(() => {
    void refresh();
  }, []);

  const uploadFiles = async (files: FileList | File[]) => {
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        await addAnyMediaFile(file);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

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
        <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
          Upload photos or documents (PDF, Word, Excel…) from your computer. They stay in this
          browser and can be picked on any image or file field. You can also drop files into{" "}
          <code className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[11px] text-saffron-300">
            public/media/
          </code>{" "}
          and use <code className="font-mono text-[11px] text-zinc-300">/media/filename.jpg</code>.
        </p>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-saffron-400 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-saffron-400/25 disabled:opacity-60"
        >
          <Upload className="h-4 w-4" />
          {busy ? "Uploading…" : "Upload files"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.zip,.gpx"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      </div>

      {items.length === 0 ? (
        <p className="mt-8 text-center text-xs text-zinc-500">No files in the media library yet.</p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((m) => (
            <figure
              key={m.id}
              className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"
            >
              {m.type.startsWith("image/") ? (
                <img src={m.dataUrl} alt={m.name} className="aspect-[4/3] w-full object-cover" />
              ) : (
                <span className="grid aspect-[4/3] w-full place-items-center bg-white/[0.04]">
                  <span className="flex flex-col items-center gap-1.5">
                    <FileText className="h-8 w-8 text-saffron-300" />
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                      {m.name.split(".").pop() || "file"}
                    </span>
                  </span>
                </span>
              )}
              <figcaption className="flex items-start justify-between gap-2 p-3">
                <span>
                  <span className="block truncate text-xs font-medium text-zinc-200">{m.name}</span>
                  <span className="text-[10px] text-zinc-500">{formatBytes(m.size)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void removeMedia(m.id).then(refresh);
                  }}
                  aria-label={`Delete ${m.name}`}
                  className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.06] text-zinc-400 hover:bg-red-500/15 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
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
  const setSocial = (id: string, patch: Partial<FooterSocial>) =>
    write("Edited footer social links", (cur) =>
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
            <h3 className="font-display text-base font-semibold text-white">Social links</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">Icons are fixed. Set each link and show or hide it.</p>
            <ul className="mt-4 flex flex-col gap-2.5">
              {f.socials.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3"
                >
                  <span className="w-28 text-sm font-medium text-zinc-200">{s.label}</span>
                  <input
                    value={s.href}
                    onChange={(e) => setSocial(s.id, { href: e.target.value })}
                    aria-label={`${s.label} link`}
                    placeholder="https://…"
                    className={cn(inputCls, "min-w-0 flex-1 py-2 font-mono text-xs")}
                  />
                  <Switch
                    on={s.enabled}
                    onChange={(v) => setSocial(s.id, { enabled: v })}
                    label={`Show ${s.label}`}
                  />
                </li>
              ))}
            </ul>
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
                <FooterView settings={f} />
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

/* ═══════════════ Page shell ═══════════════ */

type Tab = "sections" | "brand" | "menu" | "footer" | "theme" | "media" | "settings";

const TABS: { id: Tab; label: string; icon: typeof List }[] = [
  { id: "sections", label: "Sections", icon: List },
  { id: "brand", label: "Logo & brand", icon: ImageIcon },
  { id: "menu", label: "Header", icon: Link2 },
  { id: "footer", label: "Footer", icon: LayoutList },
  { id: "theme", label: "Theme colours", icon: Palette },
  { id: "media", label: "Media folder", icon: Images },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function AdminPage() {
  const { content, draft, updateDraft, logAction, theme, setTheme, hasChanges, saveDraft, saveBranding, saveError, discardDraft, editedActions } = useSite();
  const [authed, setAuthed] = useState(() => localStorage.getItem(SESSION_KEY) === "1");
  const [tab, setTab] = useState<Tab>("sections");
  const [saveDesc, setSaveDesc] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveScope, setSaveScope] = useState<"all" | "brand">("all");
  const [countdownSaveConflict, setCountdownSaveConflict] = useState<SectionEntry | null>(null);

  if (!authed) {
    return <Login onLogin={() => setAuthed(true)} />;
  }

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setAuthed(false);
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
            <span className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-saffron-400 font-display text-sm font-bold text-on-gold shadow-lg shadow-saffron-400/25 transition-transform duration-300 group-hover:scale-105 group-hover:rotate-3">
              PB
            </span>
            <div>
              <h1 className="font-display text-sm font-semibold text-white">PB Control</h1>
              <p className="text-[11px] text-zinc-500">Frontend dashboard</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* save button / view website dynamic toggle + discard changes */}
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
              className="grid h-9 w-9 place-items-center rounded-full glass text-zinc-300 transition-colors hover:text-white"
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
        <nav aria-label="Dashboard" className="flex shrink-0 gap-2 overflow-x-auto no-scrollbar lg:w-48 lg:flex-col">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={cn(
                "dashboard-nav-option inline-flex shrink-0 items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-semibold transition-colors duration-200",
                tab === t.id
                  ? "border-saffron-400 bg-saffron-400/10 text-white"
                  : "border-white/25 bg-white/[0.03] text-zinc-300 hover:border-white/40 hover:bg-white/[0.06] hover:text-white"
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
          <div className="mt-6">
            <RevisionsPanel />
          </div>
        </nav>

        <main className="min-w-0 flex-1">
          {saveError && !showSaveModal && (
            <p role="alert" className="mb-5 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-400">
              {saveError}
            </p>
          )}
          {tab === "sections" && <SectionsPanel />}
          {tab === "brand" && <BrandingPanel />}
          {tab === "menu" && <MenuPanel />}
          {tab === "footer" && <FooterPanel />}
          {tab === "theme" && <ThemePanel />}
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
                className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-zinc-400 transition-colors hover:bg-white/[0.15] hover:text-white"
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
