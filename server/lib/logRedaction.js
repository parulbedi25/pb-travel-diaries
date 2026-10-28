/**
 * Keep secrets and personal data out of the server log.
 *
 * Logs are the least protected copy of anything: they are tailed in a terminal,
 * mailed to an address, pasted into a chat when something breaks, and kept far
 * longer than the request they describe. A database error is the usual way a
 * password reaches one — a connection string, a failing INSERT echo, a driver
 * message that quotes the row it could not write.
 *
 * This takes whatever is about to be logged and replaces the *values* that
 * belong to a person or a credential, keeping the shape of the message so the
 * log still says what went wrong.
 */

/** Field names whose value must never appear in a log line. */
const SECRET_KEYS = [
  "password",
  "passwd",
  "passphrase",
  "pwd",
  "secret",
  "token",
  "sessiontoken",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "set-cookie",
  "privatekey",
  "passwordhash",
  "password_hash",
];

/** Personal fields: worth knowing *that* the query had one, never its value. */
const PERSONAL_KEYS = ["email", "phone", "ip", "address"];

const redactValue = (key, value) => {
  const name = String(key).toLowerCase();
  if (SECRET_KEYS.some((secret) => name.includes(secret))) return "[redacted]";
  if (PERSONAL_KEYS.some((personal) => name.includes(personal))) return "[redacted]";
  return value;
};

/**
 * `password: "hunter2"`, `"password=hunter2"`, `passwordHash: '$2b$10$…'` and
 * friends — in JSON, form bodies, connection strings and query text alike.
 */
export function redactText(text) {
  if (typeof text !== "string") return text;
  let out = text;

  // key: "value" / key=value / key: 'value' / "key":"value"
  const keyed = new RegExp(
    `(["']?)\\b(${[...SECRET_KEYS, ...PERSONAL_KEYS].join("|")})\\b\\1\\s*[:=]\\s*("[^"]*"|'[^']*'|[^\\s,;&)}\\]]+)`,
    "gi"
  );
  out = out.replace(keyed, (_match, quote, key) => `${quote}${key}${quote}=[redacted]`);

  // mysql://user:password@host and postgres://…
  out = out.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:/@\s]+:)([^@\s]+)(@)/gi, "$1[redacted]$3");

  // An authorisation header's payload, and a bare JSON Web Token, which is a
  // working session if it reaches a log.
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  out = out.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[redacted-token]");
  // A truncated one is no better: every JWT starts with the same header.
  out = out.replace(/\beyJ[A-Za-z0-9_-]{4,}/g, "[redacted-token]");

  // A bare email address — a driver message often quotes the row it refused.
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]");

  // A bare address, which is personal data wherever it appears.
  out = out.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "[redacted-ip]");
  out = out.replace(/\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi, "[redacted-ip]");

  // A bcrypt hash is a password-equivalent even without a field name beside it.
  out = out.replace(/\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}/g, "[redacted-hash]");

  return out;
}

/**
 * A loggable form of an error (or any value): message and stack, with secrets
 * and personal data taken out. Database drivers attach the parameters they
 * could not write, which is exactly the case this exists for.
 */
export function redactForLog(value) {
  if (value instanceof Error) {
    const safe = new Error(redactText(value.message));
    safe.name = value.name;
    if (value.code) safe.code = value.code;
    if (value.stack) safe.stack = redactText(value.stack);
    // Driver metadata can carry the offending row.
    if (value.sqlMessage) safe.sqlMessage = redactText(String(value.sqlMessage));
    return safe;
  }
  if (typeof value === "object" && value !== null) {
    try {
      return redactText(JSON.stringify(value));
    } catch {
      return "[unserialisable value]";
    }
  }
  return redactText(String(value));
}

export { redactValue };
