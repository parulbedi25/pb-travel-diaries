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
const apiBase = (): string => {
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
  const base = apiBase();
  if (!base) return url;
  if (url === "/api/setup" || url.startsWith("/api/setup/")) return url;
  return `${base}${url}`;
}

/** Whether this page has an API somewhere other than its own folder. */
export const hasApiBase = (): boolean => apiBase() !== "";

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
