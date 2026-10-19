import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Server,
  ShieldCheck,
  User,
  Wand2,
} from "lucide-react";
import { describeApiError } from "../api/client";
import { siteApi, type SetupStatus } from "../api/siteApi";
import { cn } from "../utils/cn";

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-saffron-400/60 focus:outline-none focus:ring-2 focus:ring-saffron-400/20";

const labelCls = "text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500";

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <span
      className={cn(
        "grid h-8 w-8 place-items-center rounded-full text-xs font-bold transition-colors",
        done
          ? "bg-emerald-400/15 text-emerald-300"
          : active
            ? "bg-saffron-400 text-on-gold shadow-lg shadow-saffron-400/25"
            : "bg-white/[0.06] text-zinc-500",
      )}
    >
      {done ? <Check className="h-4 w-4" /> : n}
    </span>
  );
}

/**
 * First-run installer.
 *
 * Step 1 collects the site title and MariaDB details, then creates the
 * database (when allowed), all tables, and the deployment settings. Step 2
 * creates the owner account. Both steps are one-time: once the install file
 * exists the API refuses to change the database again.
 */
export default function SetupWizard({
  status,
  onDone,
}: {
  status: SetupStatus;
  onDone: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(status.installed ? 2 : 1);
  // Once the database step has been saved the API locks it; do not offer a
  // Back button that could only fail.
  const [databaseSaved, setDatabaseSaved] = useState(status.installed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  /* Step 1 — the database */
  const [siteTitle, setSiteTitle] = useState(status.siteTitle || "PB Travel Diaries");
  const [host, setHost] = useState(status.db?.host || "localhost");
  const [port, setPort] = useState(String(status.db?.port ?? 3306));
  const [database, setDatabase] = useState(status.db?.database || "");
  const [user, setUser] = useState(status.db?.user || "");
  const [password, setPassword] = useState("");
  const [socketPath, setSocketPath] = useState(status.db?.socketPath || "");
  const [showPassword, setShowPassword] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(Boolean(status.db?.socketPath));

  /* Step 2 — the owner */
  const [owner, setOwner] = useState({ username: "", password: "", confirm: "", email: "" });
  const [showOwnerPassword, setShowOwnerPassword] = useState(false);

  useEffect(() => {
    document.title = step === 1 ? "Set up your website" : "Create the owner account";
  }, [step]);

  const dbInput = {
    siteTitle: siteTitle.trim(),
    host: host.trim(),
    port: port.trim(),
    database: database.trim(),
    user: user.trim(),
    password,
    socketPath: socketPath.trim(),
  };

  const testConnection = async () => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await siteApi.testDatabase(dbInput);
      setNotice(
        `Connected to MariaDB ${result.serverVersion || ""} — “${dbInput.database}” is reachable.`.trim(),
      );
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const createTables = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await siteApi.setupDatabase(dbInput);
      setSiteTitle(result.siteTitle);
      setDatabaseSaved(true);

      // Reconnecting a database that already has its owner: there is nothing
      // to create, so go straight to the sign-in screen after a moment.
      if (!result.needsOwner) {
        setNotice("The database and every table are ready — it already has an owner account. Opening the sign-in screen…");
        setTimeout(onDone, 1400);
        return;
      }

      setNotice("The database and every table are ready.");
      setStep(2);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const createOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    if (owner.password !== owner.confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await siteApi.setupOwner({
        username: owner.username.trim(),
        password: owner.password,
        email: owner.email.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setError(describeApiError(err));
      setBusy(false);
    }
  };


  return (
    <div className="relative min-h-screen overflow-hidden bg-ink-950 px-5 py-10 text-white sm:py-16">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)]" aria-hidden />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[720px] -translate-x-1/2 rounded-full bg-saffron-400/12 blur-[130px]" aria-hidden />

      <div className="relative mx-auto w-full max-w-2xl">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-saffron-400 font-display text-sm font-bold text-on-gold shadow-lg shadow-saffron-400/30">
            PB
          </span>
          <div>
            <h1 className="font-display text-lg font-semibold text-white">Set up your website</h1>
            <p className="text-xs text-zinc-500">
              One time only — the database and the owner account are created here.
            </p>
          </div>
        </div>

        {/* progress */}
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-5 py-4">
          <StepDot n={1} active={step === 1} done={step === 2} />
          <div className="min-w-0 flex-1">
            <p className={cn("text-sm font-semibold", step === 1 ? "text-white" : "text-zinc-400")}>
              Database
            </p>
            <p className="text-[11px] text-zinc-600">Website title + MariaDB details</p>
          </div>
          <span className="h-px w-8 bg-white/10" aria-hidden />
          <StepDot n={2} active={step === 2} done={false} />
          <div className="min-w-0 flex-1">
            <p className={cn("text-sm font-semibold", step === 2 ? "text-white" : "text-zinc-400")}>
              Super admin
            </p>
            <p className="text-[11px] text-zinc-600">The account you will sign in with</p>
          </div>
        </div>

        <div className="rounded-3xl glass p-6 sm:p-8">
          {step === 1 && (
            <form onSubmit={createTables} className="grid gap-5">
              <div>
                <h2 className="flex items-center gap-2 font-display text-base font-semibold text-white">
                  <Wand2 className="h-4 w-4 text-saffron-300" /> Your website
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                  This becomes the browser tab's title and the name shown on the sign-in screens. You
                  can change it later in the dashboard.
                </p>
                <label htmlFor="setup-title" className={cn(labelCls, "mt-4 block")}>
                  Website title
                </label>
                <input
                  id="setup-title"
                  value={siteTitle}
                  onChange={(e) => setSiteTitle(e.target.value)}
                  autoFocus
                  maxLength={120}
                  placeholder="PB Travel Diaries"
                  className={cn(inputCls, "mt-1.5")}
                />
              </div>

              <div className="border-t border-white/[0.07] pt-5">
                <h2 className="flex items-center gap-2 font-display text-base font-semibold text-white">
                  <Database className="h-4 w-4 text-saffron-300" /> MariaDB database
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                  In cPanel open <span className="text-zinc-300">MySQL® Databases</span>, create a
                  database and a user, then add the user to the database with{" "}
                  <span className="text-zinc-300">ALL PRIVILEGES</span>. Paste those details here;
                  this screen creates every table for you, so there is no SQL file to import.
                </p>

                <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_120px]">
                  <div>
                    <label htmlFor="setup-host" className={labelCls}>
                      Host
                    </label>
                    <div className="relative mt-1.5">
                      <Server className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                      <input
                        id="setup-host"
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                        placeholder="localhost"
                        className={cn(inputCls, "pl-10")}
                        autoComplete="off"
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-zinc-600">On cPanel this is usually “localhost”.</p>
                  </div>
                  <div>
                    <label htmlFor="setup-port" className={labelCls}>
                      Port
                    </label>
                    <input
                      id="setup-port"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      inputMode="numeric"
                      placeholder="3306"
                      className={cn(inputCls, "mt-1.5")}
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="setup-db" className={labelCls}>
                      Database name
                    </label>
                    <input
                      id="setup-db"
                      value={database}
                      onChange={(e) => setDatabase(e.target.value)}
                      placeholder="cpuser_pbtravel"
                      className={cn(inputCls, "mt-1.5")}
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label htmlFor="setup-user" className={labelCls}>
                      Database username
                    </label>
                    <input
                      id="setup-user"
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                      placeholder="cpuser_pb"
                      className={cn(inputCls, "mt-1.5")}
                      autoComplete="off"
                    />
                  </div>
                </div>

                <label htmlFor="setup-password" className={cn(labelCls, "mt-4 block")}>
                  Database password
                </label>
                <div className="relative mt-1.5">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    id="setup-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="The password you gave the database user"
                    className={cn(inputCls, "pl-10 pr-12")}
                    autoComplete="off"
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

                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="mt-3 text-[11px] font-medium text-zinc-500 underline decoration-white/20 underline-offset-4 transition-colors hover:text-zinc-300"
                >
                  {showAdvanced ? "Hide socket option" : "Connection refused? Use a socket path"}
                </button>
                {showAdvanced && (
                  <div className="mt-2">
                    <label htmlFor="setup-socket" className={labelCls}>
                      Socket path (optional)
                    </label>
                    <input
                      id="setup-socket"
                      value={socketPath}
                      onChange={(e) => setSocketPath(e.target.value)}
                      placeholder="/var/run/mysqld/mysqld.sock"
                      className={cn(inputCls, "mt-1.5")}
                      autoComplete="off"
                    />
                    <p className="mt-1 text-[10px] text-zinc-600">
                      Leave blank unless your host gave you a socket instead of a host name.
                    </p>
                  </div>
                )}
              </div>

              {error && (
                <p role="alert" className="rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-xs font-medium leading-relaxed text-red-300">
                  {error}
                </p>
              )}
              {notice && (
                <p className="flex items-start gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-xs font-medium leading-relaxed text-emerald-300">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {notice}
                </p>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={testConnection}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/12 px-5 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}
                  Test connection
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="ml-auto inline-flex w-full items-center justify-center gap-2 rounded-xl bg-saffron-400 px-6 py-3 font-display text-sm font-semibold text-on-gold shadow-lg shadow-saffron-400/25 transition-all duration-300 hover:brightness-110 active:scale-95 disabled:opacity-60 sm:w-auto"
                >
                  {busy ? "Working…" : "Create tables & continue"}
                  {!busy && <ArrowRight className="h-4 w-4" />}
                </button>
              </div>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={createOwner} className="grid gap-4">
              <div>
                <h2 className="flex items-center gap-2 font-display text-base font-semibold text-white">
                  <ShieldCheck className="h-4 w-4 text-saffron-300" /> Create the super admin
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                  This is the owner account: it can publish the site, add people from the dashboard,
                  and it can never be deleted. It is the only account this installer creates.
                </p>
              </div>

              <div>
                <label htmlFor="owner-user" className={labelCls}>
                  Username
                </label>
                <div className="relative mt-1.5">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    id="owner-user"
                    value={owner.username}
                    onChange={(e) => setOwner((v) => ({ ...v, username: e.target.value }))}
                    autoFocus
                    autoComplete="username"
                    placeholder="parul"
                    className={cn(inputCls, "pl-10")}
                  />
                </div>
                <p className="mt-1 text-[10px] text-zinc-600">
                  3–64 characters: lowercase letters, numbers, dot, dash or underscore.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="owner-pw" className={labelCls}>
                    Password
                  </label>
                  <div className="relative mt-1.5">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <input
                      id="owner-pw"
                      type={showOwnerPassword ? "text" : "password"}
                      value={owner.password}
                      onChange={(e) => setOwner((v) => ({ ...v, password: e.target.value }))}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      className={cn(inputCls, "pl-10 pr-11")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowOwnerPassword((v) => !v)}
                      aria-label={showOwnerPassword ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-zinc-500 transition-colors hover:text-white"
                    >
                      {showOwnerPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="owner-pw2" className={labelCls}>
                    Repeat password
                  </label>
                  <div className="relative mt-1.5">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <input
                      id="owner-pw2"
                      type={showOwnerPassword ? "text" : "password"}
                      value={owner.confirm}
                      onChange={(e) => setOwner((v) => ({ ...v, confirm: e.target.value }))}
                      autoComplete="new-password"
                      placeholder="Repeat it"
                      className={cn(inputCls, "pl-10")}
                    />
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-zinc-600">
                Use at least 8 characters with a letter and a number. The password is stored as a
                bcrypt hash, never as text.
              </p>

              <div>
                <label htmlFor="owner-email" className={labelCls}>
                  Email <span className="font-normal normal-case tracking-normal text-zinc-600">(optional)</span>
                </label>
                <input
                  id="owner-email"
                  type="email"
                  value={owner.email}
                  onChange={(e) => setOwner((v) => ({ ...v, email: e.target.value }))}
                  autoComplete="email"
                  placeholder="you@example.com"
                  className={cn(inputCls, "mt-1.5")}
                />
              </div>

              {error && (
                <p role="alert" className="rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-xs font-medium leading-relaxed text-red-300">
                  {error}
                </p>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
                {!databaseSaved && (
                  <button
                    type="button"
                    onClick={() => {
                      setError("");
                      setNotice("");
                      setStep(1);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/12 px-5 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                  >
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="ml-auto inline-flex w-full items-center justify-center gap-2 rounded-xl bg-saffron-400 px-6 py-3 font-display text-sm font-semibold text-on-gold shadow-lg shadow-saffron-400/25 transition-all duration-300 hover:brightness-110 active:scale-95 disabled:opacity-60 sm:w-auto"
                >
                  {busy ? "Creating…" : "Create owner & open site"}
                  {!busy && <Check className="h-4 w-4" />}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-zinc-600">
          {step === 1
            ? "The app creates the tables itself — importing server/schema.sql is not needed."
            : "Afterwards, people can create their own read-only accounts from the sign-up page, or you can add accounts in the dashboard."}
        </p>
      </div>
    </div>
  );
}
