import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { cn } from "../utils/cn";

/**
 * Small confirmation dialog for destructive actions.
 *
 * Follows the same accessibility shape as CountdownSetupDialog: rendered in a
 * portal, focus moved to the safe (cancel) control, focus trapped inside, Esc
 * cancels, and focus returned to whatever opened it.
 */
export default function ConfirmDialog({
  title,
  message,
  detail,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  /** Optional emphasised second line, e.g. a warning. */
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
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
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]'
        ) ?? []
      ).filter((control) => control.getClientRects().length > 0);
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
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-6">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="w-full max-w-md rounded-3xl border border-white/10 bg-ink-950 p-6 shadow-2xl shadow-black/80"
      >
        <h2
          id="confirm-dialog-title"
          className="flex items-center gap-2.5 font-display text-lg font-semibold text-white"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-500/15 text-red-400">
            <AlertTriangle className="h-4.5 w-4.5" />
          </span>
          {title}
        </h2>
        <p id="confirm-dialog-message" className="mt-4 text-sm leading-relaxed text-zinc-400">
          {message}
        </p>
        {detail && (
          <p className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-200">
            {detail}
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className={cn(
              "inline-flex items-center justify-center rounded-xl bg-white/[0.08] px-5 py-2.5 text-sm font-semibold text-white",
              "transition-colors hover:bg-white/[0.14]"
            )}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center justify-center rounded-xl bg-red-500 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-red-400"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
