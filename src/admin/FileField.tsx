import { useEffect, useRef, useState } from "react";
import { FileText, FolderOpen, Link2, Upload, X } from "lucide-react";
import {
  addAnyMediaFile,
  formatBytes,
  getMedia,
  listMedia,
  MEDIA_ACCEPT,
  type MediaItem,
} from "./mediaLibrary";
import { cn } from "../utils/cn";

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-saffron-400/60 focus:outline-none transition-colors";



function FilePicker({ onPick, onClose }: { onPick: (ref: string) => void; onClose: () => void }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listMedia().then(setItems).finally(() => setLoading(false));
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-3xl border border-white/10 bg-ink-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <h3 className="font-display text-sm font-semibold text-white">Choose a file from media</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-zinc-400 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          {loading ? (
            <p className="py-10 text-center text-xs text-zinc-500">Loading library…</p>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-xs text-zinc-500">
              Media is empty. Upload a file first.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {items.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onPick(`idb:${m.id}`);
                    onClose();
                  }}
                  className="group overflow-hidden rounded-2xl border border-white/10 text-left transition-all hover:border-saffron-400/50"
                >
                  {m.type.startsWith("image/") ? (
                    <img src={m.dataUrl} alt={m.name} className="aspect-[4/3] w-full object-cover" />
                  ) : (
                    <span className="grid aspect-[4/3] w-full place-items-center bg-white/[0.04]">
                      <FileText className="h-8 w-8 text-saffron-300" />
                    </span>
                  )}
                  <span className="block truncate px-2.5 py-2 text-[10px] text-zinc-400 group-hover:text-white">
                    {m.name} · {formatBytes(m.size)}
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

/**
 * Any-file field (PDF, Word, Excel, images…). Stores an "idb:<id>" media
 * reference or a plain URL; the public button downloads whatever is set.
 */
export default function FileField({
  value,
  onChange,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState(false);
  const [showUrl, setShowUrl] = useState(Boolean(value) && !value.startsWith("idb:"));
  const [label, setLabel] = useState("");

  // Resolve the display name for media references.
  useEffect(() => {
    let alive = true;
    if (!value) {
      setLabel("");
    } else if (value.startsWith("idb:")) {
      getMedia(value.slice(4)).then((item) => {
        if (alive) setLabel(item ? `${item.name} · ${formatBytes(item.size)}` : "File no longer in media");
      });
    } else {
      setLabel(value);
    }
    return () => {
      alive = false;
    };
  }, [value]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const item = await addAnyMediaFile(file);
      onChange(`idb:${item.id}`);
      setShowUrl(false);
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
          {busy ? "Uploading…" : "Upload file"}
        </button>
        <button
          type="button"
          onClick={() => setPicker(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.07] px-3.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/[0.12]"
        >
          <FolderOpen className="h-3.5 w-3.5" /> Media folder
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
        accept={MEDIA_ACCEPT}
        className="hidden"
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {showUrl && (
        <input
          type="text"
          value={value.startsWith("idb:") ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/media/setup-sheet.pdf or https://…"
          className={cn(inputCls, "mt-2 font-mono text-xs")}
        />
      )}
      {error && <p className="mt-1.5 text-[11px] text-red-400">{error}</p>}
      {value ? (
        <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
          <FileText className="h-4 w-4 shrink-0 text-saffron-300" />
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{label || value}</span>
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Remove file"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-zinc-400 hover:bg-red-500/20 hover:text-red-400"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <p className="mt-2 rounded-xl border border-dashed border-white/10 px-3.5 py-2.5 text-[11px] text-zinc-600">
          No file set — the button will fall back to the newsletter section.
        </p>
      )}
      {hint && <p className="mt-1.5 text-[11px] text-zinc-600">{hint}</p>}
      {picker && <FilePicker onPick={onChange} onClose={() => setPicker(false)} />}
    </div>
  );
}
