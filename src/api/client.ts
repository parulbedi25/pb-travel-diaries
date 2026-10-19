/**
 * One place for every request to the server.
 *
 * The dashboard used to write straight into the browser; it now talks to the
 * API in server/. Keeping the fetch details here means the storage hooks only
 * deal in domain values, and error messages stay consistent.
 */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Turn any failure into something worth showing a person. */
const describe = (error: unknown): string => {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "Cannot reach the server. Check your connection.";
  return error instanceof Error ? error.message : "Something went wrong.";
};

async function request<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      // The session is an httpOnly cookie; it must travel with every call.
      credentials: "same-origin",
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

  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ??
      (response.status === 401
        ? "Sign in to continue."
        : `The server answered ${response.status}.`);
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body),
  delete: <T>(url: string) => request<T>("DELETE", url),

  /** Uploads use multipart, so they bypass the JSON helper above. */
  async upload<T>(url: string, file: File, field = "file"): Promise<T> {
    const form = new FormData();
    form.append(field, file, file.name);
    let response: Response;
    try {
      response = await fetch(url, { method: "POST", body: form, credentials: "same-origin" });
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
