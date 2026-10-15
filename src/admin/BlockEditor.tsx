import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { BLOCK_FIELDS, type BlockField } from "../blocks/fields";
import { MAX_BLOCK_H, MIN_BLOCK_H, WIDTHS, blockSpec, type SectionBlock } from "../blocks/types";
import { cn } from "../utils/cn";
import ImageField from "./ImageField";

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-saffron-400/60 focus:outline-none transition-colors";

const labelCls = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500";

/**
 * One field of a block. Handles every kind in `BlockField`, including the
 * nested repeaters used for lists, tiles, galleries and buttons.
 */
function FieldControl({
  field,
  value,
  onChange,
  onCommit,
}: {
  field: BlockField;
  value: unknown;
  onChange: (v: unknown) => void;
  onCommit: () => void;
}) {
  switch (field.kind) {
    case "text":
      return (
        <input
          type="text"
          className={inputCls}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "textarea":
      return (
        <textarea
          rows={field.rows ?? 3}
          className={cn(inputCls, "resize-y leading-relaxed")}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <input
          type="number"
          className={inputCls}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          value={typeof value === "number" ? value : Number(value ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      );
    case "select":
      return (
        <select className={inputCls} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "toggle":
      return (
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-zinc-300">
          <input
            type="checkbox"
            className="h-4 w-4 accent-saffron-400"
            checked={value === true}
            onChange={(e) => {
              onChange(e.target.checked);
              onCommit();
            }}
          />
          {field.label}
        </label>
      );
    case "image":
      return <ImageField value={typeof value === "string" ? value : ""} onChange={onChange} hint={field.hint} />;
    case "items":
      return <ItemsEditor field={field} value={value} onChange={onChange} onCommit={onCommit} />;
    default:
      return null;
  }
}

/** A repeater: gallery photos, list points, tiles, buttons, stats. */
function ItemsEditor({
  field,
  value,
  onChange,
  onCommit,
}: {
  field: Extract<BlockField, { kind: "items" }>;
  value: unknown;
  onChange: (v: unknown) => void;
  onCommit: () => void;
}) {
  const rows = (Array.isArray(value) ? value : []) as Record<string, unknown>[];
  const set = (next: Record<string, unknown>[]) => {
    onChange(next);
    onCommit();
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {field.itemLabel} {i + 1}
            </span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`Move ${field.itemLabel} ${i + 1} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
                className="grid h-6 w-6 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-25"
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Move ${field.itemLabel} ${i + 1} down`}
                disabled={i === rows.length - 1}
                onClick={() => move(i, 1)}
                className="grid h-6 w-6 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-25"
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${field.itemLabel} ${i + 1}`}
                onClick={() => set(rows.filter((_, idx) => idx !== i))}
                className="grid h-6 w-6 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-red-500/15 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          </div>
          <div className="space-y-3">
            {field.fields.map((sub) => (
              <div key={sub.path}>
                {sub.kind !== "toggle" && <label className={labelCls}>{sub.label}</label>}
                <FieldControl
                  field={sub}
                  value={row[sub.path]}
                  onChange={(v) => set(rows.map((r, idx) => (idx === i ? { ...r, [sub.path]: v } : r)))}
                  onCommit={onCommit}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => set([...rows, { ...field.template }])}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 py-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400 transition-colors hover:border-saffron-300/40 hover:text-white"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Add {field.itemLabel.toLowerCase()}
      </button>
    </div>
  );
}

/**
 * Slide-in panel for editing one block: its content, then its size.
 *
 * Used both on the live site while previewing as admin and inside the
 * dashboard, so a block edited in either place looks and behaves the same.
 */
export default function BlockEditor({
  block,
  sectionLabel,
  onChange,
  onCommit,
  onDelete,
  onClose,
}: {
  block: SectionBlock;
  sectionLabel?: string;
  onChange: (next: SectionBlock) => void;
  onCommit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const spec = blockSpec(block.kind);
  const fields = BLOCK_FIELDS[block.kind] ?? [];
  const setData = (path: string, value: unknown) =>
    onChange({ ...block, data: { ...block.data, [path]: value } });

  return (
    <aside
      aria-label={`Edit ${spec.label}`}
      className="fixed right-0 top-0 z-[88] flex h-full w-[22rem] max-w-[92vw] flex-col border-l border-white/10 bg-ink-950/95 shadow-2xl shadow-black/60 backdrop-blur-xl"
    >
      <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div>
          <h2 className="font-display text-base font-semibold text-white">{spec.label}</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {sectionLabel ? `In “${sectionLabel}”` : "Block settings"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            onCommit();
            onClose();
          }}
          aria-label="Close editor"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-zinc-400 transition-colors hover:border-white/25 hover:text-white"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {fields.map((field) => (
          <div key={field.path}>
            {field.kind !== "toggle" && field.kind !== "items" && <label className={labelCls}>{field.label}</label>}
            {field.kind === "items" && <label className={labelCls}>{field.label}</label>}
            <FieldControl
              field={field}
              value={block.data[field.path]}
              onChange={(v) => setData(field.path, v)}
              onCommit={onCommit}
            />
            {field.hint && field.kind !== "image" && (
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{field.hint}</p>
            )}
          </div>
        ))}

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <span className={labelCls}>Size</span>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] text-zinc-500">Width</label>
              <select
                className={inputCls}
                value={block.width}
                onChange={(e) => {
                  onChange({ ...block, width: e.target.value as SectionBlock["width"] });
                  onCommit();
                }}
              >
                {WIDTHS.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-zinc-500">Height (px)</label>
              <input
                type="number"
                className={inputCls}
                min={MIN_BLOCK_H}
                max={MAX_BLOCK_H}
                value={block.height}
                onChange={(e) =>
                  onChange({
                    ...block,
                    height: Math.max(MIN_BLOCK_H, Math.min(MAX_BLOCK_H, Number(e.target.value) || MIN_BLOCK_H)),
                  })
                }
                onBlur={onCommit}
              />
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            Or drag the block's bottom edge for height and its right edge for width, right on the page.
          </p>
        </div>
      </div>

      <footer className="border-t border-white/10 px-5 py-3">
        <button
          type="button"
          onClick={onDelete}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-red-300 transition-colors hover:bg-red-500/20"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Remove this block
        </button>
      </footer>
    </aside>
  );
}
