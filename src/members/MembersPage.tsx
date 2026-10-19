import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Feather,
  Loader2,
  Lock,
  LogOut,
  ShieldCheck,
  User,
} from "lucide-react";
import { describeApiError } from "../api/client";
import { siteApi, type AuthStatus } from "../api/siteApi";
import { useSite } from "../store/siteContent";
import { cn } from "../utils/cn";

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-saffron-400/60 focus:outline-none focus:ring-2 focus:ring-saffron-400/20";

const labelCls = "text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500";

const roleLabel = (role: string) =>
  role === "owner" ? "Owner" : role === "admin" ? "Editor" : "Reader";

/** Reload so the server can send the gated sections now that a session exists. */
function openJournal() {
  window.location.hash = "#/";
  window.location.reload();
}

/**
 * The public account page behind every "members only" card.
 *
 * Signing up creates a read-only account: it unlocks the members-only
 * sections of the public site and nothing in the dashboard.
 */
export default function MembersPage() {
  const { account, setAccount, siteTitle } = useSite();
  const [mode, setMode] = useState<"login" | "signup">(() =>
    window.location.hash.includes("signup") ? "signup" : "login",
  );
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ username: "", password: "", confirm: "", email: "" });
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let alive = true;
    siteApi
      .status()
      .then((next) => {
        if (!alive) return;
        setStatus(next);
        // If the site has no owner yet, this is not the page to fix that.
        if (next.users === 0) window.location.hash = "#/admin";
      })
      .catch((err) => alive && setError(describeApiError(err)));
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (mode === "signup" && form.password !== form.confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const user =
        mode === "signup"
          ? await siteApi.signup(form.username.trim(), form.password, form.email.trim() || undefined)
          : await siteApi.login(form.username.trim(), form.password);
      setAccount(user);
      openJournal();
    } catch (err) {
      setError(describeApiError(err));
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await siteApi.logout();
    } catch {
      /* the cookie expires on its own; the screen still signs out */
    }
    setAccount(null);
    openJournal();
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink-950 px-5 py-10 text-white sm:py-16">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)]" aria-hidden />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[680px] -translate-x-1/2 rounded-full bg-saffron-400/12 blur-[130px]" aria-hidden />

      <div className="relative mx-auto w-full max-w-md">
        <a
          href="#/"
          className="mb-8 inline-flex items-center gap-2 text-xs font-medium text-zinc-500 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to the journal
        </a>

        {account ? (
          <div className="rounded-3xl glass p-8">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-saffron-400 font-display text-sm font-bold text-on-gold shadow-lg shadow-saffron-400/30">
              {account.username.slice(0, 2).toUpperCase()}
            </span>
            <h1 className="mt-5 font-display text-xl font-semibold text-white">
              Signed in as {account.username}
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              {roleLabel(account.role)} account · read-only access to {siteTitle}
            </p>

            {account.role === "reader" ? (
              <div className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.07] px-4 py-3 text-xs leading-relaxed text-emerald-200">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                The members-only sections are unlocked. Everything else on the site is public.
              </div>
            ) : (
              <a
                href="#/admin"
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-white hover:text-ink-950"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> Open the dashboard
              </a>
            )}

            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="#/"
                className="inline-flex items-center gap-2 rounded-xl bg-saffron-400 px-5 py-3 text-sm font-semibold text-on-gold shadow-lg shadow-saffron-400/25 transition-all duration-300 hover:brightness-110 active:scale-95"
              >
                Read the journal <ArrowRight className="h-4 w-4" />
              </a>
              <button
                type="button"
                onClick={signOut}
                className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-5 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-3xl glass p-8">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-saffron-400 font-display text-sm font-bold text-on-gold shadow-lg shadow-saffron-400/30">
                PB
              </span>
              <div>
                <h1 className="font-display text-lg font-semibold text-white">The tribe</h1>
                <p className="text-xs text-zinc-500">Members-only journal</p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-white/[0.05] p-1">
              {(["login", "signup"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setMode(value);
                    setError("");
                  }}
                  className={cn(
                    "rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                    mode === value
                      ? "bg-white text-ink-950"
                      : "text-zinc-400 hover:text-white",
                  )}
                >
                  {value === "login" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>

            {mode === "signup" && status && !status.allowSignup && (
              <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-xs leading-relaxed text-amber-200">
                Public sign-up is closed on this site. Ask the owner to create your account from the
                dashboard.
              </p>
            )}

            <form onSubmit={submit} className="mt-5 grid gap-3">
              <label htmlFor="member-user" className={labelCls}>
                Username
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  id="member-user"
                  value={form.username}
                  onChange={(e) => setForm((v) => ({ ...v, username: e.target.value }))}
                  autoFocus
                  autoComplete="username"
                  placeholder="yourname"
                  className={cn(inputCls, "pl-10")}
                />
              </div>

              <label htmlFor="member-pw" className={cn(labelCls, "mt-1")}>
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  id="member-pw"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm((v) => ({ ...v, password: e.target.value }))}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder="••••••••"
                  className={cn(inputCls, "pl-10 pr-11")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-zinc-500 transition-colors hover:text-white"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {mode === "signup" && (
                <>
                  <label htmlFor="member-pw2" className={cn(labelCls, "mt-1")}>
                    Repeat password
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <input
                      id="member-pw2"
                      type={showPassword ? "text" : "password"}
                      value={form.confirm}
                      onChange={(e) => setForm((v) => ({ ...v, confirm: e.target.value }))}
                      autoComplete="new-password"
                      placeholder="••••••••"
                      className={cn(inputCls, "pl-10")}
                    />
                  </div>
                  <label htmlFor="member-email" className={cn(labelCls, "mt-1")}>
                    Email <span className="font-normal normal-case tracking-normal text-zinc-600">(optional)</span>
                  </label>
                  <input
                    id="member-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))}
                    autoComplete="email"
                    placeholder="you@example.com"
                    className={inputCls}
                  />
                </>
              )}

              {error && <p className="text-xs font-medium text-red-400">{error}</p>}

              <button
                type="submit"
                disabled={busy || (mode === "signup" && status !== null && !status.allowSignup)}
                className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-saffron-400 px-5 py-3 font-display text-sm font-semibold text-on-gold shadow-lg shadow-saffron-400/30 transition-all duration-300 hover:brightness-110 active:scale-95 disabled:opacity-60"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Working…
                  </>
                ) : mode === "signup" ? (
                  <>
                    <Feather className="h-4 w-4" /> Create read-only account
                  </>
                ) : (
                  <>
                    Sign in <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-5 rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-[11px] leading-relaxed text-zinc-500">
              Free accounts are read-only. Passwords are stored as bcrypt hashes in the site's
              database, and every sign-in is recorded in the access history.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
