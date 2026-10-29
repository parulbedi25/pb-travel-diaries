import { useEffect, useRef, useState } from "react";
import { Check, Eye, EyeOff, KeyRound, Moon, Plus, RotateCcw, Sun, Trash2 } from "lucide-react";
import {
  resolveHeaderButtons,
  resolveMapSettings,
  resolveThemeColors,
  sectionData,
  useSite,
  type HeaderButton,
  type LiveData,
  type MapSettings,
  type RestoreScope,
  type ThemeTokens,
} from "../store/siteContent";
import VectorBasemap from "../components/VectorBasemap";
import { MAP_LOOKS, looksFor, type MapLook, type MapLookId, type Theme as MapTheme } from "../utils/mapLooks";
import ColorPicker from "./ColorPicker";
import { cn } from "../utils/cn";
import Switch from "./Switch";
import { inputCls } from "./fieldStyles";

const pillBtn = "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors";

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
                <Switch on={b.enabled} onChange={(v) => patch(b.id, { enabled: v })} label={`Show ${b.label}`} />
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
              <div key={tok.key} className="min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-200">{tok.label}</p>
                  <p className="text-[11px] text-zinc-500">
                    {tok.hint} · <span className="font-mono text-zinc-400">{t[tok.key]}</span>
                  </p>
                </div>
                <ColorPicker
                  label={tok.label}
                  value={t[tok.key]}
                  onChange={(hex) => setToken(tok.key, hex)}
                  size="sm"
                  className="mt-2.5"
                />
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
                <span className="shrink-0 aspect-square h-2.5 w-2.5 rounded-full" style={{ background: t.goldDeep }} />
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

/* ═══════════════ Map look ═══════════════ */

/**
 * The map itself, in the dashboard, drawn from the draft.
 *
 * Handed the *draft* settings rather than the published ones, so a look changes
 * here before anything is published, and the theme is forced rather than taken
 * from the site: the point of this panel is to see the light look and the dark
 * look, and the dashboard's own theme toggle is about the dashboard, not the
 * map. It is centred on wherever PB is now, because that is the ground the look
 * will actually be judged on.
 */
function MapPreview({
  settings,
  theme,
  place,
  onFailure,
}: {
  settings: MapSettings;
  theme: MapTheme;
  place: { lat: number; lng: number; name: string };
  /** Why the drawing gave up, so the panel can say it rather than look blank. */
  onFailure?: (reason: string) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Tiles are placed by hand, so the panel has to be measured rather than
  // guessed at — same rule the tracker map follows.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width > 0 && height > 0) setSize({ width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={host}
      className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/10 bg-ink-900"
      data-map-preview-theme={theme}
    >
      <VectorBasemap
        settings={settings}
        themeOverride={theme}
        view={{ lat: place.lat, lng: place.lng, zoom: 12 }}
        width={size.width}
        height={size.height}
        className="absolute inset-0"
        onFailure={onFailure}
      />
      {/* The place the look is being judged on, and nothing else — the real
          panel's route, pins and plates would only get in the way of seeing
          the basemap. */}
      <div className="pointer-events-none absolute inset-0">
        <span className="shrink-0 aspect-square absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-saffron-400 shadow-[0_0_0_4px_rgba(245,179,1,0.25),0_0_16px_rgba(245,179,1,0.6)]" />
        <span className="absolute left-1/2 top-1/2 mt-3 -translate-x-1/2 rounded-full bg-ink-950/80 px-2 py-0.5 text-[10px] font-semibold text-white">
          {place.name}
        </span>
      </div>
    </div>
  );
}

/** One look, offered as a card. */
function LookCard({
  look,
  on,
  onPick,
}: {
  look: MapLook;
  on: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className={cn(
        "rounded-2xl border p-3 text-left transition-colors",
        on
          ? "border-saffron-400/60 bg-saffron-400/[0.08]"
          : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-semibold text-white">{look.label}</span>
        <span
          className={cn(
            "shrink-0 aspect-square grid h-4 w-4 place-items-center rounded-full border",
            on ? "border-saffron-400 bg-saffron-400" : "border-white/25"
          )}
          aria-hidden="true"
        >
          {on && <span className="shrink-0 aspect-square h-1.5 w-1.5 rounded-full bg-ink-950" />}
        </span>
      </span>
      <span className="mt-1 block text-[10px] leading-relaxed text-zinc-500">{look.hint}</span>
      <span className="mt-1.5 block font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">
        {look.maker}
      </span>
    </button>
  );
}

/**
 * The one place an owner pastes the map key.
 *
 * A card of its own above the looks rather than a line in a form: without a key
 * nothing draws — no style, no tiles, no places — and whoever is installing the
 * site needs to see that before choosing anything. The key is shown masked,
 * because it is long, pasted from another dashboard, and easy to paste twice.
 */
function MapKeyCard({
  map,
  saved,
  onChange,
}: {
  map: MapSettings;
  saved: MapSettings;
  onChange: (value: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const key = map.geoapifyKey.trim();
  const missing = !key;
  const changed = key !== saved.geoapifyKey.trim();

  return (
    <div className={cn("rounded-3xl glass p-5", missing && "border-red-400/30")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          <KeyRound className="h-3.5 w-3.5" /> Map API key
        </p>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          Geoapify
        </span>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        One key for the whole map: the drawings, the tiles under them, and every place lookup — the towns
        on a pasted route, a stop you search for, a member's saved places. Paste it from your Geoapify
        dashboard; the free plan covers this site several times over.
      </p>

      <div className="mt-3 flex items-stretch gap-2">
        <input
          id="geoapify-key"
          value={map.geoapifyKey}
          onChange={(e) => onChange(e.target.value)}
          type={revealed ? "text" : "password"}
          placeholder="Paste your Geoapify key"
          spellCheck={false}
          autoComplete="off"
          aria-label="Geoapify API key"
          className={cn(inputCls, "font-mono text-[12px]")}
        />
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-pressed={revealed}
          title={revealed ? "Hide the key" : "Show the key"}
          className="grid w-11 shrink-0 place-items-center rounded-xl border border-white/10 text-zinc-400 transition-colors hover:border-white/25 hover:text-white"
        >
          {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
        {missing ? (
          <span className="font-medium text-red-300">
            No key yet — the map cannot draw until there is one.
          </span>
        ) : changed ? (
          <span className="font-medium text-saffron-300">Not saved yet — Save Changes to use it.</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
            <Check className="h-3.5 w-3.5" /> In use on the live site
          </span>
        )}
        <a
          href="https://myprojects.geoapify.com/"
          target="_blank"
          rel="noreferrer"
          className="text-zinc-500 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white"
        >
          Where to get a key
        </a>
      </div>

      <p className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2.5 text-[10px] leading-relaxed text-zinc-500">
        The key travels with each map request, so it can be read in the page — restrict it to this domain
        in your Geoapify dashboard rather than treating it as a secret. It is saved with the site, so every
        browser gets the same one, and changing it here changes the map everywhere.
      </p>
    </div>
  );
}

export function MapPanel() {
  const { draft, content, updateDraft, logAction, hasChanges, theme: siteTheme } = useSite();
  const map = resolveMapSettings(draft.map);
  const saved = resolveMapSettings(content.map);

  const set = (action: string, patch: Partial<MapSettings>) => {
    logAction(action);
    updateDraft((c) => ({ ...c, map: { ...resolveMapSettings(c.map), ...patch } }));
  };

  /**
   * Which theme's drawings the panel is showing.
   *
   * One map, one list: the theme switch sits on the map itself, so choosing
   * "Dark" redraws the preview in the night palette and swaps the cards below
   * for the dark drawings. Picking a card then sets that theme's look — the
   * light and dark choices stay separate, which is the whole point.
   */
  const [activeTheme, setActiveTheme] = useState<MapTheme>(siteTheme === "dark" ? "dark" : "light");
  /** Why the drawing failed, if it did — set by the preview, shown below it. */
  const [mapReason, setMapReason] = useState("");
  const currentLook = activeTheme === "light" ? map.lightLook : map.darkLook;

  // Where PB is now — the checkpoint marked "here now", else the first stop.
  // The same place the tracker centres on, so this is the ground the look will
  // actually be judged on rather than some arbitrary patch of map.
  const { stops } = sectionData<LiveData>(draft, "live");
  const here = stops.find((s) => s.status === "live") ?? stops[0];
  const place = {
    lat: here?.lat ?? 31.369,
    lng: here?.lng ?? 76.3729,
    name: here?.name ?? "Nangal",
  };

  const lookOf = (id: MapLookId) => MAP_LOOKS.find((l) => l.id === id);
  const label = (id: MapLookId) => lookOf(id)?.label ?? id;

  const themes: { theme: MapTheme; label: string; icon: typeof Sun }[] = [
    { theme: "light", label: "Light", icon: Sun },
    { theme: "dark", label: "Dark", icon: Moon },
  ];

  return (
    <div>
      <RestoreBar scope="map" label="map look" />

      <div className="grid gap-5">
        {/* First, because nothing below it draws without it: no key means no
            drawing, no tiles and no place lookups. */}
        <MapKeyCard
          map={map}
          saved={saved}
          onChange={(value) => set("Changed the map API key", { geoapifyKey: value })}
        />

        <section className="rounded-3xl glass p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Map look</p>
            <p className="text-[11px] text-zinc-600">
              {hasChanges ? "Draft — not published yet" : "This is what the site shows"}
            </p>
          </div>

          <div className="relative mt-3">
            <MapPreview settings={map} theme={activeTheme} place={place} onFailure={setMapReason} />

            {/* On the map, where the thing it changes lives. */}
            <div
              role="group"
              aria-label="Which theme's map to show and choose"
              className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full border border-white/15 bg-zinc-950/75 p-1 backdrop-blur"
            >
              {themes.map(({ theme: t, label: text, icon: Icon }) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setActiveTheme(t)}
                  aria-pressed={activeTheme === t}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors",
                    activeTheme === t
                      ? "bg-saffron-400 text-on-gold"
                      : "text-zinc-300 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {text}
                </button>
              ))}
            </div>
          </div>

          {mapReason && (
            <p className="mt-2.5 flex items-start gap-2 text-[11px] leading-relaxed text-amber-300/90">
              <span className="mt-1 aspect-square h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
              <span>
                The {activeTheme} drawing is not arriving — {mapReason} The map shows the plain
                base underneath until it does.
              </span>
            </p>
          )}

          <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-500">
            The map at the top is the {activeTheme} drawing —{" "}
            <span className="font-semibold text-zinc-300">{label(currentLook)}</span>. Visitors see it
            when the site is in {activeTheme} mode; the other theme has its own choice.
          </p>

          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            {activeTheme === "light" ? "Light drawings" : "Dark drawings"}
          </p>
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {looksFor(activeTheme).map((look) => (
              <LookCard
                key={look.id}
                look={look}
                on={currentLook === look.id}
                onPick={() =>
                  set(
                    `${activeTheme === "light" ? "Light" : "Dark"} theme map look: ${look.label}`,
                    activeTheme === "light" ? { lightLook: look.id } : { darkLook: look.id }
                  )
                }
              />
            ))}
          </div>

          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-relaxed text-zinc-500">
            <span
              className={cn(
                "aspect-square h-1.5 w-1.5 shrink-0 rounded-full",
                hasChanges ? "bg-saffron-400" : "bg-emerald-400"
              )}
              aria-hidden="true"
            />
            {hasChanges ? (
              <>
                Live site still shows{" "}
                <span className="text-zinc-300">
                  {label(saved.lightLook)} · {label(saved.darkLook)}
                </span>
                . <span className="font-semibold text-saffron-400">Save Changes</span> publishes this.
              </>
            ) : (
              <>
                Light: <span className="text-zinc-300">{label(map.lightLook)}</span> · Dark:{" "}
                <span className="text-zinc-300">{label(map.darkLook)}</span> — every place name is
                switched off in both.
              </>
            )}
          </p>
        </section>

      </div>
    </div>
  );
}
