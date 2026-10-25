/**
 * Telling "this step is already in place" apart from "this step failed".
 *
 * The migration ledger is what normally guarantees a version runs once. But a
 * migration can still be interrupted halfway: MySQL commits each DDL statement
 * on its own, so a version that adds a column and then fails on an index leaves
 * the column behind, with no ledger row to say so. The next attempt replays the
 * migration from its first statement, and that first statement now fails with
 * "duplicate column" — which is not a problem, it is the work already being
 * done.
 *
 * So the runner treats *these* errors as "done, carry on", and nothing else.
 * The list is deliberately short: a duplicate object is knowledge about the
 * schema; a permission error, a lock timeout or a syntax error is not, and must
 * still stop the upgrade and say so.
 *
 * The same question has a second form, used by the request layer rather than the
 * migrator: a table or column that the running code expects but the database
 * does not have yet — a deploy that arrived before its migration. That is not a
 * server fault (the old site is still working); it is a 503 with a plain
 * sentence, so a member sees "still being upgraded" rather than "something went
 * wrong".
 */

/** MySQL/MariaDB: the object this statement creates is already there. */
const ALREADY_APPLIED_CODES = new Set([
  "ER_DUP_FIELDNAME", // ADD COLUMN — the column exists
  "ER_DUP_KEYNAME", // CREATE INDEX / ADD KEY — the index exists
  "ER_MULTIPLE_PRI_KEY", // ADD PRIMARY KEY — it is already the key
  "ER_TABLE_EXISTS_ERROR", // CREATE TABLE — the table exists
  "ER_DUP_ENTRY", // the ledger row is already written
  "ER_FK_DUP_NAME", // ADD CONSTRAINT — same constraint name
]);

/**
 * SQLite reports the same situations as plain text. Only these exact phrases
 * count; "no such table" is a genuine gap and never lands here.
 */
const ALREADY_APPLIED_MESSAGES = [
  /duplicate column name/i,
  /already exists/i,
  /duplicate key name/i,
  /UNIQUE constraint failed: pb_schema_migrations/i,
];

/** MySQL/MariaDB: the schema the code expects has not been built yet. */
const MISSING_SCHEMA_CODES = new Set([
  "ER_NO_SUCH_TABLE",
  "ER_BAD_FIELD_ERROR",
  "ER_UNKNOWN_TABLE",
]);

/** SQLite's way of saying the same thing. */
const MISSING_SCHEMA_MESSAGES = [/no such table/i, /no such column/i];

const text = (error) => ({
  code: String(error?.code ?? ""),
  message: String(error?.message ?? ""),
});

/** True when a migration step failed only because it had already been done. */
export function isAlreadyApplied(error) {
  const { code, message } = text(error);
  if (ALREADY_APPLIED_CODES.has(code)) return true;
  return ALREADY_APPLIED_MESSAGES.some((pattern) => pattern.test(message));
}

/**
 * True when a request touched a table or column that does not exist yet.
 *
 * Used to answer 503 "still being upgraded" instead of 500 "something went
 * wrong" while a live database is catching up with the code.
 */
export function isMissingSchema(error) {
  const { code, message } = text(error);
  if (MISSING_SCHEMA_CODES.has(code)) return true;
  return MISSING_SCHEMA_MESSAGES.some((pattern) => pattern.test(message));
}
