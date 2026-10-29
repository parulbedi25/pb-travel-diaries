/**
 * Vite's `?raw` suffix, for the type checker.
 *
 * It hands back a file's text as a string — which is how MapLibre's worker is
 * carried inside the single-file build (see utils/mapWorker). TypeScript has no
 * way to know that on its own.
 */

declare module "*?raw" {
  const text: string;
  export default text;
}
