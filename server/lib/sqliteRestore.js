import { createSqliteRepo } from "../db/sqlite.js";
import { config, applyInstall } from "../config.js";
import { installFilePath, writeInstall, publicInstall } from "./installFile.js";
import { sqliteAnswers } from "./sqliteInstall.js";
import { extractTo } from "./zip.js";
import { SetupError } from "./installer.js";

/** JSON export is portable; no raw SQLite/WAL file from an archive is trusted. */
export async function restoreSqlite({ payload, zipPath, replace, open = createSqliteRepo }) {
  if (process.env.DB_DRIVER && process.env.DB_DRIVER !== "sqlite") {
    throw new SetupError("Remove DB_DRIVER from the environment before restoring to Local SQLite.");
  }
  let repo;
  try {
    repo = await open();
    await repo.migrate();
    if (!replace && ((await repo.countUsers()) > 0 || await repo.getContent())) {
      throw new SetupError("The local database already has data. Select replace to restore over it.", 409);
    }
    const counts = await repo.importAll(payload.data ?? {});
    const extracted = await extractTo(zipPath, config.mediaDir, { prefix: "media/" });
    const answers = { ...sqliteAnswers(payload.siteTitle || config.siteTitle), restoredFrom: payload.createdAt ?? null };
    writeInstall(answers, installFilePath());
    applyInstall(answers);
    return { ok: true, siteTitle: answers.siteTitle, db: publicInstall(answers), ...counts, mediaFiles: extracted.files, restoredFrom: payload.createdAt ?? null };
  } catch (error) {
    if (error instanceof SetupError) throw error;
    throw new SetupError(`Local restore failed: ${error.message}`, 400);
  } finally { await repo?.close(); }
}
