/**
 * Text-to-PDF editor engine — shared by the live preview and the download.
 *
 * The preview and the downloaded PDF run the EXACT same pagination, so what
 * the user sees on screen is what lands in the file. Everything is measured
 * with real pdf-lib font metrics (via a MeasureFn), never estimated.
 *
 * Document model: Block[] — paragraphs, headings and list items, each made
 * of styled runs (bold / italic / underline / code). The editor produces
 * blocks from its HTML; plain text and .txt uploads go through
 * textToBlocks(), which understands # headings, - bullets, 1. lists and
 * **bold** / *italic* / `code` markers.
 *
 * 100% on-device: pdf-lib builds the file in the visitor's browser.
 */

import { PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFFont, type PDFImage, type RGB } from 'pdf-lib';
// fontkit's Indic (Devanagari/Bengali) shaper needs the regenerator runtime
// as a global; without it, shaping throws and those scripts fall back to '?'.
import 'regenerator-runtime/runtime';
import { safeWinAnsi, sanitizeDrawText } from './pdf';
import { getFontDef } from '../fonts';

export type TextPdfAlign = 'left' | 'center' | 'right' | 'justify';
/** Font id from the registry (src/lib/fonts.ts) — e.g. 'helvetica', 'roboto', 'urdu'. */
export type TextPdfFont = string;
export type TextPdfPageSize = 'a4' | 'letter';
export type TextPdfOrientation = 'portrait' | 'landscape';

export interface TextPdfSettings {
  font: TextPdfFont;
  fontSize: number; // pt
  lineHeight: number; // multiplier, e.g. 1.5
  align: TextPdfAlign;
  margin: number; // pt
  pageSize: TextPdfPageSize;
  orientation: TextPdfOrientation;
  /** Hex colour for all body text, e.g. '#000000'. */
  color: string;
  title: string;
  pageNumbers: boolean;
}

export const DEFAULT_TEXT_PDF_SETTINGS: TextPdfSettings = {
  font: 'helvetica',
  fontSize: 12,
  lineHeight: 1.5,
  align: 'left',
  margin: 56,
  pageSize: 'a4',
  orientation: 'portrait',
  color: '#000000',
  title: '',
  pageNumbers: true,
};

export const PAGE_SIZES: Record<TextPdfPageSize, { width: number; height: number; label: string }> = {
  a4: { width: 595, height: 842, label: 'A4' },
  letter: { width: 612, height: 792, label: 'Letter (US)' },
};

export function pageDimensions(settings: TextPdfSettings): { width: number; height: number } {
  const base = PAGE_SIZES[settings.pageSize];
  return settings.orientation === 'landscape'
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };
}

export const MARGIN_CHOICES = [
  { value: 40, label: 'Narrow' },
  { value: 56, label: 'Normal' },
  { value: 72, label: 'Wide' },
] as const;

export type RunStyle = 'regular' | 'bold' | 'italic' | 'boldItalic' | 'code' | 'codeBold';

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  code?: boolean;
  /** Hyperlink target (http/https/mailto). Rendered clickable in the PDF. */
  link?: string;
  /** Strikethrough. */
  strike?: boolean;
  /** Per-selection text colour (#hex or rgb()), overrides the document colour. */
  color?: string;
  /** Per-selection highlight colour (#hex or rgb()). */
  highlight?: string;
}

export type BlockKind = 'para' | 'h1' | 'h2' | 'bullet' | 'number' | 'image';

export interface Block {
  kind: BlockKind;
  runs: TextRun[];
  /** Per-paragraph alignment (Word-style toolbar); defaults to the document setting. */
  align?: TextPdfAlign;
  /** For kind === 'image': the picture, sized in points at its natural size. */
  image?: { src: string; width: number; height: number };
}

export interface PdfWord {
  runs: TextRun[];
  width: number;
}

export interface PdfLine {
  words: PdfWord[];
  width: number;
  blank: boolean;
  kind: BlockKind;
  /** Point size this line renders at. */
  size: number;
  /** Line height in points. */
  lineH: number;
  /** Hanging indent for wrapped list lines (pt). */
  indent: number;
  /** Bullet / number drawn before the first visual line of a list item. */
  prefix?: { text: string; width: number };
  /** Rendered as the document title (bigger, bold, centered). */
  isTitle?: boolean;
  /** Last visual line of its paragraph (justify does not stretch it). */
  lastInPara: boolean;
  /** Effective alignment of this line (block setting, else document setting). */
  align: TextPdfAlign;
  /** For kind === 'image': the picture, already scaled to fit the text width. */
  image?: { src: string; width: number; height: number };
}

export interface PdfPage {
  lines: PdfLine[];
}

export type MeasureFn = (text: string, size: number, style: RunStyle) => number;

export function runStyle(run: TextRun): RunStyle {
  if (run.code) return run.bold ? 'codeBold' : 'code';
  if (run.bold && run.italic) return 'boldItalic';
  if (run.bold) return 'bold';
  if (run.italic) return 'italic';
  return 'regular';
}

/** Parse **bold**, *italic* and `code` markers inside one chunk of text. */
export function parseRuns(s: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /(\*\*.+?\*\*|\*[^*\n]+?\*|`[^`\n]+?`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ text: s.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith('**')) runs.push({ text: tok.slice(2, -2), bold: true });
    else if (tok.startsWith('`')) runs.push({ text: tok.slice(1, -1), code: true });
    else runs.push({ text: tok.slice(1, -1), italic: true });
    last = m.index + tok.length;
  }
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs.filter((r) => r.text);
}

/** Plain text (typed, pasted or uploaded) -> blocks. */
export function textToBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.replace(/\t/g, '    ').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      blocks.push({ kind: 'para', runs: [] });
      continue;
    }
    if (line.startsWith('# ')) {
      blocks.push({ kind: 'h1', runs: parseRuns(line.slice(2).trim()) });
    } else if (line.startsWith('## ')) {
      blocks.push({ kind: 'h2', runs: parseRuns(line.slice(3).trim()) });
    } else if (/^[-•]\s+/.test(line)) {
      blocks.push({ kind: 'bullet', runs: parseRuns(line.replace(/^[-•]\s+/, '')) });
    } else if (/^\d+[.)]\s+/.test(line)) {
      blocks.push({ kind: 'number', runs: parseRuns(line.replace(/^\d+[.)]\s+/, '')) });
    } else {
      blocks.push({ kind: 'para', runs: parseRuns(line) });
    }
  }
  return blocks;
}

const LIST_INDENT = 20; // pt

function blockSize(kind: BlockKind, settings: TextPdfSettings): number {
  if (kind === 'h1') return settings.fontSize + 8;
  if (kind === 'h2') return settings.fontSize + 4;
  return settings.fontSize;
}

/** Split one block's runs into words, each word carrying its styled runs.
 *  A word may span runs (e.g. hel**lo**) — it stays one word, no gap added. */
function blockWords(
  block: Block,
  size: number,
  measure: MeasureFn,
): PdfWord[] {
  const words: PdfWord[] = [];
  let cur: TextRun[] = [];
  let curW = 0;
  const flush = () => {
    if (cur.length > 0) {
      words.push({ runs: cur, width: curW });
      cur = [];
      curW = 0;
    }
  };
  for (const run of block.runs) {
    for (const part of run.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        flush();
      } else {
        const r: TextRun = { ...run, text: part };
        cur.push(r);
        curW += measure(part, size, runStyle(r));
      }
    }
  }
  flush();
  return words;
}

/** Hard-split one over-wide word into pieces that fit maxWidth. */
function splitWord(
  word: PdfWord,
  size: number,
  maxWidth: number,
  measure: MeasureFn,
): PdfWord[] {
  const pieces: PdfWord[] = [];
  let cur: TextRun[] = [];
  let curW = 0;
  for (const run of word.runs) {
    for (const ch of run.text) {
      const w = measure(ch, size, runStyle(run));
      if (curW + w > maxWidth && cur.length > 0) {
        pieces.push({ runs: cur, width: curW });
        cur = [];
        curW = 0;
      }
      cur.push({ ...run, text: ch });
      curW += w;
    }
  }
  if (cur.length > 0) pieces.push({ runs: cur, width: curW });
  return pieces.length > 0 ? pieces : [word];
}

/**
 * Wrap blocks into pages of lines. The title (when set) becomes the first
 * line of page 1, larger and centered, followed by a blank line. Headings
 * never strand alone at the bottom of a page.
 */
export function paginateBlocks(
  blocks: Block[],
  settings: TextPdfSettings,
  measure: MeasureFn,
): PdfPage[] {
  const { width: pageW, height: pageH } = pageDimensions(settings);
  const maxW = pageW - 2 * settings.margin;
  const maxH = pageH - 2 * settings.margin;
  const bodySize = settings.fontSize;

  const pages: PdfPage[] = [];
  let page: PdfLine[] = [];
  let usedH = 0;

  const pushLine = (line: PdfLine) => {
    if (usedH + line.lineH > maxH && page.length > 0) {
      pages.push({ lines: page });
      page = [];
      usedH = 0;
    }
    page.push(line);
    usedH += line.lineH;
  };

  const blankLine = (size: number): PdfLine => ({
    words: [],
    width: 0,
    blank: true,
    kind: 'para',
    size,
    lineH: size * settings.lineHeight,
    indent: 0,
    lastInPara: true,
    align: settings.align,
  });

  // Document title first.
  const title = settings.title.trim();
  if (title) {
    const titleSize = bodySize + 8;
    const titleBlocks = textToBlocks(title);
    const tBlock = titleBlocks[0] ?? { kind: 'para' as BlockKind, runs: [{ text: title }] };
    const rawTitleWords = blockWords({ ...tBlock, runs: tBlock.runs.map((r) => ({ ...r, bold: true })) }, titleSize, measure);
    // Long title words (e.g. a URL) get hard-split like body words.
    const words: PdfWord[] = [];
    for (const w of rawTitleWords) {
      if (w.width > maxW) words.push(...splitWord(w, titleSize, maxW, measure));
      else words.push(w);
    }
    const spaceW = measure(' ', titleSize, 'bold');
    let line: PdfWord[] = [];
    let lineW = 0;
    const flushTitle = (last: boolean) => {
      pushLine({
        words: line,
        width: lineW,
        blank: false,
        kind: 'para',
        size: titleSize,
        lineH: titleSize * 1.4,
        indent: 0,
        isTitle: true,
        lastInPara: last,
        align: 'center',
      });
      line = [];
      lineW = 0;
    };
    for (const w of words) {
      if (line.length > 0 && lineW + spaceW + w.width > maxW) flushTitle(false);
      if (line.length > 0) lineW += spaceW;
      line.push(w);
      lineW += w.width;
    }
    if (line.length > 0) flushTitle(true);
    pushLine(blankLine(bodySize));
  }

  let listNumber = 0;
  for (const block of blocks) {
    const size = blockSize(block.kind, settings);
    const lineH = size * settings.lineHeight;
    const isHeading = block.kind === 'h1' || block.kind === 'h2';
    const isList = block.kind === 'bullet' || block.kind === 'number';
    const textW = maxW - (isList ? LIST_INDENT : 0);

    if (block.kind === 'number') listNumber += 1;
    else if (!isList) listNumber = 0;

    // Image block: one line carrying the picture, scaled to the text width.
    if (block.kind === 'image' && block.image) {
      const availW = maxW;
      let iw = block.image.width;
      let ih = block.image.height;
      if (iw > 0 && ih > 0) {
        const s = Math.min(1, availW / iw, (maxH * 0.85) / ih);
        iw = Math.round(iw * s);
        ih = Math.round(ih * s);
      } else {
        iw = availW;
        ih = 300;
      }
      pushLine({
        words: [],
        width: 0,
        blank: false,
        kind: 'image',
        size,
        lineH: ih + 6,
        indent: 0,
        lastInPara: true,
        align: block.align ?? settings.align,
        image: { src: block.image.src, width: iw, height: ih },
      });
      continue;
    }

    if (block.runs.length === 0 || block.runs.every((r) => !r.text.trim())) {
      pushLine(blankLine(size));
      continue;
    }

    // Heading widow control: never leave a heading as the last line of a page.
    if (isHeading && page.length > 0 && usedH + lineH + bodySize * settings.lineHeight > maxH) {
      pages.push({ lines: page });
      page = [];
      usedH = 0;
    }
    // A little air above headings (not at the top of a page).
    if (isHeading && page.length > 0) {
      const gap = 6;
      if (usedH + gap + lineH > maxH) {
        pages.push({ lines: page });
        page = [];
        usedH = 0;
      } else {
        usedH += gap;
      }
    }

    let words = blockWords(block, size, measure);
    const expanded: PdfWord[] = [];
    for (const w of words) {
      if (w.width > textW) expanded.push(...splitWord(w, size, textW, measure));
      else expanded.push(w);
    }
    words = expanded;
    const spaceW = measure(' ', size, 'regular');

    let prefix: PdfLine['prefix'];
    if (block.kind === 'bullet') {
      prefix = { text: '•', width: measure('•', size, 'regular') };
    } else if (block.kind === 'number') {
      const label = `${listNumber}.`;
      prefix = { text: label, width: measure(label, size, 'regular') };
    }

    let line: PdfWord[] = [];
    let lineW = 0;
    let first = true;
    const blockAlign = block.align ?? settings.align;
    const flush = (last: boolean) => {
      pushLine({
        words: line,
        width: lineW,
        blank: false,
        kind: block.kind,
        size,
        lineH,
        indent: isList ? LIST_INDENT : 0,
        prefix: first ? prefix : undefined,
        lastInPara: last,
        align: blockAlign,
      });
      line = [];
      lineW = 0;
      first = false;
    };
    for (const w of words) {
      const gap = line.length > 0 ? spaceW : 0;
      if (line.length > 0 && lineW + gap + w.width > textW) flush(false);
      if (line.length > 0) lineW += spaceW;
      line.push(w);
      lineW += w.width;
    }
    if (line.length > 0) flush(true);
  }

  if (page.length > 0 || pages.length === 0) pages.push({ lines: page });
  return pages;
}

/** Plain-text convenience wrapper (kept for tests and uploads). */
export function paginateText(
  text: string,
  settings: TextPdfSettings,
  measure: MeasureFn,
): PdfPage[] {
  return paginateBlocks(textToBlocks(text), settings, measure);
}

const STANDARD_FONT_MAP: Record<string, Record<RunStyle, StandardFonts>> = {
  helvetica: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    boldItalic: StandardFonts.HelveticaBoldOblique,
    code: StandardFonts.Courier,
    codeBold: StandardFonts.CourierBold,
  },
  times: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic,
    boldItalic: StandardFonts.TimesRomanBoldItalic,
    code: StandardFonts.Courier,
    codeBold: StandardFonts.CourierBold,
  },
  courier: {
    regular: StandardFonts.Courier,
    bold: StandardFonts.CourierBold,
    italic: StandardFonts.CourierOblique,
    boldItalic: StandardFonts.CourierBoldOblique,
    code: StandardFonts.Courier,
    codeBold: StandardFonts.CourierBold,
  },
};

const FONT_STYLES = ['regular', 'bold', 'italic', 'boldItalic', 'code', 'codeBold'] as RunStyle[];

/** TTF bytes fetched from /fonts/, cached per file for the session. */
const fontBytesCache = new Map<string, Uint8Array>();
async function fetchFontBytes(file: string): Promise<Uint8Array | null> {
  const cached = fontBytesCache.get(file);
  if (cached) return cached;
  try {
    const res = await fetch(`/fonts/${file}`);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    // Smallest real font here is ~46 KB (Thai/Hebrew); anything under 10 KB
    // is a truncated download or an error page, not a font.
    if (buf.length < 10_000) return null;
    fontBytesCache.set(file, buf);
    return buf;
  } catch {
    return null;
  }
}

export interface LoadedFontSet {
  fonts: Map<RunStyle, PDFFont>;
  /** Styles whose font really is an embedded TTF (those may draw Unicode). */
  embedded: Set<RunStyle>;
  /** Fallback family (e.g. Urdu -> Arabic Naskh) for text the primary font cannot shape. */
  fallbackFonts?: Map<RunStyle, PDFFont>;
  fallbackEmbedded?: Set<RunStyle>;
  /** Helvetica standard fonts — last resort, always available. */
  helvFonts: Map<RunStyle, PDFFont>;
}

/**
 * Embed one family's fonts into a pdf-lib document. Standard families use
 * the built-in fonts; embedded families load their TTFs. A missing style
 * falls back to the family's regular TTF, then to Helvetica — so a missing
 * file can never throw or silently turn text into '?'.
 */
async function loadFontSet(doc: PDFDocument, fontId: string): Promise<LoadedFontSet> {
  const def = getFontDef(fontId);
  const fonts = new Map<RunStyle, PDFFont>();
  const embedded = new Set<RunStyle>();
  const helvFonts = new Map<RunStyle, PDFFont>();
  const std = STANDARD_FONT_MAP[def.id] ?? STANDARD_FONT_MAP.helvetica;
  for (const style of FONT_STYLES) helvFonts.set(style, await doc.embedFont(STANDARD_FONT_MAP.helvetica[style]));
  if (def.kind !== 'embedded' || !def.files) {
    for (const style of FONT_STYLES) fonts.set(style, await doc.embedFont(std[style]));
    return { fonts, embedded, helvFonts };
  }
  try {
    const { default: fontkit } = await import('@pdf-lib/fontkit');
    doc.registerFontkit(fontkit);
  } catch {
    // TTF embeds below fail-soft to Helvetica.
  }
  const embedTtf = async (bytes: Uint8Array | null): Promise<PDFFont | null> => {
    if (!bytes) return null;
    try {
      return await doc.embedFont(bytes);
    } catch {
      return null;
    }
  };
  const regularBytes = def.files.regular ? await fetchFontBytes(def.files.regular) : null;
  const regularFont = await embedTtf(regularBytes);
  const styleFile: Record<RunStyle, string | undefined> = {
    regular: def.files.regular,
    bold: def.files.bold ?? def.files.regular,
    italic: def.files.italic ?? def.files.regular,
    boldItalic: def.files.boldItalic ?? def.files.bold ?? def.files.regular,
    code: undefined,
    codeBold: undefined,
  };
  for (const style of FONT_STYLES) {
    if (style === 'code' || style === 'codeBold') {
      fonts.set(style, await doc.embedFont(std[style]));
      continue;
    }
    let font: PDFFont | null = null;
    if (style !== 'regular') {
      const file = styleFile[style];
      if (file && file !== def.files.regular) font = await embedTtf(await fetchFontBytes(file));
    }
    if (!font) font = regularFont;
    if (font) {
      fonts.set(style, font);
      embedded.add(style);
    } else {
      fonts.set(style, await doc.embedFont(std[style]));
    }
  }
  // Fallback family (Urdu Nastaliq cannot be shaped by fontkit, so its
  // runs fall back to Arabic Naskh — same script, correctly joined).
  let fallbackFonts: Map<RunStyle, PDFFont> | undefined;
  let fallbackEmbedded: Set<RunStyle> | undefined;
  if (def.pdfFallback) {
    const fb = await loadFontSet(doc, def.pdfFallback);
    fallbackFonts = fb.fonts;
    fallbackEmbedded = fb.embedded;
  }
  return { fonts, embedded, fallbackFonts, fallbackEmbedded, helvFonts };
}

/**
 * Pick the font for one run, probing whether the primary font can actually
 * shape this text. Some embedded fonts throw in fontkit on text they cannot
 * shape (Nastaliq, Devanagari, Bengali); the probe catches that and the run
 * falls back to the fallback family, then Helvetica — so a download can
 * never crash on a script. Latin text skips the probe (it always works).
 */
function makeFontPicker(set: LoadedFontSet): (style: RunStyle, text: string) => { font: PDFFont; embedded: boolean } {
  return (style, text) => {
    const primary = set.fonts.get(style) ?? set.fonts.get('regular')!;
    const primaryEmbedded = set.embedded.has(style);
    if (!primaryEmbedded || !/[^\x00-\xFF]/.test(text)) return { font: primary, embedded: primaryEmbedded };
    const candidates: Array<{ font: PDFFont; embedded: boolean }> = [{ font: primary, embedded: primaryEmbedded }];
    if (set.fallbackFonts) {
      const ff = set.fallbackFonts.get(style) ?? set.fallbackFonts.get('regular')!;
      candidates.push({ font: ff, embedded: set.fallbackEmbedded?.has(style) ?? false });
    }
    const hf = set.helvFonts.get(style) ?? set.helvFonts.get('regular')!;
    candidates.push({ font: hf, embedded: false });
    for (const c of candidates) {
      try {
        const clean = c.embedded ? sanitizeDrawText(text) : safeWinAnsi(text);
        c.font.widthOfTextAtSize(clean, 10);
        return c;
      } catch {
        // Try the next candidate.
      }
    }
    return candidates[candidates.length - 1];
  };
}

/** Live-preview measurement: embed the family's fonts once and measure with them. */
export async function createMeasureFn(font: TextPdfFont): Promise<MeasureFn> {
  const doc = await PDFDocument.create();
  const set = await loadFontSet(doc, font);
  const pick = makeFontPicker(set);
  return (t, size, style) => {
    const { font: f, embedded: emb } = pick(style, t);
    return f.widthOfTextAtSize(emb ? sanitizeDrawText(t) : safeWinAnsi(t), size);
  };
}

export function textPdfFilename(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug ? `${slug}.pdf` : 'text-to-pdf.pdf';
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Accept #rgb / #rrggbb / rgb(r,g,b) / rgba(...) (alpha ignored). Null when unparseable. */
export function parseColor(value: string | undefined): RGB | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v.startsWith('#')) {
    const h = v.slice(1);
    if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/.test(h)) return null;
    return hexToRgb(v);
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
  if (m) {
    return rgb(
      Math.min(255, Number(m[1])) / 255,
      Math.min(255, Number(m[2])) / 255,
      Math.min(255, Number(m[3])) / 255,
    );
  }
  return null;
}

/** Embed a data-URL image (PNG or JPEG only — other formats return null). */
async function embedDataImage(
  doc: PDFDocument,
  src: string,
): Promise<PDFImage | null> {
  const m = /^data:(image\/(png|jpeg|jpg));base64,(.*)$/s.exec(src);
  if (!m) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(m[3], 'base64'));
  } catch {
    return null;
  }
  try {
    return m[2] === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

/** Build the PDF bytes with the same pagination the preview shows. */
export async function buildTextPdf(blocks: Block[], settings: TextPdfSettings): Promise<Blob> {
  const doc = await PDFDocument.create();
  const set = await loadFontSet(doc, settings.font);
  const pick = makeFontPicker(set);
  const fonts = set.fonts;
  const measure: MeasureFn = (t, size, style) => {
    const { font: f, embedded: emb } = pick(style, t);
    return f.widthOfTextAtSize(emb ? sanitizeDrawText(t) : safeWinAnsi(t), size);
  };

  const pages = paginateBlocks(blocks, settings, measure);
  const { width: pageW, height: pageH } = pageDimensions(settings);
  const maxW = pageW - 2 * settings.margin;
  const textColor = hexToRgb(settings.color);
  const gray = rgb(0.45, 0.45, 0.45);
  const spaceW = measure(' ', settings.fontSize, 'regular');
  // Embed every picture once, before drawing (embedding is async).
  const imageCache = new Map<string, PDFImage | null>();
  for (const pg of pages) {
    for (const line of pg.lines) {
      if (line.image && !imageCache.has(line.image.src)) {
        imageCache.set(line.image.src, await embedDataImage(doc, line.image.src));
      }
    }
  }

  pages.forEach((pg, pi) => {
    const page = doc.addPage([pageW, pageH]);
    let y = pageH - settings.margin;
    for (const line of pg.lines) {
      const ls = line.size;
      if (line.image) {
        // Picture line: draw the embedded image, honouring the line's alignment.
        const img = imageCache.get(line.image.src);
        if (img) {
          const iw = line.image.width;
          const ih = line.image.height;
          let ix = settings.margin;
          if (line.align === 'center') ix = settings.margin + (maxW - iw) / 2;
          else if (line.align === 'right') ix = settings.margin + maxW - iw;
          page.drawImage(img, { x: ix, y: y - ih, width: iw, height: ih });
        }
        y -= line.lineH;
        continue;
      }
      if (!line.blank) {
        const textAreaW = maxW - line.indent;
        let x = settings.margin + line.indent;
        if (line.align === 'center' || line.isTitle) {
          x = settings.margin + line.indent + (textAreaW - line.width) / 2;
        } else if (line.align === 'right') {
          x = settings.margin + line.indent + textAreaW - line.width;
        }
        // List prefix sits in the indent gutter.
        if (line.prefix) {
          const pf = fonts.get('regular')!;
          page.drawText(safeWinAnsi(line.prefix.text), {
            x: settings.margin,
            y: y - ls,
            size: ls,
            font: pf,
            color: textColor,
          });
        }
        // Justify: stretch the gaps on non-last paragraph lines.
        let extraGap = 0;
        if (
          line.align === 'justify' &&
          !line.lastInPara &&
          !line.isTitle &&
          line.kind === 'para' &&
          line.words.length > 1
        ) {
          extraGap = (textAreaW - line.width) / (line.words.length - 1);
        }
        let cx = x;
        for (let wi = 0; wi < line.words.length; wi++) {
          const word = line.words[wi];
          for (const run of word.runs) {
            const picked = pick(runStyle(run), run.text);
            const font = picked.font;
            const safe = picked.embedded ? sanitizeDrawText(run.text) : safeWinAnsi(run.text);
            const rw = measure(run.text, ls, runStyle(run));
            const runColor = parseColor(run.color) ?? textColor;
            // Highlight wash behind the run.
            if (run.highlight) {
              const hl = parseColor(run.highlight);
              if (hl) {
                page.drawRectangle({
                  x: cx,
                  y: y - ls - 2,
                  width: rw,
                  height: ls + 3,
                  color: hl,
                  opacity: 0.35,
                  borderWidth: 0,
                });
              }
            }
            page.drawText(safe, { x: cx, y: y - ls, size: ls, font, color: runColor });
            if (run.underline) {
              page.drawLine({
                start: { x: cx, y: y - ls - 1.5 },
                end: { x: cx + rw, y: y - ls - 1.5 },
                thickness: Math.max(0.5, ls / 14),
                color: runColor,
              });
            }
            if (run.strike) {
              const midY = y - ls + ls * 0.35;
              page.drawLine({
                start: { x: cx, y: midY },
                end: { x: cx + rw, y: midY },
                thickness: Math.max(0.5, ls / 14),
                color: runColor,
              });
            }
            if (run.link) {
              // Clickable link annotation over exactly this run.
              const annot = doc.context.obj({
                Type: PDFName.of('Annot'),
                Subtype: PDFName.of('Link'),
                Rect: doc.context.obj([cx, y - ls - 2, cx + rw, y + 2]),
                Border: doc.context.obj([0, 0, 0]),
                A: doc.context.obj({
                  S: PDFName.of('URI'),
                  URI: PDFString.of(run.link),
                }),
              });
              page.node.addAnnot(doc.context.register(annot));
            }
            cx += rw;
          }
          if (wi < line.words.length - 1) cx += spaceW + extraGap;
        }
      }
      y -= line.lineH;
    }
    if (settings.pageNumbers && pages.length > 1) {
      const label = `Page ${pi + 1} of ${pages.length}`;
      const numFont = fonts.get('regular')!;
      const lw = numFont.widthOfTextAtSize(label, 9);
      page.drawText(label, {
        x: (pageW - lw) / 2,
        y: settings.margin / 2,
        size: 9,
        font: numFont,
        color: gray,
      });
    }
  });

  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
