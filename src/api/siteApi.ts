import type { SiteContent } from "../store/siteContent";
import type { MediaItem } from "../admin/mediaLibrary";
import { api } from "./client";

/** The dashboard as the server knows it. */
export interface Account {
  id: number;
  username: string;
  email: string | null;
  role: "owner" | "admin";
}

export interface AuthStatus {
  users: number;
  signedIn: boolean;
  user: Account | null;
  allowSignup: boolean;
}

export interface AuthEvent {
  id: number;
  userId: number | null;
  username: string;
  event: "signup" | "login" | "logout" | "failed_login" | "password_change" | "user_created" | "user_deleted";
  ip: string | null;
  userAgent: string | null;
  detail: string | null;
  createdAt: string;
}

export interface RevisionRow {
  id: string;
  description: string;
  content: SiteContent;
  timestamp: string;
  createdBy?: string | null;
}

export const siteApi = {
  /* ── content ─────────────────────────────────────────────────────────── */

  async loadContent(): Promise<{ content: SiteContent | null; updatedAt: string | null }> {
    return api.get("/api/content");
  },

  async publish(input: {
    content: SiteContent;
    description: string;
    revisionId: string;
  }): Promise<{ revisions: RevisionRow[] }> {
    return api.put("/api/content", input);
  },

  async loadRevisions(): Promise<RevisionRow[]> {
    const { revisions } = await api.get<{ revisions: RevisionRow[] }>("/api/revisions");
    return revisions;
  },

  async deleteRevision(id: string): Promise<void> {
    await api.delete(`/api/revisions/${encodeURIComponent(id)}`);
  },

  /* ── settings ────────────────────────────────────────────────────────── */

  async getTheme(): Promise<"dark" | "light"> {
    const { theme } = await api.get<{ theme: "dark" | "light" }>("/api/settings/theme");
    return theme;
  },

  async setTheme(theme: "dark" | "light"): Promise<void> {
    await api.put("/api/settings/theme", { theme });
  },

  /* ── accounts ────────────────────────────────────────────────────────── */

  status: () => api.get<AuthStatus>("/api/auth/status"),

  async me(): Promise<Account | null> {
    try {
      const { user } = await api.get<{ user: Account }>("/api/auth/me");
      return user;
    } catch {
      return null;
    }
  },

  async login(username: string, password: string): Promise<Account> {
    const { user } = await api.post<{ user: Account }>("/api/auth/login", { username, password });
    return user;
  },

  async signup(username: string, password: string, email?: string): Promise<Account> {
    const { user } = await api.post<{ user: Account }>("/api/auth/signup", {
      username,
      password,
      email,
    });
    return user;
  },

  async logout(): Promise<void> {
    await api.post("/api/auth/logout");
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await api.post("/api/auth/password", { currentPassword, newPassword });
  },

  async listUsers(): Promise<(Account & { createdAt: string; lastLoginAt: string | null })[]> {
    const { users } = await api.get<{ users: (Account & { createdAt: string; lastLoginAt: string | null })[] }>(
      "/api/auth/users",
    );
    return users;
  },

  async createUser(username: string, password: string, email?: string): Promise<Account> {
    const { user } = await api.post<{ user: Account }>("/api/auth/users", {
      username,
      password,
      email,
    });
    return user;
  },

  async deleteUser(id: number): Promise<void> {
    await api.delete(`/api/auth/users/${id}`);
  },

  async authEvents(limit = 100): Promise<AuthEvent[]> {
    const { events } = await api.get<{ events: AuthEvent[] }>(`/api/auth/events?limit=${limit}`);
    return events;
  },

  /* ── media ───────────────────────────────────────────────────────────── */

  async listMedia(): Promise<MediaItem[]> {
    const { media } = await api.get<{ media: MediaItem[] }>("/api/media");
    return media;
  },

  async uploadMedia(file: File): Promise<MediaItem> {
    const { item } = await api.upload<{ item: MediaItem }>("/api/media", file);
    return item;
  },

  async deleteMedia(id: string): Promise<void> {
    await api.delete(`/api/media/${encodeURIComponent(id)}`);
  },
};
