import express from "express";
import { getRepo } from "../db/index.js";
import {
  clearAttempts,
  clientIp,
  currentUser,
  endSession,
  hashPassword,
  normaliseUsername,
  noteFailedAttempt,
  passwordProblem,
  recordEvent,
  requireOwner,
  requireUser,
  signupAllowed,
  startSession,
  tooManyAttempts,
  usernameProblem,
  verifyPassword,
} from "../lib/auth.js";
import { estimateMileage, makerName, modelName } from "../lib/bikeCatalogue.js";

export const authRouter = express.Router();

const publicUser = (user) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  role: user.role,
});

/** What the dashboard needs to decide between "sign in" and "create account". */
authRouter.get("/status", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const users = await repo.countUsers();
    const user = await currentUser(req);
    res.json({
      users,
      signedIn: Boolean(user),
      user: user ? publicUser(user) : null,
      // The owner can switch public sign-up off from the dashboard.
      allowSignup: users === 0 || (await signupAllowed(repo)),
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Not signed in." });
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

/**
 * Signup. The first account is the owner and is created without a session
 * because there is nobody to ask. After that, signup is closed unless
 * ALLOW_PUBLIC_SIGNUP is switched on; admins add people from the dashboard.
 */
authRouter.post("/signup", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const username = normaliseUsername(req.body?.username);
    const password = String(req.body?.password ?? "");
    const email = String(req.body?.email ?? "").trim() || null;

    const usernameError = usernameProblem(username);
    if (usernameError) return res.status(400).json({ error: usernameError });
    const passwordError = passwordProblem(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const existing = await repo.countUsers();
    if (existing > 0 && !(await signupAllowed(repo))) {
      return res.status(403).json({
        error: "Signup is closed. Ask an admin to create your account in the dashboard.",
      });
    }
    if (await repo.findUserByUsername(username)) {
      return res.status(409).json({ error: "That username is taken." });
    }

    // A member's garage starts at signup: the form asks for the bike, and the
    // mileage is estimated from the catalogue when it is left blank. It is a
    // convenience, never a condition — a bad bike row must not cost somebody
    // their account, so it is written after the account exists and any problem
    // with it is ignored rather than failing the signup.
    const bike = bikeFromSignup(req.body);

    const id = await repo.createUser({
      username,
      email,
      passwordHash: await hashPassword(password),
      // First account runs the site; everybody who signs up afterwards gets
      // read-only access to the members-only parts of the frontend.
      role: existing === 0 ? "owner" : "reader",
    });
    if (bike) {
      try {
        await repo.createBike(id, bike);
      } catch {
        /* the account is what matters; the garage can be filled in later */
      }
    }
    const user = await repo.findUserById(id);
    await recordEvent(req, { userId: id, username, event: "signup", detail: "Account created" });
    await startSession(req, res, user);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

/**
 * The bike fields on the signup form, read leniently.
 *
 * Optional in every part: an account created by an admin, or by somebody who
 * rides pillion, simply has no garage yet. The mileage is either what they
 * typed (`manual`) or what the catalogue says for that model and year
 * (`estimated`) — the site never asks a question it can answer itself.
 */
function bikeFromSignup(body) {
  const maker = makerName(body?.bikeMaker ?? "");
  const model = modelName(body?.bikeMaker ?? "", body?.bikeModel ?? "");
  if (!maker || !model) return null;

  const now = new Date().getFullYear();
  const yearNumber = Number(body?.bikeYear);
  const year =
    Number.isInteger(yearNumber) && yearNumber >= 1970 && yearNumber <= now + 1 ? yearNumber : null;

  const typed = Number(body?.bikeMileage);
  const hasTyped = Number.isFinite(typed) && typed > 0 && typed <= 200;
  const estimate = estimateMileage({ maker, model, year });

  return {
    maker,
    model,
    year,
    mileageKmpl: hasTyped ? typed : estimate.kmpl,
    mileageSource: hasTyped ? "manual" : "estimated",
  };
}

authRouter.post("/login", async (req, res, next) => {
  try {
    const repo = await getRepo();
    const username = normaliseUsername(req.body?.username);
    const password = String(req.body?.password ?? "");
    const key = `${clientIp(req)}|${username}`;

    if (tooManyAttempts(key)) {
      return res.status(429).json({
        error: "Too many attempts. Wait 15 minutes and try again.",
      });
    }
    if (!username || !password) {
      return res.status(400).json({ error: "Enter your username and password." });
    }

    const user = await repo.findUserByUsername(username);
    // Same message and roughly the same work whether the account exists or the
    // password is wrong, so the form cannot be used to enumerate usernames.
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!ok) {
      noteFailedAttempt(key);
      await recordEvent(req, {
        userId: user?.id ?? null,
        username,
        event: "failed_login",
        detail: user ? "Wrong password" : "Unknown username",
      });
      return res.status(401).json({ error: "Incorrect username or password." });
    }

    // The password was right, so this is the account holder asking, not
    // somebody guessing usernames. Say plainly that the account is switched
    // off — "wrong password" here would send them round in circles — and give
    // no session, so the members-only sections stay locked.
    if (user.disabled) {
      noteFailedAttempt(key);
      await recordEvent(req, {
        userId: user.id,
        username,
        event: "failed_login",
        detail: "Account disabled",
      });
      return res.status(403).json({
        error:
          "This account is disabled. Ask the site owner to enable it again — " +
          "everything that is public can still be read without signing in.",
        code: "account_disabled",
      });
    }

    clearAttempts(key);
    await repo.touchLastLogin(user.id);
    await recordEvent(req, { userId: user.id, username, event: "login" });
    await startSession(req, res, user);
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (user) await recordEvent(req, { userId: user.id, username: user.username, event: "logout" });
    await endSession(req, res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/password", requireUser, async (req, res, next) => {
  try {
    const repo = await getRepo();
    const currentPassword = String(req.body?.currentPassword ?? "");
    const newPassword = String(req.body?.newPassword ?? "");

    const user = await repo.findUserByUsername(req.user.username);
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      return res.status(403).json({ error: "Your current password is not correct." });
    }
    const problem = passwordProblem(newPassword);
    if (problem) return res.status(400).json({ error: problem });

    await repo.updateUserPassword(user.id, await hashPassword(newPassword));
    // Changing a password signs out every other browser, then signs this one
    // back in with a fresh token — a leaked cookie dies with the old password.
    await repo.deleteUserSessions(user.id);
    await startSession(req, res, user);
    await recordEvent(req, { userId: user.id, username: user.username, event: "password_change" });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* ── account management, admin only ─────────────────────────────────────── */

authRouter.get("/users", requireOwner, async (req, res, next) => {
  try {
    const repo = await getRepo();
    res.json({ users: await repo.listUsers() });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/users", requireOwner, async (req, res, next) => {
  try {
    const repo = await getRepo();
    const username = normaliseUsername(req.body?.username);
    const password = String(req.body?.password ?? "");
    const email = String(req.body?.email ?? "").trim() || null;
    // Admins added from the dashboard edit the site; readers may only sign in
    // and browse the members-only sections.
    const role = req.body?.role === "reader" ? "reader" : "admin";

    const usernameError = usernameProblem(username);
    if (usernameError) return res.status(400).json({ error: usernameError });
    const passwordError = passwordProblem(password);
    if (passwordError) return res.status(400).json({ error: passwordError });
    if (await repo.findUserByUsername(username)) {
      return res.status(409).json({ error: "That username is taken." });
    }

    const id = await repo.createUser({
      username,
      email,
      passwordHash: await hashPassword(password),
      role,
    });
    await recordEvent(req, {
      userId: id,
      username: req.user.username,
      event: "user_created",
      detail: `Created ${username}`,
    });
    res.status(201).json({ user: publicUser(await repo.findUserById(id)) });
  } catch (error) {
    next(error);
  }
});

/**
 * Switch an account off or back on.
 *
 * A disabled account can still read the public site, but it cannot sign in and
 * every one of its sessions is dropped, so the members-only sections close on
 * the next request — including when the flag was set straight in the database,
 * because a session is looked up through `users.disabled` on every call.
 */
authRouter.patch("/users/:id", requireOwner, async (req, res, next) => {
  try {
    const repo = await getRepo();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "No such account." });

    const target = await repo.findUserById(id);
    if (!target) return res.status(404).json({ error: "No such account." });
    if (typeof req.body?.disabled !== "boolean") {
      return res.status(400).json({ error: "Say whether the account should be disabled." });
    }
    if (target.username === req.user.username) {
      return res.status(400).json({ error: "You cannot disable the account you are signed in with." });
    }
    if (target.role === "owner") {
      return res.status(400).json({ error: "The owner account cannot be disabled." });
    }

    await repo.setUserDisabled(id, req.body.disabled);
    await recordEvent(req, {
      userId: id,
      username: req.user.username,
      event: req.body.disabled ? "user_disabled" : "user_enabled",
      detail: `${req.body.disabled ? "Disabled" : "Enabled"} ${target.username}`,
    });

    const fresh = await repo.findUserById(id);
    res.json({
      user: {
        ...publicUser(fresh),
        disabled: Boolean(fresh.disabled),
        disabledAt: fresh.disabledAt ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.delete("/users/:id", requireOwner, async (req, res, next) => {
  try {
    const repo = await getRepo();
    const id = Number(req.params.id);
    const target = await repo.findUserById(id);
    if (!target) return res.status(404).json({ error: "No such account." });
    if (target.username === req.user.username) {
      return res.status(400).json({ error: "You cannot delete the account you are signed in with." });
    }
    if (target.role === "owner") {
      return res.status(400).json({ error: "The owner account cannot be deleted." });
    }
    await repo.deleteUser(id);
    await recordEvent(req, {
      userId: id,
      username: req.user.username,
      event: "user_deleted",
      detail: `Deleted ${target.username}`,
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/events", requireOwner, async (req, res, next) => {
  try {
    const repo = await getRepo();
    res.json({ events: await repo.listAuthEvents(Number(req.query.limit) || 100) });
  } catch (error) {
    next(error);
  }
});
