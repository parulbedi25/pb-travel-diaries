# Uploaded media

Everything uploaded from the dashboard (photos, PDFs, documents) is written here
by the server, with a random filename, and indexed in the `media` table.

**This folder is the backup unit.** Copy it, zip it, or sync it to storage; the
database only stores which file is which. Restoring is the two together: the
folder and a database dump.

- Served at `/media/<file>`, with a one-year cache (filenames are never reused).
- Safe to rebuild the site — `npm run build` writes `dist/`, never this folder.
- Not in git: see `.gitignore`.
