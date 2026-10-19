import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  EyeOff,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import {
  canEditSite,
  useSite,
  type SectionEntry,
} from "../store/siteContent";
import { cn } from "../utils/cn";
import InlineSectionEditor from "../admin/InlineSectionEditor";

const MIN_H = 180;
/** How much one press of the length arrows adds or removes. */
const HEIGHT_STEP = 40;
const clamp = (n: number) => Math.max(0, Math.round(n));

type Edge = "top" | "right" | "bottom" | "left";

/** One icon button inside the section toolbar. */
function ToolButton({
  onClick,
  label,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  label: string;
  title: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      className="pointer-events-auto grid h-7 w-7 place-items-center rounded-full opacity-80 transition-colors hover:bg-black/15 hover:opacity-100 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/**
 * Wraps every section so it can be resized and customised from the live site.
 * Admins get a toolbar plus four handles: top/bottom adjust spacing and height,
 * left/right adjust the section's horizontal inset. Visitors just see the
 * saved geometry.
 */
export default function SectionFrame({
  entry,
  children,
}: {
  entry: SectionEntry;
  children: ReactNode;
}) {
  const { setSectionLayout, moveSection, setSectionEnabled, previewAsVisitor, account } = useSite();
  const admin = canEditSite(account) && !previewAsVisitor;
  const [editing, setEditing] = useState(false);
  const [dragEdge, setDragEdge] = useState<Edge | null>(null);
  const drag = useRef<{
    edge: Edge;
    pointerId: number;
    startX: number;
    startY: number;
    base: Record<string, number>;
  } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const paint = useRef<number | null>(null);
  const pending = useRef<Record<string, number> | null>(null);

  const layout = entry.layout ?? {};
  const applyLayout = (next: Record<string, number>) => {
    if (paint.current !== null) return;
    paint.current = requestAnimationFrame(() => {
      const el = frameRef.current;
      if (el) {
        el.style.height = next.height ? `${next.height}px` : "";
        el.style.marginTop = next.marginTop ? `${next.marginTop}px` : "";
        el.style.marginBottom = next.marginBottom ? `${next.marginBottom}px` : "";
        el.style.marginLeft = next.marginLeft ? `${next.marginLeft}px` : "";
        el.style.marginRight = next.marginRight ? `${next.marginRight}px` : "";
      }
      paint.current = null;
    });
    pending.current = next;
  };

  const startDrag = (e: PointerEvent<HTMLButtonElement>, edge: Edge) => {
    if (drag.current) return;
    e.preventDefault();
    const rect = frameRef.current?.getBoundingClientRect();
    const base = {
      height: rect?.height ?? 0,
      marginTop: layout.marginTop ?? 0,
      marginBottom: layout.marginBottom ?? 0,
      marginLeft: layout.marginLeft ?? 0,
      marginRight: layout.marginRight ?? 0,
    };
    drag.current = {
      edge,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      base,
    };
    setDragEdge(edge);
    e.currentTarget.setPointerCapture(e.pointerId);
    applyLayout(base);
  };

  useEffect(() => {
    const onMove = (event: globalThis.PointerEvent) => {
      const d = drag.current;
      if (!d || event.pointerId !== d.pointerId) return;
      const dx = event.clientX - d.startX;
      const dy = event.clientY - d.startY;
      const next = { ...d.base };
      if (d.edge === "bottom") next.height = Math.max(MIN_H, d.base.height + dy);
      if (d.edge === "top") {
        const delta = Math.min(d.base.height - MIN_H, Math.max(-d.base.marginTop, dy));
        next.height = Math.max(MIN_H, d.base.height - delta);
        next.marginTop = Math.max(0, d.base.marginTop + delta);
      }
      if (d.edge === "left") next.marginLeft = clamp(d.base.marginLeft + dx);
      if (d.edge === "right") next.marginRight = clamp(d.base.marginRight - dx);
      applyLayout(next);
    };

    const finish = (cancelled: boolean) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      setDragEdge(null);
      const next = pending.current ?? d.base;
      if (!cancelled) {
        const changed = (Object.keys(next) as (keyof typeof next)[]).some(
          (key) => Math.round(next[key]) !== Math.round(d.base[key])
        );
        if (changed) {
          setSectionLayout(entry.id, entry.label, {
            height: next.height,
            marginTop: next.marginTop,
            marginBottom: next.marginBottom,
            marginLeft: next.marginLeft,
            marginRight: next.marginRight,
          });
          return;
        }
      }
      // Revert a cancelled or no-op drag to the saved geometry.
      applyLayout({
        height: layout.height ?? 0,
        marginTop: layout.marginTop ?? 0,
        marginBottom: layout.marginBottom ?? 0,
        marginLeft: layout.marginLeft ?? 0,
        marginRight: layout.marginRight ?? 0,
      });
    };

    const onUp = () => finish(false);
    const onCancel = () => finish(true);
    const onBlur = () => finish(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onBlur);
      if (paint.current !== null) cancelAnimationFrame(paint.current);
      paint.current = null;
    };
    // Intentionally empty: the listeners read live values through refs so they
    // never capture a stale layout snapshot or re-subscribe on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Grow or shrink the section by one step, measured from what is on screen. */
  const adjustHeight = (delta: number) => {
    const current = Math.round(
      frameRef.current?.getBoundingClientRect().height ?? layout.height ?? 0
    );
    const next = Math.max(MIN_H, current + delta);
    if (next === current) return;
    setSectionLayout(entry.id, entry.label, { height: next });
  };

  const frameStyle = {
    height: layout.height,
    marginTop: layout.marginTop,
    marginBottom: layout.marginBottom,
    marginLeft: layout.marginLeft,
    marginRight: layout.marginRight,
  };

  if (!admin) {
    return (
      <div style={frameStyle} className={layout.height ? "overflow-hidden" : undefined}>
        {children}
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={frameRef}
        style={frameStyle}
        className={cn("relative overflow-hidden", dragEdge && "z-30")}
      >
        {children}
      </div>

      {/* Pale pill with a gold rule and dark glyphs, so the controls read
          the same over a black section or a cream one. z-[70] keeps it above
          section content (some sections own z-30 controls in this corner) and
          above the fixed header, which used to swallow every click but Edit. */}
      <div className="section-chrome section-chrome-plate section-chrome-toolbar pointer-events-none absolute right-3 top-3 z-[70] flex items-center gap-0.5 rounded-full p-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="pointer-events-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition-colors hover:bg-black/15"
        >
          <Pencil className="h-3 w-3" /> Edit
        </button>
        <span className="mx-0.5 h-5 w-px bg-black/20" aria-hidden />
        <ToolButton
          onClick={() => moveSection(entry.id, entry.label, -1)}
          label="Move section up"
          title="Move this section up and save"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          onClick={() => moveSection(entry.id, entry.label, 1)}
          label="Move section down"
          title="Move this section down and save"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </ToolButton>
        <span className="mx-0.5 h-5 w-px bg-black/20" aria-hidden />
        <ToolButton
          onClick={() => adjustHeight(HEIGHT_STEP)}
          label="Make section longer"
          title={`Make this section ${HEIGHT_STEP}px longer and save`}
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          onClick={() => adjustHeight(-HEIGHT_STEP)}
          label="Make section shorter"
          title={`Make this section ${HEIGHT_STEP}px shorter and save`}
          disabled={typeof layout.height === "number" && layout.height <= MIN_H}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </ToolButton>
        <span className="mx-0.5 h-5 w-px bg-black/20" aria-hidden />
        <ToolButton
          onClick={() => setSectionEnabled(entry.id, entry.label, false)}
          label="Hide section"
          title="Hide this section from visitors and save"
        >
          <EyeOff className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          onClick={() => setSectionLayout(entry.id, entry.label, {})}
          label="Reset section size"
          title="Reset section size and save"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </ToolButton>
      </div>

      <div className="pointer-events-none absolute inset-0 border border-dashed border-saffron-400/40" aria-hidden />

      {(["top", "bottom", "left", "right"] as Edge[]).map((edge) => (
        <button
          key={edge}
          type="button"
          aria-label={`Resize ${entry.label} from the ${edge}`}
          onPointerDown={(e) => startDrag(e, edge)}
          className={cn(
            "section-chrome absolute z-40 touch-none bg-saffron-400 opacity-80 hover:opacity-100",
            edge === "top" && "left-1/2 top-0 h-3 w-40 -translate-x-1/2 cursor-ns-resize rounded-b-full",
            edge === "bottom" && "bottom-0 left-1/2 h-3 w-40 -translate-x-1/2 cursor-ns-resize rounded-t-full",
            edge === "left" && "left-0 top-1/2 h-28 w-3 -translate-y-1/2 cursor-ew-resize rounded-r-full",
            edge === "right" && "right-0 top-1/2 h-28 w-3 -translate-y-1/2 cursor-ew-resize rounded-l-full"
          )}
        />
      ))}

      <span className="section-chrome section-chrome-plate pointer-events-none absolute left-3 top-3 z-[70] inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px]">
        <SlidersHorizontal className="h-3 w-3" />
        <span className="font-mono">
          {layout.height ? `${layout.height}px` : "auto"}
          {(layout.marginLeft || layout.marginRight) &&
            ` · ${layout.marginLeft || 0}px / ${layout.marginRight || 0}px`}
        </span>
      </span>

      {editing && (
        <InlineSectionEditor entry={entry} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}
