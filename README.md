# PB Travel Diaries

A React/Vite travel site ("PB from PB — India, Unfiltered") with cinematic films, road-tested routes, and honest guides from across India. The site is fully static — there are no user accounts, no sign-in/sign-up, and no database backend.

**Stack:** React 19 · Vite 7 · TypeScript · Tailwind CSS 4. The build is a single self-contained `index.html` plus your media folders, so there is no server-side runtime — it deploys to any static host.

---

## Requirements

- **Node.js 20.19+ or 22.12+** — Vite 7 dropped support for Node 18. This project is built with Node 22 LTS.
- npm 10+ (bundled with Node 22).

---

## Local development

```bash
npm ci
npm run dev
```

Then open the local URL Vite prints (default `http://localhost:5173/`).

`vite.config.ts` already sets `host: true`, so the dev server also listens on your LAN (`http://<your-ip>:5173/`) for testing on a phone. `allowedHosts: true` means it answers on any hostname, so it also works behind a tunnel (ngrok, Cloudflare Tunnel, a review domain) with no extra flags.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload on port 5173 |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the last build on port 4173 |
| `npm run dev -- --port 3000` | Dev server on a different port |

---

## Environment variables

There is exactly one optional variable:

| Variable | Used for | Required |
| --- | --- | --- |
| `VITE_LIVE_FEED_URL` | JSON endpoint polled every 60s for the live tracker pin | No — falls back to the coordinates bundled in `src/data/liveLocation.ts` |

Expected feed shape:

```json
{
  "lat": 32.2265, "lng": 78.0644,
  "name": "Kaza", "state": "Spiti Valley, Himachal Pradesh",
  "altitude": "12,500 ft", "note": "Night halt at Key village.",
  "updatedAt": "2026-01-01T10:00:00+05:30"
}
```

Two rules that catch people out:

1. **Vite inlines `VITE_*` variables at build time.** Changing one requires a rebuild — restarting the server is not enough.
2. **Anything in a `VITE_*` variable ships to the browser.** Never put a secret in one.

Per-environment files (create these on each machine — `.gitignore` excludes `/.env.*`):

```bash
# .env.development — picked up by `npm run dev`
VITE_LIVE_FEED_URL=https://staging.example.com/pb-live.json

# .env.production — baked in by `npm run build`
VITE_LIVE_FEED_URL=https://pbtraveldiaries.com/pb-live.json
```

---

## Production build

```bash
npm ci
npm run build      # → dist/
npm run preview    # serve dist/ on http://localhost:4173/
```

`npm run build` inlines all JS and CSS into one file, so `dist/` contains:

```
dist/
├── index.html      ← the entire app (~1.1 MB, ~305 kB gzipped)
├── images/         ← copied from public/images
└── media/          ← copied from public/media
```

Upload the **whole `dist/` folder**, not just `index.html` — the image and media folders are separate files.

> Any file you reference in PB Control as `/media/photo.jpg` or `/images/gear/…` has to physically exist in `public/` *before* you build. The dashboard stores the path; the file itself has to be committed to the repo.

`npm run preview` is a quick way to sanity-check the build. For a real deployment use nginx/Apache or a static host — Vite's preview server is not a hardened production server.

---

## Deployment

Routing is hash-based (`#/admin`, `#/live-map`, `#/shop`), so there is no server-side routing to configure: every URL is really `index.html` plus a fragment, and refreshing a deep link always works.

### Option 1 — nginx (recommended)

```bash
npm ci && npm run build
rsync -avz --delete dist/ user@your-server:/var/www/pb-travel-diaries/
```

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name pbtraveldiaries.com www.pbtraveldiaries.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name pbtraveldiaries.com www.pbtraveldiaries.com;

    ssl_certificate     /etc/letsencrypt/live/pbtraveldiaries.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pbtraveldiaries.com/privkey.pem;

    root /var/www/pb-travel-diaries;
    index index.html;

    # The whole app is one HTML file, so compression matters a lot here.
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/html text/css application/javascript application/json image/svg+xml;

    # Never let a stale copy of the app stick around after a deploy.
    location = / {
        add_header Cache-Control "no-cache, must-revalidate";
        try_files /index.html =404;
    }

    location = /index.html {
        add_header Cache-Control "no-cache, must-revalidate";
    }

    # public/ files keep their original names (they are not content-hashed),
    # so give them a short cache rather than a year-long one.
    location ~* \.(jpg|jpeg|png|webp|avif|gif|svg|pdf|mp4)$ {
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Then `sudo nginx -t && sudo systemctl reload nginx`. If your nginx has the Brotli module, enabling it shrinks `index.html` further than gzip.

### Option 2 — Apache / cPanel (shared hosting)

Upload the **contents** of `dist/` into `public_html/` (so `public_html/index.html` is the app), then add `public_html/.htaccess`:

```apache
DirectoryIndex index.html

<IfModule mod_rewrite.c>
  RewriteEngine On
  # Hash routing keeps every real URL on index.html, so this is only a
  # safety net for direct hits on files that no longer exist.
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json image/svg+xml
</IfModule>

<Files "index.html">
  Header set Cache-Control "no-cache, must-revalidate"
</Files>

<FilesMatch "\.(jpg|jpeg|png|webp|gif|svg|pdf|mp4)$">
  Header set Cache-Control "public, max-age=604800"
</FilesMatch>
```

### Option 3 — Docker + nginx

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 80
```

```bash
docker build -t pb-travel-diaries .
docker run -d -p 8080:80 --name pb-site pb-travel-diaries
```

The stock nginx image serves `index.html` at `/`, which is all this site needs. Mount your own `nginx.conf` if you want the caching and compression headers from Option 1.

### Option 4 — static hosts (Netlify, Vercel, Cloudflare Pages, GitHub Pages)

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Publish / output directory | `dist` |
| Node version | `22` |
| Environment variables | `VITE_LIVE_FEED_URL` (optional) |

No redirect or rewrite rules are needed. If your host insists on a SPA fallback, point it at `/index.html`.

---

## Dev / staging environment on a server

For a review URL that behaves like production, build and serve the output:

```bash
npm ci
npm run build
pm2 start npm --name pb-staging -- run preview   # port 4173, from vite.config
pm2 save
```

If you specifically want hot reload on the box while iterating remotely, run the dev server instead:

```bash
pm2 start npm --name pb-dev -- run dev           # binds 0.0.0.0:5173
pm2 logs pb-dev
```

Point a subdomain at it (`staging.pbtraveldiaries.com`) by proxying to the port:

```nginx
location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Keep the dev server off the public internet where you can — it serves unbundled source and is not meant for visitors.

---

## Serving from a subfolder

The site expects to live at the domain root: content in PB Control references assets by root-absolute paths like `/media/himalayan-450.jpg`. If you must host it at `example.com/diaries/`:

1. Add `base: "/diaries/"` to `defineConfig` in `vite.config.ts` and rebuild.
2. Update any `/media/…` and `/images/…` paths in PB Control to include the folder.

Serving from the root avoids both steps.

---

## After deploying

```bash
curl -I https://pbtraveldiaries.com/                         # 200 + gzip/brotli
curl -I https://pbtraveldiaries.com/media/himalayan-450.jpg  # 200
```

Then open the site and check `https://pbtraveldiaries.com/#/admin`.

## Updating the live site

```bash
git pull
npm ci
npm run build
rsync -avz --delete dist/ user@your-server:/var/www/pb-travel-diaries/
```

`index.html` is sent with `no-cache`, so visitors pick up a new build on their next visit. Media is cached for 7 days — if you replace an image **without** renaming it, expect a stale copy until that expires.

---

## Admin (PB Control)

Site content is managed from the built-in PB Control dashboard at `#/admin` (aliases: `#/pb-control`, `#/login`). It is a client-side editor for this static site, protected by a local password (changeable in its Settings panel), and content is stored in the browser — there is no server-side account system behind it.

- Default password: `pbadmin` — **change it** in Settings → Change admin password.
- Content is saved in **that browser's** local storage, so edits are per-browser and per-device. Use Settings → Backup & transfer to move content between machines.
- Maintenance mode's scheduled switch-on runs in browsers holding that saved content — in practice, the machine you scheduled it from. Reaching every visitor would need a shared backend, which this static site does not have.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| White page, console 404s | Only `index.html` was uploaded, or an old build is being served. Upload all of `dist/` and hard-refresh. |
| Images or media 404 | The `images/` and `media/` folders were not copied, or a file referenced in PB Control is missing from `public/`. |
| Old content after a deploy | `index.html` cached by a proxy or CDN. Confirm the `Cache-Control` header from the config above. |
| Live tracker never updates | `VITE_LIVE_FEED_URL` was added after the last build, or the endpoint does not return the JSON shape above. Rebuild. |
| Dashboard edits disappear | Different browser, device or private window — content is stored per browser. Use Backup & transfer. |
| `npm ci` fails on Node 18 | Vite 7 needs Node 20.19+ or 22.12+. Upgrade Node. |
