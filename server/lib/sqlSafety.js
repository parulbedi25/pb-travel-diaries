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
