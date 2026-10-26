import { cn } from "../utils/cn";

/**
 * The dashboard's on/off switch.
 *
 * Shared in its own module so smaller editors can use it without importing
 * AdminPage, which would pull the whole dashboard along with it.
 */
export default function Switch({
  on,
  onChange,
  label,
  disabled = false,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!on);
      }}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300",
        disabled && "cursor-not-allowed opacity-50",
        on ? "bg-saffron-400" : "bg-white/15"
      )}
    >
      <span
        className={cn(
          "shrink-0 aspect-square absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-300",
          on ? "left-[22px]" : "left-0.5"
        )}
      />
    </button>
  );
}
