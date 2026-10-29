/**
 * PDF conversion via pdf.js (reading/rendering) + pdf-lib (creating/merging)
 * + docx (Word export) — 100% on-device.
 *
 * pdf.js is lazy-loaded via dynamic import() and its worker is served from
 * /pdfjs/ (copied at build time by scripts/copy-pdfjs-worker.mjs), so there
 * is no runtime CDN dependency and the engine never lands in bundles of
 * pages that don't use it. Follow the same pattern as video.ts: this module
 * must only ever be loaded via dynamic import().
 */

export interface ConvertResult {
  blob: Blob;
  filename: string;
}

export interface PdfPageImage {
  blob: Blob;
  filename: string;
  pageNumber: number;
}

export type CompressLevel = 'high' | 'medium' | 'low';
export type MergeImageLayout = 'grid2' | 'grid3' | 'horizontal' | 'vertical';

/** Soft guard: refuse absurd page counts before burning browser memory. */
const MAX_PAGES = 150;

function baseName(file: File): string {
  return file.name.replace(/\.[^.]+$/, '') || 'converted';
}

function isPasswordError(e: unknown): boolean {
  return e instanceof Error && e.name === 'PasswordException';
}

function friendlyPdfError(e: unknown): Error {
  if (isPasswordError(e)) {
    return new Error(
      'This PDF is password-protected, and the browser version cannot open protected files. ' +
        'Please remove the password first (for example in your desktop PDF reader) and try again.'
    );
  }
  if (e instanceof Error && /too many pages/i.test(e.message)) return e;
  return new Error(
    'We could not read that PDF. It may be corrupt, use an unsupported feature, or be damaged. ' +
      'Please try another file.'
  );
}

// ---------------------------------------------------------------------------
// pdf.js singleton
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjs: any = null;

async function ensurePdfjs(): Promise<any> {
  if (pdfjs) return pdfjs;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import('pdfjs-dist');
  mod.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
  pdfjs = mod;
  return pdfjs;
}

async function openPdf(file: File): Promise<any> {
  const lib = await ensurePdfjs();
  const data = await file.arrayBuffer();
  try {
    const loadingTask = lib.getDocument({ data });
    const pdf = await loadingTask.promise;
    if (pdf.numPages > MAX_PAGES) {
      throw new Error(
        `That PDF has ${pdf.numPages} pages — too many for in-browser conversion (limit ${MAX_PAGES}). ` +
          'Please split it into smaller files first.'
      );
    }
    return pdf;
  } catch (e) {
    throw friendlyPdfError(e);
  }
}

// ---------------------------------------------------------------------------
// PDF -> images (one image per page)
// ---------------------------------------------------------------------------

export async function pdfToImages(
  file: File,
  format: 'jpeg' | 'png',
  scale = 2
): Promise<PdfPageImage[]> {
  const pdf = await openPdf(file);
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const base = baseName(file);
  const pages: PdfPageImage[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is not available in this browser.');
      if (format === 'jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, mime, 0.92)
      );
      if (!blob) throw new Error('This browser refused to encode the page image.');
      const n = String(i).padStart(2, '0');
      pages.push({ blob, filename: `${base}-p${n}.${ext}`, pageNumber: i });
      page.cleanup();
    }
    return pages;
  } catch (e) {
    throw friendlyPdfError(e);
  }
}

// ---------------------------------------------------------------------------
// Images -> PDF (one image per page, fit to page)
// ---------------------------------------------------------------------------

export async function imagesToPdf(
  files: File[],
  opts?: { quality?: number }
): Promise<ConvertResult> {
  if (files.length === 0) throw new Error('Please choose at least one image.');
  const { PDFDocument } = await import('pdf-lib');
  const quality = opts?.quality ?? 92;
  const pdf = await PDFDocument.create();
  for (const file of files) {
    const bitmap = await createImageBitmap(file).catch(() => {
      throw new Error(`We could not read "${file.name}". It may be corrupt or an unsupported image.`);
    });
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is not available in this browser.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, 'image/jpeg', quality / 100)
      );
      if (!blob) throw new Error('This browser refused to encode the image.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const img = await pdf.embedJpg(bytes);
      const page = pdf.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } finally {
      bitmap.close();
    }
  }
  const out = await pdf.save();
  const base = baseName(files[0]);
  return {
    blob: new Blob([out as unknown as BlobPart], { type: 'application/pdf' }),
    filename: `${base}.pdf`,
  };
}

// ---------------------------------------------------------------------------
// Merge PDFs (in the given order)
// ---------------------------------------------------------------------------

export async function mergePdfs(files: File[]): Promise<ConvertResult> {
  if (files.length < 2) {
    throw new Error('Merging needs at least 2 PDF files — add another one.');
  }
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (const file of files) {
    let src: Awaited<ReturnType<typeof PDFDocument.load>>;
    try {
      src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false });
    } catch (e) {
      throw friendlyPdfError(e);
    }
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  const bytes = await out.save();
  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
    filename: 'merged.pdf',
  };
}

// ---------------------------------------------------------------------------
// Split PDF by page range, e.g. "1-3, 5"
// ---------------------------------------------------------------------------

function parseRange(range: string, numPages: number): number[] {
  const picked = new Set<number>();
  const parts = range
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error('Please enter a page range, e.g. "1-3, 5".');
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) picked.add(i);
    } else if (/^\d+$/.test(part)) {
      picked.add(parseInt(part, 10));
    } else {
      throw new Error(`"${part}" is not a valid page or range. Use numbers like "1-3, 5".`);
    }
  }
  const pages = [...picked].filter((n) => n >= 1 && n <= numPages).sort((a, b) => a - b);
  if (pages.length === 0) {
    throw new Error(`No valid pages in that range — this PDF has ${numPages} page(s).`);
  }
  return pages.map((n) => n - 1); // 0-based for pdf-lib
}

export async function splitPdf(file: File, range: string): Promise<ConvertResult> {
  const pdf = await openPdf(file);
  const indices = parseRange(range, pdf.numPages);
  const { PDFDocument } = await import('pdf-lib');
  let src: Awaited<ReturnType<typeof PDFDocument.load>>;
  try {
    src = await PDFDocument.load(await file.arrayBuffer());
  } catch (e) {
    throw friendlyPdfError(e);
  }
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  const bytes = await out.save();
  const base = baseName(file);
  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
    filename: `${base}-split.pdf`,
  };
}

// ---------------------------------------------------------------------------
// Compress PDF (re-render pages at reduced scale/quality)
// ---------------------------------------------------------------------------

const COMPRESS_PRESETS: Record<CompressLevel, { scale: number; quality: number; label: string }> = {
  high: { scale: 1.5, quality: 0.85, label: 'High quality' },
  medium: { scale: 1.0, quality: 0.7, label: 'Balanced' },
  low: { scale: 0.7, quality: 0.5, label: 'Smallest file' },
};

export async function compressPdf(
  file: File,
  level: CompressLevel = 'medium'
): Promise<ConvertResult> {
  const preset = COMPRESS_PRESETS[level] ?? COMPRESS_PRESETS.medium;
  const pdf = await openPdf(file);
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: preset.scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is not available in this browser.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, 'image/jpeg', preset.quality)
      );
      if (!blob) throw new Error('This browser refused to encode the page image.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const img = await out.embedJpg(bytes);
      const outPage = out.addPage([img.width, img.height]);
      outPage.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      page.cleanup();
    }
  } catch (e) {
    throw friendlyPdfError(e);
  }
  const bytes = await out.save();
  const base = baseName(file);
  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
    filename: `${base}-compressed.pdf`,
  };
}

// ---------------------------------------------------------------------------
// PDF -> text
// ---------------------------------------------------------------------------

async function extractPageTexts(file: File): Promise<string[][]> {
  const pdf = await openPdf(file);
  const pages: string[][] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      // Group items into lines by Y, then join lines into paragraphs on Y gaps.
      const items = (tc.items as Array<{ str: string; transform: number[] }>)
        .filter((it) => it.str && it.str.trim().length > 0)
        .map((it) => ({ text: it.str, x: it.transform[4], y: it.transform[5] }))
        .sort((a, b) => b.y - a.y || a.x - b.x);
      const lines: { y: number; parts: { x: number; text: string }[] }[] = [];
      for (const it of items) {
        const line = lines.find((l) => Math.abs(l.y - it.y) < 2);
        if (line) line.parts.push({ x: it.x, text: it.text });
        else lines.push({ y: it.y, parts: [{ x: it.x, text: it.text }] });
      }
      lines.sort((a, b) => b.y - a.y);
      const paragraphs: string[] = [];
      let current: string[] = [];
      let prevY: number | null = null;
      for (const line of lines) {
        const text = line.parts
          .sort((a, b) => a.x - b.x)
          .map((p) => p.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!text) continue;
        if (prevY !== null && prevY - line.y > 24) {
          if (current.length) paragraphs.push(current.join(' '));
          current = [];
        }
        current.push(text);
        prevY = line.y;
      }
      if (current.length) paragraphs.push(current.join(' '));
      pages.push(paragraphs);
      page.cleanup();
    }
    return pages;
  } catch (e) {
    throw friendlyPdfError(e);
  }
}

export async function pdfToText(file: File): Promise<ConvertResult> {
  const pages = await extractPageTexts(file);
  const text = pages.map((paras) => paras.join('\n\n')).join('\n\n');
  if (!text.trim()) {
    throw new Error(
      'No text found in this PDF — it may be a scanned document (pictures of text). ' +
        'Scanned PDFs need OCR, which the browser version does not do yet.'
    );
  }
  const base = baseName(file);
  return { blob: new Blob([text], { type: 'text/plain' }), filename: `${base}.txt` };
}

// ---------------------------------------------------------------------------
// PDF -> Word (.docx, text extraction — honest about layout limits)
// ---------------------------------------------------------------------------

export async function pdfToWord(file: File): Promise<ConvertResult> {
  const pages = await extractPageTexts(file);
  const hasText = pages.some((p) => p.join('').trim().length > 0);
  if (!hasText) {
    throw new Error(
      'No text found in this PDF — it may be a scanned document (pictures of text). ' +
        'Scanned PDFs need OCR, which the browser version does not do yet.'
    );
  }
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
  const children: InstanceType<typeof Paragraph>[] = [];
  pages.forEach((paras, pi) => {
    if (pi > 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: '', break: 1 })] }));
    }
    paras.forEach((para, idx) => {
      const isHeading = idx === 0 && para.length < 80 && !/[.!?]$/.test(para);
      children.push(
        new Paragraph({
          heading: isHeading ? HeadingLevel.HEADING_1 : undefined,
          children: [new TextRun(para)],
        })
      );
    });
  });
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const base = baseName(file);
  return { blob, filename: `${base}.docx` };
}

// ---------------------------------------------------------------------------
// Merge images -> one image (grid / strip layouts, canvas)
// ---------------------------------------------------------------------------

const MERGE_MAX_DIM = 2048;

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error(`We could not read "${file.name}". It may be corrupt or an unsupported image.`);
  }
}

export async function mergeImages(
  files: File[],
  layout: MergeImageLayout,
  format: 'jpeg' | 'png',
  quality = 0.92
): Promise<ConvertResult> {
  if (files.length < 2) {
    throw new Error('Merging needs at least 2 images — add another one.');
  }
  if (files.length > 16) {
    throw new Error('Please merge at most 16 images at once — browsers run out of memory beyond that.');
  }
  const bitmaps = await Promise.all(files.map(loadBitmap));
  try {
    const cols = layout === 'grid3' ? 3 : layout === 'grid2' ? 2 : layout === 'horizontal' ? bitmaps.length : 1;
    const rows = Math.ceil(bitmaps.length / cols);
    // Cell size: fit the largest image aspect into a square-ish cell, capped.
    const cellW = Math.min(1024, Math.floor(MERGE_MAX_DIM / cols));
    const cellH = Math.min(1024, Math.floor(MERGE_MAX_DIM / Math.max(rows, 1)));
    const canvas = document.createElement('canvas');
    canvas.width = cols * cellW;
    canvas.height = rows * cellH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    bitmaps.forEach((bm, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const scale = Math.min(cellW / bm.width, cellH / bm.height);
      const w = Math.floor(bm.width * scale);
      const h = Math.floor(bm.height * scale);
      const x = col * cellW + Math.floor((cellW - w) / 2);
      const y = row * cellH + Math.floor((cellH - h) / 2);
      ctx.drawImage(bm, x, y, w, h);
    });
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, quality));
    if (!blob) throw new Error('This browser refused to encode the merged image.');
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    return { blob, filename: `merged.${ext}` };
  } finally {
    bitmaps.forEach((b) => b.close());
  }
}

// ---------------------------------------------------------------------------
// Merge images -> PDF (N images per page)
// ---------------------------------------------------------------------------

export async function mergeImagesToPdf(
  files: File[],
  perPage: 1 | 2 | 4,
  quality = 0.92
): Promise<ConvertResult> {
  if (files.length === 0) throw new Error('Please choose at least one image.');
  if (files.length > 60) {
    throw new Error('Please merge at most 60 images at once.');
  }
  const { PDFDocument } = await import('pdf-lib');
  // A4-ish page in points.
  const PAGE_W = 595;
  const PAGE_H = 842;
  const MARGIN = 36;
  const pdf = await PDFDocument.create();
  const cols = perPage === 1 ? 1 : 2;
  const rows = perPage <= 2 ? perPage : 2;
  const cellW = (PAGE_W - MARGIN * 2) / cols;
  const cellH = (PAGE_H - MARGIN * 2) / rows;
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let slot = 0;
  for (const file of files) {
    const bitmap = await loadBitmap(file);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is not available in this browser.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, 'image/jpeg', quality)
      );
      if (!blob) throw new Error('This browser refused to encode the image.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const img = await pdf.embedJpg(bytes);
      if (slot > 0 && slot % perPage === 0) {
        page = pdf.addPage([PAGE_W, PAGE_H]);
      }
      const pos = slot % perPage;
      const col = pos % cols;
      const row = Math.floor(pos / cols);
      const scale = Math.min(cellW / img.width, cellH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = MARGIN + col * cellW + (cellW - w) / 2;
      const y = PAGE_H - MARGIN - (row + 1) * cellH + (cellH - h) / 2;
      page.drawImage(img, { x, y, width: w, height: h });
      slot++;
    } finally {
      bitmap.close();
    }
  }
  const out = await pdf.save();
  return {
    blob: new Blob([out as unknown as BlobPart], { type: 'application/pdf' }),
    filename: 'merged-images.pdf',
  };
}

// ---------------------------------------------------------------------------
// On-device PDF text editor ("Edit PDF") — flagship tool
// ---------------------------------------------------------------------------
// Flow: extractEditablePages() -> user edits blocks in the UI ->
// renderEditedPdf() (surgical redraw of edited blocks) / renderCleanPdf()
// (rebuilt flowing layout) / renderEditedDocx(). Everything stays in the
// browser; pdf-lib's standard fonts approximate original fonts.

export interface EditorBlock {
  id: string;
  /** Original extracted text. */
  text: string;
  /** PDF units. x = left of bbox, y = baseline y (origin bottom-left). */
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  bold: boolean;
}

export interface EditorPageData {
  pageNum: number;
  /** Page size in PDF units. */
  width: number;
  height: number;
  blocks: EditorBlock[];
}

/** Resolved page passed to the render functions: text is final (edited). */
export interface FinalBlock extends EditorBlock {
  edited: boolean;
}

export interface FinalPage {
  pageNum: number; // 1-based index into the source document
  blocks: FinalBlock[];
  /** When set (Text view), the whole page text is replaced by this. */
  textOverride: string | null;
}

const EDITOR_MAX_PAGES = 50;

/** Group pdf.js text items into clickable lines/blocks by y-proximity. */
function groupTextItems(items: unknown[], pageNum: number): EditorBlock[] {
  interface Row { y: number; items: ItemBox[] }
  interface ItemBox {
    str: string; x: number; y: number; w: number; h: number;
    fontSize: number; fontName: string;
  }
  const boxes: ItemBox[] = [];
  for (const raw of items as Array<{
    str?: string; transform?: number[]; width?: number; height?: number; fontName?: string;
  }>) {
    const str = raw.str ?? '';
    if (!str.trim()) continue;
    const t = raw.transform ?? [0, 0, 0, 0, 0, 0];
    const fontSize = Math.hypot(t[0] || 0, t[1] || 0) || 10;
    boxes.push({
      str,
      x: t[4] || 0,
      y: t[5] || 0,
      w: raw.width || 0,
      h: raw.height || fontSize * 1.2,
      fontSize,
      fontName: (raw.fontName || '').toLowerCase(),
    });
  }
  boxes.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Row[] = [];
  for (const b of boxes) {
    const row = rows.find((r) => Math.abs(r.y - b.y) <= Math.max(2.5, b.fontSize * 0.35));
    if (row) row.items.push(b);
    else rows.push({ y: b.y, items: [b] });
  }
  const blocks: EditorBlock[] = [];
  let n = 0;
  for (const row of rows) {
    const line = row.items.sort((a, b) => a.x - b.x);
    // Split a visual line into blocks where gaps look like column breaks.
    let cur: ItemBox[] = [];
    const flush = () => {
      if (!cur.length) return;
      let text = '';
      cur.forEach((s, i) => {
        if (i > 0) {
          const prev = cur[i - 1];
          const gap = s.x - (prev.x + prev.w);
          if (gap > s.fontSize * 0.25 && !/\s$/.test(text) && !/^\s/.test(s.str)) text += ' ';
        }
        text += s.str;
      });
      const x0 = Math.min(...cur.map((c) => c.x));
      const x1 = Math.max(...cur.map((c) => c.x + c.w));
      const fs = Math.max(...cur.map((c) => c.fontSize));
      const bold = cur.some((c) => /bold|black|heavy|demi/.test(c.fontName));
      const h = Math.max(...cur.map((c) => c.h));
      blocks.push({
        id: `p${pageNum}-b${n++}`,
        text,
        x: x0,
        y: row.y,
        width: Math.max(1, x1 - x0),
        height: h,
        fontSize: fs,
        bold,
      });
      cur = [];
    };
    line.forEach((s, i) => {
      if (i > 0) {
        const prev = line[i - 1];
        const gap = s.x - (prev.x + prev.w);
        if (gap > s.fontSize * 0.9) flush();
      }
      cur.push(s);
    });
    flush();
  }
  return blocks;
}

/**
 * Extract per-page clickable text blocks from a PDF. Throws friendly errors
 * for protected files, too many pages, and scanned (textless) PDFs.
 */
export async function extractEditablePages(file: File): Promise<EditorPageData[]> {
  const lib = await ensurePdfjs();
  const data = await file.arrayBuffer();
  let pdf: { numPages: number; getPage: (n: number) => Promise<unknown> };
  try {
    pdf = await lib.getDocument({ data }).promise;
  } catch (e) {
    throw friendlyPdfError(e);
  }
  if (pdf.numPages > EDITOR_MAX_PAGES) {
    throw new Error(
      `That PDF has ${pdf.numPages} pages — the editor handles up to ${EDITOR_MAX_PAGES} pages ` +
        'in the browser. Please split it first (see Split PDF).'
    );
  }
  const pages: EditorPageData[] = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = (await pdf.getPage(p)) as {
        getViewport: (o: { scale: number }) => { width: number; height: number };
        getTextContent: () => Promise<{ items: unknown[] }>;
        cleanup: () => void;
      };
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      pages.push({
        pageNum: p,
        width: vp.width,
        height: vp.height,
        blocks: groupTextItems(tc.items, p),
      });
      page.cleanup();
    }
  } catch (e) {
    throw friendlyPdfError(e);
  }
  const hasText = pages.some((pg) => pg.blocks.some((b) => b.text.trim().length > 0));
  if (!hasText) {
    throw new Error(
      'No editable text found in this PDF — it looks like a scanned document ' +
        '(pictures of text). Scanned PDFs need OCR, which the browser version does not do yet.'
    );
  }
  return pages;
}

/** Standard PDF fonts only speak Latin — sanitize anything else. */
function safeWinAnsi(s: string): string {
  return s.replace(/[^\x00-\xFF]/g, '?');
}

function wrapLines(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(safeWinAnsi(test), size) > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Surgical redraw: copy every page as-is; for edited blocks paint a white
 * rectangle over the original and draw the new text at the same position.
 * Pages edited via Text view get their text area whited out and reflowed.
 */
export async function renderEditedPdf(
  srcBytes: ArrayBuffer,
  pages: FinalPage[],
  outName: string
): Promise<ConvertResult> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const helv = await out.embedFont(StandardFonts.Helvetica);
  const helvB = await out.embedFont(StandardFonts.HelveticaBold);
  const white = rgb(1, 1, 1);
  const black = rgb(0, 0, 0);
  for (const fp of pages) {
    const [copied] = await out.copyPages(src, [fp.pageNum - 1]);
    out.addPage(copied);
    if (fp.textOverride != null) {
      const sized = fp.blocks.filter((b) => b.width > 0);
      if (sized.length) {
        const ux0 = Math.min(...sized.map((b) => b.x));
        const ux1 = Math.max(...sized.map((b) => b.x + b.width));
        const utop = Math.max(...sized.map((b) => b.y + b.height));
        const ubot = Math.min(...sized.map((b) => b.y));
        copied.drawRectangle({
          x: ux0 - 2, y: ubot - 4, width: ux1 - ux0 + 4, height: utop - ubot + 8, color: white,
        });
        const size = 11;
        const lines = wrapLines(fp.textOverride, helv, size, ux1 - ux0);
        let cy = utop - size;
        for (const ln of lines) {
          if (cy < ubot) break;
          copied.drawText(safeWinAnsi(ln), { x: ux0, y: cy, size, font: helv, color: black });
          cy -= size * 1.4;
        }
      }
      continue;
    }
    for (const b of fp.blocks) {
      if (!b.edited) continue;
      const font = b.bold ? helvB : helv;
      const lines = b.text.split('\n');
      const lh = b.fontSize * 1.25;
      const rectH = Math.max(b.height + 4, lines.length * lh + 2);
      copied.drawRectangle({
        x: b.x - 1, y: b.y - 3, width: b.width + 2, height: rectH, color: white,
      });
      lines.forEach((ln, i) => {
        copied.drawText(safeWinAnsi(ln), {
          x: b.x, y: b.y - i * lh, size: b.fontSize, font, color: black,
        });
      });
    }
  }
  const bytes = await out.save();
  return { blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }), filename: outName };
}

/** Rebuild the document as a clean flowing-layout PDF from the final text. */
export async function renderCleanPdf(pages: FinalPage[], outName: string): Promise<ConvertResult> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const out = await PDFDocument.create();
  const helv = await out.embedFont(StandardFonts.Helvetica);
  const helvB = await out.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const PW = 595;
  const PH = 842;
  const M = 56;
  let page = out.addPage([PW, PH]);
  let y = PH - M;
  const freshPage = () => {
    page = out.addPage([PW, PH]);
    y = PH - M;
  };
  const drawPara = (t: string) => {
    const text = t.trim();
    if (!text) return;
    const isHeading = text.length < 90 && !/[.!?;:]$/.test(text);
    const size = isHeading ? 14 : 11;
    const font = isHeading ? helvB : helv;
    for (const ln of wrapLines(text, font, size, PW - 2 * M)) {
      if (y < M + size) freshPage();
      if (ln) page.drawText(safeWinAnsi(ln), { x: M, y: y - size, size, font, color: black });
      y -= size * 1.45;
    }
    y -= isHeading ? 8 : 5;
    if (y < M) freshPage();
  };
  pages.forEach((fp, pi) => {
    if (pi > 0) y -= 12;
    const paras = fp.textOverride != null ? fp.textOverride.split('\n') : fp.blocks.map((b) => b.text);
    paras.forEach(drawPara);
  });
  const bytes = await out.save();
  return { blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }), filename: outName };
}

/** Export the final text as an editable Word document (same honest pattern as pdfToWord). */
export async function renderEditedDocx(pages: FinalPage[], outName: string): Promise<ConvertResult> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
  const children: InstanceType<typeof Paragraph>[] = [];
  pages.forEach((fp, pi) => {
    if (pi > 0) children.push(new Paragraph({ children: [new TextRun({ text: '', break: 1 })] }));
    const paras = fp.textOverride != null ? fp.textOverride.split('\n') : fp.blocks.map((b) => b.text);
    paras.forEach((p) => {
      const t = p.trim();
      if (!t) return;
      const isHeading = t.length < 80 && !/[.!?]$/.test(t);
      children.push(
        new Paragraph({
          heading: isHeading ? HeadingLevel.HEADING_1 : undefined,
          children: [new TextRun(t)],
        })
      );
    });
  });
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  return { blob, filename: outName };
}
