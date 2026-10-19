import fs from "node:fs";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { getRepo } from "./db/index.js";
import { pruneAttempts } from "./lib/auth.js";
import { authRouter } from "./routes/auth.js";
import { contentRouter, settingsRouter } from "./routes/content.js";
import { mediaRouter } from "./routes/media.js";
import { setupRouter } from "./routes/setup.js";

/**
 * Builds the Express app without starting a listener, so tests can drive the
 * real routes without occupying a port of their own.
 */
export function createApp() {
  const app = express();

  // Behind Passenger / Plesk / Nginx the client address and protocol arrive in
  // X-Forwarded-*; without this every visitor looks like 127.0.0.1 and secure
  // cookies are never set.
  if (config.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(express.json({ limit: "12mb" }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // Deliberately no X-Frame-Options: the site is shown inside preview
    // frames during editing, and framing it is not a threat here.
    next();
  });

  /* ── the API ────────────────────────────────────────────────────────── */

  const api = express.Router();

  // A blunt ceiling on request volume per address. Enough for a dashboard
  // save loop, far below anything that would strain a shared plan.
  if (config.rateLimitPerMinute > 0) {
    const hits = new Map();
    const windowMs = 60_000;
    setInterval(() => {
      const cutoff = Date.now() - windowMs;
      for (const [key, times] of hits) {
        const kept = times.filter((t) => t > cutoff);
        if (kept.length) hits.set(key, kept);
        else hits.delete(key);
      }
      pruneAttempts();
    }, windowMs).unref?.();

    api.use((req, res, next) => {
      const key = req.ip || "unknown";
      const now = Date.now();
      const times = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
      times.push(now);
      hits.set(key, times);
      if (times.length > config.rateLimitPerMinute) {
        res.setHeader("Retry-After", "60");
        return res.status(429).json({ error: "Too many requests. Try again in a minute." });
      }
      next();
    });
  }

  api.get("/health", async (req, res) => {
    try {
      const repo = await getRepo();
      await repo.ping();
      res.json({ ok: true, database: repo.kind, time: new Date().toISOString() });
    } catch (error) {
      res.status(503).json({ ok: false, error: "Database unreachable." });
    }
  });

  // Setup answers before any database-backed route: it must work when there
  // is no database at all.
  api.use(setupRouter);
  api.use("/auth", authRouter);
  api.use(contentRouter);
  api.use(settingsRouter);
  api.use(mediaRouter);
  api.use((req, res) => res.status(404).json({ error: "Unknown endpoint." }));

  app.use("/api", api);

  /* ── uploaded files ─────────────────────────────────────────────────── */

  app.use(
    "/media",
    express.static(config.mediaDir, {
      index: false,
      dotfiles: "deny",
      // Names are random and never reused, so a year is safe.
      maxAge: "365d",
      immutable: true,
      fallthrough: true,
      setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
    }),
  );

  // Art that ships with the code (`public/media/*`) is copied into dist/ by
  // the build, but serving it here too means the same URL works before the
  // first build — and in `npm run dev`, where Vite proxies /media to this
  // server. Uploads above still win: a random upload name never collides.
  app.use(
    "/media",
    express.static(path.join(config.root, "public", "media"), {
      index: false,
      dotfiles: "deny",
      fallthrough: true,
      setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
    }),
  );

  /* ── the built site ─────────────────────────────────────────────────── */

  const indexFile = path.join(config.distDir, "index.html");
  if (fs.existsSync(config.distDir)) {
    app.use(
      express.static(config.distDir, {
        index: false,
        setHeaders: (res, file) => {
          // Fingerprinted build assets can be cached hard; the HTML cannot.
          if (file.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );

    // Every route is a hash route, so any other GET is still the app.
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api/") || req.path.startsWith("/media/")) return next();
      if (!fs.existsSync(indexFile)) return next();
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(indexFile);
    });
  } else {
    app.get("/", (req, res) =>
      res
        .status(503)
        .type("text/plain")
        .send("The site has not been built yet. Run `npm run build` and restart the server."),
    );
  }

  // Uploads (media/), shipped art (public/media/) and the build (dist/) have
  // all had their turn; anything left under /media is a real 404, not the
  // app's HTML pretending to be an image. This runs whether or not dist/
  // exists, so `npm run dev` and a first boot behave the same way.
  app.use("/media", (req, res) => res.status(404).json({ error: "No such file." }));

  /* ── errors ─────────────────────────────────────────────────────────── */

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    if (error?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: `Files must be under ${config.maxUploadMb} MB.` });
    }
    if (error?.type === "entity.too.large") {
      return res.status(413).json({ error: "That request was too large." });
    }

    console.error(`[${req.method} ${req.originalUrl}]`, error);
    res.status(500).json({
      error: "Something went wrong on the server.",
      ...(config.nodeEnv !== "production" && error?.message ? { detail: error.message } : {}),
    });
  });

  return app;
}
