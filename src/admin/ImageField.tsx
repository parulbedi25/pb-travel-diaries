import { useEffect, useRef, useState } from "react";
import { FolderOpen, ImagePlus, Link2, Upload, X } from "lucide-react";
import {
  addMediaFile,
  listMedia,
  type CompressBudget,
  type MediaItem,
} from "./mediaLibrary";
import ImagePreview from "./ImagePreview";
import { cn } from "../utils/cn";
import { inputCls } from "./fieldStyles";

export function LibraryModal({
  onPick,
  onClose,
}: {
  onPick: (src: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listMedia()
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-3xl border border-white/10 bg-ink-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <h3 className="font-display text-sm font-semibold text-white">Choose from media folder</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 aspect-square grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-zinc-400 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          {loading ? (
            <p className="py-10 text-center text-xs text-zinc-500">Loading library…</p>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-xs text-zinc-500">
              Media folder is empty. Upload a photo first (Media tab or the Upload button).
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {items.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onPick(m.dataUrl);
                    onClose();
                  }}
                  className="group overflow-hidden rounded-2xl border border-white/10 text-left transition-all hover:border-saffron-400/50"
                >
                  <img src={m.dataUrl} alt={m.name} className="aspect-[4/3] w-full object-cover" />
                  <span className="block truncate px-2.5 py-2 text-[10px] text-zinc-400 group-hover:text-white">
                    {m.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ImageField({
  value,
  onChange,
  hint,
  budget,
  previewNote,
  plate = false,
}: {
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  /**
   * When set, uploads are compressed to fit this budget instead of being
   * rejected for being large. The compressed image is what gets stored.
   */
  budget?: CompressBudget;
  /** Caption shown over the preview, e.g. where the image is used. */
  previewNote?: string;
  /** Preview a product photo on the white plate the shop puts behind it. */
  plate?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState(false);
  const [showUrl, setShowUrl] = useState(Boolean(value) && !value.startsWith("data:"));

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const item = await addMediaFile(file, budget);
      onChange(item.dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-saffron-400 px-3.5 py-2 text-xs font-bold text-on-gold disabled:opacity-60"
        >
          <Upload className="h-3.5 w-3.5" />
          {busy ? "Uploading…" : "Upload from computer"}
        </button>
        <button
          type="button"
          onClick={() => setPicker(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.07] px-3.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/[0.12]"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Media folder
        </button>
        <button
          type="button"
          onClick={() => setShowUrl((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-zinc-400 hover:text-white"
        >
          <Link2 className="h-3.5 w-3.5" />
          {showUrl ? "Hide URL" : "Paste URL"}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {showUrl && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/media/my-photo.jpg or https://…"
          className={cn(inputCls, "mt-2 font-mono text-xs")}
        />
      )}
      {error && <p className="mt-1.5 text-[11px] text-red-400">{error}</p>}
      {value ? (
        <ImagePreview
          src={value}
          onClear={() => onChange("")}
          ratio="16 / 9"
          showSize={Boolean(budget)}
          note={previewNote}
          plate={plate}
        />
      ) : (
        <div className="mt-2 flex h-20 items-center justify-center rounded-xl border border-dashed border-white/10 text-zinc-600">
          <ImagePlus className="h-5 w-5" />
        </div>
      )}
      {hint && <p className="mt-1.5 text-[11px] text-zinc-600">{hint}</p>}
      {picker && <LibraryModal onPick={onChange} onClose={() => setPicker(false)} />}
    </div>
  );
}
