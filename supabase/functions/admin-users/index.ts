import { createClient, type User } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";

type Profile = {
  id: string;
  username: string;
  role: "member" | "super_admin";
  created_by_admin: boolean;
};

function authUserShape(user: User, profile?: Profile | null) {
  return {
    id: user.id,
    email: user.email ?? "",
    username: profile?.username ?? (typeof user.user_metadata?.username === "string" ? user.user_metadata.username : ""),
    createdAt: user.created_at,
    emailConfirmedAt: user.email_confirmed_at ?? null,
    createdByAdmin: profile?.created_by_admin ?? false,
    role: profile?.role === "super_admin" ? "super_admin" : "member",
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!projectUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Authentication service is not configured." }, 500);
  }

  const authorization = request.headers.get("Authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return jsonResponse({ error: "Sign in with a super-admin account." }, 401);

  const caller = createClient(projectUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser(accessToken);
  if (userError || !userData.user) return jsonResponse({ error: "Your session is invalid or expired. Sign in again." }, 401);

  const admin = createClient(projectUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: callerProfile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) return jsonResponse({ error: "Unable to validate admin permissions." }, 500);
  if (callerProfile?.role !== "super_admin") {
    return jsonResponse({ error: "Super-admin access required." }, 403);
  }

  let body: { action?: unknown; username?: unknown; email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400);
  }

  if (body.action === "list") {
    try {
      const authUsers: User[] = [];
      let page = 1;
      const perPage = 1000;
      while (true) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
        if (error) return jsonResponse({ error: "Unable to load registered users." }, 500);
        authUsers.push(...data.users);
        if (data.users.length < perPage) break;
        page += 1;
      }

      if (authUsers.length === 0) return jsonResponse({ users: [] });
      const { data: profiles, error: profilesError } = await admin
        .from("profiles")
        .select("id, username, role, created_by_admin")
        .in("id", authUsers.map((user) => user.id));
      if (profilesError) return jsonResponse({ error: "Unable to load user profiles." }, 500);

      const profileById = new Map<string, Profile>((profiles ?? []).map((profile) => [profile.id, profile as Profile]));
      const users = authUsers
        .map((user) => authUserShape(user, profileById.get(user.id)))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return jsonResponse({ users });
    } catch {
      return jsonResponse({ error: "Unable to load registered users." }, 500);
    }
  }

  if (body.action === "create") {
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return jsonResponse({ error: "Username must be 3–24 characters using letters, numbers, or underscores." }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: "Enter a valid email address." }, 400);
    if (password.length < 8) return jsonResponse({ error: "Password must be at least 8 characters." }, 400);

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username },
    });
    if (error || !data.user) {
      return jsonResponse({ error: error?.message ?? "Unable to create this account." }, 400);
    }

    // The auth.users trigger created a private profile. Only the server function
    // can mark it as admin-created; client-controlled user metadata is not trusted.
    const { error: updateError } = await admin
      .from("profiles")
      .update({ created_by_admin: true })
      .eq("id", data.user.id);
    if (updateError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return jsonResponse({ error: "The account could not be finalized; no account was kept." }, 500);
    }

    return jsonResponse({ user: authUserShape(data.user, {
      id: data.user.id,
      username,
      role: "member",
      created_by_admin: true,
    }) }, 201);
  }

  return jsonResponse({ error: "Unknown action." }, 400);
});
