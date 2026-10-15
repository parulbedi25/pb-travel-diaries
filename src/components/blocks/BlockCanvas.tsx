import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "../../utils/cn";
import {
  MAX_BLOCK_H,
  MIN_BLOCK_H,
  blockSpec,
  createBlock,
  snapWidth,
  widthSpec,
  type BlockKind,
  type BlockWidth,
  type SectionBlock,
} from "../../blocks/types";
import BlockView from "./BlockView";
import BlockPalette from "../../admin/BlockPalette";
import BlockEditor from "../../admin/BlockEditor";

const clampH = (n: number) => Math.max(MIN_BLOCK_H, Math.min(MAX_BLOCK_H, Math.round(n)));

/** One small button in a block's toolbar. */
function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-6 w-6 place-items-center rounded-full transition-colors",
        danger ? "hover:bg-red-500/15 hover:text-red-600" : "hover:bg-black/10",
        "disabled:pointer-events-none disabled:opacity-25"
      )}
    >
      {children}
    </button>
  );
}

/**
 * The body of a composed section: blocks laid out in a 12-column grid, each
 * taking the width its admin gave it and stacking to full width on phones.
 *
 * `editable` turns on the builder: pick components from the left drawer, drag
 * a block's edges to resize it, reorder or delete it, and edit its content.
 * Visitors get the plain blocks with no chrome and no empty placeholders.
 */
export default function BlockCanvas({
  blocks,
  onChange,
  onCommit,
  editable,
  sectionLabel,
}: {
  blocks: SectionBlock[];
  onChange: (next: SectionBlock[]) => void;
  onCommit: () => void;
  editable: boolean;
  sectionLabel?: string;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ id: string; height: number; width: BlockWidth } | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    axis: "h" | "w";
    startX: number;
    startY: number;
    startH: number;
    left: number;
    rowW: number;
  } | null>(null);
  const liveRef = useRef<{ id: string; height: number; width: BlockWidth } | null>(null);

  // Window listeners are registered once per drag, so they read the freshest
  // blocks and callbacks through a ref instead of closing over stale ones.
  const latest = useRef({ blocks, onChange, onCommit });
  latest.current = { blocks, onChange, onCommit };

  const startDrag = (e: ReactPointerEvent, block: SectionBlock, axis: "h" | "w") => {
    e.preventDefault();
    e.stopPropagation();
    const cell = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-block-id]");
    dragRef.current = {
      id: block.id,
      axis,
      startX: e.clientX,
      startY: e.clientY,
      startH: block.height,
      left: cell?.getBoundingClientRect().left ?? 0,
      rowW: gridRef.current?.getBoundingClientRect().width ?? 0,
    };
    liveRef.current = { id: block.id, height: block.height, width: block.width };
    setPreview({ id: block.id, height: block.height, width: block.width });
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.axis === "h") {
        const next = {
          id: d.id,
          height: clampH(d.startH + (e.clientY - d.startY)),
          width: liveRef.current?.width ?? "full",
        };
        liveRef.current = next;
        setPreview(next);
      } else {
        const px = Math.max(80, e.clientX - d.left);
        const next = {
          id: d.id,
          height: liveRef.current?.height ?? d.startH,
          width: snapWidth(px, d.rowW),
        };
        liveRef.current = next;
        setPreview(next);
      }
    };
    const up = () => {
      const p = liveRef.current;
      dragRef.current = null;
      liveRef.current = null;
      setPreview(null);
      setDragging(false);
      if (!p) return;
      const { blocks: current, onChange: apply, onCommit: save } = latest.current;
      const before = current.find((b) => b.id === p.id);
      if (before && before.height === p.height && before.width === p.width) return;
      apply(current.map((b) => (b.id === p.id ? { ...b, height: p.height, width: p.width } : b)));
      save();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging]);

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
    onCommit();
  };

  const addBlock = (kind: BlockKind) => {
    const block = createBlock(kind);
    onChange([...blocks, block]);
    onCommit();
    setPaletteOpen(false);
    setEditingId(block.id);
  };

  const editing = blocks.find((b) => b.id === editingId) ?? null;

  return (
    <div className="relative">
      {blocks.length > 0 && (
        <div ref={gridRef} className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {blocks.map((block, i) => {
            const p = preview && preview.id === block.id ? preview : null;
            const width = p?.width ?? block.width;
            const height = p?.height ?? block.height;
            const spec = blockSpec(block.kind);
            return (
              <div
                key={block.id}
                data-block-id={block.id}
                className={cn("relative flex", widthSpec(width).className)}
                style={{ minHeight: height }}
              >
                <div className="min-w-0 w-full flex-1">
                  <BlockView block={block} admin={editable} />
                </div>

                {editable && (
                  <>
                    <div
                      className="section-chrome pointer-events-none absolute inset-0 rounded-2xl border border-dashed border-saffron-400/40"
                      aria-hidden="true"
                    />

                    <span className="section-chrome section-chrome-plate pointer-events-none absolute left-2 top-2 z-[60] inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px]">
                      {spec.label} · {height}px · {widthSpec(width).short}
                    </span>

                    <div className="section-chrome section-chrome-plate absolute right-2 top-2 z-[60] flex items-center gap-0.5 rounded-full px-1 py-0.5">
                      <IconButton label={`Edit ${spec.label}`} onClick={() => setEditingId(block.id)}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={`Move ${spec.label} earlier`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={`Move ${spec.label} later`}
                        disabled={i === blocks.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={`Remove ${spec.label}`}
                        danger
                        onClick={() => {
                          onChange(blocks.filter((b) => b.id !== block.id));
                          onCommit();
                          if (editingId === block.id) setEditingId(null);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </IconButton>
                    </div>

                    <button
                      type="button"
                      aria-label={`Resize ${spec.label} height`}
                      onPointerDown={(e) => startDrag(e, block, "h")}
                      className="section-chrome absolute bottom-0 left-1/2 z-[62] h-2.5 w-24 -translate-x-1/2 cursor-ns-resize touch-none rounded-t-full bg-saffron-400 opacity-80 hover:opacity-100"
                    />
                    <button
                      type="button"
                      aria-label={`Resize ${spec.label} width`}
                      onPointerDown={(e) => startDrag(e, block, "w")}
                      className="section-chrome absolute right-0 top-1/2 z-[62] h-20 w-2.5 -translate-y-1/2 cursor-ew-resize touch-none rounded-l-full bg-saffron-400 opacity-80 hover:opacity-100"
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editable && (
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className={cn(
            "mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 py-4",
            "text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400 transition-colors",
            "hover:border-saffron-300/40 hover:text-white"
          )}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {blocks.length === 0 ? "Add your first component" : "Add a component"}
        </button>
      )}

      {editable && (
        <BlockPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onPick={addBlock}
          sectionLabel={sectionLabel}
        />
      )}

      {editable && editing && (
        <BlockEditor
          block={editing}
          sectionLabel={sectionLabel}
          onChange={(next) => onChange(blocks.map((b) => (b.id === next.id ? next : b)))}
          onCommit={onCommit}
          onDelete={() => {
            onChange(blocks.filter((b) => b.id !== editing.id));
            onCommit();
            setEditingId(null);
          }}
          onClose={() => {
            onCommit();
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}
