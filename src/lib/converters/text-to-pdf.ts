/**
 * Text-to-PDF editor engine — shared by the live preview and the download.
 *
 * The preview and the downloaded PDF run the EXACT same pagination, so what
 * the user sees on screen is what lands in the file. Everything is measured
 * with real pdf-lib font metrics (via a MeasureFn), never estimated.
 *
 * 100% on-device: pdf-lib builds the file in the visitor's browser.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { safeWinAnsi } from './pdf';

export type TextPdfAlign = 'left' | 'center' | 'right' | 'justify';
export type TextPdfFont = 'helvetica' | 'times' | 'courier';
export type TextPdfPageSize = 'a4' | 'letter';

export interface TextPdfSettings {
  font: TextPdfFont;
  fontSize: number; // pt
  lineHeight: number; // multiplier, e.g. 1.5
  align: TextPdfAlign;
  margin: number; // pt
  pageSize: TextPdfPageSize;
  title: string;
  pageNumbers: boolean;
  boldAll: boolean;
}

export const DEFAULT_TEXT_PDF_SETTINGS: TextPdfSettings = {
  font: 'helvetica',
  fontSize: 12,
  lineHeight: 1.5,
  align: 'left',
  margin: 56,
  pageSize: 'a4',
  title: '',
  pageNumbers: true,
  boldAll: false,
};

export const PAGE_SIZES: Record<TextPdfPageSize, { width: number; height: number; label: string }> = {
  a4: { width: 595, height: 842, label: 'A4' },
  letter: { width: 612, height: 792, label: 'Letter (US)' },
};

export const MARGIN_CHOICES = [
  { value: 40, label: 'Narrow' },
  { value: 56, label: 'Normal' },
  { value: 72, label: 'Wide' },
] as const;

export type RunStyle = 'regular' | 'bold' | 'italic' | 'boldItalic' | 'code';

export interface TextRun {
  text: string;
  style: RunStyle;
}

export interface PdfWord {
  runs: TextRun[];
  width: number;
}

export interface PdfLine {
  words: PdfWord[];
  width: number;
  blank: boolean;
  /** Rendered as the document title (bigger, bold, centered). */
  isTitle?: boolean;
  /** Last visual line of its paragraph (justify does not stretch it). */
  lastInPara: boolean;
}

export interface PdfPage {
  lines: PdfLine[];
}

export type MeasureFn = (text: string, size: number, style: RunStyle) => number;

/** Parse **bold**, *italic* and `code` runs inside one chunk of text. */
export function parseRuns(s: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /(\*\*.+?\*\*|\*[^*\n]+?\*|`[^`\n]+?`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ text: s.slice(last, m.index), style: 'regular' });
    const tok = m[0];
    if (tok.startsWith('**')) runs.push({ text: tok.slice(2, -2), style: 'bold' });
    else if (tok.startsWith('`')) runs.push({ text: tok.slice(1, -1), style: 'code' });
    else runs.push({ text: tok.slice(1, -1), style: 'italic' });
    last = m.index + tok.length;
  }
  if (last < s.length) runs.push({ text: s.slice(last), style: 'regular' });
  return runs.filter((r) => r.text);
}

function styleFor(settings: TextPdfSettings, style: RunStyle): RunStyle {
  if (settings.boldAll && style !== 'code') {
    return style === 'italic' ? 'boldItalic' : 'bold';
  }
  return style;
}

/** Split one paragraph into words, each word carrying its styled runs. */
function paragraphWords(
  para: string,
  size: number,
  settings: TextPdfSettings,
  measure: MeasureFn,
): PdfWord[] {
  const words: PdfWord[] = [];
  for (const chunk of para.split(/(\s+)/)) {
    if (!chunk || /^\s+$/.test(chunk)) continue;
    const runs = parseRuns(chunk).map((r) => ({ ...r, style: styleFor(settings, r.style) }));
    const width = runs.reduce((w, r) => w + measure(r.text, size, r.style), 0);
    words.push({ runs, width });
  }
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
      const w = measure(ch, size, run.style);
      if (curW + w > maxWidth && cur.length > 0) {
        pieces.push({ runs: cur, width: curW });
        cur = [];
        curW = 0;
      }
      cur.push({ text: ch, style: run.style });
      curW += w;
    }
  }
  if (cur.length > 0) pieces.push({ runs: cur, width: curW });
  return pieces.length > 0 ? pieces : [word];
}

/**
 * Wrap the whole document into pages of lines. The title (when set) becomes
 * the first line of page 1, larger and centered, followed by a blank line.
 */
export function paginateText(
  text: string,
  settings: TextPdfSettings,
  measure: MeasureFn,
): PdfPage[] {
  const { width: pageW, height: pageH } = PAGE_SIZES[settings.pageSize];
  const maxW = pageW - 2 * settings.margin;
  const maxH = pageH - 2 * settings.margin;
  const size = settings.fontSize;
  const lineH = size * settings.lineHeight;
  const titleSize = size + 8;

  const pages: PdfPage[] = [];
  let page: PdfLine[] = [];
  let usedH = 0;

  const pushLine = (line: PdfLine, height: number) => {
    if (usedH + height > maxH && page.length > 0) {
      pages.push({ lines: page });
      page = [];
      usedH = 0;
    }
    page.push(line);
    usedH += height;
  };

  const blankLine = (): PdfLine => ({ words: [], width: 0, blank: true, lastInPara: true });

  // Document title first.
  const title = settings.title.trim();
  if (title) {
    const tWords: PdfWord[] = [];
    for (const chunk of title.split(/(\s+)/)) {
      if (!chunk || /^\s+$/.test(chunk)) continue;
      const runs = parseRuns(chunk).map((r) => ({
        ...r,
        style: styleFor(settings, r.style === 'regular' ? 'bold' : r.style),
      }));
      tWords.push({ runs, width: runs.reduce((w, r) => w + measure(r.text, titleSize, r.style), 0) });
    }
    // Wrap the title like a paragraph, at title size.
    let line: PdfWord[] = [];
    let lineW = 0;
    const flushTitle = (last: boolean) => {
      pushLine({ words: line, width: lineW, blank: false, isTitle: true, lastInPara: last }, titleSize * 1.4);
      line = [];
      lineW = 0;
    };
    for (const w of tWords) {
      if (line.length > 0 && lineW + measure(' ', titleSize, 'regular') + w.width > maxW) flushTitle(false);
      if (line.length > 0) lineW += measure(' ', titleSize, 'regular');
      line.push(w);
      lineW += w.width;
    }
    if (line.length > 0) flushTitle(true);
    pushLine(blankLine(), lineH);
  }

  const paras = text.replace(/\t/g, '    ').split('\n');
  for (const para of paras) {
    if (!para.trim()) {
      pushLine(blankLine(), lineH);
      continue;
    }
    let words = paragraphWords(para, size, settings, measure);
    // Hard-split any word wider than the page.
    const expanded: PdfWord[] = [];
    for (const w of words) {
      if (w.width > maxW) expanded.push(...splitWord(w, size, maxW, measure));
      else expanded.push(w);
    }
    words = expanded;
    const spaceW = measure(' ', size, styleFor(settings, 'regular'));
    let line: PdfWord[] = [];
    let lineW = 0;
    const flush = (last: boolean) => {
      pushLine({ words: line, width: lineW, blank: false, lastInPara: last }, lineH);
      line = [];
      lineW = 0;
    };
    for (const w of words) {
      const gap = line.length > 0 ? spaceW : 0;
      if (line.length > 0 && lineW + gap + w.width > maxW) flush(false);
      if (line.length > 0) lineW += spaceW;
      line.push(w);
      lineW += w.width;
    }
    if (line.length > 0) flush(true);
  }

  if (page.length > 0 || pages.length === 0) pages.push({ lines: page });
  return pages;
}

const FONT_MAP: Record<TextPdfFont, Record<RunStyle, StandardFonts>> = {
  helvetica: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    boldItalic: StandardFonts.HelveticaBoldOblique,
    code: StandardFonts.Courier,
  },
  times: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic,
    boldItalic: StandardFonts.TimesRomanBoldItalic,
    code: StandardFonts.Courier,
  },
  courier: {
    regular: StandardFonts.Courier,
    bold: StandardFonts.CourierBold,
    italic: StandardFonts.CourierOblique,
    boldItalic: StandardFonts.CourierBoldOblique,
    code: StandardFonts.Courier,
  },
};

/** Live-preview measurement: embed the family's fonts once and measure with them. */
export async function createMeasureFn(font: TextPdfFont): Promise<MeasureFn> {
  const doc = await PDFDocument.create();
  const map = FONT_MAP[font];
  const fonts = new Map<RunStyle, PDFFont>();
  for (const style of ['regular', 'bold', 'italic', 'boldItalic', 'code'] as RunStyle[]) {
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

/** Build the PDF bytes with the same pagination the preview shows. */
export async function buildTextPdf(text: string, settings: TextPdfSettings): Promise<Blob> {
  const doc = await PDFDocument.create();
  const map = FONT_MAP[settings.font];
  const fonts = new Map<RunStyle, PDFFont>();
  for (const style of ['regular', 'bold', 'italic', 'boldItalic', 'code'] as RunStyle[]) {
    fonts.set(style, await doc.embedFont(map[style]));
  }
  const measure: MeasureFn = (t, size, style) =>
    (fonts.get(style) ?? fonts.get('regular')!).widthOfTextAtSize(safeWinAnsi(t), size);

  const pages = paginateText(text, settings, measure);
  const { width: pageW, height: pageH } = PAGE_SIZES[settings.pageSize];
  const maxW = pageW - 2 * settings.margin;
  const size = settings.fontSize;
  const lineH = size * settings.lineHeight;
  const titleSize = size + 8;
  const black = rgb(0, 0, 0);
  const gray = rgb(0.45, 0.45, 0.45);
  const spaceW = measure(' ', size, styleFor(settings, 'regular'));

  pages.forEach((pg, pi) => {
    const page = doc.addPage([pageW, pageH]);
    let y = pageH - settings.margin;
    for (const line of pg.lines) {
      const ls = line.isTitle ? titleSize : size;
      const lh = line.isTitle ? titleSize * 1.4 : lineH;
      if (!line.blank) {
        let x = settings.margin;
        if (settings.align === 'center' || line.isTitle) x = settings.margin + (maxW - line.width) / 2;
        else if (settings.align === 'right') x = settings.margin + maxW - line.width;
        // Justify: stretch the gaps on non-last lines.
        let extraGap = 0;
        if (settings.align === 'justify' && !line.lastInPara && !line.isTitle && line.words.length > 1) {
          extraGap = (maxW - line.width) / (line.words.length - 1);
        }
        let cx = x;
        for (let wi = 0; wi < line.words.length; wi++) {
          const word = line.words[wi];
          for (const run of word.runs) {
            const font = fonts.get(run.style) ?? fonts.get('regular')!;
            page.drawText(safeWinAnsi(run.text), {
              x: cx,
              y: y - ls,
              size: ls,
              font,
              color: black,
            });
            cx += measure(run.text, ls, run.style);
          }
          if (wi < line.words.length - 1) cx += spaceW + extraGap;
        }
      }
      y -= lh;
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
