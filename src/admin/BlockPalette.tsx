import { useEffect } from "react";
import { X } from "lucide-react";
import { BLOCK_LIBRARY, type BlockKind } from "../blocks/types";
import { cn } from "../utils/cn";

/**
 * The component library: a drawer that slides in from the left edge listing
 * everything that can be dropped into a composed section.
 *
 * Shared by the live site (when an admin is previewing) and the dashboard, so
 * both places offer exactly the same set of components.
 */
export default function BlockPalette({
  open,
  onClose,
  onPick,
  sectionLabel,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (kind: BlockKind) => void;
  sectionLabel?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-[80] bg-black/50 backdrop-blur-[2px] transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />

      <aside
        aria-label="Component library"
        aria-hidden={!open}
        className={cn(
          "fixed left-0 top-0 z-[85] flex h-full w-[19.5rem] max-w-[86vw] flex-col",
          "border-r border-white/10 bg-ink-950/95 shadow-2xl shadow-black/60 backdrop-blur-xl",
          "transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-white">Add a component</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              {sectionLabel ? `Into “${sectionLabel}”. ` : ""}
              Pick one — you can resize and reorder it afterwards.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close component library"
            tabIndex={open ? 0 : -1}
            className="aspect-square grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-zinc-400 transition-colors hover:border-white/25 hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
          {BLOCK_LIBRARY.map((spec) => {
            const Icon = spec.icon;
            return (
              <button
                key={spec.kind}
                type="button"
                tabIndex={open ? 0 : -1}
                onClick={() => onPick(spec.kind)}
                className="group flex w-full items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition-colors duration-200 hover:border-saffron-300/40 hover:bg-white/[0.07] focus:outline-none focus-visible:border-saffron-400"
              >
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-saffron-400/15 text-saffron-300">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-white">{spec.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500">{spec.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>
    </>
  );
}
