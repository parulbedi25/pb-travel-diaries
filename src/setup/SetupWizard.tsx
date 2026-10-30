import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArchiveRestore,
  Check,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  FileArchive,
  Loader2,
  Lock,
  Server,
  ShieldCheck,
  Upload,
  User,
  Wand2,
} from "lucide-react";
import { apiReachable, describeApiError } from "../api/client";
import { goToSiteRoute, handoffTargets } from "./handoff";
import { siteApi, type RestorePreview, type SetupStatus } from "../api/siteApi";
import { cn } from "../utils/cn";

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-saffron-400/60 focus:outline-none focus:ring-2 focus:ring-saffron-400/20";

const labelCls = "text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500";

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 aspect-square grid h-8 w-8 place-items-center rounded-full text-xs font-bold transition-colors",
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
 * "The database or user is not there yet" is guidance, not a crash: show it in
 * the amber box with the create-these-first list above it. Anything else (the
 * server is down, bad credentials for an existing database) is a real error.
 */
const isGuidance = (message: string) =>
  /does not exist yet|could not sign in|is not allowed to open/i.test(message);

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
  // Amber advice for "the server answers, but the database is not there yet".
  const [warning, setWarning] = useState("");

  /* Step 1 — new installation, or a backup to restore */
  const [mode, setMode] = useState<"new" | "restore">("new");
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [restoreReplace, setRestoreReplace] = useState(false);
  const [reading, setReading] = useState(false);

  /* Step 1 — the database */
  const [siteTitle, setSiteTitle] = useState(status.siteTitle || "PB Travel Diaries");
  const [connectionMode, setConnectionMode] = useState<"provider" | "local">("provider");
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
  /**
   * Set when the owner was created by the PHP bootstrap on a static folder.
   *
   * PHP creates the database, the tables and the account, and then stops: it
   * has no session and never signs anybody in. So the last thing this screen
   * does is say where the API is and hand the person over to it.
   */
  const [handoff, setHandoff] = useState<{ apiUrl: string; username: string } | null>(null);
  const [showOwnerPassword, setShowOwnerPassword] = useState(false);
  /** Set when the person asks to stay on the handover screen. */
  const [holdOn, setHoldOn] = useState(false);
  const [countdown, setCountdown] = useState(6);
  /** Is the Node app up? The site is usable either way; signing in is not. */
  const [api, setApi] = useState<{ ok: boolean; detail: string } | null>(null);

  // Ask the API whether it is there before sending anybody to it. On a static
  // deployment the pages come from files and the API from a subfolder, and a
  // Node app that has not been started yet is the single most likely reason for
  // "the dashboard will not open" — worth saying plainly, on a page that stays
  // put, rather than navigating into a 404.
  useEffect(() => {
    if (!handoff) return;
    let alive = true;
    void apiReachable().then((answer) => {
      if (alive) setApi(answer);
    });
    return () => {
      alive = false;
    };
  }, [handoff]);

  // The handover is a step, not a decision — but only once the API exists to
  // hand over to. With no API, the page stays and explains; it does not navigate.
  useEffect(() => {
    if (!handoff || holdOn || !api?.ok) return;
    const target = handoffTargets({
      apiUrl: handoff.apiUrl,
      origin: window.location.origin,
      pathname: window.location.pathname,
    }).signIn;
    const tick = setInterval(() => setCountdown((n) => Math.max(0, n - 1)), 1000);
    const go = setTimeout(() => goToSiteRoute(target), 6000);
    return () => {
      clearInterval(tick);
      clearTimeout(go);
    };
  }, [handoff, holdOn, api]);

  useEffect(() => {
    document.title = step === 1 ? "Set up your website" : "Create the owner account";
  }, [step]);

  const dbInput = {
    connectionMode,
    siteTitle: siteTitle.trim(),
    host: connectionMode === "local" ? "" : host.trim(),
    port: port.trim(),
    database: connectionMode === "local" ? "pbfrompb" : database.trim(),
    user: connectionMode === "local" ? "" : user.trim(),
    password: connectionMode === "local" ? "" : password,
    socketPath: connectionMode === "local" ? "" : socketPath.trim(),
  };

  const testConnection = async () => {
    setError("");
    setNotice("");
    setWarning("");
    setBusy(true);
    try {
      const result = await siteApi.testDatabase(dbInput);
      if (result.ok) {
        setNotice(result.message || `Connected to MariaDB ${result.serverVersion}.`);
      } else {
        // The password is right and MariaDB answered, but the database (or
        // the user's access to it) is not set up yet. Points at the panel.
        setWarning(result.message);
      }
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Read a backup without writing anything: the server parks the zip, opens
   * pb-restore.json and reports what is inside, including the database it came
   * from so those fields can be filled in (and corrected if this server's
   * database is named differently).
   */
  const readBackup = async (file: File) => {
    setError("");
    setNotice("");
    setWarning("");
    setRestorePreview(null);
    setReading(true);
    try {
      const preview = await siteApi.inspectBackup(file);
      setRestorePreview(preview);
      if (preview.siteTitle) setSiteTitle(preview.siteTitle);
      if (preview.database) {
        setConnectionMode(preview.database.driver === "sqlite" ? "local" : "provider");
        setHost(preview.database.host || "localhost");
        setPort(String(preview.database.port ?? 3306));
        setDatabase(preview.database.database || "");
        setUser(preview.database.user || "");
        setPassword(preview.database.password || "");
        setSocketPath(preview.database.socketPath || "");
      }
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setReading(false);
    }
  };

  const restore = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setWarning("");
    if (!restorePreview) {
      setWarning("Choose the backup zip first — it is read before anything is written.");
      return;
    }
    setBusy(true);
    try {
      const result = await siteApi.restoreBackup({
        uploadId: restorePreview.uploadId,
        ...dbInput,
        replace: restoreReplace,
      });
      setDatabaseSaved(true);
      setNotice(
        `Restored ${result.users} account(s), ${result.mediaFiles} file(s) and every setting ` +
          `from the backup of ${result.restoredFrom ? new Date(result.restoredFrom).toLocaleDateString() : "this site"}. ` +
          "Opening the sign-in screen…",
      );
      setTimeout(onDone, 1800);
    } catch (err) {
      const message = describeApiError(err);
      if (isGuidance(message)) setWarning(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  };

  const createTables = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setWarning("");
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
      const message = describeApiError(err);
      if (isGuidance(message)) setWarning(message);
      else setError(message);
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
      const result = await siteApi.setupOwner({
        username: owner.username.trim(),
        password: owner.password,
        email: owner.email.trim() || undefined,
      });
      if (result.apiUrl) {
        // The bootstrap has done its three jobs. There is no session here to
        // carry, so the sign-in happens on the API — which is the only program
        // that ever authenticates on this deployment.
        setHandoff({ apiUrl: result.apiUrl, username: owner.username.trim() });
        setBusy(false);
        return;
      }
      onDone();
    } catch (err) {
      setError(describeApiError(err));
      setBusy(false);
    }
  };


  if (handoff) {
    const targets = handoffTargets({
      apiUrl: handoff.apiUrl,
      origin: window.location.origin,
      pathname: window.location.pathname,
    });
    // Three states, and the middle one is the point: the API is up (go on),
    // the API is not up (say so, stay here), or we are still asking.
    const ready = api?.ok === true;
    const down = api !== null && !api.ok;

    return (
      <div className="relative min-h-screen overflow-hidden bg-ink-950 px-5 py-10 text-white sm:py-16">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)]" aria-hidden />
        <div className="relative mx-auto w-full max-w-2xl">
          <div className="rounded-3xl glass p-6 sm:p-8">
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-400/15 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> Database ready
            </span>
            <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight text-white">
              The database is set up
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              The tables and the owner account <span className="text-white">{handoff.username}</span> are
              created. This is where PHP stops — it created the database and nothing else, and it
              answers nothing else from here on.
            </p>

            {/* The API check. This is what a person needs to know before
                wondering why the sign-in form does nothing. */}
            <div className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  The site&apos;s API
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setApi(null);
                    void apiReachable().then(setApi);
                  }}
                  disabled={api === null}
                  className="rounded-full border border-white/15 px-3 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-white/[0.08] disabled:opacity-50"
                >
                  {api === null ? "Checking…" : "Check again"}
                </button>
              </div>

              {api === null && (
                <p className="mt-3 text-sm text-zinc-500">
                  Asking <span className="font-mono text-[11px]">{targets.apiHealth}</span>…
                </p>
              )}

              {ready && (
                <p className="mt-3 text-sm text-emerald-300">
                  Answering at <span className="font-mono text-[11px]">{handoff.apiUrl}</span>. Sign in
                  on this site with the account you just made — the dashboard, saving and uploads all
                  happen there.
                </p>
              )}

              {down && (
                <div className="mt-3 space-y-2 text-sm leading-relaxed text-amber-200/90">
                  <p>
                    <span className="font-mono text-[11px]">{targets.apiHealth}</span> did not answer,
                    so signing in will not work yet. The database is created and safe — only the Node
                    app is missing.
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Start it (cPanel → Setup Node.js App, startup file{" "}
                    <span className="font-mono">app.cjs</span>,{" "}
                    <span className="font-mono">BASE_PATH=/server</span>, plus the same{" "}
                    <span className="font-mono">DB_*</span> details as{" "}
                    <span className="font-mono">php-config.php</span>), then press Check again.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => goToSiteRoute(targets.signIn)}
                disabled={!ready}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-saffron-400 px-6 py-3 text-sm font-semibold text-on-gold shadow-lg shadow-saffron-400/25 transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <User className="h-4 w-4" /> Sign in and carry on
              </button>
              <a
                href={targets.dashboard}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/[0.08]"
              >
                Open the dashboard <ArrowRight className="h-4 w-4" />
              </a>
            </div>

            {ready && !holdOn && (
              <p className="mt-4 text-[11px] text-zinc-500">
                Taking you to sign in in {countdown}s ·{" "}
                <button
                  type="button"
                  onClick={() => setHoldOn(true)}
                  className="underline decoration-zinc-600 underline-offset-2 hover:text-zinc-300"
                >
                  stay on this page
                </button>
              </p>
            )}

            <p className="mt-5 text-[11px] leading-relaxed text-zinc-600">
              You can read the site already — the pages are files in this folder and they do not need
              the API. You can also delete <span className="font-mono">api.php</span> now; it has
              finished its work.
            </p>
          </div>
        </div>
      </div>
    );
  }

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
            <p className="text-[11px] text-zinc-600">Website title + database choice</p>
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
          {step === 1 && status.restoreAllowed && (
            <div className="mb-6 grid gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-1.5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setMode("new");
                  setError("");
                  setNotice("");
                  setWarning("");
                }}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors",
                  mode === "new"
                    ? "bg-saffron-400 text-on-gold shadow-lg shadow-saffron-400/20"
                    : "text-zinc-400 hover:text-white",
                )}
              >
                <Wand2 className="h-3.5 w-3.5" /> Start fresh
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("restore");
                  setError("");
                  setNotice("");
                  setWarning("");
                }}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors",
                  mode === "restore"
                    ? "bg-saffron-400 text-on-gold shadow-lg shadow-saffron-400/20"
                    : "text-zinc-400 hover:text-white",
                )}
              >
                <ArchiveRestore className="h-3.5 w-3.5" /> Restore a backup
              </button>
            </div>
          )}

          {step === 1 && (
            <form onSubmit={mode === "restore" ? restore : createTables} className="grid gap-5">
              {mode === "restore" ? (
                <div>
                  <h2 className="flex items-center gap-2 font-display text-base font-semibold text-white">
                    <FileArchive className="h-4 w-4 text-saffron-300" /> Your backup
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                    Upload the zip the daily backup wrote. Every account, password, image and
                    setting comes back — nothing needs importing through phpMyAdmin.
                  </p>

                  <label
                    htmlFor="setup-backup"
                    className={cn(
                      "mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-7 text-center transition-colors",
                      restorePreview
                        ? "border-emerald-400/35 bg-emerald-400/[0.05]"
                        : "border-white/15 bg-white/[0.02] hover:border-saffron-300/40 hover:bg-white/[0.04]",
                    )}
                  >
                    {reading ? (
                      <Loader2 className="h-5 w-5 animate-spin text-saffron-300" />
                    ) : restorePreview ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                    ) : (
                      <Upload className="h-5 w-5 text-zinc-400" />
                    )}
                    <span className="text-xs font-semibold text-white">
                      {reading
                        ? "Reading the backup…"
                        : restorePreview
                          ? restorePreview.fileName
                          : "Choose the backup zip"}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {restorePreview
                        ? "Choose another file to replace it"
                        : "pb-backup-….zip — the one from the backup folder on the old server"}
                    </span>
                    <input
                      id="setup-backup"
                      type="file"
                      accept=".zip,application/zip"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void readBackup(file);
                      }}
                    />
                  </label>

                  {restorePreview && (
                    <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[11px] sm:grid-cols-4">
                      {[
                        ["Accounts", String(restorePreview.users)],
                        ["Photos", String(restorePreview.mediaFiles)],
                        ["Revisions", String(restorePreview.revisions)],
                        ["Saved", restorePreview.createdAt
                          ? new Date(restorePreview.createdAt).toLocaleDateString()
                          : "—"],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">{label}</dt>
                          <dd className="mt-0.5 font-display text-sm font-semibold text-white">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
                    This backup was made by schema version {restorePreview?.schemaVersion || "—"}.
                    {restorePreview?.database
                      ? " Its database details are filled in below — change them if this server uses a different name, user or password."
                      : " It carries no database details, so enter them below."}
                  </p>
                </div>
              ) : (
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
              )}

              <div className="border-t border-white/[0.07] pt-5">
                <label htmlFor="setup-connection-mode" className={labelCls}>Database location</label>
                <select id="setup-connection-mode" className={cn(inputCls, "mt-1.5 mb-3")}
                  value={connectionMode} disabled={busy || databaseSaved}
                  onChange={(event) => {
                    const next = event.target.value as "provider" | "local";
                    setConnectionMode(next);
                    setHost(next === "local" ? "localhost" : "");
                    setPort("3306"); setSocketPath(""); setShowAdvanced(false);
                    setError(""); setWarning(""); setNotice("");
                  }}>
                  <option value="provider">Hosting provider / external MySQL</option>
                  <option value="local">Local database (SQLite)</option>
                </select>
                {connectionMode === "local" && (
                  <div className="rounded-xl border border-white/10 p-4" role="note">
                    <p className={labelCls}>Database name</p><p className="mt-2 text-white">pbfrompb</p>
                    <p className="mt-2 text-xs text-zinc-400">Created privately at server/data/pbfrompb.sqlite. No server or credentials required. Requires Node.js 22.13+ or 24+.</p>
                  </div>
                )}
                {connectionMode === "provider" && <>
                <h2 className="flex items-center gap-2 font-display text-base font-semibold text-white">
                  <Database className="h-4 w-4 text-saffron-300" /> MariaDB database
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                  {mode === "restore"
                    ? "Where the restored data should live. These were read from the backup — change anything that is different on this server, then restore."
                    : "The database and its user have to exist before this screen can use them. In your hosting panel (or with your database administrator):"}
                </p>
                <ol id="setup-prereq" className="mt-3 grid gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-zinc-400">
                  <li className="flex gap-2.5">
                    <span className="aspect-square mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-bold text-zinc-300">1</span>
                    <span>
                      Create an empty <span className="text-zinc-200">database</span> (MySQL or MariaDB).
                      Note its exact name — panels sometimes prefix it with your account name.
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="aspect-square mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-bold text-zinc-300">2</span>
                    <span>
                      Create a <span className="text-zinc-200">database user</span> with a strong
                      password, and note the exact username.
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="aspect-square mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-bold text-zinc-300">3</span>
                    <span>
                      Add that user to that database with{" "}
                      <span className="text-zinc-200">all privileges</span>, then enter the three
                      values below.
                    </span>
                  </li>
                </ol>
                <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
                  One extra thing to grant if your panel offers it: on MySQL 8 / MariaDB 10.5+ the
                  user also needs <span className="text-zinc-400">CREATE</span> to make the tables.
                  This screen does the rest — there is no SQL file to import.
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
                    <p className="mt-1 text-[10px] text-zinc-600">
                      Use the database host supplied by your provider; it may also be localhost.
                    </p>
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
                      placeholder="your_database"
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
                      placeholder="your_database_user"
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
                  {status.db?.passwordStored && (
                    <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
                      Leave this blank to use the password already saved on the server — it is
                      never sent to a browser.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="shrink-0 aspect-square absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-zinc-500 transition-colors hover:text-white"
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
                </>}
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
              {warning && (
                <p role="status" className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs font-medium leading-relaxed text-amber-200">
                  <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {warning}
                </p>
              )}

              {mode === "restore" && (
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.09] bg-white/[0.03] px-4 py-3">
                  <input
                    type="checkbox"
                    checked={restoreReplace}
                    onChange={(e) => setRestoreReplace(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-saffron-400"
                  />
                  <span className="text-[11px] leading-relaxed text-zinc-400">
                    <span className="font-semibold text-zinc-200">Replace what is in that database.</span>{" "}
                    Leave this off if the database is empty. If it already holds accounts, the restore
                    stops rather than merging two sites together.
                  </span>
                </label>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
                {connectionMode === "provider" && <button
                  type="button"
                  onClick={testConnection}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/12 px-5 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}
                  Test connection
                </button>}
                <button
                  type="submit"
                  disabled={busy || (mode === "restore" && !restorePreview)}
                  className="ml-auto inline-flex w-full items-center justify-center gap-2 rounded-xl bg-saffron-400 px-6 py-3 font-display text-sm font-semibold text-on-gold shadow-lg shadow-saffron-400/25 transition-all duration-300 hover:brightness-110 active:scale-95 disabled:opacity-60 sm:w-auto"
                >
                  {busy
                    ? "Working…"
                    : mode === "restore"
                      ? "Restore everything"
                      : "Create tables & continue"}
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
                      className="shrink-0 aspect-square absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-zinc-500 transition-colors hover:text-white"
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
            ? mode === "restore"
              ? "A restore creates the tables it needs, writes every row back, and unpacks the media folder. Nothing is imported by hand."
              : "The app creates the tables itself — importing server/schema.sql is not needed."
            : "Afterwards, people can create their own read-only accounts from the sign-up page, or you can add accounts in the dashboard."}
        </p>
      </div>
    </div>
  );
}
