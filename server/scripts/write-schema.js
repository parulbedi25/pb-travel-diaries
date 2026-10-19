/**
 * Regenerates server/schema.sql from server/db/schema.js.
 *
 *   npm run schema:sql
 *
 * schema.sql is for people who want to import the tables through phpMyAdmin.
 * The app itself never reads it — the installer and the boot-time upgrader run
 * the statements straight from schema.js, so the two cannot drift apart.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_STATEMENTS, LATEST_VERSION, MIGRATIONS } from "../db/schema.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = path.join(root, "server", "schema.sql");

const header = `-- ─────────────────────────────────────────────────────────────────────────────
-- PB Travel Diaries — MariaDB / MySQL schema
--
-- GENERATED FILE — edit server/db/schema.js and run \`npm run schema:sql\`.
--
-- You do not have to import this: the first-run setup screen creates every
-- table, and the server applies pending migrations at boot. It is kept for
-- people who prefer phpMyAdmin or Adminer (open the database, then Import)
-- Import).
--
-- Written for MariaDB 10.3+ and MySQL 5.7/8.0: no JSON column type, no CHECK
-- constraints and no RETURNING. JSON is kept in LONGTEXT and parsed in the
-- application. Schema version: ${LATEST_VERSION}.
-- ─────────────────────────────────────────────────────────────────────────────
`;

const statements = [
  ...BASE_STATEMENTS,
  ...MIGRATIONS.flatMap((migration) => migration.statements),
  `INSERT IGNORE INTO settings (setting_key, value) VALUES ('schema_version', '${LATEST_VERSION}')`,
  `INSERT IGNORE INTO settings (setting_key, value) VALUES ('theme', '"dark"')`,
];

const body = statements
  .map((statement) => statement.trim().replace(/;?$/, ";"))
  .join("\n\n");

fs.writeFileSync(target, `${header}\n${body}\n`, "utf8");
console.log(`[schema:sql] wrote ${path.relative(root, target)} (version ${LATEST_VERSION})`);
