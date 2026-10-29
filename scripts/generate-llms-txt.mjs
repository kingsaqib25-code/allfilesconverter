/**
 * Generates AI-crawler reference files from the converter registry so they
 * never go stale. Runs automatically before `next build` (prebuild).
 *
 * Outputs:
 *   public/llms.txt                   — concise site reference (summary, categories, every tool w/ 1-line description + URL)
 *   public/llms-full.txt              — complete reference (per tool: about text, use cases, FAQs)
 *   src/lib/site-summary.generated.ts — FULL_SITE_SUMMARY + PAGE_SUMMARIES for the AI-summary panels
 *
 * Parsing is done per entry-block with quote-aware scanning (handles
 * multi-line strings and escaped quotes), so entry field order and line
 * breaks never break the generator.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = 'https://allinoneconverter.vercel.app';

const src = readFileSync(join(root, 'src', 'lib', 'converters', 'registry.ts'), 'utf8');

function unesc(s) {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

/**
 * Extract a key: '...' single-quoted string (multi-line and escapes aware).
 * Tolerates the quote starting on the next line (e.g. description:\n '...').
 * Matches the FIRST occurrence — entry headers always come before body text.
 */
function extractQuoted(block, key) {
  const needle = key + ':';
  const idx = block.indexOf(needle);
  if (idx === -1) return '';
  let i = idx + needle.length;
  while (i < block.length && /\s/.test(block[i])) i++;
  if (block[i] !== "'") return '';
  i++;
  let out = '';
  while (i < block.length) {
    const ch = block[i];
    if (ch === '\\' && i + 1 < block.length) {
      out += ch + block[i + 1];
      i += 2;
      continue;
    }
    if (ch === "'") break;
    out += ch;
    i++;
  }
  return unesc(out);
}

/** Extract all '...' items inside the first `key: [ ... ]` array. */
function extractStringArray(block, key) {
  const needle = key + ': [';
  const idx = block.indexOf(needle);
  if (idx === -1) return [];
  const slice = block.slice(idx, idx + 4000);
  const end = slice.indexOf('],');
  const body = end === -1 ? slice : slice.slice(0, end);
  const items = [];
  const re = /'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(body)) !== null) items.push(unesc(m[1]));
  return items;
}

/** Extract { q, a } pairs inside `extraFaqs: [ ... ]`. */
function extractExtraFaqs(block) {
  const needle = 'extraFaqs: [';
  const idx = block.indexOf(needle);
  if (idx === -1) return [];
  const slice = block.slice(idx, idx + 15000);
  const end = slice.indexOf('\n    ],');
  const body = end === -1 ? slice : slice.slice(0, end);
  const faqs = [];
  let pos = 0;
  for (let guard = 0; guard < 20; guard++) {
    const qi = body.indexOf('q: ', pos);
    if (qi === -1) break;
    const ai = body.indexOf('a: ', qi);
    if (ai === -1) break;
    const q = extractQuoted(body.slice(qi), 'q');
    const a = extractQuoted(body.slice(ai), 'a');
    if (q) faqs.push({ q, a: a.replace(/\s+/g, ' ').trim() });
    pos = ai + 3;
  }
  return faqs;
}

/**
 * Split a `const NAME ... = [ ... ];` array region into entry blocks.
 * Entries may be separated by // or /* *\/ comment lines, so allow for them.
 */
function entryBlocks(regionSrc) {
  const arrStart = regionSrc.indexOf('[');
  const arrEnd = regionSrc.lastIndexOf('];');
  const body = regionSrc.slice(arrStart + 1, arrEnd);
  return body.split(/\n  \},\n(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\n)?  \{/).map((b) => b.trim());
}

function clean(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

// ---- Parse CATEGORIES ----
const catRegionStart = src.indexOf('export const CATEGORIES');
const catRegion = src.slice(catRegionStart, src.indexOf('];', catRegionStart) + 2);
const categories = entryBlocks(catRegion)
  .map((b) => ({
    id: extractQuoted(b, 'id'),
    name: extractQuoted(b, 'name'),
    tagline: clean(extractQuoted(b, 'tagline')),
    description: clean(extractQuoted(b, 'description')),
  }))
  .filter((c) => c.id);

// ---- Parse PAIRS ----
const pairsStart = src.indexOf('const PAIRS');
const pairsRegion = src.slice(pairsStart, src.indexOf('\n];', pairsStart) + 3);
const converters = entryBlocks(pairsRegion)
  .map((b) => {
    const id = extractQuoted(b, 'id');
    if (!id) return null;
    const from = extractQuoted(b, 'from');
    const to = extractQuoted(b, 'to');
    return {
      id,
      from,
      to,
      category: extractQuoted(b, 'category'),
      title: extractQuoted(b, 'title') || (from + ' to ' + to + ' Converter'),
      blurb: clean(extractQuoted(b, 'blurb')),
      aboutFrom: clean(extractQuoted(b, 'aboutFrom')),
      aboutTo: clean(extractQuoted(b, 'aboutTo')),
      tip: clean(extractQuoted(b, 'tip')),
      useCases: extractStringArray(b, 'useCases'),
      faqQ: clean(extractQuoted(b, 'faqQ')),
      faqA: clean(extractQuoted(b, 'faqA')),
      extraFaqs: extractExtraFaqs(b),
      flagship: b.indexOf('flagship: true') !== -1,
    };
  })
  .filter(Boolean);

// ---- Parse STANDALONE_TOOLS ----
const stStart = src.indexOf('export const STANDALONE_TOOLS');
const stRegion = src.slice(stStart, src.indexOf('];', stStart) + 2);
const standalone = entryBlocks(stRegion)
  .map((b) => ({
    id: extractQuoted(b, 'id'),
    title: extractQuoted(b, 'title'),
    description: clean(extractQuoted(b, 'description')),
    href: extractQuoted(b, 'href'),
    category: extractQuoted(b, 'category'),
  }))
  .filter((t) => t.id);

// ---- Extra flagship pages not in the registry ----
const extraPages = [
  {
    id: 'gif-maker',
    title: 'Video to GIF Maker',
    description:
      'Turn any video into an animated GIF: trim the exact moment, set width, FPS and quality, two-pass palette rendering for crisp colors. Runs in your browser, no watermark, free forever.',
    href: '/gif-maker/',
    category: 'video',
  },
];

const plural = (n, s) => n + ' ' + s + (n === 1 ? '' : 's');
const toolsInCat = (id) =>
  converters.filter((x) => x.category === id).length +
  standalone.filter((x) => x.category === id).length +
  extraPages.filter((x) => x.category === id).length;
const allTools = converters.concat(standalone, extraPages);
const toolUrl = (t) => (t.href ? SITE_URL + t.href : SITE_URL + '/convert/' + t.id + '/');

/** First sentence of a blurb, capped — the 1-line description. */
function oneLine(s) {
  const first = (s || '').split(/(?<=[.!?])\s/)[0] || s || '';
  return first.length > 220 ? first.slice(0, 217) + '…' : first;
}

const SITE_SUMMARY =
  'Quick Files Converter (' + SITE_URL + '/) is a free file-conversion website with ' + allTools.length + ' online tools. ' +
  "Every tool converts files entirely on the visitor's device using web technology (Canvas, WebAssembly, File API) — " +
  'there is no server-side processing, no database, no user accounts, no sign-up and no watermarks. ' +
  'Tool categories: ' + categories.map((c) => c.name + ' (' + plural(toolsInCat(c.id), 'tool') + ')').join(', ') + '. ' +
  'Flagship tools include the Video to GIF Maker, Edit PDF, Merge PDF, Compress PDF, HEIC to JPG and MP4 to MP3. ' +
  "Privacy policy: files never leave the visitor's device; nothing is uploaded anywhere; " +
  'the "Summarize with AI" buttons only share a page\'s public summary text with the chosen AI, never the visitor\'s files.';

// ================= llms.txt (concise) =================
const L = [];
L.push('# Quick Files Converter');
L.push('');
L.push('> Free online file converters that run 100% in your browser. No uploads, no sign-up, no watermarks, no accounts.');
L.push('');
L.push('## What this site is');
L.push('');
L.push(SITE_SUMMARY);
L.push('');
L.push('## Privacy / no-upload policy');
L.push('');
L.push('— Files never leave the visitor\u2019s device. Nothing is uploaded anywhere.');
L.push('— No server processes files; there is no database and no user accounts.');
L.push('— Conversions are free forever with no watermarks and no sign-up.');
L.push('— The "Summarize with AI" buttons only share a page\u2019s public summary text with the chosen AI \u2014 never the visitor\u2019s files.');
L.push('');
L.push('## Flagship tools');
L.push('');
const flagships = converters.filter((c) => c.flagship).concat(extraPages, standalone);
for (const t of flagships) {
  L.push('- ' + toolUrl(t) + ' — ' + t.title + ': ' + oneLine(t.blurb || t.description));
}
L.push('');
for (const cat of categories) {
  const inCat = allTools.filter((t) => t.category === cat.id);
  if (inCat.length === 0) continue;
  L.push('## ' + cat.name + ' (' + inCat.length + ')');
  L.push('');
  L.push(cat.description);
  L.push('');
  for (const t of inCat) {
    L.push('- ' + toolUrl(t) + ' — ' + t.title + ': ' + oneLine(t.blurb || t.description));
  }
  L.push('');
}
L.push('## Site pages');
L.push('');
L.push('- ' + SITE_URL + '/ — home, all tools');
L.push('- ' + SITE_URL + '/all-converters/ — every converter grouped by category');
L.push('- ' + SITE_URL + '/contact/ — contact');
L.push('- ' + SITE_URL + '/privacy/ — privacy policy');
L.push('- ' + SITE_URL + '/llms.txt — this file (concise AI reference)');
L.push('- ' + SITE_URL + '/llms-full.txt — complete AI reference (every tool in full detail)');
L.push('');

mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'public', 'llms.txt'), L.join('\n'), 'utf8');
console.log('[generate-llms-txt] wrote public/llms.txt (' + allTools.length + ' tools)');

// ================= llms-full.txt (complete) =================
const F = [];
F.push('# Quick Files Converter — complete reference');
F.push('');
F.push('> Full detail for AI assistants. For the concise version see /llms.txt.');
F.push('');
F.push('## Site summary');
F.push('');
F.push(SITE_SUMMARY);
F.push('');
for (const cat of categories) {
  const inCat = allTools.filter((t) => t.category === cat.id);
  if (inCat.length === 0) continue;
  F.push('## ' + cat.name);
  F.push('');
  F.push(cat.description);
  F.push('');
  for (const t of inCat) {
    F.push('### ' + t.title);
    F.push('');
    F.push('URL: ' + toolUrl(t));
    F.push('');
    const blurb = t.blurb || t.description;
    if (blurb) {
      F.push('What it does:');
      F.push(blurb);
      F.push('');
    }
    if (t.aboutFrom) {
      F.push('About the source format (' + (t.from || 'input') + '):');
      F.push(t.aboutFrom);
      F.push('');
    }
    if (t.aboutTo) {
      F.push('About the target format (' + (t.to || 'output') + '):');
      F.push(t.aboutTo);
      F.push('');
    }
    if (t.useCases && t.useCases.length) {
      F.push('Use cases:');
      for (const u of t.useCases) F.push('- ' + u);
      F.push('');
    }
    if (t.tip) {
      F.push('Tip: ' + t.tip);
      F.push('');
    }
    const faqs = [];
    if (t.faqQ) faqs.push({ q: t.faqQ, a: t.faqA });
    for (const f of t.extraFaqs || []) faqs.push(f);
    if (faqs.length) {
      F.push('FAQs:');
      for (const f of faqs.slice(0, 6)) {
        F.push('Q: ' + f.q);
        F.push('A: ' + f.a);
        F.push('');
      }
    }
  }
}
writeFileSync(join(root, 'public', 'llms-full.txt'), F.join('\n'), 'utf8');
console.log('[generate-llms-txt] wrote public/llms-full.txt (' + allTools.length + ' tools)');

// ================= src/lib/site-summary.generated.ts =================
const FULL_SITE_SUMMARY =
  'Quick Files Converter (' + SITE_URL + '/) is a free file-conversion website with ' + allTools.length + ' online tools covering ' +
  categories.map((c) => c.name.replace(' Converters', '').replace('File Tools', 'file utilities')).join(', ') + '. ' +
  'Every tool runs 100% on your device — Canvas, WebAssembly and the File API do the conversion inside your browser. ' +
  'There are no uploads, no servers processing files, no accounts and no sign-up. Everything is free forever with no watermarks. ' +
  'How it works: pick any converter, drop your file, adjust options if you like, and download the result in seconds. ' +
  'Privacy: your files never leave your device — they literally cannot leak because nothing is sent anywhere. ' +
  'The "Summarize with AI" button on each page only shares that page\'s public summary text with the AI, never your files. ' +
  'Flagship tools: Video to GIF Maker (trim, width/FPS/quality, two-pass palette), Edit PDF (click any text to edit, live preview), ' +
  'Merge PDF, Compress PDF, HEIC to JPG, MP4 to MP3, Bulk File Renamer (500 files, live preview, ZIP download). ' +
  'Also on the site: a full A–Z converter list, per-category pages, instant search, a suggestion box, and help/FAQ content on every tool page.';

/** Per-path summary for the header "Summary" button (mirrors src/lib/ai.ts format). */
function pageSummaryFor(t) {
  if (t.blurb || t.from) {
    const parts = [
      t.title + '.',
      t.blurb || t.description,
      'TL;DR: Drop a ' + t.from + ' file, get a ' + t.to + ' file back in seconds. Free forever, no sign-up — and your file never leaves your device because the conversion runs in your browser.',
    ];
    if (t.aboutFrom) parts.push('About ' + t.from + ': ' + t.aboutFrom);
    if (t.aboutTo) parts.push('About ' + t.to + ': ' + t.aboutTo);
    return parts.join(' ');
  }
  return (t.title + '. ' + (t.description || '')).trim();
}

const pageSummaries = { '/': FULL_SITE_SUMMARY };
for (const c of converters) pageSummaries['/convert/' + c.id + '/'] = pageSummaryFor(c);
for (const t of standalone) {
  const href = t.href.endsWith('/') ? t.href : t.href + '/';
  pageSummaries[href] = pageSummaryFor(t);
}
for (const t of extraPages) pageSummaries[t.href] = pageSummaryFor(t);
for (const cat of categories) pageSummaries['/categories/' + cat.id + '/'] = cat.name + '. ' + cat.description;
pageSummaries['/all-converters/'] =
  'All converters on Quick Files Converter: every free file converter grouped by category — ' +
  categories.map((c) => c.name).join(', ') + '. Each one runs entirely in your browser: no uploads, no sign-up, free forever.';
pageSummaries['/about/'] =
  'About Quick Files Converter: a free file-conversion website where every tool runs 100% in your browser. No uploads, no accounts, no watermarks — your files never leave your device.';
pageSummaries['/contact/'] = 'Contact Quick Files Converter: reach the site owner for tool requests, bug reports and feedback.';
pageSummaries['/privacy/'] = 'Privacy policy of Quick Files Converter: files are processed on-device and never uploaded; no accounts, no tracking of file contents.';

const tsOut =
  '/**\n' +
  ' * AUTO-GENERATED by scripts/generate-llms-txt.mjs — do not edit by hand.\n' +
  ' * Full-site summary used by the homepage "Summarize with AI" panel so AI\n' +
  ' * assistants (ChatGPT, Copilot, Grok, Claude, Perplexity, Bing, Apple AI)\n' +
  ' * instantly understand the whole website, like a sitemap in prose.\n' +
  ' * PAGE_SUMMARIES powers the header "Summary" button on every page.\n' +
  ' */\n' +
  'export const FULL_SITE_SUMMARY = ' + JSON.stringify(FULL_SITE_SUMMARY) + ';\n' +
  'export const SITE_TOOL_COUNT = ' + allTools.length + ';\n' +
  'export const PAGE_SUMMARIES: Record<string, string> = ' + JSON.stringify(pageSummaries, null, 2) + ';\n';
writeFileSync(join(root, 'src', 'lib', 'site-summary.generated.ts'), tsOut, 'utf8');
console.log('[generate-llms-txt] wrote src/lib/site-summary.generated.ts');
