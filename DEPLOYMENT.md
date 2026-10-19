# Deploying PB Travel Diaries

One Node.js process serves the built site, the API and the uploaded media, and
stores everything else in MariaDB. Any host that can run a long-lived Node
process and gives you a MySQL/MariaDB database will run it — a shared panel
(Passenger, Plesk, DirectAdmin), a managed Node host, Docker, or a VPS.

```
browser ──► Node (server/index.js) ──► MariaDB   content, accounts, sessions, history, media index
                  │
                  ├──► dist/    the built site (`npm run build`)
                  ├──► media/   uploaded files (back this up)
                  ├──► public/  art that ships with the code, served at /media
                  └──► data/    install.json — the installer's answers (back this up)
```

**You do not import any SQL file.** The first time you open the site, a setup
screen asks for the database details and the owner account, then creates every
table itself.

> **Vite is a build tool, not a runtime.** It compiles the React/TypeScript
> source into `dist/` on your computer (or once on the server). The deployed app
> is plain Node.js and `dist/`; nothing from Vite is installed or executed when
> visitors use the site.

---

## Which command runs what

| Where | Command | What happens |
| --- | --- | --- |
| Your computer, editing | `npm run dev` | Express on :4000 + Vite on :5173 with hot reload — development only |
| Your computer, checking a deploy | `npm run prod` | Builds `dist/`, then serves it on :4000 exactly as the host will |
| Your computer, making an upload | `npm run package` | Builds and writes `release/pb-travel-diaries/` — the runtime-only folder |
| The server | `node server/scripts/start.js` | The app itself; your process manager keeps it alive |
| The server, after a code change | `npm run build` + restart | Rebuild `dist/`; no Vite process is left running |

`npm run dev` is **not** a hosting command: it runs Vite's development server,
which is not deployed.

The copy-paste walkthrough is in **[RUNNING.md](RUNNING.md)**. This file covers
the parts that depend on the host.

---

## 1. What the host must provide

| Requirement | Why | Where it usually lives |
| --- | --- | --- |
| Node.js **20.19+** or **22.12+** | Vite 7 needs it *to build*; the runtime works on the same versions | Panel's Node.js selector, or `node -v` over SSH |
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

### Option A — upload the runtime folder (no build tools on the server)

On your computer:

```bash
npm ci
npm run package     # builds dist/ and writes release/pb-travel-diaries/
```

Upload **`release/pb-travel-diaries/`** to the server (ZIP it in File Manager, or
`scp -r`). It contains `server/`, `dist/`, `public/`, the package files and a
`START-HERE.txt`. On the server:

```bash
cd pb-travel-diaries
npm ci --omit=dev   # only express, mysql2, bcryptjs, dotenv, multer, cookie-parser
mkdir -p data media
chmod 775 data media
```

This is the leanest route: the server installs ~9 MB of runtime packages and
never needs `src/`, Vite or TypeScript.

### Option B — clone the source and build on the server

```bash
cd ~
git clone <your-repository-url> pb-travel-diaries
cd pb-travel-diaries
npm ci              # build tools are needed here once
npm run build       # → dist/
npm prune --omit=dev
mkdir -p data media
chmod 775 data media
```

Build on the server only if it has enough memory for Vite; a small shared plan
may prefer Option A.

Either way: `dist/` is generated, `media/` holds uploads, `data/` holds the
installer's answers (including the database password). None of the three
belongs in git.

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
| cPanel (Passenger) | **Setup Node.js App** → Create Application: Node 20/22, Production, root = the app folder, startup file `server/scripts/start.js` |
| Plesk | **Node.js** → Application root, Application startup file `server/scripts/start.js`, then *Restart* |
| Docker | `CMD ["node", "server/scripts/start.js"]` |
| VPS / systemd | unit below |

The panel supplies `PORT` (sometimes a socket path) and keeps the process
alive. Do not set `PORT` yourself unless you are running it by hand.

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

Three things, together:

| What | Where | How |
| --- | --- | --- |
| Database | MariaDB | panel export / `mysqldump` |
| Uploads | `media/` | compress and download |
| Installer answers | `data/install.json` | include it with the uploads |

A nightly script for a VPS or any host with cron:

```bash
#!/bin/sh
# ~/backup-pb.sh — add with: crontab -e  →  15 2 * * * /bin/sh ~/backup-pb.sh
set -e
cd "$HOME/pb-travel-diaries"
mkdir -p "$HOME/pb-backups"
STAMP=$(date +%F)
mysqldump --single-transaction -u pb -p'THE_PASSWORD' pb_travel_diaries > "$HOME/pb-backups/db-$STAMP.sql"
tar -czf "$HOME/pb-backups/uploads-$STAMP.tar.gz" media data
find "$HOME/pb-backups" -mtime +14 -delete
```

Restoring is the pair: import the `.sql`, unpack `media/` and `data/`, restart
the app.

---

## 9. Updating

**Option A upload (no build tools on the server):**

1. On your computer: `git pull && npm ci && npm run package`.
2. Upload the new `release/pb-travel-diaries/` over the old files. Keep `data/`
   and `media/` — they are not part of the package.
3. On the server: `npm ci --omit=dev`, then restart the app.

**Option B build on the server:**

```bash
cd pb-travel-diaries
git pull
npm ci
npm run build
npm prune --omit=dev
```

Then restart the process (panel button, or `systemctl restart pb`). A restart is
required: the server loads `dist/` at boot and applies any pending database
migration — `CREATE TABLE IF NOT EXISTS` plus the versioned changes — before
taking traffic. `data/` and `media/` are untouched.

### Upgrading from the `.env`-only version

A deployment that keeps its credentials in the environment keeps working:
`/api/setup/status` detects them, the setup screen is skipped, and the owner
signs in at `#/admin` as before. On the first boot the server adds the `reader`
role to the `users` table and writes the schema version. Nothing to import.

---

## 10. Process manager examples

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
| Uploads succeed but files 404 | `MEDIA_DIR` must be writable (`chmod 775 media`) and be the folder the server reads. |
| The Himalayan photo / shipped art 404s | The file is missing from `public/media/` (or `dist/media/` on an old build). Rebuild or upload the folder again. |
| Setup succeeds but the owner screen says “Finish the database step first” | `data/install.json` could not be written. `chmod 775 data` and retry. |
| App restart loses accounts/content | Expected only with `DB_DRIVER=memory`. Production must use `mysql`. |
| Build fails on the server | Node is too old (Vite 7 needs 20.19+ or 22.12+), or the plan is short on memory. Build elsewhere with `npm run package` and upload that folder. |
