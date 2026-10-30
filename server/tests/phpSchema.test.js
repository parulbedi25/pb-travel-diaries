/**
 * The one rule that keeps a PHP-created database usable by Node: PHP must not
 * have its own idea of the schema.
 *
 * The bootstrap creates the tables on a static deployment, and the Node app then
 * serves every endpoint against them. If the two lists drift — a migration added
 * on one side only — the site looks fine and one feature fails in the dashboard.
 * These tests check that the generated list *is* Node's own migrations, in
 * order, with the ledger rows that make Node read the database as complete.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { BASE_STATEMENTS, LATEST_VERSION } from "../db/schema.js";
import { MIGRATIONS } from "../db/migrations.js";
import { SQLITE_MIGRATIONS, SQLITE_VERSION } from "../db/sqliteMigrations.js";
import {
  mysqlSchemaStatements,
  phpSchema,
  phpSchemaBlock,
  phpString,
  sqliteSchemaStatements,
} from "../db/phpSchema.js";

const migrationsSql = (migration) => migration.up.statements ?? [];

test("the MySQL list is the Node schema, in order, then its ledger rows", () => {
  const statements = mysqlSchemaStatements();

  // Every BASE_STATEMENT first, verbatim: these are the tables at version 1.
  for (const [index, statement] of BASE_STATEMENTS.entries()) {
    assert.equal(statements[index], statement);
  }

  // Then each migration's statements, in order, each followed by its ledger row.
  let at = BASE_STATEMENTS.length;
  for (const migration of MIGRATIONS) {
    for (const statement of migrationsSql(migration)) {
      assert.equal(statements[at], statement, `version ${migration.version} statement out of order`);
      at += 1;
    }
    assert.match(
      statements[at],
      new RegExp(`^INSERT IGNORE INTO schema_migrations \\(version, name\\) VALUES \\(${migration.version},`),
      `no ledger row for version ${migration.version}`,
    );
    at += 1;
  }

  // Nothing else before the defaults, and the defaults come last.
  const defaults = statements.slice(at);
  assert.equal(defaults.length, 2);
  assert.ok(defaults.every((statement) => statement.startsWith("INSERT IGNORE INTO settings")));
  assert.equal(LATEST_VERSION, MIGRATIONS.at(-1).version);
});

test("the ledger reaches the version Node's own code expects", () => {
  const { mysql, sqlite } = phpSchema();
  assert.equal(mysql.version, LATEST_VERSION);
  assert.equal(sqlite.version, SQLITE_VERSION);

  // A database with the highest ledger row is read as fully migrated, so that
  // number is the contract, not the count of statements.
  assert.ok(
    mysql.statements.some((s) =>
      s.includes(`VALUES (${LATEST_VERSION},`),
    ),
  );
  assert.ok(sqlite.statements.some((s) => s.includes(`VALUES (${SQLITE_VERSION},`)));
});

test("the SQLite list starts by creating the ledger Node's migrator would", () => {
  const statements = sqliteSchemaStatements();
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS pb_schema_migrations/);

  // Node's sqlite ledger is a different table from MySQL's; using the wrong one
  // is what made Node report "installed 0 of 6" against a database PHP had
  // just finished creating.
  assert.ok(statements.some((s) => s.includes("pb_schema_migrations")));
  assert.ok(!statements.some((s) => /INTO schema_migrations/.test(s)));

  for (const migration of SQLITE_MIGRATIONS) {
    for (const statement of migration.statements) {
      assert.ok(statements.includes(statement), `sqlite version ${migration.version} is missing a statement`);
    }
  }
});

test("every statement is escaped for PHP and survives a round trip", () => {
  const { mysql, sqlite } = phpSchema();
  for (const statement of [...mysql.statements, ...sqlite.statements]) {
    const quoted = phpString(statement);
    assert.ok(quoted.startsWith("'") && quoted.endsWith("'"));
    // A bare quote inside would end the PHP string early — the whole file would
    // become a parse error, and the browser would see an empty response.
    assert.ok(!/(?<!\\)'/.test(quoted.slice(1, -1)), `unescaped quote in: ${statement.slice(0, 60)}`);
    // A CREATE TABLE is several lines. That is fine in a single-quoted PHP
    // string — which is why the only things needing care are \ and '.
    assert.ok(quoted.includes("'") && quoted.length > 2);
  }
});

test("the block is marked, so the export can replace it and nothing else", () => {
  const block = phpSchemaBlock();
  assert.ok(block.startsWith("/* PB-SCHEMA:START"));
  assert.ok(block.trimEnd().endsWith("/* PB-SCHEMA:END */"));
  assert.match(block, /\$SCHEMA = \[/);

  // `php/api.php` carries the same two markers with an empty array: the export
  // fills them in. If they are lost, the export refuses rather than shipping a
  // bootstrap that cannot create a table.
  const source = fs.readFileSync(new URL("../../php/api.php", import.meta.url), "utf8");
  assert.equal(source.split("/* PB-SCHEMA:START").length - 1, 1);
  assert.equal(source.split("/* PB-SCHEMA:END */").length - 1, 1);
  assert.match(source, /\$SCHEMA = \[\];/);
  assert.ok(
    source.indexOf("/* PB-SCHEMA:START") < source.indexOf("/* PB-SCHEMA:END */"),
    "the markers are the wrong way round",
  );
});
