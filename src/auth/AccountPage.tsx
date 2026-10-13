import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowLeft, CheckCircle2, LoaderCircle, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { Logo } from "../components/Navbar";
import { emailConfirmationRedirectTo, requireSupabase, signInWithIdentifier, supabaseClient, supabaseConfigured } from "./supabase";

type Notice = { tone: "success" | "error" | "info"; text: string };
type Mode = "signin" | "signup";

const fieldClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-saffron-400/60 focus:ring-2 focus:ring-saffron-400/15";

export default function AccountPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const emailVerifiedReturn = new URLSearchParams(window.location.search).get("auth") === "verified";

  useEffect(() => {
    if (!supabaseClient) {
      setSessionLoading(false);
      return;
    }
    let active = true;
    void supabaseClient.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setSessionLoading(false);
      }
    });
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSessionLoading(false);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await signInWithIdentifier(identifier, password);
      setPassword("");
      setNotice({ tone: "success", text: "You’re signed in." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sign in. Please try again.";
      const isUnverified = /email not confirmed|not confirmed|email.*confirm/i.test(message);
      setNotice({
        tone: "error",
        text: isUnverified
          ? "Your email is still unverified. Open the confirmation link we emailed you, then sign in again."
          : message,
      });
    } finally {
      setBusy(false);
    }
  };

  const signUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
      setNotice({ tone: "error", text: "Username must be 3–24 characters using letters, numbers, or underscores." });
      return;
    }
    if (password.length < 8) {
      setNotice({ tone: "error", text: "Use a password with at least 8 characters." });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const client = requireSupabase();
      const { data, error } = await client.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { username: normalizedUsername },
          emailRedirectTo: emailConfirmationRedirectTo(),
        },
      });
      if (error) throw error;
      setUsername("");
      setEmail("");
      setPassword("");
      setIdentifier(email.trim().toLowerCase());
      setMode("signin");
      setNotice({
        tone: data.session ? "info" : "success",
        text: data.session
          ? "Your account was created, but email confirmation appears to be disabled in Supabase. Enable Confirm email so new accounts must verify before signing in."
          : "If this address can register, a verification link has been sent. Open that link to activate your account; it will verify the email automatically.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create your account.";
      setNotice({
        tone: "error",
        text: /profiles_username|duplicate key|username.*taken/i.test(message)
          ? "That username is already taken. Please choose another."
          : message,
      });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (!supabaseClient) return;
    setBusy(true);
    const { error } = await supabaseClient.auth.signOut();
    setBusy(false);
    setNotice(error ? { tone: "error", text: error.message } : { tone: "success", text: "You’ve signed out." });
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-950 px-5 py-10 text-zinc-300 sm:py-16">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-50 [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)]" aria-hidden />
      <div className="pointer-events-none absolute -top-36 left-1/2 h-96 w-[640px] -translate-x-1/2 rounded-full bg-saffron-400/10 blur-[130px]" aria-hidden />
      <div className="relative mx-auto max-w-5xl">
        <div className="mb-10 flex items-center justify-between gap-4">
          <Logo />
          <a href="#/" className="inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to site
          </a>
        </div>

        {!supabaseConfigured ? (
          <SetupNotice />
        ) : sessionLoading ? (
          <div className="grid min-h-[50vh] place-items-center">
            <LoaderCircle className="h-7 w-7 animate-spin text-saffron-300" />
          </div>
        ) : session ? (
          <div className="mx-auto max-w-xl rounded-[2rem] glass p-7 sm:p-10">
            {emailVerifiedReturn && (
              <div role="status" className="mb-6 flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> Email confirmed successfully.
              </div>
            )}
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-saffron-400/15 text-saffron-300">
              <UserRound className="h-5 w-5" />
            </span>
            <h1 className="mt-5 font-display text-2xl font-bold text-white">Your account</h1>
            <p className="mt-2 text-sm text-zinc-400">
              Signed in as <span className="font-semibold text-white">{session.user.user_metadata?.username || session.user.email}</span>
            </p>
            <p className="mt-1 text-xs text-zinc-500">{session.user.email}</p>
            <div className="mt-6 flex items-center gap-2 rounded-xl bg-white/[0.04] px-4 py-3 text-xs text-emerald-300">
              <ShieldCheck className="h-4 w-4" /> Email verified
            </div>
            {notice && <NoticeBox notice={notice} />}
            <button
              type="button"
              onClick={() => void signOut()}
              disabled={busy}
              className="mt-7 inline-flex items-center gap-2 rounded-full border border-white/10 px-5 py-2.5 text-sm font-semibold text-zinc-300 transition hover:border-red-400/30 hover:text-red-300 disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        ) : (
          <div className="mx-auto grid max-w-4xl overflow-hidden rounded-[2rem] border border-white/10 bg-ink-900/70 shadow-2xl shadow-black/30 md:grid-cols-[0.85fr_1.15fr]">
            <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-saffron-400/15 via-ink-900 to-ink-950 p-9 md:flex">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-saffron-300">The tribe</p>
                <h1 className="mt-4 font-display text-3xl font-bold leading-tight text-white">More road.<br />Less scrolling.</h1>
                <p className="mt-4 text-sm leading-relaxed text-zinc-400">Create an account to keep your membership and travel perks in one place.</p>
              </div>
              <p className="text-xs text-zinc-500">Your email is confirmed by a secure one-click link.</p>
            </aside>

            <section className="p-7 sm:p-10">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-saffron-300">PB from PB</p>
              <h1 className="mt-2 font-display text-2xl font-bold text-white">{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
              <p className="mt-2 text-sm text-zinc-500">
                {mode === "signup" ? "Sign up with a username, email, and password." : "Sign in with your username or email and password."}
              </p>

              {emailVerifiedReturn && (
                <div role="status" className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> Your email was confirmed. You can now sign in.
                </div>
              )}
              {notice && <NoticeBox notice={notice} />}

              {mode === "signin" ? (
                <form className="mt-6 flex flex-col gap-4" onSubmit={(event) => void signIn(event)}>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-zinc-400">
                    Username or email
                    <input
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                      autoComplete="username"
                      required
                      className={fieldClass}
                      placeholder="username or name@example.com"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-zinc-400">
                    Password
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      required
                      className={fieldClass}
                      placeholder="Your password"
                    />
                  </label>
                  <button type="submit" disabled={busy} className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-saffron-400 px-5 py-3 text-sm font-bold text-on-gold transition hover:brightness-110 disabled:opacity-50">
                    {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}{busy ? "Signing in…" : "Sign in"}
                  </button>
                </form>
              ) : (
                <form className="mt-6 flex flex-col gap-4" onSubmit={(event) => void signUp(event)}>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-zinc-400">
                    Username
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      autoComplete="username"
                      required
                      minLength={3}
                      maxLength={24}
                      pattern="[A-Za-z0-9_]{3,24}"
                      className={fieldClass}
                      placeholder="roadwanderer"
                    />
                    <span className="font-normal text-zinc-600">3–24 letters, numbers, or underscores.</span>
                  </label>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-zinc-400">
                    Email
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      required
                      className={fieldClass}
                      placeholder="you@example.com"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs font-semibold text-zinc-400">
                    Password
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                      required
                      minLength={8}
                      className={fieldClass}
                      placeholder="At least 8 characters"
                    />
                  </label>
                  <button type="submit" disabled={busy} className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-saffron-400 px-5 py-3 text-sm font-bold text-on-gold transition hover:brightness-110 disabled:opacity-50">
                    {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}{busy ? "Creating account…" : "Create account"}
                  </button>
                </form>
              )}

              <p className="mt-6 border-t border-white/[0.07] pt-5 text-center text-sm text-zinc-500">
                {mode === "signup" ? "Already a member?" : "New to the tribe?"}{" "}
                <button
                  type="button"
                  onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setNotice(null); }}
                  className="font-semibold text-saffron-300 transition hover:text-saffron-400"
                >
                  {mode === "signup" ? "Sign in" : "Create an account"}
                </button>
              </p>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function NoticeBox({ notice }: { notice: Notice }) {
  const color = notice.tone === "error"
    ? "border-red-400/20 bg-red-400/10 text-red-200"
    : notice.tone === "success"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
      : "border-amber-400/20 bg-amber-400/10 text-amber-100";
  return <p role={notice.tone === "error" ? "alert" : "status"} className={`mt-5 rounded-xl border p-3 text-xs leading-relaxed ${color}`}>{notice.text}</p>;
}

function SetupNotice() {
  return (
    <div className="mx-auto max-w-xl rounded-[2rem] glass p-7 sm:p-10">
      <h1 className="font-display text-2xl font-bold text-white">Accounts are not connected yet</h1>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">
        Add <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-saffron-300">VITE_SUPABASE_URL</code> and <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-saffron-300">VITE_SUPABASE_ANON_KEY</code> to the deployment environment, then configure the Supabase migration and Edge Functions.
      </p>
      <p className="mt-4 text-xs leading-relaxed text-zinc-600">The service-role key belongs only in Supabase Edge Function secrets—never in this frontend.</p>
    </div>
  );
}
