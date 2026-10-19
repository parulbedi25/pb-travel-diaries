# Hosting PB Travel Diaries on Namecheap (Node.js + MariaDB)

This site is no longer static: it ships a small Node server that serves the built
app, the API, and the uploaded media, and it stores everything else in MariaDB.

```
browser ──► Express (server/index.js) ──► MariaDB   (content, accounts, sessions, history, media index)
                    │
                    ├──► dist/    the built site (`npm run build`)
                    └──► media/   uploaded files (back this up)
```

Two things must therefore be true on the host: **it can run Node.js**, and it
gives you a **MySQL/MariaDB database**. On Namecheap that means a cPanel plan
with *Setup Node.js App* (Stellar / Stellar Plus and above). If your plan does
not have that icon in cPanel, use the VPS route at the end — a shared plan
without Node cannot run this site.

---

## 1. Create the database

cPanel → **MySQL® Databases**

1. **Create New Database** — e.g. `travel`. cPanel prefixes it with your account
   name, giving something like `pbuser_travel`. Write down the full name.
2. **Add New User** — e.g. `pb`, with a strong password. Write down the full
   username (`pbuser_pb`) and the password.
3. **Add User To Database** → select the database → grant **ALL PRIVILEGES**.

> Shared hosting almost never lets you run `CREATE DATABASE` yourself, which is
> why this is done in cPanel first. The app only needs tables inside it.

## 2. Load the tables

**Option A — phpMyAdmin (no terminal needed)**

cPanel → **phpMyAdmin** → pick the database on the left → **Import** →
choose `server/schema.sql` from the project → **Go**.
Every statement is `CREATE TABLE IF NOT EXISTS`, so importing twice is harmless.

**Option B — from the project**

```bash
npm run db:init
```

It reads `.env`, creates the database if the account is allowed to, and applies
the same schema.

## 3. Upload the project

cPanel → **File Manager** (or SSH, if your plan includes it):

1. Upload the project as a ZIP into your home directory and extract it, so you
   have `~/pb-travel-diaries/` containing `server/`, `src/`, `package.json`.
2. Do **not** upload `node_modules/` — it is installed in step 5.

If you have SSH:

```bash
cd ~
git clone https://github.com/parulbedi25/pb-travel-diaries.git
cd pb-travel-diaries
```

## 4. Create `.env`

In `~/pb-travel-diaries/`, copy `.env.example` to `.env` and fill in the values
from step 1:

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
BCRYPT_ROUNDS=10

MEDIA_DIR=./media
DIST_DIR=./dist
```

`DB_SOCKET=/var/run/mysqld/mysqld.sock` is the fallback if `127.0.0.1` refuses
connections on your host.

> If the cPanel Node app lets you set environment variables, you can put these
> there instead — real environment variables win over `.env`.

## 5. Install and build

Use cPanel's terminal, or the **Run NPM Install** button in step 6, then build:

```bash
cd ~/pb-travel-diaries
npm ci              # dev dependencies are needed to build
npm run build       # → dist/
npm prune --omit=dev
```

`dist/` and `media/` must both exist. `dist/` is generated; `media/` is created
on first upload (keep it, it is your backup).

## 6. Register the Node app

cPanel → **Setup Node.js App** → **Create Application**

| Field | Value |
| --- | --- |
| Node.js version | **20** or **22** (not 18 — Vite 7 needs ≥ 20.19) |
| Application mode | Production |
| Application root | `pb-travel-diaries` |
| Application URL | your domain, e.g. `pbtraveldiaries.com` |
| Application startup file | `server/index.js` |

Then:

1. **Run NPM Install** (if you did not already in step 5).
2. **Restart** the application.
3. Open `https://yourdomain.com/api/health`. It should answer:

```json
{ "ok": true, "database": "mysql", "time": "…" }
```

If it says `"database": "memory"`, your `.env` is not being read — check that
`DB_DRIVER` is not set to `memory`.

> **Passenger supplies `PORT` itself**, sometimes as a socket path. The server
> reads `process.env.PORT` and listens on whatever it is given, so do not set
> `PORT` manually in the panel.

## 7. HTTPS

cPanel → **SSL/TLS Status** → **Run AutoSSL** (or install Let's Encrypt).
`COOKIE_SECURE=auto` marks the session cookie `Secure` as soon as requests
arrive over HTTPS, and `TRUST_PROXY=true` is what lets the app see that.

## 8. Create the owner account

Open `https://yourdomain.com/#/admin`.

The first visit offers **“Create the owner account”** instead of a sign-in —
there is nobody to sign in as yet. Choose a username and a password of at least
8 characters with a letter and a number. That account is the owner; further
accounts are added in **Settings → Accounts**, and every sign-up, sign-in,
sign-out and failed attempt appears in **Settings → Access history**.

## 9. Move an existing site in

If you edited the site in a browser while it still used browser storage, the
settings page shows **“Import this browser's site”**. Use it once per browser
that holds edits; after that the database is the only copy.

---

## Backups

Two things to back up, together:

| What | Where | How |
| --- | --- | --- |
| Database | MariaDB | cPanel → phpMyAdmin → **Export** → SQL, or a cron job |
| Uploads | `~/pb-travel-diaries/media/` | cPanel → File Manager → **Compress** → download |

A cron job that does both nightly:

```bash
#!/bin/sh
# ~/backup-pb.sh — add with: crontab -e  →  15 2 * * * /bin/sh ~/backup-pb.sh
set -e
cd "$HOME/pb-travel-diaries"
mkdir -p "$HOME/pb-backups"
STAMP=$(date +%F)
mysqldump --single-transaction -u pbuser_pb -p'THE_PASSWORD' pbuser_travel > "$HOME/pb-backups/db-$STAMP.sql"
tar -czf "$HOME/pb-backups/media-$STAMP.tar.gz" media
find "$HOME/pb-backups" -mtime +14 -delete
```

Restoring is the pair: import the `.sql` in phpMyAdmin, unpack the media archive
back into `media/`.

> Uploaded files are **not** in git, on purpose: they are content. `public/` is
> for assets that ship with the code; `media/` is everything uploaded from the
> dashboard.

## Updating the site

```bash
cd ~/pb-travel-diaries
git pull
npm ci
npm run build
npm prune --omit=dev
```

Then cPanel → Setup Node.js App → **Restart**. A restart is required: the server
loads the built `dist/` at boot.

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
cp .env.example .env      # then edit it
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
EnvironmentFile=/srv/pb/.env
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
sudo systemctl enable --now pb
sudo certbot --nginx -d pbtraveldiaries.com -d www.pbtraveldiaries.com
```

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `/api/health` → 503 `Database unreachable` | Wrong `.env` values, or the database user was not added to the database. Try `DB_SOCKET`. |
| `ER_ACCESS_DENIED_ERROR` | Username/password mismatch — cPanel prefixes both with your account name. |
| The site loads but shows built-in content | `GET /api/content` returns `null` because nothing has been published yet. Sign in and press **Save Changes**. |
| Sign-in “works” then every save says *Sign in to continue* | Cookies are not surviving. Check `TRUST_PROXY=true`, that the site is on HTTPS, and that `COOKIE_SECURE` is `auto` (or `false` while testing over plain HTTP). |
| Uploads fail with 413 | Raise `MAX_UPLOAD_MB`, and on nginx also `client_max_body_size`. Passenger limits the body too — set it in the panel if offered. |
| Uploads succeed but files 404 | `MEDIA_DIR` must be writable by the app user (`chmod 775 media`) and must be the same folder the server is reading. |
| App restart loses sessions | Expected only with `DB_DRIVER=memory`. Production must use `mysql`. |
| Build fails on the server | Node is too old. Vite 7 needs 20.19+ or 22.12+. |
