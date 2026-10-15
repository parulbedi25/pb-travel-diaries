import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { blockSpec, createBlock, widthSpec, type BlockKind, type SectionBlock } from "../blocks/types";
import { cn } from "../utils/cn";
import BlockPalette from "./BlockPalette";
import BlockEditor from "./BlockEditor";

/**
 * The dashboard's view of a composed section: a compact list of the blocks
 * inside it rather than a live-scale canvas, which would be cramped inside a
 * side panel. It shares the palette and the editor with the live page, so a
 * block behaves the same whichever side you build it from.
 */
export default function BlockComposer({
  blocks,
  onChange,
  sectionLabel,
}: {
  blocks: SectionBlock[];
  onChange: (next: SectionBlock[]) => void;
  sectionLabel?: string;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = blocks.find((b) => b.id === editingId) ?? null;

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
  };

  const add = (kind: BlockKind) => {
    const block = createBlock(kind);
    onChange([...blocks, block]);
    setPaletteOpen(false);
    setEditingId(block.id);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Components</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            Add, reorder and resize what's inside this section.
          </p>
        </div>
        <span className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] text-zinc-400">
          {blocks.length}
        </span>
      </div>

      <div className="space-y-2">
        {blocks.map((block, i) => {
          const spec = blockSpec(block.kind);
          const Icon = spec.icon;
          return (
            <div
              key={block.id}
              className={cn(
                "flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5",
                editingId === block.id && "border-saffron-300/50 bg-saffron-400/[0.07]"
              )}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-saffron-400/15 text-saffron-300">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-white">{spec.label}</span>
                <span className="font-mono text-[10px] text-zinc-500">
                  {widthSpec(block.width).short} · {block.height}px
                </span>
              </span>
              <span className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label={`Edit ${spec.label}`}
                  onClick={() => setEditingId(block.id)}
                  className="grid h-7 w-7 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${spec.label} earlier`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="grid h-7 w-7 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-25"
                >
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${spec.label} later`}
                  disabled={i === blocks.length - 1}
                  onClick={() => move(i, 1)}
                  className="grid h-7 w-7 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-25"
                >
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${spec.label}`}
                  onClick={() => {
                    onChange(blocks.filter((b) => b.id !== block.id));
                    if (editingId === block.id) setEditingId(null);
                  }}
                  className="grid h-7 w-7 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-red-500/15 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className={cn(
          "mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 py-2.5",
          "text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400 transition-colors",
          "hover:border-saffron-300/40 hover:text-white"
        )}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        {blocks.length === 0 ? "Add your first component" : "Add a component"}
      </button>

      <BlockPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onPick={add}
        sectionLabel={sectionLabel}
      />

      {editing && (
        <BlockEditor
          block={editing}
          sectionLabel={sectionLabel}
          onChange={(next) => onChange(blocks.map((b) => (b.id === next.id ? next : b)))}
          onCommit={() => undefined}
          onDelete={() => {
            onChange(blocks.filter((b) => b.id !== editing.id));
            setEditingId(null);
          }}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
