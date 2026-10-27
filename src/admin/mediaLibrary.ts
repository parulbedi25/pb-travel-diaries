import { siteApi } from "../api/siteApi";

export interface MediaItem {
  id: string;
  /** Ships with the website: selectable, but not deletable from the dashboard. */
  bundled?: boolean;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  addedAt: string;
  /** Format family, stored so the library never has to guess again. */
  kind?: MediaKind;
  /** Lower-case extension without the dot, e.g. "xlsx". */
  ext?: string;
  /** Free-text tags, used as the alt text and to find the photo again. */
  tags?: string[];
}

/* ── Format support ──────────────────────────────────────────────────────
   Photos, PDFs and Office documents all live in the same folder. The kind is
   resolved from the MIME type when the browser gives one, and from the file
   extension when it does not — Windows and some browsers report .xlsx/.docx
   with an empty type, which used to make documents indistinguishable. */
export type MediaKind =
  | "image"
  | "pdf"
  | "word"
  | "excel"
  | "powerpoint"
  | "text"
  | "archive"
  | "video"
  | "other";

export const KIND_META: Record<MediaKind, { label: string; badge: string }> = {
  image: { label: "Image", badge: "IMG" },
  pdf: { label: "PDF", badge: "PDF" },
  word: { label: "Word document", badge: "DOC" },
  excel: { label: "Excel spreadsheet", badge: "XLS" },
  powerpoint: { label: "PowerPoint", badge: "PPT" },
  text: { label: "Text", badge: "TXT" },
  archive: { label: "Archive", badge: "ZIP" },
  video: { label: "Video", badge: "VID" },
  other: { label: "File", badge: "FILE" },
};

const EXT_KINDS: Record<string, MediaKind> = {
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image",
  avif: "image", bmp: "image", svg: "image", heic: "image", heif: "image",
  pdf: "pdf",
  doc: "word", docx: "word", odt: "word", rtf: "word", pages: "word",
  xls: "excel", xlsx: "excel", ods: "excel", csv: "excel", numbers: "excel",
  ppt: "powerpoint", pptx: "powerpoint", odp: "powerpoint", key: "powerpoint",
  txt: "text", md: "text", json: "text",
  zip: "archive", gpx: "archive", kml: "archive", kmz: "archive",
  mp4: "video", webm: "video", mov: "video", m4v: "video", ogv: "video",
};

const MIME_KINDS: Record<string, MediaKind> = {
  "application/pdf": "pdf",
  "application/msword": "word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
  "application/vnd.oasis.opendocument.text": "word",
  "application/vnd.ms-excel": "excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
  "application/vnd.oasis.opendocument.spreadsheet": "excel",
  "text/csv": "excel",
  "application/vnd.ms-powerpoint": "powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "powerpoint",
  "text/plain": "text",
  "application/json": "text",
  "application/zip": "archive",
  "application/gpx+xml": "archive",
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "video/ogg": "video",
};

/** Extension → canonical MIME, used when the browser reports no type. */
const EXT_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", md: "text/plain", json: "application/json",
  zip: "application/zip",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  m4v: "video/x-m4v", ogv: "video/ogg",
};

export function extOf(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

/** Format family for a name/MIME pair. MIME wins; extension is the fallback. */
export function kindFor(name: string, type: string): MediaKind {
  if (type.startsWith("image/")) return "image";
  const byMime = MIME_KINDS[type];
  if (byMime) return byMime;
  return EXT_KINDS[extOf(name)] ?? "other";
}

/** Format family for an already-stored item, including older rows. */
export function kindOf(item: MediaItem): MediaKind {
  return item.kind ?? kindFor(item.name, item.type);
}

/**
 * The `accept` attribute shared by every picker, so the Media folder, the
 * image field and the file field can never drift apart.
 */
export const MEDIA_ACCEPT =
  "image/*,.png,.jpg,.jpeg,.webp,.gif,.avif,.svg," +
  ".pdf,.doc,.docx,.odt,.rtf,.xls,.xlsx,.ods,.csv,.ppt,.pptx,.txt,.md,.json,.zip,.gpx," +
  ".mp4,.webm,.mov,.m4v,.ogv";

/** Images are resized, so their ceiling is generous. Documents are stored whole. */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
/**
 * A section film is a whole video, so it gets its own ceiling — kept just under
 * the server's default MAX_UPLOAD_MB of 25 so an oversized file fails here
 * rather than after a long upload.
 */
const MAX_VIDEO_BYTES = 24 * 1024 * 1024;

/**
 * The media folder now lives on the server.
 *
 * Uploads are written to MEDIA_DIR (default ./media) and indexed in the
 * database; `dataUrl` carries the public URL, which every image picker already
 * treats as a plain `src`. That keeps the whole dashboard unchanged while the
 * bytes move somewhere they can be backed up.
 */

export async function listMedia(): Promise<MediaItem[]> {
  return siteApi.listMedia();
}

export async function getMedia(id: string): Promise<MediaItem | undefined> {
  const items = await siteApi.listMedia();
  return items.find((item) => item.id === id);
}

export async function removeMedia(id: string): Promise<void> {
  await siteApi.deleteMedia(id);
}

/** Replace a photo's tags. Returns the saved item, tags already normalised. */
export async function saveMediaTags(id: string, tags: string[]): Promise<MediaItem> {
  return siteApi.setMediaTags(id, tags);
}

/** Save an edited copy over the original, keeping the id and the URL. */
export async function saveMediaImage(id: string, file: File): Promise<MediaItem> {
  return siteApi.replaceMediaImage(id, file);
}

/**
 * "27 Oct 2026, 6:41 pm" — the card footnote. Short enough for a thumbnail,
 * and always with the full timestamp in its title attribute.
 */
export function formatAdded(iso: string): string {
  if (!iso) return "Date unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Date unknown";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

/** The same instant, spelled out, for a tooltip. */
export function formatAddedFull(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", { dateStyle: "full", timeStyle: "medium" });
}

/** Tags joined the way the server stores them, for the editable field. */
export const tagsToText = (tags: string[] | undefined) => (tags ?? []).join(", ");

/**
 * All of a photo's tags as one alt-text sentence, so a tagged photo has
 * something SEO-worthy to say even when the field it sits in has no caption.
 */
export function tagsToAlt(name: string, tags: string[] | undefined): string {
  const list = tags ?? [];
  if (!list.length) return name;
  return list.join(", ");
}

/** A data URL back into a Blob, for uploading a client-side compression. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "application/octet-stream";
  const binary = atob(body ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** The extension to store, taken from what the bytes actually are. */
function extensionForMime(mime: string, fallback: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return fallback;
}

/** Replace the extension on a filename without touching the rest of it. */
function withExtension(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base}.${ext}`;
}

/** Resize/compress so the library stays usable in-browser. */
export function fileToDataUrl(file: File, maxEdge = 1600, quality = 0.84): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas not available"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
      resolve(canvas.toDataURL(mime, quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    img.src = url;
  });
}

function fileToRawDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

/* ── Compression ──────────────────────────────────────────────────────────
   Large uploads are never rejected. They are re-encoded down to a byte budget
   and the compressed result is what gets stored and displayed. */

/** Rough decoded size of a data URL, in bytes. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return dataUrl.length;
  return Math.ceil((dataUrl.length - comma - 1) * 0.75);
}

export interface CompressBudget {
  /** Ceiling for the stored image. */
  maxBytes: number;
  /** Longest edge in px to start from. */
  maxEdge: number;
  /** Never shrink past this, however tight the budget. */
  minEdge?: number;
}

/** The loader mark renders at ~80px tall, so this is generous headroom. */
export const LOADER_LOGO_BUDGET: CompressBudget = {
  maxBytes: 2 * 1024 * 1024,
  maxEdge: 1024,
  minEdge: 128,
};

function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    img.src = url;
  });
}

export interface CompressedImage {
  dataUrl: string;
  bytes: number;
  width: number;
  height: number;
}

/**
 * Re-encodes an image to fit `budget.maxBytes`: quality is lowered first, then
 * the dimensions, and the smallest attempt is returned if the budget still
 * cannot be met. Transparency is preserved for PNG/SVG sources by keeping the
 * PNG format — a logo flattened onto black would look broken on the loader.
 */
export async function compressImageToBudget(
  file: File,
  budget: CompressBudget
): Promise<CompressedImage> {
  const img = await loadImageFile(file);
  const sourceW = img.naturalWidth || img.width;
  const sourceH = img.naturalHeight || img.height;
  if (!sourceW || !sourceH) throw new Error("That image has no size to read.");

  const keepAlpha =
    file.type === "image/png" ||
    file.type === "image/svg+xml" ||
    file.type === "image/gif" ||
    file.type === "image/webp";
  const mime = keepAlpha ? "image/png" : "image/jpeg";
  const qualities = keepAlpha ? [1] : [0.92, 0.82, 0.7, 0.58];
  const minEdge = Math.min(budget.minEdge ?? 64, budget.maxEdge);

  let edge = budget.maxEdge;
  let best: CompressedImage | null = null;

  while (true) {
    const scale = Math.min(1, edge / Math.max(sourceW, sourceH));
    const width = Math.max(1, Math.round(sourceW * scale));
    const height = Math.max(1, Math.round(sourceH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not available");
    ctx.drawImage(img, 0, 0, width, height);

    for (const quality of qualities) {
      const dataUrl = canvas.toDataURL(mime, quality);
      const bytes = dataUrlBytes(dataUrl);
      if (!best || bytes < best.bytes) best = { dataUrl, bytes, width, height };
      if (bytes <= budget.maxBytes) return { dataUrl, bytes, width, height };
    }

    if (edge <= minEdge) break;
    edge = Math.max(minEdge, Math.round(edge * 0.75));
  }

  return best!;
}


/**
 * Stores any supported file. Photos are resized when the browser can decode
 * them; PDFs, Word, Excel and PowerPoint files are stored exactly as they are.
 */
export async function addAnyMediaFile(file: File): Promise<MediaItem> {
  const ext = extOf(file.name);
  const kind = kindFor(file.name, file.type);
  const type = file.type || EXT_MIME[ext] || "application/octet-stream";

  if (kind === "video") {
    if (file.size > MAX_VIDEO_BYTES) {
      throw new Error(
        `That film is ${formatBytes(file.size)} — videos need to be under ${formatBytes(MAX_VIDEO_BYTES)}.`
      );
    }
  } else if (kind !== "image" && file.size > MAX_FILE_BYTES) {
    throw new Error(
      `That file is ${formatBytes(file.size)} — documents need to be under ${formatBytes(MAX_FILE_BYTES)}.`
    );
  }

  let dataUrl: string;
  if (kind === "image") {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(
        `That image is ${formatBytes(file.size)} — photos need to be under ${formatBytes(MAX_IMAGE_BYTES)}.`
      );
    }
    try {
      dataUrl = await fileToDataUrl(file);
    } catch {
      // An image format the browser cannot paint (HEIC, some SVGs). Keep the
      // original rather than rejecting the upload outright.
      dataUrl = await fileToRawDataUrl(file);
    }
  } else {
    dataUrl = await fileToRawDataUrl(file);
  }

  // Compression happens here, in the browser, where the canvas is; what gets
  // uploaded is the small version.
  const upload = new File(
    [kind === "image" ? dataUrlToBlob(dataUrl) : file],
    file.name.replace(/\s+/g, "-"),
    { type },
  );
  const item = await siteApi.uploadMedia(upload);
  return { ...item, kind, ext };
}

/**
 * Kept for the image fields: rejects anything that is not a photo.
 *
 * With a `budget`, the upload is never refused for being too big — the image is
 * compressed to fit and the compressed version is what gets stored.
 */
export async function addMediaFile(file: File, budget?: CompressBudget): Promise<MediaItem> {
  const kind = kindFor(file.name, file.type);
  if (kind !== "image") {
    throw new Error("Please choose an image file (PNG, JPG, WEBP, GIF, SVG).");
  }
  if (!budget) return addAnyMediaFile(file);

  const ext = extOf(file.name);
  const type = file.type || EXT_MIME[ext] || "image/png";
  // The source may be far over the budget; compression brings it down, so only
  // a genuinely absurd file is refused.
  if (file.size > 60 * 1024 * 1024) {
    throw new Error(`That image is ${formatBytes(file.size)} — please use one under 60 MB.`);
  }

  const compressed = await compressImageToBudget(file, budget);
  const upload = new File(
    [dataUrlToBlob(compressed.dataUrl)],
    withExtension(file.name.replace(/\s+/g, "-"), extensionForMime(type, ext)),
    { type },
  );
  const item = await siteApi.uploadMedia(upload);
  return { ...item, kind: "image" };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
