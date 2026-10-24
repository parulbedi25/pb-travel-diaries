# PB media folder

Drop photos here (JPG, PNG, WEBP) and they are served as:

```
/media/your-file-name.jpg
```

You can paste that path into any image field in the admin dashboard.

**Easier option:** open `#/admin` → **Media** and upload from your computer. Uploads are written to the server’s `media/` folder and can be picked on any section without an internet URL.

## `starter/` — photographs that ship with the website

The eight photos in `starter/` are illustrative travel photographs bundled with
the site, so the Hero and Journey sections have pictures on a fresh install.
They appear in **Dashboard → Media** alongside your uploads and can be picked on
any image field, but they cannot be deleted from the dashboard because they are
part of the website rather than of the upload folder.

Replace any of them by uploading your own photo and choosing it in the section
editor — nothing points at them permanently.

Their authors, sources and Creative Commons licences are listed in
`starter/credits.json` and at `/media/starter/credits.html`. They are not
photographs taken by PB, and no endorsement is implied.
