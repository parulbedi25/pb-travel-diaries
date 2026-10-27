import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crop,
  FlipHorizontal,
  FlipVertical,
  Info,
  Loader2,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Tag,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { cn } from "../utils/cn";
import ConfirmDialog from "./ConfirmDialog";
import {
  formatAddedFull,
  formatBytes,
  saveMediaImage,
  saveMediaTags,
  tagsToAlt,
  tagsToText,
  type MediaItem,
} from "./mediaLibrary";

/**
 * One photo, big enough to judge, with everything you might want to do to it.
 *
 * The media folder used to hand a click straight to a new browser tab. This is
 * a panel instead: half the screen, photo centred, and the folder's other
 * photos one scroll or one arrow away — so reviewing a shoot does not mean
 * going back to the grid between every picture. The rail on the right holds the
 * three things worth doing here: adjust the image, tag it, or read its facts.
 *
 * Edits are previewed live with CSS filters (instant, no canvas churn) and only
 * baked into a real file when Apply is pressed, at which point the new pixels
 * are written over the original — same id, same URL, so every section already
 * using the photo picks the change up.
 *
 * Bundled starter photographs are files in the repository, not rows in the
 * database: they can be looked at, but not edited, tagged or deleted.
 */

export interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  rotate: 0 | 90 | 180 | 270;
  flipX: boolean;
  flipY: boolean;
}

const NEUTRAL: Adjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  rotate: 0,
  flipX: false,
  flipY: false,
};

const isNeutral = (a: Adjustments) =>
  a.brightness === 100 &&
  a.contrast === 100 &&
  a.saturation === 100 &&
  a.rotate === 0 &&
  !a.flipX &&
  !a.flipY;

const cssFilter = (a: Adjustments) =>
  `brightness(${a.brightness}%) contrast(${a.contrast}%) saturate(${a.saturation}%)`;

const cssTransform = (a: Adjustments) =>
  `rotate(${a.rotate}deg) scaleX(${a.flipX ? -1 : 1}) scaleY(${a.flipY ? -1 : 1})`;

/** The extension a re-encode should keep, and the type it is written as. */
function outputType(item: MediaItem): { mime: string; ext: string } {
  const ext = (item.ext || "").toLowerCase();
  if (ext === "png" || item.type === "image/png") return { mime: "image/png", ext: "png" };
  if (ext === "webp" || item.type === "image/webp") return { mime: "image/webp", ext: "webp" };
  return { mime: "image/jpeg", ext: ext === "jpg" || ext === "jpeg" ? ext : "jpg" };
}

/**
 * Draw the adjusted photo onto a canvas and hand back a File.
 * Filters are applied first, then the rotation/flip, because that is the order
 * the preview shows them in.
 */
async function bakeEdits(item: MediaItem, edits: Adjustments): Promise<File> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "same-origin";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that image"));
    img.src = item.dataUrl;
  });

  const sourceW = image.naturalWidth || image.width;
  const sourceH = image.naturalHeight || image.height;
  const quarter = edits.rotate === 90 || edits.rotate === 270;

  const filtered = document.createElement("canvas");
  filtered.width = sourceW;
  filtered.height = sourceH;
  const fctx = filtered.getContext("2d");
  if (!fctx) throw new Error("Canvas not available");
  fctx.filter = cssFilter(edits);
  fctx.drawImage(image, 0, 0);

  const out = document.createElement("canvas");
  out.width = quarter ? sourceH : sourceW;
  out.height = quarter ? sourceW : sourceH;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((edits.rotate * Math.PI) / 180);
  ctx.scale(edits.flipX ? -1 : 1, edits.flipY ? -1 : 1);
  ctx.drawImage(filtered, -sourceW / 2, -sourceH / 2);

  const { mime, ext } = outputType(item);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, mime, 0.92));
  if (!blob) throw new Error("Could not save that image");

  const base = item.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${base}.${ext}`, { type: mime });
}

type Tab = "adjust" | "tags" | "info";

const railBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors";

export default function MediaLightbox({
  images,
  startId,
  usageOf,
  onClose,
  onDeleted,
  onSaved,
  onDelete,
}: {
  /** Every photo in the folder, in the order the grid shows them. */
  images: MediaItem[];
  /** Which one to open on. */
  startId: string;
  /** How many places on the site use this photo, for the delete warning. */
  usageOf: (item: MediaItem) => number;
  onClose: () => void;
  /** Called after a successful delete so the grid can drop the card. */
  onDeleted: (item: MediaItem) => void;
  /** Called after tags or pixels are saved. */
  onSaved: (item: MediaItem) => void;
  /** Performs the delete itself (the folder already knows how). */
  onDelete: (item: MediaItem) => Promise<void>;
}) {
  const [currentId, setCurrentId] = useState(startId);
  const [tab, setTab] = useState<Tab>("adjust");
  const [edits, setEdits] = useState<Adjustments>(NEUTRAL);
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy] = useState<"" | "saving" | "applying">("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wheelAt = useRef(0);

  const index = Math.max(0, images.findIndex((item) => item.id === currentId));
  const item = images[index];
  const total = images.length;

  const go = useCallback(
    (step: number) => {
      if (total < 2) return;
      const next = (index + step + total) % total;
      setCurrentId(images[next].id);
      setEdits(NEUTRAL);
      setError("");
      setNote("");
      setSize(null);
      setCopied(false);
    },
    [images, index, total]
  );

  // A new photo means a fresh tag field.
  useEffect(() => {
    setTagDraft(tagsToText(item?.tags));
  }, [item?.id, item?.tags]);

  // Escape closes, arrows move. While a field is focused the arrows keep their
  // usual text-editing meaning, and the delete confirmation owns the keyboard.
  useEffect(() => {
    if (confirming) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming, go, onClose]);

  // Lock the page behind the panel, and put focus somewhere sensible.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const onWheel = (event: React.WheelEvent) => {
    if (total < 2) return;
    const now = Date.now();
    if (Math.abs(event.deltaY) < 12 || now - wheelAt.current < 280) return;
    wheelAt.current = now;
    go(event.deltaY > 0 ? 1 : -1);
  };

  const saveTags = async () => {
    if (!item || item.bundled) return;
    setBusy("saving");
    setError("");
    try {
      const saved = await saveMediaTags(item.id, tagDraft.split(",").map((t) => t.trim()));
      onSaved(saved);
      setNote("Tags saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save those tags.");
    } finally {
      setBusy("");
    }
  };

  const applyEdits = async () => {
    if (!item || item.bundled) return;
    setBusy("applying");
    setError("");
    try {
      const file = await bakeEdits(item, edits);
      const saved = await saveMediaImage(item.id, file);
      onSaved(saved);
      setEdits(NEUTRAL);
      setNote("Saved over the original");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that edit.");
    } finally {
      setBusy("");
    }
  };

  const copyAlt = async () => {
    if (!item) return;
    try {
      await navigator.clipboard.writeText(tagsToAlt(item.name, item.tags));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("This browser would not let the dashboard copy to the clipboard.");
    }
  };

  const locked = Boolean(item?.bundled);
  const adjusted = !isNeutral(edits);

  const tabs = useMemo(
    () =>
      [
        { key: "adjust" as Tab, label: "Adjust", Icon: SlidersHorizontal },
        { key: "tags" as Tab, label: "Tags", Icon: Tag },
        { key: "info" as Tab, label: "Info", Icon: Info },
      ] as const,
    []
  );

  if (!item) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[115] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-6"
      // Clicking the dimmed area closes, the way the rest of the dashboard works.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name} — media preview`}
        className={cn(
          // Half the screen on a desktop, nearly all of it on a phone, where
          // 50% would leave no room for the photo at all.
          "flex w-[95vw] flex-col overflow-hidden rounded-3xl border border-white/10 bg-ink-950 shadow-2xl shadow-black/80",
          "h-[88dvh] sm:h-1/2 sm:min-h-[420px] sm:w-1/2 sm:max-w-[900px]"
        )}
      >
        {/* ── header ── */}
        <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.07] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white" title={item.name}>
              {item.name}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {total > 1 ? `${index + 1} of ${total} photos · ` : ""}
              {formatBytes(item.size)}
              {size ? ` · ${size.w}×${size.h}` : ""}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-zinc-300 transition-colors hover:bg-white/[0.14] hover:text-white"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* ── the photo ── */}
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center bg-black/50 p-3 sm:p-4"
            onWheel={onWheel}
          >
            <img
              key={item.id}
              src={item.dataUrl}
              alt={tagsToAlt(item.name, item.tags)}
              onLoad={(e) => {
                const img = e.currentTarget;
                setSize({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              className="max-h-full max-w-full object-contain transition-[filter] duration-150"
              style={{ filter: cssFilter(edits), transform: cssTransform(edits) }}
            />

            {total > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label="Previous photo"
                  className="absolute left-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/80"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label="Next photo"
                  className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/80"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                <p className="pointer-events-none absolute inset-x-0 bottom-1.5 text-center text-[10px] text-white/45">
                  Scroll or use ← → for the next photo
                </p>
              </>
            )}
          </div>

          {/* ── the rail ── */}
          <div className="flex min-h-0 w-full shrink-0 flex-col border-t border-white/[0.07] sm:w-[42%] sm:min-w-[260px] sm:max-w-[330px] sm:border-l sm:border-t-0">
            <div className="flex shrink-0 gap-1 border-b border-white/[0.07] p-2">
              {tabs.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-pressed={tab === key}
                  className={cn(
                    railBtn,
                    "flex-1",
                    tab === key
                      ? "bg-white/[0.1] text-white"
                      : "text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 no-scrollbar">
              {locked && (
                <p className="mb-3 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                  This photo ships with the website, so it can be viewed but not edited. Upload
                  your own copy to change it.
                </p>
              )}

              {tab === "adjust" && (
                <div className="flex flex-col gap-3">
                  <Slider
                    label="Brightness"
                    value={edits.brightness}
                    min={40}
                    max={160}
                    disabled={locked}
                    onChange={(brightness) => setEdits((a) => ({ ...a, brightness }))}
                  />
                  <Slider
                    label="Contrast"
                    value={edits.contrast}
                    min={40}
                    max={160}
                    disabled={locked}
                    onChange={(contrast) => setEdits((a) => ({ ...a, contrast }))}
                  />
                  <Slider
                    label="Saturation"
                    value={edits.saturation}
                    min={0}
                    max={200}
                    disabled={locked}
                    onChange={(saturation) => setEdits((a) => ({ ...a, saturation }))}
                  />

                  <div className="grid grid-cols-4 gap-1.5">
                    <IconBtn
                      label="Rotate left"
                      disabled={locked}
                      onClick={() =>
                        setEdits((a) => ({ ...a, rotate: (((a.rotate + 270) % 360) as 0 | 90 | 180 | 270) }))
                      }
                    >
                      <RotateCcw className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn
                      label="Rotate right"
                      disabled={locked}
                      onClick={() =>
                        setEdits((a) => ({ ...a, rotate: (((a.rotate + 90) % 360) as 0 | 90 | 180 | 270) }))
                      }
                    >
                      <RotateCw className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn
                      label="Flip horizontally"
                      pressed={edits.flipX}
                      disabled={locked}
                      onClick={() => setEdits((a) => ({ ...a, flipX: !a.flipX }))}
                    >
                      <FlipHorizontal className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn
                      label="Flip vertically"
                      pressed={edits.flipY}
                      disabled={locked}
                      onClick={() => setEdits((a) => ({ ...a, flipY: !a.flipY }))}
                    >
                      <FlipVertical className="h-4 w-4" />
                    </IconBtn>
                  </div>

                  <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-500">
                    <Crop className="mt-0.5 h-3 w-3 shrink-0" />
                    Applying writes the adjusted image over the original file — same file, same
                    URL, so every section already using it updates.
                  </p>

                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void applyEdits()}
                      disabled={locked || !adjusted || busy !== ""}
                      className={cn(
                        railBtn,
                        "flex-1 bg-saffron-400 text-on-gold hover:bg-saffron-300 disabled:opacity-40"
                      )}
                    >
                      {busy === "applying" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => setEdits(NEUTRAL)}
                      disabled={!adjusted || busy !== ""}
                      className={cn(
                        railBtn,
                        "border border-white/12 text-zinc-300 hover:border-white/30 hover:text-white disabled:opacity-40"
                      )}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      Reset
                    </button>
                  </div>
                </div>
              )}

              {tab === "tags" && (
                <div className="flex flex-col gap-2.5">
                  <label htmlFor="media-tags" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Tags
                  </label>
                  <input
                    id="media-tags"
                    type="text"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveTags();
                      }
                    }}
                    disabled={locked}
                    placeholder="e.g. Spiti, monastery, blue hour"
                    className="w-full rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-saffron-400/60 focus:outline-none disabled:opacity-50"
                  />
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    Separate tags with commas. They are the photo's alt text and its search terms,
                    so name what is actually in the frame — place, subject, season.
                  </p>
                  {(item.tags ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {(item.tags ?? []).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-saffron-400/15 px-2.5 py-0.5 text-[10px] font-semibold text-saffron-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void saveTags()}
                      disabled={locked || busy !== ""}
                      className={cn(
                        railBtn,
                        "flex-1 bg-saffron-400 text-on-gold hover:bg-saffron-300 disabled:opacity-40"
                      )}
                    >
                      {busy === "saving" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Save tags
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyAlt()}
                      className={cn(
                        railBtn,
                        "border border-white/12 text-zinc-300 hover:border-white/30 hover:text-white"
                      )}
                      title="Copy the tags as alt text"
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      Alt text
                    </button>
                  </div>
                </div>
              )}

              {tab === "info" && (
                <dl className="flex flex-col gap-2 text-[11px]">
                  <Fact label="File" value={item.name} />
                  <Fact label="Type" value={(item.ext || item.type || "file").toUpperCase()} />
                  <Fact label="Size" value={formatBytes(item.size)} />
                  <Fact
                    label="Pixels"
                    value={size ? `${size.w} × ${size.h}` : "Measuring…"}
                  />
                  <Fact label="Added" value={formatAddedFull(item.addedAt) || "Unknown"} />
                  <Fact
                    label="Used"
                    value={`${usageOf(item)} place${usageOf(item) === 1 ? "" : "s"} on the site`}
                  />
                  <Fact label="Tags" value={(item.tags ?? []).join(", ") || "None yet"} />
                  <div className="mt-1 break-all rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 font-mono text-[10px] text-zinc-400">
                    {item.dataUrl}
                  </div>
                </dl>
              )}

              {error && (
                <p role="alert" className="mt-3 text-[11px] leading-relaxed text-red-400">
                  {error}
                </p>
              )}
              {note && !error && (
                <p role="status" className="mt-3 text-[11px] leading-relaxed text-emerald-400">
                  {note}
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5 border-t border-white/[0.07] p-2">
              <a
                href={item.dataUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(railBtn, "flex-1 border border-white/12 text-zinc-300 hover:border-white/30 hover:text-white")}
              >
                Open original
              </a>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={locked}
                title={locked ? "Ships with the website" : "Delete this file"}
                className={cn(
                  railBtn,
                  "border border-white/12 text-zinc-400 hover:border-red-400/50 hover:bg-red-500/15 hover:text-red-400 disabled:opacity-40"
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Delete this file?"
          message={`“${item.name}” (${formatBytes(item.size)}) will be removed from the media folder. This cannot be undone.`}
          detail={
            usageOf(item) > 0
              ? `It is currently used in ${usageOf(item)} place${usageOf(item) === 1 ? "" : "s"} on the site — those fields will point at a missing file.`
              : undefined
          }
          confirmLabel="Delete file"
          onConfirm={() => {
            setConfirming(false);
            void onDelete(item).then(() => {
              onDeleted(item);
              // The folder closes the panel itself once the last photo is gone.
              if (total <= 1) onClose();
              else go(1);
            });
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>,
    document.body
  );
}

/* ── small pieces ─────────────────────────────────────────────────────── */

function Slider({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const id = `adjust-${label.toLowerCase()}`;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[11px] font-medium text-zinc-400">
          {label}
        </label>
        <span className="font-mono text-[10px] text-zinc-500">{value}%</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-saffron-400 disabled:opacity-40"
      />
    </div>
  );
}

function IconBtn({
  label,
  children,
  onClick,
  disabled,
  pressed,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cn(
        "grid h-8 place-items-center rounded-lg border text-zinc-300 transition-colors disabled:opacity-40",
        pressed
          ? "border-saffron-300/60 bg-saffron-400/15 text-white"
          : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-words text-right text-zinc-300">{value}</dd>
    </div>
  );
}
