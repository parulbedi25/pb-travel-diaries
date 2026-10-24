import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

// Only explicitly curated photographs are exposed, not arbitrary server files.
// Bundled entries are derived from shipped files, so fresh installs and existing
// databases see the same library without startup writes or duplicate DB rows.
const directory = path.join(config.root, 'media/starter');
const credits = JSON.parse(await fs.readFile(path.join(directory, 'credits.json'), 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '[]'; // Optional collection in custom/minimal app roots.
  throw error;
}));
export const bundledMedia = await Promise.all(credits.filter(photo => photo.library === true).map(async photo => {
  if (!/^[a-z0-9-]+\.(webp|mp4)$/.test(photo.file)) throw new Error('Invalid bundled media filename');
  const video = photo.file.endsWith(".mp4");
  const stat = await fs.stat(path.join(directory, photo.file));
  const url = `/media/starter/${photo.file}`;
  return {
    id: `bundled:${photo.file}`, name: `${photo.title} (bundled)`,
    type: video ? 'video/mp4' : 'image/webp', size: stat.size, dataUrl: url, url,
    addedAt: '', kind: video ? 'video' : 'image', ext: video ? 'mp4' : 'webp', bundled: true,
    attributionUrl: '/media/starter/credits.html?v=collection-2',
  };
}));
