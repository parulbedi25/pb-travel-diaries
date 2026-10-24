// Shared CI entry point: stream readable results and retain a JUnit report.
// Propagate the test runner's exit code so a failure blocks deployment.
import { mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(new URL('../test-results/', import.meta.url), { recursive: true });
const tests = readdirSync(new URL('../server/tests/', import.meta.url))
  .filter(name => name.endsWith('.test.js'))
  .sort()
  .map(name => `server/tests/${name}`);
if (tests.length === 0) throw new Error('No server tests found; refusing deployment.');
const result = spawnSync(process.execPath, [
  '--test',
  '--test-reporter=spec',
  '--test-reporter=junit',
  '--test-reporter-destination=stdout',
  '--test-reporter-destination=test-results/server-tests.xml',
  ...tests,
], { cwd: root, stdio: 'inherit' });
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
