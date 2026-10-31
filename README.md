# PB Travel Diaries

A Node.js/Express application serving a prebuilt travel website, dashboard,
API, and uploaded media. SQLite or MySQL/MariaDB stores accounts, content and sessions.

**No Vite, frontend package installation, or build command is required.**
The repository includes the ready-to-serve website in `dist/`. `npm install`
installs server packages only. There are no development dependencies.

## Start locally

Use Node.js 22.13+ or 24+ (recommended).

```bash
npm install
npm run hosting:check
npm start
```

Open http://localhost:4000 and choose Local SQLite or provider MySQL. Only the
provider option needs a pre-created database and user.

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
6. Open the HTTPS domain, select SQLite or provider MySQL, and complete setup immediately.

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
- `data/install.json`: installer settings, including provider credentials if used.
- `server/data/pbfrompb.sqlite`: persistent local SQLite data; never replace during updates.
- `media/`: user uploads; preserve during updates.
- `backup/`: backup archives; preserve and copy off-host.

Content changes through `/#/admin` are stored in MySQL and take effect without
rebuilding. Keep versioned migrations append-only. Never commit install files,
credentials, uploaded media or database backups.

[DEPLOYMENT.md](DEPLOYMENT.md) covers environment variables, access controls,
backups and restoring an installation.

The site can also be exported as plain files and hosted with no Node at all —
`npm run export:static`, then upload — for a read-only copy on shared hosting or
any static host. Steps, per host: [STATIC-HOSTING.md](STATIC-HOSTING.md).

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

## Live location from your phone (OwnTracks)

The live tracker, the live map (`#/live-map`) and the nearby places map can all
follow the rider's phone. Install **OwnTracks** (free, Android and iPhone), then:

1. In the dashboard open **Settings → Live location** and copy the URL shown
   there (`https://YOUR_DOMAIN/api/live/owntracks?token=…`).
2. In OwnTracks: **Preferences → Connection**, set **Mode** to **HTTP** and
   paste the URL into **URL**. If it asks for a password, the token is the
   password.
3. Turn location reporting on. Every fix the phone sends appears under
   **Last fix from the phone**.

How it behaves:

- **You choose how often the pin moves.** Dashboard → **Settings → Live
  location** offers *Live* (every fix) or a rhythm — every minute, 5, 10, 15,
  30 minutes, 1, 2, 3, 6, 12 hours, once a day. The phone keeps reporting
  either way; the rhythm decides when the tracker, `#/live-map` and the nearby
  page move. A paced pin shows "updates every 30 min" beside the position, and
  the panel reports when the next move is due.
- A point counts as live for **one hour plus your rhythm**, inside the
  tracker's usual 6:00 AM – 9:00 PM IST window. After that the site falls back
  to the stop marked **Here now** in the dashboard, so a phone left in a drawer
  cannot park the bike somewhere it no longer is.
- The newest fix wins even if an older one arrives later (a phone that was out
  of signal replays its queue).
- The token in that URL is a password: it is shown only to the owner, and
  **New token** retires the old URL. Nothing about the position is public
  beyond a latitude, a longitude, the time and how accurate the fix was.
- No map key or Google account is involved: the same Node app that serves the
  site receives the fixes and stores the latest one in the database.

## Here now, ridden, and the two-kilometre rule

The live tracker no longer waits for somebody to edit a stop's status in the
dashboard. It reads the position it is already showing — the phone's OwnTracks
fix, or the stop the dashboard marked — and decides the statuses itself:

- **Within 2 km of a stop it reads "here now".** Approaching, arriving, parked
  in the town: all the same answer.
- **Once the rider is 2 km past it along the road it reads "ridden".** Measured
  along the route, not as the crow flies, so a hairpin does not mark a town
  ridden while the bike is still on the other side of it.
- **Everything else is still to come.**

The map follows the same rule: the pointer sits on the fix rather than on the
last stop, the solid yellow line ends under the pointer at the kilometre
ridden, and the faint circle around the stop being entered is the 2 km radius
itself. The dashboard's own statuses are kept as the fallback for a page with
no position at all, and are what the owner sees when editing the route.

The smaller "2 km" figure lives in `src/utils/rideStanding.ts`. Raise
`ARRIVE_KM` and every surface — tracker, map, nearby page — follows.

## Three cities on the nearby page

The nearby page always keeps **three** cities on its map, whatever is being
searched:

- **Coming from** — the town behind, or the one the rider is standing in.
- **About to reach** — the next stop on the route.
- **Entering soon** — the one after that.

They are drawn as labelled plates on the map and as three cards above it, so
the page says where the ride is between as well as what is around one stop.
Tapping either one searches around that city, and the three follow the ride as
it moves rather than staying at whatever was last saved.

## Building the route in the dashboard

Dashboard → **Live tracker → Stops** builds the route the way a directions panel
does: **Your route** is a list of rows, and every row *is* a stop.

- The first row is the **start**, the last is the **destination**, and any row
  between them is a stop on the way. Type into a row and suggestions appear from
  the second character — Geoapify when the site has a key, OpenStreetMap
  (Photon, then Nominatim) when it does not, biased to the route you already
  have. Pick one, or press Enter to look the typed name up. The list is drawn in
  a portal, so no dashboard frame can clip it.
- **Choosing a place replaces that row; it never adds a second one.** A new
  start or destination takes the old one's place, and the towns the fill had put
  on the old stretch go with it — the list under the box is the ride you just
  described, not the old one plus a new name at the top. A stop already marked
  *here now* stays marked when its name is corrected.
- **Add a stop** puts a blank row just before the destination, halfway along the
  leg it lands on: type its name, or drag its pin on the map above. Drag a row
  by its grip (or use the arrows) to change the order, and remove one with the
  bin beside it.
- **The road and the distance are measured again after every edit** — a place
  picked, a row dragged, added or removed, a pin moved. The panel says
  *Recalculating the road…* while it measures, and each row shows its kilometres
  from the start, by road once the road is known.
- **The towns between the ends** are filled in once per pair of ends and shown
  in green, so your own deletions survive the next edit; *Fill in the towns
  between* does it again on demand. Untick *Fill in the important towns between
  my stops* to keep the route exactly as you made it; ticking it again fills it
  in.
- Towns that were added show in **green**; remove any of them (or **Clear all
  stops**) and they turn **red** with an **Undo** button beside them — one at a
  time, or **Put every removed stop back** for all of them. A replaced start or
  destination is undoable the same way.

## First-run setup signs nobody in

The installer creates the super admin and stops there. Step 3 says **Super
admin created — now sign in** and sends you to `#/admin`, where the username
and password are typed again. No session cookie is issued by the setup screen,
so the first session on a new site is opened by the sign-in page like every
session after it — a password typed once into a fresh install is a password
nobody has proved they know. `/api/setup/owner` answers
`{"signedIn": false, "next": "login"}` and sets no cookie; `#/admin` shows the
sign-in screen until you sign in.

## Setup database location

Choose **Local database (SQLite)** for one-click persistent setup with the name
`pbfrompb` and no database credentials. This creates
`server/data/pbfrompb.sqlite` and then opens owner setup. Use Node.js 22.13+ or
24+. Preserve `server/data/` during updates; it is never part of a release ZIP.

**Hosting provider / external MySQL** keeps the existing credentials-based
flow. Neither choice uses the temporary in-memory preview driver. See
[SQLITE.md](SQLITE.md) for persistence, migrations, backups, and requirements.
