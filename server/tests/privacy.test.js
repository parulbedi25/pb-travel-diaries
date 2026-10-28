/**
 * Personal information: where it is allowed to go, and what happens to it when
 * a hostile value arrives instead.
 *
 * These drive the real app, so they cover the routes rather than the repository
 * beneath them: an injection attempt through an id, a tag or a query string has
 * to come back as an ordinary "not found" or "bad request", with the database
 * still standing.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-privacy-media-"));
const distDir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-privacy-dist-"));
await fs.writeFile(path.join(distDir, "index.html"), "<!doctype html><title>Site</title><div id=root></div>");
process.env.DB_DRIVER = "memory";
process.env.MEDIA_DIR = mediaDir;
process.env.DIST_DIR = distDir;
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_PER_MINUTE = "0";
process.env.BCRYPT_ROUNDS = "4";

const { createApp } = await import("../app.js");
const app = createApp();

let server;
let base;
let cookies = {};

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(mediaDir, { recursive: true, force: true });
  await fs.rm(distDir, { recursive: true, force: true });
});

async function call(method, url, body, { form, as } = {}) {
  const jar = as ?? cookies;
  const headers = {};
  if (jar.session) headers.Cookie = `pb_session=${jar.session}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(base + url, { method, headers, body: payload });
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const match = /pb_session=([^;]*)/.exec(line);
    if (match) {
      if (match[1]) jar.session = match[1];
      else delete jar.session;
    }
  }
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

/** An owner, an admin, and a reader — the three roles the app knows. */
const ownerJar = {};
const adminJar = {};
const readerJar = {};
const PASS = "ride2026";

test("accounts and the sign-in log belong to the owner alone", async () => {
  const owner = await call("POST", "/api/auth/signup", {
    username: "parul",
    password: PASS,
  }, { as: ownerJar });
  assert.equal(owner.status, 201);

  // An admin and a reader are made by the owner from the accounts panel. Even
  // when the request asks for another owner, the account comes back an admin:
  // there is only ever one owner, so the role cannot be escalated by asking.
  const madeAdmin = await call("POST", "/api/auth/users", {
    username: "admin2", password: PASS, role: "owner",
  }, { as: ownerJar });
  assert.equal(madeAdmin.status, 201);
  assert.equal(madeAdmin.json.user.role, "admin", "a second owner cannot be created");

  assert.equal((await call("POST", "/api/auth/users", {
    username: "reader2", password: PASS, role: "reader",
  }, { as: ownerJar })).status, 201, "and a reader");

  assert.equal((await call("POST", "/api/auth/login", { username: "admin2", password: PASS }, { as: adminJar })).status, 200);
  assert.equal((await call("POST", "/api/auth/login", { username: "reader2", password: PASS }, { as: readerJar })).status, 200);

  // The account list holds every email address, so it is the owner's.
  assert.equal((await call("GET", "/api/auth/users", undefined, { as: ownerJar })).status, 200);
  const adminUsers = await call("GET", "/api/auth/users", undefined, { as: adminJar });
  assert.equal(adminUsers.status, 403, "an admin cannot list accounts");
  assert.equal((await call("GET", "/api/auth/users", undefined, { as: readerJar })).status, 403);
  assert.equal((await call("GET", "/api/auth/users")).status, 401);

  // Creating, editing and deleting accounts: owner only.
  assert.equal((await call("POST", "/api/auth/users", { username: "sneaky", password: PASS }, { as: adminJar })).status, 403);
  assert.equal((await call("PATCH", "/api/auth/users/1", { disabled: true }, { as: adminJar })).status, 403);
  assert.equal((await call("DELETE", "/api/auth/users/1", undefined, { as: adminJar })).status, 403);

  // The sign-in log is a list of IP addresses and browser strings.
  assert.equal((await call("GET", "/api/auth/events", undefined, { as: ownerJar })).status, 200);
  assert.equal((await call("GET", "/api/auth/events", undefined, { as: adminJar })).status, 403);
  assert.equal((await call("GET", "/api/auth/events")).status, 401);
});

test("a backup cannot be listed or downloaded by an admin", async () => {
  // The archive holds every password hash, every email and the database
  // password: the most sensitive file the app produces.
  assert.equal((await call("GET", "/api/backups", undefined, { as: adminJar })).status, 403);
  assert.equal((await call("POST", "/api/backups", undefined, { as: adminJar })).status, 403);
  // A traversal attempt never reaches the file system; the router only accepts
  // names shaped like its own archives.
  const traversal = await call("GET", "/api/backups/%2e%2e%2f%2e%2e%2fetc%2fpasswd", undefined, { as: ownerJar });
  assert.ok([400, 404].includes(traversal.status), `traversal answered ${traversal.status}`);
  assert.ok(!/root:/i.test(traversal.text));
  assert.equal((await call("GET", "/api/backups", undefined, { as: readerJar })).status, 403);
  assert.equal((await call("GET", "/api/backups", undefined, { as: ownerJar })).status, 200);
});

test("API answers are never cached, and carry a locked-down policy", async () => {
  const res = await call("GET", "/api/auth/me", undefined, { as: ownerJar });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("permissions-policy") ?? "", /geolocation=\(\)/);
  assert.match(res.headers.get("x-robots-tag") ?? "", /noindex/);

  // The website itself is allowed to run its own inline script, or the site
  // would be blank; it is not allowed to load anything from a stranger.
  const page = await call("GET", "/");
  const policy = page.headers.get("content-security-policy") ?? "";
  assert.match(policy, /script-src 'self' 'unsafe-inline'/);
  assert.ok(!/default-src \*/.test(policy), "the site policy is not a wildcard");
});

test("injection-shaped ids and fields come back as ordinary refusals", async () => {
  const payloads = [
    "1 OR 1=1",
    "1; DROP TABLE users; --",
    "' UNION SELECT password_hash FROM users --",
    "1' AND (SELECT 1 FROM (SELECT SLEEP(5))x) --",
  ];

  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001",
    "hex",
  );
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "payload.png");
  const item = (await call("POST", "/api/media", undefined, { as: ownerJar, form })).json.item;

  for (const payload of payloads) {
    const encoded = encodeURIComponent(payload);

    // Ids from a URL.
    for (const [method, url] of [
      ["PATCH", `/api/media/${encoded}`],
      ["PUT", `/api/media/${encoded}/file`],
      ["DELETE", `/api/media/${encoded}`],
      ["PATCH", `/api/auth/users/${encoded}`],
      ["DELETE", `/api/auth/users/${encoded}`],
      ["PATCH", `/api/member/bikes/${encoded}`],
      ["DELETE", `/api/member/journeys/${encoded}`],
    ]) {
      const res = await call(method, url, method === "PATCH" ? { tags: [] } : undefined, { as: ownerJar });
      assert.ok(
        [400, 401, 403, 404, 415].includes(res.status),
        `${method} ${url} answered ${res.status}`,
      );
      assert.ok(!/SQL|syntax|ER_|sqlite/i.test(res.text), `${url} leaked a database error: ${res.text.slice(0, 120)}`);
    }

    // Query strings and bodies.
    const events = await call("GET", `/api/auth/events?limit=${encoded}`, undefined, { as: ownerJar });
    assert.equal(events.status, 200);
    assert.ok(Array.isArray(events.json.events));

    const tags = await call("PATCH", `/api/media/${item.id}`, { tags: [payload] }, { as: ownerJar });
    assert.equal(tags.status, 200);
    // Stored as text, exactly as typed (up to the 40-character cap) — never
    // executed, and never turned into a second statement.
    assert.equal(tags.json.item.tags[0], payload.slice(0, 40).trim());
  }

  // And the database is still there: the accounts, and the photo.
  const users = await call("GET", "/api/auth/users", undefined, { as: ownerJar });
  assert.equal(users.json.users.length, 3);
  const media = await call("GET", "/api/media", undefined, { as: ownerJar });
  assert.ok(media.json.media.some((entry) => entry.id === item.id));

  await call("DELETE", `/api/media/${item.id}`, undefined, { as: ownerJar });
});

test("a member only ever sees their own garage", async () => {
  const mine = await call("POST", "/api/member/bikes", {
    maker: "Royal Enfield", model: "Himalayan", year: 2024,
  }, { as: ownerJar });
  assert.equal(mine.status, 201);
  const id = mine.json.bike.id;

  // The reader's list is their own, and an id they do not own is not found —
  // not "forbidden", because confirming it exists would itself leak.
  const theirs = await call("GET", "/api/member/bikes", undefined, { as: readerJar });
  assert.equal(theirs.status, 200);
  assert.deepEqual(theirs.json.bikes, []);
  assert.equal((await call("PATCH", `/api/member/bikes/${id}`, { model: "changed" }, { as: readerJar })).status, 404);
  assert.equal((await call("DELETE", `/api/member/bikes/${id}`, undefined, { as: readerJar })).status, 404);

  // Still the owner's bike, unchanged.
  const owned = await call("GET", "/api/member/bikes", undefined, { as: ownerJar });
  assert.equal(owned.json.bikes[0].model, "Himalayan");

  await call("DELETE", `/api/member/bikes/${id}`, undefined, { as: ownerJar });
});

test("an upload keeps its pixels and loses its personal metadata", async () => {
  // A JPEG with an EXIF block carrying a GPS position and a device serial.
  const exifBody = Buffer.concat([
    Buffer.from("Exif\0\0", "latin1"),
    Buffer.from("MM\0*\0\0\0\x08", "latin1"),
    Buffer.from("GPSLatitude=30.9,GPSLongitude=76.5,SerialNumber=SN-12345", "latin1"),
  ]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(exifBody.length + 2, 2);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app1,
    exifBody,
    // A minimal scan, so the file is still a JPEG afterwards.
    Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0, 0, 0xff, 0xd9]),
  ]);

  const form = new FormData();
  form.append("file", new Blob([jpeg], { type: "image/jpeg" }), "from-phone.jpg");
  const res = await call("POST", "/api/media", undefined, { as: ownerJar, form });
  assert.equal(res.status, 201);

  const stored = await fs.readFile(path.join(mediaDir, res.json.item.dataUrl.replace("/media/", "")));
  assert.ok(!stored.includes(Buffer.from("GPSLatitude", "latin1")), "GPS was stored");
  assert.ok(!stored.includes(Buffer.from("SerialNumber", "latin1")), "the device serial was stored");
  assert.equal(stored[0], 0xff, "still a JPEG");
  assert.equal(stored[1], 0xd8);
  assert.ok(stored.length < jpeg.length, "the metadata blocks were removed");
  assert.equal(res.json.item.size, stored.length, "the recorded size matches what is on disk");

  await call("DELETE", `/api/media/${res.json.item.id}`, undefined, { as: ownerJar });
});
