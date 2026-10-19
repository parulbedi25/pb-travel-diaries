/**
 * An in-memory stand-in for the MySQL repository, used by the test suite and
 * by `DB_DRIVER=memory npm run dev` when there is no database to hand.
 *
 * It implements exactly the interface in db/mysql.js — same methods, same
 * return shapes — so the routes, the auth flow and the uploads are exercised
 * for real. It is NOT durable and must never be used for the live site.
 */
import { REVISION_LIMIT } from "./mysql.js";
import { LATEST_VERSION } from "./migrations.js";

const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

export function createMemoryRepo() {
  const state = {
    content: null,
    revisions: [],
    users: [],
    sessions: new Map(),
    events: [],
    media: [],
    settings: new Map([["theme", '"dark"']]),
    nextUserId: 1,
  };

  return {
    kind: "memory",

    async ping() {},
    async close() {},
    /** Nothing to migrate in memory; kept so both drivers share one shape. */
    async migrate() {
      return { version: LATEST_VERSION, upgradedFrom: LATEST_VERSION, applied: [] };
    },

    async getContent() {
      return state.content ? clone(state.content) : null;
    },

    async putContent({ content, description, revisionId, by }) {
      const at = new Date().toISOString();
      state.content = { content, updatedAt: at, updatedBy: by ?? null };
      state.revisions.unshift({
        id: revisionId,
        description: description ?? "",
        content,
        createdAt: at,
        createdBy: by ?? null,
      });
      state.revisions = state.revisions.slice(0, REVISION_LIMIT);
      return this.listRevisions();
    },

    async listRevisions() {
      return state.revisions.map(clone);
    },

    async deleteRevision(id) {
      const before = state.revisions.length;
      state.revisions = state.revisions.filter((r) => r.id !== id);
      return state.revisions.length < before;
    },

    async countUsers() {
      return state.users.length;
    },

    async findUserByUsername(username) {
      return clone(state.users.find((u) => u.username === username) ?? null);
    },

    async findUserById(id) {
      return clone(state.users.find((u) => u.id === Number(id)) ?? null);
    },

    async listUsers() {
      return state.users.map(({ passwordHash, ...rest }) => clone(rest));
    },

    async createUser({ username, email, passwordHash, role }) {
      const id = state.nextUserId++;
      state.users.push({
        id,
        username,
        email: email ?? null,
        passwordHash,
        role,
        disabled: 0,
        disabledAt: null,
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
      });
      return id;
    },

    async updateUserPassword(id, passwordHash) {
      const user = state.users.find((u) => u.id === Number(id));
      if (user) user.passwordHash = passwordHash;
    },

    async touchLastLogin(id) {
      const user = state.users.find((u) => u.id === Number(id));
      if (user) user.lastLoginAt = new Date().toISOString();
    },

    async setUserDisabled(id, disabled) {
      const user = state.users.find((u) => u.id === Number(id));
      if (!user) return false;
      user.disabled = disabled ? 1 : 0;
      user.disabledAt = disabled ? new Date().toISOString() : null;
      if (disabled) {
        for (const [hash, session] of state.sessions) {
          if (session.userId === Number(id)) state.sessions.delete(hash);
        }
      }
      return true;
    },

    async deleteUser(id) {
      const before = state.users.length;
      state.users = state.users.filter((u) => u.id !== Number(id));
      return state.users.length < before;
    },

    async createSession({ tokenHash, userId, expiresAt, ip, userAgent }) {
      state.sessions.set(tokenHash, { tokenHash, userId: Number(userId), expiresAt, ip, userAgent });
    },

    async findSession(tokenHash) {
      const session = state.sessions.get(tokenHash);
      if (!session) return null;
      if (new Date(session.expiresAt).getTime() <= Date.now()) {
        state.sessions.delete(tokenHash);
        return null;
      }
      const user = state.users.find((u) => u.id === session.userId);
      if (!user || user.disabled) return null;
      return {
        tokenHash,
        expiresAt: session.expiresAt,
        user: { id: user.id, username: user.username, email: user.email, role: user.role },
      };
    },

    async deleteSession(tokenHash) {
      state.sessions.delete(tokenHash);
    },

    async deleteUserSessions(userId) {
      for (const [hash, session] of state.sessions) {
        if (session.userId === Number(userId)) state.sessions.delete(hash);
      }
    },

    async purgeExpiredSessions() {
      let n = 0;
      for (const [hash, session] of state.sessions) {
        if (new Date(session.expiresAt).getTime() <= Date.now()) {
          state.sessions.delete(hash);
          n++;
        }
      }
      return n;
    },

    async recordAuthEvent(event) {
      state.events.unshift({
        id: state.events.length + 1,
        userId: event.userId ?? null,
        username: event.username ?? "",
        event: event.event,
        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
        detail: event.detail ?? null,
        createdAt: new Date().toISOString(),
      });
    },

    async listAuthEvents(limit = 100) {
      return state.events.slice(0, Math.max(1, Math.min(500, Number(limit) || 100))).map(clone);
    },

    async listMedia() {
      return state.media.map(clone);
    },

    async insertMedia(row) {
      state.media.unshift({ ...row, createdAt: new Date().toISOString() });
      return row;
    },

    async findMedia(id) {
      return clone(state.media.find((m) => m.id === id) ?? null);
    },

    async deleteMedia(id) {
      const before = state.media.length;
      state.media = state.media.filter((m) => m.id !== id);
      return state.media.length < before;
    },

    /** Everything a backup needs, matching the MySQL export's shape. */
    async exportAll() {
      return clone({
        users: state.users.map((u) => ({ ...u })),
        settings: [...state.settings].map(([settingKey, value]) => ({ settingKey, value })),
        media: state.media.map((m) => ({ ...m })),
        authEvents: state.events.map((e) => ({ ...e })),
        revisions: state.revisions.map((r) => ({ ...r })),
        content: state.content,
      });
    },

    async getSetting(key) {
      return state.settings.get(key) ?? null;
    },

    async setSetting(key, value) {
      state.settings.set(key, value);
    },
  };
}
