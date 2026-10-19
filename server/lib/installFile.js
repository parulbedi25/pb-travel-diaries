/**
 * The first-run installer's memory.
 *
 * The setup screen asks for the database address before there is a database to
 * put it in, so the answers are kept in a small file next to the app
 * (`data/install.json` by default, or `INSTALL_FILE`). It holds the database
 * password, so it is written 0600 and the folder 0700, and it is never served
 * or committed.
 *
 * Environment variables still win over this file: hosting panels set real
 * environment variables, and an operator who edited `.env` should not be
 * surprised by an older installer answer.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Absolute path of the install file this process reads and writes.
 *
 * Resolved on each call, not at import: `.env` is loaded after the modules are
 * linked, and `INSTALL_FILE` is allowed to live there.
 */
export function installFilePath() {
  return process.env.INSTALL_FILE
    ? path.resolve(process.env.INSTALL_FILE)
    : path.join(root, "data", "install.json");
}

/** The saved installer answers, or null when the site has not been set up. */
export function readInstall(file = installFilePath()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || !parsed.db) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Save the installer answers atomically, so a crash halfway through a setup
 * cannot leave a half-written password file behind.
 */
export function writeInstall(answers, file = installFilePath()) {
  const folder = path.dirname(file);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(folder, 0o700);
  } catch {
    /* some hosting panels manage permissions themselves */
  }

  const payload = JSON.stringify(answers, null, 2);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, payload, { mode: 0o600 });
  try {
    fs.chmodSync(temp, 0o600);
  } catch {
    /* best effort, as above */
  }
  fs.renameSync(temp, file);
  return answers;
}

/** What the setup screen may see about the database — never the password. */
export function publicInstall(answers) {
  if (!answers?.db) return null;
  return {
    host: answers.db.host,
    port: answers.db.port,
    database: answers.db.database,
    user: answers.db.user,
    socketPath: answers.db.socketPath ?? "",
  };
}
