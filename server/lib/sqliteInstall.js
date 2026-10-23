import { createSqliteRepo } from "../db/sqlite.js";
import { SQLITE_VERSION } from "../db/sqliteMigrations.js";
import { applyInstall } from "../config.js";
import { installFilePath, publicInstall, writeInstall } from "./installFile.js";
import { SetupError } from "./installer.js";

let installing = false;
export function sqliteAnswers(siteTitle) {
  return { installed: true, siteTitle, db: { driver: "sqlite", database: "pbfrompb" }, schemaVersion: SQLITE_VERSION, installedAt: new Date().toISOString() };
}
export async function installSqlite(input, { file = installFilePath(), apply = true, open = createSqliteRepo } = {}) {
  if (process.env.DB_DRIVER && process.env.DB_DRIVER !== "sqlite") {
    throw new SetupError("Remove DB_DRIVER from the environment to select Local SQLite, then restart setup.");
  }
  const title = String(input?.siteTitle ?? "").trim();
  if (!title || title.length > 120) throw new SetupError("Give the website a title of 1–120 characters.");
  if (installing) throw new SetupError("Local database setup is already running. Please wait.", 409);
  installing = true;
  let repo;
  try {
    repo = await open();
    await repo.migrate();
    const users = await repo.countUsers();
    if (!users) {
      await repo.setSetting("site_title", JSON.stringify(title));
      await repo.setSetting("allow_signup", "true");
    }
    const answers = sqliteAnswers(title);
    writeInstall(answers, file);
    if (apply) applyInstall(answers);
    return { ok: true, siteTitle: title, createdDatabase: true, db: publicInstall(answers), schemaVersion: SQLITE_VERSION, users, needsOwner: users === 0 };
  } catch (error) {
    throw new SetupError(`Local database setup failed: ${error.message}. Ensure server/data and data are writable and use Node.js 22.13+ or 24+.`, 500);
  } finally {
    try { await repo?.close(); } finally { installing = false; }
  }
}
