/**
 * What reaches the log must not be a secret or somebody's personal data.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { redactText, redactForLog } from "../lib/logRedaction.js";

const neverAppears = (text, secrets) => {
  for (const secret of secrets) {
    assert.ok(!text.includes(secret), `"${secret}" survived in: ${text}`);
  }
};

test("passwords, tokens and keys are replaced wherever they appear", () => {
  const text = redactText(
    [
      'password: "Hunter2!"',
      "password=letmein",
      "{\"token\":\"abc123def\"}",
      "api_key: sk_live_9988",
      "Cookie: pb_session=xyz",
      "authorization: Bearer eyJhbGciOi",
    ].join(" | "),
  );
  neverAppears(text, ["Hunter2!", "letmein", "abc123def", "sk_live_9988", "pb_session=xyz", "eyJhbGciOi"]);
  assert.match(text, /redacted/);
});

test("a password inside a connection string or a driver message is removed", () => {
  const connection = redactText("mysql://cpuser:S3cretPass@localhost:3306/pb");
  neverAppears(connection, ["S3cretPass"]);
  assert.match(connection, /mysql:\/\/cpuser:\[redacted\]@localhost/);

  const driver = redactText("ER_ACCESS_DENIED_ERROR: Access denied for user 'cpuser'");
  assert.match(driver, /Access denied/);
});

test("a bcrypt hash is treated as a password, even unlabelled", () => {
  const hash = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
  const text = redactText(`row could not be written: ${hash}`);
  neverAppears(text, [hash]);
  assert.match(text, /redacted-hash/);
});

test("personal data — emails and IP addresses — is redacted too", () => {
  const text = redactText(
    "Duplicate entry 'parul.bedi@example.com' for key users_email; from 203.0.113.7 and 2001:db8:85a3:0:0:8a2e:370:7334",
  );
  neverAppears(text, ["parul.bedi@example.com", "203.0.113.7", "2001:db8:85a3"]);
});

test("the rest of the message survives, so the log is still useful", () => {
  const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3306 (password=secret)"), {
    code: "ECONNREFUSED",
  });
  const safe = redactForLog(error);
  assert.equal(safe.code, "ECONNREFUSED");
  assert.match(safe.message, /ECONNREFUSED/);
  neverAppears(safe.message, ["secret"]);
  assert.ok(safe.stack, "a stack is kept, redacted");

  const sqlMessage = redactForLog(
    Object.assign(new Error("x"), { sqlMessage: "Duplicate entry 'a@b.com' for key 'users_email'" }),
  );
  neverAppears(sqlMessage.sqlMessage, ["a@b.com"]);
});

test("plain values and odd objects never throw on the way to the log", () => {
  assert.equal(redactForLog("just a string"), "just a string");
  assert.match(redactForLog({ email: "x@y.z", ok: true }), /redacted/);
  const circular = {};
  circular.self = circular;
  assert.equal(typeof redactForLog(circular), "string");
  assert.equal(redactText(undefined), undefined);
});
