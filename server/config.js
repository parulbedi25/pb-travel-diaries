import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

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
 * Everything the server reads from the environment.
 *
 * Hosting panels (cPanel/Passenger, Plesk, Docker) usually want these set in
 * their own UI rather than a .env file — both work, the panel wins because it
 * sets real environment variables.
 */
export const config = {
  root,
  port: int(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  /** Where the built site lives. `npm run build` writes here. */
  distDir: path.resolve(root, process.env.DIST_DIR || "dist"),
  /**
   * Uploads live outside the built site so they survive a rebuild and can be
   * backed up as one folder. Defaults to ./media in the project root.
   */
  mediaDir: path.resolve(root, process.env.MEDIA_DIR || "media"),
  /** Set to "memory" for tests — no database needed. */
  dbDriver: process.env.DB_DRIVER || "mysql",
  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || "pb",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "pb_travel_diaries",
    connectionLimit: int(process.env.DB_POOL_SIZE, 5),
    /** Namecheap/cPanel databases often need this on shared plans. */
    socketPath: process.env.DB_SOCKET || undefined,
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
  /** Behind Passenger/Plesk/Nginx the real IP and protocol arrive in headers. */
  trustProxy: bool(process.env.TRUST_PROXY, true),
  /** Requests per minute per IP across the whole API. 0 turns it off. */
  rateLimitPerMinute: int(process.env.RATE_LIMIT_PER_MINUTE, 240),
  /**
   * Usernames allowed to sign up after the first account exists. Empty means
   * "nobody" — new accounts are then created from the dashboard instead.
   */
  allowSignup: bool(process.env.ALLOW_PUBLIC_SIGNUP, false),
};
