import { useEffect, useRef, useState } from "react";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import type { FooterSocial } from "../store/siteContent";
import { SOCIAL_ICONS, resolveSocialIcon, socialIconLabel } from "../components/ui/SocialIcons";
import Switch from "./Switch";
import { cn } from "../utils/cn";

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-saffron-400/60 focus:outline-none transition-colors";

/**
 * The footer's social icons, as a reorderable list.
 *
 * Drag a row by the grip on its left to change the order the icons appear in
 * on the site. Each row shows the icon it will use, and the pencil under the
 * icon opens a bubble of choices.
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
  // Only a drag that began on the grip is allowed to reorder the list, so
  // selecting text in the URL field still behaves normally.
  const armed = useRef<string | null>(null);

  useEffect(() => {
    if (!pickerFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerFor(null);
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest("[data-icon-bubble]")) setPickerFor(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [pickerFor]);

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

  const pickIcon = (social: FooterSocial, key: string) => {
    const spec = SOCIAL_ICONS.find((s) => s.key === key);
    if (!spec) return;
    // Keep a hand-typed label, but follow the icon while the label is still
    // the one the previous choice filled in.
    const previous = socialIconLabel(social.icon);
    const label =
      !social.label.trim() || (previous && social.label.trim() === previous)
        ? spec.label
        : social.label;
    onPatch(social.id, { icon: key, label });
    setPickerFor(null);
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

              <div className="relative shrink-0">
                <span className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-white">
                  {Icon ? (
                    <Icon className="h-5 w-5" />
                  ) : (
                    <span className="text-xs font-semibold">{(s.label || "?").trim().charAt(0)}</span>
                  )}
                </span>
                <button
                  type="button"
                  aria-label={`Change the ${s.label || "social"} icon`}
                  aria-expanded={pickerFor === s.id}
                  onClick={() => setPickerFor(pickerFor === s.id ? null : s.id)}
                  className="absolute -bottom-1.5 left-1/2 grid h-5 w-5 -translate-x-1/2 place-items-center rounded-full border border-white/15 bg-ink-900 text-zinc-300 shadow-md transition-colors hover:border-saffron-400/60 hover:text-white"
                >
                  <Pencil className="h-2.5 w-2.5" aria-hidden="true" />
                </button>

                {pickerFor === s.id && (
                  <div
                    data-icon-bubble
                    role="dialog"
                    aria-label="Choose an icon"
                    className="absolute left-0 top-full z-50 mt-3 w-[17rem] rounded-2xl border border-white/10 bg-ink-950/95 p-3 shadow-2xl shadow-black/60 backdrop-blur-xl"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute -top-1.5 left-6 h-3 w-3 rotate-45 border-l border-t border-white/10 bg-ink-950"
                    />
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                      Choose an icon
                    </p>
                    <div className="grid max-h-56 grid-cols-6 gap-1.5 overflow-y-auto pr-1">
                      {SOCIAL_ICONS.map((spec) => {
                        const PickIcon = spec.Icon;
                        const active = spec.key === s.icon;
                        return (
                          <button
                            key={spec.key}
                            type="button"
                            aria-label={spec.label}
                            aria-pressed={active}
                            title={spec.label}
                            onClick={() => pickIcon(s, spec.key)}
                            className={cn(
                              "grid h-9 w-9 place-items-center rounded-lg border transition-colors",
                              active
                                ? "border-saffron-400 bg-saffron-400/15 text-saffron-300"
                                : "border-white/10 text-zinc-300 hover:border-white/25 hover:text-white"
                            )}
                          >
                            <PickIcon className="h-4 w-4" aria-hidden="true" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <input
                value={s.label}
                onChange={(e) => onPatch(s.id, { label: e.target.value })}
                aria-label="Icon name"
                placeholder="Name"
                className={cn(inputCls, "w-32 shrink-0 py-2")}
              />
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
    </div>
  );
}
