/**
 * First-run setup.
 *
 * Two steps, in this order:
 *   1. The website title and SQLite/provider selection. This creates the database
 *      (when the account may), every table, and the deployment settings.
 *   2. The owner account. It is the only account that can never be deleted,
 *      and it is created once — afterwards the dashboard adds people or they
 *      sign up for a read-only account themselves.
 *
 * Once step 1 has been saved these endpoints refuse to change anything, so a
 * visitor can never repoint a live site at a database of their choosing.
 */
import express from "express";
import { config } from "../config.js";
import { getRepo, resetRepo } from "../db/index.js";
import {
  hashPassword,
  normaliseUsername,
  passwordProblem,
  recordEvent,
  usernameProblem,
} from "../lib/auth.js";
import {
  installDatabase,
  SetupError,
  testConnection,
} from "../lib/installer.js";
import { publicInstall, readInstall } from "../lib/installFile.js";
import { restoreAllowed } from "./restore.js";

export const setupRouter = express.Router();

const isMemory = () => config.dbDriver === "memory";

/** The panel at `#/setup` and the page title both read this before anything
 *  else, so it must answer even when the database is down. */
setupRouter.get("/setup/status", async (req, res) => {
  const saved = readInstall();

  if (isMemory()) {
    // Always "installed" for local development and the tests, so the wizard
    // never gets in the way; the account count is still the real one.
    let memoryUsers = 0;
    try {
      memoryUsers = await (await getRepo()).countUsers();
    } catch {
      memoryUsers = 0;
    }
    return res.json({
      installed: true,
      needsOwner: false,
      databaseReady: true,
      users: memoryUsers,
      siteTitle: config.siteTitle,
      db: null,
      setupLocked: true,
      restoreAllowed: false,
      mode: "memory",
    });
  }

  const envConfigured = !saved?.installed && config.hasDatabase;
  let installed = Boolean(saved?.installed);
  let databaseReady = false;
  let users = 0;
  let error = null;

  // A deployment that keeps its credentials in `.env` (the pre-installer
  // setup) is installed as soon as the database answers; its owner signs in
  // from `#/admin` exactly as before.
  if (installed || envConfigured) {
    try {
      const repo = await getRepo();
      await repo.ping();
      installed = true;
      databaseReady = true;
      users = await repo.countUsers();
    } catch (dbError) {
      error =
        envConfigured && !installed
          ? `The database settings in the environment did not work: ${dbError.message}`
          : `The saved database is not answering: ${dbError.message}`;
      // A stored install file still means "installed" even when the database
      // is briefly down; the site should show its outage, not the wizard.
      installed = Boolean(saved?.installed);
    }
  }

  res.json({
    installed,
    needsOwner: installed && databaseReady && users === 0,
    databaseReady,
    users,
    siteTitle: saved?.siteTitle || config.siteTitle,
    // The database address is only useful to the owner once the site is
    // installed; before that it would just hand a stranger the layout.
    db: installed ? publicInstall(saved) : null,
    setupLocked: Boolean(saved?.installed) || config.hasDatabase || isMemory(),
    // The "Restore a backup" tab is shown only while the site is uninstalled.
    restoreAllowed: restoreAllowed(),
    error,
    mode: envConfigured ? "env" : "installer",
  });
});

/** Prove the details work without changing a thing. */
setupRouter.post("/setup/test", async (req, res, next) => {
  try {
    if (isMemory()) {
      return res.status(403).json({ error: "Setup is not used with the in-memory database." });
    }
    if (config.hasDatabase) {
      return res.status(403).json({ error: "This site already has a database configured." });
    }
    const result = await testConnection(req.body ?? {});
    res.json(result);
  } catch (error) {
    if (error instanceof SetupError) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

/** Step 1: create the database tables and remember the credentials. */
setupRouter.post("/setup/database", async (req, res, next) => {
  try {
    if (isMemory()) {
      return res.status(403).json({ error: "Setup is not used with the in-memory database." });
    }
    // A database is configured either by the installer file, by `.env` or by
    // the hosting panel. In every one of those cases repointing it from an
    // unauthenticated request must be impossible — otherwise whoever loaded
    // the page first could direct the site at a database of their choosing.
    if (config.hasDatabase) {
      return res.status(403).json({ error: "This site already has a database configured." });
    }

    const result = await installDatabase(req.body ?? {});

    // The old repository (if any) pointed at the wrong database. Drop it so
    // the owner step opens against the one just configured.
    await resetRepo();

    await recordEvent(req, {
      username: "installer",
      event: "user_created",
      detail: "Database tables created by the setup screen",
    });

    res.status(201).json({ ...result, next: result.needsOwner ? "owner" : "login" });
  } catch (error) {
    if (error instanceof SetupError) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

/**
 * Step 2: the one-time owner account.
 *
 * The account is created and **not** signed in. The person who made it has to
 * present the username and password again on the next screen, which is the
 * point: a password typed once into a fresh install is a password nobody has
 * proved they know. It also means the first session on a brand-new site is
 * created by the sign-in endpoint like every session after it — one place that
 * sets a cookie, one place that checks a password — rather than by a setup
 * screen that could be reached before the site was even installed.
 */
setupRouter.post("/setup/owner", async (req, res, next) => {
  try {
    if (isMemory()) {
      return res.status(403).json({ error: "Setup is not used with the in-memory database." });
    }
    if (!config.hasDatabase) {
      return res.status(409).json({ error: "Finish the database step first." });
    }

    const repo = await getRepo();
    if ((await repo.countUsers()) > 0) {
      return res.status(409).json({ error: "This site already has its owner account. Sign in instead." });
    }

    const username = normaliseUsername(req.body?.username);
    const password = String(req.body?.password ?? "");
    const email = String(req.body?.email ?? "").trim() || null;

    const usernameError = usernameProblem(username);
    if (usernameError) return res.status(400).json({ error: usernameError });
    const passwordError = passwordProblem(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const id = await repo.createUser({
      username,
      email,
      passwordHash: await hashPassword(password),
      role: "owner",
    });
    const user = await repo.findUserById(id);

    await recordEvent(req, {
      userId: id,
      username,
      event: "signup",
      detail: "Owner account created by the setup screen",
    });

    res.status(201).json({
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
      // Worth saying out loud in the answer as well as in the cookie jar: no
      // session was opened, so the next step is the sign-in screen.
      signedIn: false,
      next: "login",
    });
  } catch (error) {
    next(error);
  }
});
