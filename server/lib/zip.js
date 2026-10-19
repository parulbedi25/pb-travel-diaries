/**
 * The two zip operations this app needs: write a folder tree into one file, and
 * walk one back out again.
 *
 * `yazl`/`yauzl` are small, streaming and dependency-free at runtime, which
 * matters because a backup can hold a gigabyte of photographs. Nothing here
 * ever reads a whole file into memory: entries are streamed in and out.
 *
 * Reading is deliberately strict. Entry names are checked by the library (no
 * absolute paths, no `..`), and `extractTo` refuses anything that would land
 * outside the destination folder anyway — an uploaded zip is not trusted.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import yauzl from "yauzl";

/**
 * Write `entries` into `target`.
 *
 * Each entry is `{ path, file }` for a file on disk, `{ path, data }` for
 * something already in memory, or `{ path, file, size, mtime }` if the caller
 * wants the size known up front (it is not required).
 *
 * Entries are written as they are handed over, so building the list lazily
 * keeps memory flat. Resolves with the number of bytes written.
 */
export async function writeZip(target, entries) {
  await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });

  const zip = new yazl.ZipFile();
  const done = pipeline(zip.outputStream, fs.createWriteStream(target, { mode: 0o600 }));

  let count = 0;
  try {
    for await (const entry of entries) {
      if (!entry || !entry.path) continue;
      // Forward slashes only: a zip is read on Windows and macOS too.
      const name = entry.path.split(path.sep).join("/").replace(/^\/+/, "");
      if (!name) continue;
      if (entry.data !== undefined) {
        zip.addBuffer(Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data), name);
      } else if (entry.file) {
        await fsp.access(entry.file).catch(() => {
          throw new Error(`Missing file for the archive: ${entry.file}`);
        });
        zip.addFile(entry.file, name);
      } else {
        continue;
      }
      count += 1;
    }
    zip.end();
    await done;
  } catch (error) {
    zip.end();
    await done.catch(() => undefined);
    throw error;
  }
  return count;
}

/**
 * Walk every file in `zipPath`, handing the caller `{ path, stream, size }`.
 * Returning `false` from the callback stops the walk early.
 */
export async function walkZip(zipPath, onEntry) {
  const zip = await yauzl.openPromise(zipPath, { lazyEntries: true });
  try {
    for await (const entry of zip.eachEntry()) {
      if (!entry || entry.fileName.endsWith("/")) continue;
      const stream = await zip.openReadStreamPromise(entry);
      const keepGoing = await onEntry({
        path: entry.fileName,
        stream,
        size: entry.uncompressedSize,
      });
      if (keepGoing === false) break;
    }
  } finally {
    zip.close?.();
  }
}

/**
 * Walk the archive's directory without opening any file. Fast, and enough to
 * count what a backup contains before restoring it.
 */
export async function walkZipEntries(zipPath, onEntry) {
  const zip = await yauzl.openPromise(zipPath, { lazyEntries: true });
  try {
    for await (const entry of zip.eachEntry()) {
      if (!entry || entry.fileName.endsWith("/")) continue;
      if ((await onEntry({ path: entry.fileName, size: entry.uncompressedSize })) === false) break;
    }
  } finally {
    zip.close?.();
  }
}

/** Read one entry as text, or null when the archive has no such file. */
export async function readZipText(zipPath, wanted) {
  let found = null;
  await walkZip(zipPath, async ({ path: name, stream }) => {
    if (name !== wanted) {
      stream.resume(); // drain, so the next entry can be read
      return true;
    }
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    found = Buffer.concat(chunks).toString("utf8");
    return false;
  });
  return found;
}

/**
 * A destination inside `root` for a zip entry, or null if the name tries to
 * escape. Both separators are normalised first, because an archive made on
 * Windows can carry backslashes.
 */
export function safeJoin(root, name) {
  const normalised = String(name).replace(/\\/g, "/");
  if (normalised.startsWith("/") || /^[A-Za-z]:/.test(normalised)) return null;
  const target = path.resolve(root, normalised);
  const base = path.resolve(root);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

/**
 * Extract every entry under `prefix` into `destination`, skipping anything
 * outside it. Resolves with the files written and the bytes extracted.
 */
export async function extractTo(zipPath, destination, { prefix = "" } = {}) {
  await fsp.mkdir(destination, { recursive: true, mode: 0o700 });

  let files = 0;
  let bytes = 0;
  await walkZip(zipPath, async ({ path: name, stream, size }) => {
    if (prefix && !name.startsWith(prefix)) {
      stream.resume();
      return true;
    }
    const relative = prefix ? name.slice(prefix.length) : name;
    if (!relative) {
      stream.resume();
      return true;
    }
    const target = safeJoin(destination, relative);
    if (!target) {
      stream.resume();
      return true;
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await pipeline(stream, fs.createWriteStream(target, { mode: 0o600 }));
    files += 1;
    bytes += size ?? 0;
    return true;
  });
  return { files, bytes };
}
