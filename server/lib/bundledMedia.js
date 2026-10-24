import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

/**
 * Photographs that ship with the website.
 *
 * They live in public/media/starter and are served from the same /media URL as
 * an upload, so a section can point at one exactly like a file the owner added.
 * The library table only indexes uploads, so these are listed alongside it
 * rather than inserted into it: a fresh install and a database that has been
 * running for a year both see the same shelf, with no startup writes and no
 * duplicate rows.
 *
 * Only the files named in credits.json are exposed, so dropping an unrelated
 * file into the folder does not quietly publish it.
 */
const directory = path.join(config.root, "public/media/starter");

const credits = JSON.parse(
  await fs.readFile(path.join(directory, "credits.json"), "utf8").catch((error) => {
    // Optional collection: a custom app root may not ship these.
    if (error.code === "ENOENT") return "[]";
    throw error;
  }),
);

/** The kinds a bundled file may be, so `kind` matches what an upload would get. */
const TYPES_BY_EXT = {
  webp: { kind: "image", type: "image/webp" },
  mp4: { kind: "video", type: "video/mp4" },
  webm: { kind: "video", type: "video/webm" },
};

export const bundledMedia = (
  await Promise.all(
    credits
      .filter((photo) => photo.library === true)
      .map(async (photo) => {
        const match = /^[a-z0-9-]+\.(webp|mp4|webm)$/.exec(photo.file);
        if (!match) {
          throw new Error("Invalid bundled media filename");
        }
        const ext = match[1];
        const { kind, type } = TYPES_BY_EXT[ext];
        const stat = await fs.stat(path.join(directory, photo.file));
        const url = `/media/starter/${photo.file}`;
        return {
          id: `bundled:${photo.file}`,
          name: `${photo.title} (bundled)`,
          type,
          size: stat.size,
          dataUrl: url,
          url,
          addedAt: "",
          kind,
          ext,
          // Read-only: the bytes are part of the website, so the dashboard can
          // pick them but must not offer to delete them.
          bundled: true,
          attributionUrl: "/media/starter/credits.html",
        };
      }),
  )
).sort((a, b) => a.name.localeCompare(b.name));
