/**
 * Regenerates server/schema.sql from the schema and the migration list.
 *
 *   npm run schema:sql
 *
 * schema.sql is for people who want to import the tables through phpMyAdmin.
 * The app itself never reads it — the installer and the boot-time upgrader run
 * the statements straight from schema.js and migrations.js, so the two cannot
 * drift apart. A migration written as a function rather than a list of
 * statements (a data backfill, say) cannot be expressed here; the file says so
 * instead of silently leaving it out.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_STATEMENTS, LATEST_VERSION } from "../db/schema.js";
import { MIGRATIONS } from "../db/migrations.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = path.join(root, "server", "schema.sql");

const header = `-- ─────────────────────────────────────────────────────────────────────────────
-- PB Travel Diaries — MariaDB / MySQL schema
--
-- GENERATED FILE — edit server/db/schema.js and server/db/migrations.js, then
-- run \`npm run schema:sql\`.
--
-- You do not have to import this: the first-run setup screen creates every
-- table, and the server applies pending migrations at boot. It is kept for
-- people who prefer phpMyAdmin or Adminer (open the database, then Import).
--
-- Written for MariaDB 10.3+ and MySQL 5.7/8.0: no JSON column type, no CHECK
-- constraints and no RETURNING. JSON is kept in LONGTEXT and parsed in the
-- application. Schema version: ${LATEST_VERSION}.
-- ─────────────────────────────────────────────────────────────────────────────
`;

const statements = [...BASE_STATEMENTS];
for (const migration of MIGRATIONS) {
  for (const statement of migration.up.statements ?? []) statements.push(statement);
  statements.push(
    `INSERT IGNORE INTO schema_migrations (version, name) VALUES (${migration.version}, '${migration.name.replace(/'/g, "''")}')`,
  );
}
statements.push(
  `INSERT IGNORE INTO settings (setting_key, value) VALUES ('schema_version', '${LATEST_VERSION}')`,
  `INSERT IGNORE INTO settings (setting_key, value) VALUES ('theme', '"dark"')`,
);

const body = statements
  .map((statement) => statement.trim().replace(/;?$/, ";"))
  .join("\n\n");

fs.writeFileSync(target, `${header}\n${body}\n`, "utf8");
console.log(`[schema:sql] wrote ${path.relative(root, target)} (version ${LATEST_VERSION})`);
