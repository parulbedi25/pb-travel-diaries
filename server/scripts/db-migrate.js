/**
 * Applies every pending migration and prints what it did.
 *
 *   npm run db:migrate              apply what is waiting
 *   npm run db:migrate -- --dry-run  say what would happen, change nothing
 *   npm run db:migrate -- --check    exit 1 if anything is waiting (deploy gate)
 *
 * The server does the same thing at boot, so this is for a deploy script, a
 * maintenance window, or simply for looking at the result before restarting.
 * Running it twice is safe: applied versions live in `schema_migrations` and are
 * skipped, and a step that was interrupted halfway resumes where it stopped.
 *
 * Nothing in here needs the site to stop. Every migration is additive against
 * code that is already running (DEPLOYMENT.md § 9), so this can be run on a live
 * database while it serves.
 */
import mysql from "mysql2/promise";
import { config } from "../config.js";
import { connectionOptions } from "../lib/installer.js";
import { applySchema, planMigrations } from "../db/schema.js";

const flags = new Set(process.argv.slice(2));
const dryRun = flags.has("--dry-run") || flags.has("--plan");
const check = flags.has("--check");

/** One line per waiting migration: what it is, and how big it is. */
function printPlan(plan, indent = "  ") {
  for (const migration of plan.pending) {
    const size = migration.statements ? ` (${migration.statements} statement${migration.statements === 1 ? "" : "s"})` : "";
    console.log(`${indent}v${migration.version}  ${migration.name}${size}`);
  }
}

/** What `--dry-run` and `--check` report, for either driver. */
function report(plan) {
  console.log(`[db:migrate] installed v${plan.installed}, latest v${plan.latest}`);
  if (plan.pending.length === 0) {
    console.log("[db:migrate] nothing to do — the database is up to date.");
    return 0;
  }
  console.log(`[db:migrate] ${plan.pending.length} migration(s) waiting:`);
  printPlan(plan);
  if (check) {
    console.log("[db:migrate] --check: the database is behind the code.");
    return 1;
  }
  return 0;
}

async function main() {
  if (config.dbDriver === "sqlite") {
    const { getRepo, closeRepo } = await import("../db/index.js");
    const { SQLITE_FILE } = await import("../db/sqlite.js");
    const { sqliteMigrationStatus } = await import("../db/sqliteMigrations.js");
    const { DatabaseSync } = await import("node:sqlite");

    if (dryRun || check) {
      const fs = await import("node:fs");
      if (!fs.existsSync(SQLITE_FILE)) {
        console.log("[db:migrate] no SQLite database yet — the setup screen creates it.");
        return check ? 1 : 0;
      }
      // Read-only: open the file without writing to it.
      const db = new DatabaseSync(SQLITE_FILE, { readOnly: true });
      try {
        return report(sqliteMigrationStatus(db));
      } finally {
        db.close();
      }
    }

    try {
      const result = await (await getRepo()).migrate();
      if (result.applied.length === 0) {
        console.log(`[db:migrate] SQLite already at v${result.version} — nothing to apply.`);
        return 0;
      }
      console.log(
        `[db:migrate] SQLite applied ${result.applied.map((v) => `v${v}`).join(", ")} ` +
          `— now at v${result.version} (was v${result.upgradedFrom}).`,
      );
      return 0;
    } finally {
      await closeRepo();
    }
  }

  if (config.dbDriver === "memory") {
    console.log("[db:migrate] the in-memory driver starts empty on every boot — nothing to do.");
    return check ? 0 : 0;
  }
  if (!config.hasDatabase) {
    console.log("[db:migrate] no database configured yet — open the setup screen first.");
    return 0;
  }

  const connection = await mysql.createConnection(connectionOptions(config.db, { withDatabase: true }));
  try {
    if (dryRun || check) {
      return report(await planMigrations(connection));
    }
    const result = await applySchema(connection);
    if (result.applied.length === 0) {
      console.log(`[db:migrate] already at v${result.version} — nothing to apply.`);
      return 0;
    }
    console.log(
      `[db:migrate] applied ${result.applied.map((v) => `v${v}`).join(", ")} ` +
        `— now at v${result.version} (was v${result.upgradedFrom}).`,
    );
    return 0;
  } finally {
    await connection.end();
  }
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((error) => {
    console.error("[db:migrate] failed:", error.message);
    if (error.code === "ER_ACCESS_DENIED_ERROR") {
      console.error("Check DB_USER / DB_PASSWORD in .env (or the environment variables).");
    }
    if (error.code === "ER_BAD_DB_ERROR") {
      console.error("That database does not exist. Create it in your hosting panel first.");
    }
    if (error.code === "SCHEMA_LOCK_TIMEOUT") {
      console.error("Another process is upgrading this database. Wait a minute and run it again.");
    }
    process.exit(1);
  });
