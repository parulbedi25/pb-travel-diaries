import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "../utils/cn";
import { normalizeHex } from "../utils/pointerColors";

/**
 * Every colour in the dashboard is picked from a box.
 *
 * The browser's own colour control (the big gradient square you drag a ring
 * around) was the wrong tool here: it looks nothing like the rest of the
 * dashboard, its layout is the operating system's to decide, it cannot be
 * styled, and on some machines it opens a separate window that hides the thing
 * being recoloured. So the picker is a row of boxes — click the colour you
 * want — with a hex field beside it for anything not in the palette.
 *
 * One component, used everywhere a colour is chosen, so the Machine pointers,
 * the Gear pointers, the social icons, the brand mark and the theme tokens all
 * behave the same way.
 */

/** Site colours first, then the hues the sections use, then the neutrals. */
const PALETTE: { hex: string; name: string }[] = [
  { hex: "#f5b301", name: "Site gold" },
  { hex: "#ffdf8a", name: "Soft gold" },
  { hex: "#d99700", name: "Deep gold" },
  { hex: "#fb923c", name: "Orange" },
  { hex: "#f43f5e", name: "Rose" },
  { hex: "#ec4899", name: "Pink" },
  { hex: "#a855f7", name: "Violet" },
  { hex: "#6366f1", name: "Indigo" },
  { hex: "#38bdf8", name: "Sky" },
  { hex: "#22d3ee", name: "Cyan" },
  { hex: "#2dd4bf", name: "Teal" },
  { hex: "#34d399", name: "Emerald" },
  { hex: "#84cc16", name: "Lime" },
  { hex: "#ffffff", name: "White" },
  { hex: "#d4d4d8", name: "Silver" },
  { hex: "#71717a", name: "Grey" },
  { hex: "#27272a", name: "Graphite" },
  { hex: "#070707", name: "Black" },
];

/** White on a dark box, near-black on a pale one — so the tick is always visible. */
function tickIsDark(hex: string): boolean {
  const clean = normalizeHex(hex) ?? "#000000";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.55;
}

export default function ColorPicker({
  label,
  value,
  onChange,
  /** The colour an empty value falls back to, shown as a "Default" box. */
  fallback,
  fallbackLabel = "Default",
  size = "md",
  className,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  /** Set when an empty value is meaningful (e.g. pointers fall back to gold). */
  fallback?: string;
  fallbackLabel?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const selected = normalizeHex(value);
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);

  const box = size === "sm" ? "h-7 w-7 rounded-md" : "h-8 w-8 rounded-lg";
  const commit = (raw: string) => {
    setHex(raw);
    const next = normalizeHex(raw);
    if (next) onChange(next);
    else if (raw.trim() === "") onChange("");
  };

  return (
    <div className={cn("min-w-0", className)}>
      <div
        role="group"
        aria-label={`${label} colour`}
        className={cn("flex flex-wrap gap-1.5", size === "sm" && "gap-1")}
      >
        {fallback ? (
          <button
            type="button"
            onClick={() => {
              setHex("");
              onChange("");
            }}
            aria-pressed={selected === null}
            title={fallbackLabel}
            aria-label={`${label}: ${fallbackLabel}`}
            className={cn(
              "relative grid shrink-0 place-items-center border border-white/20 text-white/90 transition-all",
              box,
              selected === null ? "ring-2 ring-white/70 ring-offset-2 ring-offset-ink-950" : "hover:border-white/50"
            )}
            style={{
              background:
                "repeating-linear-gradient(135deg, rgba(255,255,255,0.16) 0 3px, transparent 3px 6px), #17171a",
            }}
          >
            {selected === null && <Check className="h-4 w-4" aria-hidden="true" />}
          </button>
        ) : null}

        {PALETTE.map((entry) => {
          const isOn = selected === entry.hex;
          return (
            <button
              key={entry.hex}
              type="button"
              onClick={() => {
                setHex(entry.hex);
                onChange(entry.hex);
              }}
              aria-pressed={isOn}
              aria-label={`${label}: ${entry.name}`}
              title={`${entry.name} · ${entry.hex.toUpperCase()}`}
              style={{ background: entry.hex, color: tickIsDark(entry.hex) ? "#171513" : "#ffffff" }}
              className={cn(
                "grid shrink-0 place-items-center border border-white/20 transition-all",
                box,
                isOn
                  ? "ring-2 ring-saffron-300 ring-offset-2 ring-offset-ink-950"
                  : "hover:scale-110 hover:border-white/50"
              )}
            >
              {isOn && <Check className="h-4 w-4" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={hex}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => {
            // Anything unreadable is put back rather than silently kept.
            if (hex.trim() && !normalizeHex(hex)) setHex(value);
          }}
          placeholder={fallback ? "Default" : "#f5b301"}
          maxLength={7}
          spellCheck={false}
          aria-label={`${label} hex`}
          aria-invalid={Boolean(hex.trim()) && !normalizeHex(hex)}
          className={cn(
            "min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.05] font-mono text-white placeholder:text-zinc-500 transition-colors focus:border-saffron-400/60 focus:outline-none",
            size === "sm" ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs",
            hex.trim() && !normalizeHex(hex) && "border-rose-400/60"
          )}
        />
        {value ? (
          <span
            aria-hidden="true"
            className={cn("shrink-0 border border-white/20", size === "sm" ? "h-5 w-5 rounded" : "h-6 w-6 rounded-md")}
            style={{ background: selected ?? fallback ?? "transparent" }}
          />
        ) : null}
      </div>
    </div>
  );
}
