/**
 * The rules that keep SQL text and user data apart, checked from both ends:
 * what the source is allowed to build, and what the routes do with hostile
 * input when it reaches them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = new URL("../../", import.meta.url);
const { TABLES, tableIdentifier, tableName, rowId, databaseIdentifier } =
  await import("../lib/sqlSafety.js");

/** Every server source file, so the static guard sees the whole surface. */
function serverFiles(dir = new URL("../", root)) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "tests" || entry.name === "node_modules") continue;
    const full = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) found.push(...serverFiles(full));
    else if (entry.name.endsWith(".js")) found.push(full);
  }
  return found;
}

/**
 * The template literals that are actually handed to the driver.
 *
 * A tiny scanner rather than a regex over the whole file: an error message that
 * mentions `req.path` is not SQL, and flagging it would teach everyone to
 * ignore this test.
 */
function sqlTemplates(source) {
  const found = [];
  const call = /\.(?:query|execute|exec|prepare)\(\s*/g;
  let match;
  while ((match = call.exec(source))) {
    const start = match.index + match[0].length;
    if (source[start] !== "`") continue;
    // Walk to the closing backtick, stepping over ${ … } (which may nest).
    let i = start + 1;
    let depth = 0;
    while (i < source.length) {
      const char = source[i];
      if (char === "\\") {
        i += 2;
        continue;
      }
      if (depth === 0 && char === "`") break;
      if (char === "$" && source[i + 1] === "{") {
        depth += 1;
        i += 2;
        continue;
      }
      if (depth > 0 && char === "}") depth -= 1;
      i += 1;
    }
    found.push(source.slice(start + 1, i));
    call.lastIndex = i;
  }
  return found;
}

test("request data is never interpolated into SQL text", () => {
  // Values are bound with `?`. The only things allowed inside a statement's
  // text are identifiers that came through sqlSafety, and constants the code
  // owns — never something that arrived in a request.
  const offenders = [];
  for (const file of serverFiles()) {
    const source = fs.readFileSync(file, "utf8");
    const name = file.pathname.split("/server/").pop();
    for (const sql of sqlTemplates(source)) {
      for (const interpolation of sql.matchAll(/\$\{([^}]*)\}/g)) {
        const expression = interpolation[1].trim();
        if (/^(tableIdentifier|tableName|databaseIdentifier)\(/.test(expression)) continue;
        if (/\b(req|request|body|params|headers|cookies)\b/.test(expression)) {
          offenders.push(`${name}: \${${expression}}`);
        }
      }
    }
    // The other way in: SQL glued together with `+`.
    const concatenated =
      /(?:execute|query|exec)\(\s*["'`][^"'`]*(?:SELECT|INSERT|UPDATE|DELETE|DROP)[^"'`]*["'`]\s*\+/gi;
    for (const match of source.matchAll(concatenated)) {
      offenders.push(`${name}: string concatenation — ${match[0].slice(0, 60)}`);
    }
  }
  assert.deepEqual(offenders, [], `SQL built from request data:\n${offenders.join("\n")}`);
});

test("the scanner would catch an injected value", () => {
  // Proves the guard above actually inspects SQL, rather than passing quietly.
  const bad = "await pool.execute(`SELECT * FROM users WHERE name = '${req.body.name}'`)";
  const templates = sqlTemplates(bad);
  assert.equal(templates.length, 1);
  assert.deepEqual(
    [...templates[0].matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim()),
    ["req.body.name"],
  );
  const good = "await pool.execute(`SELECT * FROM ${tableIdentifier(t)} WHERE id = ?`, [id])";
  const safe = sqlTemplates(good);
  assert.equal(safe.length, 1);
  assert.match(safe[0], /tableIdentifier\(t\)/);
});

test("table names are allowlisted before they are put into a statement", () => {
  for (const table of TABLES) {
    assert.equal(tableIdentifier(table), `\`${table}\``);
    assert.equal(tableName(table), table);
  }

  // Anything a request could supply, or a name that merely looks like a table.
  const hostile = [
    "users; DROP TABLE users",
    "users`",
    "`users`",
    "users ",
    "sqlite_master",
    "information_schema.tables",
    "../users",
    "",
    null,
    undefined,
    { toString: () => "users; DROP TABLE users" },
    ["users", "sessions"],
  ];
  for (const value of hostile) {
    assert.throws(() => tableIdentifier(value), /unknown table/i, String(value));
    assert.throws(() => tableName(value), /unknown table/i, String(value));
  }

  // Matching is exact: a name that is in the list but not in that case is still
  // not a table the app reads, so a quoted variant cannot slip through.
  assert.throws(() => tableIdentifier("USERS"), /unknown table/i);
  // A value that resolves to a real table through toString is that table, and
  // is treated as such — the check is on what reaches the statement.
  assert.equal(tableIdentifier({ toString: () => "users" }), "`users`");
});

test("restore and import put only checked table names into their statements", () => {
  // The two places the app has to name a table in SQL text.
  const checks = [
    "server/lib/backup.js",
    "server/db/sqlite.js",
  ];
  for (const relative of checks) {
    const source = fs.readFileSync(new URL(relative, root), "utf8");
    assert.ok(
      !/(DELETE FROM|INSERT INTO|ALTER TABLE|FROM) \$\{table\}/.test(source),
      `${relative} interpolates a raw table name`,
    );
    assert.match(source, /table(?:Identifier|Name)\(/, `${relative} must check its table names`);
  }
});

test("ids taken from a URL are integers or nothing", () => {
  assert.equal(rowId("12"), 12);
  assert.equal(rowId(12), 12);
  for (const value of ["12 OR 1=1", "1; DROP TABLE users", "-1", "0", "1.5", "abc", "", null, undefined, {}, "9e9999"]) {
    assert.equal(rowId(value), null, String(value));
  }
});

test("the database name is still the only other identifier allowed in SQL", () => {
  assert.equal(databaseIdentifier("cpuser_pb"), "`cpuser_pb`");
  for (const value of ["pb`; DROP TABLE users; --", "pb name", "", null]) {
    assert.throws(() => databaseIdentifier(value));
  }
});
