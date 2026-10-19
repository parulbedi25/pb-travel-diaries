# Hosting PB Travel Diaries on Namecheap (Node.js + MariaDB)

The site ships a small Node server that serves the built app, the API and the
uploaded media, and stores everything else in MariaDB.

```
browser ──► Express (server/index.js) ──► MariaDB   (content, accounts, sessions, history, media index)
                    │
                    ├──► dist/    the built site (`npm run build`)
                    ├──► media/   uploaded files (back this up)
                    └──► data/    install.json — the installer's answers (back this up)
```

Two things must be true on the host: **it can run Node.js**, and it gives you a
**MySQL/MariaDB database**. On Namecheap that means a cPanel plan with *Setup
Node.js App* (Stellar / Stellar Plus and above). If your plan does not have that
icon in cPanel, use the VPS route at the end.

**You do not import any SQL file.** The first time you open the site, a setup
screen asks for the database details and the owner account, then creates every
table itself.

### Which command runs what

| Where | Command | What happens |
| --- | --- | --- |
| Your computer, editing | `npm run dev` | Express on :4000 and Vite on :5173 with hot reload — development only |
| Your computer, before deploying | `npm run prod` | Builds `dist/`, then serves it on :4000 exactly as cPanel will |
| cPanel / Passenger | *startup file* `server/scripts/start.js` | The same Node server; Passenger starts it and keeps it alive |

`npm run dev` is **not** the hosting command: it runs Vite's development server,
which is not deployed. On cPanel, Passenger starts the Node app; you rebuild
`dist/` and press **Restart** after a code change (step 10).

---

## 1. Create the database in cPanel

cPanel → **MySQL® Databases**

1. **Create New Database** — e.g. `travel`. cPanel prefixes it with your account
   name, giving something like `pbuser_travel`. Write down the full name.
2. **Add New User** — e.g. `pb`, with a strong password. Write down the full
   username (`pbuser_pb`) and the password.
3. **Add User To Database** → select the database → grant **ALL PRIVILEGES**.

That is all the database work you need. The setup screen creates the tables.
(Shared hosting almost never lets an account run `CREATE DATABASE`, which is
why this step stays in cPanel.)

## 2. Upload the project

cPanel → **File Manager** (or SSH, if your plan includes it):

1. Upload the project as a ZIP into your home directory and extract it, so you
   have `~/pb-travel-diaries/` containing `server/`, `src/`, `package.json`.
2. Do **not** upload `node_modules/` — it is installed in step 4.

If you have SSH:

```bash
cd ~
git clone https://github.com/parulbedi25/pb-travel-diaries.git
cd pb-travel-diaries
```

## 3. `.env` is optional

You can skip this file entirely and type the database details into the setup
screen in step 6. The installer saves them to `data/install.json` (permissions
`0600`) so they survive a restart.

If you prefer the command line, or your hosting panel sets environment
variables, copy `.env.example` to `.env` and fill in the values:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=pbuser_pb
DB_PASSWORD=the-password-from-cpanel
DB_NAME=pbuser_travel

NODE_ENV=production
SESSION_DAYS=7
COOKIE_SECURE=auto
TRUST_PROXY=true

MEDIA_DIR=./media
DIST_DIR=./dist
```

**Precedence:** real environment variables (hosting panel) win over `.env`,
which wins over `data/install.json`. Pick one route and stay with it.

If a `.env`/panel already supplies `DB_*`, the setup screen skips the database
step and comes straight to the owner account. If those credentials do not work,
the site says so instead of letting you overwrite them from the browser.

## 4. Install and build

Use cPanel's terminal, or the **Run NPM Install** button in step 5, then build:

```bash
cd ~/pb-travel-diaries
npm ci              # dev dependencies are needed to build
npm run build       # → dist/
npm prune --omit=dev
```

That pair of commands is all a deploy needs: `npm run build` writes `dist/`,
and `npm prune --omit=dev` drops Vite and the other build-only packages. If you
prefer one command, `npm run prod` does `npm run build` and then starts the
server — useful to check the deployed behaviour on your own machine.

The app writes to two folders, so they must be writable by the app:

```bash
mkdir -p data media
chmod 775 data media
```

`dist/` is generated; `media/` holds uploads; `data/` holds the installer's
answers (including the database password). None of the three belongs in git.

### Optional: build on your computer and upload only what runs

Shared hosting can be slow to build, and the runtime never needs `src/`, Vite
or TypeScript. If you would rather not build on cPanel:

```bash
# on your computer, in the project folder
npm ci
npm run build
```

Upload these to `~/pb-travel-diaries/` (File Manager → ZIP):

```
server/            the Node app
dist/              the built site (includes public/media/)
package.json
package-lock.json
```

Then create the writable folders (below) and, in *Setup Node.js App*, press
**Run NPM Install** (or run `npm ci --omit=dev` from the terminal). The startup
file, database setup and everything else are unchanged.

`dist/` is self-contained: the JavaScript, CSS, fonts and shipped art are
inside it, so the browser never asks for `src/` or `public/`. `npm run build`
still needs them, which is why they stay in git for the next update.

## 5. Register the Node app

cPanel → **Setup Node.js App** → **Create Application**

| Field | Value |
| --- | --- |
| Node.js version | **20** or **22** (not 18 — Vite 7 needs ≥ 20.19) |
| Application mode | Production |
| Application root | `pb-travel-diaries` |
| Application URL | your domain, e.g. `pbtraveldiaries.com` |
| Application startup file | `server/scripts/start.js` |

Then **Run NPM Install** (if not already done), **Restart**, and open
`https://yourdomain.com/api/health`. It should answer:

```json
{ "ok": true, "database": "mysql", "time": "…" }
```

Before setup, a different answer is expected and fine:

```json
{ "ok": false, "error": "Database unreachable." }
```

If it says `"database": "memory"`, `DB_DRIVER=memory` is set somewhere — remove
it. Production must use `mysql`.

> **Passenger supplies `PORT` itself**, sometimes as a socket path. The server
> reads `process.env.PORT`, so do not set `PORT` manually in the panel.

`server/scripts/start.js` is a two-line wrapper: it sets `NODE_ENV=production`
(so error responses never include internals) and then runs `server/index.js`.
Using `server/index.js` as the startup file works too, as long as
`NODE_ENV=production` is set in the panel's environment variables or `.env`.

## 6. Run the one-time setup

Open `https://yourdomain.com/`.

1. **Step 1 — Database.** Enter the website title and the four database values
   from step 1. “Test connection” checks them without changing anything. Then
   **Create tables & continue**: the app creates every table, the schema-version
   row and the deployment settings. There is no SQL file to import.
2. **Step 2 — Super admin.** Choose the owner's username, password and
   (optionally) email. This account can never be deleted and is the only one the
   installer creates.
3. The site opens signed in as the owner.

If the connection fails, the message tells you what to fix — for example
“MariaDB rejected that username or password”, “The database … does not exist”,
or “Nothing accepted a connection at localhost:3306”.

Once step 1 succeeds the setup endpoints lock themselves: a visitor can no
longer repoint the site at another database. Complete the setup immediately
after the first deploy, before sharing the URL.

The app opens the setup screen automatically on every address — including
`#/setup` — until the install is complete.

## 7. HTTPS

cPanel → **SSL/TLS Status** → **Run AutoSSL** (or install Let's Encrypt).
`COOKIE_SECURE=auto` marks the session cookie `Secure` as soon as requests
arrive over HTTPS, and `TRUST_PROXY=true` is what lets the app see that.

## 8. Accounts, readers and members-only sections

The owner signs in at `#/admin` (aliases `#/pb-control`, `#/login`).

- **Settings → Accounts** adds accounts. Choose **Admin** for somebody who edits
  the site, or **Reader** for somebody who may only read it.
- **Settings → Site & sign-up** sets the website title and whether strangers may
  create accounts from the public sign-up page (`#/members`).
- Public sign-up always creates a **reader**. Readers can sign in, unlock the
  members-only sections and nothing else — no publishing, no uploads, no account
  management. The API enforces this; hiding the buttons is not the protection.
- **Sections** shows a **Public / Members** switch on every section. “Members”
  means visitors see a locked card with the section's name, while signed-in
  accounts see the real content. The server strips the content from the
  anonymous response, so it is not sitting in the page source.
- Every sign-up, sign-in, sign-out, failed attempt, password change and account
  creation is stored in `auth_events` with the address and browser.

## 9. Backups

Three things, together:

| What | Where | How |
| --- | --- | --- |
| Database | MariaDB | cPanel → phpMyAdmin → **Export** → SQL, or the cron job below |
| Uploads | `~/pb-travel-diaries/media/` | File Manager → **Compress** → download |
| Installer answers | `~/pb-travel-diaries/data/install.json` | include it in the media tar, or copy it separately |

A cron job that does all of it nightly:

```bash
#!/bin/sh
# ~/backup-pb.sh — add with: crontab -e  →  15 2 * * * /bin/sh ~/backup-pb.sh
set -e
cd "$HOME/pb-travel-diaries"
mkdir -p "$HOME/pb-backups"
STAMP=$(date +%F)
mysqldump --single-transaction -u pbuser_pb -p'THE_PASSWORD' pbuser_travel > "$HOME/pb-backups/db-$STAMP.sql"
tar -czf "$HOME/pb-backups/uploads-$STAMP.tar.gz" media data
find "$HOME/pb-backups" -mtime +14 -delete
```

Restoring is the pair: import the `.sql`, unpack `media/` and `data/`, restart
the app.

> Uploaded files are **not** in git, on purpose: they are content. `public/` is
> for assets that ship with the code; `media/` is everything uploaded from the
> dashboard.

## 10. Updating the site

```bash
cd ~/pb-travel-diaries
git pull
npm ci
npm run build
npm prune --omit=dev
```

Then cPanel → Setup Node.js App → **Restart**. A restart is required: the server
loads the built `dist/` at boot, and applies any pending database migration
(`CREATE TABLE IF NOT EXISTS` plus the versioned changes) before taking traffic.
`data/` and `media/` are untouched.

---

## Already running the previous version?

A deployment that keeps its database credentials in `.env` keeps working:
`/api/setup/status` detects the environment settings, the setup screen is
skipped, and the owner signs in at `#/admin` as before. On the first boot after
updating, the server adds the `reader` role to the `users` table and writes the
schema version. To do it manually instead:

```bash
npm run db:init
```

`server/schema.sql` is still generated for people who prefer phpMyAdmin
(`npm run schema:sql`), but importing it is never required.

---

## If your plan has no Node.js app

Then the site cannot run on that plan. Either upgrade to a cPanel plan with
*Setup Node.js App*, or use a VPS (Namecheap VPS or any other) and run it with
systemd behind nginx:

```bash
# On Ubuntu/Debian
sudo apt install nodejs npm mariadb-server nginx
sudo mysql -e "CREATE DATABASE pb_travel_diaries CHARACTER SET utf8mb4;"
sudo mysql -e "CREATE USER 'pb'@'localhost' IDENTIFIED BY 'change-me';"
sudo mysql -e "GRANT ALL ON pb_travel_diaries.* TO 'pb'@'localhost';"

git clone https://github.com/parulbedi25/pb-travel-diaries.git /srv/pb
cd /srv/pb && npm ci && npm run build && npm prune --omit=dev
mkdir -p data media
```

Start the app without a `.env` and use the setup screen for the database and
owner, or copy `.env.example` to `.env`, edit it, and run:

```bash
cp .env.example .env
npm run db:init
```

`/etc/systemd/system/pb.service`:

```ini
[Unit]
Description=PB Travel Diaries
After=network.target mariadb.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/pb
EnvironmentFile=-/srv/pb/.env
ExecStart=/usr/bin/node server/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

nginx site:

```nginx
server {
    listen 80;
    server_name pbtraveldiaries.com www.pbtraveldiaries.com;
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
sudo certbot --nginx -d pbtraveldiaries.com -d www.pbtraveldiaries.com
```

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Setup asks for the database although `.env` exists | The variables are not visible to the app process. Set them in the cPanel Node.js App panel or correct `.env`; restart. |
| `ER_ACCESS_DENIED_ERROR` / “rejected that username or password” | Username/password mismatch — cPanel prefixes both with your account name. Recheck the database user's password. |
| “The database … does not exist” | Create it in cPanel → MySQL® Databases; the app cannot create databases on shared hosting. |
| “The user … is not allowed to open …” | Add the user to the database and grant ALL PRIVILEGES. |
| “Nothing accepted a connection at localhost:3306” | On cPanel the host is usually `localhost`. If it still fails, ask the host for the MySQL socket and use the socket field. |
| The setup screen says “This site already has a database configured” | `data/install.json`, `.env` or the panel already has credentials. Use them (or remove them deliberately) instead of re-running the installer. |
| The site shows “The database is not answering” | The saved credentials stopped working (password changed, DB deleted, server down). Fix in cPanel; if using `data/install.json`, edit it or remove it and reload to re-run setup. |
| `/api/health` → 503 `Database unreachable` | Same as above. Check the database user is attached to the database. |
| `/api/health` says `"database": "memory"` | `DB_DRIVER=memory` is set. Production must use `mysql`. |
| Sign-in “works” then every save says *Sign in to continue* | Cookies are not surviving. Check `TRUST_PROXY=true`, that the site is on HTTPS, and that `COOKIE_SECURE` is `auto` (or `false` while testing over plain HTTP). |
| Uploads fail with 413 | Raise `MAX_UPLOAD_MB`, and on nginx also `client_max_body_size`. Passenger limits the body too — set it in the panel if offered. |
| Uploads succeed but files 404 | `MEDIA_DIR` must be writable (`chmod 775 media`) and must be the same folder the server reads. |
| Built-in art (the Himalayan photo) 404s | `dist/` is stale — run `npm run build` and restart. Uploads live in `media/`, built-in art is copied from `public/`. |
| Setup succeeds but the owner screen returns “Finish the database step first” | `data/install.json` could not be written (permissions). `chmod 775 data` and retry. |
| App restart loses accounts/content | Expected only with `DB_DRIVER=memory`. Production must use `mysql`. |
| Build fails on the server | Node is too old. Vite 7 needs 20.19+ or 22.12+. |
