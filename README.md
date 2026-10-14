# PB Travel Diaries

A React/Vite travel site ("PB from PB — India, Unfiltered") with cinematic films, road-tested routes, and honest guides from across India. The site is fully static — there are no user accounts, no sign-in/sign-up, and no database backend.

## Local development

```bash
npm ci
npm run dev
```

Then open the local URL Vite prints (default `http://localhost:5173/`).

## Production build

```bash
npm run build
npm run preview
```

`npm run build` produces a single self-contained `dist/index.html` that can be served by any static host.

## Admin (PB Control)

Site content is managed from the built-in PB Control dashboard at `#/admin`. It is a client-side editor for this static site, protected by a local password (changeable in its Settings panel), and content is stored in the browser — there is no server-side account system behind it.
