import { useEffect, useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  resolveHeaderButtons,
  resolveThemeColors,
  useSite,
  type HeaderButton,
  type RestoreScope,
  type ThemeTokens,
} from "../store/siteContent";
import { cn } from "../utils/cn";

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-saffron-400/60 focus:outline-none transition-colors";

const pillBtn = "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors";

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300",
        on ? "bg-saffron-400" : "bg-white/15"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-300",
          on ? "left-[22px]" : "left-0.5"
        )}
      />
    </button>
  );
}

/** "Restore defaults" for one settings group. Two clicks, so it can't fire by accident. */
export function RestoreBar({ scope, label }: { scope: RestoreScope; label: string }) {
  const { restoreScope } = useSite();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
      <p className="text-[11px] leading-relaxed text-zinc-500">
        Restore the {label} to its original settings. This is a draft change, so Save Changes publishes it.
      </p>
      <button
        type="button"
        onClick={() => {
          if (armed) {
            restoreScope(scope);
            setArmed(false);
          } else {
            setArmed(true);
          }
        }}
        className={cn(
          pillBtn,
          armed ? "bg-red-500 text-white" : "bg-white/[0.06] text-zinc-300 hover:bg-red-500/15 hover:text-red-400"
        )}
      >
        <RotateCcw className="h-3 w-3" />
        {armed ? "Click again to restore" : "Restore defaults"}
      </button>
    </div>
  );
}

/* ═══════════════ Header call-to-action buttons ═══════════════ */

const MAX_HEADER_BUTTONS = 2;
const VARIANTS: { id: HeaderButton["variant"]; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "gold", label: "Gold" },
  { id: "outline", label: "Outline" },
];

function previewClass(v: HeaderButton["variant"]): string {
  if (v === "gold") return "bg-saffron-400 text-on-gold";
  if (v === "outline") return "border border-white/20 text-white";
  return "bg-white text-ink-950";
}

export function HeaderButtonsEditor() {
  const { draft, updateDraft, logAction } = useSite();
  const buttons = resolveHeaderButtons(draft.headerButtons);

  const write = (action: string, fn: (list: HeaderButton[]) => HeaderButton[]) => {
    logAction(action);
    updateDraft((c) => ({ ...c, headerButtons: fn(resolveHeaderButtons(c.headerButtons)) }));
  };
  const patch = (id: string, p: Partial<HeaderButton>) =>
    write("Edited header button", (list) => list.map((b) => (b.id === id ? { ...b, ...p } : b)));
  const add = () =>
    write("Added a header button", (list) =>
      list.length >= MAX_HEADER_BUTTONS
        ? list
        : [
            ...list,
            {
              id: `btn-${Math.random().toString(36).slice(2, 8)}`,
              label: "New button",
              href: "#pricing",
              enabled: true,
              variant: "gold",
              newTab: false,
            },
          ]
    );
  const remove = (id: string, label: string) =>
    write(`Removed header button: ${label}`, (list) => list.filter((b) => b.id !== id));

  const shown = buttons.filter((b) => b.enabled && b.label.trim());

  return (
    <div className="mb-5 rounded-2xl glass p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-zinc-200">Header buttons</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Call-to-action buttons on the right of the header. Up to {MAX_HEADER_BUTTONS}.
          </p>
        </div>
        <button
          type="button"
          onClick={add}
          disabled={buttons.length >= MAX_HEADER_BUTTONS}
          className={cn(pillBtn, "bg-saffron-400 text-on-gold disabled:opacity-40")}
        >
          <Plus className="h-3.5 w-3.5" /> Add button
        </button>
      </div>

      {buttons.length === 0 && (
        <p className="rounded-xl border border-dashed border-white/10 px-4 py-4 text-center text-xs text-zinc-600">
          No header buttons. Visitors will see none.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {buttons.map((b) => (
          <div
            key={b.id}
            className="grid gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 sm:grid-cols-2"
          >
            <input
              value={b.label}
              onChange={(e) => patch(b.id, { label: e.target.value })}
              aria-label="Button label"
              placeholder="Button label"
              className={inputCls}
            />
            <input
              value={b.href}
              onChange={(e) => patch(b.id, { href: e.target.value })}
              aria-label="Button link"
              placeholder="#pricing or https://…"
              className={cn(inputCls, "font-mono text-xs")}
            />
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <select
                value={b.variant}
                onChange={(e) => patch(b.id, { variant: e.target.value as HeaderButton["variant"] })}
                aria-label="Button style"
                className={cn(inputCls, "w-auto py-2 text-xs")}
              >
                {VARIANTS.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-[11px] text-zinc-400">
                <input
                  type="checkbox"
                  checked={b.newTab}
                  onChange={(e) => patch(b.id, { newTab: e.target.checked })}
                  className="h-4 w-4 accent-[#f5b301]"
                />
                Open in new tab
              </label>
              <div className="ml-auto flex items-center gap-3">
                <span className="text-[11px] font-semibold text-zinc-400">{b.enabled ? "Disable" : "Enable"}</span>
                <Toggle on={b.enabled} onChange={(v) => patch(b.id, { enabled: v })} label={`Show ${b.label}`} />
                <button
                  type="button"
                  onClick={() => remove(b.id, b.label)}
                  aria-label={`Remove ${b.label}`}
                  className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-zinc-400 hover:bg-red-500/15 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.07] bg-black/30 p-3">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Preview</span>
        {shown.length === 0 && <span className="text-[11px] text-zinc-600">Nothing shown in the header</span>}
        {shown.map((b) => (
          <span key={b.id} className={cn("inline-flex items-center rounded-full px-4 py-2 text-xs font-semibold", previewClass(b.variant))}>
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════ Theme colours ═══════════════ */

const TOKENS: { key: keyof ThemeTokens; label: string; hint: string }[] = [
  { key: "background", label: "Page background", hint: "Behind everything" },
  { key: "surface", label: "Surface", hint: "Footer and wide cards" },
  { key: "panel", label: "Panel", hint: "Raised cards and menus" },
  { key: "heading", label: "Headings", hint: "Titles and key words" },
  { key: "body", label: "Body text", hint: "Paragraphs" },
  { key: "gold", label: "Primary accent", hint: "Buttons, chips and borders" },
  { key: "goldSoft", label: "Soft accent", hint: "Pale accent text and labels" },
  { key: "goldDeep", label: "Deep accent", hint: "Soft background glows" },
  { key: "goldInk", label: "Accent text", hint: "Accent colour for readable text" },
];

/** Matches .text-on-gold in index.css — text on a gold fill is always dark. */
const ON_GOLD = "#171513";

export function ThemePanel() {
  const { draft, updateDraft, logAction } = useSite();
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const t = resolveThemeColors(draft.themeColors)[mode];

  const setToken = (key: keyof ThemeTokens, value: string) => {
    logAction(`Changed ${mode} theme: ${key}`);
    updateDraft((c) => {
      const cur = resolveThemeColors(c.themeColors);
      return { ...c, themeColors: { ...cur, [mode]: { ...cur[mode], [key]: value } } };
    });
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2" role="group" aria-label="Theme mode">
          {(["dark", "light"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={cn(
                "rounded-full px-4 py-2 text-xs font-semibold capitalize transition-all",
                mode === m
                  ? "bg-saffron-400 text-on-gold"
                  : "bg-white/[0.06] text-zinc-400 hover:text-white"
              )}
            >
              {m} mode
            </button>
          ))}
        </div>
        <p className="text-[11px] text-zinc-500">Dark and light have separate colours</p>
      </div>

      <RestoreBar scope="theme" label="theme colours" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <div className="rounded-3xl glass p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {TOKENS.map((tok) => (
              <div key={tok.key} className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3">
                <input
                  type="color"
                  value={t[tok.key]}
                  onChange={(e) => setToken(tok.key, e.target.value)}
                  aria-label={`${tok.label} colour`}
                  className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent p-0.5"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-200">{tok.label}</p>
                  <p className="text-[11px] text-zinc-500">
                    {tok.hint} · <span className="font-mono text-zinc-400">{t[tok.key]}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0 xl:sticky xl:top-28 xl:self-start">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Live preview</p>
          <div className="rounded-3xl border border-white/10 p-6" style={{ background: t.background }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: t.gold }}>
              {mode} mode
            </p>
            <h3 className="mt-3 font-display text-2xl font-semibold leading-tight" style={{ color: t.heading }}>
              Chasing India, one mile at a time.
            </h3>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: t.body }}>
              Body text sits here, readable against the background.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm font-semibold">
              <span style={{ color: t.goldInk }}>Accent text</span>
              <span style={{ color: t.goldSoft }}>Soft accent text</span>
              <span className="inline-flex items-center gap-1.5" style={{ color: t.goldDeep }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.goldDeep }} />
                Deep accent
              </span>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <span className="rounded-full px-5 py-2.5 text-sm font-semibold" style={{ background: t.gold, color: ON_GOLD }}>
                Primary button
              </span>
              <span className="rounded-full border px-4 py-2 text-xs font-semibold" style={{ borderColor: t.gold, color: t.goldInk }}>
                Accent chip
              </span>
              <span className="rounded-full px-4 py-2 text-xs font-semibold" style={{ background: t.goldSoft, color: ON_GOLD }}>
                Soft chip
              </span>
            </div>
            <div className="mt-5 rounded-2xl p-4" style={{ background: t.panel }}>
              <p className="text-sm font-semibold" style={{ color: t.heading }}>Panel card</p>
              <p className="mt-1 text-xs" style={{ color: t.body }}>Raised surfaces use the panel colour.</p>
            </div>
            <div className="mt-3 rounded-2xl p-4" style={{ background: t.surface }}>
              <p className="text-xs" style={{ color: t.body }}>Footer and wide sections use the surface colour.</p>
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
            Colours apply to the whole site once you Save Changes. Switching the site between dark and light uses each mode's own palette.
          </p>
        </div>
      </div>
    </div>
  );
}
