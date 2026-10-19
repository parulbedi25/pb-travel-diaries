import { config } from "../config.js";
import { createMysqlRepo } from "./mysql.js";
import { createMemoryRepo } from "./memory.js";

let repoPromise = null;

/**
 * The one repository for the process.
 *
 * `DB_DRIVER=memory` swaps in the in-memory implementation, which is what the
 * tests use; everything else talks to MariaDB.
 */
export function getRepo() {
  if (!repoPromise) {
    repoPromise = config.dbDriver === "memory" ? createMemoryRepo() : createMysqlRepo();
  }
  return repoPromise;
}

export async function closeRepo() {
  if (!repoPromise) return;
  const repo = await repoPromise;
  await repo.close();
  repoPromise = null;
}
