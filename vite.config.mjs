import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * The site's build.
 *
 * `tailwindcss()` is what turns the utility class names in the source into
 * actual CSS, and the page carries no other stylesheet — so a build without it
 * ships a site with the right markup and almost no styling. That is exactly
 * what a broken-looking first-run screen turned out to be. It is not optional.
 */
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    rollupOptions: { input: "build.html" },
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
});
