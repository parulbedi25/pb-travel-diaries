/**
 * Give MapLibre a worker it can actually start.
 *
 * MapLibre draws nothing without a web worker: the style and the tiles are
 * parsed off the main thread. It finds that worker by looking for a file next
 * to its own module — `./maplibre-gl-worker.mjs`, worked out from
 * `import.meta.url`. A bundled page has no such file: the module's
 * `import.meta.url` is the page's own URL, and the site is one HTML file. So
 * the worker asks for `/maplibre-gl-worker.mjs`, gets a 404, and the map never
 * appears — a blank panel and nothing in the console worth reading. That was
 * the bug: the map could not load at all.
 *
 * The fix is to hand MapLibre the worker itself. The file that ships inside the
 * maplibre package is imported as text (`?raw`), turned into a blob, and given
 * to MapLibre as its worker address. It cannot fall out of step with the
 * library — it *is* the library's own worker, taken from the same install, so
 * upgrading maplibre upgrades both halves at once — and it needs no extra file
 * beside the page, which is the point: the site stays one deliverable.
 *
 * The blob is made once, when the first map appears. The content security
 * policy allows blob workers for exactly this, and nothing here reaches the
 * network.
 */

import { setWorkerUrl } from "maplibre-gl";
import workerSource from "maplibre-gl/dist/maplibre-gl-worker.mjs?raw";

let installed = false;

/** Point MapLibre at a worker built from the copy it ships with. */
export function installMapWorker(): void {
  if (installed) return;
  installed = true;
  try {
    // The copy carries a reference to its own source map, which a blob cannot
    // resolve — leaving it in is one guaranteed 404 in the console for nothing.
    const source = workerSource.replace(/\n?\/\/# sourceMappingURL=\S*\s*$/, "");
    const blob = new Blob([source], { type: "text/javascript" });
    setWorkerUrl(URL.createObjectURL(blob));
  } catch {
    // Leaving MapLibre's own default alone is better than pointing it at a URL
    // that could not be made.
  }
}
