import { useEffect, useRef, useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  resolveHeaderButtons,
  resolveMapSettings,
  resolveThemeColors,
  sectionData,
  useSite,
  type CartoStyle,
  type HeaderButton,
  type LiveData,
  type MapProvider,
  type MapSettings,
  type RestoreScope,
  type ThemeTokens,
} from "../store/siteContent";
import VectorBasemap from "../components/VectorBasemap";
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

const PROVIDERS: { id: MapProvider; label: string; hint: string }[] = [
  {
    id: "carto",
    label: "CARTO",
    hint: "Vector basemaps with your key. Positron in light mode, Dark Matter in dark — or pick one drawing for both.",
  },
  {
    id: "openstreetmap",
    label: "OpenStreetMap",
    hint: "The keyless look this site had before CARTO. Free, and it needs nothing from you.",
  },
  {
    id: "satellite",
    label: "Satellite",
    hint: "Esri's aerial imagery — a photograph of the ground, with no name printed on it. Good for the Himalaya.",
  },
];

const CARTO_DRAWINGS: { id: CartoStyle; label: string; hint: string }[] = [
  { id: "auto", label: "Follow the theme", hint: "Positron by day, Dark Matter by night" },
  { id: "voyager", label: "Voyager", hint: "Warm, colourful, suits both themes" },
  { id: "positron", label: "Positron", hint: "Pale and quiet, made for light mode" },
  { id: "dark-matter", label: "Dark Matter", hint: "Near-black, made for dark mode" },
];

/**
 * The map itself, in the dashboard, drawn from the draft.
 *
 * The panel used to describe the choice in a paragraph and leave you to save,
 * reload and go look at the tracker to find out what you had picked. This is
 * the same component the site draws with — VectorBasemap, so CARTO's vector
 * styles and the keyless ones appear exactly as they will on the page, and
 * satellite through the raster path it always takes — handed the *draft*
 * settings rather than the published ones. Click a look and the map under your
 * cursor changes; nothing is published until Save Changes.
 *
 * It is centred on wherever PB is now, because that is the ground the look
 * will actually be judged on, and it carries the credit the real map carries,
 * since a preview is still tiles on a screen.
 */
function MapPreview({ settings }: { settings: MapSettings }) {
  const { draft } = useSite();
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

  // Where PB is now — the checkpoint marked "here now", else the first stop.
  // The same place the tracker centres on, so this is the ground the look will
  // actually be judged on rather than some arbitrary patch of map.
  const { stops } = sectionData<LiveData>(draft, "live");
  const here = stops.find((s) => s.status === "live") ?? stops[0];
  const lat = here?.lat ?? 31.369;
  const lng = here?.lng ?? 76.3729;
  const place = here?.name ?? "Nangal";

  return (
    <div
      ref={host}
      className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/10 bg-ink-900"
      data-map-preview={settings.provider}
    >
      <VectorBasemap
        settings={settings}
        view={{ lat, lng, zoom: 12 }}
        width={size.width}
        height={size.height}
        className="absolute inset-0"
        attributionClassName="pointer-events-auto absolute bottom-2 right-2 max-w-[calc(100%-1rem)] text-right text-[9px] leading-snug text-white/60"
      />
      {/* The place the look is being judged on, and nothing else — the real
          panel's route, pins and plates would only get in the way of seeing
          the basemap. */}
      <div className="pointer-events-none absolute inset-0">
        <span className="shrink-0 aspect-square absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-saffron-400 shadow-[0_0_0_4px_rgba(245,179,1,0.25),0_0_16px_rgba(245,179,1,0.6)]" />
        <span className="absolute left-1/2 top-1/2 mt-3 -translate-x-1/2 rounded-full bg-ink-950/80 px-2 py-0.5 text-[10px] font-semibold text-white">
          {place}
        </span>
      </div>
    </div>
  );
}

export function MapPanel() {
  const { draft, content, updateDraft, logAction, hasChanges } = useSite();
  const map = resolveMapSettings(draft.map);
  const saved = resolveMapSettings(content.map);
  const savedLabel = PROVIDERS.find((p) => p.id === saved.provider)?.label ?? "CARTO";

  const set = (action: string, patch: Partial<typeof map>) => {
    logAction(action);
    updateDraft((c) => ({ ...c, map: { ...resolveMapSettings(c.map), ...patch } }));
  };

  return (
    <div>
      <RestoreBar scope="map" label="map look" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <div className="rounded-3xl glass p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Basemap</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {PROVIDERS.map((p) => {
              const on = map.provider === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set(`Map look: ${p.label}`, { provider: p.id })}
                  className={cn(
                    "rounded-2xl border p-4 text-left transition-colors",
                    on
                      ? "border-saffron-400/60 bg-saffron-400/[0.08]"
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white">{p.label}</span>
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
                  <span className="mt-1.5 block text-[11px] leading-relaxed text-zinc-500">{p.hint}</span>
                </button>
              );
            })}
          </div>

          <div
            className={cn(
              "mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 transition-opacity",
              map.provider === "carto" ? "opacity-100" : "pointer-events-none opacity-40"
            )}
            aria-hidden={map.provider !== "carto"}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">CARTO drawing</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {CARTO_DRAWINGS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  aria-pressed={map.cartoStyle === d.id}
                  onClick={() => set(`Map drawing: ${d.label}`, { cartoStyle: d.id })}
                  title={d.hint}
                  className={cn(
                    "rounded-full px-3.5 py-2 text-xs font-semibold transition-colors",
                    map.cartoStyle === d.id
                      ? "bg-saffron-400 text-on-gold"
                      : "bg-white/[0.06] text-zinc-400 hover:text-white"
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              CARTO key
            </label>
            <input
              value={map.cartoKey}
              onChange={(e) => set("Changed the CARTO key", { cartoKey: e.target.value })}
              placeholder="cb1_…"
              spellCheck={false}
              autoComplete="off"
              className={cn(inputCls, "mt-2 font-mono text-[12px]")}
            />
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              A basemap key only unlocks tiles, so it is safe in the page — but it is public: anyone can read
              it in the build. Leave it blank and the site draws the keyless OpenStreetMap look instead.
            </p>
          </div>
        </div>

        <div className="min-w-0 xl:sticky xl:top-28 xl:self-start">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Preview
          </p>
          <div className="rounded-3xl border border-white/10 bg-ink-900 p-3">
            <MapPreview settings={map} />

            <div className="mt-3 flex items-start gap-2 px-1.5 pb-1.5">
              <span
                className={cn(
                  "aspect-square mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                  hasChanges ? "bg-saffron-400" : "bg-emerald-400"
                )}
                aria-hidden="true"
              />
              <p className="text-[11px] leading-relaxed text-zinc-500">
                {hasChanges ? (
                  <>
                    This is the draft, drawn live — <span className="text-zinc-300">{savedLabel}</span> is
                    still what the site shows. <span className="font-semibold text-saffron-400">Save
                    Changes</span> publishes it.
                  </>
                ) : (
                  <>This is what the site is showing. Pick another look and it changes here first.</>
                )}
              </p>
            </div>
          </div>

          <div className="mt-3 rounded-3xl border border-white/10 bg-ink-900 p-5">
            {map.provider === "carto" ? (
              <p className="text-sm leading-relaxed text-zinc-300">
                The tracker map and the nearby page draw on{" "}
                <span className="font-semibold text-white">
                  CARTO {map.cartoStyle === "auto" ? "(by theme)" : map.cartoStyle}
                </span>
                , with every place name switched off.
              </p>
            ) : map.provider === "satellite" ? (
              <p className="text-sm leading-relaxed text-zinc-300">
                The maps draw on{" "}
                <span className="font-semibold text-white">Esri's satellite imagery</span> — the real
                ground, photographed. No labels, because there are none in the picture.
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-zinc-300">
                The maps draw on the{" "}
                <span className="font-semibold text-white">keyless OpenStreetMap</span> styles — OpenFreeMap
                first, raster tiles behind it.
              </p>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
              Either way, if the chosen one cannot load, the other is tried before anything is given up — a map
              in the wrong style beats no map at all. The preview above is the same basemap the tracker draws,
              centred on PB's current checkpoint.
            </p>
            <p className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2.5 font-mono text-[10px] leading-relaxed text-zinc-400">
              {map.provider === "carto"
                ? "basemaps.cartocdn.com/gl/…-gl-style/style.json"
                : map.provider === "satellite"
                  ? "arcgisonline.com/…/World_Imagery/MapServer/tile/…"
                  : "tiles.openfreemap.org/styles/…"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
