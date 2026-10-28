import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { getRepo } from "../db/index.js";

/* ────────────────────────────── passwords ────────────────────────────── */

/**
 * bcrypt, deliberately slow. The cost is configurable because a shared
 * shared plan and a VPS should not use the same work factor.
 */
export function hashPassword(password) {
  return bcrypt.hash(password, config.bcryptRounds);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/** Rules for a password the dashboard will accept. */
export function passwordProblem(password) {
  if (typeof password !== "string" || password.length < 8) {
    return "Use at least 8 characters.";
  }
  if (password.length > 200) return "Use at most 200 characters.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Include at least one letter and one number.";
  }
  return null;
}

export function normaliseUsername(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function usernameProblem(username) {
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
    return "Use 3–64 characters: letters, numbers, dot, dash or underscore.";
  }
  return null;
}

/* ────────────────────────────── sessions ─────────────────────────────── */

/**
 * The cookie carries 32 random bytes. Only the SHA-256 of the token is stored,
 * so a database dump cannot be turned into a working login.
 */
export function newSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function sessionExpiry() {
  return new Date(Date.now() + config.session.days * 24 * 60 * 60 * 1000);
}

function cookieOptions(req) {
  const secure =
    config.session.secure === "auto" ? req.secure : config.session.secure === true;
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: config.session.days * 24 * 60 * 60 * 1000,
  };
}

export async function startSession(req, res, user) {
  const repo = await getRepo();
  const token = newSessionToken();
  await repo.createSession({
    tokenHash: hashToken(token),
    userId: user.id,
    expiresAt: sessionExpiry(),
    ip: clientIp(req),
    userAgent: req.get("user-agent") ?? null,
  });
  res.cookie(config.session.cookie, token, cookieOptions(req));
  return token;
}

export async function endSession(req, res) {
  const repo = await getRepo();
  const token = readToken(req);
  if (token) await repo.deleteSession(hashToken(token));
  res.clearCookie(config.session.cookie, { path: "/", httpOnly: true, sameSite: "lax" });
}

function readToken(req) {
  return req.cookies?.[config.session.cookie] ?? null;
}

/** The signed-in user for this request, or null. */
export async function currentUser(req) {
  const token = readToken(req);
  if (!token) return null;
  const repo = await getRepo();
  const session = await repo.findSession(hashToken(token));
  return session?.user ?? null;
}

/** 401 unless signed in. Attaches `req.user`. */
export async function requireUser(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to continue." });
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/** True for the accounts that may change the site. Readers may not. */
export function isEditor(user) {
  return Boolean(user) && (user.role === "owner" || user.role === "admin");
}

/**
 * 401 unless signed in, 403 for read-only accounts. Every write and every
 * account-management call uses this; readers keep only what they signed up
 * for — the members-only parts of the public site.
 */
export async function requireEditor(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to continue." });
    if (!isEditor(user)) {
      return res.status(403).json({ error: "This account has read-only access." });
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * 403 unless the account is the owner.
 *
 * A backup carries every account's password hash, every email address and the
 * database password; the access log carries every visitor's IP address; the
 * account list is people's personal details. An admin edits the website —
 * that is a different job from holding everyone's data, so these stay with the
 * one account that owns the site. The owner is the first account created and
 * cannot be demoted from the dashboard.
 */
export async function requireOwner(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to continue." });
    if (user.role !== "owner") {
      return res.status(403).json({ error: "Only the site owner can do that." });
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/** True for the one account that owns the site. */
export function isOwner(user) {
  return Boolean(user) && user.role === "owner";
}

/**
 * Whether the public sign-up page is open. The dashboard setting wins; the
 * environment variable is the fallback for a database created before the
 * setting existed.
 */
export async function signupAllowed(repo) {
  const raw = await repo.getSetting("allow_signup");
  if (raw == null) return config.allowSignup;
  try {
    return JSON.parse(raw) !== false;
  } catch {
    return config.allowSignup;
  }
}

/* ─────────────────────────── request context ─────────────────────────── */

/**
 * The real client address. Behind Passenger/Apache this is only truthful when
 * `trust proxy` is on, which app.js sets from TRUST_PROXY.
 */
export function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "").slice(0, 64);
}

export async function recordEvent(req, { userId, username, event, detail }) {
  const repo = await getRepo();
  try {
    await repo.recordAuthEvent({
      userId: userId ?? null,
      username: username ?? "",
      event,
      ip: clientIp(req),
      userAgent: req.get("user-agent") ?? null,
      detail: detail ?? null,
    });
  } catch (error) {
    // Never let an audit write fail the request it describes.
    console.error("[auth-events]", error.message);
  }
}

/* ────────────────────────── login rate limiting ───────────────────────── */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map();

export function noteFailedAttempt(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return;
  }
  entry.count += 1;
}

export function clearAttempts(key) {
  attempts.delete(key);
}

export function tooManyAttempts(key) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

/** Called on a timer, so the map cannot grow without bound. */
export function pruneAttempts() {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now - entry.first > WINDOW_MS) attempts.delete(key);
  }
}
