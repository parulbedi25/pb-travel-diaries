import fs from "node:fs";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { siteDocument } from "./lib/siteDocument.js";
import { getRepo } from "./db/index.js";
import { pruneAttempts } from "./lib/auth.js";
import { authRouter } from "./routes/auth.js";
import { contentRouter, settingsRouter } from "./routes/content.js";
import { mediaRouter } from "./routes/media.js";
import { backupsRouter } from "./routes/backups.js";
import { mapsRouter } from "./routes/maps.js";
import { memberRouter } from "./routes/member.js";
import { alertsRouter } from "./routes/alerts.js";
import { restoreRouter } from "./routes/restore.js";
import { setupRouter } from "./routes/setup.js";
import { isMissingSchema } from "./db/migrationErrors.js";
import { redactForLog } from "./lib/logRedaction.js";

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
  // Defense in depth: private install/SQLite directories are never HTTP assets.
  app.use(["/server/data", "/data"], (_req, res) => res.status(404).end());

  app.use(express.json({ limit: "12mb" }));
  app.use(cookieParser());

const API_CSP = "default-src 'none'; frame-ancestors 'self'";

/**
 * What the public website is allowed to load.
 *
 * Inline script and style are unavoidable in a single-file build; the rest is
 * limited to the site's own files, its photographs, the basemap tiles and
 * Google Fonts. Nothing here permits framing the dashboard elsewhere or
 * reaching an unknown host, which is what a policy is for.
 */
const SITE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
].join("; ");

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // The API only ever answers with data: it never needs to load an image, a
    // font or a script, and nobody should be able to embed a JSON response in
    // a page. Locking that down here keeps an injected value in a field from
    // ever becoming a request the browser makes.
    //
    // The website itself is one HTML file with its own inline script and
    // style, so it needs a policy that allows what it actually uses — that
    // file, its styles, its photographs, the map tiles — and nothing else.
    const api = req.path === "/api" || req.path.startsWith("/api/");
    res.setHeader("Content-Security-Policy", api ? API_CSP : SITE_CSP);
    // Not a camera, microphone or location app.
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    // Deliberately no X-Frame-Options: the site is shown inside preview
    // frames during editing, and framing it is not a threat here.
    next();
  });

  /* ── the API ────────────────────────────────────────────────────────── */

  const api = express.Router();

  /**
   * API answers are personal data — an account, a garage, a list of people,
   * the sign-in log. They must never sit in a shared browser cache or a proxy
   * on the way back, so every one of them is marked uncacheable here rather
   * than remembered endpoint by endpoint.
   */
  api.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });

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

    // The sign-in log is personal data (an IP address and a browser string per
    // row). It is kept for AUTH_EVENT_RETENTION_DAYS and then deleted, whether
    // or not anybody looks at the dashboard. An hour after boot, then daily.
    if (config.authEventRetentionDays > 0) {
      const sweep = () => {
        const before = new Date(
          Date.now() - config.authEventRetentionDays * 24 * 60 * 60 * 1000,
        ).toISOString();
        getRepo()
          .then((repo) => repo.deleteAuthEventsBefore(before))
          .then((removed) => {
            if (removed > 0) {
              console.log(`[privacy] deleted ${removed} sign-in record(s) past the retention window`);
            }
          })
          .catch((error) => console.warn("[privacy] could not prune the sign-in log:", error.message));
      };
      setTimeout(sweep, 60 * 60 * 1000).unref?.();
      setInterval(sweep, 24 * 60 * 60 * 1000).unref?.();
    }

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

  /**
   * Liveness, plus where the schema stands.
   *
   * `schema` is the useful half during an upgrade: `installed` is what the
   * database has, `latest` what this code expects, and `pending` names the
   * versions still to run. A deploy can wait on it, and an operator can see
   * from outside whether an upgrade has finished — without the site having to
   * stop serving while it does.
   */
  api.get("/health", async (req, res) => {
    try {
      const repo = await getRepo();
      await repo.ping();
      let schema = null;
      try {
        schema = await repo.schemaStatus();
      } catch (error) {
        schema = { error: "Schema status is unavailable right now." };
      }
      res.json({
        ok: true,
        database: repo.kind,
        schema,
        time: new Date().toISOString(),
      });
    } catch (error) {
      res.status(503).json({ ok: false, error: "Database unreachable." });
    }
  });

  // Setup answers before any database-backed route: it must work when there
  // is no database at all.
  api.use(setupRouter);
  api.use(restoreRouter);
  api.use("/auth", authRouter);
  api.use(contentRouter);
  api.use(settingsRouter);
  api.use(mediaRouter);
  api.use(backupsRouter);
  api.use(mapsRouter);
  // A member's own garage and rides. Session-scoped, owner-scoped, and
  // deliberately apart from the site's content: nothing here publishes.
  api.use(memberRouter);
  api.use(alertsRouter);
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

  // Shipped media has one canonical copy in public/. Uploads still win.
  app.use(
    "/media",
    express.static(path.join(config.root, "public", "media"), {
      index: false,
      dotfiles: "deny",
      fallthrough: true,
      setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
    }),
  );

  // Preserve the previous public URL without retaining a second 1.7 MB file.
  app.get("/images/rider-kit-model.png", (req, res, next) => {
    res.sendFile(path.join(config.root, "public/images/rider-kit-model-reference-v2.png"),
      (error) => { if (error) next(error); });
  });
  app.use("/images", express.static(path.join(config.root, "public/images"), {
    index: false,
    dotfiles: "deny",
  }));

  app.get("/mobile-layout.css", (req, res, next) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(config.root, "public/mobile-layout.css"),
      (error) => { if (error) next(error); });
  });

  // Unlisted recovery entry: normal authentication and role checks still apply.
  // Redirect to the hash router so maintenance/countdown never intercept it.
  app.get("/commandcenter", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.redirect(302, "/#/commandcenter");
  });

  /* ── the built site ─────────────────────────────────────────────────── */

  const indexFile = path.join(config.distDir, "index.html");
  if (fs.existsSync(config.distDir)) {
    const sendDocument = siteDocument(indexFile);
    app.get(["/", "/index.html"], sendDocument);
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
      sendDocument(req, res, next);
    });
  } else {
    app.get("/", (req, res) =>
      res
        .status(503)
        .type("text/plain")
        .send("The prebuilt website is missing. Restore dist/ from the application package and restart the server."),
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

    // A route that says what is wrong with the input, and how wrong: these are
    // the sentences a person reads and acts on, not a stack trace.
    const stated = Number(error?.status);
    if (Number.isInteger(stated) && stated >= 400 && stated < 500) {
      return res.status(stated).json({ error: error.message });
    }

    // The code is ahead of the database: this deploy arrived before its
    // migration, or an upgrade is still running. The rest of the site is
    // untouched and still serving, so this is a "not yet", not a failure —
    // 503 with a sentence a person can act on, instead of a 500 that suggests
    // something is broken.
    if (isMissingSchema(error)) {
      console.warn(`[${req.method} ${req.originalUrl}] schema is behind the code:`, error.message);
      return res.status(503).json({
        error: "The database is still being upgraded for this feature. Try again in a minute.",
        code: "schema_pending",
      });
    }

    console.error(`[${req.method} ${req.originalUrl}]`, redactForLog(error));
    res.status(500).json({
      error: "Something went wrong on the server.",
      ...(config.nodeEnv !== "production" && error?.message ? { detail: error.message } : {}),
    });
  });

  return app;
}
