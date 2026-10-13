import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { Check, CircleAlert, CircleUserRound, Clock3, LoaderCircle, LogOut, Plus, RefreshCw, ShieldCheck, UserPlus, Users } from "lucide-react";
import {
  edgeFunctionErrorMessage,
  requireSupabase,
  signInWithIdentifier,
  supabaseClient,
  supabaseConfigured,
} from "../auth/supabase";

type ManagedUser = {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  emailConfirmedAt: string | null;
  createdByAdmin: boolean;
  role: "member" | "super_admin";
};

type UserFilter = "all" | "pending" | "verified" | "admin";

const inputClass =
  "min-w-0 rounded-xl border border-white/10 bg-ink-950/60 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-saffron-400/60 focus:ring-2 focus:ring-saffron-400/15";

function statusOf(user: ManagedUser): Exclude<UserFilter, "all"> {
  if (user.createdByAdmin) return "admin";
  return user.emailConfirmedAt ? "verified" : "pending";
}

function statusLabel(status: Exclude<UserFilter, "all">): string {
  if (status === "pending") return "Pending verification";
  if (status === "verified") return "Email verified";
  return "Created by admin";
}

function statusClass(status: Exclude<UserFilter, "all">): string {
  if (status === "pending") return "border-amber-400/20 bg-amber-400/10 text-amber-200";
  if (status === "verified") return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
  return "border-saffron-400/25 bg-saffron-400/10 text-saffron-200";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function UserManagementPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [filter, setFilter] = useState<UserFilter>("all");
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    if (!supabaseClient) {
      setCheckingSession(false);
      return;
    }
    let active = true;
    void supabaseClient.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setCheckingSession(false);
      }
    });
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setCheckingSession(false);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadUsers = useCallback(async () => {
    if (!supabaseClient) return;
    setLoadingUsers(true);
    setNotice(null);
    const { data, error } = await supabaseClient.functions.invoke<{ users: ManagedUser[] }>("admin-users", {
      body: { action: "list" },
    });
    setLoadingUsers(false);
    if (error) {
      const message = await edgeFunctionErrorMessage(error, "Could not load registered accounts.");
      const status = typeof error === "object" && error !== null && "context" in error
        && (error as { context?: unknown }).context instanceof Response
        ? ((error as { context: Response }).context.status)
        : 0;
      if (status === 401 || status === 403 || /super.?admin|not authorized/i.test(message)) {
        setAuthorized(false);
        setUsers([]);
        setNotice({ tone: "error", text: "This Supabase account is not a super admin. Have an owner bootstrap its role, then sign in again." });
      } else {
        setAuthorized(null);
        setNotice({ tone: "error", text: message });
      }
      return;
    }
    setAuthorized(true);
    setUsers(data?.users ?? []);
  }, []);

  useEffect(() => {
    if (session) {
      void loadUsers();
    } else {
      setAuthorized(null);
      setUsers([]);
    }
  }, [session, loadUsers]);

  const counts = useMemo(() => ({
    all: users.length,
    pending: users.filter((user) => statusOf(user) === "pending").length,
    verified: users.filter((user) => statusOf(user) === "verified").length,
    admin: users.filter((user) => statusOf(user) === "admin").length,
  }), [users]);
  const visibleUsers = useMemo(
    () => users.filter((user) => filter === "all" || statusOf(user) === filter),
    [users, filter]
  );

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await signInWithIdentifier(identifier, loginPassword);
      setLoginPassword("");
      setNotice({ tone: "info", text: "Checking super-admin access…" });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Unable to sign in." });
    } finally {
      setBusy(false);
    }
  };

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
      setNotice({ tone: "error", text: "Username must be 3–24 characters using letters, numbers, or underscores." });
      return;
    }
    if (newPassword.length < 8) {
      setNotice({ tone: "error", text: "Use a temporary password with at least 8 characters." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const client = requireSupabase();
      const { error } = await client.functions.invoke("admin-users", {
        body: {
          action: "create",
          username: normalizedUsername,
          email: email.trim().toLowerCase(),
          password: newPassword,
        },
      });
      if (error) throw new Error(await edgeFunctionErrorMessage(error, "Could not create the account."));
      setUsername("");
      setEmail("");
      setNewPassword("");
      await loadUsers();
      setNotice({ tone: "success", text: "Account created and email marked as confirmed. Share the initial password with the user securely." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not create the account." });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (!supabaseClient) return;
    setBusy(true);
    const { error } = await supabaseClient.auth.signOut();
    setBusy(false);
    setNotice(error ? { tone: "error", text: error.message } : null);
  };

  if (!supabaseConfigured) {
    return <SetupCard title="Connect Supabase first" body="Add the Supabase project URL and public anon key to the app environment, then deploy the auth migration and Edge Functions. See the Supabase setup guide in the repository." />;
  }
  if (checkingSession) {
    return <div className="grid min-h-56 place-items-center"><LoaderCircle className="h-6 w-6 animate-spin text-saffron-300" /></div>;
  }
  if (!session) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl glass p-6 sm:p-8">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-saffron-400/15 text-saffron-300"><ShieldCheck className="h-5 w-5" /></div>
        <h2 className="mt-5 font-display text-xl font-semibold text-white">Super-admin sign in</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">User management is protected by the Supabase super-admin role. The local PB Control password does not grant access to account records.</p>
        {notice && <PanelNotice notice={notice} />}
        <form onSubmit={(event) => void signIn(event)} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-xs font-semibold text-zinc-400">
            Username or email
            <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required className={inputClass} placeholder="username or admin@example.com" />
          </label>
          <label className="flex flex-col gap-2 text-xs font-semibold text-zinc-400">
            Password
            <input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" required className={inputClass} placeholder="Super-admin password" />
          </label>
          <button type="submit" disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-saffron-400 px-4 py-3 text-sm font-bold text-on-gold transition hover:brightness-110 disabled:opacity-50">
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}{busy ? "Signing in…" : "Sign in to user management"}
          </button>
        </form>
      </div>
    );
  }

  if (authorized === false) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl glass p-6 sm:p-8">
        <CircleAlert className="h-6 w-6 text-amber-300" />
        <h2 className="mt-4 font-display text-xl font-semibold text-white">Super-admin access required</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">This account is signed in but does not have the <code className="text-saffron-300">super_admin</code> role. Bootstrap the owner account using the SQL instructions in the repository’s Supabase setup guide, then sign out and back in.</p>
        {notice && <PanelNotice notice={notice} />}
        <button type="button" onClick={() => void signOut()} disabled={busy} className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:text-white disabled:opacity-50"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
      </div>
    );
  }
  if (authorized !== true) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl glass p-6 text-center sm:p-8">
        {loadingUsers ? <LoaderCircle className="mx-auto h-6 w-6 animate-spin text-saffron-300" /> : <CircleAlert className="mx-auto h-6 w-6 text-amber-300" />}
        <h2 className="mt-4 font-display text-xl font-semibold text-white">Verifying super-admin access</h2>
        {notice ? <PanelNotice notice={notice} /> : <p className="mt-2 text-sm text-zinc-400">User records and account-creation controls stay hidden until the server confirms your role.</p>}
        {!loadingUsers && <button type="button" onClick={() => void loadUsers()} className="mt-4 rounded-full bg-white/[0.07] px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/[0.12]">Retry access check</button>}
      </div>
    );
  }

  const filters: { id: UserFilter; label: string; icon: typeof Users }[] = [
    { id: "all", label: "All users", icon: Users },
    { id: "pending", label: "Pending verification", icon: Clock3 },
    { id: "verified", label: "Email verified", icon: Check },
    { id: "admin", label: "Created by admin", icon: UserPlus },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl glass p-5 sm:p-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-saffron-300">Account administration</p>
          <h2 className="mt-1 font-display text-xl font-semibold text-white">Registered users</h2>
          <p className="mt-1 text-xs text-zinc-500">Signed in as {session.user.email}. Admin-created accounts are immediately confirmed.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void loadUsers()} disabled={loadingUsers} className="inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:text-white disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loadingUsers ? "animate-spin" : ""}`} /> Refresh</button>
          <button type="button" onClick={() => void signOut()} disabled={busy} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs font-semibold text-zinc-400 transition hover:text-red-300 disabled:opacity-50"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
        </div>
      </div>

      {notice && <PanelNotice notice={notice} />}

      <section className="rounded-3xl glass p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <Plus className="h-4 w-4 text-saffron-300" />
          <h3 className="font-display text-base font-semibold text-white">Create a user without email verification</h3>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-zinc-500">The email is marked confirmed by the secure admin function; no verification email is sent for this account.</p>
        <form onSubmit={(event) => void createUser(event)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <input value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" className={inputClass} placeholder="Username" aria-label="New username" />
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required className={inputClass} placeholder="Email address" aria-label="New user email" />
          <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={8} className={inputClass} placeholder="Initial password" aria-label="Initial password" />
          <button type="submit" disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-saffron-400 px-4 py-2.5 text-sm font-bold text-on-gold transition hover:brightness-110 disabled:opacity-50">
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />} Create account
          </button>
        </form>
      </section>

      <section className="overflow-hidden rounded-3xl glass">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.07] p-4">
          {filters.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" onClick={() => setFilter(item.id)} aria-pressed={filter === item.id} className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold transition ${filter === item.id ? "bg-saffron-400 text-on-gold" : "bg-white/[0.05] text-zinc-400 hover:bg-white/[0.1] hover:text-white"}`}>
                <Icon className="h-3.5 w-3.5" /> {item.label} <span className="opacity-75">{counts[item.id]}</span>
              </button>
            );
          })}
        </div>
        {loadingUsers ? (
          <div className="grid min-h-48 place-items-center"><LoaderCircle className="h-6 w-6 animate-spin text-saffron-300" /></div>
        ) : visibleUsers.length === 0 ? (
          <div className="grid min-h-48 place-items-center px-5 text-center">
            <div><CircleUserRound className="mx-auto h-7 w-7 text-zinc-600" /><p className="mt-3 text-sm font-medium text-zinc-300">No users in this category yet.</p><p className="mt-1 text-xs text-zinc-600">New sign-ups and their verification state will appear here.</p></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-white/[0.025] text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">
                <tr><th className="px-5 py-3">User</th><th className="px-5 py-3">Email</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Registered</th><th className="px-5 py-3">Verified</th></tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {visibleUsers.map((user) => {
                  const status = statusOf(user);
                  return (
                    <tr key={user.id} className="transition hover:bg-white/[0.025]">
                      <td className="px-5 py-4"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-zinc-300"><CircleUserRound className="h-4 w-4" /></span><div><p className="font-semibold text-white">{user.username || "—"}</p>{user.role === "super_admin" && <span className="text-[10px] font-bold uppercase tracking-wider text-saffron-300">Super admin</span>}</div></div></td>
                      <td className="px-5 py-4 text-zinc-300">{user.email || "—"}</td>
                      <td className="px-5 py-4"><span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusClass(status)}`}>{statusLabel(status)}</span></td>
                      <td className="px-5 py-4 text-xs text-zinc-500">{formatDate(user.createdAt)}</td>
                      <td className="px-5 py-4 text-xs text-zinc-500">{formatDate(user.emailConfirmedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-[11px] leading-relaxed text-zinc-600">Only the server-side super-admin function can read the auth user directory or mark an email as confirmed. Account actions use the authenticated Supabase session, not the local dashboard password.</p>
    </div>
  );
}

function PanelNotice({ notice }: { notice: { tone: "success" | "error" | "info"; text: string } }) {
  const color = notice.tone === "error"
    ? "border-red-400/20 bg-red-400/10 text-red-200"
    : notice.tone === "success"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
      : "border-amber-400/20 bg-amber-400/10 text-amber-100";
  return <p role={notice.tone === "error" ? "alert" : "status"} className={`mt-4 rounded-xl border p-3 text-xs leading-relaxed ${color}`}>{notice.text}</p>;
}

function SetupCard({ title, body }: { title: string; body: string }) {
  return <div className="rounded-3xl glass p-7"><h2 className="font-display text-xl font-semibold text-white">{title}</h2><p className="mt-2 text-sm leading-relaxed text-zinc-400">{body}</p></div>;
}
