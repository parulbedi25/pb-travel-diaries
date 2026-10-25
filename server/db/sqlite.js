import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { createSqlRepository } from "./sqlRepository.js";
import { migrateSqlite, sqliteMigrationStatus } from "./sqliteMigrations.js";

/** Fixed by server code, never derived from a request or uploaded backup path. */
export const SQLITE_FILE = path.resolve(import.meta.dirname, "../data/pbfrompb.sqlite");
export async function createSqliteRepo(file = path.join(config.root, "server/data/pbfrompb.sqlite")) {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import("node:sqlite")); }
  catch { throw new Error("Local SQLite requires Node.js 22.13+ or 24+. Select a supported Node version in your hosting panel."); }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);
  const db = new DatabaseSync(file);
  try {
    fs.chmodSync(file, 0o600);
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL;");
    db.function("NOW", () => new Date().toISOString());
  } catch (error) {
    db.close();
    throw error;
  }
  const normalize = value => value instanceof Date ? value.toISOString() : typeof value === "boolean" ? Number(value) : value ?? null;
  // Only application-owned query templates pass through here, never user SQL.
  function dialect(sql) {
    if (!sql.includes("ON DUPLICATE KEY UPDATE")) return sql;
    return sql.replace("ON DUPLICATE KEY UPDATE", "ON CONFLICT DO UPDATE SET")
      .replace(/VALUES\((\w+)\)/g, "excluded.$1") + ", updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  }
  const pool = {
    execute(sql, values = []) {
      const stmt = db.prepare(dialect(sql));
      const args = values.map(normalize);
      if (/^\s*SELECT\b/i.test(sql)) return [stmt.all(...args)];
      let result;
      try { result = stmt.run(...args); }
      catch (error) {
        if ([1555, 2067].includes(error.errcode)) error.code = "ER_DUP_ENTRY";
        throw error;
      }
      return [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) }];
    },
    query(sql, values) { return this.execute(sql, values); },
    end() { db.close(); },
  };
  async function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try { const result = await fn(pool); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  const repo = createSqlRepository({
    pool,
    transaction,
    kind: "sqlite",
    migrate: () => migrateSqlite(db),
    schemaStatus: () => sqliteMigrationStatus(db),
  });
  const exportAll = repo.exportAll;
  repo.exportAll = () => transaction(() => exportAll.call(repo));
  repo.importAll = data => transaction(async () => {
    for (const table of ["sessions", "member_journeys", "member_bikes", "auth_events", "media", "revisions", "site_content", "users", "settings"]) db.exec(`DELETE FROM ${table}`);
    const now = new Date().toISOString();
    const date = v => v ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : v.replace(" ", "T") + "Z").toISOString() : null;
    function insert(table, columns, rows) {
      const stmt = db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
      for (const row of rows) stmt.run(...row.map(normalize));
    }
    insert("users", ["id","username","email","password_hash","role","disabled","disabled_at","created_at","last_login_at"], (data.users ?? []).map(r => [r.id,r.username,r.email,r.passwordHash,r.role ?? "reader",r.disabled ? 1 : 0,date(r.disabledAt),date(r.createdAt) ?? now,date(r.lastLoginAt)]));
    insert("member_bikes",["id","user_id","maker","model","year","mileage_kmpl","mileage_source","created_at"],(data.memberBikes ?? []).map(r=>[r.id,r.userId,r.maker,r.model,r.year ?? null,r.mileageKmpl ?? null,r.mileageSource ?? "manual",date(r.createdAt) ?? now]));
    insert("member_journeys",["id","user_id","title","bike_id","stops","notes","gallery","round_trip","created_at","updated_at"],(data.memberJourneys ?? []).map(r=>[r.id,r.userId,r.title ?? "",r.bikeId ?? null,typeof r.stops === "string" ? r.stops : JSON.stringify(r.stops ?? []),r.notes ?? "",typeof r.gallery === "string" ? r.gallery : JSON.stringify(r.gallery ?? []),r.roundTrip ? 1 : 0,date(r.createdAt) ?? now,date(r.updatedAt) ?? now]));
    if (data.content) insert("site_content",["id","content","updated_at","updated_by"],[[1,data.content.content,date(data.content.updatedAt) ?? now,data.content.updatedBy]]);
    insert("revisions",["id","description","content","created_at","created_by"],(data.revisions ?? []).map(r => [r.id,r.description ?? "",r.content,date(r.createdAt) ?? now,r.createdBy]));
    insert("media",["id","filename","original_name","mime","size","kind","ext","created_at","created_by"],(data.media ?? []).map(r=>[r.id,r.filename,r.originalName,r.mime,r.size,r.kind,r.ext,date(r.createdAt) ?? now,r.createdBy]));
    insert("auth_events",["id","user_id","username","event","ip","user_agent","detail","created_at"],(data.authEvents ?? []).map(r=>[r.id,r.userId,r.username ?? "",r.event,r.ip,r.userAgent,r.detail,date(r.createdAt) ?? now]));
    insert("settings",["setting_key","value"],(data.settings ?? []).map(r=>[r.settingKey,r.value]));
    return Object.fromEntries(["users","revisions","media","authEvents","settings"].map(k=>[k,(data[k] ?? []).length]));
  });
  // Serialize whole operations, not individual statements, so async requests
  // cannot interleave transactions on a shared synchronous SQLite connection.
  let pending = Promise.resolve();
  return new Proxy(repo, {
    get(target, key) {
      const fn = target[key];
      if (typeof fn !== "function") return fn;
      return (...args) => {
        const result = pending.then(() => fn.apply(target, args));
        pending = result.catch(() => {});
        return result;
      };
    },
  });
}
