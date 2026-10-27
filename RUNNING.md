# Running the application

> **Local SQLite is now available:** choose Local database (SQLite) on setup
> for `server/data/pbfrompb.sqlite`, with no database credentials. Requires
> Node.js 22.13+ or 24+. Preserve `server/data/` during updates. Provider MySQL
> instructions below apply only when choosing provider mode. See [SQLITE.md](SQLITE.md).


The project runs directly with Node.js. The prebuilt website is checked into
`dist/`; Vite and all frontend build dependencies have been removed.

## Local verification

```bash
npm install
npm run test:server
npm run hosting:check
npm start
```

Open http://localhost:4000. Without database settings the installer asks for an
existing MySQL database/user, creates tables, then creates the owner account.

Optional temporary preview without MySQL:

```bash
# macOS/Linux
DB_DRIVER=memory PORT=4000 npm start
```

```powershell
# Windows PowerShell
$env:DB_DRIVER="memory"
$env:PORT="4000"
npm start
```

In another terminal:

```bash
curl http://localhost:4000/api/health
```

Stop with Ctrl+C. Run `npm start` again to restart. `npm run dev` uses Node's
watch mode for server files; it does not compile frontend source or hot-reload
the browser. `npm run prod` is an alias of start and never builds anything.

## Package for upload (optional)

```bash
npm run package
```

This copies the existing `dist/` and Node runtime into
`release/pb-travel-diaries/`, without compilation. ZIP that folder's contents,
excluding `node_modules`, `data`, root `media`, and `backup`. Keep `public/media`
and `dist/media`: they contain shipped art, not user uploads.

You may instead upload the repository's runtime folders directly. There is no
need to change package.json or install frontend packages.

## cPanel / Passenger

1. Extract runtime files into the application root outside `public_html`.
2. Choose Node 22.12+, Production mode, and a domain/subdomain root URL.
3. Run **NPM Install** in the panel.
4. Optionally select **hosting:check** under **Run JS Script**. If the panel
   takes a file path, use `server/scripts/hosting-check.js`.
5. Set startup file to `app.cjs`; click Start/Restart.
6. Create a MySQL database/user with database privileges and complete the
   browser installer immediately over HTTPS.

Do not set PORT yourself or DB_DRIVER=memory on the host. Passenger manages
startup and the listen endpoint. Do not use Run JS Script to launch a second
long-lived web server. No daemon or PM2 is needed.

`https://YOUR_DOMAIN/api/health` should report `ok:true` and `database:mysql`
after setup. Dashboard: `https://YOUR_DOMAIN/#/admin`.

## Updating

Preserve `data/`, `media/`, and `backup/`. Upload updated application files and
`dist/`, click Run NPM Install if dependencies changed, then Restart. Pending
versioned migrations run at boot; no manual SQL import is needed.

If the website is missing, restore `dist/` from the repository/release rather
than running a frontend build. Source in `src/` is reference material, not
compiled by npm scripts. Dashboard content edits are stored in the database
and do not require frontend compilation.

## Dependency security

Run `npm audit` after any install or update. The site installs only eight
production packages (`express`, `multer`, `mysql2`, `bcryptjs`, `cookie-parser`,
`dotenv`, `yauzl`, `yazl`), so the report is short and every finding is real.

`npm run audit` fails on high and critical advisories, and both deployment
pipelines run it, so a vulnerable package cannot ship silently. Fix one with
`npm audit fix` (a patch/minor bump inside the declared range), then run
`npm run test:server` and restart the site. If a fix needs a major bump, read
the advisory first — an upload library is not something to upgrade blindly.

`server/tests/runtime-package.test.js` also pins the version floor for each
advisory fixed so far, so a fresh `npm install` cannot resolve back onto a bad
range while the tests still pass.

See [NAMECHEAP.md](NAMECHEAP.md) for panel details and
[DEPLOYMENT.md](DEPLOYMENT.md) for environment variables, backups and restore.
