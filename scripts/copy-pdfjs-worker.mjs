/**
 * Copies the pinned pdf.js worker from node_modules/pdfjs-dist into
 * public/pdfjs/ so the site serves it itself — no runtime CDN dependency.
 * Runs automatically before `next build` (see package.json "prebuild").
 */
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');
const dest = join(root, 'public', 'pdfjs');

if (!existsSync(src)) {
  console.error(`[copy-pdfjs-worker] missing: ${src} — did npm install run?`);
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
cpSync(src, join(dest, 'pdf.worker.min.mjs'));
console.log('[copy-pdfjs-worker] done');
