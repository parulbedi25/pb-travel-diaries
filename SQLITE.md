# Local database (SQLite)

## First setup

Choose **Local database (SQLite)**. Only the fixed name **pbfrompb** is shown;
there are no database host, username or password fields. Enter the website
title and click **Create tables & continue**, then create your owner account.

The app creates `server/data/pbfrompb.sqlite`, creates the SQLite schema, and
writes the selected driver to `data/install.json`. Both survive server restarts.
Do not set DB_HOST/DB_USER/DB_NAME or DB_DRIVER for this setup: environment
configuration deliberately takes precedence and locks the database step.

Provider MySQL/MariaDB remains available as the other option. SQLite does not
start MariaDB or store data in the disposable memory driver.

## Requirements

Use **Node.js 22.13+ or Node 24+**, preferably the current patched LTS version.
SQLite uses Node's built-in `node:sqlite` module: no native npm compilation,
SQLite binary, or new runtime package is installed. Node 22 may emit an
experimental-module warning; that alone is not an installation failure.

The app user must be able to create/write `server/data/` and `data/`. The local
directory is made private (0700), with database file mode 0600. Keep the entire
application outside the public document root and disable directory listing.
Node explicitly refuses HTTP access to `/server/data` and `/data` as defense in
depth; this cannot protect files exposed directly by a misconfigured Apache.

## Persistence and updates

Preserve **server/data/**, **data/**, **media/** and **backup/** on deployment.
Never extract a release with an option that deletes files absent from the ZIP.
The runtime packager and Docker build context exclude live SQLite files and
WAL sidecars. Git ignores them. Do not overwrite your live database with a file
from development. Docker users need a persistent mount at `/app/server/data`
in addition to the existing install/media volumes; the test Compose includes it.

SQLite is appropriate for a single-instance site with modest writes on local
disk. Do not put it on NFS/network storage or run multiple replicas against the
same file. Use provider MySQL/MariaDB for horizontally scaled deployments.

## Queries and migrations

Users, sessions, content, revisions, media metadata, settings and auth events
live in SQL tables, not a serialized memory snapshot. The SQL repository
contract is shared with MySQL. Values are bound as parameters, with narrow
adaptation of application-controlled upsert SQL for SQLite.

SQLite has its own append-only `pb_schema_migrations` ledger defined in
`server/db/sqliteMigrations.js`; MySQL's shipped migrations are unchanged.
Pending local migrations run at startup. Database status/migration/init CLI
commands recognize the saved local driver. SQLite operations are serialized
per process, write transactions use BEGIN IMMEDIATE, foreign keys are enabled,
and WAL mode plus a busy timeout allows concurrent readers. Sessions persist
across restarts and disabled accounts lose their sessions.

## Backup and restore

The regular backup exports portable JSON and uploaded media. It deliberately
does **not** copy a live `.sqlite`, `-wal`, or `-shm` file. Restoring a SQLite
backup preselects Local; no database credentials need to be entered. MySQL
exports may also be restored into Local, and SQLite exports can be directed to
provider MySQL by entering provider credentials. Existing non-empty local data
requires explicit replacement. Sessions are intentionally not restored.

For a manual file-level copy, stop the app and use a SQLite-aware backup tool
or copy the whole private directory only after all connections have closed.
Do not copy just the main file while a WAL-writing process is alive.

The backup's `app.schemaVersion` describes the portable data contract (shared
with MySQL). The independent SQLite migration version is recorded in its own
ledger and the local installer file; these version numbers need not match.

## Verification

Real SQLite integration tests cover no-credential setup, a private file,
setup lock, owner creation and login, role checks, restart/reopen persistence,
case-insensitive duplicate usernames, disabled sessions, bound injection-shaped
values, concurrent writes, rollback, idempotent migrations and a lossless
backup/restore round trip. MySQL still has its prior tests; no live MySQL
service was available in this sandbox.
