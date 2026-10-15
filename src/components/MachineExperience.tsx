import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Cog,
  Crosshair,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Fuel,
  Gauge,
  GripVertical,
  Luggage,
  MoveHorizontal,
  MonitorSmartphone,
  MoonStar,
  Play,
  RotateCcw,
  X,
  Wrench,
} from "lucide-react";
import type { BikeHotspot, MachineData } from "../store/siteContent";
import { isAdminSession, useSite } from "../store/siteContent";
import { getMedia } from "../admin/mediaLibrary";
import { isOn } from "../utils/enabled";
import { formatMilestone, resolveOdometer, type MilestoneState } from "../utils/odometer";
import { pointerColors, waveDelay, withAlpha } from "../utils/pointerColors";
import { SectionHeader, CountUp, EASE } from "./ui/motion";
import Photo from "./ui/Photo";
import { cn } from "../utils/cn";

type Block = { id: string; label: string; content: ReactNode; width: number };

/**
 * Semi-circular gauge for the stretch the bike is riding right now. Pure SVG,
 * so it scales with the card and costs nothing to animate (dash offset only).
 */
function StretchGauge({ pct }: { pct: number }) {
  const r = 46;
  const cx = 56;
  const cy = 56;
  const arc = Math.PI * r; // length of a half circle
  const clamped = Math.min(100, Math.max(0, pct));
  const d = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  return (
    <div className="relative h-14 w-28 shrink-0" role="img" aria-label={`${clamped}% of the current milestone`}>
      <svg viewBox="0 0 112 64" className="h-full w-full overflow-visible" aria-hidden>
        <path
          d={d}
          fill="none"
          className="stroke-white/10"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <motion.path
          d={d}
          fill="none"
          className="stroke-saffron-400"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={arc}
          initial={{ strokeDashoffset: arc }}
          whileInView={{ strokeDashoffset: arc - (clamped / 100) * arc }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 1.2, ease: EASE }}
        />
      </svg>
      <p className="absolute inset-x-0 bottom-0 text-center font-display text-lg font-bold leading-none text-white">
        {clamped}%
      </p>
    </div>
  );
}

/** One rung of the odometer ladder: cleared, in progress or still ahead. */
function MilestoneChip({ value, state }: { value: number; state: MilestoneState }) {
  return (
    <span
      title={
        state === "upcoming"
          ? `${value.toLocaleString("en-IN")} km — still ahead`
          : `${value.toLocaleString("en-IN")} km — ${state === "cleared" ? "cleared" : "in progress"}`
      }
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-1 font-mono text-[10px] font-bold",
        state === "cleared" && "border-saffron-400/45 bg-saffron-400/15 text-saffron-300",
        state === "active" && "border-saffron-400 bg-saffron-400 text-on-gold shadow-lg shadow-saffron-400/25",
        state === "upcoming" && "border-white/10 bg-white/[0.04] text-zinc-500"
      )}
    >
      {state === "cleared" && <Check className="h-2.5 w-2.5" />}
      {formatMilestone(value)}
    </span>
  );
}

const SPECS = [
  { icon: Cog, v: "452cc", l: "Liquid-cooled Sherpa single" },
  { icon: Gauge, v: "40.02 PS", l: "@ 8,000 rpm · 40 Nm" },
  { icon: Fuel, v: "17 L", l: "Tank · ≈450 km range" },
  { icon: Wrench, v: "230 mm", l: "Ground clearance" },
  { icon: MonitorSmartphone, v: '4" TFT', l: "TripperDash + maps" },
  { icon: Luggage, v: "196 kg", l: "Kerb · switchable rear ABS" },
];

const clampPct = (n: unknown, fallback = 50) => {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : fallback;
};
const clampHeight = (n: number) => Math.min(1600, Math.max(180, Math.round(n)));
// Below three columns, the part list / image can overflow and force extra
// implicit grid tracks, especially on Safari. Width resizing is desktop-only.
const clampCols = (n: number) => Math.min(12, Math.max(3, Math.round(n)));
const WIDTHS = [4, 6, 8, 12];
const GAP = 20; // matches gap-5 on the grid

/* Written out literally so Tailwind emits every span class. Spans apply from
   lg so the layout scales continuously with the viewport instead of jumping
   to small cells at one xl breakpoint. */
const SPAN_CLASS: Record<number, string> = {
  1: "lg:col-span-1 xl:col-span-1",
  2: "lg:col-span-2 xl:col-span-2",
  3: "lg:col-span-3 xl:col-span-3",
  4: "lg:col-span-4 xl:col-span-4",
  5: "lg:col-span-5 xl:col-span-5",
  6: "lg:col-span-6 xl:col-span-6",
  7: "lg:col-span-7 xl:col-span-7",
  8: "lg:col-span-8 xl:col-span-8",
  9: "lg:col-span-9 xl:col-span-9",
  10: "lg:col-span-10 xl:col-span-10",
  11: "lg:col-span-11 xl:col-span-11",
  12: "lg:col-span-12 xl:col-span-12",
};

/** How close a dragged edge must get to a neighbour before it snaps to it. */
const SNAP_PX = 10;

type ResizeDrag = (
  | { mode: "h"; startClientY: number }
  | { mode: "w"; startClientX: number }
) & {
  id: string;
  pointerId: number;
  start: number;
  value: number;
  snap: number | null;
  top: number;
  left: number;
};

/** A neighbouring block, measured once when a drag starts. */
type Metric = { height: number; bottom: number; right: number };

type PanelEdge = "top" | "right" | "bottom" | "left";
type PanelBox = { top: number; right: number; bottom: number; width: number };
type PanelResizeDrag = {
  edge: PanelEdge;
  pointerId: number;
  startX: number;
  startY: number;
  start: PanelBox;
  latest: PanelBox;
  stageWidth: number;
  stageHeight: number;
};

const PANEL_MIN_W = 190;
const PANEL_MIN_H = 170;
const PANEL_GAP = 16;
/** How far the photo magnifies on a focused pointer. Same as the rider map. */
const MACHINE_ZOOM = 1.65;

/**
 * Pointer bubble. Positioned in pixels and clamped to the bike image so it is
 * never cut off, on desktop or mobile. Shows the product image and description
 * only — the product link lives in the parts list beside the bike.
 */
function AccessoryBubble({
  spot,
  xPct,
  yPct,
  containerRef,
  onClose,
}: {
  spot: BikeHotspot;
  xPct: number;
  yPct: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const container = containerRef.current;
      const bubble = bubbleRef.current;
      if (!container || !bubble) return;
      // Offset sizes are unaffected by the entrance scale animation, unlike
      // getBoundingClientRect; this keeps the bubble inside the visible photo.
      const width = container.clientWidth;
      const height = container.clientHeight;
      const bubbleWidth = bubble.offsetWidth;
      const bubbleHeight = bubble.offsetHeight;
      if (!width || !height || !bubbleWidth) return;

      const px = (xPct / 100) * width;
      const py = (yPct / 100) * height;
      const gap = 12;
      const pad = 10;

      // Prefer right of the pointer, flip left when it would overflow, then clamp.
      let left = px + gap;
      if (left + bubbleWidth > width - pad) left = px - gap - bubbleWidth;
      left = Math.max(pad, Math.min(left, Math.max(pad, width - bubbleWidth - pad)));

      // Centre on the pointer, then clamp inside the image.
      let top = py - bubbleHeight / 2;
      top = Math.max(pad, Math.min(top, Math.max(pad, height - bubbleHeight - pad)));

      setPos((previous) =>
        previous?.left === left && previous.top === top ? previous : { left, top }
      );
    };

    place();
    window.addEventListener("resize", place);
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    if (containerRef.current && ro) ro.observe(containerRef.current);
    return () => {
      window.removeEventListener("resize", place);
      ro?.disconnect();
    };
  }, [xPct, yPct, containerRef, spot]);

  return (
    <motion.div
      ref={bubbleRef}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.22, ease: EASE }}
      style={{
        position: "absolute",
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-40 max-h-[calc(100%-1.25rem)] w-[min(272px,calc(100%-1.5rem))] overflow-y-auto overflow-x-hidden rounded-2xl border border-white/15 bg-ink-950/95 shadow-2xl shadow-black/70 backdrop-blur-xl"
      role="dialog"
      aria-label={spot.title}
    >
      {spot.image && (
        <div className="relative h-20 overflow-hidden sm:h-28">
          <img src={spot.image} alt={spot.title} className="h-full w-full object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 to-transparent" />
        </div>
      )}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-display text-sm font-semibold leading-snug text-white">{spot.title}</p>
            {spot.price && <p className="mt-0.5 font-mono text-xs font-bold text-saffron-300">{spot.price}</p>}
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            aria-label="Close accessory details"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-zinc-400 hover:bg-white/20 hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
        {spot.desc && <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">{spot.desc}</p>}
      </div>
    </motion.div>
  );
}

export default function MachineExperience({ data }: { data: MachineData }) {
  const { setMachineSubsectionLayout, previewAsVisitor } = useSite();
  const admin = isAdminSession() && !previewAsVisitor;
  const spots = Array.isArray(data.hotspots) ? data.hotspots.filter(isOn) : [];
  const gallery = Array.isArray(data.gallery)
    ? data.gallery.map((photo, sourceIndex) => ({ photo, sourceIndex })).filter(({ photo }) => isOn(photo))
    : [];
  // Pointer hover is temporary; clicking a pointer pins it until you click
  // elsewhere. List clicks only expand a row in place — never reorder it.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState<number | null>(null);
  const focusIdx = hoverIdx ?? pinnedIdx;
  const bubbleIdx = hoverIdx ?? pinnedIdx;
  // The bike's pointers pulse exactly like the rider map's; visitors who ask
  // for less motion get the still ring instead.
  const reduceMotion = useReducedMotion();
  // Zoom follows the focus, as it does on the rider map: hovering or pinning a
  // pointer magnifies the photo on that pointer. The pointers live inside the
  // zoom layer, so they travel with the part they mark and counter-scale to
  // keep their size.
  const focusedSpot = focusIdx !== null ? spots[focusIdx] : undefined;
  const zoomPoint = focusedSpot
    ? { x: clampPct(focusedSpot.x), y: clampPct(focusedSpot.y) }
    : null;
  const zoomed = Boolean(zoomPoint);
  const isExpanded = (idx: number) => (focusIdx === null ? listOpen === idx : idx === focusIdx);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // Only the start/end of a resize renders React; each pointer move paints
  // directly to the cell to avoid re-rendering a grid full of videos/images.
  const [resizing, setResizing] = useState<{ id: string; mode: "h" | "w" } | null>(null);
  const dragRef = useRef<ResizeDrag | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageAreaRef = useRef<HTMLDivElement>(null);
  const washRef = useRef<HTMLDivElement>(null);
  const partsPanelRef = useRef<HTMLDivElement>(null);
  const panelDragRef = useRef<PanelResizeDrag | null>(null);
  const panelPaintRef = useRef<number | null>(null);
  const [panelResizing, setPanelResizing] = useState<PanelEdge | null>(null);
  // The latest layout is mirrored below after it is resolved.
  const panelLayoutRef = useRef<PanelBox>({ top: 16, right: 16, bottom: 16, width: 272 });

  // Sample the photo's dominant colour so the right side is a soft colour wash
  // instead of a blurred copy of the bike object.
  useEffect(() => {
    const el = washRef.current;
    if (!el) return;
    let cancelled = false;
    const neutral = [34, 36, 40];
    const apply = (rgb: number[]) => {
      if (cancelled) return;
      el.style.setProperty("--wr", String(rgb[0]));
      el.style.setProperty("--wg", String(rgb[1]));
      el.style.setProperty("--wb", String(rgb[2]));
    };
    const img = new Image();
    // No crossOrigin handshake: the bike photo is served from public/media
    // alongside the app, so its pixels are readable without CORS. A remote URL
    // would taint the canvas instead, which the try/catch below absorbs.
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return apply(neutral);
        const size = 32;
        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(img, 0, 0, size, size);
        const px = ctx.getImageData(0, 0, size, size).data;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < px.length; i += 4) {
          r += px[i];
          g += px[i + 1];
          b += px[i + 2];
        }
        const n = px.length / 4 || 1;
        apply([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
      } catch {
        apply(neutral);
      }
    };
    img.onerror = () => apply(neutral);
    img.src = data.mainImage;
    return () => {
      cancelled = true;
    };
  }, [data.mainImage]);
  const gridRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const metricsRef = useRef<Metric[]>([]);
  const colWRef = useRef(0);
  const dragIdRef = useRef<string | null>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const guideLayerRef = useRef<HTMLDivElement>(null);
  const gridLinesRef = useRef<HTMLDivElement>(null);
  const hGuideRef = useRef<HTMLSpanElement>(null);
  const vGuideRef = useRef<HTMLSpanElement>(null);
  const heightRafRef = useRef<number | null>(null);
  const pendingHeightRef = useRef<{ el: HTMLDivElement; value: number } | null>(null);
  // The global pointer listeners are attached once; callbacks must use the
  // newest store action, otherwise subsequent resizes overwrite earlier ones.
  const saveLayoutRef = useRef(setMachineSubsectionLayout);
  saveLayoutRef.current = setMachineSubsectionLayout;

  // Clicking anywhere on the image or the website closes a pinned bubble.
  // Pointer buttons handle their own pin state.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (dragRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-pointer-index]")) return;
      setPinnedIdx(null);
      setHoverIdx(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // List clicks expand in place only — no reorder, no bubble.
  const selectFromList = (i: number) => {
    setListOpen((prev) => (prev === i ? null : i));
  };

  /**
   * Downloads whatever file the admin attached: a media-library entry
   * ("idb:<id>") or a plain URL. No file set → jump to the newsletter.
   */
  const downloadSheet = async () => {
    const src = (data.pdfFile ?? "").trim();
    if (!src) {
      window.location.hash = "#cta";
      return;
    }
    if (src.startsWith("idb:")) {
      const item = await getMedia(src.slice(4));
      if (!item) return;
      const a = document.createElement("a");
      a.href = item.dataUrl;
      a.download = item.name;
      a.click();
      return;
    }
    const a = document.createElement("a");
    a.href = src;
    a.download = src.split("/").pop() || "setup-sheet";
    if (/^https?:\/\//i.test(src)) {
      a.target = "_blank";
      a.rel = "noreferrer";
    }
    a.click();
  };

  // Where the bike sits on the milestone ladder: the target follows the
  // reading, so crossing a rung promotes the bike to the next one on its own.
  const odo = resolveOdometer(data.km, data.odometer?.extraMilestones);
  const odoLogged = data.odometer?.updatedAt
    ? new Date(data.odometer.updatedAt).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "";
  const indexed = spots.map((spot, idx) => ({ spot, idx }));
  // Only pointer hover/pin moves an item to the top of the list.
  const ordered =
    focusIdx === null || !indexed[focusIdx]
      ? indexed
      : [indexed[focusIdx], ...indexed.filter((o) => o.idx !== focusIdx)];
  const partsPanel: PanelBox = {
    top: data.subsectionLayout?.partsPanel?.top ?? 16,
    right: data.subsectionLayout?.partsPanel?.right ?? 16,
    bottom: data.subsectionLayout?.partsPanel?.bottom ?? 16,
    width: data.subsectionLayout?.partsPanel?.width ?? 272,
  };
  panelLayoutRef.current = partsPanel;

  const bike = (
    <div
      ref={stageRef}
      className="machine-stage panel-shadow relative min-h-[240px] overflow-hidden rounded-[2rem] border border-white/10 bg-ink-900/40"
      style={
        {
          "--parts-reserve": `${partsPanel.width + partsPanel.right + PANEL_GAP}px`,
        } as React.CSSProperties
      }
    >
      {/* Soft wash built from the photo's dominant colour — painted first so
          it sits behind the photo, pointers and list (no blurred object). */}
      <div ref={washRef} className="machine-wash pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true" />
      {/* The photo fills the block; the parts panel lives in the stage's
          right padding, so pointers are positioned against the image box. */}
      <div
        ref={imageAreaRef}
        className="machine-image-area relative w-full overflow-hidden"
      >
        <div
          className="relative will-change-transform"
          style={{
            transform: zoomed ? `scale(${MACHINE_ZOOM})` : "scale(1)",
            transformOrigin: zoomPoint ? `${zoomPoint.x}% ${zoomPoint.y}%` : "50% 50%",
            transition:
              "transform 420ms cubic-bezier(0.2, 0.75, 0.25, 1), transform-origin 180ms ease-out",
          }}
        >
      <Photo
        src={data.mainImage}
        alt={data.mainImageAlt}
        className="h-auto"
        aspect="1200 / 627"
        label="Bike photo unavailable"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950/85 via-transparent to-ink-950/25" aria-hidden />

      {spots.map((h, i) => {
        const x = clampPct(h.x);
        const y = clampPct(h.y);
        const isOn = focusIdx === i;
        // Dashboard colours: `color` tints the dot, `pulseColor` drives the
        // pulsing wave. Both fall back to gold when left empty.
        const { dot, pulse: ring } = pointerColors(h.color, h.pulseColor);
        // Same left-to-right wave as the rider map: the bike's pointers
        // ripple across the photo instead of pulsing in unison.
        const wave = waveDelay(x);
        // While the photo is magnified the pointers that are not the focus
        // settle: no pulse, and a little smaller, so the focused one reads on
        // its own — the same as the rider map's markers when zoomed.
        const dimmed = zoomed && !isOn;
        // Counter-scale by the zoom so only the pointer's position follows the
        // photo, not its size; the focused one keeps a little extra.
        const scale = (zoomed ? 1 / MACHINE_ZOOM : 1) * (dimmed ? 0.6 : 1) * (isOn ? 1.1 : 1);
        const pulse = !reduceMotion && !dimmed;
        return (
          <div
            key={`${h.title}-${i}`}
            className="absolute z-20"
            style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
            onMouseEnter={() => {
              if (dragRef.current) return;
              setHoverIdx(i);
            }}
            onMouseLeave={() => {
              if (dragRef.current) return;
              setHoverIdx((prev) => (prev === i ? null : prev));
            }}
          >
            <button
              type="button"
              data-pointer-index={i}
              onClick={() => setPinnedIdx((prev) => (prev === i ? null : i))}
              aria-pressed={pinnedIdx === i}
              aria-label={`Show ${h.title}`}
              style={{
                // Counter-scale, so the pointer keeps its size while the photo
                // magnifies underneath it.
                transform: `scale(${scale})`,
                // The pointer's own colour on the border and the crosshair;
                // the focused one picks up a glow in its pulse colour, and the
                // dimmed ones glow instead of simply fading so they stay
                // findable while the photo is zoomed in.
                borderColor: withAlpha(dot, isOn || !zoomed ? 0.9 : 0.6),
                boxShadow: dimmed
                  ? `0 0 12px ${withAlpha(ring, 0.75)}, 0 0 26px ${withAlpha(ring, 0.35)}`
                  : isOn
                    ? `0 0 18px ${withAlpha(ring, 0.55)}, 0 6px 16px rgba(0,0,0,0.5)`
                    : "0 6px 16px rgba(0,0,0,0.5)",
              }}
              className={cn(
                "grid h-8 w-8 place-items-center rounded-full border bg-ink-950/85 text-saffron-100 transition-[transform,scale,opacity] duration-[420ms] ease-out hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron-100",
                dimmed ? "opacity-70" : "opacity-100"
              )}
            >
              {pulse ? (
                <motion.span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-[-3px] rounded-full border-2"
                  style={{ borderColor: ring }}
                  animate={{ scale: [0.92, 1.5, 0.92], opacity: [0.38, 0.85, 0.38] }}
                  transition={{ duration: 1.7, repeat: Infinity, ease: "easeInOut", delay: wave }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-[-3px] rounded-full border-2"
                  style={{ borderColor: ring, opacity: 0.6 }}
                />
              )}
              <Crosshair className="relative h-3.5 w-3.5" style={{ color: dot }} aria-hidden="true" />
            </button>
          </div>
        );
      })}
        </div>

      <div className="absolute left-5 top-5 flex flex-wrap items-center gap-2">
        {/* Solid gold in both themes: the old black plate was unreadable on
            the light theme's pale bike photo. */}
        <span className="rounded-full bg-saffron-400 px-3.5 py-1.5 text-xs font-bold tracking-wide text-on-gold shadow-lg shadow-saffron-400/25 backdrop-blur-md">HANLE BLACK</span>
        <span className="rounded-full bg-ink-950/60 px-3.5 py-1.5 text-xs font-medium text-zinc-300 backdrop-blur-md">Sherpa 450 · 2024</span>
      </div>

      {/* ── Bubble, clamped inside the bike image ── */}
      <AnimatePresence>
        {bubbleIdx !== null && spots[bubbleIdx] && (
          <AccessoryBubble
            key={`${spots[bubbleIdx].title}-bubble`}
            spot={spots[bubbleIdx]}
            xPct={clampPct(spots[bubbleIdx].x)}
            yPct={clampPct(spots[bubbleIdx].y)}
            containerRef={imageAreaRef}
            onClose={() => {
              setPinnedIdx(null);
              setHoverIdx(null);
            }}
          />
        )}
      </AnimatePresence>

      <div className="absolute inset-x-5 bottom-5 z-10 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex flex-wrap items-baseline gap-x-2 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            <span className="font-urdu text-3xl sm:text-4xl" dir="rtl" lang="ur">{data.namePlate}</span>
            {data.namePlateEn && <span className="text-lg font-medium text-zinc-400 sm:text-xl">({data.namePlateEn})</span>}
          </p>
          <p className="text-xs text-zinc-400 sm:text-sm">{data.plateSub}</p>
        </div>
        <div className="rounded-2xl bg-ink-950/60 px-4 py-2.5 backdrop-blur-xl">
          <p className="font-display text-lg font-bold text-white"><CountUp to={data.km} /> <span className="text-sm font-medium text-zinc-400">km</span></p>
          <p className="text-[11px] text-zinc-500">together since Jan '24</p>
        </div>
      </div>
      </div>

      {/* On smaller screens, controls live BELOW the photo so no pointer is obscured. */}
      <div className="machine-mobile-controls flex h-16 items-center gap-2 border-t border-white/10 bg-ink-950/70 px-4">
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {spots.length === 0 && <p className="text-xs text-zinc-500">No bike pointers yet.</p>}
          {spots.map((h, i) => (
            <button
              key={`${h.title}-chip-${i}`}
              type="button"
              onClick={() => selectFromList(i)}
              aria-pressed={isExpanded(i)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors",
                isExpanded(i)
                  ? "border-saffron-400/60 bg-saffron-400/20 text-white"
                  : "border-white/15 bg-white/[0.05] text-zinc-300"
              )}
            >
              <span className="grid h-4 w-4 place-items-center rounded-full bg-white/10 text-[9px]">
                {i + 1}
              </span>
              {h.title}
            </button>
          ))}
        </div>
        {spots[listOpen ?? -1]?.link && (
          <a
            href={spots[listOpen ?? -1].link}
            target="_blank"
            rel="noreferrer"
            aria-label={`View ${spots[listOpen ?? -1].title} product`}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-saffron-400 px-3 py-2 text-[10px] font-bold text-on-gold"
          >
            Product <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* Desktop list sits in the stage's reserved right padding. */}
      <div
        ref={partsPanelRef}
        className={cn(
          "machine-list absolute z-10 min-h-0",
          admin && panelResizing && "outline outline-2 outline-saffron-400"
        )}
        style={{
          top: partsPanel.top,
          right: partsPanel.right,
          bottom: partsPanel.bottom,
          width: partsPanel.width,
        }}
      >
        <div className="machine-parts-panel panel-shadow relative isolate flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-white/15 bg-ink-950/55 backdrop-blur-md">
          <div className="machine-parts-head relative z-10 border-b border-white/10 px-4 py-3">
            <p className="machine-parts-accent text-[11px] font-semibold uppercase tracking-[0.2em] text-saffron-300">Click a part</p>
            <p className="machine-parts-muted mt-0.5 text-[10px] text-zinc-500">Or tap a + on the bike</p>
          </div>
          <div className="no-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto p-2">
            {spots.length === 0 ? (
              <p className="px-2 py-8 text-center text-xs text-zinc-500">
                No pointers yet — add them in the dashboard.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {ordered.map(({ spot: h, idx }) => {
                  const isOn = isExpanded(idx);
                  return (
                    <li key={`${h.title}-${idx}`}>
                      <button
                        type="button"
                        onClick={() => selectFromList(idx)}
                        aria-expanded={isOn}
                        className={cn(
                          "machine-parts-row flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-all duration-300",
                          isOn
                            ? "border-saffron-400/45 bg-saffron-400/10"
                            : "border-transparent hover:border-white/10 hover:bg-white/[0.05]"
                        )}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-bold text-zinc-300">
                          {idx + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block truncate font-semibold transition-all duration-300",
                              isOn ? "text-sm text-white" : "text-xs text-zinc-300"
                            )}
                          >
                            {h.title}
                          </span>
                          <span className="machine-parts-accent block truncate text-[10px] text-saffron-300">
                            {h.price}
                          </span>
                        </span>
                      </button>
                      <AnimatePresence initial={false}>
                        {isOn && (
                          <motion.div
                            key="detail"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: EASE }}
                            className="overflow-hidden"
                          >
                            <div className="machine-parts-detail px-2.5 pb-2 pt-1.5">
                              <p className="machine-parts-muted text-[11px] leading-relaxed text-zinc-400">{h.desc}</p>
                              {h.link && (
                                <a
                                  href={h.link}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="machine-parts-product mt-2 inline-flex items-center gap-1 rounded-full bg-saffron-400 px-3 py-1.5 text-[10px] font-bold text-on-gold transition-all hover:brightness-110"
                                >
                                  View product <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Admin-only four-edge resize handles for the Click a part panel. */}
          {admin && (
            <>
              <button
                type="button"
                aria-label="Resize Click a part panel from the top"
                onPointerDown={(e) => startPanelResize(e, "top")}
                className="absolute inset-x-6 top-0 z-40 h-3 touch-none cursor-ns-resize rounded-b-full bg-saffron-400/90 opacity-70 hover:opacity-100"
              />
              <button
                type="button"
                aria-label="Resize Click a part panel from the bottom"
                onPointerDown={(e) => startPanelResize(e, "bottom")}
                className="absolute inset-x-6 bottom-0 z-40 h-3 touch-none cursor-ns-resize rounded-t-full bg-saffron-400/90 opacity-70 hover:opacity-100"
              />
              <button
                type="button"
                aria-label="Resize Click a part panel from the left"
                onPointerDown={(e) => startPanelResize(e, "left")}
                className="absolute inset-y-6 left-0 z-40 w-3 touch-none cursor-ew-resize rounded-r-full bg-saffron-400/90 opacity-70 hover:opacity-100"
              />
              <button
                type="button"
                aria-label="Resize Click a part panel from the right"
                onPointerDown={(e) => startPanelResize(e, "right")}
                className="absolute inset-y-6 right-0 z-40 w-3 touch-none cursor-ew-resize rounded-l-full bg-saffron-400/90 opacity-70 hover:opacity-100"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );

  const pointerGuide = (
    <div className="flex h-full flex-col gap-5 rounded-[2rem] glass p-6 sm:p-7">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Odometer</p>
          <p className="mt-1 text-[11px] text-zinc-600">Every kilometre on the bike, logged</p>
        </div>
        <span className="shrink-0 rounded-full border border-saffron-400/30 bg-saffron-400/10 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-gold-ink">
          {odo.cleared}/{odo.ladder.length} rungs
        </span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <StretchGauge pct={odo.pct} />
        <div className="min-w-0 text-right">
          <p className="font-display text-4xl font-bold leading-none text-white sm:text-[2.75rem]">
            <CountUp to={odo.reading} />
          </p>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            km on the clock{odoLogged ? ` · logged ${odoLogged}` : ""}
          </p>
          <p className="mt-1.5 font-mono text-xs font-bold text-saffron-300">
            {odo.remaining.toLocaleString("en-IN")} km to {formatMilestone(odo.target)}
          </p>
        </div>
      </div>

      {/* Progress across the stretch the bike is riding right now. */}
      <div>
        <div className="flex items-center justify-between gap-3 text-[11px]">
          <span className="font-semibold text-zinc-300">
            {odo.from.toLocaleString("en-IN")} → {odo.target.toLocaleString("en-IN")} km
          </span>
          <span className="font-mono font-bold text-saffron-300">
            {odo.remaining.toLocaleString("en-IN")} km to go
          </span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/[0.07]">
          <motion.div
            className="h-full rounded-full bg-saffron-400"
            initial={{ width: 0 }}
            whileInView={{ width: `${odo.pct}%` }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 1.1, ease: EASE }}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          {odo.complete
            ? "Every milestone on the board is behind the bike — add the next one from the dashboard."
            : `${odo.travelled.toLocaleString("en-IN")} of ${odo.stretch.toLocaleString("en-IN")} km ridden on this stretch`}
          {` · ${odo.overallPct}% of the way to ${formatMilestone(odo.ladder[odo.ladder.length - 1]?.value ?? 0)}`}
        </p>
      </div>

      {/* The ladder: 100 km → 500 km → … → 50,000 km, then the rider's own. */}
      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-white/10 pt-4">
        {odo.ladder.map((m) => (
          <MilestoneChip key={m.value} value={m.value} state={m.state} />
        ))}
      </div>
    </div>
  );

  const specs = (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2">
      {SPECS.map((s) => <div key={s.l} className="group h-full rounded-2xl glass p-4 transition-all duration-300 hover:-translate-y-1 hover:border-white/20"><s.icon className="h-4 w-4 text-saffron-300" /><p className="mt-2.5 font-display text-lg font-bold text-white">{s.v}</p><p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{s.l}</p></div>)}
    </div>
  );

  const story = (
    <div className="flex h-full flex-col justify-between gap-6 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.05] p-7"><div><span className="grid h-11 w-11 place-items-center rounded-2xl bg-saffron-400/15 text-saffron-300"><MoonStar className="h-5 w-5" /></span><h3 className="mt-5 font-display text-xl font-semibold text-white">{data.whyTitle}</h3><p className="mt-3 text-sm leading-relaxed text-zinc-400">{data.whyText}</p></div><p className="font-mono text-[11px] tracking-[0.18em] text-zinc-500">{data.whyFoot}</p></div>
  );

  const expedition = (
    <div className="flex h-full flex-col rounded-[2rem] glass p-7"><h3 className="font-display text-xl font-semibold text-white">PB's expedition setup</h3><p className="mt-1 text-xs text-zinc-500">Every bolt earned over {data.km.toLocaleString("en-IN")} km</p><ul className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">{data.mods.map((m) => <li key={m} className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-[13px] text-zinc-300"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-saffron-400" />{m}</li>)}</ul></div>
  );

  const review = (
    <div className="flex h-full flex-col rounded-[2rem] glass p-7"><h3 className="font-display text-xl font-semibold text-white">Take <span className="font-urdu" dir="rtl" lang="ur">{data.namePlate}</span> ({data.namePlateEn}) for a spin</h3><p className="mt-1 text-xs text-zinc-500">The full review + setup sheet</p><div className="mt-5 flex flex-1 flex-col gap-3"><a href="#showreel" className="group inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-saffron-400 px-5 py-4 font-display text-sm font-semibold text-on-gold shadow-xl shadow-saffron-400/25 transition-all duration-300 hover:brightness-110 active:scale-95"><Play className="h-4 w-4 fill-current" />{data.filmCta}</a><button type="button" onClick={() => void downloadSheet()} className="group inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white/[0.06] px-5 py-4 font-display text-sm font-semibold text-white transition-all duration-300 hover:bg-white hover:text-ink-950 active:scale-95"><Download className="h-4 w-4" />{data.pdfCta}</button></div><p className="mt-4 text-center text-[11px] text-zinc-500">{data.serviceLine}</p></div>
  );

  const galleryBlocks = gallery.map(({ photo: g, sourceIndex }) => ({
    id: `gallery-${sourceIndex}`,
    label: `Gallery: ${g.cap || `Photo ${sourceIndex + 1}`}`,
    width: 4,
    content: <figure className="group relative overflow-hidden rounded-[1.75rem] border border-white/10"><Photo src={g.src} alt={g.alt} className="aspect-[16/10] w-full object-cover transition-transform duration-700 group-hover:scale-105" label="Photo unavailable" /><div className="absolute inset-0 bg-gradient-to-t from-ink-950/80 via-transparent to-transparent" aria-hidden /><figcaption className="absolute bottom-4 left-4 rounded-full bg-ink-950/60 px-3.5 py-1.5 text-xs font-medium text-white backdrop-blur-md">{g.cap}</figcaption></figure>,
  }));

  const blocks: Block[] = [
    { id: "bike-photo", label: "Bike photo & pointers", width: 12, content: bike },
    { id: "pointer-guide", label: "Odometer", width: 7, content: pointerGuide },
    { id: "specs", label: "Bike specifications", width: 5, content: specs },
    { id: "hanle-story", label: "Why Hanle Black", width: 4, content: story },
    { id: "expedition-setup", label: "Expedition setup", width: 4, content: expedition },
    { id: "review-cta", label: "Film & setup links", width: 4, content: review },
    ...galleryBlocks,
  ];
  const defaultOrder = blocks.map((b) => b.id);
  const validIds = new Set(defaultOrder);
  const savedOrder = (data.subsectionLayout?.order ?? []).filter((id) => validIds.has(id));
  const order = [...savedOrder, ...defaultOrder.filter((id) => !savedOrder.includes(id))];
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const heights = data.subsectionLayout?.heights ?? {};
  const widths = data.subsectionLayout?.widths ?? {};
  const hidden = data.subsectionLayout?.hidden ?? [];

  const persistLayout = (nextOrder: string[], nextHeights = heights, nextWidths = widths, description: string) => {
    setMachineSubsectionLayout(
      { order: nextOrder, heights: nextHeights, widths: nextWidths, hidden, partsPanel },
      description
    );
  };

  /** Child toggle inside The Machine: hides one block for visitors. */
  const toggleBlockHidden = (id: string, label: string) => {
    const nextHidden = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
    setMachineSubsectionLayout(
      { order, heights, widths, hidden: nextHidden, partsPanel },
      `${hidden.includes(id) ? "Enabled" : "Disabled"} Machine subsection: ${label}`
    );
  };

  const moveBlock = (id: string, direction: -1 | 1) => {
    const from = order.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= order.length) return;
    const next = [...order];
    [next[from], next[to]] = [next[to], next[from]];
    persistLayout(next, heights, widths, `Moved Machine subsection: ${byId.get(id)?.label ?? id}`);
  };

  const handleDrop = (targetId: string) => {
    const fromId = dragIdRef.current;
    dragIdRef.current = null;
    setDragging(null);
    setOver(null);
    if (!fromId || fromId === targetId) return;
    const next = [...order];
    const from = next.indexOf(fromId);
    const to = next.indexOf(targetId);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, fromId);
    persistLayout(next, heights, widths, `Repositioned Machine subsection: ${byId.get(fromId)?.label ?? fromId}`);
  };

  // Latest layout mirrored into a ref so the pointer handlers — attached once —
  // always commit against current values.
  const layoutRef = useRef({ order, heights, widths, hidden, partsPanel, byId });
  layoutRef.current = { order, heights, widths, hidden, partsPanel, byId };

  /**
   * Independent four-edge resize for the Click a part panel. Paint directly
   * while dragging and persist once on release, so the bike image never jitters.
   */
  useEffect(() => {
    const paintPanel = (box: PanelBox) => {
      const panel = partsPanelRef.current;
      const stage = stageRef.current;
      if (!panel || !stage) return;
      panel.style.top = `${box.top}px`;
      panel.style.right = `${box.right}px`;
      panel.style.bottom = `${box.bottom}px`;
      panel.style.width = `${box.width}px`;
      stage.style.setProperty("--parts-reserve", `${box.width + box.right + PANEL_GAP}px`);
    };

    const onMove = (event: PointerEvent) => {
      const drag = panelDragRef.current;
      const stage = stageRef.current;
      if (!drag || !stage || drag.pointerId !== event.pointerId) return;
      // Cache geometry at pointer-down; reading it after every style write
      // forces synchronous layout and was making the panel resize judder.
      const stageBox = { width: drag.stageWidth, height: drag.stageHeight };
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const next = { ...drag.start };

      if (drag.edge === "top") {
        const maxTop = Math.max(0, stageBox.height - drag.start.bottom - PANEL_MIN_H);
        next.top = Math.min(maxTop, Math.max(0, drag.start.top + dy));
      } else if (drag.edge === "bottom") {
        const maxBottom = Math.max(0, stageBox.height - drag.start.top - PANEL_MIN_H);
        next.bottom = Math.min(maxBottom, Math.max(0, drag.start.bottom - dy));
      } else if (drag.edge === "left") {
        const maxWidth = Math.max(PANEL_MIN_W, stageBox.width - drag.start.right - PANEL_GAP);
        next.width = Math.min(maxWidth, Math.max(PANEL_MIN_W, drag.start.width - dx));
      } else {
        const fixedLeft = stageBox.width - drag.start.right - drag.start.width;
        const rightEdge = Math.min(
          stageBox.width,
          Math.max(fixedLeft + PANEL_MIN_W, stageBox.width - drag.start.right + dx)
        );
        next.width = Math.max(PANEL_MIN_W, rightEdge - fixedLeft);
        next.right = Math.max(0, stageBox.width - rightEdge);
      }

      drag.latest = next;
      if (panelPaintRef.current === null) {
        panelPaintRef.current = requestAnimationFrame(() => {
          if (panelDragRef.current) paintPanel(panelDragRef.current.latest);
          panelPaintRef.current = null;
        });
      }
    };

    const finish = (cancelled: boolean, pointerId?: number) => {
      const drag = panelDragRef.current;
      if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return;
      if (panelPaintRef.current !== null) cancelAnimationFrame(panelPaintRef.current);
      panelPaintRef.current = null;
      paintPanel(drag.latest);
      panelDragRef.current = null;
      setPanelResizing(null);
      const panel = partsPanelRef.current;
      const stage = stageRef.current;
      stage?.removeAttribute("data-panel-resizing");
      const changed = JSON.stringify(drag.latest) !== JSON.stringify(drag.start);
      if (!cancelled && changed) {
        const current = layoutRef.current;
        const ok = saveLayoutRef.current(
          {
            order: current.order,
            heights: current.heights,
            widths: current.widths,
            hidden: current.hidden,
            partsPanel: drag.latest,
          },
          `Resized Click a part panel from the ${drag.edge}`
        );
        if (ok) return;
      }
      // Cancelled or failed save: return to the saved panel rectangle.
      if (panel && stage) paintPanel(drag.start);
    };

    const onUp = (event: PointerEvent) => finish(false, event.pointerId);
    const onCancel = (event: PointerEvent) => finish(true, event.pointerId);
    const onBlur = () => finish(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onBlur);
      if (panelPaintRef.current !== null) cancelAnimationFrame(panelPaintRef.current);
      panelPaintRef.current = null;
    };
  }, []);

  const startPanelResize = (event: React.PointerEvent<HTMLButtonElement>, edge: PanelEdge) => {
    if (panelDragRef.current || !window.matchMedia("(min-width: 1024px)").matches) return;
    const stage = stageRef.current;
    const panel = partsPanelRef.current;
    if (!stage || !panel) return;
    event.preventDefault();
    event.stopPropagation();
    const stageBox = stage.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    const start: PanelBox = {
      top: Math.round(panelBox.top - stageBox.top),
      right: Math.round(stageBox.right - panelBox.right),
      bottom: Math.round(stageBox.bottom - panelBox.bottom),
      width: Math.round(panelBox.width),
    };
    panelDragRef.current = {
      edge,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      start,
      latest: start,
      stageWidth: stageBox.width,
      stageHeight: stageBox.height,
    };
    setPanelResizing(edge);
    stage.setAttribute("data-panel-resizing", edge);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  /** Measure every other block once, when a drag starts. */
  const measureNeighbours = (id: string): Metric[] => {
    const grid = gridRef.current;
    if (!grid) return [];
    const g = grid.getBoundingClientRect();
    const cs = getComputedStyle(grid);
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const padTop = parseFloat(cs.paddingTop) || 0;
    const out: Metric[] = [];
    cellRefs.current.forEach((el, key) => {
      if (key === id || !el.isConnected) return;
      const r = el.getBoundingClientRect();
      if (r.height === 0) return;
      out.push({
        height: Math.round(r.height),
        bottom: Math.round(r.bottom - g.top - padTop),
        right: Math.round(r.right - g.left - padLeft),
      });
    });
    return out;
  };

  const hideGuides = () => {
    if (guideLayerRef.current) guideLayerRef.current.style.display = "none";
    if (hGuideRef.current) hGuideRef.current.style.display = "none";
    if (vGuideRef.current) vGuideRef.current.style.display = "none";
  };

  // A single window listener set reads refs, never a stale saved-site callback.
  // Width updates only when the snapped column count changes, not every pixel.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const el = cellRefs.current.get(d.id);
      if (!el) return;

      let value: number;
      let snap: number | null = null;
      if (d.mode === "h") {
        const raw = clampHeight(d.start + e.clientY - d.startClientY);
        let closest = SNAP_PX + 1;
        for (const m of metricsRef.current) {
          // Match actual bottom edges, even if the neighbour starts in another row.
          const target = m.bottom - d.top;
          const distance = Math.abs(target - raw);
          if (target >= 180 && target <= 1600 && distance <= SNAP_PX && distance < closest) {
            value = target;
            snap = m.bottom;
            closest = distance;
          }
        }
        value = snap === null ? raw : value!;
        if (d.value === value && d.snap === snap) return;
        dragRef.current = { ...d, value, snap };
        pendingHeightRef.current = { el, value };
        if (heightRafRef.current === null) {
          heightRafRef.current = requestAnimationFrame(() => {
            const pending = pendingHeightRef.current;
            if (pending?.el.isConnected) pending.el.style.height = `${pending.value}px`;
            heightRafRef.current = null;
          });
        }
        if (hGuideRef.current) {
          hGuideRef.current.style.display = snap === null ? "none" : "block";
          if (snap !== null) hGuideRef.current.style.top = `${snap}px`;
        }
      } else {
        const step = colWRef.current || 1;
        value = clampCols(d.start + Math.round((e.clientX - d.startClientX) / step));
        // Column sizes are discrete. A neighbour's right edge is the guide.
        const right = d.left + value * step - GAP;
        const match = metricsRef.current.find((m) => Math.abs(m.right - right) <= SNAP_PX);
        snap = match?.right ?? null;
        if (d.value === value && d.snap === snap) return;
        dragRef.current = { ...d, value, snap };
        el.style.gridColumn = `span ${value} / span ${value}`;
        el.dataset.cols = String(value);
        if (vGuideRef.current) {
          vGuideRef.current.style.display = snap === null ? "none" : "block";
          if (snap !== null) vGuideRef.current.style.left = `${snap}px`;
        }
      }

      el.style.outline = snap !== null ? "2px solid #34d399" : "2px solid rgba(245,179,1,0.7)";
      if (readoutRef.current) {
        readoutRef.current.textContent = `${value}${d.mode === "h" ? "px" : "/12 cols"}${snap !== null ? " · aligned" : ""}`;
        readoutRef.current.style.backgroundColor = snap !== null ? "#34d399" : "#070707";
        readoutRef.current.style.color = snap !== null ? "#070707" : "#ffdf8a";
      }
    };

    const finish = (cancelled: boolean, pointerId?: number) => {
      const d = dragRef.current;
      if (!d || (pointerId !== undefined && d.pointerId !== pointerId)) return;
      dragRef.current = null;
      if (heightRafRef.current !== null) cancelAnimationFrame(heightRafRef.current);
      heightRafRef.current = null;
      pendingHeightRef.current = null;

      const el = cellRefs.current.get(d.id);
      const {
        order: savedOrder,
        heights: savedHeights,
        widths: savedWidths,
        hidden: savedHidden,
        partsPanel: savedPartsPanel,
        byId: labels,
      } = layoutRef.current;
      const changed = d.value !== d.start;
      let saved = false;
      if (!cancelled && changed) {
        const label = labels.get(d.id)?.label ?? d.id;
        const aligned = d.snap !== null ? " · aligned to neighbour" : "";
        saved = d.mode === "h"
          ? saveLayoutRef.current(
              { order: savedOrder, heights: { ...savedHeights, [d.id]: d.value }, widths: savedWidths, hidden: savedHidden, partsPanel: savedPartsPanel },
              `Resized ${label} height to ${d.value}px${aligned}`
            )
          : saveLayoutRef.current(
              { order: savedOrder, heights: savedHeights, widths: { ...savedWidths, [d.id]: d.value }, hidden: savedHidden, partsPanel: savedPartsPanel },
              `Resized ${label} width to ${d.value}/12 columns${aligned}`
            );
      }

      if (el) {
        el.style.outline = "";
        if (d.mode === "h") {
          el.style.height = saved
            ? `${d.value}px`
            : savedHeights[d.id] ? `${savedHeights[d.id]}px` : "";
        } else {
          if (saved) {
            // Let the new responsive Tailwind class take over after React commits.
            requestAnimationFrame(() => {
              if (el.isConnected) el.style.gridColumn = "";
            });
          } else {
            el.style.gridColumn = "";
            el.dataset.cols = String(savedWidths[d.id] ?? labels.get(d.id)?.width ?? 6);
          }
        }
      }
      hideGuides();
      setResizing(null);
    };

    const onUp = (e: PointerEvent) => finish(false, e.pointerId);
    const onCancel = (e: PointerEvent) => finish(true, e.pointerId);
    const onBlur = () => finish(true);
    const onViewportResize = () => {
      if (dragRef.current?.mode === "w" && !window.matchMedia("(min-width: 1280px)").matches) {
        // A span-N width must never remain on the single-column mobile grid.
        finish(true);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onViewportResize);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onViewportResize);
      if (heightRafRef.current !== null) cancelAnimationFrame(heightRafRef.current);
      heightRafRef.current = null;
    };
  }, []);

  const startResize = (e: React.PointerEvent<HTMLButtonElement>, id: string, mode: "h" | "w") => {
    if (dragRef.current) return;
    // A span-N gridColumn on a 1-column mobile layout creates N implicit tracks.
    if (mode === "w" && !window.matchMedia("(min-width: 1280px)").matches) return;
    const el = cellRefs.current.get(id);
    const grid = gridRef.current;
    if (!el || !grid) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const left = rect.left - gridRect.left - (parseFloat(style.paddingLeft) || 0);
    const top = rect.top - gridRect.top - (parseFloat(style.paddingTop) || 0);
    const cols = clampCols(Number(el.dataset.cols || 6));
    colWRef.current = (rect.width + GAP) / cols;
    metricsRef.current = measureNeighbours(id);
    dragRef.current = mode === "h"
      ? { mode, id, pointerId: e.pointerId, top, left, startClientY: e.clientY, start: Math.round(rect.height), value: Math.round(rect.height), snap: null }
      : { mode, id, pointerId: e.pointerId, top, left, startClientX: e.clientX, start: cols, value: cols, snap: null };
    setResizing({ id, mode });
    if (guideLayerRef.current) guideLayerRef.current.style.display = "block";
    if (gridLinesRef.current) gridLinesRef.current.style.display = mode === "w" ? "block" : "none";
    if (hGuideRef.current) hGuideRef.current.style.display = "none";
    if (vGuideRef.current) vGuideRef.current.style.display = "none";
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const changeWidth = (id: string) => {
    const current = widths[id] ?? byId.get(id)?.width ?? 6;
    const nextWidth = WIDTHS[(WIDTHS.indexOf(current) + 1) % WIDTHS.length];
    const nextWidths = { ...widths, [id]: nextWidth };
    persistLayout(order, heights, nextWidths, `Changed width of Machine subsection: ${byId.get(id)?.label ?? id}`);
  };

  /** Arrow keys nudge a handle: height on the bottom bar, columns on the right bar. */
  const keyResize = (e: React.KeyboardEvent<HTMLButtonElement>, id: string, mode: "h" | "w") => {
    const positive = e.key === "ArrowDown" || e.key === "ArrowRight";
    if (mode === "h" ? e.key !== "ArrowUp" && e.key !== "ArrowDown" : e.key !== "ArrowLeft" && e.key !== "ArrowRight") {
      return;
    }
    e.preventDefault();
    if (e.repeat || dragRef.current) return;
    const label = byId.get(id)?.label ?? id;
    if (mode === "h") {
      const el = cellRefs.current.get(id);
      const current = heights[id] ?? Math.round(el?.getBoundingClientRect().height ?? 320);
      const next = clampHeight(current + (positive ? 40 : -40));
      persistLayout(order, { ...heights, [id]: next }, widths, `Resized ${label} height to ${next}px`);
    } else {
      const current = widths[id] ?? byId.get(id)?.width ?? 6;
      const next = clampCols(current + (positive ? 1 : -1));
      persistLayout(order, heights, { ...widths, [id]: next }, `Resized ${label} width to ${next}/12 columns`);
    }
  };

  return (
    <section id="machine" aria-labelledby="machine-title" className="relative scroll-mt-28 py-24 sm:py-32">
      <SectionHeader
        eyebrow={data.eyebrow}
        id="machine-title"
        title={<>{data.titleA}<span className="text-gradient font-urdu" dir="rtl" lang="ur">{data.titleHi}</span>{data.titleB}</>}
        sub={data.sub}
      />

      <div
        ref={gridRef}
        className="relative mx-auto mt-14 grid max-w-7xl grid-cols-1 items-start gap-5 px-5 sm:px-8 md:grid-cols-2 lg:grid-cols-12"
      >
        {order.map((id, index) => {
          const block = byId.get(id);
          if (!block) return null;
          // The composite block starts full-width, but supports bottom/right
          // resizing like the rest of the layout.
          // Parent/child rule: a disabled block disappears for visitors, while
          // the admin still sees it dimmed so it can be switched back on.
          const isHidden = hidden.includes(id);
          if (isHidden && !admin) return null;
          const isH = resizing?.mode === "h" && resizing.id === id;
          const isW = resizing?.mode === "w" && resizing.id === id;
          const isResizing = isH || isW;
          const cols = clampCols(widths[id] ?? block.width);
          const height = heights[id];
          return (
            <motion.div
              key={id}
              ref={(el) => {
                if (el) cellRefs.current.set(id, el);
                else cellRefs.current.delete(id);
              }}
              layout={resizing || panelResizing ? false : "position"}
              data-machine-block={id}
              data-cols={cols}
              onDragOver={(e) => { if (!admin || !dragIdRef.current) return; e.preventDefault(); setOver(id); }}
              onDragLeave={() => setOver((prev) => prev === id ? null : prev)}
              onDrop={(e) => { e.preventDefault(); handleDrop(id); }}
              transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.75 }}
              className={cn(
                "relative min-w-0 rounded-[2rem]",
                SPAN_CLASS[cols] ?? "xl:col-span-6",
                admin && "outline outline-1 outline-dashed outline-transparent",
                admin && over === id && "outline-2 outline-saffron-400",
                admin && dragging === id && "opacity-50",
                admin && isHidden && "opacity-40 saturate-50",
                admin && isResizing && "z-30",
                admin && isResizing && "outline-2 outline-saffron-400/70"
              )}
              style={height ? { height } : undefined}
            >
              {/*
                Body scrolls inside the cell. Keeping overflow off the resized
                element is what stops the content shuffling while dragging.
              */}
              <div className="h-full overflow-y-auto overflow-x-hidden rounded-[2rem] [scrollbar-gutter:stable]">
                {block.content}
              </div>
              {admin && (
                <div className="absolute right-2 top-2 z-40 flex items-center gap-1 rounded-full border border-white/10 bg-ink-950/95 p-1 shadow-xl backdrop-blur-md">
                  <span
                    draggable
                    onDragStart={(e) => {
                      dragIdRef.current = id;
                      setDragging(id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", id);
                    }}
                    onDragEnd={() => { dragIdRef.current = null; setDragging(null); setOver(null); }}
                    title="Drag this subsection anywhere inside The Machine"
                    className="grid h-7 w-7 cursor-grab touch-none place-items-center rounded-full text-saffron-300 hover:bg-white/10 active:cursor-grabbing"
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </span>
                  <span className="max-w-32 truncate px-1 text-[10px] font-semibold text-zinc-300">{block.label}</span>
                  <button
                    type="button"
                    onClick={() => toggleBlockHidden(id, block.label)}
                    aria-pressed={!isHidden}
                    aria-label={`${isHidden ? "Enable" : "Disable"} ${block.label}`}
                    title={isHidden ? "Hidden from visitors — click to enable" : "Visible — click to disable"}
                    className={cn(
                      "grid h-7 w-7 place-items-center rounded-full hover:bg-white/10",
                      isHidden ? "text-red-400" : "text-emerald-400"
                    )}
                  >
                    {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                  <button type="button" onClick={() => moveBlock(id, -1)} disabled={index === 0} aria-label={`Move ${block.label} earlier`} title="Move earlier" className="grid h-7 w-7 place-items-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
                  <button type="button" onClick={() => moveBlock(id, 1)} disabled={index === order.length - 1} aria-label={`Move ${block.label} later`} title="Move later" className="grid h-7 w-7 place-items-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
                  <button type="button" onClick={() => changeWidth(id)} aria-label={`Change ${block.label} width`} title={`Width: ${cols}/12 columns — cycle width`} className="grid h-7 w-7 place-items-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white"><MoveHorizontal className="h-3 w-3" /></button>
                  {height && <button type="button" onClick={() => persistLayout(order, Object.fromEntries(Object.entries(heights).filter(([k]) => k !== id)), widths, `Reset size of Machine subsection: ${block.label}`)} aria-label={`Reset ${block.label} height`} title="Reset height to auto" className="grid h-7 w-7 place-items-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white"><RotateCcw className="h-3 w-3" /></button>}
                </div>
              )}

              {/* live readout while dragging */}
              {admin && isResizing && (
                <div className="pointer-events-none absolute left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2">
                  <span
                    ref={readoutRef}
                    className="rounded-full bg-ink-950/90 px-3.5 py-1.5 font-mono text-xs font-bold text-saffron-300 shadow-2xl backdrop-blur-md"
                  >
                    {isH ? `${dragRef.current?.value ?? height ?? 0}px` : `${dragRef.current?.value ?? cols}/12 cols`}
                  </span>
                </div>
              )}

              {/* bottom handle — height */}
              {admin && (
                <button
                  type="button"
                  aria-label={`Resize ${block.label} height. Drag the bar, or use the up and down arrow keys.`}
                  title={`Resize height${height ? ` · ${height}px` : ""}`}
                  onPointerDown={(e) => startResize(e, id, "h")}
                  onKeyDown={(e) => keyResize(e, id, "h")}
                  className={cn(
                    "absolute bottom-0 left-1/2 z-40 h-3 w-44 max-w-[70%] -translate-x-1/2 touch-none cursor-ns-resize rounded-t-full bg-saffron-400 shadow-lg shadow-saffron-400/30 transition-all hover:h-4 focus-visible:h-4",
                    isH && "h-4 brightness-125"
                  )}
                />
              )}

              {/* right handle — width */}
              {admin && (
                <button
                  type="button"
                  aria-label={`Resize ${block.label} width. Drag the bar, or use the left and right arrow keys.`}
                  title={`Resize width · ${cols}/12 columns`}
                  onPointerDown={(e) => startResize(e, id, "w")}
                  onKeyDown={(e) => keyResize(e, id, "w")}
                  className={cn(
                    "absolute right-0 top-1/2 z-40 hidden h-28 w-3 -translate-y-1/2 touch-none cursor-ew-resize rounded-l-full bg-saffron-400 shadow-lg shadow-saffron-400/30 transition-all hover:w-4 focus-visible:w-4 xl:block",
                    isW && "w-4 brightness-125"
                  )}
                />
              )}
            </motion.div>
          );
        })}

        {/* Hidden until a resize begins. Guides update in the DOM, not by
            rendering the whole Machine grid on every pointer event. */}
        {admin && (
          <div
            ref={guideLayerRef}
            className="pointer-events-none absolute inset-0 z-[45] px-5 sm:px-8"
            style={{ display: "none" }}
            aria-hidden
          >
            <div className="relative h-full w-full">
              <div ref={gridLinesRef} className="absolute inset-0" style={{ display: "none" }}>
                {Array.from({ length: 11 }).map((_, i) => (
                  <span
                    key={`col-${i}`}
                    className="absolute bottom-0 top-0 w-px bg-saffron-400/20"
                    style={{ left: `${((i + 1) / 12) * 100}%` }}
                  />
                ))}
              </div>
              <span
                ref={hGuideRef}
                className="absolute inset-x-0 h-px bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.9)]"
                style={{ display: "none" }}
              >
                <span className="absolute -top-6 right-0 rounded-full bg-emerald-400 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-ink-950">
                  Height aligned
                </span>
              </span>
              <span
                ref={vGuideRef}
                className="absolute bottom-0 top-0 w-px bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.9)]"
                style={{ display: "none" }}
              >
                <span className="absolute -top-1 left-2 rounded-full bg-emerald-400 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-ink-950">
                  Column aligned
                </span>
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}