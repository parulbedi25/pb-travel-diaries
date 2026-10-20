#!/usr/bin/env bash
# Shared ephemeral deployment verification for both CI providers.
set -euo pipefail
: "${TEST_DB_PASSWORD:?Set test database password}"
: "${TEST_DB_ROOT_PASSWORD:?Set test root password}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-pb-ci-test}"
cleanup() {
  status=$?
  mkdir -p test-results
  docker compose ps -a > test-results/compose-status.txt 2>&1 || true
  docker compose logs --no-color > test-results/compose.log 2>&1 || true
  docker compose down --volumes --remove-orphans || true
  exit "$status"
}
trap cleanup EXIT

docker compose up --build --wait --wait-timeout 240
# Execute inside the app container; no hardcoded browser/backend host required.
docker compose exec -T app node --input-type=module <<'JS'
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:4000';
const health = await fetch(`${base}/api/health`);
assert.equal(health.status, 200);
const body = await health.json();
assert.equal(body.ok, true);
assert.equal(body.database, 'mysql');
const page = await fetch(base);
assert.equal(page.status, 200);
assert.match(await page.text(), /<html/i);
for (const asset of ['/media/himalayan-450.png', '/images/rider-kit-model-reference-v2.png', '/images/rider-kit-model.png']) {
  const response = await fetch(base + asset);
  assert.equal(response.status, 200, asset);
  assert.match(response.headers.get('content-type'), /image\//);
}
const status = await fetch(`${base}/api/auth/status`).then(r => r.json());
assert.equal(status.users, 0, 'fresh test database; owner setup must remain available');
console.log('Test deployment passed: website, SQL health, fresh installer state, and static assets.');
JS
