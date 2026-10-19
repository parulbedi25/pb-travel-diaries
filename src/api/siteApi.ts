import type { SiteContent } from "../store/siteContent";
import type { MediaItem } from "../admin/mediaLibrary";
import { api } from "./client";

/** The dashboard as the server knows it. */
export interface Account {
  id: number;
  username: string;
  email: string | null;
  /** readers can sign in and see members-only sections, nothing else. */
  role: "owner" | "admin" | "reader";
}

/** What the first-run setup screen needs to know. */
export interface SetupStatus {
  installed: boolean;
  needsOwner: boolean;
  databaseReady: boolean;
  users: number;
  siteTitle: string;
  db: { host: string; port: number; database: string; user: string; socketPath: string } | null;
  setupLocked: boolean;
  error?: string | null;
  mode: "installer" | "env" | "memory";
}

export interface SetupDatabaseInput {
  siteTitle: string;
  host: string;
  port: string | number;
  database: string;
  user: string;
  password: string;
  socketPath?: string;
}

/** What the setup screen learns from "Test connection". */
export interface SetupTestResult {
  /** True only when the database exists and the user can open it. */
  ok: boolean;
  serverVersion: string;
  database: string;
  databaseExists: boolean;
  /** A sentence to show as-is: what worked, or what to create first. */
  message: string;
}

export interface SiteSettings {
  title: string;
  allowSignup: boolean;
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

  async createUser(
    username: string,
    password: string,
    email?: string,
    role: "admin" | "reader" = "admin",
  ): Promise<Account> {
    const { user } = await api.post<{ user: Account }>("/api/auth/users", {
      username,
      password,
      email,
      role,
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

  /* ── site identity ───────────────────────────────────────────────────── */

  async getSiteSettings(): Promise<SiteSettings> {
    return api.get<SiteSettings>("/api/settings/site");
  },

  async saveSiteSettings(input: Partial<SiteSettings>): Promise<SiteSettings> {
    return api.put<SiteSettings>("/api/settings/site", input);
  },

  /* ── first-run setup ─────────────────────────────────────────────────── */

  setupStatus: () => api.get<SetupStatus>("/api/setup/status"),

  async testDatabase(input: SetupDatabaseInput): Promise<SetupTestResult> {
    return api.post<SetupTestResult>("/api/setup/test", input);
  },

  async setupDatabase(input: SetupDatabaseInput): Promise<{
    ok: boolean;
    siteTitle: string;
    createdDatabase: boolean;
    users: number;
    needsOwner: boolean;
    next: "owner" | "login";
  }> {
    return api.post("/api/setup/database", input);
  },

  async setupOwner(input: {
    username: string;
    password: string;
    email?: string;
  }): Promise<Account> {
    const { user } = await api.post<{ user: Account }>("/api/setup/owner", input);
    return user;
  },
};
