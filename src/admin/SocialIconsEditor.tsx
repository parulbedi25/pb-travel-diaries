import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { FooterSocial } from "../store/siteContent";
import { SOCIAL_ICONS, resolveSocialIcon } from "../components/ui/SocialIcons";
import Switch from "./Switch";
import { cn } from "../utils/cn";

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-saffron-400/60 focus:outline-none transition-colors";

const BUBBLE_W = 288; // matches w-72 below
const BUBBLE_MAX_H = 320;

interface BubblePos {
  top: number;
  left: number;
  caret: number;
}

/**
 * The footer's social icons, as a reorderable list.
 *
 * Drag a row by the grip on its left to change the order the icons appear in
 * on the site. Hovering an icon reveals a pencil over its middle; clicking
 * opens a bubble of choices.
 */
export default function SocialIconsEditor({
  socials,
  onPatch,
  onChange,
}: {
  socials: FooterSocial[];
  onPatch: (id: string, patch: Partial<FooterSocial>) => void;
  onChange: (next: FooterSocial[], action: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [bubble, setBubble] = useState<BubblePos | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  // The row as it was before it was edited in this session, so Reset can put
  // back the icon, colour and name. Taken once per row: re-opening the bubble
  // after a change must not move the goalposts, or "reset" would only ever
  // undo the last visit.
  const snapshots = useRef(new Map<string, FooterSocial>());
  // Only a drag that began on the grip reorders the list, so selecting text in
  // the URL field still behaves normally.
  const armed = useRef<string | null>(null);

  /**
   * The bubble is rendered into the body rather than inside the row: the
   * dashboard's editor column scrolls and clips, and the cards below it were
   * painting over the bubble. Fixed positioning also keeps it in the viewport
   * when the panel is scrolled.
   */
  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.bottom + 10;
    const flip = below + BUBBLE_MAX_H > window.innerHeight && r.top - 10 - BUBBLE_MAX_H > 0;
    const top = flip ? r.top - 10 - BUBBLE_MAX_H : below;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - BUBBLE_W - 8));
    setBubble({ top, left, caret: Math.max(12, r.left + r.width / 2 - left) });
  }, []);

  const closePicker = useCallback(() => {
    setPickerFor(null);
    setBubble(null);
    anchorRef.current = null;
  }, []);

  const togglePicker = (id: string, el: HTMLElement) => {
    if (pickerFor === id) {
      closePicker();
      return;
    }
    anchorRef.current = el;
    const opening = socials.find((s) => s.id === id);
    if (opening && !snapshots.current.has(id)) snapshots.current.set(id, { ...opening });
    setPickerFor(id);
    place();
  };

  useEffect(() => {
    if (!pickerFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePicker();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-icon-bubble]") || target?.closest("[data-icon-anchor]")) return;
      closePicker();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    // Capture, so scrolling the dashboard column moves the bubble with the row
    // instead of leaving it stranded.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [pickerFor, place, closePicker]);

  const resetDrag = () => {
    armed.current = null;
    setDragId(null);
    setOverId(null);
  };

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= socials.length) return;
    const next = [...socials];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next, "Reordered social icons");
  };

  const resetEntry = () => {
    if (!pickerFor) return;
    const social = socials.find((s) => s.id === pickerFor);
    if (!social) return;
    const base = snapshots.current.get(social.id);
    const fallback = SOCIAL_ICONS[0];
    onPatch(social.id, {
      icon: base?.icon ?? fallback.key,
      label: base?.label ?? fallback.label,
      // Clear any custom colour either way: a reset icon is a plain one.
      color: undefined,
    });
  };

  const pickIcon = (social: FooterSocial, key: string) => {
    const spec = SOCIAL_ICONS.find((s) => s.key === key);
    if (!spec) return;
    // Choosing an icon fills in its name, so a new row is never left with a
    // blank or a name that belongs to the previous choice. The bubble stays
    // open: the name lands in the field above and can be typed over right
    // away, or another icon picked straight after.
    onPatch(social.id, { icon: key, label: spec.label });
  };

  const add = () => {
    const spec = SOCIAL_ICONS[0];
    onChange(
      [
        ...socials,
        {
          id: `s-${Math.random().toString(36).slice(2, 9)}`,
          label: spec.label,
          icon: spec.key,
          href: "#top",
          enabled: true,
        },
      ],
      "Added a social icon"
    );
  };

  const active = socials.find((s) => s.id === pickerFor) ?? null;

  return (
    <div>
      <ul className="mt-4 flex flex-col gap-2.5">
        {socials.map((s, i) => {
          const Icon = resolveSocialIcon(s);
          const isDragging = dragId === s.id;
          const isTarget = overId === s.id && dragId !== null && dragId !== s.id;
          return (
            <li
              key={s.id}
              draggable
              onDragStart={(e) => {
                if (armed.current !== s.id) {
                  e.preventDefault();
                  return;
                }
                setDragId(s.id);
                e.dataTransfer.effectAllowed = "move";
                try {
                  e.dataTransfer.setData("text/plain", s.id);
                } catch {
                  // Some browsers restrict this during a custom drag; the
                  // reorder is tracked in state anyway.
                }
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overId !== s.id) setOverId(s.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) {
                  const from = socials.findIndex((x) => x.id === dragId);
                  if (from !== -1) move(from, i);
                }
                resetDrag();
              }}
              onDragEnd={resetDrag}
              className={cn(
                "relative flex flex-wrap items-center gap-3 rounded-xl border bg-white/[0.02] p-3 transition-colors",
                isDragging ? "border-saffron-400/50 opacity-60" : "border-white/[0.07]",
                isTarget && "border-saffron-400 bg-saffron-400/[0.06]"
              )}
            >
              <span
                role="button"
                tabIndex={0}
                aria-label={`Reorder ${s.label || "icon"} — drag, or use the arrow keys`}
                title="Drag to reorder"
                onPointerDown={() => {
                  armed.current = s.id;
                }}
                onPointerUp={() => {
                  armed.current = null;
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    move(i, i - 1);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    move(i, i + 1);
                  }
                }}
                className="grid h-8 w-6 shrink-0 cursor-grab place-items-center rounded-md text-zinc-500 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron-400 active:cursor-grabbing"
              >
                <GripVertical className="h-4 w-4" aria-hidden="true" />
              </span>

              <button
                type="button"
                data-icon-anchor
                onClick={(e) => togglePicker(s.id, e.currentTarget)}
                aria-label={`Change the ${s.label || "social"} icon`}
                aria-expanded={pickerFor === s.id}
                title="Change icon"
                className="group relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-white transition-colors hover:border-saffron-300/50 focus:outline-none focus-visible:border-saffron-400 focus-visible:ring-2 focus-visible:ring-saffron-400/60"
              >
                {Icon ? (
                  <Icon className="h-5 w-5" />
                ) : (
                  <span className="text-xs font-semibold">{(s.label || "?").trim().charAt(0)}</span>
                )}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-0 grid place-items-center rounded-xl bg-ink-950/60 opacity-0 transition-opacity duration-200",
                    "group-hover:opacity-100 group-focus-visible:opacity-100",
                    pickerFor === s.id && "opacity-100"
                  )}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </span>
              </button>

              <input
                value={s.href}
                onChange={(e) => onPatch(s.id, { href: e.target.value })}
                aria-label={`${s.label || "Social"} profile URL`}
                placeholder="https://…"
                className={cn(inputCls, "min-w-0 flex-1 py-2 font-mono text-xs")}
              />
              <Switch
                on={s.enabled}
                onChange={(v) => onPatch(s.id, { enabled: v })}
                label={`Show ${s.label || "this"} icon site-wide`}
              />
              <button
                type="button"
                aria-label={`Remove ${s.label || "this icon"}`}
                onClick={() =>
                  onChange(
                    socials.filter((x) => x.id !== s.id),
                    `Removed social icon: ${s.label || "icon"}`
                  )
                }
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-red-500/15 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          );
        })}

        {socials.length === 0 && (
          <li className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-zinc-600">
            No icons yet. Add one to show it in the footer.
          </li>
        )}
      </ul>

      <button
        type="button"
        onClick={add}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 py-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400 transition-colors hover:border-saffron-300/40 hover:text-white"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Add icon
      </button>

      {active &&
        bubble &&
        createPortal(
          <div
            data-icon-bubble
            role="dialog"
            aria-label="Choose an icon"
            style={{ top: bubble.top, left: bubble.left, width: BUBBLE_W }}
            className="fixed z-[200] rounded-2xl border border-white/10 bg-ink-950/95 p-3 shadow-2xl shadow-black/70 backdrop-blur-xl"
          >
            <span
              aria-hidden="true"
              style={{ left: bubble.caret - 6 }}
              className="absolute -top-1.5 h-3 w-3 rotate-45 border-l border-t border-white/10 bg-ink-950"
            />
            <div className="mb-2 flex items-center gap-2">
              <input
                value={active.label}
                onChange={(e) => onPatch(active.id, { label: e.target.value })}
                aria-label="Icon name"
                placeholder="Name"
                className={cn(inputCls, "min-w-0 flex-1 py-1.5 text-xs")}
              />
              <input
                type="color"
                value={active.color || "#f5b301"}
                onChange={(e) => onPatch(active.id, { color: e.target.value })}
                aria-label={`Custom colour for ${active.label || "this icon"}`}
                title="Custom colour"
                className="h-7 w-9 shrink-0 cursor-pointer rounded-lg border border-white/15 bg-white/[0.05] p-0.5"
              />
              <button
                type="button"
                onClick={resetEntry}
                aria-label="Reset icon, colour and name"
                title="Reset icon, colour and name"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/15 text-zinc-400 transition-colors hover:border-saffron-300/50 hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <div className="grid max-h-64 grid-cols-6 gap-1.5 overflow-y-auto pr-1">
              {SOCIAL_ICONS.map((spec) => {
                const PickIcon = spec.Icon;
                const isActive = spec.key === active.icon;
                return (
                  <button
                    key={spec.key}
                    type="button"
                    aria-label={spec.label}
                    aria-pressed={isActive}
                    title={spec.label}
                    onClick={() => pickIcon(active, spec.key)}
                    className={cn(
                      "grid h-9 w-9 place-items-center rounded-lg border transition-colors",
                      isActive
                        ? "border-saffron-400 bg-saffron-400/15 text-saffron-300"
                        : "border-white/10 text-zinc-300 hover:border-white/25 hover:text-white"
                    )}
                  >
                    <PickIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

