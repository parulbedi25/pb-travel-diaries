import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const source = fs.readFileSync(new URL('../../src/utils/starterPhotos.ts', import.meta.url), 'utf8');
const { resolveStarterPhoto } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const html = fs.readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');
const compiled = html.match(/const PB_REFRESHED_PHOTOS=.*?function PBresolveStarterPhoto\(value,fallback\)\{[^}]+\}/)?.[0];
assert.ok(compiled, 'shipped bundle includes the same resolver');
const bundledResolver = vm.runInNewContext(`${compiled}; PBresolveStarterPhoto`);
const replacements = {
  ladakh: 'ladakh-pangong', nubra: 'nubra-diskit', spiti: 'spiti-dhankar',
  rajasthan: 'rajasthan-jaipur', varanasi: 'varanasi-sunrise',
  meghalaya: 'meghalaya-dawki', kerala: 'kerala-munnar', goa: 'goa-agonda',
};

test('source and production bundle upgrade all eight previous bundled defaults', () => {
  for (const resolve of [resolveStarterPhoto, bundledResolver]) {
    for (const [old, next] of Object.entries(replacements)) {
      assert.equal(resolve(`/media/starter/${old}.webp`, ''), `/media/starter/${next}.webp`);
    }
  }
});

test('source and production bundle preserve custom URLs and use fallbacks only for empty fields', () => {
  for (const resolve of [resolveStarterPhoto, bundledResolver]) {
    for (const custom of ['/media/my-photo.webp', 'https://example.com/photo.jpg', 'idb:custom-photo']) {
      assert.equal(resolve(custom, '/media/starter/ladakh-pangong.webp'), custom);
    }
    assert.equal(resolve('', '/media/starter/ladakh-pangong.webp'), '/media/starter/ladakh-pangong.webp');
    assert.equal(resolve(undefined, '/media/starter/ladakh-pangong.webp'), '/media/starter/ladakh-pangong.webp');
  }
});
