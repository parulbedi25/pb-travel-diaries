export interface MediaItem {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  addedAt: string;
}

const DB_NAME = "pb_media_v1";
const STORE = "files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listMedia(): Promise<MediaItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result as MediaItem[]).sort((a, b) =>
        b.addedAt.localeCompare(a.addedAt)
      );
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getMedia(id: string): Promise<MediaItem | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as MediaItem | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMedia(item: MediaItem): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeMedia(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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

export async function addMediaFile(file: File): Promise<MediaItem> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file (JPG, PNG, WEBP).");
  }
  const dataUrl = await fileToDataUrl(file);
  const item: MediaItem = {
    id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name.replace(/\s+/g, "-"),
    type: file.type,
    size: file.size,
    dataUrl,
    addedAt: new Date().toISOString(),
  };
  await saveMedia(item);
  return item;
}

const MAX_DOC_BYTES = 8 * 1024 * 1024;

function fileToRawDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Accepts any file. Images are resized as usual; documents (PDF, Word,
 * Excel, etc.) are stored as-is in the browser's media library.
 */
export async function addAnyMediaFile(file: File): Promise<MediaItem> {
  if (file.type.startsWith("image/")) return addMediaFile(file);
  if (file.size > MAX_DOC_BYTES) {
    throw new Error("File is too large — the limit is 8 MB.");
  }
  const item: MediaItem = {
    id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name.replace(/\s+/g, "-"),
    type: file.type || "application/octet-stream",
    size: file.size,
    dataUrl: await fileToRawDataUrl(file),
    addedAt: new Date().toISOString(),
  };
  await saveMedia(item);
  return item;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
