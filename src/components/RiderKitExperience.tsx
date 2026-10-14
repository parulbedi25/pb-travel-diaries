import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Check, Crosshair, ShieldCheck, X } from "lucide-react";
import { isOn } from "../utils/enabled";
import { type GearItem, type RiderKitData, type RiderKitPointer } from "../store/siteContent";
import { cn } from "../utils/cn";
import { pointerColors, waveDelay, withAlpha } from "../utils/pointerColors";
import { externalLinkProps } from "./ui/SocialIcons";
import { EASE, Reveal, SectionHeader } from "./ui/motion";
import Photo from "./ui/Photo";

type BodyZone = "head" | "torso" | "hands" | "waist" | "legs" | "feet";
type PercentPoint = { x: number; y: number };
type GearEntry = { item: GearItem; index: number; zone: BodyZone };
type MapPointer = { pointer: RiderKitPointer; focusZone: BodyZone; entry: GearEntry; point: PercentPoint; label: string; radius: number };

const ZONE_LABELS: Record<BodyZone, string> = {
  head: "Head & helmet",
  torso: "Torso",
  hands: "Hands",
  waist: "Waist / hip",
  legs: "Legs",
  feet: "Feet",
};

/** How far the rider photo magnifies when a gear zone takes focus. */
const RIDER_ZOOM = 1.65;

const ZONE_ZOOM_POINTS: Record<BodyZone, PercentPoint> = {
  head: { x: 50, y: 16 },
  torso: { x: 50, y: 40 },
  hands: { x: 50, y: 67 },
  waist: { x: 61, y: 57 },
  legs: { x: 50, y: 71 },
  feet: { x: 50, y: 91 },
};

function inferZone(raw: string): BodyZone | null {
  const value = raw.toLocaleLowerCase();
  if (/head|helmet|visor|eyewear|goggle|intercom|communicator|sena/.test(value)) return "head";
  if (/hand|glove|wrist/.test(value)) return "hands";
  if (/foot|feet|boot|shoe/.test(value)) return "feet";
  if (/waist|hip|sling.?bag|cross.?body|belt.?bag/.test(value)) return "waist";
  if (/leg|trouser|pant|legging|knee/.test(value)) return "legs";
  if (/torso|upper.?body|chest|jacket|vest|shirt|body armor|body armour|backpack/.test(value)) return "torso";
  return null;
}

function zoneFor(item: GearItem): BodyZone {
  // An explicit dashboard zone wins; otherwise infer it from the product name/category.
  return inferZone(item.bodyPart?.trim() ?? "")
    ?? inferZone(`${item.category ?? ""} ${item.name ?? ""}`)
    ?? "torso";
}

function itemTitle(item: GearItem): string {
  return item.name?.trim() || [item.brand, item.model].filter(Boolean).join(" ") || "Gear item";
}

function itemHighlights(item: GearItem): string[] {
  return Array.isArray(item.highlights)
    ? item.highlights.map((highlight) => highlight?.trim()).filter((highlight): highlight is string => Boolean(highlight)).slice(0, 4)
    : [];
}

function itemSpecs(item: GearItem): string[] {
  const fallbacks = [
    item.fit?.trim() ? `Fit · ${item.fit.trim()}` : "",
    item.usedFor?.trim() ? `Use · ${item.usedFor.trim()}` : "",
    item.model?.trim() ? `Model · ${item.model.trim()}` : "",
    item.category?.trim() ? `Category · ${item.category.trim()}` : "",
  ];
  return [...itemHighlights(item), ...fallbacks].filter(Boolean).slice(0, 2);
}

function GearProductBubble({
  item,
  point,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: {
  item: GearItem;
  point: PercentPoint;
  onClose: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const specs = itemSpecs(item);
  const title = itemTitle(item);
  return (
    <motion.aside
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={{ duration: 0.24, ease: EASE }}
      className={cn(
        "gear-product-bubble rounded-2xl border border-white/15 bg-ink-950/95 shadow-2xl shadow-black/70 backdrop-blur-xl",
        point.x > 50 ? "gear-product-bubble--left" : "gear-product-bubble--right"
      )}
      style={{ "--gear-point-x": `${point.x}%`, "--gear-point-y": `${point.y}%` } as CSSProperties}
      role="dialog"
      aria-label={`${title} details`}
      onPointerEnter={(event) => {
        event.stopPropagation();
        onPointerEnter();
      }}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerLeave={(event) => {
        event.stopPropagation();
        onPointerLeave();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start gap-3 p-3">
        {item.image ? (
          <Photo src={item.image} alt={item.imageAlt || title} aspect="1 / 1" className="h-16 w-16 shrink-0 rounded-xl border border-white/10 bg-white object-contain" label="Product photo" />
        ) : (
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-saffron-300"><ShieldCheck className="h-5 w-5" /></div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="line-clamp-2 font-display text-sm font-semibold leading-snug text-white">{title}</p>
              <p className="mt-1 truncate text-[10px] uppercase tracking-[0.12em] text-zinc-500">{item.brand || item.category}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close gear details"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-zinc-400 transition hover:bg-white/20 hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <p className="mt-1.5 font-mono text-xs font-bold text-saffron-300">{item.price?.trim() || "Price not listed"}</p>
        </div>
      </div>
      <div className="border-t border-white/[0.08] px-3 pb-3 pt-2.5">
        <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Key specs</p>
        {specs.length ? (
          <ul className="grid gap-1.5">
            {specs.map((spec, index) => (
              <li key={`${spec}-${index}`} className="flex items-start gap-1.5 text-[10px] leading-snug text-zinc-300">
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-saffron-300" aria-hidden="true" /> {spec}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[10px] text-zinc-500">Add product specs in Dashboard → The Gear.</p>
        )}
        {item.link?.trim() ? (
          <a
            href={item.link.trim()}
            {...externalLinkProps(item.link)}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-saffron-400 px-3 py-2 text-[10px] font-bold text-on-gold transition hover:brightness-110"
          >
            Buy this gear <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : (
          <p className="mt-3 rounded-xl bg-white/[0.05] px-3 py-2 text-center text-[10px] text-zinc-500">Product buy link not set</p>
        )}
      </div>
    </motion.aside>
  );
}

export default function RiderKitExperience({ data }: { data: RiderKitData }) {
  const reduceMotion = useReducedMotion();
  const productOrder = new Map<string, number>();
  (Array.isArray(data.mapPointers) ? data.mapPointers : []).forEach((pointer, pointerIndex) => {
    if (pointer.gearId && !productOrder.has(pointer.gearId)) productOrder.set(pointer.gearId, pointerIndex);
  });
  const entries: GearEntry[] = Array.isArray(data.items)
    ? data.items
        .map((item, index) => ({ item, index, zone: zoneFor(item) }))
        .filter(({ item }) => Boolean(item) && isOn(item))
        .sort((a, b) => {
          const aOrder = productOrder.get(a.item.id ?? "") ?? Number.POSITIVE_INFINITY;
          const bOrder = productOrder.get(b.item.id ?? "") ?? Number.POSITIVE_INFINITY;
          return aOrder - bOrder || a.index - b.index;
        })
    : [];

  const primaryByZone = new Map<BodyZone, GearEntry>();
  for (const entry of entries) {
    const current = primaryByZone.get(entry.zone);
    const entryHasSuppliedPhoto = entry.item.image?.startsWith("/images/gear/") ?? false;
    const currentHasSuppliedPhoto = current?.item.image?.startsWith("/images/gear/") ?? false;
    // For a zone with several pieces, prefer the attached product photo as the map's primary match.
    if (!current || (entryHasSuppliedPhoto && !currentHasSuppliedPhoto)) primaryByZone.set(entry.zone, entry);
  }
  const intercomEntry = entries.find(({ item }) => /intercom|sena\s*50s?/i.test(`${item.category} ${item.name}`));
  const bodyZones: BodyZone[] = ["head", "torso", "hands", "waist", "legs", "feet"];
  const clampPercent = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const mapPointerEntries: MapPointer[] = (Array.isArray(data.mapPointers) ? data.mapPointers : [])
    .filter((pointer) => isOn(pointer))
    .flatMap((pointer) => {
      const focusZone: BodyZone = pointer.zone === "intercom" ? "head" : pointer.zone;
      if (!bodyZones.includes(focusZone)) return [];
      const linkedEntry = pointer.gearId ? entries.find((candidate) => candidate.item.id === pointer.gearId) : undefined;
      const entry = linkedEntry ?? (pointer.zone === "intercom" ? intercomEntry : primaryByZone.get(focusZone));
      if (!entry) return [];
      const radius = Math.max(4, Math.min(30, Number(pointer.radius) || 12));
      return [{
        pointer,
        focusZone,
        entry,
        point: { x: clampPercent(Number(pointer.x)), y: clampPercent(Number(pointer.y)) },
        label: pointer.label?.trim() || ZONE_LABELS[focusZone],
        radius,
      }];
    });
  const mapPointerAtPoint = (point: PercentPoint) => {
    let nearest: MapPointer | undefined;
    let nearestDistance = Infinity;
    for (const pointer of mapPointerEntries) {
      const dx = (point.x - pointer.point.x) / pointer.radius;
      const dy = (point.y - pointer.point.y) / (pointer.radius * 1.3);
      const distance = dx * dx + dy * dy;
      if (distance <= 1 && distance < nearestDistance) {
        nearest = pointer;
        nearestDistance = distance;
      }
    }
    return nearest;
  };
  const zoomTargetFor = (entry: GearEntry, pointer: PercentPoint) => {
    const relatedPointers = mapPointerEntries.filter((candidate) => candidate.entry.index === entry.index);
    if (relatedPointers.length === 0) return ZONE_ZOOM_POINTS[entry.zone];
    return relatedPointers.reduce((nearest, candidate) => {
      const d = Math.hypot(pointer.x - candidate.point.x, pointer.y - candidate.point.y);
      const best = Math.hypot(pointer.x - nearest.point.x, pointer.y - nearest.point.y);
      return d < best ? candidate : nearest;
    }).point;
  };
  const [mapHoveredIndex, setMapHoveredIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const [listHoveredIndex, setListHoveredIndex] = useState<number | null>(null);
  const [listSelectedIndex, setListSelectedIndex] = useState<number | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [zoomPoint, setZoomPoint] = useState<PercentPoint | null>(null);
  const listHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (listHoverTimer.current) clearTimeout(listHoverTimer.current);
  }, []);

  const mapFocusIndex = mapHoveredIndex ?? pinnedIndex;
  const mapFocusedEntry = mapFocusIndex === null ? undefined : entries.find((entry) => entry.index === mapFocusIndex);
  const bubbleIndex = mapHoveredIndex ?? listHoveredIndex ?? listSelectedIndex ?? pinnedIndex;
  const bubbleEntry = bubbleIndex === null ? undefined : entries.find((entry) => entry.index === bubbleIndex);
  const pointForEntry = (entry: GearEntry) =>
    mapPointerEntries.find((pointer) => pointer.entry.index === entry.index)?.point ?? ZONE_ZOOM_POINTS[entry.zone];
  const bubblePoint = bubbleEntry ? zoomPoint ?? pointForEntry(bubbleEntry) : null;
  const zoomed = Boolean(zoomPoint && bubbleEntry);
  const sameZoneEntries = mapFocusedEntry ? entries.filter((entry) => entry.zone === mapFocusedEntry.zone) : [];
  const orderedEntries = mapFocusedEntry
    ? [
        mapFocusedEntry,
        ...sameZoneEntries.filter((entry) => entry.index !== mapFocusedEntry.index),
        ...entries.filter((entry) => entry.zone !== mapFocusedEntry.zone),
      ]
    : entries;
  const isExpanded = (index: number) =>
    mapFocusedEntry ? mapFocusedEntry.index === index : openIndex === index;

  const cancelListHoverClear = () => {
    if (listHoverTimer.current) clearTimeout(listHoverTimer.current);
    listHoverTimer.current = null;
  };
  const focusListEntry = (index: number) => {
    const entry = entries.find((candidate) => candidate.index === index);
    if (!entry) return;
    cancelListHoverClear();
    setListHoveredIndex(index);
    setMapHoveredIndex(null);
    setPinnedIndex(null);
    setZoomPoint(pointForEntry(entry));
  };
  const scheduleListHoverClear = (index: number) => {
    cancelListHoverClear();
    listHoverTimer.current = setTimeout(() => {
      setListHoveredIndex((current) => current === index ? null : current);
      setZoomPoint((current) => listSelectedIndex === null && pinnedIndex === null && mapHoveredIndex === null ? null : current);
      listHoverTimer.current = null;
    }, 300);
  };
  const dismissBubble = () => {
    cancelListHoverClear();
    setMapHoveredIndex(null);
    setPinnedIndex(null);
    setListHoveredIndex(null);
    setListSelectedIndex(null);
    setOpenIndex(null);
    setZoomPoint(null);
  };

  const clearMapHover = (index: number) => {
    setMapHoveredIndex((current) => (current === index ? null : current));
  };
  const focusMapEntry = (index: number, point?: PercentPoint) => {
    const entry = entries.find((candidate) => candidate.index === index);
    if (!entry) return;
    cancelListHoverClear();
    setListHoveredIndex(null);
    setListSelectedIndex(null);
    setMapHoveredIndex(index);
    setZoomPoint(point ?? pointForEntry(entry));
  };
  const togglePin = (index: number, point?: PercentPoint) => {
    const entry = entries.find((candidate) => candidate.index === index);
    const wasPinned = pinnedIndex === index;
    cancelListHoverClear();
    setPinnedIndex(wasPinned ? null : index);
    setMapHoveredIndex(null);
    setListHoveredIndex(null);
    setListSelectedIndex(null);
    setZoomPoint(wasPinned ? null : (point ?? (entry ? pointForEntry(entry) : null)));
  };
  const toggleOpen = (index: number) => {
    const entry = entries.find((candidate) => candidate.index === index);
    const willOpen = openIndex !== index;
    cancelListHoverClear();
    setOpenIndex(willOpen ? index : null);
    setPinnedIndex(null);
    setMapHoveredIndex(null);
    setListSelectedIndex(willOpen ? index : null);
    if (willOpen || listHoveredIndex === index) setZoomPoint(entry ? pointForEntry(entry) : null);
    else setZoomPoint(null);
  };
  const handleMapPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: Math.max(0, Math.min(100, Math.round(((event.clientX - rect.left) / rect.width) * 100))),
      y: Math.max(0, Math.min(100, Math.round(((event.clientY - rect.top) / rect.height) * 100))),
    };
    const mapPointer = mapPointerAtPoint(point);
    if (mapPointer) {
      cancelListHoverClear();
      setListHoveredIndex(null);
      setListSelectedIndex(null);
      setMapHoveredIndex((current) => current === mapPointer.entry.index ? current : mapPointer.entry.index);
      setZoomPoint(zoomTargetFor(mapPointer.entry, point));
    } else {
      setMapHoveredIndex(null);
      const fallbackIndex = pinnedIndex ?? listSelectedIndex ?? listHoveredIndex;
      const fallbackEntry = entries.find((entry) => entry.index === fallbackIndex);
      const fallbackPointer = mapPointerEntries.find((candidate) => candidate.entry.index === fallbackIndex);
      setZoomPoint(fallbackPointer?.point ?? (fallbackEntry ? pointForEntry(fallbackEntry) : null));
    }
  };
  const handleMapClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-zone-keyboard]") || entries.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    };
    const mapPointer = mapPointerAtPoint(point);
    if (mapPointer) togglePin(mapPointer.entry.index, zoomTargetFor(mapPointer.entry, point));
  };
  const handleMapPointerLeave = () => {
    setMapHoveredIndex(null);
    const fallbackIndex = pinnedIndex ?? listSelectedIndex ?? listHoveredIndex;
    const fallbackEntry = entries.find((entry) => entry.index === fallbackIndex);
    const fallbackPointer = mapPointerEntries.find((candidate) => candidate.entry.index === fallbackIndex);
    setZoomPoint(fallbackPointer?.point ?? (fallbackEntry ? pointForEntry(fallbackEntry) : null));
  };

  return (
    <section id="riderkit" aria-labelledby="riderkit-title" className="relative scroll-mt-28 overflow-hidden py-24 sm:py-32">
      <div
        className="pointer-events-none absolute right-[-10rem] top-16 h-96 w-96 rounded-full bg-saffron-400/[0.07] blur-[130px]"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeader
          eyebrow={data.eyebrow}
          id="riderkit-title"
          title={<>{data.titleA}<span className="text-gradient">{data.titleHi}</span>{data.titleB}</>}
          sub={data.sub}
        />

        <div className="mt-12 grid items-start gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)] xl:gap-7">
          <Reveal>
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-ink-900/60 p-2.5 shadow-2xl shadow-black/25 sm:p-3">
              <div
                className="relative mx-auto aspect-[2/3] w-full max-w-[34rem] cursor-zoom-in overflow-hidden rounded-[1.55rem] bg-ink-950"
                role="group"
                aria-label="The Gear interactive rider map. Hover or select a product to zoom to its gear zone."
                onPointerMove={handleMapPointerMove}
                onPointerLeave={handleMapPointerLeave}
                onClick={handleMapClick}
              >
                <div
                  className="absolute inset-0 will-change-transform"
                  style={{
                    transform: zoomed ? `scale(${RIDER_ZOOM})` : "scale(1)",
                    transformOrigin: zoomed && zoomPoint ? `${zoomPoint.x}% ${zoomPoint.y}%` : "50% 50%",
                    transition: "transform 420ms cubic-bezier(0.2, 0.75, 0.25, 1), transform-origin 180ms ease-out",
                  }}
                >
                  <Photo
                    src={data.image}
                    alt={data.imageAlt || "Illustrative rider wearing motorcycle touring gear"}
                    aspect="2 / 3"
                    className="absolute inset-0 h-full w-full object-cover"
                    label="Rider image unavailable"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink-950/35 via-transparent to-ink-950/60" aria-hidden="true" />

                  {/*
                    Markers live inside the zoom layer so they stay pinned to the
                   gear they mark while the photo magnifies. Each one counter-
                    scales by 1/zoom, so only its position follows the photo —
                    its size stays put. While zoomed the unfocused markers fade
                    and shrink, and only the focused one keeps pulsing.
                  */}
                  {mapPointerEntries.map(({ pointer, entry, point, label }, markerIndex) => {
                    const focused = bubbleIndex === entry.index;
                    const dimmed = zoomed && !focused;
                    const scale = (zoomed ? 1 / RIDER_ZOOM : 1) * (dimmed ? 0.6 : 1);
                    const pulse = !reduceMotion && !dimmed;
                    // Dashboard colours: `color` tints the pointer itself,
                    // `pulseColor` drives the ring. Both fall back to gold.
                    const { dot, pulse: ring } = pointerColors(pointer.color, pointer.pulseColor);
                    // Staggered by horizontal position → the pointers ripple
                    // from the left of the rider across to the right.
                    const wave = waveDelay(point.x);
                    return (
                      <div
                        key={`marker-${pointer.id}-${entry.index}-${markerIndex}`}
                        className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
                        style={{ left: `${point.x}%`, top: `${point.y}%` }}
                      >
                        <button
                          type="button"
                          aria-label={`Focus ${itemTitle(entry.item)} at ${label}`}
                          aria-pressed={pinnedIndex === entry.index}
                          title={`${label} · ${itemTitle(entry.item)}`}
                          onFocus={() => focusMapEntry(entry.index, point)}
                          onBlur={() => {
                            clearMapHover(entry.index);
                            setZoomPoint(pinnedIndex === entry.index ? point : null);
                          }}
                          onPointerEnter={() => {
                            if (!focused) focusMapEntry(entry.index, point);
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            togglePin(entry.index, point);
                          }}
                          style={{
                            transform: `scale(${scale})`,
                            // Unfocused pointers glow instead of simply fading,
                            // so they stay findable while the map is zoomed in.
                            borderColor: withAlpha(dot, focused || !zoomed ? 0.9 : 0.6),
                            boxShadow: dimmed
                              ? `0 0 12px ${withAlpha(ring, 0.75)}, 0 0 26px ${withAlpha(ring, 0.35)}`
                              : focused
                                ? `0 0 18px ${withAlpha(ring, 0.55)}, 0 6px 16px rgba(0,0,0,0.5)`
                                : "0 6px 16px rgba(0,0,0,0.5)",
                          }}
                          className={cn(
                            "grid h-8 w-8 place-items-center rounded-full border bg-ink-950/85 text-saffron-100 transition-[transform,scale,opacity] duration-[420ms] ease-out hover:scale-110 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron-100",
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
                          <Crosshair
                            className="relative h-3.5 w-3.5"
                            style={{ color: dot }}
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="pointer-events-none absolute left-4 top-4 z-10 inline-flex items-center gap-2 rounded-full border border-white/15 bg-ink-950/70 px-3.5 py-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-200 backdrop-blur-md sm:left-5 sm:top-5">
                  <span className="h-1.5 w-1.5 rounded-full bg-saffron-300 shadow-[0_0_10px_rgba(255,196,66,0.8)]" />
                  Illustrative rider · hover to explore
                </div>

                <AnimatePresence>
                  {bubbleEntry && bubblePoint && (
                    <GearProductBubble
                      key={`gear-bubble-${bubbleEntry.index}`}
                      item={bubbleEntry.item}
                      point={bubblePoint}
                      onClose={dismissBubble}
                      onPointerEnter={cancelListHoverClear}
                      onPointerLeave={() => scheduleListHoverClear(bubbleEntry.index)}
                    />
                  )}
                </AnimatePresence>

                <div className="sr-only" data-zone-keyboard role="group" aria-label="Keyboard controls for rider gear zones">
                  {mapPointerEntries.map(({ pointer, entry, point, label }) => (
                    <button
                      key={`keyboard-${pointer.id}-${entry.index}`}
                      type="button"
                      aria-label={`Focus ${label}: ${itemTitle(entry.item)}`}
                      aria-pressed={pinnedIndex === entry.index}
                      onFocus={() => focusMapEntry(entry.index, point)}
                      onBlur={() => {
                        clearMapHover(entry.index);
                        setZoomPoint(pinnedIndex === entry.index ? point : null);
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        togglePin(entry.index, point);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {entries.length === 0 && (
                  <div className="absolute inset-x-5 bottom-6 rounded-2xl border border-white/10 bg-ink-950/75 p-4 text-center text-xs leading-relaxed text-zinc-400 backdrop-blur-md">
                    Add a product to the Dashboard → The Gear pointer list to build the interactive map.
                  </div>
                )}
              </div>
              <p className="flex items-center justify-center gap-2 px-3 pb-1 pt-4 text-center text-[10px] text-zinc-500">
                <Crosshair className="h-3.5 w-3.5 text-saffron-300" aria-hidden="true" /> Hover a pointer or product row to zoom in and reveal gear details.
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.025] shadow-2xl shadow-black/20">
              <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] px-5 py-5 sm:px-6">
                <div>
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-saffron-300">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Gear by body zone
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">Hover or click a product to zoom the rider and reveal its image, specs and price</p>
                </div>
                <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 font-mono text-[10px] text-zinc-400">
                  {entries.length} {entries.length === 1 ? "piece" : "pieces"}
                </span>
              </div>

              <div className="no-scrollbar max-h-[54rem] overflow-y-auto p-3 sm:p-4">
                {entries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/15 px-5 py-12 text-center">
                    <ShieldCheck className="mx-auto h-6 w-6 text-saffron-300/70" aria-hidden="true" />
                    <p className="mt-3 text-sm font-semibold text-white">No gear items to map yet</p>
                    <p className="mt-1 text-xs text-zinc-500">Add products from Dashboard → Sections → The Gear → Add product.</p>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {orderedEntries.map(({ item, index, zone }, orderIndex) => {
                      const expanded = isExpanded(index);
                      const mapFocused = mapFocusedEntry?.index === index;
                      const highlights = itemHighlights(item);
                      const maker = [item.brand, item.model].map((value) => value?.trim()).filter(Boolean).join(" · ");
                      const title = itemTitle(item);
                      const zoneName = item.bodyPart?.trim() || ZONE_LABELS[zone];
                      return (
                        <li key={`${title}-${index}`}>
                          <button
                            type="button"
                            aria-expanded={expanded}
                            onPointerEnter={(event) => {
                              if (event.pointerType !== "touch") focusListEntry(index);
                            }}
                            onPointerLeave={() => scheduleListHoverClear(index)}
                            onFocus={() => focusListEntry(index)}
                            onBlur={() => scheduleListHoverClear(index)}
                            onClick={() => toggleOpen(index)}
                            className={cn(
                              "relative flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all duration-200",
                              expanded
                                ? "border-saffron-300/35 bg-saffron-300/[0.08]"
                                : "border-white/[0.06] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.045]"
                            )}
                          >
                            {mapFocused && (
                              <motion.span
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-0 rounded-2xl border border-saffron-200/70"
                                animate={reduceMotion ? undefined : { opacity: [0.25, 0.85, 0.25], scale: [0.99, 1.005, 0.99] }}
                                transition={reduceMotion ? undefined : { duration: 1.7, repeat: Infinity, ease: "easeInOut" }}
                              />
                            )}
                            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white">
                              {item.image ? (
                                <Photo src={item.image} alt={item.imageAlt || title} className="h-full w-full object-contain" label="Gear photo" />
                              ) : (
                                <div className="grid h-full place-items-center text-saffron-300/70"><ShieldCheck className="h-5 w-5" /></div>
                              )}
                            </div>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-saffron-300/80">{zoneName}</span>
                                {item.category && <span className="text-[9px] text-zinc-600">· {item.category}</span>}
                              </span>
                              <span className={cn("mt-1 block truncate font-display font-semibold", expanded ? "text-sm text-white" : "text-xs text-zinc-300")}>
                                {title}
                              </span>
                              {maker && <span className="mt-0.5 block truncate text-[10px] text-zinc-500">{maker}</span>}
                            </span>
                            <span className="shrink-0 text-right">
                              {item.price?.trim() && <span className="block font-mono text-[10px] font-semibold text-saffron-200">{item.price}</span>}
                              <span className="mt-1 block text-[9px] text-zinc-600">{expanded ? "DETAILS" : String(orderIndex + 1).padStart(2, "0")}</span>
                            </span>
                          </button>

                          <AnimatePresence initial={false}>
                            {expanded && (
                              <motion.div
                                key="detail"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.28, ease: EASE }}
                                className="overflow-hidden"
                              >
                                <div className="ml-4 border-l border-saffron-300/25 px-4 pb-3 pt-3 sm:ml-6 sm:px-5">
                                  {item.description?.trim() && <p className="text-xs leading-relaxed text-zinc-400">{item.description}</p>}
                                  {(item.fit?.trim() || item.usedFor?.trim()) && (
                                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                      {item.fit?.trim() && <p className="text-[10px] leading-relaxed text-zinc-400"><span className="mr-1.5 font-mono uppercase tracking-[0.14em] text-zinc-600">Fit</span>{item.fit}</p>}
                                      {item.usedFor?.trim() && <p className="text-[10px] leading-relaxed text-zinc-400"><span className="mr-1.5 font-mono uppercase tracking-[0.14em] text-zinc-600">Use</span>{item.usedFor}</p>}
                                    </div>
                                  )}
                                  {highlights.length > 0 && (
                                    <ul className="mt-3 flex flex-wrap gap-1.5">
                                      {highlights.map((highlight, hi) => (
                                        <li key={`${highlight}-${hi}`} className="inline-flex items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.035] px-2.5 py-1 text-[9px] text-zinc-300">
                                          <Check className="h-2.5 w-2.5 text-saffron-300" aria-hidden="true" /> {highlight}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  {item.link?.trim() && (
                                    <a
                                      href={item.link.trim()}
                                      {...externalLinkProps(item.link)}
                                      onClick={(event) => event.stopPropagation()}
                                      className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-saffron-400 px-3.5 py-2 text-[10px] font-bold text-on-gold transition hover:brightness-110"
                                    >
                                      {item.category === "Bags & carry" ? "Browse official bags" : "View official product"} <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
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
            </div>
          </Reveal>
        </div>

        <Reveal className="mt-5">
          <p className="mx-auto max-w-4xl text-center text-[10px] leading-relaxed text-zinc-600">
            The rider image, pointer positions and product details can be edited in Dashboard → The Gear.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
