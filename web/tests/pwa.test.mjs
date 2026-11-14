// Prüft PWA-Grundlagen: Offline-Cache vollständig, Manifest, keine externen Server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(webRoot, p), 'utf8');

function appFiles(dir = webRoot) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(webRoot, full);
    if (['tests', 'package.json', 'sw.js', '.nojekyll'].includes(rel) || name.startsWith('.')) continue;
    if (statSync(full).isDirectory()) out.push(...appFiles(full));
    else out.push(`./${rel.split('\\').join('/')}`);
  }
  return out.sort();
}

const swAssets = () => {
  const match = read('sw.js').match(/const ASSETS = \[([\s\S]*?)\];/);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

test('Service Worker cached jede Datei der App', () => {
  const assets = swAssets();
  for (const file of appFiles()) assert.ok(assets.includes(file), `fehlt im Cache: ${file}`);
  assert.ok(assets.includes('./'), 'Startseite fehlt');
  for (const asset of assets.filter((a) => a !== './')) {
    assert.doesNotThrow(() => statSync(join(webRoot, asset)), `Datei existiert nicht: ${asset}`);
  }
});

test('Keine externen Server, CDNs oder Tracker', () => {
  for (const file of [...appFiles().filter((f) => /\.(html|js|css|webmanifest)$/.test(f)), './sw.js']) {
    const text = read(file);
    assert.doesNotMatch(text, /https?:\/\/(?!www\.w3\.org)/, `externe URL in ${file}`);
  }
});

test('Manifest: eigener Name, Vollbild, Icons vorhanden', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.short_name, 'Karteikarten');
  assert.equal(manifest.display, 'standalone');
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  for (const icon of manifest.icons) statSync(join(webRoot, icon.src));
});

test('index.html: apple-touch-icon 180×180, Vollbild, Safe Areas', () => {
  const html = read('index.html');
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="icons\/apple-touch-icon.png"/);
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /apple-mobile-web-app-title" content="Karteikarten"/);
  assert.match(html, /viewport-fit=cover/);
  const png = readFileSync(join(webRoot, 'icons/apple-touch-icon.png'));
  assert.equal(png.readUInt32BE(16), 180);
  assert.equal(png.readUInt32BE(20), 180);
  assert.match(read('css/app.css'), /safe-area-inset-bottom/);
});
