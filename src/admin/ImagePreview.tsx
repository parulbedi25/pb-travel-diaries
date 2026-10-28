import { X } from "lucide-react";
import { dataUrlBytes, formatBytes } from "./mediaLibrary";
import { cn } from "../utils/cn";

/**
 * A fixed-shape viewport for an uploaded image.
 *
 * Previews used to size themselves from the image itself, so a tall portrait
 * photo produced a very tall block and a panoramic one a wide strip — the panel
 * jumped around depending on what had just been uploaded. This frames every
 * preview at the same aspect ratio and fits the image inside it, whatever its
 * shape, so the panel keeps a predictable height.
 */
export default function ImagePreview({
  src,
  alt = "",
  onClear,
  /** Frame shape. Every preview of the same kind shares it. */
  ratio = "16 / 9",
  /** How much of the frame the image may fill, leaving a margin. */
  fit = 0.82,
  /** Show the stored size — useful once an upload has been compressed. */
  showSize = false,
  note,
  /**
   * Put a product photo on a white plate, the way the shop shows it. A cut-out
   * on white or on nothing would otherwise read as a black block, since the
   * frame behind it is dark.
   */
  plate = false,
  className,
}: {
  src: string;
  alt?: string;
  onClear?: () => void;
  ratio?: string;
  fit?: number;
  showSize?: boolean;
  note?: string;
  plate?: boolean;
  className?: string;
}) {
  const isDataUrl = src.startsWith("data:");
  const size = isDataUrl ? dataUrlBytes(src) : null;

  return (
    <div
      className={cn(
        "relative mt-2 w-full min-w-0 overflow-hidden rounded-xl border border-white/10",
        plate ? "product-plate" : "bg-black/40",
        className
      )}
    >
      {/*
        The image is absolutely positioned so it contributes nothing to the
        intrinsic size of this box. A normally-flowed image makes its min-content
        width the image's own width, which stretches the frame (and every
        ancestor) to fit a wide upload — that was the "takes much bigger space in
        view" problem. Here the frame is always exactly the container's width and
        the image is fitted inside it.
      */}
      <div className="relative w-full" style={{ aspectRatio: ratio }}>
        <img
          src={src}
          alt={alt}
          className="absolute inset-0 m-auto object-contain"
          style={{ maxWidth: `${fit * 100}%`, maxHeight: `${fit * 100}%` }}
        />
      </div>

      {(showSize || note) && (
        <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-medium text-zinc-300 backdrop-blur-md">
          {size !== null ? `Stored at ${formatBytes(size)}` : "Linked image"}
          {note ? ` · ${note}` : ""}
        </span>
      )}

      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear image"
          className="shrink-0 aspect-square absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white transition-colors hover:bg-red-500"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
