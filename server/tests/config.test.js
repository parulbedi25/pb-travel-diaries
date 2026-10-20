/**
 * How the app decides where to listen.
 *
 * cPanel's "Setup Node.js App" (Namecheap, and every panel built on Phusion
 * Passenger) does not give the app a port. It creates a Unix socket and hands
 * the app its path in `PORT`. Parsing that as a number yields NaN, the app
 * falls back to 4000, and Passenger — which is waiting on the socket — answers
 * 503 without saying why. These tests pin both shapes down.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const configUrl = pathToFileURL(path.join(root, "server", "config.js")).href;

/** Read `config.port` in a fresh process, so env changes actually apply. */
async function listenTarget(port) {
  const env = { ...process.env };
  if (port === undefined) delete env.PORT;
  else env.PORT = port;

  const code = `import(${JSON.stringify(configUrl)}).then((m) => process.stdout.write("\\nRESULT=" + JSON.stringify(m.config.port)))`;
  const { stdout } = await exec(process.execPath, ["--input-type=module", "-e", code], {
    cwd: root,
    env,
  });
  // dotenv prints a startup notice; the answer is the marked line.
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT="));
  assert.ok(line, `no answer from config.js; output was: ${stdout}`);
  return JSON.parse(line.slice("RESULT=".length));
}

test("a socket path from Passenger is kept as a path", async () => {
  const socket = "/tmp/passenger.1.0.12345/guard/ruby/socket";
  assert.equal(await listenTarget(socket), socket);
});

test("a TCP port is a number, not the string Node would treat as a pipe", async () => {
  assert.equal(await listenTarget("4000"), 4000);
  assert.equal(typeof (await listenTarget("8080")), "number");
  assert.equal(await listenTarget("0"), 0, "port 0 is meaningful: pick a free port");
});

test("with no PORT at all the local default stands", async () => {
  assert.equal(await listenTarget(undefined), 4000);
});

test("surrounding whitespace from a panel does not break either shape", async () => {
  assert.equal(await listenTarget(" 4000\n"), 4000);
  assert.equal(await listenTarget("  /tmp/pb.sock  "), "/tmp/pb.sock");
});
