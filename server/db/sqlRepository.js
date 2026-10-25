/** Repository queries shared by SQL drivers. SQLite adapts the few SQL dialect differences. */
import { authEventLimit } from "../lib/sqlSafety.js";
export const REVISION_LIMIT = 15;

/** Rows carry JSON strings and 0/1 flags; the routes deal in real objects. */
const parseJson = (value, fallback) => {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const rowAsBike = (row) => ({
  id: Number(row.id),
  maker: row.maker,
  model: row.model,
  year: row.year == null ? null : Number(row.year),
  mileageKmpl: row.mileageKmpl == null ? null : Number(row.mileageKmpl),
  mileageSource: row.mileageSource === "estimated" ? "estimated" : "manual",
  createdAt: row.createdAt ?? null,
});

const rowAsJourney = (row) => ({
  id: Number(row.id),
  title: row.title ?? "",
  bikeId: row.bikeId == null ? null : Number(row.bikeId),
  stops: parseJson(row.stops, []),
  notes: row.notes ?? "",
  gallery: parseJson(row.gallery, []),
  roundTrip: Number(row.roundTrip) === 1,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});
export function createSqlRepository({ pool, transaction, kind, migrate }) {
  return {
    kind,

    async ping() {
      await pool.query("SELECT 1");
    },

    async close() {
      await pool.end();
    },

    /**
     * Create missing tables and apply pending migrations. Called at boot and
     * by `npm run db:init`; safe to run repeatedly.
     */
    async migrate() {
      return migrate();
    },

    /* ── site content ─────────────────────────────────────────────────── */

    async getContent() {
      const [rows] = await pool.execute(
        "SELECT content, updated_at, updated_by FROM site_content WHERE id = 1",
      );
      if (!rows.length) return null;
      return {
        content: rows[0].content,
        updatedAt: rows[0].updated_at,
        updatedBy: rows[0].updated_by,
      };
    },

    /**
     * Publish `content` and record it as a revision, atomically, then trim the
     * history to REVISION_LIMIT. Returns the new revision list.
     */
    async putContent({ content, description, revisionId, by }) {
      return transaction(async (conn) => {
        await conn.execute(
          `INSERT INTO site_content (id, content, updated_by)
           VALUES (1, ?, ?)
           ON DUPLICATE KEY UPDATE content = VALUES(content), updated_by = VALUES(updated_by)`,
          [content, by ?? null],
        );
        await conn.execute(
          "INSERT INTO revisions (id, description, content, created_by) VALUES (?, ?, ?, ?)",
          [revisionId, description ?? "", content, by ?? null],
        );
        // Keep the newest REVISION_LIMIT. The derived table is required:
        // MySQL/MariaDB refuse a LIMIT directly inside IN (...).
        await conn.execute(
          `DELETE FROM revisions
            WHERE id NOT IN (
              SELECT id FROM (
                SELECT id FROM revisions
                ORDER BY created_at DESC, id DESC
                LIMIT ${REVISION_LIMIT}
              ) AS keep
            )`,
        );
        return this.listRevisionsWith(conn);
      });
    },

    async listRevisions() {
      return this.listRevisionsWith(pool);
    },

    async listRevisionsWith(executor) {
      const [rows] = await executor.execute(
        `SELECT id, description, content, created_at, created_by
           FROM revisions
          ORDER BY created_at DESC, id DESC`,
      );
      return rows.map((r) => ({
        id: r.id,
        description: r.description,
        content: r.content,
        createdAt: r.created_at,
        createdBy: r.created_by,
      }));
    },

    async deleteRevision(id) {
      const [result] = await pool.execute("DELETE FROM revisions WHERE id = ?", [id]);
      return result.affectedRows > 0;
    },

    /* ── users ────────────────────────────────────────────────────────── */

    async countUsers() {
      const [rows] = await pool.execute("SELECT COUNT(*) AS n FROM users");
      return Number(rows[0]?.n ?? 0);
    },

    async findUserByUsername(username) {
      const [rows] = await pool.execute(
        `SELECT id, username, email, password_hash AS passwordHash, role, disabled,
                disabled_at AS disabledAt, created_at AS createdAt,
                last_login_at AS lastLoginAt
           FROM users WHERE username = ? LIMIT 1`,
        [username],
      );
      return rows[0] ?? null;
    },

    async findUserById(id) {
      const [rows] = await pool.execute(
        `SELECT id, username, email, password_hash AS passwordHash, role, disabled,
                disabled_at AS disabledAt, created_at AS createdAt,
                last_login_at AS lastLoginAt
           FROM users WHERE id = ? LIMIT 1`,
        [id],
      );
      return rows[0] ?? null;
    },

    async listUsers() {
      const [rows] = await pool.execute(
        `SELECT id, username, email, role, disabled,
                disabled_at AS disabledAt, created_at AS createdAt,
                last_login_at AS lastLoginAt
           FROM users ORDER BY id ASC`,
      );
      return rows;
    },

    async createUser({ username, email, passwordHash, role }) {
      const [result] = await pool.execute(
        "INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)",
        [username, email ?? null, passwordHash, role],
      );
      return result.insertId;
    },

    async updateUserPassword(id, passwordHash) {
      await pool.execute("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, id]);
    },

    async touchLastLogin(id) {
      await pool.execute("UPDATE users SET last_login_at = NOW() WHERE id = ?", [id]);
    },

    /**
     * Switch an account off (or back on). Disabling also drops every live
     * session, so the person is signed out on their very next request instead
     * of keeping the members-only half of the site until the cookie expires.
     */
    async setUserDisabled(id, disabled) {
      return transaction(async (conn) => {
        await conn.execute(
          "UPDATE users SET disabled = ?, disabled_at = ? WHERE id = ?",
          [disabled ? 1 : 0, disabled ? new Date() : null, id],
        );
        if (disabled) await conn.execute("DELETE FROM sessions WHERE user_id = ?", [id]);
        return true;
      });
    },

    async deleteUser(id) {
      // The garage goes with the account. SQLite cascades through its foreign
      // keys; MySQL does not have them here, so it is done explicitly rather
      // than left to depend on which driver is installed.
      await pool.execute("DELETE FROM member_journeys WHERE user_id = ?", [id]);
      await pool.execute("DELETE FROM member_bikes WHERE user_id = ?", [id]);
      const [result] = await pool.execute("DELETE FROM users WHERE id = ?", [id]);
      return result.affectedRows > 0;
    },

    /* ── sessions ─────────────────────────────────────────────────────── */

    async createSession({ tokenHash, userId, expiresAt, ip, userAgent }) {
      await pool.execute(
        `INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent)
         VALUES (?, ?, ?, ?, ?)`,
        [tokenHash, userId, expiresAt, ip ?? null, userAgent?.slice(0, 255) ?? null],
      );
    },

    async findSession(tokenHash) {
      const [rows] = await pool.execute(
        `SELECT s.token_hash AS tokenHash, s.expires_at AS expiresAt,
                u.id, u.username, u.email, u.role, u.disabled
           FROM sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > NOW()
          LIMIT 1`,
        [tokenHash],
      );
      const row = rows[0];
      if (!row || row.disabled) return null;
      return {
        tokenHash: row.tokenHash,
        expiresAt: row.expiresAt,
        user: { id: row.id, username: row.username, email: row.email, role: row.role },
      };
    },

    async deleteSession(tokenHash) {
      await pool.execute("DELETE FROM sessions WHERE token_hash = ?", [tokenHash]);
    },

    async deleteUserSessions(userId) {
      await pool.execute("DELETE FROM sessions WHERE user_id = ?", [userId]);
    },

    async purgeExpiredSessions() {
      const [result] = await pool.execute("DELETE FROM sessions WHERE expires_at <= NOW()");
      return result.affectedRows;
    },

    /* ── auth history ─────────────────────────────────────────────────── */

    async recordAuthEvent({ userId, username, event, ip, userAgent, detail }) {
      await pool.execute(
        `INSERT INTO auth_events (user_id, username, event, ip, user_agent, detail)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId ?? null, username ?? "", event, ip ?? null, userAgent?.slice(0, 255) ?? null, detail ?? null],
      );
    },

    async listAuthEvents(limit = 100) {
      const safe = authEventLimit(limit);
      const [rows] = await pool.query(
        `SELECT id, user_id AS userId, username, event, ip, user_agent AS userAgent,
                detail, created_at AS createdAt
           FROM auth_events
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
        [safe],
      );
      return rows;
    },

    /* ── media index ──────────────────────────────────────────────────── */

    async listMedia() {
      const [rows] = await pool.execute(
        `SELECT id, filename, original_name AS originalName, mime, size, kind, ext,
                created_at AS createdAt, created_by AS createdBy
           FROM media ORDER BY created_at DESC, id DESC`,
      );
      return rows;
    },

    async insertMedia(row) {
      await pool.execute(
        `INSERT INTO media (id, filename, original_name, mime, size, kind, ext, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.id, row.filename, row.originalName, row.mime, row.size, row.kind, row.ext, row.createdBy ?? null],
      );
      return row;
    },

    async findMedia(id) {
      const [rows] = await pool.execute(
        `SELECT id, filename, original_name AS originalName, mime, size, kind, ext,
                created_at AS createdAt, created_by AS createdBy
           FROM media WHERE id = ? LIMIT 1`,
        [id],
      );
      return rows[0] ?? null;
    },

    async deleteMedia(id) {
      const [result] = await pool.execute("DELETE FROM media WHERE id = ?", [id]);
      return result.affectedRows > 0;
    },

    /* ── whole-database export ────────────────────────────────────────── */

    /**
     * Everything a backup needs, in one call: accounts (with their password
     * hashes, or a restore could not sign anybody in), the published site and
     * its history, the media index, every setting, and the access log.
     *
     * Sessions are deliberately absent — a backup is not a set of live logins.
     */
    async exportAll() {
      const [users] = await pool.query(
        `SELECT id, username, email, password_hash AS passwordHash, role, disabled,
                disabled_at AS disabledAt, created_at AS createdAt,
                last_login_at AS lastLoginAt
           FROM users ORDER BY id ASC`,
      );
      const [settings] = await pool.query(
        "SELECT setting_key AS settingKey, value FROM settings ORDER BY setting_key",
      );
      const [media] = await pool.query(
        `SELECT id, filename, original_name AS originalName, mime, size, kind, ext,
                created_at AS createdAt, created_by AS createdBy
           FROM media ORDER BY id ASC`,
      );
      const [authEvents] = await pool.query(
        `SELECT id, user_id AS userId, username, event, ip, user_agent AS userAgent,
                detail, created_at AS createdAt
           FROM auth_events ORDER BY id ASC`,
      );
      const [revisions] = await pool.query(
        `SELECT id, description, content, created_at AS createdAt, created_by AS createdBy
           FROM revisions ORDER BY created_at ASC, id ASC`,
      );
      // A member's garage is theirs, not the site's — but a backup that quietly
      // dropped it would be a restore that loses people's work, so it travels
      // with everything else and comes back with it.
      const [memberBikes] = await pool.query(
        `SELECT id, user_id AS userId, maker, model, year,
                mileage_kmpl AS mileageKmpl, mileage_source AS mileageSource,
                created_at AS createdAt
           FROM member_bikes ORDER BY id ASC`,
      );
      const [memberJourneys] = await pool.query(
        `SELECT id, user_id AS userId, title, bike_id AS bikeId, stops, notes, gallery,
                round_trip AS roundTrip, created_at AS createdAt, updated_at AS updatedAt
           FROM member_journeys ORDER BY id ASC`,
      );
      return {
        users,
        settings,
        media,
        authEvents,
        revisions,
        memberBikes,
        memberJourneys,
        content: await this.getContent(),
      };
    },

    /* ── member garages ───────────────────────────────────────────────── */

    /**
     * A member's own garage and rides.
     *
     * Every query is scoped by `user_id` in the WHERE clause rather than
     * filtered afterwards, so one member's id in a request can never reach
     * another member's rows — the ownership check is the query, not a
     * comparison that could be forgotten.
     */
    async listBikes(userId) {
      const [rows] = await pool.execute(
        `SELECT id, user_id AS userId, maker, model, year,
                mileage_kmpl AS mileageKmpl, mileage_source AS mileageSource,
                created_at AS createdAt
           FROM member_bikes WHERE user_id = ? ORDER BY id ASC`,
        [userId],
      );
      return rows.map(rowAsBike);
    },

    async createBike(userId, bike) {
      const [result] = await pool.execute(
        `INSERT INTO member_bikes (user_id, maker, model, year, mileage_kmpl, mileage_source)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, bike.maker, bike.model, bike.year ?? null, bike.mileageKmpl ?? null, bike.mileageSource ?? "manual"],
      );
      return result.insertId;
    },

    async updateBike(userId, id, patch) {
      const [result] = await pool.execute(
        `UPDATE member_bikes
            SET maker = ?, model = ?, year = ?, mileage_kmpl = ?, mileage_source = ?
          WHERE id = ? AND user_id = ?`,
        [patch.maker, patch.model, patch.year ?? null, patch.mileageKmpl ?? null, patch.mileageSource ?? "manual", id, userId],
      );
      return Number(result.affectedRows ?? 0) > 0;
    },

    async deleteBike(userId, id) {
      const [result] = await pool.execute(
        "DELETE FROM member_bikes WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      // A journey keeps its distance; it just no longer points at a bike.
      await pool.execute(
        "UPDATE member_journeys SET bike_id = NULL WHERE bike_id = ? AND user_id = ?",
        [id, userId],
      );
      return Number(result.affectedRows ?? 0) > 0;
    },

    async listJourneys(userId) {
      const [rows] = await pool.execute(
        `SELECT id, user_id AS userId, title, bike_id AS bikeId, stops, notes, gallery,
                round_trip AS roundTrip, created_at AS createdAt, updated_at AS updatedAt
           FROM member_journeys WHERE user_id = ? ORDER BY id DESC`,
        [userId],
      );
      return rows.map(rowAsJourney);
    },

    async createJourney(userId, journey) {
      const [result] = await pool.execute(
        `INSERT INTO member_journeys (user_id, title, bike_id, stops, notes, gallery, round_trip)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          journey.title ?? "",
          journey.bikeId ?? null,
          JSON.stringify(journey.stops ?? []),
          journey.notes ?? "",
          JSON.stringify(journey.gallery ?? []),
          journey.roundTrip ? 1 : 0,
        ],
      );
      return result.insertId;
    },

    async updateJourney(userId, id, journey) {
      const [result] = await pool.execute(
        `UPDATE member_journeys
            SET title = ?, bike_id = ?, stops = ?, notes = ?, gallery = ?, round_trip = ?
          WHERE id = ? AND user_id = ?`,
        [
          journey.title ?? "",
          journey.bikeId ?? null,
          JSON.stringify(journey.stops ?? []),
          journey.notes ?? "",
          JSON.stringify(journey.gallery ?? []),
          journey.roundTrip ? 1 : 0,
          id,
          userId,
        ],
      );
      return Number(result.affectedRows ?? 0) > 0;
    },

    async deleteJourney(userId, id) {
      const [result] = await pool.execute(
        "DELETE FROM member_journeys WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      return Number(result.affectedRows ?? 0) > 0;
    },

    /* ── settings ─────────────────────────────────────────────────────── */

    async getSetting(key) {
      const [rows] = await pool.execute(
        "SELECT value FROM settings WHERE setting_key = ? LIMIT 1",
        [key],
      );
      return rows[0]?.value ?? null;
    },

    async setSetting(key, value) {
      await pool.execute(
        `INSERT INTO settings (setting_key, value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [key, value],
      );
    },
  };
}
