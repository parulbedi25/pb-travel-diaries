# Hosting this site as static files

This is the "no Node.js anywhere" route. The site is exported into a folder of
ordinary files, you upload that folder, and the domain serves the site. No
database, no `npm install`, no Passenger, no Node version to pick, no process to
keep alive.

Use it when the site is finished and just needs to be online. If you still want
to edit the site from a browser, or have pasted map links expand on the live
site, you want the server instead — see [DEPLOYMENT.md](DEPLOYMENT.md) and
[NAMECHEAP.md](NAMECHEAP.md).

---

## 1. What you get

`npm run export:static` writes `release/static/`, which looks like this:

```
release/static/
├── index.html                 the whole site: markup, styles, scripts inlined
├── content.json               the published content, as a visitor sees it
├── images/                    art that ships with the code
├── media/                     shipped art, plus any photos you uploaded
├── mobile-layout.css          small-screen overrides the page links to
├── maplibre-gl-worker.mjs     the map's worker thread
└── README.txt                 a note for whoever opens the folder later
```

About 16 MB in total. The page reads `content.json` when there is no API behind
it, which is what makes the site work without a server.

## Where the database went, and why there is no `.env`

A static site cannot connect to a database. Not MySQL, not SQLite, not "just to
read one table" — there is no server-side code in the folder, and a browser is
not allowed to open a database connection; a password in the page would be
readable by every visitor anyway.

So the data was read **once, at export time**, and written into `content.json`.
That file is the site's content from then on. Editing it by hand works (it is
plain JSON), but the normal way to change it is to change the site with the
dashboard on a machine running the server, and export again.

**Do not upload `.env`, and do not look for one.** On a static host every file
in the web root can be fetched by anyone, so `https://yourdomain.com/.env` would
hand out your database password and session secret. It is also useless there:
nothing in the folder reads it.

Two more consequences, because they are the usual reason people reach for `.env`
at this point:

- **Your Mac's `localhost` database is unreachable from a web host.** It only
  listens on your own machine, it sits behind your router, and exposing it to
  the internet is not something to do for a travel diary. That is exactly why
  the export exists: the database stays on your Mac, and the folder carries a
  copy of what it holds.
- **Uploaded photos are a snapshot too.** Files added to the site after the
  export are not on the server until you export and upload again.

If you want the live site to talk to a database — editing from any browser,
photos added later, pasted map links expanding, members-only sections really
locked — that is the **server** deployment, not this one: upload the app, create
a MySQL database **in that host's cPanel**, and put those credentials in the
panel's environment (or a `.env` **outside** `public_html`). See
[NAMECHEAP.md](NAMECHEAP.md). The credential that matters there is the host's
`localhost`, never your Mac's.

---

## The PHP bridge — when the host runs PHP but not Node

A plain static folder cannot open a database. Shared hosting, though, almost
always runs **PHP**, and PHP is code the server executes — so the folder can
carry a small API of its own, and the site behaves like the Node version.

```bash
npm run export:static -- --php --out ~/Desktop/pb-static
```

That adds three files to the folder:

| File | What it is |
| --- | --- |
| `api.php` | the whole API: setup, sign-in, content, settings |
| `php-config.php` | the database details from your `.env`, including the password |
| `.htaccess` | sends every `/api/…` request to `api.php`; hides `php-config.php` |

**Why the password can live in `php-config.php` but never in a `.env`:** PHP is
*executed* by the server, so its source is never downloaded — a `.env` is a
plain file, and anything a browser can reach, anyone can read. Keep the `.php`
extension; renaming it to `.txt` publishes your password.

### What happens on the first visit

1. The site asks `/api/setup/status`, which is PHP now, and gets an answer.
2. Nothing is set up yet, so the setup screen opens — **host, port, database and
   user already filled in** from your `.env`. The password is not sent to the
   browser; leave that field blank and the server uses the stored one.
3. **Test connection** really connects and names the server version.
4. **Create tables** really creates them in your MariaDB.
5. The owner account step creates the super admin, and it is stored with
   `password_hash()` — never in plain text.
6. The site opens, and the dashboard can sign in and save: content is kept in
   `site_content` in your own database.

### What it does not do

Media uploads, backups, revisions history and member tracking remain Node-only
features. Content editing, sign-in and settings work. If a plan offers Node, the
Node deployment is the complete one.

### If the setup screen does not appear

- `.htaccess` was not uploaded (some file managers hide dotfiles) — upload it,
  or ask the host to enable pretty URLs.
- The API answers 404: the folder is not at the domain root.
- Apache 500 on every request: check the host's PHP version (8.0 or newer) and
  its error log.

---

## 2. Make the export

Run this on the machine that has your saved site — the one where the dashboard
was used last — not on the web host:

```bash
# once, if the frontend toolchain is not installed on this machine:
npm i --no-save --legacy-peer-deps react react-dom maplibre-gl lucide-react \
  framer-motion clsx tailwind-merge typescript@5 vite @vitejs/plugin-react \
  @tailwindcss/vite tailwindcss vite-plugin-singlefile @types/react \
  @types/react-dom @types/node

node scripts/build.mjs      # writes dist/index.html
npm run export:static       # writes release/static/
```

A different folder:

```bash
npm run export:static -- --out ~/Desktop/pb-static
```

### If the database cannot be reached, it still builds

An unreachable database no longer stops the export. It prints what it tried,
then writes the folder from the content in the code and exits `0`:

```
[export] reading from MySQL at localhost:3306/pb_travel as pb
[export] could not reach MySQL at localhost:3306/pb_travel as pb: ECONNREFUSED
[export] building anyway, from the content in the code — the site will
[export] open and work, without the changes saved in the dashboard.
[export] done — 44 files, 16.2 MB in …
```

So a build always produces something uploadable. What it does **not** silently
do is pretend: the warning says the dashboard's changes are missing, and the
folder's `README.txt` records that it came from the built-in content.

`--strict` restores the old behaviour — stop instead of building without the
database — for a script or pipeline that would rather fail than ship the wrong
content.

### With no database at all

Most of this site is written in code — every section, the trip, the gear, the
shop — and a database only ever holds *changes* to that. So a folder can be
exported without touching a database, a setup screen or any credentials:

```bash
node scripts/build.mjs
npm run export:static -- --builtin --out ~/Desktop/pb-static
```

That writes the same folder minus `content.json`; the page shows the content
compiled into it. It is exactly what the whole site looked like before anyone
saved anything in the dashboard, and it needs nothing on this machine but the
repository.

The trade is the obvious one: **anything you changed in the dashboard is not in
it.** If `content.json` is what you want, the content has to come from somewhere
— a database on this machine, or one it can reach (below).

The export reads the database, so it stops with a message if no database is
configured or if nothing has been published yet. That is deliberate: an export
of an empty site looks like the real thing and would go unnoticed.

### Reading a database that is not this machine's

`.env` describes the database this machine uses. A single run can be pointed
somewhere else — the site's MySQL on a host, for instance — without touching
that file, because the export is a moment rather than a connection the site
keeps:

```bash
npm run export:static -- --check \
  --db-host 203.0.113.9 --db-user pb_read --db-name pb_travel

npm run export:static \
  --db-host 203.0.113.9 --db-user pb_read --db-name pb_travel
```

| Flag | Sets |
| --- | --- |
| `--db-driver` | `mysql`, `sqlite` (default: whatever `.env` says) |
| `--db-host`, `--db-port` | where the database listens |
| `--db-user`, `--db-name` | which user and database |
| `--db-password` | the password — see below |
| `--db-socket` | a Unix socket instead of host and port |
| `--check` | connect, report where it got to, stop |
| `--out` | where to write the folder (default `release/static`) |

`--check` is worth running first: it says which database it reached and whether
that database holds a published site, without writing anything.

**`.env` is read by the export as well as by the server.** If this machine's
`.env` already describes the database — `DB_HOST`, `DB_USER`, `DB_NAME`,
`DB_PASSWORD` — then `npm run export:static` uses it with no flags at all, and
`DB_DRIVER=sqlite` selects the local SQLite file. That is the convenient case
and the one to use when the content is on this machine.

The export says which file it read and which variables it took, never the
values:

```
[export] environment: .env
[export] database settings from the environment: DB_HOST, DB_USER, DB_NAME, DB_PASSWORD
[export] reading from MySQL at localhost:3306/pb_travel as pb
```

A file used only for exporting is kept separate by naming it:

```bash
npm run export:static -- --env .env.static
ENV_FILE=.env.static npm run export:static
```

Variables in the named file win over `.env`; anything it does not set still
comes from `.env`, so the two are read as one set with the named file in front.

The `.env` itself is **never copied into the folder**. It is read for the few
seconds the export runs; what ships is `content.json`. Uploading a `.env` would
publish the password and change nothing.

**The password is better in the environment than on the command line**, where it
lands in your shell's history:

```bash
DB_PASSWORD='…' npm run export:static -- --db-host … --db-user … --db-name …
```

Give the export a **read-only** MySQL user (`SELECT` only). It never writes, and
a read-only user cannot damage anything if the password leaks.

Nothing about these credentials reaches the folder. What ships is `content.json`
— the content as it stood at that moment. A static site cannot connect to a
database, and a `.env` in a web root is a password in public. The flags exist so
the *export* can reach a database, not the uploaded site.

## 3. Upload the **contents**, at the **root**

Two rules, and both of them bite silently:

1. **The contents, not the folder.** `index.html` must sit at the top level of
   the site, not inside `static/`.
2. **The site's root, not a subfolder.** The page asks for its art as
   `/media/…` and `/images/…`, with a leading slash. In a subfolder the page
   loads and every picture is missing.

Upload at once and keep the folder structure: a ZIP extracted in place is the
safest way, because 45 loose files through a file manager is 45 chances to drop
one.

## 4. By host

### Namecheap / cPanel / any shared hosting

1. cPanel → **File Manager** → the document root: `public_html`, or
   `public_html/yourdomain.com` for an addon domain or subdomain.
2. ZIP the **contents** of `release/static/`, upload, then **Extract**.
3. Delete any `index.htm`, `index.html` or `default.html` the host created. If
   one is left there, Apache serves that instead and the site looks untouched.
4. Do **not** use **Setup Node.js App** for this. It is not needed and it will
   fight the static files for the domain.

### Netlify

Drag `release/static` onto the Netlify dashboard, or set:

| Setting | Value |
| --- | --- |
| Build command | *(empty)* |
| Publish directory | `release/static` |

### Cloudflare Pages

Same shape: no build command, output directory `release/static`.

### GitHub Pages

Works, with one trap: a **project** site (`username.github.io/repo`) is served
from a subfolder, and the absolute `/media/…` paths will not resolve. Use a
**user site** (`username.github.io`) or attach a **custom domain**, so the site
is served from the root. Add an empty `.nojekyll` file at the top level so Pages
publishes the folder verbatim.

### Amazon S3 / any object storage

Serve it as a static website: index document `index.html`, and upload the folder
with its structure. Give `content.json` the type `application/json` — the page
tolerates anything, but other tools read it too.

## 5. Check it worked

Three URLs, in order:

```
https://yourdomain.com/                     the site, with its pictures
https://yourdomain.com/content.json         JSON — your saved content
https://yourdomain.com/maplibre-gl-worker.mjs   JavaScript
```

If `content.json` returns your page's HTML instead of JSON, it did not land in
the root — and the site will fall back to its built-in content. If the site
appears with no pictures, the folder was uploaded one level too deep.

Then scroll the live site: the journey, the machine, the gear, and the map. The
map is the one that needs `maplibre-gl-worker.mjs` beside the page.

## 6. What a static export cannot do

There is no server, so these are absent by design, not broken:

- the dashboard and signing in — `#/dashboard` opens the home page instead
- editing the site, and the publish/history/backup features
- adding photos later (they are copied at export time)
- pasting a Google or Bing short link to fill in stops
- nearby places, and the live tracker's shared position

Members-only sections are exported **locked and empty**, because the server
strips them for visitors and a file on a web server keeps no secrets.

## 7. Updating the site

There is no in-place editing. The cycle is:

```bash
# on the machine with the database
node scripts/build.mjs
npm run export:static
# then upload release/static/ again
```

Replace the uploaded files rather than merging them, or a photo you deleted
locally will linger on the server. If the host caches aggressively and the site
looks stale after an upload, clear the cache; the page asks for `content.json`
with revalidation, so it should not need to be purged by hand on most hosts.

## 8. If something looks wrong

| What you see | What it is |
| --- | --- |
| Site loads, every picture broken | uploaded into a subfolder, or `images/` and `media/` were left behind |
| The built-in content, not your edits | `content.json` missing, or served as HTML by a catch-all rule |
| Blank page, no error | `index.html` uploaded alone; the map worker and stylesheet are separate files |
| The host's own holding page | an old `index.htm`/`default.html` still in the document root |
| Works on the host, stale in your browser | cache — hard-reload once, then confirm on another device |
| `no database is configured on this machine yet` | nothing to read here: pass `--db-host/--db-user/--db-name`, or set the site up on this machine first, or use `--builtin` and ship the content that is in the code |
| `the MySQL on localhost is running, and it does not know the user` | those credentials were made in a hosting panel and exist on that server, not on your Mac — enable Remote MySQL in cPanel and pass the server's hostname, or run the command where the database lives |
| `nothing is listening on …:3306` | no MySQL on this machine; point `--db-host` at the machine that has one |
