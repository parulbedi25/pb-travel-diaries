import type { BlockKind } from "./types";

/**
 * Field descriptors for the block editor.
 *
 * Deliberately its own small type rather than the dashboard's `Field`: the
 * block editor also runs inside the live site when an admin is previewing,
 * and importing AdminPage there would drag the whole dashboard into the
 * public bundle.
 */
export type BlockField =
  | { kind: "text"; path: string; label: string; hint?: string; placeholder?: string }
  | { kind: "textarea"; path: string; label: string; hint?: string; rows?: number; placeholder?: string }
  | {
      kind: "number";
      path: string;
      label: string;
      hint?: string;
      min?: number;
      max?: number;
      step?: number;
    }
  | {
      kind: "select";
      path: string;
      label: string;
      hint?: string;
      options: { value: string; label: string }[];
    }
  | { kind: "toggle"; path: string; label: string; hint?: string }
  | { kind: "image"; path: string; label: string; hint?: string }
  | {
      kind: "items";
      path: string;
      label: string;
      hint?: string;
      /** What one entry is called, e.g. "Tile". */
      itemLabel: string;
      /** Keys a newly added entry starts with. */
      template: Record<string, string>;
      /** Fields edited on each entry; paths are relative to the entry. */
      fields: BlockField[];
    };

const ALIGN = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centred" },
  { value: "right", label: "Right" },
];

const COLS_2_3_4 = [
  { value: "2", label: "2 across" },
  { value: "3", label: "3 across" },
  { value: "4", label: "4 across" },
];

export const BLOCK_FIELDS: Record<BlockKind, BlockField[]> = {
  heading: [
    { kind: "text", path: "eyebrow", label: "Eyebrow", placeholder: "Optional small label" },
    { kind: "text", path: "text", label: "Heading" },
    {
      kind: "select",
      path: "level",
      label: "Size",
      options: [
        { value: "h2", label: "Large" },
        { value: "h3", label: "Medium" },
        { value: "h4", label: "Small" },
      ],
    },
    { kind: "select", path: "align", label: "Align", options: ALIGN },
  ],
  text: [
    { kind: "textarea", path: "body", label: "Copy", rows: 6 },
    {
      kind: "select",
      path: "columns",
      label: "Columns",
      options: [
        { value: "1", label: "One" },
        { value: "2", label: "Two" },
      ],
    },
    {
      kind: "select",
      path: "size",
      label: "Text size",
      options: [
        { value: "sm", label: "Small" },
        { value: "base", label: "Regular" },
        { value: "lg", label: "Large" },
      ],
    },
    { kind: "select", path: "align", label: "Align", options: ALIGN },
  ],
  image: [
    { kind: "image", path: "src", label: "Photo", hint: "Pick from the media folder or paste a path." },
    { kind: "text", path: "alt", label: "Alt text" },
    {
      kind: "select",
      path: "fit",
      label: "Fit",
      options: [
        { value: "cover", label: "Fill the frame (crop)" },
        { value: "contain", label: "Fit inside the frame" },
      ],
    },
    {
      kind: "select",
      path: "rounded",
      label: "Corners",
      options: [
        { value: "none", label: "Square" },
        { value: "1rem", label: "Soft" },
        { value: "2rem", label: "Rounded" },
      ],
    },
    { kind: "text", path: "caption", label: "Caption", placeholder: "Optional" },
  ],
  imageScroller: [
    {
      kind: "items",
      path: "images",
      label: "Photos",
      hint: "Drag order is the order they scroll in.",
      itemLabel: "Photo",
      template: { src: "", alt: "" },
      fields: [
        { kind: "image", path: "src", label: "Photo" },
        { kind: "text", path: "alt", label: "Alt text" },
      ],
    },
    {
      kind: "select",
      path: "peek",
      label: "Card size",
      options: [
        { value: "sm", label: "Small" },
        { value: "md", label: "Medium" },
        { value: "lg", label: "Large" },
      ],
    },
    { kind: "toggle", path: "loop", label: "Loop back to the start" },
  ],
  gallery: [
    {
      kind: "items",
      path: "images",
      label: "Photos",
      itemLabel: "Photo",
      template: { src: "", alt: "" },
      fields: [
        { kind: "image", path: "src", label: "Photo" },
        { kind: "text", path: "alt", label: "Alt text" },
      ],
    },
    { kind: "select", path: "columns", label: "Columns", options: COLS_2_3_4 },
  ],
  list: [
    {
      kind: "items",
      path: "items",
      label: "Points",
      itemLabel: "Point",
      template: { title: "New point", text: "" },
      fields: [
        { kind: "text", path: "title", label: "Title" },
        { kind: "textarea", path: "text", label: "Note", rows: 2, placeholder: "Optional" },
      ],
    },
    {
      kind: "select",
      path: "style",
      label: "Marker",
      options: [
        { value: "check", label: "Ticks" },
        { value: "dot", label: "Dots" },
        { value: "number", label: "Numbers" },
      ],
    },
    {
      kind: "select",
      path: "columns",
      label: "Columns",
      options: [
        { value: "1", label: "One" },
        { value: "2", label: "Two" },
      ],
    },
  ],
  tiles: [
    {
      kind: "items",
      path: "items",
      label: "Tiles",
      itemLabel: "Tile",
      template: { title: "New tile", text: "", href: "", badge: "" },
      fields: [
        { kind: "text", path: "title", label: "Title" },
        { kind: "textarea", path: "text", label: "Text", rows: 2 },
        { kind: "text", path: "href", label: "Link", placeholder: "#top or https://…" },
        { kind: "text", path: "badge", label: "Badge", placeholder: "Optional, e.g. Popular" },
      ],
    },
    { kind: "select", path: "columns", label: "Columns", options: COLS_2_3_4 },
  ],
  buttons: [
    {
      kind: "items",
      path: "items",
      label: "Buttons",
      itemLabel: "Button",
      template: { label: "New button", href: "#top", variant: "primary" },
      fields: [
        { kind: "text", path: "label", label: "Label" },
        { kind: "text", path: "href", label: "Link", placeholder: "#top or https://…" },
        {
          kind: "select",
          path: "variant",
          label: "Style",
          options: [
            { value: "primary", label: "Solid gold" },
            { value: "outline", label: "Outlined" },
            { value: "ghost", label: "Plain" },
          ],
        },
      ],
    },
    { kind: "select", path: "align", label: "Align", options: ALIGN },
  ],
  video: [
    { kind: "image", path: "src", label: "Video file", hint: "Pick a local video from the media folder." },
    { kind: "image", path: "poster", label: "Poster image", hint: "Shown before play. Optional." },
    { kind: "toggle", path: "controls", label: "Show player controls" },
    { kind: "toggle", path: "muted", label: "Start muted" },
    { kind: "toggle", path: "loop", label: "Loop" },
    { kind: "toggle", path: "autoplay", label: "Play automatically" },
  ],
  stats: [
    {
      kind: "items",
      path: "items",
      label: "Stats",
      itemLabel: "Stat",
      template: { value: "0", label: "Label" },
      fields: [
        { kind: "text", path: "value", label: "Value" },
        { kind: "text", path: "label", label: "Label" },
      ],
    },
    { kind: "select", path: "columns", label: "Columns", options: COLS_2_3_4 },
  ],
  quote: [
    { kind: "textarea", path: "text", label: "Quote", rows: 4 },
    { kind: "text", path: "author", label: "Who said it", placeholder: "Optional" },
    { kind: "text", path: "role", label: "Their role", placeholder: "Optional" },
  ],
  embed: [
    { kind: "text", path: "url", label: "Page URL", placeholder: "https://…" },
    { kind: "text", path: "title", label: "Title", hint: "Read by screen readers." },
  ],
  divider: [
    {
      kind: "select",
      path: "style",
      label: "Style",
      options: [
        { value: "line", label: "Line" },
        { value: "dots", label: "Dots" },
        { value: "space", label: "Plain space" },
      ],
    },
    { kind: "text", path: "label", label: "Label", placeholder: "Optional, sits on the line" },
  ],
};
