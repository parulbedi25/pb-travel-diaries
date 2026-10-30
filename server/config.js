import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { readInstall } from "./lib/installFile.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

dotenv.config({ path: path.join(root, ".env") });

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (value, fallback) => {
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
};

/**
 * Where the app should listen.
 *
 * cPanel's "Setup Node.js App" — and every other panel built on Phusion
 * Passenger — does not give the app a fixed port. It sets `PORT` to whatever
 * it has arranged, which is usually the path of a Unix socket it created
 * (`/tmp/passenger.../socket`) and occasionally a plain port number. Both are
 * valid arguments to `server.listen`, so both are kept: a bare number becomes
 * a number, anything else is passed through untouched.
 *
 * Coercing this with `parseInt` would turn that socket path into `NaN` and
 * drop the app on 4000, a port Passenger never forwards to — the deployment
 * would answer 503 with no error to go on.
 */
const listenTarget = (value, fallback) => {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : raw;
};

/**
 * The setup screen saves its answers in `data/install.json`. Read once at
 * boot; `applyInstall` updates this object after a setup completes so the
 * running process starts using the new database without a restart.
 *
 * Environment variables win over the file: a hosting panel that sets DB_* is
 * the operator speaking more recently than a file the installer wrote.
 */
const savedInstall = readInstall();
const envSaysDatabase = ["DB_HOST", "DB_NAME", "DB_USER"].some(
  (key) => process.env[key] !== undefined,
);
const driver = process.env.DB_DRIVER || (envSaysDatabase ? "mysql" : savedInstall?.db?.driver || "mysql");

/**
 * Everything the server reads from the environment.
 *
 * Hosting panels (Passenger, Plesk, Docker, systemd) usually want these set in
 * their own UI rather than a .env file — both work, the panel wins because it
 * sets real environment variables.
 */
export const config = {
  root,
  /** A number for a TCP port, a string for a socket path — see `listenTarget`. */
  port: listenTarget(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  /** Where the built site lives. `npm run build` writes here. */
  distDir: path.resolve(root, process.env.DIST_DIR || "dist"),
  /**
   * Uploads live outside the built site so they survive a rebuild and can be
   * backed up as one folder. Defaults to ./media in the project root.
   */
  mediaDir: path.resolve(root, process.env.MEDIA_DIR || "media"),
  /** Set to "memory" for tests — no database needed. */
  dbDriver: driver,
  /** False until either the installer or the environment supplies a database. */
  hasDatabase: driver === "memory" || driver === "sqlite" || Boolean(savedInstall?.db) || envSaysDatabase,
  /** Shown on the setup screen and in the page title before the DB exists. */
  siteTitle:
    String(process.env.SITE_TITLE ?? "").trim() || savedInstall?.siteTitle || "PB Travel Diaries",
  db: {
    host: process.env.DB_HOST || savedInstall?.db?.host || "127.0.0.1",
    port: int(process.env.DB_PORT || savedInstall?.db?.port, 3306),
    user: process.env.DB_USER || savedInstall?.db?.user || "pb",
    password: process.env.DB_PASSWORD ?? savedInstall?.db?.password ?? "",
    database: process.env.DB_NAME || savedInstall?.db?.database || "pb_travel_diaries",
    connectionLimit: int(process.env.DB_POOL_SIZE, 5),
    /** Some shared plans expose a socket instead of a host and port. */
    socketPath: process.env.DB_SOCKET || savedInstall?.db?.socketPath || undefined,
  },
  session: {
    cookie: process.env.SESSION_COOKIE || "pb_session",
    /** How long a login lasts before it has to be repeated. */
    days: int(process.env.SESSION_DAYS, 7),
    /**
     * "auto" marks the cookie Secure whenever the request arrived over HTTPS.
     * Set COOKIE_SECURE=true if TLS terminates somewhere that hides that.
     */
    secure: process.env.COOKIE_SECURE === undefined ? "auto" : bool(process.env.COOKIE_SECURE, false),
  },
  /** Bcrypt cost. 10 is a good compromise on a shared CPU; 12 costs ~4x. */
  bcryptRounds: int(process.env.BCRYPT_ROUNDS, 10),
  /** Largest upload accepted, in megabytes. */
  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 25),
  /**
   * The daily backup.
   *
   * A zip is written to ./backup (created on first use, at the app's root)
   * every day at BACKUP_HOUR, and only the newest BACKUP_KEEP are kept. The
   * archive holds the database contents as a standalone `pb-restore.json`
   * importer, the uploaded media, and the application files.
   */
  backup: {
    enabled: bool(process.env.BACKUP_ENABLED, true),
    /** Local hour (0–23) the daily run should happen. Default: 2am. */
    hour: Math.min(23, Math.max(0, int(process.env.BACKUP_HOUR, 2))),
    /** How many zips to keep. The rest are deleted oldest-first. */
    keep: Math.max(1, int(process.env.BACKUP_KEEP, 10)),
    /** `backup/` at the project root unless told otherwise. */
    dir: path.resolve(root, process.env.BACKUP_DIR || "backup"),
    /** Include the app's own files (server/, dist/, public/, src/…) in the zip. */
    includeApp: bool(process.env.BACKUP_INCLUDE_APP, true),
  },
  /** Largest backup archive accepted by the restore screen, in megabytes. */
  maxRestoreMb: int(process.env.MAX_RESTORE_MB, 2048),
  /** Behind Passenger/Plesk/Nginx the real IP and protocol arrive in headers. */
  trustProxy: bool(process.env.TRUST_PROXY, true),
  /**
   * The folder this app answers under, when it is not the domain root.
   *
   * On a static deployment the website is a folder of files served by Apache
   * and this app answers `/api/…` from a subfolder — `BASE_PATH=/server`. The
   * prefix is stripped on the way in, so every route, every cookie path and
   * every link is written as if the app were at the root; empty means it is.
   */
  basePath: (() => {
    const raw = String(process.env.BASE_PATH ?? "").trim().replace(/\/+$/, "");
    if (!raw) return "";
    return raw.startsWith("/") ? raw : `/${raw}`;
  })(),
  /** Requests per minute per IP across the whole API. 0 turns it off. */
  rateLimitPerMinute: int(process.env.RATE_LIMIT_PER_MINUTE, 240),
  /**
   * How long the sign-in log is kept, in days.
   *
   * Each row holds an IP address and a browser string — personal data held for
   * one purpose (noticing an attack on the account) and deleted once that is
   * no longer plausible. 0 keeps it forever, which is not recommended.
   */
  authEventRetentionDays: Math.max(0, int(process.env.AUTH_EVENT_RETENTION_DAYS, 180)),
  /**
   * Usernames allowed to sign up after the first account exists. This is only
   * the fallback: the dashboard's "Allow public sign-up" setting, stored in
   * the database, is what actually decides once the site is installed.
   */
  allowSignup: bool(process.env.ALLOW_PUBLIC_SIGNUP, false),
};

/**
 * Adopt the answers the setup screen just saved. Mutates the live config, so
 * the repository (reset by the caller) opens against the new database.
 */
export function applyInstall(answers) {
  if (!answers) return config;
  if (answers.siteTitle) config.siteTitle = answers.siteTitle;
  if (answers.db) {
    config.dbDriver = process.env.DB_DRIVER || answers.db.driver || "mysql";
    config.db.host = answers.db.host;
    config.db.port = int(answers.db.port, 3306);
    config.db.user = answers.db.user;
    config.db.password = answers.db.password ?? "";
    config.db.database = answers.db.database;
    config.db.socketPath = answers.db.socketPath || undefined;
    config.hasDatabase = true;
  }
  return config;
}
