/**
 * Copies the pinned single-threaded ffmpeg.wasm core files from
 * node_modules/@ffmpeg/core into public/ffmpeg-core/ so the site serves
 * them itself — no runtime CDN dependency.
 * Runs automatically before `next build` (see package.json "prebuild").
 */
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'umd');
const dest = join(root, 'public', 'ffmpeg-core');

const FILES = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

if (!existsSync(src)) {
  console.error(`[copy-ffmpeg-core] missing: ${src} — did npm install run?`);
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
for (const f of FILES) {
  const from = join(src, f);
  if (!existsSync(from)) {
    console.error(`[copy-ffmpeg-core] missing file: ${from}`);
    process.exit(1);
  }
  cpSync(from, join(dest, f));
  console.log(`[copy-ffmpeg-core] copied ${f}`);
}
console.log('[copy-ffmpeg-core] done');
