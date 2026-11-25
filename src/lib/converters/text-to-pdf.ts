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

import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB } from 'pdf-lib';
import { safeWinAnsi } from './pdf';

export type TextPdfAlign = 'left' | 'center' | 'right' | 'justify';
export type TextPdfFont = 'helvetica' | 'times' | 'courier';
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
}

export type BlockKind = 'para' | 'h1' | 'h2' | 'bullet' | 'number';

export interface Block {
  kind: BlockKind;
  runs: TextRun[];
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
  });

  // Document title first.
  const title = settings.title.trim();
  if (title) {
    const titleSize = bodySize + 8;
    const titleBlocks = textToBlocks(title);
    const tBlock = titleBlocks[0] ?? { kind: 'para' as BlockKind, runs: [{ text: title }] };
    const words = blockWords({ ...tBlock, runs: tBlock.runs.map((r) => ({ ...r, bold: true })) }, titleSize, measure);
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

const FONT_MAP: Record<TextPdfFont, Record<RunStyle, StandardFonts>> = {
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

/** Live-preview measurement: embed the family's fonts once and measure with them. */
export async function createMeasureFn(font: TextPdfFont): Promise<MeasureFn> {
  const doc = await PDFDocument.create();
  const map = FONT_MAP[font];
  const fonts = new Map<RunStyle, PDFFont>();
  for (const style of ['regular', 'bold', 'italic', 'boldItalic', 'code', 'codeBold'] as RunStyle[]) {
    fonts.set(style, await doc.embedFont(map[style]));
  }
  return (t, size, style) =>
    (fonts.get(style) ?? fonts.get('regular')!).widthOfTextAtSize(safeWinAnsi(t), size);
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

/** Build the PDF bytes with the same pagination the preview shows. */
export async function buildTextPdf(blocks: Block[], settings: TextPdfSettings): Promise<Blob> {
  const doc = await PDFDocument.create();
  const map = FONT_MAP[settings.font];
  const fonts = new Map<RunStyle, PDFFont>();
  for (const style of ['regular', 'bold', 'italic', 'boldItalic', 'code', 'codeBold'] as RunStyle[]) {
    fonts.set(style, await doc.embedFont(map[style]));
  }
  const measure: MeasureFn = (t, size, style) =>
    (fonts.get(style) ?? fonts.get('regular')!).widthOfTextAtSize(safeWinAnsi(t), size);

  const pages = paginateBlocks(blocks, settings, measure);
  const { width: pageW, height: pageH } = pageDimensions(settings);
  const maxW = pageW - 2 * settings.margin;
  const textColor = hexToRgb(settings.color);
  const gray = rgb(0.45, 0.45, 0.45);
  const spaceW = measure(' ', settings.fontSize, 'regular');

  pages.forEach((pg, pi) => {
    const page = doc.addPage([pageW, pageH]);
    let y = pageH - settings.margin;
    for (const line of pg.lines) {
      const ls = line.size;
      if (!line.blank) {
        const textAreaW = maxW - line.indent;
        let x = settings.margin + line.indent;
        if (settings.align === 'center' || line.isTitle) {
          x = settings.margin + line.indent + (textAreaW - line.width) / 2;
        } else if (settings.align === 'right') {
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
          settings.align === 'justify' &&
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
            const font = fonts.get(runStyle(run)) ?? fonts.get('regular')!;
            const safe = safeWinAnsi(run.text);
            const rw = measure(run.text, ls, runStyle(run));
            page.drawText(safe, { x: cx, y: y - ls, size: ls, font, color: textColor });
            if (run.underline) {
              page.drawLine({
                start: { x: cx, y: y - ls - 1.5 },
                end: { x: cx + rw, y: y - ls - 1.5 },
                thickness: Math.max(0.5, ls / 14),
                color: textColor,
              });
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
