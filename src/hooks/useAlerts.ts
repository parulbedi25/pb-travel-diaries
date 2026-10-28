/**
 * The member's alert feed, kept warm.
 *
 * The server sweeps the weather every half hour (lib/alertSweeper.js); this
 * hook asks for the result a few times while the page is open, and again
 * whenever the tab comes back into view — a phone that was in a pocket on the
 * climb should not still be showing the morning's sky.
 *
 * Nothing here throws at the page: an alert feed that cannot be reached is a
 * quiet bell, not an error banner over someone's garage.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { alertsApi, type RouteAlert } from "../api/alertsApi";

/** Four minutes: cheap, and well inside the server's half-hour sweep. */
const POLL_MS = 4 * 60 * 1000;

export interface AlertState {
  alerts: RouteAlert[];
  unread: number;
  canPost: boolean;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  markRead: (ids?: number[]) => Promise<void>;
  postNotice: (input: { title: string; body?: string; place?: string; hours?: number }) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export function useAlerts(enabled: boolean): AlertState {
  const [alerts, setAlerts] = useState<RouteAlert[]>([]);
  const [canPost, setCanPost] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const feed = await alertsApi.list();
      if (!alive.current) return;
      setAlerts(feed.alerts);
      setCanPost(feed.canPost);
      setError("");
    } catch {
      if (alive.current) setError("Alerts could not be fetched just now.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setAlerts([]);
      setCanPost(false);
      return;
    }
    void reload();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, reload]);

  const markRead = useCallback(
    async (ids?: number[]) => {
      // Optimistic: the list is the member's own reading state, and a round
      // trip should not make a ticked alert look unticked.
      const target = ids ? new Set(ids) : null;
      const touched = alerts.filter((alert) => (target ? target.has(alert.id) : !alert.read));
      if (!touched.length) return;
      setAlerts((current) =>
        current.map((alert) => (target ? (target.has(alert.id) ? { ...alert, read: true } : alert) : { ...alert, read: true })),
      );
      try {
        await alertsApi.markRead(touched.map((alert) => alert.id));
      } catch {
        // Put them back: the server is the truth about what has been read.
        void reload();
      }
    },
    [alerts, reload],
  );

  const postNotice = useCallback(
    async (input: { title: string; body?: string; place?: string; hours?: number }) => {
      await alertsApi.postNotice(input);
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (id: number) => {
      setAlerts((current) => current.filter((alert) => alert.id !== id));
      try {
        await alertsApi.remove(id);
      } finally {
        void reload();
      }
    },
    [reload],
  );

  return {
    alerts,
    unread: alerts.filter((alert) => !alert.read).length,
    canPost,
    loading,
    error,
    reload,
    markRead,
    postNotice,
    remove,
  };
}
