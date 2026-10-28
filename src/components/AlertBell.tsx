/**
 * The bell in the member's header, and the list behind it.
 *
 * Everything here is about the road the live tracker is following:
 *
 *  - weather the server's half-hourly sweep judged worth knowing about
 *    (thunder, heavy rain or snow, ice, fog, heat, hard frost, high wind), and
 *  - notices an owner posted by hand for what no forecast can see — a
 *    landslide, a bridge down, a pass closed.
 *
 * It is a bell rather than a banner on purpose. A closure that matters is
 * opened; a storm three days out is something to read before packing. The count
 * is only ever of this member's unread alerts, and opening the list clears it.
 */

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BellRing,
  Check,
  CloudRain,
  CloudSnow,
  CloudFog,
  Loader2,
  MapPin,
  Plus,
  Route as RouteIcon,
  Snowflake,
  Trash2,
  Wind,
  X,
} from "lucide-react";
import type { RouteAlert } from "../api/alertsApi";
import { cn } from "../utils/cn";

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:border-saffron-400/60 focus:outline-none focus:ring-2 focus:ring-saffron-400/20";

const severityTone: Record<string, { ring: string; text: string; chip: string; label: string }> = {
  warning: {
    ring: "border-red-400/30",
    text: "text-red-200",
    chip: "bg-red-500/15 text-red-200",
    label: "Warning",
  },
  watch: {
    ring: "border-amber-400/30",
    text: "text-amber-200",
    chip: "bg-amber-500/15 text-amber-200",
    label: "Watch",
  },
  info: {
    ring: "border-sky-400/25",
    text: "text-sky-200",
    chip: "bg-sky-500/15 text-sky-200",
    label: "Note",
  },
};

/** The glyph that matches what the alert is about, read off its headline. */
function Glyph({ alert, className }: { alert: RouteAlert; className?: string }) {
  const title = alert.title.toLowerCase();
  if (alert.kind === "road") return <RouteIcon className={className} />;
  if (title.includes("snow")) return <CloudSnow className={className} />;
  if (title.includes("freeze") || title.includes("ice")) return <Snowflake className={className} />;
  if (title.includes("fog") || title.includes("visibility")) return <CloudFog className={className} />;
  if (title.includes("wind")) return <Wind className={className} />;
  if (title.includes("rain")) return <CloudRain className={className} />;
  return <AlertTriangle className={className} />;
}

/** "20 minutes ago", "3 hours ago", with a date once it is older than a day. */
function when(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function AlertBell({
  alerts,
  unread,
  loading,
  canPost,
  onMarkRead,
  onPostNotice,
  onRemove,
}: {
  alerts: RouteAlert[];
  unread: number;
  loading: boolean;
  canPost: boolean;
  onMarkRead: (ids?: number[]) => Promise<void>;
  onPostNotice: (input: { title: string; body?: string; place?: string; hours?: number }) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [place, setPlace] = useState("");
  const [hours, setHours] = useState("12");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const shell = useRef<HTMLDivElement | null>(null);

  /**
   * Opening the bell is the same act as reading the alerts: the count is
   * cleared in the same gesture, because there is nothing else a member would
   * mean by opening it.
   */
  const openPanel = () => {
    setOpen(true);
    if (unread > 0) void onMarkRead();
  };

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (shell.current && !shell.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const submit = async () => {
    const headline = title.trim();
    if (headline.length < 4) {
      setProblem("Give the notice a headline — “NH-503 blocked at Ropar”, say.");
      return;
    }
    setBusy(true);
    setProblem("");
    try {
      await onPostNotice({ title: headline, body: body.trim(), place: place.trim(), hours: Number(hours) });
      setTitle("");
      setBody("");
      setPlace("");
      setPosting(false);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The notice could not be posted.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={shell}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-expanded={open}
        aria-label={unread > 0 ? `Road alerts, ${unread} unread` : "Road alerts"}
        className={cn(
          "relative grid h-9 w-9 place-items-center rounded-full border transition-colors",
          unread > 0
            ? "border-saffron-400/40 bg-saffron-400/15 text-saffron-200 hover:bg-saffron-400/25"
            : "border-white/10 bg-white/[0.06] text-zinc-400 hover:bg-white/[0.12] hover:text-white",
        )}
      >
        {unread > 0 ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[min(23rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-white/10 bg-ink-900/95 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
            <div>
              <p className="font-display text-sm font-semibold text-white">Road ahead</p>
              <p className="text-[11px] text-zinc-500">
                Weather along the live route, swept every 30 minutes
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid h-7 w-7 place-items-center rounded-full text-zinc-500 transition-colors hover:bg-white/[0.08] hover:text-white"
              aria-label="Close alerts"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="max-h-[22rem] overflow-y-auto">
            {loading && alerts.length === 0 && (
              <p className="flex items-center gap-2 px-4 py-6 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking the road…
              </p>
            )}
            {!loading && alerts.length === 0 && (
              <p className="px-4 py-6 text-center text-xs leading-relaxed text-zinc-500">
                Nothing to report. The road in the live tracker is clear on the forecast, and no closure
                has been posted.
              </p>
            )}
            {alerts.map((alert) => {
              const tone = severityTone[alert.severity] ?? severityTone.info;
              return (
                <article
                  key={alert.id}
                  className={cn(
                    "flex gap-3 border-b border-white/[0.05] px-4 py-3 last:border-b-0",
                    !alert.read && "bg-white/[0.03]",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border",
                      tone.ring,
                      tone.text,
                    )}
                  >
                    <Glyph alert={alert} className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-xs font-semibold leading-snug text-white">
                      <span className="min-w-0 truncate">{alert.title}</span>
                      {!alert.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-saffron-400" />}
                    </p>
                    {alert.body && (
                      <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{alert.body}</p>
                    )}
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-zinc-500">
                      {alert.place && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {alert.place}
                        </span>
                      )}
                      <span className={cn("rounded-full px-1.5 py-0.5 font-semibold", tone.chip)}>
                        {tone.label}
                      </span>
                      <span>{when(alert.createdAt)}</span>
                      <span className="text-zinc-600">{alert.kind === "road" ? "posted" : "forecast"}</span>
                      {canPost && alert.kind === "road" && (
                        <button
                          type="button"
                          onClick={() => void onRemove(alert.id)}
                          className="ml-auto inline-flex items-center gap-1 text-zinc-500 transition-colors hover:text-red-300"
                        >
                          <Trash2 className="h-3 w-3" /> Take down
                        </button>
                      )}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>

          {canPost && (
            <div className="border-t border-white/[0.07] px-4 py-3">
              {!posting ? (
                <button
                  type="button"
                  onClick={() => setPosting(true)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-saffron-300 transition-colors hover:text-saffron-200"
                >
                  <Plus className="h-3.5 w-3.5" /> Post a road notice
                </button>
              ) : (
                <div className="space-y-2">
                  <input
                    className={inputCls}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="NH-503 blocked at Ropar"
                    aria-label="Notice headline"
                  />
                  <input
                    className={inputCls}
                    value={place}
                    onChange={(event) => setPlace(event.target.value)}
                    placeholder="Place (optional)"
                    aria-label="Place"
                  />
                  <textarea
                    className={cn(inputCls, "min-h-14 resize-y")}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder="Landslide near the bend; diversions through Morinda."
                    aria-label="Detail"
                  />
                  <div className="flex items-center gap-2">
                    <select
                      className={cn(inputCls, "w-28")}
                      value={hours}
                      onChange={(event) => setHours(event.target.value)}
                      aria-label="How long it stands for"
                    >
                      {["3", "6", "12", "24", "48", "168"].map((value) => (
                        <option key={value} value={value}>
                          {Number(value) >= 48 ? `${Number(value) / 24} days` : `${value} hours`}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void submit()}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-saffron-400 px-3 py-2 text-[11px] font-bold text-on-gold transition-all hover:brightness-110 disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Post
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPosting(false);
                        setProblem("");
                      }}
                      className="text-[11px] text-zinc-500 transition-colors hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                  {problem && <p className="text-[11px] text-red-300">{problem}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
