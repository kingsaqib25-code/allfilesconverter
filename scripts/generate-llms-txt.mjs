/**
 * Generates public/llms.txt — a markdown summary of the whole site for AI
 * crawlers (GEO). Tool list is extracted from the converter registry so it
 * never goes stale. Runs automatically before `next build` (prebuild).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = 'https://allfilesconverter.vercel.app';

const src = readFileSync(join(root, 'src', 'lib', 'converters', 'registry.ts'), 'utf8');

function unesc(s) {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

// Categories: `    id: 'image',\n    name: 'Image Converters',`
const categories = [];
const catRe = /    id: '(\w+)',\n    name: '([^']+)',/g;
let m;
while ((m = catRe.exec(src)) !== null) {
  categories.push({ id: m[1], name: m[2] });
}

// Converters: `    id: 'x-to-y', from: 'X', to: 'Y', ... category: 'image',`
const converters = [];
const convRe =
  /    id: '([^']+)', from: '((?:[^'\\]|\\.)*)', to: '((?:[^'\\]|\\.)*)', fromExts: \[[^\]]*\], toExt: '[^']*', category: '(\w+)',/g;
while ((m = convRe.exec(src)) !== null) {
  const after = src.slice(m.index + m[0].length, m.index + m[0].length + 80);
  const t = after.match(/^\n    title: '([^']+)',/);
  const fromU = unesc(m[2]);
  const toU = unesc(m[3]);
  converters.push({
    id: m[1],
    from: fromU,
    to: toU,
    category: m[4],
    title: t ? t[1] : `${fromU} to ${toU} Converter`,
  });
}

const catName = (id) => (categories.find((c) => c.id === id) || { name: id }).name;

const lines = [];
lines.push('# Quick Files Converter');
lines.push('');
lines.push(
  '> Free online file converters that run 100% in your browser. No uploads, no sign-up, no watermarks, no accounts.'
);
lines.push('');
lines.push('## What this site is');
lines.push('');
lines.push(
  `Quick Files Converter (${SITE_URL}/) is a free file-conversion website. Every tool converts files ` +
    `entirely on the visitor's device using web technology (Canvas, WebAssembly, File API). ` +
    `There is no server-side processing, no database and no user accounts.`
);
lines.push('');
lines.push('## Privacy / no-upload policy');
lines.push('');
lines.push('- Files never leave the visitor\u2019s device. Nothing is uploaded anywhere.');
lines.push('- No server processes files; there is no database and no user accounts.');
lines.push('- Conversions are free forever with no watermarks and no sign-up.');
lines.push('- The "Summarize this page with AI" buttons only share the page\\u2019s public summary text with the chosen AI — never the visitor\\u2019s files.');
lines.push('');
lines.push('## Flagship tools');
lines.push('');
lines.push(
  `- ${SITE_URL}/gif-maker/ \u2014 Video to GIF Maker: trim, set width/FPS/quality, two-pass palette rendering, no watermark.`
);
lines.push(
  `- ${SITE_URL}/convert/heic-to-jpg/ \u2014 HEIC to JPG Converter (iPhone photos to universal JPG).`
);
lines.push(
  `- ${SITE_URL}/convert/mp4-to-mp3/ \u2014 MP4 to MP3 Converter (extract 192 kbps audio from video).`
);
lines.push('');
lines.push(`## All converters (${converters.length})`);
lines.push('');
for (const cat of categories) {
  lines.push(`### ${cat.name}`);
  lines.push('');
  for (const c of converters.filter((x) => x.category === cat.id)) {
    lines.push(`- ${SITE_URL}/convert/${c.id}/ \u2014 ${c.title}`);
  }
  lines.push('');
}
lines.push('## Contact');
lines.push('');
lines.push(`- ${SITE_URL}/contact`);
lines.push('');

mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'public', 'llms.txt'), lines.join('\n'), 'utf8');
console.log(`[generate-llms-txt] wrote public/llms.txt (${converters.length} converters)`);
