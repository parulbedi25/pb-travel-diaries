# Disposable test deployments

These files are **testing only**. They do not deploy to Namecheap or Azure App
Service and require no production credentials. GitHub/Azure jobs deploy on an
isolated hosted Linux agent, verify the app against MariaDB, collect logs, and
remove containers and volumes. They do not leave a permanent public site.

## Local Docker Compose

Requires Docker Engine/Desktop and Compose v2 with `up --wait` support.

```bash
cp .env.test.example .env.test
# Edit .env.test: choose two different disposable passwords.
docker compose --env-file .env.test -p pb-local-test up --build --wait
```

Open http://localhost:4000. MariaDB is private to the Compose network (no host
database port). App HTTP is bound to loopback only. If port 4000 is occupied,
change TEST_APP_PORT in .env.test. Do not reuse production database details.
The app runs as the unprivileged node user and creates/migrates tables at boot.
Database credentials are supplied by Compose; create the owner in the browser
installer. Changes persist in test-only named volumes until explicitly removed.

```bash
docker compose --env-file .env.test -p pb-local-test logs -f app
# Stop, retaining test data:
docker compose --env-file .env.test -p pb-local-test down
# Full reset: destroys this stack's database, uploads and configuration:
docker compose --env-file .env.test -p pb-local-test down --volumes
```

This stack disables daily backups and proxy trust. HTTP is for local testing;
it is not a secure public hosting configuration. Credentials are visible to
local Docker administrators, as with other container environment variables.

## GitHub Actions

`.github/workflows/test-deployment.yml` is manual-only. Once it is on the default
branch, use **Actions → Disposable test deployment → Run workflow**. Choose the
branch to test. The job runs server tests, builds the Node-only Docker image,
starts Compose, checks SQL health, website/static assets and fresh setup state,
then tears the stack down. Random test passwords are generated per run and
masked. No GitHub secrets, registry push or cloud connection is needed.

Logs are retained as an artifact for three days. This workflow grants only
read access to repository contents. It does not automatically run on PRs or
pushes, and has no production deployment path.

## Azure Pipelines

Create a YAML pipeline pointing to `azure-pipelines.yml`, then **Run pipeline**.
Use the hosted Ubuntu image with Docker/Compose v2 and NodeTool available.
Both push and PR triggers are disabled. The pipeline performs the same tests
and temporary Compose deployment via `scripts/test-deployment.sh`.

No Azure subscription/service connection is required: deployment is on the
agent, not to an Azure resource. Pipeline artifacts follow your Azure project's
retention policy. Access to Microsoft-hosted parallel jobs may require an
organization-level grant. Do not use a production host as a self-hosted agent.

## Validation and boundaries

`npm run test:server` tests the server separately with its memory repository.
The deployment script checks real MariaDB connectivity and startup migrations
through `/api/health`. It does not exercise every SQL query, owner creation,
visual UI, or restore flow. Tests exit nonzero on failed checks; logs and cleanup
run even on failures. A force-killed agent may bypass shell cleanup, which is
why hosted disposable agents are required for CI.

No Vite or frontend build tools are installed. Docker copies the included
`dist/` and canonical `public/` assets. Existing cPanel startup is unchanged.
