/**
 * Downloads Noto Sans TTFs (Regular + Bold, OFL licensed) into public/fonts/
 * so the PDF editor can redraw edited text in a matching font family.
 * Runs automatically before `next build` (see package.json "prebuild").
 *
 * Fail-soft: if the download fails, the editor falls back to Helvetica —
 * the build must never break because of a font CDN hiccup.
 */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public', 'fonts');

const FONTS = [
  {
    file: 'NotoSans-Regular.ttf',
    url: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans@0.2.3/NotoSans_400Regular.ttf',
  },
  {
    file: 'NotoSans-Bold.ttf',
    url: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans@0.2.3/NotoSans_700Bold.ttf',
  },
];

mkdirSync(dest, { recursive: true });

let ok = true;
for (const f of FONTS) {
  const target = join(dest, f.file);
  if (existsSync(target)) {
    console.log(`[fetch-editor-fonts] cached: ${f.file}`);
    continue;
  }
  try {
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 50_000 || buf.subarray(0, 4).toString('latin1') !== '\x00\x01\x00\x00') {
      throw new Error('not a valid TTF (bad magic/size)');
    }
    writeFileSync(target, buf);
    console.log(`[fetch-editor-fonts] downloaded: ${f.file} (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    ok = false;
    console.warn(`[fetch-editor-fonts] FAILED ${f.file}: ${e.message} — editor will use Helvetica fallback`);
  }
}
if (!ok) console.warn('[fetch-editor-fonts] some fonts missing; continuing with fallback');
