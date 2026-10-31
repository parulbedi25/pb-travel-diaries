import { useEffect, useMemo, useState } from "react";
import { Check, Clock, Copy, MapPin, RefreshCw, RotateCcw, Satellite, Trash2 } from "lucide-react";
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
 *
 * The second decision is how often the pin may move. "Live" follows every fix;
 * anything slower is a rhythm the owner picks — every five minutes, every hour,
 * once a day — and the site keeps receiving fixes meanwhile, so the map is never
 * frozen, only paced.
 */

/** "Live", "every 5 minutes", "every 3 hours", "once a day". */
export function cadenceLabel(minutes: number): string {
  const value = Math.trunc(Number(minutes)) || 0;
  if (value <= 0) return "Live";
  if (value === 1) return "Every minute";
  if (value < 60) return `Every ${value} minutes`;
  if (value === 60) return "Every hour";
  if (value === 24 * 60) return "Once a day";
  const hours = value / 60;
  return `Every ${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
}

/** The same rhythm as a sentence for the line under the picker. */
function cadenceHint(minutes: number): string {
  if (minutes <= 0) return "The pin moves every time the phone reports a fix.";
  if (minutes === 24 * 60)
    return "The pin moves once a day, at the same time, to the latest fix waiting for it.";
  return `The pin moves at most once every ${cadenceLabel(minutes).replace(/^Every /, "")}, to the latest fix waiting for it.`;
}

/** "in 4 min", "in 2 h 10 min", "now" — until the pin may move again. */
function untilLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "as soon as the next fix arrives";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "in less than a minute";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `in ${hours} h ${rest} min` : `in ${hours} h`;
}

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
  // What the site is showing (the map's point) against what the phone last said.
  // In live mode they are the same object; on a slow rhythm they differ until
  // the pin is allowed to move again.
  const shown = setup?.shown ?? fix;
  const waiting = Boolean(fix && shown && fix.updatedAt !== shown.updatedAt);
  const cadence = setup?.cadenceMinutes ?? 0;
  const ageMinutes = shown ? Math.max(0, Math.round((Date.now() - Date.parse(shown.updatedAt)) / 60000)) : 0;
  const live = shown ? Date.now() - Date.parse(shown.updatedAt) <= (setup?.ttlMs ?? 3_600_000) : false;
  const when = shown
    ? new Date(shown.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true })
    : "";

  /** Save a new rhythm and keep the panel's own copy of it in step. */
  const chooseCadence = async (minutes: number) => {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const saved = await siteApi.setLiveCadence(minutes);
      setSetup((old) => (old ? { ...old, ...saved } : old));
      setNotice(
        saved.cadenceMinutes === 0
          ? "The pin follows every fix from now on."
          : `The pin will move ${cadenceLabel(saved.cadenceMinutes).toLowerCase()}${
              saved.nextUpdateAt ? ` — the next move is ${untilLabel(saved.nextUpdateAt)}` : ""
            }.`,
      );
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

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

      {/* ── how often the pin may move ──────────────────────────────── */}
      <section className="rounded-3xl glass p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/[0.06] text-saffron-300">
            <Satellite className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold text-white">How often the map moves</h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Follow the ride live, or let the pin jump every few minutes to a few hours. The phone
              keeps reporting either way — this only decides when the tracker, the live map and the
              nearby page move.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="How often the pin moves">
          {(setup?.choices ?? [0, 1, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440]).map((minutes) => {
            const active = cadence === minutes;
            return (
              <button
                key={minutes}
                type="button"
                onClick={() => void chooseCadence(minutes)}
                disabled={busy || !setup}
                aria-pressed={active}
                className={cn(
                  "rounded-full border px-3.5 py-2 text-[11px] font-semibold transition-colors",
                  active
                    ? "border-saffron-400 bg-saffron-400/15 text-white"
                    : "border-white/12 text-zinc-300 hover:border-white/25 hover:bg-white/[0.06] hover:text-white",
                  busy && "opacity-60",
                )}
              >
                {minutes === 0 ? "Live" : cadenceLabel(minutes)}
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
          <span className="font-semibold text-zinc-300">{cadenceLabel(cadence)}</span> — {cadenceHint(cadence)}
          {cadence > 0 && setup?.nextUpdateAt && (
            <>
              {" "}
              <span className="inline-flex items-center gap-1 text-saffron-300">
                <Clock className="h-3 w-3" /> Next move {untilLabel(setup.nextUpdateAt)}.
              </span>
            </>
          )}
        </p>
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
              <Fact
                label="On the map now"
                value={
                  shown
                    ? `${shown.lat.toFixed(5)}, ${shown.lng.toFixed(5)}`
                    : "the dashboard's stop"
                }
                mono
              />
              <Fact label="Taken at (IST)" value={when} />
              <Fact
                label="State"
                value={live ? "Live — the site is following the phone" : "Stale — the site uses the dashboard's stop"}
                tone={live ? "good" : "warn"}
              />
              <Fact label="Age" value={ageMinutes < 1 ? "under a minute" : `${ageMinutes} min ago`} />
              {shown?.accuracyM != null && <Fact label="Accuracy" value={`±${Math.round(shown.accuracyM)} m`} />}
              {shown?.altitudeM != null && <Fact label="Altitude" value={`${Math.round(shown.altitudeM)} m`} />}
              {shown?.speedKmh != null && <Fact label="Speed" value={`${Math.round(shown.speedKmh)} km/h`} />}
              {fix?.device && <Fact label="Device" value={fix.device} mono />}
            </div>

            {/* The phone is ahead of the pin — that is the rhythm working, so it
                is said plainly instead of looking like a fault. */}
            {waiting && fix && (
              <p className="mt-3 rounded-xl border border-saffron-400/25 bg-saffron-400/10 px-4 py-3 text-[11px] leading-relaxed text-saffron-100">
                The phone is at{" "}
                <span className="font-mono font-semibold">
                  {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
                </span>{" "}
                ({new Date(fix.updatedAt).toLocaleTimeString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  hour12: true,
                })}). The pin moves there{" "}
                {setup?.nextUpdateAt ? untilLabel(setup.nextUpdateAt) : "at the next update"} — the{" "}
                {cadenceLabel(cadence).toLowerCase()} rhythm is holding it back.
              </p>
            )}

            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
              A point counts as live for {Math.round((setup?.ttlMs ?? 3_600_000) / 60000)} minutes — an
              hour, plus whatever rhythm you chose. After that the site quietly goes back to the route's
              own stop, so a phone left in a drawer cannot park the bike in yesterday's village.
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
