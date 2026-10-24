# Uploaded media

Everything uploaded from the dashboard (photos, PDFs, documents) is written here
by the server, with a random filename, and indexed in the `media` table.

**This folder is the backup unit.** Copy it, zip it, or sync it to storage; the
database only stores which file is which. Restoring is the two together: the
folder and a database dump.

- Served at `/media/<file>`, with a one-year cache (filenames are never reused).
- Starting or packaging the site never clears your uploaded files.
- Runtime uploads are not in Git. The reviewed `starter/` images are the only bundled exception.

## Hero and Journey starter images

`starter/` contains eight local, credited travel photographs. They are bundled
with the app and served at `/media/starter/ladakh.webp`, etc. The Hero uses
Ladakh plus Kerala/Varanasi cards; each Journey destination uses its matching
photo. Credits and licence links: `/media/starter/credits.html`.

To add your own: Dashboard → Media folder → Upload, then select that image in
Sections → Hero or Journey Showcase → Edit. Uploaded files are indexed in the
database and appear in the media picker. The bundled starters are ordinary
files, not uploaded media-library records; their paths are already filled in
for the built-in content. Existing non-empty image fields are never overwritten.

You can also place new files directly here and paste `/media/my-photo.jpg` into
an image field. Direct filesystem additions do not automatically create library
records. Keep `media/` during updates and include it in your backups. A release
contains only `media/starter/`, never your private/runtime uploads.
