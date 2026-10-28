import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  FolderOpen,
  ImagePlus,
  Link2,
  Trash2,
  Upload,
} from "lucide-react";
import { addMediaFile } from "./mediaLibrary";
import { LibraryModal } from "./ImageField";
import { cn } from "../utils/cn";

/**
 * A gallery of extra product photos.
 *
 * The main photo keeps its own single-image field; everything here is an
 * additional slide on the shop page. Photos can be uploaded in one go, picked
 * from the media folder, or pasted as a URL, then reordered — the first slide
 * here is the second slide on the shop card, after the main photo.
 */
export default function ImagesField({
  value,
  onChange,
  hint,
  plate = false,
}: {
  value?: string[];
  onChange: (next: string[]) => void;
  hint?: string;
  /** Product photos: fit them on a white plate instead of cropping on dark. */
  plate?: boolean;
}) {
  const shots = Array.isArray(value) ? value : [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState("");

  const add = (src: string) => {
    const next = src.trim();
    if (next) onChange([...shots, next]);
  };

  const remove = (index: number) =>
    onChange(shots.filter((_, i) => i !== index));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= shots.length) return;
    const next = [...shots];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const upload = async (files: FileList | undefined) => {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    try {
      const added: string[] = [];
      for (const file of Array.from(files)) {
        added.push((await addMediaFile(file)).dataUrl);
      }
      if (added.length) onChange([...shots, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
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
          {busy ? "Uploading…" : "Upload photos"}
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
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml"
        className="hidden"
        onChange={(e) => void upload(e.target.files ?? undefined)}
      />

      {showUrl && (
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(url);
                setUrl("");
              }
            }}
            placeholder="/media/my-photo.jpg or https://…"
            className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-saffron-400/60 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              add(url);
              setUrl("");
            }}
            className="shrink-0 rounded-xl bg-white/[0.07] px-3.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/[0.12]"
          >
            Add
          </button>
        </div>
      )}

      {error && <p className="mt-1.5 text-[11px] text-red-400">{error}</p>}

      {shots.length === 0 ? (
        <div className="mt-2 flex h-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/10 text-zinc-600">
          <ImagePlus className="h-5 w-5" />
          <span className="text-[10px] uppercase tracking-[0.16em]">
            No extra photos
          </span>
        </div>
      ) : (
        <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {shots.map((src, index) => (
            <li
              key={`${index}-${src.slice(0, 24)}`}
              className={cn(
                "group relative overflow-hidden rounded-xl border border-white/10",
                plate ? "product-plate" : "bg-white/[0.04]"
              )}
            >
              <img
                src={src}
                alt={`Extra photo ${index + 1}`}
                className={cn("h-full w-full", plate ? "aspect-square object-contain" : "aspect-square object-cover")}
                loading="lazy"
              />
              <span className="absolute left-1.5 top-1.5 rounded-full bg-ink-950/75 px-1.5 py-0.5 font-mono text-[9px] text-white">
                {index + 1}
              </span>
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-0.5 bg-ink-950/80 p-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move photo ${index + 1} earlier`}
                  className="grid h-6 w-6 place-items-center rounded-md text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-30"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === shots.length - 1}
                  aria-label={`Move photo ${index + 1} later`}
                  className="grid h-6 w-6 place-items-center rounded-md text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-30"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  aria-label={`Remove photo ${index + 1}`}
                  className="grid h-6 w-6 place-items-center rounded-md text-red-300 hover:bg-red-500/20"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {hint && <p className="mt-1.5 text-[11px] text-zinc-600">{hint}</p>}
      {picker && (
        <LibraryModal
          onPick={(src) => {
            add(src);
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}
