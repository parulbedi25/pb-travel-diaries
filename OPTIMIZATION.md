# Code and asset optimization audit

## Scope

Scanned `server/`, `src/`, `public/` and `dist/` for byte-identical files,
reviewed server startup, database scripts and packaging, and traced local
frontend imports from `App.tsx`.

This is a conservative static review plus automated tests, not a proof that
every branch of application code is used. No speculative removal of dynamic
routes, migrations, importer compatibility or dashboard features was performed.

## Changes

- Removed 11 duplicate asset files (5,655,348 bytes / 5.39 MiB). Images now
  have one canonical copy in `public/`; `dist/` holds the browser document.
- `/images/*` is served directly from `public/images/`. The old
  `/images/rider-kit-model.png` URL serves the canonical reference image,
  preserving existing database content and links without a duplicate file.
- Uploads retain precedence over shipped `/media/*`; legacy files in a custom
  DIST_DIR remain supported. A missing media file still returns JSON 404.
- Database status and migration scripts reuse the installer's existing
  connection-options helper instead of identical local implementations.
- The legacy `server/scripts/start.js` delegates to `app.cjs`, retaining old
  hosting startup paths with one production bootstrap implementation.
- Packaging counts bytes and files in one recursive walk, not two.
- Backup root-file selection now includes the actual `app.cjs` startup file
  and Namecheap guide rather than obsolete Vite/root HTML files.
- Removed a stale Vite environment-variable instruction from reference source.

## Minification and transfer size

The checked-in `dist/index.html` already contains minified JavaScript and CSS.
It was not rebuilt or rewritten, avoiding changes to the working prebuilt UI.
Server/source code remains readable for debugging and security maintenance.

The server now caches the HTML and a gzip representation once at startup and
negotiates compressed delivery. It preserves content type, no-cache policy,
ETags, HEAD support and `Vary: Accept-Encoding`; clients refusing gzip get the
original document. Restart after replacing the document.

| Measurement | Before | After |
| --- | ---: | ---: |
| Runtime upload folder (rounded) | 9.8 MiB | 4.4 MiB |
| Browser document transfer, identity vs gzip | 2,248,504 bytes | 616,582 bytes |
| Byte-identical file groups in scanned directories | 9 | 0 |

The HTML gzip representation is about 73% smaller. An upstream proxy may
already have compressed responses; these numbers describe the Node response,
not a guaranteed improvement over every hosting configuration.

## Deliberately retained

- All frontend TypeScript modules are reachable from the app or the `main.tsx`
  entry. Reference source is not compiled at runtime; deleting it would lose
  maintainable frontend source without shrinking the deployment package.
- Memory and MySQL repositories implement different drivers, not duplicate
  files. Tests and disposable previews need the memory implementation.
- Versioned migrations and reference SQL are deployment/restore contracts.
- Compatibility startup paths, legacy image URLs, and shipped default images
  can be referenced by hosting settings or stored database content.

## Verification

- `npm run test:server`: 64 passing tests.
- New integration tests compare canonical/legacy image bytes and check gear
  image serving, gzip round-trip, explicit gzip refusal, HEAD and validators.
- Existing backup tests now verify `app/app.cjs` is present in the archive.
- `npm run package` succeeds without frontend tooling.
- Clean runtime-folder package install and `hosting:check` succeed.

Actual Namecheap/Passenger and visual browser verification remain host-side
checks; no MySQL server was available for a live SQL integration test here.
