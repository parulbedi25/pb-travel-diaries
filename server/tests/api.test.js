/**
 * Integration tests for the API.
 *
 * These drive the real Express app — real routes, real multer uploads, real
 * bcrypt, real sessions — against the in-memory repository, so everything
 * except the SQL itself is exercised. Run with `npm run test:server`.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-media-"));
// A stand-in build folder: built-in art lives in public/ and is copied to
// dist/media by `npm run build`, where Express must serve it even though
// /media is also the uploads route.
const distDir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-dist-"));
await fs.mkdir(path.join(distDir, "media"), { recursive: true });
const builtInArt = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001",
  "hex",
);
await fs.writeFile(path.join(distDir, "media", "dist-only.png"), builtInArt);
process.env.DB_DRIVER = "memory";
process.env.MEDIA_DIR = mediaDir;
process.env.DIST_DIR = distDir;
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_PER_MINUTE = "0"; // the suite would otherwise trip it
process.env.BCRYPT_ROUNDS = "4"; // fast hashes; production uses 10

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

/** A tiny client that keeps the session cookie, like a browser would. */
async function call(method, url, body, { form } = {}) {
  const headers = {};
  if (cookies.session) headers.Cookie = `pb_session=${cookies.session}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(base + url, { method, headers, body: payload });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const line of setCookie) {
    const match = /pb_session=([^;]*)/.exec(line);
    if (match) {
      if (match[1]) cookies.session = match[1];
      else delete cookies.session;
    }
  }
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

const sampleContent = { v: 1, sections: [{ id: "s1", type: "hero", enabled: true, data: {} }], nav: [] };

test("health reports the database", async () => {
  const res = await call("GET", "/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.json.database, "memory");
});

test("a fresh database has no content and no accounts", async () => {
  assert.equal((await call("GET", "/api/content")).json.content, null);
  const status = await call("GET", "/api/auth/status");
  assert.equal(status.json.users, 0);
  assert.equal(status.json.signedIn, false);
});

test("the first signup creates the owner and signs them in", async () => {
  const res = await call("POST", "/api/auth/signup", {
    username: "parul",
    password: "ride2026",
    email: "parul@example.com",
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.user.role, "owner");
  assert.ok(cookies.session, "a session cookie was set");

  const me = await call("GET", "/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.json.user.username, "parul");
});

test("signup closes once an account exists", async () => {
  const res = await call("POST", "/api/auth/signup", {
    username: "someone",
    password: "another1",
  });
  assert.equal(res.status, 403);
});

test("a weak password or username is refused", async () => {
  const weak = await call("POST", "/api/auth/users", { username: "rider", password: "short" });
  assert.equal(weak.status, 400);
  const badName = await call("POST", "/api/auth/users", { username: "x", password: "goodpass1" });
  assert.equal(badName.status, 400);
});

test("an admin can add another account", async () => {
  const res = await call("POST", "/api/auth/users", {
    username: "mechanic",
    password: "wrench99",
  });
  assert.equal(res.status, 201);
  const users = await call("GET", "/api/auth/users");
  assert.equal(users.status, 200);
  assert.deepEqual(users.json.users.map((u) => u.username).sort(), ["mechanic", "parul"]);
  assert.equal(users.json.users[0].passwordHash, undefined, "hashes never leave the server");
});

test("a wrong password is refused and recorded", async () => {
  const bad = await call("POST", "/api/auth/login", { username: "parul", password: "nope" });
  assert.equal(bad.status, 401);
  assert.match(bad.json.error, /Incorrect/);

  const events = await call("GET", "/api/auth/events");
  assert.ok(
    events.json.events.some((e) => e.event === "failed_login" && e.username === "parul"),
    "the failed attempt is in the history",
  );
});

test("logging out ends the session", async () => {
  await call("POST", "/api/auth/logout");
  assert.equal((await call("GET", "/api/auth/me")).status, 401);
  assert.equal(cookies.session, undefined);

  // The history is only readable while signed in — sign back in to read it.
  await call("POST", "/api/auth/login", { username: "parul", password: "ride2026" });
  const events = await call("GET", "/api/auth/events");
  assert.ok(events.json.events.some((e) => e.event === "logout"), "logout is recorded");
});

test("signing in works and is recorded with the address", async () => {
  const res = await call("POST", "/api/auth/login", { username: "parul", password: "ride2026" });
  assert.equal(res.status, 200);
  assert.ok(cookies.session);

  const events = (await call("GET", "/api/auth/events")).json.events;
  const login = events.find((e) => e.event === "login");
  assert.ok(login, "login is recorded");
  assert.ok(login.ip, "the address is recorded");
});

test("publishing needs a session", async () => {
  const saved = cookies.session;
  delete cookies.session;
  const res = await call("PUT", "/api/content", { content: sampleContent });
  assert.equal(res.status, 401);
  cookies.session = saved;
});

test("publishing stores the content and one revision", async () => {
  const res = await call("PUT", "/api/content", {
    content: sampleContent,
    description: "First publish",
    revisionId: "rev-1",
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.revisions.length, 1);
  assert.equal(res.json.revisions[0].description, "First publish");

  const live = await call("GET", "/api/content");
  assert.deepEqual(live.json.content, sampleContent);
  assert.equal(live.json.updatedBy, "parul");
});

test("revisions can be listed and deleted", async () => {
  const revs = await call("GET", "/api/revisions");
  assert.equal(revs.json.revisions.length, 1);
  assert.deepEqual(revs.json.revisions[0].content, sampleContent);

  const removed = await call("DELETE", "/api/revisions/rev-1");
  assert.equal(removed.status, 200);
  assert.equal((await call("GET", "/api/revisions")).json.revisions.length, 0);
});

test("malformed content is refused", async () => {
  const res = await call("PUT", "/api/content", { content: { hello: "world" } });
  assert.equal(res.status, 400);
});

test("theme is stored server-side", async () => {
  assert.equal((await call("GET", "/api/settings/theme")).json.theme, "dark");
  assert.equal((await call("PUT", "/api/settings/theme", { theme: "light" })).status, 200);
  assert.equal((await call("GET", "/api/settings/theme")).json.theme, "light");
  assert.equal((await call("PUT", "/api/settings/theme", { theme: "purple" })).status, 400);
});

test("an image upload lands on disk and is served back", async () => {
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001",
    "hex",
  );
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "helmet.png");

  const res = await call("POST", "/api/media", undefined, { form });
  assert.equal(res.status, 201);
  assert.match(res.json.item.dataUrl, /^\/media\/[a-f0-9-]+\.png$/);
  assert.equal(res.json.item.kind, "image");

  const filename = res.json.item.dataUrl.replace("/media/", "");
  const onDisk = await fs.readFile(path.join(mediaDir, filename));
  assert.deepEqual(onDisk, png);

  const served = await fetch(base + res.json.item.dataUrl);
  assert.equal(served.status, 200);
  assert.equal((await served.arrayBuffer()).byteLength, png.length);

  const list = await call("GET", "/api/media");
  assert.equal(list.json.media.length, 1);
  assert.equal(list.json.media[0].name, "helmet.png");
});

test("unsupported upload types are refused", async () => {
  const form = new FormData();
  form.append("file", new Blob(["#!/bin/sh"], { type: "text/x-sh" }), "run.sh");
  const res = await call("POST", "/api/media", undefined, { form });
  assert.equal(res.status, 415);
});

test("uploads need a session", async () => {
  const saved = cookies.session;
  delete cookies.session;
  const form = new FormData();
  form.append("file", new Blob(["x"], { type: "image/png" }), "x.png");
  const res = await call("POST", "/api/media", undefined, { form });
  assert.equal(res.status, 401);
  cookies.session = saved;
});

test("deleting media removes the row and the file", async () => {
  const list = await call("GET", "/api/media");
  const item = list.json.media[0];
  const filename = item.dataUrl.replace("/media/", "");

  assert.equal((await call("DELETE", `/api/media/${item.id}`)).status, 200);
  assert.equal((await call("GET", "/api/media")).json.media.length, 0);
  await assert.rejects(fs.access(path.join(mediaDir, filename)), "the file is gone from disk");
});

test("changing the password signs other sessions out and the new one works", async () => {
  // A second browser, signed in with the old password.
  const other = { session: undefined };
  const login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "parul", password: "ride2026" }),
  });
  for (const line of login.headers.getSetCookie()) {
    const m = /pb_session=([^;]*)/.exec(line);
    if (m) other.session = m[1];
  }
  assert.ok(other.session);

  const res = await call("POST", "/api/auth/password", {
    currentPassword: "ride2026",
    newPassword: "newride77",
  });
  assert.equal(res.status, 200);

  // That other browser is now signed out.
  const stale = await fetch(base + "/api/auth/me", { headers: { Cookie: `pb_session=${other.session}` } });
  assert.equal(stale.status, 401, "the old session was revoked");

  // The new password works, the old one does not.
  assert.equal(
    (await call("POST", "/api/auth/login", { username: "parul", password: "newride77" })).status,
    200,
  );
  const wrong = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "parul", password: "ride2026" }),
  });
  assert.equal(wrong.status, 401);
});

test("the owner cannot be deleted, and the session is required", async () => {
  const users = (await call("GET", "/api/auth/users")).json.users;
  const owner = users.find((u) => u.role === "owner");
  assert.equal((await call("DELETE", `/api/auth/users/${owner.id}`)).status, 400);

  const saved = cookies.session;
  delete cookies.session;
  assert.equal((await call("DELETE", `/api/auth/users/${owner.id}`)).status, 401);
  cookies.session = saved;
});

test("unknown endpoints answer JSON, not the app", async () => {
  const res = await call("GET", "/api/nope");
  assert.equal(res.status, 404);
  assert.equal(res.json.error, "Unknown endpoint.");
});

test("shipped art and the build's media are served, and a missing file is a 404", async () => {
  // public/media is served directly, so it works before a build and in dev.
  const art = await fetch(base + "/media/himalayan-450.png");
  assert.equal(art.status, 200, "the static photo is not shadowed by the uploads folder");
  assert.match(art.headers.get("content-type") ?? "", /image\/png/);
  assert.ok((await art.arrayBuffer()).byteLength > 0);

  // dist/media is what a built deployment serves.
  const fromBuild = await fetch(base + "/media/dist-only.png");
  assert.equal(fromBuild.status, 200);
  assert.equal((await fromBuild.arrayBuffer()).byteLength, builtInArt.length);

  const missing = await fetch(base + "/media/does-not-exist.png");
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("content-type") ?? "", /application\/json/);
});

test("the owner can open public sign-up, and signup creates a reader", async () => {
  const saved = cookies.session;
  const settings = await call("PUT", "/api/settings/site", {
    title: "PB Travel Diaries",
    allowSignup: true,
  });
  assert.equal(settings.status, 200);
  assert.equal(settings.json.allowSignup, true);

  delete cookies.session;
  const signup = await call("POST", "/api/auth/signup", {
    username: "reader1",
    password: "readonly9",
  });
  assert.equal(signup.status, 201);
  assert.equal(signup.json.user.role, "reader", "public signup never creates an editor");

  const status = await call("GET", "/api/auth/status");
  assert.equal(status.json.allowSignup, true);

  // A reader cannot do anything that changes the site.
  assert.equal(
    (await call("PUT", "/api/content", { content: sampleContent })).status,
    403,
  );
  assert.equal((await call("GET", "/api/revisions")).status, 403);
  assert.equal((await call("GET", "/api/auth/users")).status, 403);
  assert.equal((await call("GET", "/api/media")).status, 403);
  const form = new FormData();
  form.append("file", new Blob(["x"], { type: "image/png" }), "x.png");
  assert.equal((await call("POST", "/api/media", undefined, { form })).status, 403);

  // Leave the owner's session for the rest of the suite.
  cookies.session = saved;
});

test("members-only sections are stripped for visitors, not for readers", async () => {
  const gated = {
    v: 1,
    sections: [
      { id: "sec-hero", type: "hero", enabled: true, data: { headline: "For everyone" } },
      {
        id: "sec-journey",
        type: "journey",
        enabled: true,
        label: "Journey Showcase",
        membersOnly: true,
        data: { headline: "Only for the tribe" },
      },
    ],
    nav: [],
  };

  const owner = cookies.session;
  const published = await call("PUT", "/api/content", {
    content: gated,
    description: "Members-only test",
    revisionId: "rev-gated",
  });
  assert.equal(published.status, 200);

  // The owner sees everything.
  const asOwner = (await call("GET", "/api/content")).json.content;
  assert.deepEqual(asOwner.sections[1].data, { headline: "Only for the tribe" });

  // A visitor's response has the label and anchor but not the content.
  delete cookies.session;
  const anonymous = (await call("GET", "/api/content")).json.content;
  assert.equal(anonymous.sections[0].locked, undefined);
  assert.equal(anonymous.sections[1].locked, true);
  assert.deepEqual(anonymous.sections[1].data, {});
  assert.equal(anonymous.sections[1].label, "Journey Showcase");

  // Signing in as the reader returns the full section.
  const login = await call("POST", "/api/auth/login", {
    username: "reader1",
    password: "readonly9",
  });
  assert.equal(login.status, 200);
  const asReader = (await call("GET", "/api/content")).json.content;
  assert.deepEqual(asReader.sections[1].data, { headline: "Only for the tribe" });
  assert.equal(asReader.sections[1].locked, undefined, "a signed-in reader sees the real section");

  // An admin added from the dashboard sees exactly the same thing as the
  // owner and the reader: the gate is about being signed in, not the role.
  delete cookies.session;
  cookies.session = owner;
  const created = await call("POST", "/api/auth/users", {
    username: "editor1",
    password: "editorpass9",
    role: "admin",
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.user.role, "admin");

  delete cookies.session;
  const adminLogin = await call("POST", "/api/auth/login", {
    username: "editor1",
    password: "editorpass9",
  });
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.json.user.role, "admin");
  const asAdmin = (await call("GET", "/api/content")).json.content;
  assert.deepEqual(asAdmin.sections[1].data, { headline: "Only for the tribe" });
  assert.equal(asAdmin.sections[1].locked, undefined, "an admin sees the real section");

  // Every signed-in role gets the whole site; only no session at all locks it.
  delete cookies.session;
  const againAnonymous = (await call("GET", "/api/content")).json.content;
  assert.equal(againAnonymous.sections[1].locked, true);

  // Restore the owner for any later test.
  cookies.session = owner;
});

test("a locked flag sent back by a browser is never stored or served", async () => {
  const owner = cookies.session;

  // This is what a dashboard save looks like after the page was opened as an
  // anonymous visitor: one section still carries the lock the server put on
  // the response. Storing it would show the members-only card to everybody,
  // including the owner, until someone edited the JSON by hand.
  const stale = {
    v: 1,
    sections: [
      { id: "sec-hero", type: "hero", enabled: true, locked: true, data: { headline: "For everyone" } },
      {
        id: "sec-journey",
        type: "journey",
        enabled: true,
        label: "Journey Showcase",
        membersOnly: true,
        data: { headline: "Only for the tribe" },
      },
    ],
    nav: [],
  };

  const published = await call("PUT", "/api/content", {
    content: stale,
    description: "Stale lock test",
    revisionId: "rev-stale-lock",
  });
  assert.equal(published.status, 200);

  // The owner's own view is not bricked by someone else's lock flag.
  delete cookies.session;
  cookies.session = owner;
  const asOwner = (await call("GET", "/api/content")).json.content;
  assert.equal(asOwner.sections[0].locked, undefined, "the public section is not locked for the owner");
  assert.equal(asOwner.sections[0].data.headline, "For everyone");

  // And nothing was written to disk in the first place.
  const stored = (await call("GET", "/api/revisions")).json.revisions.find(
    (revision) => revision.id === "rev-stale-lock",
  );
  assert.equal(stored.content.sections[0].locked, undefined, "the lock is dropped before storing");

  // A real members-only section still closes for a visitor.
  delete cookies.session;
  const anonymous = (await call("GET", "/api/content")).json.content;
  assert.equal(anonymous.sections[0].locked, undefined);
  assert.equal(anonymous.sections[1].locked, true);
  assert.deepEqual(anonymous.sections[1].data, {});

  // Leave the gated section in place for the tests that follow.
  cookies.session = owner;
});

test("a disabled account is told so, and loses the members-only sections", async () => {
  const owner = cookies.session;

  // A reader who has signed in and can see the gated section.
  const signup = await call("POST", "/api/auth/signup", {
    username: "disabled1",
    password: "readonly9",
  });
  assert.equal(signup.status, 201);
  const readerId = signup.json.user.id;
  const readerSession = cookies.session;

  const before = (await call("GET", "/api/content")).json.content;
  const gated = before.sections.find((section) => section.membersOnly);
  assert.ok(gated && !gated.locked, "the reader starts out able to read the gated section");

  // The owner switches the account off from the dashboard.
  cookies.session = owner;
  const disabled = await call("PATCH", `/api/auth/users/${readerId}`, { disabled: true });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.json.user.disabled, true);

  // The session that was already open cannot read anything gated any more.
  cookies.session = readerSession;
  const after = (await call("GET", "/api/content")).json.content;
  const nowLocked = after.sections.find((section) => section.membersOnly);
  assert.equal(nowLocked.locked, true, "the members-only section closes on the next request");
  assert.deepEqual(nowLocked.data, {});
  assert.equal((await call("GET", "/api/auth/me")).status, 401, "the session is gone");

  // The public half of the site is untouched.
  const publicSection = after.sections.find((section) => !section.membersOnly);
  assert.equal(publicSection.locked, undefined);
  assert.ok(publicSection.data && Object.keys(publicSection.data).length > 0);

  // Signing in again says exactly why, once the password is right.
  const refused = await call("POST", "/api/auth/login", {
    username: "disabled1",
    password: "readonly9",
  });
  assert.equal(refused.status, 403);
  assert.equal(refused.json.code, "account_disabled");
  assert.match(refused.json.error, /disabled/i);

  // A wrong password still gets the generic answer, so the form cannot be
  // used to find out which accounts exist or are switched off.
  const wrong = await call("POST", "/api/auth/login", {
    username: "disabled1",
    password: "not-the-password",
  });
  assert.equal(wrong.status, 401);
  assert.match(wrong.json.error, /Incorrect username or password/);

  // Re-enabling restores the account, and only then does it sign in.
  cookies.session = owner;
  const enabled = await call("PATCH", `/api/auth/users/${readerId}`, { disabled: false });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.json.user.disabled, false);

  delete cookies.session;
  const back = await call("POST", "/api/auth/login", {
    username: "disabled1",
    password: "readonly9",
  });
  assert.equal(back.status, 200);
  assert.equal((await call("GET", "/api/auth/me")).status, 200);

  // ...and cannot be used to switch off the owner, or the account doing it.
  cookies.session = owner;
  const me = (await call("GET", "/api/auth/status")).json.user;
  assert.equal(
    (await call("PATCH", `/api/auth/users/${me.id}`, { disabled: true })).status,
    400,
  );
  const ownerRow = (await call("GET", "/api/auth/users")).json.users.find((u) => u.role === "owner");
  assert.equal(
    (await call("PATCH", `/api/auth/users/${ownerRow.id}`, { disabled: true })).status,
    400,
  );
  assert.equal(
    (await call("PATCH", `/api/auth/users/${readerId}`, { disabled: "yes" })).status,
    400,
    "the flag has to be a real boolean",
  );

  // Clean up so later tests keep their reader.
  await call("DELETE", `/api/auth/users/${readerId}`);
});

test("the site title is public and only an editor can change it", async () => {
  const publicSettings = await call("GET", "/api/settings/site");
  assert.equal(publicSettings.status, 200);
  assert.equal(publicSettings.json.title, "PB Travel Diaries");

  const saved = cookies.session;
  delete cookies.session;
  assert.equal((await call("PUT", "/api/settings/site", { title: "Nope" })).status, 401);
  cookies.session = saved;

  const changed = await call("PUT", "/api/settings/site", { title: "Trails & Tales" });
  assert.equal(changed.status, 200);
  assert.equal(changed.json.title, "Trails & Tales");
  assert.equal((await call("GET", "/api/settings/site")).json.title, "Trails & Tales");

  assert.equal((await call("PUT", "/api/settings/site", { title: "" })).status, 400);
});

test("canonical and legacy rider images serve identical bytes", async () => {
  const canonical = await fetch(base + "/images/rider-kit-model-reference-v2.png");
  const legacy = await fetch(base + "/images/rider-kit-model.png");
  assert.equal(canonical.status, 200);
  assert.equal(legacy.status, 200);
  assert.match(legacy.headers.get("content-type"), /image\/png/);
  assert.deepEqual(Buffer.from(await canonical.arrayBuffer()), Buffer.from(await legacy.arrayBuffer()));
  const gear = await fetch(base + "/images/gear/classic-sling-rose-gold.webp");
  assert.equal(gear.status, 200);
  assert.match(gear.headers.get("content-type"), /image\/webp/);
});
