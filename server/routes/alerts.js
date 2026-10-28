/**
 * What the road ahead is doing, for the people following it.
 *
 * Two kinds of alert share this table and this page:
 *
 *  - **weather** — raised by the half-hourly sweep (lib/alertSweeper.js) from
 *    the same forecast the tracker draws on: thunderstorms, heavy rain or snow,
 *    freezing rain, fog, heat, hard frost and high wind at any stop on the
 *    route. Nobody has to be watching for these; they appear.
 *  - **road** — a closure, a landslide, a washed-out bridge: things no forecast
 *    can see. The owner or an editor posts one from the dashboard, with how
 *    long it stands for, and every account sees it in the same list.
 *
 * Reading is per member: `alert_reads` remembers what each person has opened,
 * so one member clearing their list does not clear anybody else's. Everything
 * here is behind a signed-in account, and nothing here can change the site.
 *
 *   GET    /alerts                the list, with this member's unread count
 *   POST   /alerts/read           mark some (or all) as read
 *   POST   /alerts                post a road notice            (editor)
 *   POST   /alerts/refresh        sweep the weather now         (any member)
 *   DELETE /alerts/:id            remove one                    (editor)
 */
import express from "express";
import { getRepo } from "../db/index.js";
import { requireUser, requireEditor } from "../lib/auth.js";
import { sweepIfStale, SWEEP_MS } from "../lib/alertSweeper.js";

export const alertsRouter = express.Router();

const MAX_TITLE = 140;
const MAX_BODY = 800;
const MAX_PLACE = 120;
const MAX_READ = 200;

const problem = (message, status = 400) => Object.assign(new Error(message), { status });

/** A coordinate, or nothing at all — `Number(null)` is 0, which is a place. */
const coord = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const iso = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** One row, as the dashboard and the member page both want it. */
const shape = (alert, read) => ({
  id: Number(alert.id),
  kind: alert.kind ?? "weather",
  severity: alert.severity ?? "info",
  title: alert.title ?? "",
  body: alert.body ?? "",
  place: alert.place ?? "",
  lat: alert.lat == null ? null : Number(alert.lat),
  lng: alert.lng == null ? null : Number(alert.lng),
  source: alert.source ?? "weather",
  createdAt: iso(alert.createdAt),
  expiresAt: iso(alert.expiresAt),
  read: Boolean(read),
});

/** Alerts are for members; the closed door says so in words. */
alertsRouter.get("/alerts", requireUser, async (req, res, next) => {
  try {
    const repo = await getRepo();
    // Opening the list is the natural moment to catch up: if the last sweep is
    // older than half an hour, this request runs one first. It never blocks
    // the answer for long — a weather service that is down still returns the
    // alerts already stored.
    await sweepIfStale({ repo }).catch(() => undefined);

    const [alerts, readIds] = await Promise.all([
      repo.listAlerts({ now: new Date().toISOString(), limit: 60 }),
      repo.readAlertIds(req.user.id).catch(() => []),
    ]);
    const readSet = new Set(readIds.map(Number));
    const list = alerts.map((alert) => shape(alert, readSet.has(Number(alert.id))));
    res.json({
      alerts: list,
      unread: list.filter((alert) => !alert.read).length,
      sweepMinutes: SWEEP_MS / 60_000,
      canPost: req.user.role === "owner" || req.user.role === "admin",
    });
  } catch (error) {
    next(error);
  }
});

/** Mark alerts read. No ids means "everything I can see". */
alertsRouter.post("/alerts/read", requireUser, async (req, res, next) => {
  try {
    const repo = await getRepo();
    const requested = Array.isArray(req.body?.ids) ? req.body.ids : null;
    let ids = requested;
    if (!ids) {
      const alerts = await repo.listAlerts({ now: new Date().toISOString(), limit: 60 });
      ids = alerts.map((alert) => Number(alert.id));
    }
    ids = ids
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0)
      .slice(0, MAX_READ);
    const marked = ids.length ? await repo.markAlertsRead(req.user.id, ids, new Date().toISOString()) : 0;
    res.json({ marked });
  } catch (error) {
    next(error);
  }
});

/** "Weather now" — a member asking for a fresh sweep rather than waiting. */
alertsRouter.post("/alerts/refresh", requireUser, async (req, res, next) => {
  try {
    const repo = await getRepo();
    const result = await sweepIfStale({ repo, maxAgeMs: 0 });
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

/**
 * Post a road notice — a closure, a landslide, a bridge down.
 *
 * This is the half of the feature no forecast can do, so it is deliberately
 * small: a headline, a line of detail, the place, and how long it stands for.
 * It expires on its own, so yesterday's blockade does not haunt the list.
 */
alertsRouter.post("/alerts", requireEditor, async (req, res, next) => {
  try {
    const title = String(req.body?.title ?? "").trim();
    if (title.length < 4) throw problem("Give the notice a headline — “NH-503 blocked at Ropar”, say.");
    if (title.length > MAX_TITLE) throw problem(`Keep the headline under ${MAX_TITLE} characters.`);
    const body = String(req.body?.body ?? "").trim().slice(0, MAX_BODY);
    const place = String(req.body?.place ?? "").trim().slice(0, MAX_PLACE);
    const hours = Number(req.body?.hours ?? 12);
    if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 14) {
      throw problem("How long does it stand for? Between 1 hour and 14 days.");
    }
    const severity = ["info", "watch", "warning"].includes(req.body?.severity)
      ? req.body.severity
      : "warning";

    const repo = await getRepo();
    const now = new Date();
    const dedupeKey = `road:${now.toISOString().slice(0, 16)}:${title.slice(0, 80).toLowerCase()}`;
    const inserted = await repo.insertAlerts([
      {
        kind: "road",
        severity,
        title,
        body,
        place,
        lat: coord(req.body?.lat),
        lng: coord(req.body?.lng),
        source: "admin",
        dedupeKey,
        routeSignature: "",
        expiresAt: new Date(now.getTime() + hours * 3600 * 1000).toISOString(),
      },
    ]);
    res.status(201).json({ ok: true, inserted });
  } catch (error) {
    next(error);
  }
});

/** Take a notice down — a road reopens before its expiry, usually. */
alertsRouter.delete("/alerts/:id", requireEditor, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw problem("That is not an alert.");
    const repo = await getRepo();
    const removed = await repo.deleteAlert(id);
    if (!removed) return res.status(404).json({ error: "That alert is already gone." });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
