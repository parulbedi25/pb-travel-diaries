import { config } from "../config.js";
import { createMysqlRepo } from "./mysql.js";
import { createSqliteRepo } from "./sqlite.js";
import { createMemoryRepo } from "./memory.js";

let repoPromise = null;

/**
 * The one repository for the process.
 *
 * `DB_DRIVER=memory` swaps in the in-memory implementation, which is what the
 * tests use. Saved local installations select SQLite; providers use MySQL/MariaDB.
 */
export function getRepo() {
  if (!repoPromise) {
    repoPromise = config.dbDriver === "memory" ? createMemoryRepo() : config.dbDriver === "sqlite" ? createSqliteRepo() : createMysqlRepo();
  }
  return repoPromise;
}

/**
 * Drop the current repository so the next call builds one from the current
 * config. Used after the setup screen adopts a new database.
 */
export async function resetRepo() {
  if (!repoPromise) return;
  let repo = null;
  try {
    // The memory driver is returned synchronously; MySQL returns a promise.
    repo = await repoPromise;
  } catch {
    repo = null;
  }
  repoPromise = null;
  if (repo) {
    try {
      await repo.close();
    } catch {
      /* the old pool is being discarded either way */
    }
  }
}

export async function closeRepo() {
  await resetRepo();
}
