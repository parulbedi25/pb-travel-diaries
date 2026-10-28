/**
 * The alerts the server keeps about the road ahead.
 *
 * Two kinds share one list: the weather the half-hourly sweep raised from the
 * forecast for the route in the live tracker, and notices an owner posts by
 * hand for the things no forecast can see — a landslide, a washed-out bridge, a
 * closed pass. Reading is per account: one member clearing their list leaves
 * everybody else's unread, which is why the read state lives on the server
 * rather than in this browser.
 */

import { api } from "./client";

export type AlertSeverity = "info" | "watch" | "warning";

export interface RouteAlert {
  id: number;
  kind: "weather" | "road";
  severity: AlertSeverity;
  title: string;
  body: string;
  place: string;
  lat: number | null;
  lng: number | null;
  source: string;
  createdAt: string | null;
  expiresAt: string | null;
  read: boolean;
}

export interface AlertFeed {
  alerts: RouteAlert[];
  unread: number;
  /** How often the server sweeps the weather, in minutes. */
  sweepMinutes: number;
  /** True for the accounts allowed to post a road notice. */
  canPost: boolean;
}

export interface NoticeInput {
  title: string;
  body?: string;
  place?: string;
  hours?: number;
  severity?: AlertSeverity;
}

export const alertsApi = {
  async list(): Promise<AlertFeed> {
    return api.get<AlertFeed>("/api/alerts");
  },

  /** No ids means everything: the usual "mark all read" on opening the panel. */
  async markRead(ids?: number[]): Promise<number> {
    const { marked } = await api.post<{ marked: number }>("/api/alerts/read", ids ? { ids } : {});
    return marked;
  },

  /** Ask the server to sweep the weather now instead of at the next half hour. */
  async refresh(): Promise<void> {
    await api.post("/api/alerts/refresh", {});
  },

  async postNotice(input: NoticeInput): Promise<void> {
    await api.post("/api/alerts", input);
  },

  async remove(id: number): Promise<void> {
    await api.delete(`/api/alerts/${id}`);
  },
};
