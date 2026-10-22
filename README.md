# PB Travel Diaries

A Node.js/Express application serving a prebuilt travel website, dashboard,
API, and uploaded media. MySQL/MariaDB stores accounts, content and sessions.

**No Vite, frontend package installation, or build command is required.**
The repository includes the ready-to-serve website in `dist/`. `npm install`
installs server packages only. There are no development dependencies.

## Start locally

Use Node.js 22.12+ (recommended).

```bash
npm install
npm run hosting:check
npm start
```

Open http://localhost:4000 and complete database/owner setup. Create the MySQL
database and user first; the installer creates the tables.

For a disposable preview without MySQL (macOS/Linux):

```bash
DB_DRIVER=memory npm start
```

The memory database loses content/accounts when the process exits. Never use
it for production.

## Namecheap / cPanel

1. Upload the application outside `public_html`, including `dist/`, `public/`,
   `server/`, `app.cjs` and both package files. Do not upload `node_modules`.
2. Choose Node 22, Production mode, and a domain/subdomain root.
3. Click **Run NPM Install**.
4. Optionally run **hosting:check** using **Run JS Script**.
5. Set **Application startup file** to **`app.cjs`**; click **Start/Restart**.
6. Open the HTTPS domain and complete database/owner setup immediately.

No daemon, PM2, Vite, build step or terminal command is needed on cPanel.
Use cPanel Restart for Passenger, not a second `npm start` process.

See [NAMECHEAP.md](NAMECHEAP.md) and [RUNNING.md](RUNNING.md).

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` / `npm run prod` | Serve the included website and API |
| `npm run dev` | Node watch mode for server changes; no frontend hot reload |
| `npm run hosting:check` | Check deployed files/packages and writable folders, then exit |
| `npm run package` | Copy runtime files into `release/pb-travel-diaries/`; no compilation |
| `npm run test:server` | Run server regression tests |
| `npm run backup:now` | Create a backup now |
| `npm run db:status` | Inspect database schema status |
| `npm run db:migrate` | Apply pending versioned migrations |
| `npm run db:init` | Optional database/schema initialization |
| `npm run schema:sql` | Regenerate the reference SQL schema |

## Files and persistence

- `dist/`: checked-in minified browser HTML/JavaScript/CSS.
- Static images have one canonical copy in `public/`; the server preserves legacy URLs.
- `public/`: shipped static artwork.
- `server/`: plain JavaScript server, installer, backups and migrations.
- `app.cjs`: CommonJS startup bridge for Passenger.
- `src/`: preserved React/TypeScript frontend source for reference, **not used
  at runtime**. Changing it does not change the prebuilt site. The former
  frontend build toolchain is intentionally removed. Recompiling frontend code
  requires a separately supplied build workflow; this change does not rewrite
  the existing browser UI into vanilla JavaScript.
- `data/install.json`: installer settings, including database credentials.
- `media/`: user uploads; preserve during updates.
- `backup/`: backup archives; preserve and copy off-host.

Content changes through `/#/admin` are stored in MySQL and take effect without
rebuilding. Keep versioned migrations append-only. Never commit install files,
credentials, uploaded media or database backups.

[DEPLOYMENT.md](DEPLOYMENT.md) covers environment variables, access controls,
backups and restoring an installation.

## Optimization notes

The HTML bundle is already minified. The server negotiates gzip for the
document, with `Vary: Accept-Encoding`, validators and uncompressed fallback.
Restart after replacing dist/index.html: its compressed representation is
cached once at boot. Source and server code stay readable for maintenance.
See [OPTIMIZATION.md](OPTIMIZATION.md) for the audit scope and measurements.

Testing-only automation and Docker/MariaDB setup: [TEST-DEPLOYMENT.md](TEST-DEPLOYMENT.md).

## Admin recovery during countdown or maintenance

Type `https://YOUR_DOMAIN/commandcenter` to open the admin sign-in page even
when the homepage is replaced by countdown/maintenance. It redirects to
`/#/commandcenter`, an alias of the existing dashboard login. No public page
links to it. Existing passwords, account-disable checks and owner/admin role
permissions still apply; the URL itself is not a security boundary and must
not be treated as a secret credential. Anonymous visitors gain no edit rights.

SQL query protections and first-install schema: [SQL-SECURITY.md](SQL-SECURITY.md).
