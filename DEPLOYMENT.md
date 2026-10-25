# Deploying PB Travel Diaries

> **Local SQLite is now available:** choose Local database (SQLite) on setup
> for `server/data/pbfrompb.sqlite`, with no database credentials. Requires
> Node.js 22.13+ or 24+. Preserve `server/data/` during updates. Provider MySQL
> instructions below apply only when choosing provider mode. See [SQLITE.md](SQLITE.md).


One Node.js process serves the built site, the API and the uploaded media, and
stores everything else in MariaDB. Any host that can run a long-lived Node
process and gives you a MySQL/MariaDB database will run it — a shared panel
(Passenger, Plesk, DirectAdmin), a managed Node host, Docker, or a VPS.

```
browser ──► Node (server/index.js) ──► MariaDB   content, accounts, sessions, history, media index
                  │
                  ├──► dist/    the included prebuilt site
                  ├──► media/   uploaded files (back this up)
                  ├──► public/  art that ships with the code, served at /media
                  └──► data/    install.json — the installer's answers (back this up)
```

**You do not import any SQL file.** The first time you open the site, a setup
screen asks for the database details and the owner account, then creates every
table itself.

The website in `dist/` is checked into the repository. All npm dependencies
are server packages. No frontend build tools or compilation are required.

Run `npm install`, optionally `npm run hosting:check`, then `npm start`.
`npm run package` copies the runtime into `release/pb-travel-diaries/` without
building. `npm run dev` is Node server watch mode only.

---

## 1. What the host must provide

| Requirement | Why | Where it usually lives |
| --- | --- | --- |
| Node.js **20.19+** or **22.12+** | Supported Node runtime; Node 22 recommended | Panel's Node.js selector, or `node -v` over SSH |
| MySQL 5.7+ / MariaDB 10.3+ | content, accounts, sessions, history | Panel → MySQL/MariaDB databases, or install `mariadb-server` |
| A long-lived Node process | the API and the site | Passenger, Plesk's Node.js app, systemd, Docker, a Node host |
| Two writable folders | `data/` (installer answers) and `media/` (uploads) | your app folder |
| HTTPS | session cookies are marked `Secure` | the panel's AutoSSL / Let's Encrypt, or a reverse proxy |

It does **not** need Vite, TypeScript, React or a build step at runtime.

---

## 2. Create the database and its user first

The setup screen can create the *tables*, but it cannot be the thing that
creates database accounts — no public web form should be able to do that. Create
these before opening the site:

1. **A database** — any empty MySQL/MariaDB database. Note its exact name;
   panels often prefix it (`pbuser_travel`).
2. **A database user** — with a strong password. Note the exact username;
   panels prefix this too (`pbuser_pb`).
3. **Attach the user to the database** with **all privileges**.

How to find it:

| Host | Where |
| --- | --- |
| cPanel | **MySQL® Databases** → Create New Database → Add New User → Add User To Database → ALL PRIVILEGES |
| Plesk | **Databases** → Add Database; the same screen creates/attaches the user |
| DirectAdmin | **MySQL Management** → Create Database; add the user and grant access |
| VPS / local | `mysql -u root -p` and the SQL below |

```sql
CREATE DATABASE pb_travel_diaries CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'pb'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON pb_travel_diaries.* TO 'pb'@'localhost';
FLUSH PRIVILEGES;
```

Some managed hosts give you a connection URL instead of separate values —
split it into host, port, database, user and password.

**If the database or user is missing, the setup screen says so.** Its connection
test distinguishes “the server answered but this database does not exist yet”
(create it and attach the user) from “that user or password was rejected”
(create the user or correct the password). It never guesses.

---

## 3. Put the code on the server

Upload the application runtime (`app.cjs`, `server/`, `dist/`, `public/`,
package.json and package-lock.json) outside the public document root. Or run
`npm run package` locally and upload `release/pb-travel-diaries/`.

In cPanel use Run NPM Install. With terminal access, `npm install` also works.
Run `npm run hosting:check` to create/test writable folders. Do not upload
node_modules, credentials, backups or user uploads from a local installation.

For cloning on a server: clone the repository, run `npm install`, and start
`app.cjs`. The included `dist/` is ready to serve, without a build step.

See [NAMECHEAP.md](NAMECHEAP.md) for the exact panel settings.

---

## 4. Start the app

The start command is always the same:

```bash
node server/scripts/start.js
```

It sets `NODE_ENV=production` when the environment did not, then runs
`server/index.js`. Most panels call this the **Application startup file**.

| Host | Where to set it |
| --- | --- |
| cPanel (Passenger) | **Setup Node.js App** → Create Application: Node 20/22, Production, root = the app folder, startup file `server/scripts/start.js` — step-by-step for Namecheap in [NAMECHEAP.md](NAMECHEAP.md) |
| Plesk | **Node.js** → Application root, Application startup file `server/scripts/start.js`, then *Restart* |
| Docker | `CMD ["node", "server/scripts/start.js"]` |
| VPS / systemd | unit below |

The panel supplies `PORT` and keeps the process alive. Do not set `PORT`
yourself unless you are running it by hand.

`PORT` is not always a number. Passenger — the manager behind cPanel's
**Setup Node.js App**, and therefore every Node app on Namecheap shared
hosting — usually hands the app the path of a Unix socket it created. The app
accepts either and passes it straight to `server.listen`; a value that is not a
bare number is treated as a socket path. This is why a deployment that binds a
fixed port of its own answers **503** behind Passenger.

### Environment variables

The setup screen writes `data/install.json`; you can skip every `DB_*` variable
if you use it. Real environment variables win over `.env`, which wins over the
install file.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | — | MariaDB connection; skips the database step of the installer |
| `DB_SOCKET` | — | Alternative to host/port on some shared plans |
| `DB_DRIVER` | `mysql` | `memory` is for local work and tests only |
| `MEDIA_DIR` | `./media` | Where uploads are written |
| `DIST_DIR` | `./dist` | Where the built site is |
| `INSTALL_FILE` | `./data/install.json` | Where the installer saves its answers |
| `SESSION_DAYS` | `7` | How long a sign-in lasts |
| `COOKIE_SECURE` | `auto` | Marks the cookie `Secure` over HTTPS |
| `TRUST_PROXY` | `true` | Required behind Passenger/nginx for real IPs and HTTPS detection |
| `BCRYPT_ROUNDS` | `10` | Password hashing cost |
| `MAX_UPLOAD_MB` | `25` | Upload ceiling |
| `MAX_RESTORE_MB` | `2048` | Largest backup the restore screen accepts |
| `BACKUP_ENABLED` | `true` | The daily backup |
| `BACKUP_HOUR` | `2` | Local hour of the daily run |
| `BACKUP_KEEP` | `10` | How many zips to keep |
| `BACKUP_DIR` | `./backup` | Where they are written (created if missing) |
| `BACKUP_INCLUDE_APP` | `true` | Put the application's own files in the zip |
| `ALLOW_SITE_RESTORE` | — | `1` lets the restore screen run over an already-installed database |
| `ALLOW_PUBLIC_SIGNUP` | `false` | Fallback only; the dashboard setting wins once installed |

If the panel already supplies `DB_*`, the setup screen skips the database step
and comes straight to the owner account. If those credentials do not work, the
site says so instead of letting you overwrite them from the browser.

---

## 5. Run the one-time setup

Open the site. Until a database and an owner exist, every address shows the
setup screen:

1. **Step 1 — Website title + database.** Enter the three values from step 2.
   **Test connection** checks them without changing anything and tells you if
   the database or user is missing. **Create tables & continue** creates every
   table, the schema-version row and the deployment settings.
2. **Step 2 — Super admin.** The owner's username, password and optionally
   email. This account can never be deleted and is the only one the installer
   creates.
3. The site opens signed in as the owner.

Once step 1 succeeds the setup endpoints lock: a visitor can no longer repoint
the site at another database. Do this immediately after the first deploy.

If `data/` is not writable the screen tells you: `chmod 775 data` and retry.

### The host's own health check

```bash
curl -s https://yourdomain.com/api/health
```

| Answer | Meaning |
| --- | --- |
| `{"ok":true,"database":"mysql",…}` | App and database are ready |
| `{"ok":false,"error":"Database unreachable."}` | Not configured yet, or the DB is down — open the site to see which |
| `"database":"memory"` | `DB_DRIVER=memory` is set somewhere; remove it |

---

## 6. HTTPS

Put the site behind TLS before sharing it: the session cookie is marked
`Secure` whenever the request arrives over HTTPS (`COOKIE_SECURE=auto`), and
`TRUST_PROXY=true` is what lets the app see that.

- **cPanel**: SSL/TLS Status → Run AutoSSL
- **Plesk**: SSL/TLS Certificates → Let's Encrypt
- **VPS**: `certbot --nginx`, or terminate TLS at nginx and keep Node on :4000

---

## 7. Accounts, readers and members-only sections

The owner signs in at `#/admin` (aliases `#/pb-control`, `#/login`).

- **Settings → Accounts** adds accounts. Choose **Admin** for somebody who edits
  the site, or **Reader** for somebody who may only read it.
- **Settings → Site & sign-up** sets the website title and whether strangers may
  create accounts from the public page (`#/members`).
- Public sign-up always creates a **reader**. Readers can sign in, unlock the
  members-only sections and nothing else — no publishing, no uploads, no account
  management. The API enforces this; hiding the buttons is not the protection.
- **Sections** has a **Public / Members** switch on every section. Visitors see a
  locked card with the section's name; the server strips the content from the
  anonymous response, so it is not in the page source.
- Every sign-up, sign-in, sign-out, failed attempt, password change and account
  creation is stored in `auth_events` with the address and browser.

---

## 8. Backups

The app backs itself up. Once a day it writes one zip into **`backup/`** at the
root of the installation, creating the folder the first time, and keeps the
newest **ten**. Nothing needs installing and there is no cron entry to write.

```
backup/
  pb-backup-2026-10-20_02-00-07.zip
  pb-backup-2026-10-19_02-00-04.zip
  … nine more
```

Each archive contains:

| Inside | What it is |
| --- | --- |
| `pb-restore.json` | The entire database as plain JSON — every account with its bcrypt hash, the published site and its revision history, the media index, every setting, the access log — plus the database details this installation was using |
| `media/` | Every uploaded photograph and document, byte for byte |
| `app/` | The application itself: `server/`, `src/`, `public/`, `dist/`, the package files and the docs |
| `RESTORE-README.txt` | The same instructions, inside the zip |

The schedule, the count and the folder are `BACKUP_HOUR`, `BACKUP_KEEP` and
`BACKUP_DIR`. Turn it off with `BACKUP_ENABLED=false`, or leave the code out of
the archive with `BACKUP_INCLUDE_APP=false`.

**Taking one now:** **PB Control → Backups → Back up now**, or
`npm run backup:now` on the server. The dashboard also lists the archives and
downloads them; both need an editor session, because a backup is the most
sensitive file the app produces (`backup/` is never served by Express and is in
`.gitignore`).

> **Copy them somewhere else.** A backup on the same disk as the site does not
> survive the disk. Download the newest zip now and then, or sync `backup/` to
> another machine.

### Restoring onto a new server

1. Deploy the code as usual — **without** the old `data/` folder. Do not create
   the tables: the restore does that.
2. Open the site. The setup screen now offers **Start fresh** and **Restore a
   backup**.
3. Choose **Restore a backup** and upload the zip. The screen reads
   `pb-restore.json` and shows how many accounts, photos and revisions are
   inside.
4. The database details fill themselves in from the file. If the new server
   uses a different database name, user or password, type them in now — that is
   the whole point of the file being standalone. (You can equally edit the
   `database` block in `pb-restore.json` with a text editor and re-zip it.)
5. Press **Restore everything**. The tables are created, every row is written
   back, `media/` is unpacked into the uploads folder, and `data/install.json`
   is saved. Sign in with the password you already had.

A restore refuses to run over a database that already has accounts unless you
tick **Replace what is in that database**, so two sites cannot be merged by
accident. A backup made by a newer version of the app is refused with the
version it needs rather than half-imported.

Setting `ALLOW_SITE_RESTORE=1` opens the same screen on an installation that
already has a database, for the case where you must recover in place.

### Doing it by hand instead

If you would rather keep your own dumps, the three things that matter are the
database, `media/` and `data/install.json`:

```bash
mysqldump --single-transaction -u pb -p'THE_PASSWORD' pb_travel_diaries > db.sql
tar -czf uploads.tgz media data
```

Restoring is the pair: import the `.sql`, unpack `media/` and `data/`, restart
the app.

---

## 9. Changing the database later

Adding a feature that needs a column, a table or a backfilled row is one entry
in **`server/db/migrations.js`**:

```js
{
  version: 4,
  name: "add the rides table",
  up: sql(
    `CREATE TABLE IF NOT EXISTS rides (...)`,
    `ALTER TABLE users ADD COLUMN rides_seen INT NOT NULL DEFAULT 0`,
  ),
}
```

`up` receives the connection, so it is not limited to SQL: a migration can read
old rows and write new ones (a data migration), in whatever order the change
needs. The next boot — or `npm run db:migrate` — applies it.

- **Each version runs once.** `schema_migrations` records what ran; the server
  skips everything already in the ledger.
- **Never edit a migration that has shipped.** Some installation has already run
  it. Add the next version instead.
- **Never add a column to `BASE_STATEMENTS`.** Those are the tables as they
  looked at version 1. A brand-new install creates them and then replays every
  migration, so a fresh site and a three-year-old one end up in the same shape.
- **Existing deployments catch up automatically.** A database that predates the
  ledger (it only has `settings.schema_version`) is adopted at that version, so
  the older `ALTER`s are not attempted again.

### Upgrading a site that is already running

The upgrade never needs the site to be taken down, and it is safe to start twice.
Three things make that true:

- **Every step is additive and repeatable.** New tables are `CREATE TABLE IF NOT
  EXISTS`, new columns are nullable or carry a default, and a statement whose
  column or index already exists is read as "this step is done" rather than as a
  failure. The old code keeps working against the new shape, so the site serves
  normally while the upgrade runs.
- **An interrupted upgrade is finished by running it again.** If the process dies
  (or the deploy restarts the app) halfway through a version, the next attempt
  replays that version and steps over the parts that already landed. Nothing is
  stuck, and no one has to fix the database by hand.
- **Only one upgrade runs at a time.** The upgrader takes a MySQL named lock
  (`pb_travel_diaries_schema`, 30-second wait) before it touches anything, so two
  workers booting together — a rolling restart, a Passenger worker pool — do not
  apply the same version twice. If the lock cannot be had within 30 seconds the
  process says so (`SCHEMA_LOCK_TIMEOUT`) and leaves the database alone.

What a member sees during the minute between "new code deployed" and "migration
finished": a short notice that their tracker is being brought up to date, and the
page tries again by itself. Behind it the API answers `503` with
`{"code": "schema_pending"}` instead of a 500, because nothing is broken — the
database is simply a step behind the code. Every other page, the owner's
dashboard included, is untouched.

Useful commands:

| Command | What it does |
| --- | --- |
| `npm run db:status` | Prints the installed version and every migration waiting |
| `npm run db:migrate` | Applies the waiting ones and says which |
| `npm run db:migrate -- --dry-run` | Says what would be applied, changes nothing |
| `npm run db:migrate -- --check` | Exits 1 if the database is behind the code — a deploy gate |
| `npm run schema:sql` | Regenerates `server/schema.sql` for phpMyAdmin users |
| `npm run db:init` | Creates the database and tables from scratch |

### Rules for the next migration

1. **Additive only.** Add tables, columns and indexes. Do not rename or drop
   something the current release still reads in the same version — do that a
   release later, once nothing refers to it.
2. **Nullable or defaulted columns.** `ALTER TABLE ... ADD COLUMN x INT NULL` and
   `... ADD COLUMN y VARCHAR(20) NOT NULL DEFAULT ''` are both fine on a table
   that is being read; a `NOT NULL` column with no default is not.
3. **Write it as a list of statements** (`up: sql(...)`) so `schema.sql` can
   include it. A migration that must read rows and write new ones is allowed to
   be a function, but it then only exists for the app, not for phpMyAdmin.
4. **Move the version forward, never sideways.** `LATEST_VERSION` is the last
   entry's version; a gap or a renumbered entry makes an installed database skip
   a step. `server/tests/migrations.test.js` checks this.

A restore replays migrations in two stages on purpose: it builds the tables at
the backup's own version, loads the rows, and only then applies anything newer —
so a migration that backfills data sees the restored rows rather than an empty
table.

---

## 10. Updating

**Option A upload (no build tools on the server):**

1. On your computer: `git pull && npm ci && npm run package`.
2. Upload the new `release/pb-travel-diaries/` over the old files. Keep `data/`
   and `media/` — they are not part of the package.
3. On the server: `npm ci --omit=dev`, then restart the app.

**Option B update a clone on the server:**

```bash
cd pb-travel-diaries
git pull
npm ci
```

Then restart the process (panel button, or `systemctl restart pb`). A restart is
required: the server loads `dist/` at boot and applies any pending database
migration — the base tables plus everything in the ledger that has not run yet —
before taking traffic. `data/`, `media/` and `backup/` are untouched. Run
`npm run db:status` first if you want to see what the restart will change.

### Upgrading from the `.env`-only version

A deployment that keeps its credentials in the environment keeps working:
`/api/setup/status` detects them, the setup screen is skipped, and the owner
signs in at `#/admin` as before. On the first boot the server adds the `reader`
role to the `users` table and writes the schema version. Nothing to import.

---

## 11. Process manager examples

**systemd** (`/etc/systemd/system/pb.service`):

```ini
[Unit]
Description=PB Travel Diaries
After=network.target mariadb.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/pb
EnvironmentFile=-/srv/pb/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server/scripts/start.js
Restart=always

[Install]
WantedBy=multi-user.target
```

**nginx** in front:

```nginx
server {
    listen 80;
    server_name example.com www.example.com;
    client_max_body_size 30m;          # matches MAX_UPLOAD_MB

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo chown -R www-data:www-data /srv/pb/data /srv/pb/media
sudo systemctl enable --now pb
```

**Docker** (short form):

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY dist ./dist
COPY public ./public
RUN mkdir -p data media
ENV NODE_ENV=production MEDIA_DIR=/app/media
VOLUME ["/app/media", "/app/data"]
EXPOSE 4000
CMD ["node", "server/scripts/start.js"]
```

Mount `/app/data` and `/app/media` so a redeploy keeps the installer answers and
the uploads.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Setup asks for the database although `DB_*` is set | The app cannot see those variables. Set them in the panel's environment or in `.env`; restart. |
| “The user … could not sign in” | The database user is missing or the password differs. Create the user in the panel, attach it to the database with all privileges. |
| “The database … does not exist” | Create it first, then add the user to it. |
| “The database … exists, but the user … is not allowed to open it” | Grant the user access to that database (all privileges). |
| “Nothing accepted a connection at localhost:3306” | The host/port is wrong for this server. Most panels use `localhost`; on some plans it is a socket or a remote host name. |
| The setup screen says “This site already has a database configured” | `data/install.json`, `.env` or the panel already has credentials. Use them, or remove them deliberately instead of re-running the installer. |
| The site shows “The database is not answering” | The saved credentials stopped working (password changed, DB removed, server down). Fix them in the panel; with `data/install.json`, edit or remove it and reload. |
| `/api/health` → 503 `Database unreachable` | Same as above; check the user is attached to the database. |
| `/api/health` says `"database": "memory"` | `DB_DRIVER=memory` is set. Production must use `mysql`. |
| Sign-in “works” then every save says *Sign in to continue* | Cookies are not surviving. Check `TRUST_PROXY=true`, that the site is on HTTPS, and `COOKIE_SECURE=auto` (or `false` while testing over plain HTTP). |
| Uploads fail with 413 | Raise `MAX_UPLOAD_MB`; nginx also needs `client_max_body_size`. Passenger limits the body too — set it in the panel if offered. |
| A backup restore says the upload “has expired” | The setup screen parks the zip for an hour. Upload it again. |
| A restore stops with “already holds N account(s)” | The database is not empty. Tick **Replace what is in that database** — after checking it is the right database. |
| The restore screen is not offered | A database is already configured. Deploy without `data/`, or set `ALLOW_SITE_RESTORE=1`. |
| `backup/` is empty after a day | `BACKUP_ENABLED=false`, or the process is restarted so often it never reaches `BACKUP_HOUR`. Run `npm run backup:now` from cron instead. |
| A backup fails with `EACCES` | The app cannot write `backup/`. Create it and make it writable by the app's user (`chmod 700`, owned by that user). |
| Uploads succeed but files 404 | `MEDIA_DIR` must be writable (`chmod 775 media`) and be the folder the server reads. |
| The Himalayan photo / shipped art 404s | The file is missing from `public/media/` (or `dist/media/` on an old build). Rebuild or upload the folder again. |
| Setup succeeds but the owner screen says “Finish the database step first” | `data/install.json` could not be written. `chmod 775 data` and retry. |
| App restart loses accounts/content | Expected only with `DB_DRIVER=memory`. Production must use `mysql`. |
| Website files missing | Restore the included `dist/` folder and restart; there is no build command. |
