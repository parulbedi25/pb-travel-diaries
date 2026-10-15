import {
  AlignLeft,
  BarChart3,
  Blocks,
  Code2,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  ListChecks,
  Minus,
  MousePointerClick,
  Quote,
  Type,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The building blocks an admin can drop into a composed section.
 *
 * A composed section is a `custom` section whose data carries a `blocks`
 * array. Sections created before this feature have no `blocks` key and keep
 * rendering their original fixed layout, so nothing already published
 * changes shape when this ships.
 */
export type BlockKind =
  | "heading"
  | "text"
  | "image"
  | "imageScroller"
  | "gallery"
  | "list"
  | "tiles"
  | "buttons"
  | "video"
  | "divider"
  | "stats"
  | "quote"
  | "embed";

/** How much of the section's row a block takes up. */
export type BlockWidth = "full" | "two-thirds" | "half" | "third" | "quarter";

export interface SectionBlock {
  id: string;
  kind: BlockKind;
  width: BlockWidth;
  /** Minimum height in pixels. Resized by dragging the block's bottom edge. */
  height: number;
  data: Record<string, unknown>;
}

export const MIN_BLOCK_H = 64;
export const MAX_BLOCK_H = 1400;

/**
 * Widths are expressed as spans of a 12-column grid rather than percentages,
 * so the gap between blocks never pushes a row past full width. Every block
 * is full width on phones and only claims its fraction from `lg` up.
 */
export const WIDTHS: {
  id: BlockWidth;
  label: string;
  short: string;
  className: string;
  fraction: number;
}[] = [
  { id: "full", label: "Full width", short: "Full", className: "col-span-1 lg:col-span-12", fraction: 1 },
  { id: "two-thirds", label: "Two thirds", short: "2/3", className: "col-span-1 lg:col-span-8", fraction: 2 / 3 },
  { id: "half", label: "One half", short: "1/2", className: "col-span-1 lg:col-span-6", fraction: 1 / 2 },
  { id: "third", label: "One third", short: "1/3", className: "col-span-1 lg:col-span-4", fraction: 1 / 3 },
  { id: "quarter", label: "One quarter", short: "1/4", className: "col-span-1 lg:col-span-3", fraction: 1 / 4 },
];

export const widthSpec = (w: BlockWidth) =>
  WIDTHS.find((x) => x.id === w) ?? WIDTHS[0];

/** Snap a pixel width to the nearest allowed fraction of the row. */
export function snapWidth(px: number, rowPx: number): BlockWidth {
  if (rowPx <= 0) return "full";
  const target = px / rowPx;
  return WIDTHS.reduce((best, w) =>
    Math.abs(w.fraction - target) < Math.abs(best.fraction - target) ? w : best
  ).id;
}

export interface BlockSpec {
  kind: BlockKind;
  label: string;
  blurb: string;
  icon: LucideIcon;
  width: BlockWidth;
  height: number;
  data: Record<string, unknown>;
}

const uid = () =>
  `blk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Everything the palette needs: icon, copy, and the starting geometry. */
export const BLOCK_LIBRARY: BlockSpec[] = [
  {
    kind: "heading",
    label: "Heading",
    blurb: "Eyebrow plus a title to open a block of content.",
    icon: Type,
    width: "full",
    height: 120,
    data: { eyebrow: "", text: "A new heading", level: "h2", align: "left" },
  },
  {
    kind: "text",
    label: "Text",
    blurb: "A paragraph of copy, optionally in two columns.",
    icon: AlignLeft,
    width: "full",
    height: 140,
    data: { body: "Write the copy visitors should read here.", align: "left", columns: "1", size: "base" },
  },
  {
    kind: "image",
    label: "Image",
    blurb: "One photo, cropped or contained, with a caption.",
    icon: ImageIcon,
    width: "full",
    height: 320,
    data: { src: "", alt: "", fit: "cover", caption: "", rounded: "2rem" },
  },
  {
    kind: "imageScroller",
    label: "Image scroller",
    blurb: "Photos in a row that swipe or scroll sideways.",
    icon: Images,
    width: "full",
    height: 300,
    data: { images: [], peek: "md", loop: false },
  },
  {
    kind: "gallery",
    label: "Gallery",
    blurb: "A grid of photos that opens full size on click.",
    icon: LayoutGrid,
    width: "full",
    height: 340,
    data: { images: [], columns: "3" },
  },
  {
    kind: "list",
    label: "List",
    blurb: "Ticked, dotted or numbered points with a short note each.",
    icon: ListChecks,
    width: "half",
    height: 220,
    data: {
      items: [{ title: "First point", text: "Explain it in a line or two." }],
      style: "check",
      columns: "1",
    },
  },
  {
    kind: "tiles",
    label: "Option tiles",
    blurb: "Cards people can click — good for choices and links.",
    icon: Blocks,
    width: "full",
    height: 240,
    data: {
      items: [{ title: "Option one", text: "What this option includes.", href: "", badge: "" }],
      columns: "3",
    },
  },
  {
    kind: "buttons",
    label: "Buttons",
    blurb: "One or more calls to action, solid or outlined.",
    icon: MousePointerClick,
    width: "full",
    height: 100,
    data: { items: [{ label: "Learn more", href: "#top", variant: "primary" }], align: "left" },
  },
  {
    kind: "video",
    label: "Video",
    blurb: "A local video file with an optional poster image.",
    icon: Video,
    width: "full",
    height: 360,
    data: { src: "", poster: "", controls: true, loop: false, muted: true, autoplay: false },
  },
  {
    kind: "stats",
    label: "Stats",
    blurb: "Big numbers with a small label under each.",
    icon: BarChart3,
    width: "full",
    height: 160,
    data: { items: [{ value: "12,400", label: "Kilometres ridden" }], columns: "3" },
  },
  {
    kind: "quote",
    label: "Quote",
    blurb: "A pull quote with who said it.",
    icon: Quote,
    width: "two-thirds",
    height: 180,
    data: { text: "A line worth repeating.", author: "", role: "" },
  },
  {
    kind: "embed",
    label: "Embed",
    blurb: "Drop in a map, video or any page by URL.",
    icon: Code2,
    width: "full",
    height: 380,
    data: { url: "", title: "Embedded content" },
  },
  {
    kind: "divider",
    label: "Divider",
    blurb: "A line, dots or plain space between blocks.",
    icon: Minus,
    width: "full",
    height: 72,
    data: { style: "line", label: "" },
  },
];

export const blockSpec = (kind: BlockKind): BlockSpec =>
  BLOCK_LIBRARY.find((b) => b.kind === kind) ?? BLOCK_LIBRARY[0];

/** A fresh block of the given kind, carrying the library's starting values. */
export function createBlock(kind: BlockKind): SectionBlock {
  const spec = blockSpec(kind);
  return {
    id: uid(),
    kind,
    width: spec.width,
    height: spec.height,
    data: structuredClone(spec.data) as Record<string, unknown>,
  };
}

/** Read a string out of a block's data without tripping over odd types. */
export function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Images are stored as { src, alt } so every gallery slot has its own alt text. */
export interface BlockImage {
  src: string;
  alt?: string;
}

export function images(value: unknown): BlockImage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object")
    .map((v) => ({ src: str(v.src), alt: str(v.alt) }))
    .filter((img) => img.src.length > 0);
}

export interface BlockItem {
  [key: string]: string;
}

export function items(value: unknown): BlockItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object")
    .map((v) => {
      const out: BlockItem = {};
      for (const [k, val] of Object.entries(v)) out[k] = str(val);
      return out;
    });
}
