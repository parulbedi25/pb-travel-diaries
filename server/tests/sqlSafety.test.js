import test from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { databaseIdentifier, authEventLimit } from "../lib/sqlSafety.js";
import { connectionOptions, validateDatabase } from "../lib/installer.js";
import { createMysqlRepo } from "../db/mysql.js";

test("database identifiers reject injection in setup and CLI/restore helper", () => {
  for (const database of ["db`; DROP TABLE users; --", "db' OR 1=1 --", "db name", "", "x".repeat(65)]) {
    assert.throws(() => databaseIdentifier(database));
    assert.throws(() => validateDatabase({ database, user: "test" }));
  }
  assert.equal(databaseIdentifier("cpuser_travel-$"), "`cpuser_travel-$`");
});

test("auth history limits are finite bounded integers", () => {
  for (const input of ["1; DROP TABLE users", Infinity, NaN, "1 UNION SELECT 1", -100, 1.9, 100000]) {
    const result = authEventLimit(input);
    assert.ok(Number.isInteger(result) && result >= 1 && result <= 500);
  }
  assert.equal(authEventLimit(1.9), 1);
});

test("setup connections explicitly disallow multi-statement SQL", () => {
  assert.equal(connectionOptions({ database: "db" }, { withDatabase: true }).multipleStatements, false);
});

test("MySQL repository binds injection-shaped values rather than concatenating SQL", async () => {
  const calls = [];
  let options;
  const original = mysql.createPool;
  mysql.createPool = config => {
    options = config;
    return {
      execute: async (sql, values) => { calls.push({ sql, values }); return [[], []]; },
      query: async (sql, values) => { calls.push({ sql, values }); return [[], []]; },
    };
  };
  let repo;
  try { repo = await createMysqlRepo(); } finally { mysql.createPool = original; }
  const payload = "' OR 1=1; DROP TABLE users; --";
  await repo.findUserByUsername(payload);
  await repo.findUserById(payload);
  await repo.getSetting(payload);
  await repo.setSetting(payload, payload);
  await repo.deleteRevision(payload);
  await repo.deleteMedia(payload);
  for (const call of calls) {
    assert.ok(!call.sql.includes(payload));
    assert.ok(call.sql.includes("?"));
    assert.ok(call.values.includes(payload));
  }
  assert.equal(options.multipleStatements, false);
  calls.length = 0;
  await repo.listAuthEvents(payload);
  assert.match(calls[0].sql, /LIMIT \?/);
  assert.deepEqual(calls[0].values, [100]);
});
