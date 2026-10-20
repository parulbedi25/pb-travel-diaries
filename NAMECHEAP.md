# Running PB Travel Diaries on Namecheap (cPanel → Setup Node.js App)

Namecheap shared hosting runs Node.js through **Phusion Passenger**, which
cPanel exposes as **Software → Setup Node.js App**. Passenger starts your app,
keeps it alive and puts it behind Apache on your domain's normal 80/443 — you
never open a port, and you never run `vite`, `npm run dev` or PM2.

This guide follows the panel workflow. Confirm that your account offers
**Setup Node.js App** and a supported Node version; availability depends on
the hosting account. If the tool is missing, ask hosting support.
For the general host-agnostic material, see [DEPLOYMENT.md](DEPLOYMENT.md).

```
cPanel ─► MySQL Databases        (database + user, created first)
       ─► File Manager           (upload the app folder)
       ─► Setup Node.js App      (Node 22 · startup file · Start)
       ─► your domain            (the setup screen: database, then owner)
```

---

## Quick install — no daemon, SSH or PM2

1. On your computer run `npm ci` followed by `npm run package`.
2. ZIP the contents of `release/pb-travel-diaries/` (not the source repository).
   This deployment has a production-only package manifest: cPanel's plain
   **Run NPM Install** will not install Vite or TypeScript. Do not upload
   local `node_modules`.
3. Upload and extract into `/home/YOUR_USER/pb-travel-diaries`, outside
   `public_html`. The folder must contain `app.cjs`, `package.json`, `server/`,
   `dist/` and `public/` directly, without an extra nested folder.
4. In **Setup Node.js App → Create Application**, select:

   | Field | Value |
   | --- | --- |
   | Node.js version | 22.x (22.12+) |
   | Application mode | Production |
   | Application root | `pb-travel-diaries` |
   | Application URL | Your domain or subdomain root, not `/travel` |
   | Application startup file | `app.cjs` |

5. Stop the app temporarily if needed, then click **Run NPM Install**.
6. Under **Run JS Script**, select **hosting:check** and run it. If the panel
   takes a file path rather than an npm script, use
   `server/scripts/hosting-check.js`. It checks dependencies and creates/tests
   `data/`, `media/`, and `backup/`, then exits. It does not start a second server.
7. Set `NODE_ENV=production` and `TRUST_PROXY=true`. Do not set `PORT` or
   `DB_DRIVER=memory`. Leave `DB_*` unset when using the browser installer.
8. Click **Start App** or **Restart**. Passenger, not a daemon you manage,
   owns the web process. The older `server/scripts/start.js` entry still works
   for hosts that support ES modules directly; `app.cjs` is the CommonJS
   bridge for Passenger loaders.
9. In cPanel create a MySQL database and user; attach the user with
   **ALL PRIVILEGES**. Keep the full account-prefixed names and password.
10. Enable SSL for the domain, then immediately visit its HTTPS URL. The setup
    screen asks for database details (host supplied by your hosting account,
    commonly `localhost`, port 3306), creates tables, and creates your owner.
    Do not share the URL until setup is complete.

### Startup file versus Run JS Script

**Use the startup-file field for the website.** The panel's Start/Restart
controls launch the persistent web application under Passenger. No PM2,
systemd service, background shell command or manually opened port is required.

**Run JS Script is for finite tasks.** Use `hosting:check` there, not `start`.
Some panel versions list `start` because it is an npm script, but running it
there may time out or launch a second unmanaged server. Both controls can be
used in sequence: check first, then Start/Restart through the app controls.

### Verify

Visit `https://YOUR_DOMAIN/api/health`: after setup it should report
`"ok":true` and `"database":"mysql"`. Dashboard: `https://YOUR_DOMAIN/#/admin`.

### Common problems

- **503:** read the Passenger/application error log. Check Node version,
  `app.cjs`, the application root, and whether Run NPM Install succeeded.
- **ERR_REQUIRE_ESM:** use `app.cjs` as startup file, not an ES-module `.js`
  file. The bridge imports the ES-module server dynamically.
- **Missing build:** upload the complete generated release with
  `dist/index.html`, then restart. No server-side build is necessary.
- **Database access denied:** check full prefixed database/user names, password,
  host, and privileges. Do not use the preview's in-memory database.
- **hosting:check fails:** its error names the missing file/package or
  unwritable folder. Correct it, rerun, then Start/Restart.

### Updates and backups

Generate a new release locally, upload over application files, install
packages again if dependencies changed, and Restart. Preserve `data/`,
`media/` and `backup/`; never extract with an option that deletes those folders.

Passenger may idle the process, so an in-process timer cannot guarantee daily
backups. Use cPanel Cron Jobs for a reliable scheduled run of
`server/scripts/backup-now.js` with the Node executable from the environment
shown by your panel. `backup:now` is also available as a one-off npm script.
Backups consume hosting quota: copy them off-host too.

General configuration and restore instructions: [DEPLOYMENT.md](DEPLOYMENT.md).
Panel reference: https://www.namecheap.com/support/knowledgebase/article.aspx/10047/2182/how-to-work-with-nodejs-app/
