# Run it, step by step

Two things can run: the **development server** (Vite with hot reload, for
editing) and the **production server** (one Node process serving the built
site, for the live domain). They are started by different commands, and only
the production one belongs on a server.

| Where | Mode | Command | Open |
| --- | --- | --- | --- |
| Your computer | Development | `npm run dev` | <http://localhost:5173> |
| Your computer | Production, exactly like hosting | `npm run prod` | <http://localhost:4000> |
| Your computer | Build an upload folder | `npm run package` | `release/pb-travel-diaries/` |
| The server | Production | `node server/scripts/start.js` | your domain |
| The server (optional) | Development over SSH | `npm run dev` | <http://localhost:5173> |

> **The short version:** Vite is a build tool. On the server, the process
> manager runs `server/scripts/start.js`, which serves `dist/`, the API and
> `/media`. You never run `npm run dev` on a public site.

> **Why Vite at all?** The frontend is React + TypeScript + Tailwind; a browser
> cannot run those files directly, so something has to compile them into
> `dist/`. Vite does that on your computer. The output is plain HTML/JS/CSS, and
> the deployed app is plain Node.js — see §2.4. If you want a server that never
> has any build tooling installed, that is exactly what `npm run package`
> produces.

> **Windows PowerShell:** the `VAR=value command` form in this guide becomes
> `$env:VAR="value"; command`. For example:
> `$env:DB_DRIVER="memory"; npm run dev` or
> `$env:API_PORT="4100"; npm run dev`.

---

## 1. Development on your computer

Use this when you are changing the site and want instant reload.

### 1.1 Install the tools

1. Install **Node.js 20.19+ or 22.12+** (Vite 7 does not support Node 18).
2. Check it:

   ```bash
   node -v      # v20.19.x or v22.x
   npm -v
   ```

### 1.2 Get the code and the packages

```bash
cd ~/pb-travel-diaries      # wherever you cloned or unzipped it
npm ci                      # installs app + build tools
```

### 1.3 Choose a database

**Option A — MySQL/MariaDB (like the real site).** Create an empty database and
a user attached to it first (see §3.1), then copy the example file and fill in
the details:

```bash
cp .env.example .env
```

Open `.env` and uncomment/set `DB_HOST`, `DB_NAME`, `DB_USER`,
`DB_PASSWORD`. On a local MariaDB the host is usually `127.0.0.1`.

**Option B — in-memory, no database at all.** Nothing to install; the site
forgets everything when it stops:

```bash
DB_DRIVER=memory npm run dev
```

### 1.4 Start it

```bash
npm run dev
```

You should see:

```
[dev] API on :4000 (restarts on server file changes)
[dev] Vite on :5173 with hot reload
[db] connected (memory), schema v0
[server] development listening on http://localhost:4000
  VITE v7.3.2  ready
  ➜  Local:   http://localhost:5173/
```

Open **<http://localhost:5173>**. The first visit shows the setup screen
(website title + database, then the owner account). After that:

- journal — <http://localhost:5173/>
- dashboard — <http://localhost:5173/#/admin>
- members / sign-up — <http://localhost:5173/#/members>

Edit a file under `src/` and the page updates by itself. Editing under
`server/` restarts the API automatically.

Stop everything with **Ctrl+C** — one press stops both halves.

### 1.5 If something does not start

| Symptom | Fix |
| --- | --- |
| `EADDRINUSE :5173` | Another dev server is running. `pkill -f "server/scripts/dev.js"` then retry. |
| `Vite is not installed` | Run `npm ci` first. |
| Port 4000 already in use | `npm run dev` reuses any API already answering on :4000; if something else owns it, `API_PORT=4100 npm run dev`. |
| Page loads but the API is missing | Make sure you used `npm run dev` (both halves), not `npm run preview`. |
| `The database is not answering` | Check `.env`, or use `DB_DRIVER=memory npm run dev`. |

---

## 2. Production on your computer

Use this before deploying, to see the site exactly as the server will serve it.

### 2.1 Build and run

```bash
npm run prod
```

That is `npm run build` followed by `node server/scripts/start.js`. It writes
`dist/` and then starts one Node process:

```
[server] production listening on http://localhost:4000
```

Open **<http://localhost:4000>**. There is no Vite here — this is the same
Express app the server runs.

### 2.2 Re-run without rebuilding

```bash
npm start
```

`npm start` serves the existing `dist/`. Use `npm run prod` whenever you have
changed frontend code.

### 2.3 Check it

```bash
curl -s http://localhost:4000/api/health
# {"ok":true,"database":"memory","time":"..."}

curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  http://localhost:4000/media/himalayan-450.png
# 200 image/png
```

Stop with **Ctrl+C**.

### 2.4 Make the folder you upload (`npm run package`)

```bash
npm run package
```

It builds `dist/` and writes **`release/pb-travel-diaries/`** containing only
what runs:

```
server/       the Node app (no tests)
dist/         the built site
public/       art served at /media
package.json  package-lock.json  .env.example  START-HERE.txt
README.md     RUNNING.md         DEPLOYMENT.md
```

`src/`, `index.html`, `vite.config.ts`, `tsconfig.json` and every Vite/React
package stay behind. On the server the install is ~9 MB of runtime packages:

```bash
npm ci --omit=dev
```

That is the "just Node.js" deployment: nothing to build, nothing from Vite.

---

## 3. Production on a server

Any host that runs a long-lived Node process and gives you MySQL/MariaDB works.
The steps below are the same on a panel, a managed Node host or a VPS; §3.5
shows where each field lives on the common panels.

### 3.1 Create the database and user first

In your hosting panel (or with your database administrator):

1. **Create an empty database** — note its exact name. Panels often prefix it
   (`pbuser_travel`).
2. **Create a database user** with a strong password — note the exact username
   (also prefixed).
3. **Add the user to the database** with **all privileges**.

| Host | Where |
| --- | --- |
| cPanel | MySQL® Databases → Create New Database → Add New User → Add User To Database → ALL PRIVILEGES |
| Plesk | Databases → Add Database (the same screen creates and attaches the user) |
| DirectAdmin | MySQL Management → Create Database, then grant the user |
| VPS / local | `CREATE DATABASE …; CREATE USER …; GRANT ALL PRIVILEGES ON db.* TO user;` |

The setup screen cannot create database accounts — no public web form should.
It *can* create the tables, and it tells you precisely when the database or the
user is missing (see §5).

### 3.2 Put the code on the server

**Recommended: upload the runtime folder.** On your computer run
`npm run package`, then copy `release/pb-travel-diaries/` to the server (ZIP in
File Manager, SFTP, `scp -r`). On the server:

```bash
cd pb-travel-diaries
npm ci --omit=dev
```

**Or clone and build on the server** (needs the build tools and enough memory):

```bash
cd ~
git clone <your-repository-url> pb-travel-diaries
cd pb-travel-diaries
npm ci
npm run build
npm prune --omit=dev
```

### 3.3 Make the writable folders

```bash
cd pb-travel-diaries
mkdir -p data media
chmod 775 data media
```

- `data/` holds `install.json` — the database password the setup screen saves.
- `media/` holds uploaded photos.
- `dist/` is the built site.

### 3.4 Point the process manager at the app

The startup command is always:

```bash
node server/scripts/start.js
```

It sets `NODE_ENV=production` when the environment did not, then runs
`server/index.js`. The panel supplies `PORT` and keeps the process alive —
never set `PORT` yourself under a panel.

### 3.5 Where those fields live

| Host | What to open | What to fill in |
| --- | --- | --- |
| cPanel | **Setup Node.js App** → Create Application | Node 20/22 · Production · Application root = app folder · Startup file `server/scripts/start.js` |
| Plesk | **Node.js** | Application root, Application startup file `server/scripts/start.js`, then *Restart* |
| DirectAdmin | **Node.js Selector** | App root, startup file, then *Restart* |
| Docker | `Dockerfile` | `CMD ["node", "server/scripts/start.js"]` |
| VPS | systemd unit | `ExecStart=/usr/bin/node server/scripts/start.js` |

Environment variables are only needed to override defaults. With the setup
screen you can skip every `DB_*`:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `MEDIA_DIR` | `./media` |
| `DIST_DIR` | `./dist` |
| `TRUST_PROXY` | `true` |
| `COOKIE_SECURE` | `auto` |

Then restart the app (the first request afterwards can take a few seconds while
it starts).

Check it is alive:

```bash
curl -s https://yourdomain.com/api/health
```

- `{"ok":true,"database":"mysql",…}` — database connected, ready.
- `{"ok":false,"error":"Database unreachable."}` — expected before setup, or a
  wrong environment value.
- `"database":"memory"` — remove `DB_DRIVER=memory`.

### 3.6 Run the one-time setup

Open the site. The setup screen appears instead of the journal:

1. **Website title + database details** — the values from §3.1. Press
   **Test connection**:
   - *“Connected to MariaDB … — the database exists and the user can open it.”*
     → press **Create tables & continue**.
   - *“The database … does not exist yet. Create it …, add the user … with all
     privileges …”* → go back to the panel, create it, then test again.
   - *“The user … could not sign in …”* → create or correct the database user.
   Every table, the schema version and the site settings are created; no SQL
   import.
2. **Super admin** — the owner username and password. One time only.
3. The site opens signed in as the owner. Publish from the dashboard, then
   share the URL.

Turn on HTTPS before sharing the address (panel's AutoSSL / Let's Encrypt): the
session cookie is marked `Secure` only over HTTPS. See
[DEPLOYMENT.md](DEPLOYMENT.md#6-https).

### 3.7 Updating the live site

**Upload route:**

1. On your computer: `git pull && npm ci && npm run package`.
2. Upload the new `release/pb-travel-diaries/` over the old files — keep `data/`
   and `media/`.
3. On the server: `npm ci --omit=dev`, then restart.

**Build-on-server route:**

```bash
cd pb-travel-diaries
git pull
npm ci
npm run build
npm prune --omit=dev
```

Then restart. A restart is required: the server loads `dist/` at boot and applies
any pending database migration. `data/` and `media/` are untouched.

> Do **not** run `npm run prod` on a server. It builds and then starts a second
> process; the process manager already runs the app.

### 3.8 If the deployment misbehaves

| Symptom | Cause and fix |
| --- | --- |
| `503` “The site has not been built yet” | `dist/` is missing → build, or upload the package folder again. |
| The setup screen does not appear | A database is already configured (install file, environment or panel). Delete `data/install.json` or fix the variables. |
| `403 This site already has a database configured` | Same as above; the installer locks itself on purpose. |
| “The database … does not exist” during setup | Create it in the panel, add the user to it with all privileges, then test again. |
| “The user … could not sign in” | The database user is missing or its password differs. |
| “The database … is not allowed to open it” | Grant the user access to that database. |
| `/media/…` is 404 | The file is not in `media/` or `public/media/`; check the exact name. |
| `EACCES` on `data/` or `media/` | `chmod 775 data media` (and make sure the app user owns them). |
| Build fails on the server | Node too old (needs 20.19+/22.12+) or low memory. Build on your computer with `npm run package`. |
| Logs | The panel's log viewer, the process manager's journal, or `~/logs/`. |

---

## 4. Development mode *on the server* (optional)

You normally develop on your computer. If you need to run the dev server on the
server — for example to test against the real MariaDB — do it through an **SSH
tunnel**, never by exposing Vite's port.

### 4.1 Use a separate copy

Do not run the dev server in the live app's folder; it restarts the API and
writes to the same `dist/`. Clone beside it:

```bash
cd ~
git clone <your-repository-url> pb-dev
cd pb-dev
npm ci
cp .env.example .env      # point DB_* at a separate test database
```

Use a second database so experiments never touch the live content.

### 4.2 Open the tunnel from your computer

```bash
ssh -L 5173:127.0.0.1:5173 your_user@your_server
```

Leave that session open. Then, on the server:

```bash
cd ~/pb-dev
API_PORT=4100 npm run dev
```

`API_PORT=4100` keeps the dev API away from anything the live app is using;
Vite still proxies `/api` and `/media` to it. Open
**<http://localhost:5173>** on your computer — the tunnel forwards it.

Notes:

- Vite binds to `0.0.0.0`, but the tunnel means the port is not reachable from
  the internet.
- If the SSH session drops, the dev server stops. Use `tmux` or `screen` if
  available.
- Development mode puts exception messages in API error responses. That is why
  it stays behind the tunnel and never becomes the public app.
- To stop: Ctrl+C on the server (stops API and Vite), then exit SSH.

### 4.3 A staging site (production mode, separate database)

If you want a safe preview on the real host rather than hot reload:

1. Create a second app on a subdomain (for example `staging.example.com`),
   root `pb-dev`, startup file `server/scripts/start.js`.
2. Give it its own database and its own `data/` + `media/` folders.
3. Open the subdomain and run the setup screen there.

Do not copy `data/install.json` between staging and live unless you intend them
to share the database.

---

## 5. Command reference

| Command | Starts | Port | Use on a server? |
| --- | --- | --- | --- |
| `npm run dev` | API + Vite, hot reload | 4000 + 5173 | No — local or SSH tunnel |
| `npm run dev:web` | Vite only | 5173 | No |
| `npm run dev:api` | API only, restarts on changes | 4000 | No |
| `npm run build` | Builds `dist/` and exits | — | Yes (or build elsewhere) |
| `npm run package` | Builds, then writes the runtime-only upload folder | — | On your computer |
| `npm run prod` | Builds, then serves `dist/` | 4000 | No (the process manager already runs the app) |
| `npm start` | Serves the existing `dist/` in production mode | 4000 | The process manager does this for you |
| `npm run server` | Serves `dist/` with the current `NODE_ENV` | 4000 | No |
| `npm run db:init` | Applies the schema from `.env` | — | Optional |
| `npm run test:server` | API/installer tests | random | Optional |

The startup file the process manager uses is `server/scripts/start.js`. It sets
`NODE_ENV=production` when the environment did not, then imports
`server/index.js`.

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for host requirements, databases,
backups, HTTPS, migrations and process-manager examples, and
**[README.md](README.md)** for the code layout.
