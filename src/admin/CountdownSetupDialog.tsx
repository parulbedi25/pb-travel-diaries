import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Power, X } from "lucide-react";
import type { CountdownTarget } from "./countdownSetup";

export default function CountdownSetupDialog({
  activeSections,
  onReset,
  onCancel,
}: {
  activeSections: CountdownTarget[];
  onReset: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onCancel });
  callbacks.current = { onCancel };

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        callbacks.current.onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]'
      ) ?? []).filter((control) => control.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-6">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="countdown-conflict-title"
        aria-describedby="countdown-conflict-description"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl border border-saffron-400/25 bg-ink-950 p-5 shadow-2xl shadow-black/60 sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-saffron-400/10 text-saffron-300">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <h2 id="countdown-conflict-title" className="font-display text-xl font-semibold text-white">
              Selected sections are already active
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel countdown setup and close dialog"
            className="aspect-square grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[0.06] text-zinc-400 hover:bg-white/[0.12] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p id="countdown-conflict-description" className="mt-3 text-sm leading-relaxed text-zinc-400">
          These sections have their toggles ON in the left-hand list. Switch them OFF first to reveal them again when the countdown finishes.
        </p>

        <ul className="my-5 divide-y divide-white/10 border-y border-white/10" aria-label="Already active selected sections">
          {activeSections.map((section) => (
            <li key={section.id} className="flex items-start gap-3 py-3 text-sm font-medium text-zinc-200">
              <Power className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
              <span>{section.label}</span>
            </li>
          ))}
          {activeSections.length === 0 && (
            <li className="py-3 text-sm text-zinc-400">These sections have already been switched off. You can continue the setup.</li>
          )}
        </ul>

        <p className="text-xs leading-relaxed text-zinc-500">
          Only the listed sections will be reset. Unselected sections stay unchanged. Save Changes publishes the countdown setup.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          Cancel restores the saved countdown fields and switches the countdown OFF, without changing your active sections.
        </p>

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-full border border-white/15 px-4 py-3 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            Cancel Countdown Setup
          </button>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#f5b301] px-5 py-3 text-xs font-bold text-[#171513] transition-colors hover:bg-[#ffce49] active:scale-95"
          >
            <Power className="h-3.5 w-3.5" />
            Reset Sections &amp; Set Countdown
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}