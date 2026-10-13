import { createClient } from "@supabase/supabase-js";

const projectUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

export const supabaseConfigured = Boolean(projectUrl && anonKey);

/** The anonymous/public key is safe in the browser; never put a service-role key here. */
export const supabaseClient = supabaseConfigured
  ? createClient(projectUrl, anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireSupabase() {
  if (!supabaseClient) {
    throw new Error("Account sign-in is not configured yet. Add the Supabase URL and public anon key to the app environment.");
  }
  return supabaseClient;
}

/**
 * Supabase only authenticates email/password directly. Usernames are resolved
 * server-side by the username-login Edge Function so email addresses are never
 * exposed through a public username lookup.
 */
export async function signInWithIdentifier(identifier: string, password: string): Promise<void> {
  const client = requireSupabase();
  const value = identifier.trim();
  if (value.includes("@")) {
    const { error } = await client.auth.signInWithPassword({ email: value, password });
    if (error) throw error;
    return;
  }

  const { data, error } = await client.functions.invoke<{
    access_token: string;
    refresh_token: string;
  }>("username-login", {
    body: { username: value.toLowerCase(), password },
  });
  if (error || !data?.access_token || !data.refresh_token) {
    throw new Error("Invalid username/email or password. If you just registered, confirm your email first.");
  }

  const { error: sessionError } = await client.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sessionError) throw sessionError;
}

/** Supabase Auth confirms the email, then sends the browser back to this SPA. */
export function emailConfirmationRedirectTo(): string {
  return `${window.location.origin}/?auth=verified`;
}

/** Extracts a safe message returned by a Supabase Edge Function, if available. */
export async function edgeFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (typeof error === "object" && error !== null && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const body = (await context.clone().json()) as { error?: unknown; message?: unknown };
        if (typeof body.error === "string") return body.error;
        if (typeof body.message === "string") return body.message;
      } catch {
        // Use the SDK error below when the response has no JSON body.
      }
    }
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
