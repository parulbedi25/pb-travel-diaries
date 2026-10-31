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
  /** Switched off by the owner: cannot sign in, cannot read the gated parts. */
  disabled?: boolean;
  disabledAt?: string | null;
}

/**
 * The newest position the phone sent, as `/api/live` hands it out.
 *
 * `updatedAt` is when the phone took the fix, not when the server received it:
 * a phone that was out of signal delivers an hour-old point, and that point is
 * an hour old.
 */
export interface LiveFix {
  lat: number;
  lng: number;
  updatedAt: string;
  accuracyM: number | null;
  altitudeM: number | null;
  speedKmh: number | null;
}

/** One fix as the dashboard sees it: the map's fields plus the phone's own. */
export type LiveFixDetail = LiveFix & { battery: number | null; device: string };

/** What `/api/live` answers. `fix` is the point currently on the map, which is
 * not always the newest one — see `cadenceMinutes`. */
export interface LiveNow {
  fix: LiveFix | null;
  /** How often the pin may move, in minutes. 0 means every fix. */
  cadenceMinutes?: number;
  /** How old the point may be before the site falls back to the dashboard stop. */
  ttlMs?: number;
  /** When the pin is allowed to move next, or null while the map is live. */
  nextUpdateAt?: string | null;
}

/** What the dashboard learns about the phone feed. Everything but the fix is
 * the same for every link: the token and where to post. */
export interface LiveSetup {
  token: string;
  path: string;
  ttlMs: number;
  /** The rhythm the owner chose, in minutes. 0 is live. */
  cadenceMinutes: number;
  /** The rhythms the panel offers, in minutes. */
  choices?: number[];
  maxCadenceMinutes?: number;
  nextUpdateAt?: string | null;
  /** The point the map is showing. */
  shown?: LiveFixDetail | null;
  /** The newest point the phone sent — what the map jumps to next. */
  fix: LiveFixDetail | null;
}

/** What the first-run setup screen needs to know. */
export interface SetupStatus {
  installed: boolean;
  needsOwner: boolean;
  databaseReady: boolean;
  users: number;
  siteTitle: string;
  db: {
    driver?: "mysql" | "sqlite";
    host: string;
    port: number;
    database: string;
    user: string;
    socketPath: string;
    /**
     * A password is already stored on the server (in its environment or its
     * install file). The password itself is never sent to a browser, so the
     * field may be left blank and the server will use the stored one.
     */
    passwordStored?: boolean;
  } | null;
  setupLocked: boolean;
  /** The "Restore a backup" tab: only while the site has no database yet. */
  restoreAllowed?: boolean;
  /** Where the API lives, when this folder is not it (`--api`). */
  apiUrl?: string;
  error?: string | null;
  mode: "installer" | "env" | "memory";
}

export interface SetupDatabaseInput {
  connectionMode?: "provider" | "local";
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

/** What the restore screen learns from an uploaded backup, before restoring. */
export interface RestorePreview {
  uploadId: string;
  fileName: string;
  siteTitle: string;
  createdAt: string | null;
  reason: string;
  schemaVersion: number;
  database: {
    driver?: "mysql" | "sqlite";
    host?: string;
    port?: number;
    database: string;
    user?: string;
    password?: string;
    socketPath?: string;
  } | null;
  users: number;
  revisions: number;
  mediaFiles: number;
  mediaBytes: number;
  hasApp: boolean;
  hasContent: boolean;
}

export interface RestoreResult {
  ok: boolean;
  siteTitle: string;
  users: number;
  revisions: number;
  mediaRecords: number;
  mediaFiles: number;
  authEvents: number;
  settings: number;
  schemaVersion: number;
  restoredFrom: string | null;
}

/** One zip in the backup folder. */
export interface BackupEntry {
  name: string;
  bytes: number;
  createdAt: string;
}

export interface BackupState {
  enabled: boolean;
  hour: number;
  keep: number;
  dir: string;
  includeApp: boolean;
  lastBackupAt: string | null;
  nextRunAt: string | null;
  backups: BackupEntry[];
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

  /**
   * A shortened map link, expanded to the directions URL behind it.
   *
   * The redirect cannot be read from the browser — a cross-origin `Location`
   * header is invisible to `fetch` — so the server follows it (see
   * server/routes/maps.js) and hands back the address it ends at.
   */
  async resolveMapLink(url: string): Promise<string> {
    const { url: expanded } = await api.post<{ url: string }>("/api/maps/resolve", { url });
    return expanded;
  },

  /**
   * Whether this server can reach the map services at all.
   *
   * A short link can only be expanded where the server has a way out to
   * Google; when it does not, no amount of retrying will help and the answer
   * needs to be "the server cannot reach Google", not "the link is bad".
   */
  async mapLinkHealth(): Promise<{
    reachable: boolean;
    code: string;
    ms: number;
    proxy: string;
    /** "environment" when the proxy came from a variable, "system" on a Mac. */
    proxySource: string;
    /** A PAC file the server can see but cannot follow. */
    pac: string;
    platform: string;
    node: string;
    /** 0 when the stack chose, 4 or 6 when one family was needed. */
    family: number;
    /** Which way out answered: "proxy" or "direct". */
    route: string;
    /** Every way out tried, in order, with the reason each one failed. */
    routes: { route: string; error: string }[];
    hint: string;
  }> {
    return api.get("/api/maps/health");
  },

  /* ── settings ────────────────────────────────────────────────────────── */

  async getTheme(): Promise<"dark" | "light"> {
    const { theme } = await api.get<{ theme: "dark" | "light" }>("/api/settings/theme");
    return theme;
  },

  async setTheme(theme: "dark" | "light"): Promise<void> {
    await api.put("/api/settings/theme", { theme });
  },

  /* ── live location, from the phone ───────────────────────────────────── */

  /** The newest fix from OwnTracks, or null when the phone has not reported. */
  live: () => api.get<LiveNow>("/api/live"),

  /** The URL and token to paste into the phone. Owner only. */
  liveSetup: () => api.get<LiveSetup>("/api/live/setup"),

  /** A new token: the URL already in the phone stops working. */
  newLiveToken: () => api.post<{ token: string; path: string }>("/api/live/setup/token", {}),

  /** How often the pin may move: 0 is live, anything else is whole minutes. */
  setLiveCadence: (minutes: number) =>
    api.post<Pick<LiveSetup, "cadenceMinutes" | "ttlMs" | "nextUpdateAt">>(
      "/api/live/setup/cadence",
      { minutes },
    ),

  /** Forget the last fix, so the site goes back to the dashboard's stop. */
  clearLiveFix: () => api.delete<{ fix: null }>("/api/live/fix"),

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

  /**
   * Create a read-only account.
   *
   * `bike` is the member's first bike, straight from the signup form: maker and
   * model as names, the purchase year, and a mileage they may leave blank so
   * the server can estimate it. It is optional — an account without a bike is
   * still a perfectly good account, and a bike can be added later from the
   * garage.
   */
  async signup(
    username: string,
    password: string,
    email?: string,
    bike?: { maker: string; model: string; year?: number | null; mileageKmpl?: number | null },
  ): Promise<Account> {
    const { user } = await api.post<{ user: Account }>("/api/auth/signup", {
      username,
      password,
      email,
      bikeMaker: bike?.maker,
      bikeModel: bike?.model,
      bikeYear: bike?.year ?? null,
      bikeMileage: bike?.mileageKmpl ?? null,
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

  /** Switch an account off (or back on). Disabling drops its sessions. */
  async setUserDisabled(id: number, disabled: boolean): Promise<Account> {
    const { user } = await api.patch<{ user: Account }>(`/api/auth/users/${id}`, { disabled });
    return user;
  },

  /* ── backups ─────────────────────────────────────────────────────────── */

  async listBackups(): Promise<BackupState> {
    return api.get<BackupState>("/api/backups");
  },

  async createBackup(): Promise<BackupEntry> {
    const { backup } = await api.post<{ backup: BackupEntry }>("/api/backups");
    return backup;
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

  /** Tags for a photo: what it shows, for alt text and for finding it again. */
  async setMediaTags(id: string, tags: string[]): Promise<MediaItem> {
    const { item } = await api.patch<{ item: MediaItem }>(
      `/api/media/${encodeURIComponent(id)}`,
      { tags },
    );
    return item;
  },

  /** Write edited pixels back over the original file, same id and URL. */
  async replaceMediaImage(id: string, file: File): Promise<MediaItem> {
    const { item } = await api.upload<{ item: MediaItem }>(
      `/api/media/${encodeURIComponent(id)}/file`,
      file,
      "file",
      "PUT",
    );
    return item;
  },

  /* ── site identity ───────────────────────────────────────────────────── */

  async getSiteSettings(): Promise<SiteSettings> {
    return api.get<SiteSettings>("/api/settings/site");
  },

  async saveSiteSettings(input: Partial<SiteSettings>): Promise<SiteSettings> {
    return api.put<SiteSettings>("/api/settings/site", input);
  },

  /* ── first-run setup ─────────────────────────────────────────────────── */

  /**
   * The first question every deployment asks.
   *
   * One program answers it. Before the database exists the Node app still
   * starts — that is how it offers the installer at all — so there is no second
   * server to try and nothing to fall back to.
   */
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

  /** Upload a backup and read it, without changing anything. */
  async inspectBackup(file: File): Promise<RestorePreview> {
    return api.upload<RestorePreview>("/api/setup/restore/inspect", file);
  },

  async restoreBackup(input: {
    uploadId: string;
    host: string;
    port: string | number;
    database: string;
    user: string;
    password: string;
    socketPath?: string;
    replace: boolean;
  }): Promise<RestoreResult> {
    return api.post<RestoreResult>("/api/setup/restore", input);
  },

  /**
   * Create the owner account.
   *
   * The account is created without a session: the caller sends the person to
   * the sign-in screen and they type the password again, which is how a
   * brand-new site proves the password is known before it hands out a cookie.
   */
  async setupOwner(input: {
    username: string;
    password: string;
    email?: string;
  }): Promise<{ user: Account }> {
    return api.post<{ user: Account; signedIn: boolean; next: "login" }>(
      "/api/setup/owner",
      input,
    );
  },
};
