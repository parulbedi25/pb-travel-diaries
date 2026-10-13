import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";

const invalidCredentials = () => jsonResponse({ error: "Invalid username/email or password." }, 401);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!projectUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Authentication service is not configured." }, 500);
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400);
  }

  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[a-z0-9_]{3,24}$/.test(username) || !password) return invalidCredentials();

  const admin = createClient(projectUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Resolve usernames only on the server: never return the matching email to the browser.
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (profileError) return jsonResponse({ error: "Unable to sign in right now." }, 500);
  if (!profile?.id) return invalidCredentials();

  const { data: userResult, error: userError } = await admin.auth.admin.getUserById(profile.id);
  const email = userResult.user?.email;
  if (userError || !email) return invalidCredentials();

  // Delegate password validation, email-confirmation enforcement, and token
  // issuance to Supabase Auth. Only the resulting session tokens are returned.
  const authResponse = await fetch(`${projectUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!authResponse.ok) return invalidCredentials();

  const authData = await authResponse.json().catch(() => null) as {
    access_token?: string;
    refresh_token?: string;
  } | null;
  if (!authData?.access_token || !authData.refresh_token) return invalidCredentials();

  return jsonResponse({
    access_token: authData.access_token,
    refresh_token: authData.refresh_token,
  });
});
