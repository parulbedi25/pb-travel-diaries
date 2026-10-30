import { markApiSeen } from "../utils/staticSite";

/**
 * One place for every request to the server.
 *
 * The dashboard used to write straight into the browser; it now talks to the
 * API in server/. Keeping the fetch details here means the storage hooks only
 * deal in domain values, and error messages stay consistent.
 */

export class ApiError extends Error {
  status: number;
  /**
   * The server's machine-readable reason, when it sent one.
   *
   * `schema_pending` is the one callers check today: the database is still
   * being upgraded for the feature that was asked for, so the right response is
   * to wait and try again rather than to report a fault.
   */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Turn any failure into something worth showing a person. */
const describe = (error: unknown): string => {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "Cannot reach the server. Check your connection.";
  return error instanceof Error ? error.message : "Something went wrong.";
};

/**
 * Where the API lives, when it is not this folder.
 *
 * A static deployment has two programs behind one address: Apache serves the
 * files, the Node app serves `/api/…` from a subfolder. The export writes that
 * subfolder into the page as `window.__PB_API_BASE__`; a Node deployment writes
 * nothing, and every call stays relative.
 */
export const apiBase = (): string => {
  if (typeof window === "undefined") return "";
  const base = (window as { __PB_API_BASE__?: unknown }).__PB_API_BASE__;
  if (typeof base !== "string") return "";
  return base.replace(/\/+$/, "");
};

/**
 * The address a call should go to.
 *
 * Setup is the one exception: it is the bootstrap on this very folder — the PHP
 * file on a static deployment, the Node app on a Node one — so it always stays
 * same-origin, even when everything afterwards goes to the API.
 */
export function apiUrl(url: string): string {
  // An address that is already absolute is left exactly as it is: the caller
  // has said where it wants to go, and prefixing it again would produce
  // `/serverhttps://…`.
  if (/^https?:\/\//i.test(url)) return url;
  const base = apiBase();
  if (!base) return url;
  if (url === "/api/setup" || url.startsWith("/api/setup/")) return url;
  return `${base}${url}`;
}

/** Whether this page has an API somewhere other than its own folder. */
export const hasApiBase = (): boolean => apiBase() !== "";

/** The setup marker the export writes: `"php"` when the folder carries api.php. */
const setupEngine = (): string => {
  if (typeof window === "undefined") return "";
  const engine = (window as { __PB_SETUP__?: unknown }).__PB_SETUP__;
  return typeof engine === "string" ? engine : "";
};

/** Whether this folder is supposed to have a PHP bootstrap in it. */
export const hasPhpSetup = (): boolean => setupEngine() === "php";

/**
 * Calls the setup step, on whichever spelling of the address this host gives.
 *
 * Setup is the one thing PHP does, and it must work on a host whose Apache
 * ignores `.htaccess` — a shared plan with `AllowOverride` off, or a file
 * manager that hid the dotfile and never uploaded it. So the tidy address is
 * tried first and the two rewrite-free spellings after it; the one that answered
 * is remembered, so the remaining steps go straight there.
 *
 * Nothing else uses this. The site's API is the Node app, and it is reached
 * through the `API_BASE` address the export baked in.
 */
let setupSpelling: string | null = null;

const setupCandidates = (path: string): string[] => {
  // Two different pieces of the same address, and confusing them produced
  // `/api/setup/setup/status`: `step` is the whole route (`setup/status`, which
  // is what `?route=` wants) and `leaf` is only its last part (what every
  // spelling shares and what the remembered template stands in for).
  const step = path.replace(/^\/api\//, "");
  const leaf = path.split("/").pop() ?? step;
  const listed = [path, `/api.php?route=${step}`, `/api.php/${step}`];
  if (setupSpelling) return [setupSpelling.replace("{leaf}", leaf), ...listed];
  return listed;
};

/** What one attempt actually came back with — the words that diagnose it. */
export interface SetupAttempt {
  url: string;
  status: number;
  contentType: string;
  /** The first line of the body, harmless HTML reduced to its text. */
  sample: string;
}

export class SetupUnreachable extends ApiError {
  attempts: SetupAttempt[];
  constructor(message: string, attempts: SetupAttempt[]) {
    super(message, 0, "setup_unreachable");
    this.name = "SetupUnreachable";
    this.attempts = attempts;
  }
}

/** A body, as a person would read it: tags stripped, whitespace collapsed. */
const readable = (text: string): string =>
  text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

export async function setupCall<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const attempts: SetupAttempt[] = [];
  for (const url of setupCandidates(path)) {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: body === undefined ? { accept: "application/json" } : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      attempts.push({ url, status: 0, contentType: "", sample: "the request itself failed" });
      continue;
    }

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    // A host without PHP answers with its own HTML, with an empty body, or with
    // a download: try the next spelling rather than reporting "the server said
    // 200". Each answer is kept, because "empty" and "a page" and "404" are
    // three different faults and the screen can only help if it says which.
    if (!payload || typeof payload !== "object") {
      attempts.push({
        url,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        sample: readable(text) || (text ? "(a file, not a page)" : "(empty response)"),
      });
      continue;
    }

    // Remember which spelling worked, as a template: the three forms differ
    // only in the last segment, so that is what is replaced on the way back.
    setupSpelling = url.replace(/[^/?]+$/, "{leaf}");

    if (!response.ok) {
      const answer = payload as { error?: string; code?: string };
      throw new ApiError(
        answer.error ?? `The setup step answered ${response.status}.`,
        response.status,
        answer.code,
      );
    }
    return payload as T;
  }

  // Every spelling failed. Say what each one answered: that is the diagnosis.
  const summary = attempts
    .map((a) => `${a.url} → ${a.status || "no answer"}${a.sample ? ` · ${a.sample}` : ""}`)
    .join("\n");
  throw new SetupUnreachable(
    `The PHP setup file did not answer. ${attempts.length} address(es) tried:\n${summary}`,
    attempts,
  );
}

/** Asks the file itself what it sees — only meaningful when it answered at all. */
export async function phpDiagnosis<T>(): Promise<T | null> {
  for (const url of ["/api.php?route=diag", "/api/setup/diag"]) {
    try {
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) continue;
      const payload = (await response.json()) as T;
      if (payload && typeof payload === "object") return payload;
    } catch {
      // Not this spelling either.
    }
  }
  return null;
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(url), {
      method,
      // The session is an httpOnly cookie; it must travel with every call.
      // "include" rather than "same-origin" because the API may be the Node app
      // in a subfolder — still the same site, but the browser counts cookies by
      // origin, and only "include" sends them there.
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError(describe(error), 0);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  // A real answer: this deployment has a server, whatever the page guessed
  // from a 404 earlier. The one exception is the bootstrap on a static folder,
  // which says plainly that it is setup-only — that is not an API.
  const setupOnly = (payload as { code?: string } | null)?.code === "setup-only";
  if (response.status < 500 && !setupOnly) markApiSeen();

  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ??
      (response.status === 401
        ? "Sign in to continue."
        : `The server answered ${response.status}.`);
    throw new ApiError(message, response.status, (payload as { code?: string } | null)?.code);
  }

  return payload as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body),
  delete: <T>(url: string) => request<T>("DELETE", url),

  /**
   * Uploads use multipart, so they bypass the JSON helper above. `method` is
   * "POST" for a new file and "PUT" when replacing the bytes of an existing one.
   */
  async upload<T>(url: string, file: File, field = "file", method: "POST" | "PUT" = "POST"): Promise<T> {
    const form = new FormData();
    form.append(field, file, file.name);
    let response: Response;
    try {
      response = await fetch(apiUrl(url), { method, body: form, credentials: "include" });
    } catch (error) {
      throw new ApiError(describe(error), 0);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(
        (payload as { error?: string } | null)?.error ?? `Upload failed (${response.status}).`,
        response.status,
      );
    }
    return payload as T;
  },
};

export { describe as describeApiError };
