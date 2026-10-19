# Run it, step by step

Two things can run: the **development server** (Vite with hot reload, for
editing) and the **production server** (one Node process serving the built
site, for the live domain). They are started by different commands, and only
the production one belongs on Namecheap.

| Where | Mode | Command | Open |
| --- | --- | --- | --- |
| Your computer | Development | `npm run dev` | <http://localhost:5173> |
| Your computer | Production, exactly like hosting | `npm run prod` | <http://localhost:4000> |
| Namecheap cPanel | Production (Passenger) | *startup file* `server/scripts/start.js` | your domain |
| Namecheap + SSH | Development (private tunnel) | `npm run dev` over SSH | <http://localhost:5173> |

> **The short version:** Vite is a build tool. On the server, Passenger runs
> `server/scripts/start.js`, which serves `dist/`, the API and `/media`. You
> never run `npm run dev` on a public cPanel app.

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

**Option A — MariaDB (like the real site).** Copy the example file and fill in
your database details:

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

## 2. Production mode on your computer

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
Express app Passenger runs.

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

---

## 3. Production on the Namecheap server

This is the real deployment. It needs a cPanel plan with **Setup Node.js App**
(Stellar / Stellar Plus and above) and one MySQL/MariaDB database.

### 3.1 Create the database first

cPanel → **MySQL® Databases**:

1. **Create New Database** — e.g. `travel`; cPanel prefixes it →
   `pbuser_travel`. Write the full name down.
2. **Add New User** — e.g. `pb` with a strong password; the full username is
   `pbuser_pb`.
3. **Add User To Database** → pick the database → **ALL PRIVILEGES**.

The app creates the tables; you only create the empty database.

### 3.2 Put the code on the server

Upload a ZIP in **File Manager** and extract it so you have
`~/pb-travel-diaries/` with `server/`, `src/`, `public/`, `package.json`.
Do **not** upload `node_modules/`.

SSH is faster if your plan has it:

```bash
cd ~
git clone https://github.com/parulbedi25/pb-travel-diaries.git
cd pb-travel-diaries
```

### 3.3 Build and prune

**On the server** (cPanel Terminal or SSH):

```bash
cd ~/pb-travel-diaries
npm ci               # build tools are needed here
npm run build        # → dist/
npm prune --omit=dev # drop Vite and the other build-only packages
```

**Or build on your computer** if the server is slow, then upload only what
runs: `server/`, `dist/`, `package.json`, `package-lock.json` (and `public/`
if you want the shipped art available before a build). The steps below are the
same.

### 3.4 Make the writable folders

```bash
cd ~/pb-travel-diaries
mkdir -p data media
chmod 775 data media
```

- `data/` holds `install.json` — the database password the setup screen saves.
- `media/` holds uploaded photos.
- `dist/` is the built site.

### 3.5 Register the Node app

cPanel → **Setup Node.js App** → **Create Application**:

| Field | Value |
| --- | --- |
| Node.js version | **20** or **22** |
| Application mode | **Production** |
| Application root | `pb-travel-diaries` |
| Application URL | your domain |
| Application startup file | `server/scripts/start.js` |

Then:

1. **Run NPM Install** only if you did not already run `npm ci` in 3.3 — the
   button installs into the same `node_modules/`.
2. Add environment variables only if you want to override defaults. With the
   setup screen you can skip all of `DB_*`:

   | Variable | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `MEDIA_DIR` | `./media` |
   | `DIST_DIR` | `./dist` |
   | `TRUST_PROXY` | `true` |
   | `COOKIE_SECURE` | `auto` |

   Do **not** set `PORT` — Passenger supplies it.
3. Press **Restart**. The first request afterwards can take a few seconds
   while Passenger starts the app.

Check the app is alive:

```bash
curl -s https://yourdomain.com/api/health
```

- `{"ok":true,"database":"mysql",...}` — database connected, ready.
- `{"ok":false,"error":"Database unreachable."}` — expected before setup, or a
  wrong `.env`/panel value.
- `"database":"memory"` — remove `DB_DRIVER=memory` from the panel.

### 3.6 Run the one-time setup

Open `https://yourdomain.com/`. The setup screen appears instead of the journal:

1. **Website title + MariaDB details** — the values from 3.1. Press
   **Test connection**, then **Create tables & continue**. Every table, the
   schema version and the site settings are created; no SQL import.
2. **Super admin** — the owner username and password. One time only.
3. The site opens signed in as the owner. Publish from the dashboard, then
   share the URL.

Turn on HTTPS (cPanel → **SSL/TLS Status** → **Run AutoSSL**) before sharing
the address: the session cookie is only marked `Secure` over HTTPS, and
`COOKIE_SECURE=auto` relies on that. See [DEPLOYMENT.md](DEPLOYMENT.md#7-https).

The setup endpoints lock after step 1. If `data/` is not writable, the error
tells you: `chmod 775 data` and retry.

### 3.7 Updating the live site

```bash
cd ~/pb-travel-diaries
git pull              # or upload the changed files
npm ci                # only if package.json changed
npm run build
npm prune --omit=dev
```

Then cPanel → **Setup Node.js App** → **Restart**. A restart is required:
Passenger keeps the old process, and the server applies any pending database
migration at boot. `data/` and `media/` are untouched.

> Do **not** run `npm run prod` on cPanel. It builds and then starts a second
> server on port 4000, which Passenger does not need. On the server the split
> is: `npm run build`, then **Restart**.

### 3.8 If the deployment misbehaves

| Symptom | Cause and fix |
| --- | --- |
| `503` “The site has not been built yet” | `dist/` is missing → `npm run build`, restart. |
| `503` “The database is not answering” | Wrong `DB_*` in `.env`/panel, or MariaDB down → fix, restart. |
| Setup screen does not appear | A database is already configured (install file, `.env` or panel). Delete `data/install.json` or fix `.env`. |
| `403 This site already has a database configured` | Same as above; the installer locks itself on purpose. |
| `/media/…` is 404 | The file is not in `media/` or `public/media/`; check the exact name. |
| `EACCES` on `data/` or `media/` | `chmod 775 data media` (and make sure the app user owns them). |
| Logs | cPanel → Setup Node.js App → the app's log, or `~/logs/`. |

---

## 4. Development mode *on the server* (optional)

You normally develop on your computer. If you need to run the dev server on
the hosting account — for example to test against the real MariaDB — do it
through an **SSH tunnel**, never by exposing Vite's port.

### 4.1 Use a separate copy

Do not run the dev server in the live app's folder; it restarts the API and
writes to the same `dist/`. Clone beside it:

```bash
cd ~
git clone https://github.com/parulbedi25/pb-travel-diaries.git pb-dev
cd pb-dev
npm ci
cp .env.example .env      # point DB_* at a separate test database
```

Use a second database (cPanel → MySQL Databases) so experiments never touch
the live content.

### 4.2 Open the tunnel from your computer

```bash
ssh -L 5173:127.0.0.1:5173 your_cpanel_user@yourdomain.com
```

Leave that session open. Then, on the server:

```bash
cd ~/pb-dev
API_PORT=4100 npm run dev
```

`API_PORT=4100` keeps the dev API away from anything Passenger is using; Vite
still proxies `/api` and `/media` to it. Open
**<http://localhost:5173>** on your computer — the tunnel forwards it.

Notes:

- Vite binds to `0.0.0.0` by default, but the SSH tunnel means the port is not
  reachable from the internet.
- If the SSH session drops, the dev server stops. Use `tmux` or `screen` if
  your plan has them.
- Development mode puts exception messages in API error responses. That is why
  it stays behind the tunnel and never becomes the public app.
- To stop: Ctrl+C in the server terminal (stops API and Vite), then exit SSH.

### 4.3 A staging site (production mode, separate database)

If what you want is a safe preview on the real host rather than hot reload:

1. cPanel → **Setup Node.js App** → create a second application on
   `staging.yourdomain.com`, root `pb-dev`, startup file
   `server/scripts/start.js`.
2. Give it its own database and its own `data/` + `media/` folders.
3. Open the subdomain and run the setup screen there.

Do not copy `data/install.json` between staging and live unless you intend
them to share the database.

---

## 5. Command reference

| Command | Starts | Port | Use on cPanel? |
| --- | --- | --- | --- |
| `npm run dev` | API + Vite, hot reload | 4000 + 5173 | No — local or SSH tunnel |
| `npm run dev:web` | Vite only | 5173 | No |
| `npm run dev:api` | API only, restarts on changes | 4000 | No |
| `npm run build` | Builds `dist/` and exits | — | Yes |
| `npm run prod` | Builds, then serves `dist/` | 4000 | No (Passenger already runs the app) |
| `npm start` | Serves the existing `dist/` in production mode | 4000 | Passenger does this for you |
| `npm run server` | Serves `dist/` with the current `NODE_ENV` | 4000 | No |
| `npm run db:init` | Applies the schema from `.env` | — | Optional |
| `npm run test:server` | 34 API/installer tests | random | Optional |

The startup file Passenger uses is `server/scripts/start.js`. It sets
`NODE_ENV=production` when the panel did not, then imports `server/index.js`.

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for cPanel specifics (databases, backups,
HTTPS, migrations) and **[README.md](README.md)** for the code layout.
