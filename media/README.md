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

`starter/` contains the current eight-photo collection: Pangong Tso (Ladakh),
Diskit (Nubra), Dhankar (Spiti), Hawa Mahal (Rajasthan), sunrise boats (Varanasi),
Dawki (Meghalaya), Munnar (Kerala) and Agonda (Goa). The Hero uses Pangong Tso
plus Munnar/Varanasi cards; each Journey destination uses its matching photo.
Credits and licence links: `/media/starter/credits.html?v=collection-2`.

**All eight new photos are visible in Dashboard → Media folder**, and selectable
in the Hero/Journey image pickers. These are marked `(bundled)`; their library
entries come from the curated manifest, not database upload rows. They are
protected against deletion because the website uses them as defaults. Choose a
replacement in a section editor to change its photo. The previous eight files
remain on disk for saved links; the old default paths display the new collection
in Hero/Journey. Your custom image URLs are never replaced.

To add your own: Dashboard → Media folder → Upload, then select that image in
Sections → Hero or Journey Showcase → Edit. Your uploads are saved on the server
in `media/` (or your configured MEDIA_DIR), indexed in the database, visible in
the same library, and can be deleted normally. No browser-only storage is used.

You can also place new files directly here and paste `/media/my-photo.jpg` into
an image field. Direct filesystem additions do not automatically create library
records. Keep `media/` during updates and include it in your backups. A release
contains only `media/starter/`, never your private/runtime uploads. Custom
MEDIA_DIR installations still serve the bundled collection from the app folder.
