import { useEffect, useMemo, useState } from "react";
import { Check, Copy, MapPin, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { apiUrl, describeApiError } from "../api/client";
import { siteApi, type LiveSetup } from "../api/siteApi";
import { cn } from "../utils/cn";
import { inputCls } from "./fieldStyles";

/**
 * Live location from the phone.
 *
 * The site has always known where the bike is only because the owner moved a
 * stop on the route by hand. OwnTracks — a free app for Android and iPhone —
 * closes that gap: it posts one JSON message per fix to a URL, and this panel
 * is where that URL comes from. Nothing here needs a Google account, a map key
 * or a second service: the same Node app that serves the site receives the
 * fixes, and the tracker, the live map and the nearby page all read them.
 *
 * The token in the URL *is* the password. It is shown only to the owner, it
 * never travels to a visitor, and "New token" makes the old URL stop working —
 * which is the only thing that matters when a phone is lost.
 */
export default function LiveLocationPanel() {
  const [setup, setSetup] = useState<LiveSetup | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      setSetup(await siteApi.liveSetup());
      setError("");
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  /** The whole URL to paste into the phone, including where the API lives. */
  const phoneUrl = useMemo(() => {
    if (!setup) return "";
    const path = `${apiUrl(setup.path)}?token=${setup.token}`;
    if (typeof window === "undefined") return path;
    try {
      return new URL(path, window.location.origin).toString();
    } catch {
      return path;
    }
  }, [setup]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phoneUrl);
      setCopied(true);
      setNotice("");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setNotice("Copy did not work — select the URL and copy it by hand.");
    }
  };

  const rotate = async () => {
    if (!window.confirm("Make a new token? The URL already in the phone stops working.")) return;
    setBusy(true);
    setNotice("");
    try {
      const next = await siteApi.newLiveToken();
      setSetup((old) => (old ? { ...old, token: next.token, path: next.path } : old));
      setNotice("New token. Paste the new URL into the phone — the old one is refused.");
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    if (!window.confirm("Forget the last fix? The site goes back to the dashboard's stop.")) return;
    setBusy(true);
    try {
      await siteApi.clearLiveFix();
      setSetup((old) => (old ? { ...old, fix: null } : old));
      setNotice("Cleared. The tracker shows the stop marked “Here now” again.");
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const fix = setup?.fix ?? null;
  const ageMinutes = fix ? Math.max(0, Math.round((Date.now() - Date.parse(fix.updatedAt)) / 60000)) : 0;
  const live = fix ? Date.now() - Date.parse(fix.updatedAt) <= (setup?.ttlMs ?? 3_600_000) : false;
  const when = fix
    ? new Date(fix.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true })
    : "";

  return (
    <div className="max-w-2xl space-y-4">
      {error && (
        <p role="alert" className="rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-xs font-medium leading-relaxed text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-xs font-medium leading-relaxed text-emerald-200">
          {notice}
        </p>
      )}

      {/* ── the phone's side ─────────────────────────────────────────── */}
      <section className="rounded-3xl glass p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-saffron-400 text-on-gold">
            <MapPin className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold text-white">Live location from your phone</h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Install <span className="font-semibold text-zinc-300">OwnTracks</span> (free, Android and
              iPhone), set its connection to <span className="text-zinc-300">HTTP mode</span>, and paste
              this URL. The tracker, the live map and the nearby places map then follow the phone by
              themselves — no stop to move, no key to paste.
            </p>
          </div>
        </div>

        <label htmlFor="live-phone-url" className="mt-5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          URL for the phone
        </label>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input
            id="live-phone-url"
            readOnly
            value={phoneUrl}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="Loading…"
            className={cn(inputCls, "min-w-0 flex-1 font-mono text-[11px]")}
          />
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!phoneUrl}
            className="inline-flex items-center gap-2 rounded-xl bg-saffron-400 px-4 py-3 font-display text-xs font-semibold text-on-gold transition-all hover:brightness-110 active:scale-95 disabled:opacity-60"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <ol className="mt-4 space-y-2 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-5 py-4 text-[12px] leading-relaxed text-zinc-400">
          <li>
            <span className="font-semibold text-zinc-200">1.</span> In OwnTracks open{" "}
            <span className="text-zinc-300">Preferences → Connection</span> and set{" "}
            <span className="text-zinc-300">Mode</span> to <span className="text-zinc-300">HTTP</span>.
          </li>
          <li>
            <span className="font-semibold text-zinc-200">2.</span> Paste the URL above into{" "}
            <span className="text-zinc-300">URL</span>. Leave the username empty if it asks; if it wants
            a password, the token is the password.
          </li>
          <li>
            <span className="font-semibold text-zinc-200">3.</span> Turn location reporting on (the
            &quot;significant changes&quot; and &quot;move&quot; modes both work). Every fix the phone
            sends is shown here.
          </li>
        </ol>

        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
          The token in that URL is the password — anyone holding it can post a position, so keep it to
          yourself. Made a new phone, or lost one? <span className="text-zinc-300">New token</span>{" "}
          retires the old URL.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void rotate()}
            disabled={busy || !setup}
            className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-4 py-2.5 text-xs font-semibold text-zinc-200 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-60"
          >
            <RotateCcw className="h-3.5 w-3.5" /> New token
          </button>
          {fix && (
            <button
              type="button"
              onClick={() => void forget()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-4 py-2.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-200 disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" /> Forget last fix
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-4 py-2.5 text-xs font-semibold text-zinc-200 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </section>

      {/* ── what the site is showing ─────────────────────────────────── */}
      <section className="rounded-3xl glass p-6">
        <h3 className="font-display text-base font-semibold text-white">Last fix from the phone</h3>
        {!fix ? (
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            Nothing yet. Until the phone reports, the tracker shows the stop marked{" "}
            <span className="text-zinc-300">Here now</span> on the route — the dashboard's own answer,
            which never expires.
          </p>
        ) : (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Fact label="Position" value={`${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}`} mono />
              <Fact label="Taken at (IST)" value={when} />
              <Fact
                label="State"
                value={live ? "Live — the site is following the phone" : "Stale — the site uses the dashboard's stop"}
                tone={live ? "good" : "warn"}
              />
              <Fact label="Age" value={ageMinutes < 1 ? "under a minute" : `${ageMinutes} min ago`} />
              {fix.accuracyM !== null && <Fact label="Accuracy" value={`±${Math.round(fix.accuracyM)} m`} />}
              {fix.altitudeM !== null && <Fact label="Altitude" value={`${Math.round(fix.altitudeM)} m`} />}
              {fix.speedKmh !== null && <Fact label="Speed" value={`${Math.round(fix.speedKmh)} km/h`} />}
              {fix.device && <Fact label="Device" value={fix.device} mono />}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
              A fix counts as live for {Math.round((setup?.ttlMs ?? 3_600_000) / 60000)} minutes. After
              that the site quietly goes back to the route's own stop, so a phone left in a drawer
              cannot park the bike in yesterday's village.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

/** One labelled value in the "last fix" grid. */
function Fact({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "good" | "warn";
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-[12px] font-medium text-zinc-200",
          mono && "font-mono",
          tone === "good" && "text-emerald-300",
          tone === "warn" && "text-amber-200",
        )}
      >
        {value}
      </p>
    </div>
  );
}
