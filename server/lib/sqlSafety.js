/**
 * The rules that keep SQL text separate from data.
 *
 * Everything that talks to the database binds its values (`?`), so user input
 * never becomes part of a statement. Two things *cannot* be bound — a database
 * name and a table name — because the driver only substitutes values, not
 * identifiers. Both therefore go through a check here, against the strictest
 * shape they can take.
 */

/**
 * Every table the application owns.
 *
 * Nothing outside this list may appear in a statement built by name. Restore
 * and import loop over tables, so this is what turns "a list of constants" into
 * "a list of constants that is verified before it reaches the driver".
 */
export const TABLES = Object.freeze([
  "users",
  "sessions",
  "settings",
  "site_content",
  "revisions",
  "media",
  "auth_events",
  "member_bikes",
  "member_journeys",
  "schema_migrations",
  "pb_schema_migrations",
]);

/**
 * A table name, quoted for MySQL, or threw.
 *
 * Use this anywhere a table name has to be interpolated — it can only ever
 * return one of the names above, so a bug that pipes a request value into that
 * position fails loudly instead of running.
 */
export function tableIdentifier(value) {
  const name = String(value ?? "");
  if (!TABLES.includes(name)) {
    throw new Error(`Refusing to build SQL for an unknown table: ${JSON.stringify(name).slice(0, 40)}`);
  }
  return `\`${name}\``;
}

/** The same check without the quoting, for SQLite (which takes plain names). */
export function tableName(value) {
  return tableIdentifier(value).slice(1, -1);
}

/** Database names cannot be bound as values. Keep setup/CLI identifiers strict. */
export function databaseIdentifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_$-]{1,64}$/.test(value)) {
    throw new Error("Invalid database name: use 1–64 letters, numbers, underscore, dash or $.");
  }
  return `\`${value}\``;
}

/** An integer LIMIT, never SQL text, NaN, Infinity or a fractional value. */
export function authEventLimit(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(500, Math.trunc(number) || 100)) : 100;
}

/** A positive integer id, or null — ids arrive from URLs. */
export function rowId(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return number;
}
