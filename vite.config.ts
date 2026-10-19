import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// `npm run dev` passes the API's port; without it, the server's default.
const apiPort = process.env.API_PORT || "4000";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    // Bind to all interfaces so the preview proxy can reach the dev server,
    // and accept the proxied preview hostname / origin.
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    // In development the API and the uploaded files come from `npm run server`
    // (port 4000). Proxying them keeps the browser on one origin, exactly as
    // Express serves both in production.
    proxy: {
      "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
      "/media": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
    },
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
});
