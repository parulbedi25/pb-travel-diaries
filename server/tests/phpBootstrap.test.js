/**
 * The rule the whole static deployment rests on: PHP creates the database and
 * the first owner, and does nothing else — ever.
 *
 * These are source-level checks, because the alternative is a PHP runtime and a
 * MySQL server in CI. They are narrow on purpose: they assert the *dispatch*
 * (four setup steps, then refusal) and that the refusal points elsewhere rather
 * than answering, and that nothing resembling authentication exists in the file.
 * A refactor that keeps that shape passes; one that re-opens the bridge fails.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../../php/api.php", import.meta.url), "utf8");
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
  .join("\n");

test("PHP contains no authentication at all", () => {
  assert.ok(!/setcookie\s*\(/i.test(code), "api.php must never set a cookie");
  assert.ok(!/\$_SESSION|session_start|session_id/i.test(code), "api.php must never open a session");
  assert.ok(!/password_verify\s*\(/i.test(code), "api.php must never check a password");
  assert.ok(!/INSERT\s+INTO\s+sessions/i.test(code), "api.php must never write a session row");
});

test("the only routes it answers are the four setup steps", () => {
  const handled = [...code.matchAll(/\$route === '([^']+)'/g)].map((match) => match[1]).sort();
  assert.deepEqual(handled, [
    "diag",
    "setup/database",
    "setup/owner",
    "setup/status",
    "setup/test",
  ]);
});

test("a runtime request is sent to the Node API, not answered", () => {
  assert.match(code, /http_response_code\(in_array\(method\(\), \['GET', 'HEAD'\], true\) \? 307 : 308\)/);
  assert.match(code, /header\('Location: ' \. \$target\)/);
  // The loop guard: a request that already arrived under the API's own path
  // must not be redirected back to the file that just received it.
  assert.match(code, /alreadyUnderApi/);
  assert.match(code, /str_starts_with\(\$path, \$apiPath \. '\/'\)/);
});

test("even the refusal names the API and stays machine-readable", () => {
  assert.match(code, /'code' => 'setup-only'/);
  assert.match(code, /'apiUrl' => \$api/);
});
