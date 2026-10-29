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

/** Decode any supported image file to an ImageBitmap (HEIC/HEIF via heic2any). */
async function decodeImageFile(file: File): Promise<ImageBitmap> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  let blob: Blob = file;
  if (ext === 'heic' || ext === 'heif') {
    const { convertHeic } = await import('./heic');
    blob = (await convertHeic(file, 'png')).blob;
  }
  return createImageBitmap(blob).catch(() => {
    throw new Error(`We could not read "${file.name}". It may be corrupt or an unsupported image.`);
  });
}

export async function imagesToPdf(
  files: File[],
  opts?: { quality?: number }
): Promise<ConvertResult> {
  if (files.length === 0) throw new Error('Please choose at least one image.');
  const { PDFDocument } = await import('pdf-lib');
  const quality = opts?.quality ?? 92;
  const pdf = await PDFDocument.create();
  for (const file of files) {
    const bitmap = await decodeImageFile(file);
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
  /** Raw pdf.js font name (lowercased), for font-family matching. */
  fontName: string;
}

/** RGB color as 0..1 floats (for sampled design colors). */
export interface SampledRgb {
  r: number;
  g: number;
  b: number;
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
  /** Sampled from the original page render — cover fill for surgical redraw. */
  bgRgb?: SampledRgb;
  /** Sampled from the original page render — redrawn text color. */
  fgRgb?: SampledRgb;
}

export interface FinalPage {
  pageNum: number; // 1-based index into the source document
  blocks: FinalBlock[];
}

const EDITOR_MAX_PAGES = 50;

/**
 * Clean a PDF BaseFont name for matching: strip the leading '/', a subset
 * prefix like "ABCDEF+", and pdf-lib-style numeric suffixes ("-9742").
 */
export function cleanBaseFontName(n: string): string {
  return n
    .replace(/^\//, '')
    .replace(/^[A-Z]{6}\+/, '')
    .replace(/-\d{3,}$/, '');
}

/**
 * Map pdf.js's per-item `fontName` (an internal key like "g_d0_f1") to the
 * PDF's real BaseFont name (e.g. "NotoSans-Bold"). pdf.js never exposes the
 * real name in getTextContent, so we recover it:
 *
 * - pdf-lib reads each page's /Resources /Font dict: resource name -> BaseFont.
 * - The page's content stream is scanned for "Tf" (set-font) operators;
 *   pdf.js loads fonts in first-appearance order, so the k-th distinct
 *   loadedName in the page's operator list corresponds to the k-th distinct
 *   font resource in the stream.
 *
 * `pages` carries each page's distinct pdf.js loadedNames in setFont order
 * (from page.getOperatorList()). Returns per pageNum: { loadedName: baseFont }.
 * Anything unmapped stays absent — callers fall back to the loadedName heuristic.
 */
export async function mapLoadedFontsToBaseFonts(
  srcBytes: Uint8Array,
  pages: Array<{ pageNum: number; loadedNames: string[] }>
): Promise<Record<number, Record<string, string>>> {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream } = await import('pdf-lib');
  const doc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const out: Record<number, Record<string, string>> = {};
  for (const { pageNum, loadedNames } of pages) {
    const map: Record<string, string> = {};
    out[pageNum] = map;
    if (!loadedNames.length) continue;
    try {
      const page = doc.getPage(pageNum - 1);
      const resources = page.node.Resources();
      const fontDict = resources ? resources.lookup(PDFName.of('Font')) : undefined;
      const baseByResource: Record<string, string> = {};
      if (fontDict instanceof PDFDict) {
        for (const key of fontDict.keys()) {
          const f = fontDict.lookup(key) as unknown as { lookup?: (n: unknown) => unknown } | null;
          const bf = f && typeof f.lookup === 'function' ? f.lookup(PDFName.of('BaseFont')) : null;
          if (bf) {
            baseByResource[key.toString().replace(/^\//, '')] = cleanBaseFontName(
              String(bf).replace(/^\//, '')
            );
          }
        }
      }
      const order: string[] = [];
      const seen = new Set<string>();
      const contentsRef = page.node.get(PDFName.of('Contents'));
      const resolved = doc.context.lookup(contentsRef);
      const streams: unknown[] = [];
      if (resolved instanceof PDFArray) {
        for (let i = 0; i < resolved.size(); i++) streams.push(doc.context.lookup(resolved.get(i)));
      } else if (resolved) {
        streams.push(resolved);
      }
      const decode = new TextDecoder('windows-1252');
      const { inflate } = await import('pako');
      for (const s of streams) {
        if (!(s instanceof PDFRawStream)) continue;
        // Content streams are usually FlateDecode-compressed; pdf-lib hands
        // us the raw stored bytes, so inflate first when needed.
        let raw = s.contents as Uint8Array;
        try {
          const filterObj = s.dict.lookup(PDFName.of('Filter'));
          const names: string[] = [];
          if (filterObj instanceof PDFName) names.push(filterObj.toString());
          else if (filterObj instanceof PDFArray) {
            for (let i = 0; i < filterObj.size(); i++) names.push(String(filterObj.get(i)));
          }
          if (names.some((f) => f.includes('FlateDecode'))) raw = inflate(raw);
        } catch {
          continue;
        }
        const txt = decode.decode(raw);
        const re = /\/([A-Za-z0-9_+\-.]+)\s+[+-]?[\d.]+\s+Tf/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(txt))) {
          const rn = m[1];
          if (!seen.has(rn) && baseByResource[rn]) {
            seen.add(rn);
            order.push(rn);
          }
        }
      }
      const n = Math.min(order.length, loadedNames.length);
      for (let i = 0; i < n; i++) map[loadedNames[i]] = baseByResource[order[i]];
    } catch {
      // leave the map empty; the caller falls back to the loadedName heuristic
    }
  }
  return out;
}

/** Group pdf.js text items into clickable lines/blocks by y-proximity. Exported for tests. */
export function groupTextItems(
  items: unknown[],
  pageNum: number,
  fontMap?: Record<string, string>
): EditorBlock[] {
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
      // Map pdf.js's internal loadedName (e.g. "g_d0_f1") to the real BaseFont
      // via fontMap; fall back to the raw name when unmapped.
      fontName: (fontMap?.[raw.fontName ?? ''] ?? raw.fontName ?? '').toLowerCase(),
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
        fontName: cur.map((c) => c.fontName).sort().join('|'),
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
  // Drop decoration artifacts: zero-area boxes and blocks whose text is a
  // tiny run of punctuation with no letters/digits (e.g. "/.", "///" that
  // some generators emit as text). Common lone bullets are kept.
  const LONE_BULLETS = new Set(['•', '·', '-', '–', '—', '*', '›', '»', '▪', '◦', '○']);
  return blocks.filter((b) => {
    const s = b.text.replace(/\s+/g, '');
    if (!s) return false;
    if (b.width < 0.5 || b.height < 0.5) return false;
    if (s.length <= 3 && !/[A-Za-z0-9]/.test(s) && !LONE_BULLETS.has(s)) return false;
    return true;
  });
}

/**
 * Map a Text-view draft back to per-block edits (never a page-level reflow).
 *
 * The draft was built as blocks.join('\n\n'); we split it the same way and
 * align paragraphs to blocks with an LCS diff so insertions/deletions don't
 * scramble everything. Returns one entry per block: newText === null means
 * unchanged, '' means deleted.
 */
export interface BlockTextEdit {
  blockId: string;
  newText: string | null;
}

function splitParas(s: string): string[] {
  return s
    .split(/\n[ \t]*\n/)
    .map((p) =>
      p
        .split('\n')
        .map((ln) => ln.replace(/[ \t]+/g, ' ').trimEnd())
        .join('\n')
        .trim()
    )
    .filter((p) => p.length > 0);
}

/** LCS alignment of two paragraph arrays -> [origIdx|null, editedIdx|null] pairs. */
function lcsAlign(a: string[], b: string[]): Array<[number | null, number | null]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number | null, number | null]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pairs.push([i, null]);
      i++;
    } else {
      pairs.push([null, j]);
      j++;
    }
  }
  while (i < n) pairs.push([i++, null]);
  while (j < m) pairs.push([null, j++]);
  return pairs;
}

export function diffTextViewToBlocks(
  origBlocks: Array<{ id: string; text: string }>,
  draft: string
): BlockTextEdit[] {
  const origParas = origBlocks.map((b) => b.text);
  const editParas = splitParas(draft);
  const edits = new Map<string, string | null>();
  const appendTo = (blockIdx: number, para: string) => {
    const id = origBlocks[blockIdx].id;
    const cur = edits.get(id);
    // NB: cur may be '' when the same block was already marked deleted by the
    // LCS walk (e.g. a typo'd paragraph aligns as delete+insert) — treat it
    // as empty so we don't produce a leading "\n\n".
    edits.set(id, cur ? `${cur}\n\n${para}` : para);
  };
  let lastAnchor = -1;
  for (const [oi, ej] of lcsAlign(origParas, editParas)) {
    if (oi !== null && ej !== null) {
      if (origParas[oi] !== editParas[ej]) edits.set(origBlocks[oi].id, editParas[ej]);
      lastAnchor = oi;
    } else if (oi !== null) {
      // deleted paragraph -> empty the block (covered, draws nothing)
      edits.set(origBlocks[oi].id, '');
      lastAnchor = oi;
    } else if (ej !== null) {
      // inserted paragraph -> attach to nearest preceding block (or first)
      appendTo(Math.max(0, lastAnchor), editParas[ej as number]);
    }
  }
  return origBlocks.map((b) => ({ blockId: b.id, newText: edits.has(b.id) ? (edits.get(b.id) as string) : null }));
}

// ---------------------------------------------------------------------------
// Design-preserving color sampling
// ---------------------------------------------------------------------------

/**
 * Sample background/foreground colors for an edited block from the original
 * page render. Takes raw pixels (ImageData-like) so it is testable in Node.
 *
 * - bg: median color of a ring around the cover rect (near-black text pixels
 *   excluded from the vote; falls back to all ring pixels when the ring is
 *   mostly dark, e.g. a navy header).
 * - fg: median color of pixels inside the rect that differ strongly from bg
 *   (the glyph pixels) — works for dark-on-light AND light-on-dark.
 */
export function sampleBlockColors(
  px: { data: Uint8ClampedArray; width: number; height: number },
  pageW: number,
  pageH: number,
  rect: { x: number; y: number; w: number; h: number } // PDF points, y = bottom
): { bg: SampledRgb; fg: SampledRgb } {
  const white = { r: 1, g: 1, b: 1 };
  const black = { r: 0, g: 0, b: 0 };
  const sx = px.width / pageW;
  const sy = px.height / pageH;
  const clampX = (v: number) => Math.max(0, Math.min(px.width - 1, Math.round(v)));
  const clampY = (v: number) => Math.max(0, Math.min(px.height - 1, Math.round(v)));
  const ix0 = clampX(rect.x * sx);
  const ix1 = clampX((rect.x + rect.w) * sx);
  const iyTop = clampY((pageH - (rect.y + rect.h)) * sy);
  const iyBot = clampY((pageH - rect.y) * sy);
  if (ix1 <= ix0 || iyBot <= iyTop) return { bg: white, fg: black };
  const D = 12; // ring thickness, backing-store px
  const ox0 = clampX(ix0 - D);
  const ox1 = clampX(ix1 + D);
  const oy0 = clampY(iyTop - D);
  const oy1 = clampY(iyBot + D);
  const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
  const at = (x: number, y: number): [number, number, number] => {
    const o = (y * px.width + x) * 4;
    return [px.data[o], px.data[o + 1], px.data[o + 2]];
  };
  const medianOf = (arr: Array<[number, number, number]>): SampledRgb => {
    if (!arr.length) return white;
    const ch = (k: 0 | 1 | 2) => arr.map((c) => c[k]).sort((a, b) => a - b);
    const mid = (s: number[]) => s[Math.floor(s.length / 2)] / 255;
    return { r: mid(ch(0)), g: mid(ch(1)), b: mid(ch(2)) };
  };
  // Background vote from the ring (dilated rect minus inner rect).
  const ringBright: Array<[number, number, number]> = [];
  const ringAll: Array<[number, number, number]> = [];
  for (let y = oy0; y <= oy1; y++) {
    for (let x = ox0; x <= ox1; x++) {
      if (x >= ix0 && x <= ix1 && y >= iyTop && y <= iyBot) continue;
      const c = at(x, y);
      ringAll.push(c);
      if (lum(c[0], c[1], c[2]) >= 25) ringBright.push(c);
    }
  }
  const bgPool = ringBright.length >= ringAll.length * 0.25 ? ringBright : ringAll;
  const bg = medianOf(bgPool);
  const bg255: [number, number, number] = [bg.r * 255, bg.g * 255, bg.b * 255];
  // Foreground: pixels inside the rect far from the background color.
  const glyph: Array<[number, number, number]> = [];
  let inner = 0;
  for (let y = iyTop; y <= iyBot; y++) {
    for (let x = ix0; x <= ix1; x++) {
      inner++;
      const c = at(x, y);
      const d = Math.sqrt(
        (c[0] - bg255[0]) ** 2 + (c[1] - bg255[1]) ** 2 + (c[2] - bg255[2]) ** 2
      );
      if (d > 60) glyph.push(c);
    }
  }
  let fg: SampledRgb;
  if (glyph.length >= inner * 0.02 && glyph.length > 0) {
    fg = medianOf(glyph);
  } else {
    fg = lum(bg255[0], bg255[1], bg255[2]) > 128 ? black : white;
  }
  return { bg, fg };
}

// ---------------------------------------------------------------------------
// Editor font matching: embedded Noto Sans TTFs (bundled at build time)
// ---------------------------------------------------------------------------

/** Cached TTF bytes for the editor's matched fonts (fail-soft -> Helvetica). */
const editorFontBytes: { regular: Uint8Array | null; bold: Uint8Array | null; tried: boolean } = {
  regular: null,
  bold: null,
  tried: false,
};

async function fetchEditorFontBytes(): Promise<void> {
  if (editorFontBytes.tried || typeof fetch === 'undefined') return;
  editorFontBytes.tried = true;
  const get = async (url: string): Promise<Uint8Array | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      return buf.length > 50_000 ? buf : null;
    } catch {
      return null;
    }
  };
  const [reg, bold] = await Promise.all([
    get('/fonts/NotoSans-Regular.ttf'),
    get('/fonts/NotoSans-Bold.ttf'),
  ]);
  editorFontBytes.regular = reg;
  editorFontBytes.bold = bold;
}

type EditorFontKind = 'noto' | 'notoB' | 'helv' | 'helvB';

/**
 * Match the original font name to an available font.
 * 'noto' in name -> embedded Noto Sans (measured from the owner's files:
 * Noto-Sans-Bold headers etc.); helvetica/arial -> standard Helvetica;
 * anything else -> Helvetica fallback. Exported for tests.
 */
export function pickEditorFontKind(block: { fontName: string; bold: boolean }): EditorFontKind {
  const name = (block.fontName || '').toLowerCase();
  const isBold = block.bold || /bold|black|heavy|demi/.test(name);
  if (name.includes('noto')) return isBold ? 'notoB' : 'noto';
  return isBold ? 'helvB' : 'helv';
}

interface EditorFontKit {
  noto: unknown | null;
  notoB: unknown | null;
  helv: unknown;
  helvB: unknown;
}

/** Embed the editor fonts into a pdf-lib document (TTFs cached, fail-soft). */
async function embedEditorFonts(
  doc: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    embedFont: (font: string | Uint8Array, options?: any) => Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerFontkit?: (fk: any) => void;
  },
  StandardFonts: { Helvetica: string; HelveticaBold: string }
): Promise<EditorFontKit> {
  await fetchEditorFontBytes();
  // TTF embedding needs fontkit registered on the document instance.
  try {
    const { default: fontkit } = await import('@pdf-lib/fontkit');
    doc.registerFontkit?.(fontkit);
  } catch {
    // fall through: TTF embeds below will fail-soft to Helvetica
  }
  let noto: unknown | null = null;
  let notoB: unknown | null = null;
  try {
    if (editorFontBytes.regular) noto = await doc.embedFont(editorFontBytes.regular);
  } catch {
    noto = null;
  }
  try {
    if (editorFontBytes.bold) notoB = await doc.embedFont(editorFontBytes.bold);
  } catch {
    notoB = null;
  }
  return {
    noto,
    notoB,
    helv: await doc.embedFont(StandardFonts.Helvetica),
    helvB: await doc.embedFont(StandardFonts.HelveticaBold),
  };
}

function kitFontFor(
  kit: EditorFontKit,
  kind: EditorFontKind
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (kind === 'noto') return kit.noto ?? kit.helv;
  if (kind === 'notoB') return kit.notoB ?? kit.helvB;
  if (kind === 'helvB') return kit.helvB;
  return kit.helv;
}

/**
 * Shared cover-rect layout for a surgical block redraw. The SAME function is
 * used by renderEditedPdf and by the UI's color sampler, so the sampled ring
 * always matches the drawn rectangle.
 *
 * Sizing rule (owner-tested): the box is sized to the NEW text, left/top
 * anchored. A paragraph that fits on one line before the page edge grows the
 * box to the right; otherwise it wraps at the original block width and the
 * box grows taller. We never reflow/shift surrounding content.
 */
export interface CoverLayout {
  x: number;
  y: number; // bottom, PDF points
  w: number;
  h: number;
  lines: string[];
  lineH: number;
}

export async function layoutEditedBlock(
  block: {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    bold: boolean;
    fontName?: string;
  },
  pageW: number
): Promise<CoverLayout> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const probe = await PDFDocument.create();
  const kit = await embedEditorFonts(probe, StandardFonts);
  const font = kitFontFor(kit, pickEditorFontKind({ fontName: block.fontName ?? '', bold: block.bold }));
  const size = block.fontSize;
  const lineH = size * 1.25;
  const EDGE = 8; // keep text off the page edge
  const wrapW = Math.max(40, block.width);
  const lines: string[] = [];
  const measure = (s: string) => font.widthOfTextAtSize(safeWinAnsi(s), size);
  for (const para of block.text.split('\n')) {
    const clean = para.split(/\s+/).filter(Boolean).join(' ');
    if (!clean) {
      lines.push('');
      continue;
    }
    if (block.x + measure(clean) + 4 <= pageW - EDGE) {
      lines.push(clean); // fits on one line — box grows right
    } else {
      // wrap at the original block width — box grows taller instead
      let line = '';
      for (const w of clean.split(' ')) {
        if (w.length > 1 && measure(w) > wrapW) {
          // a single word longer than the wrap width (URL, long string):
          // hard-break it instead of letting the box explode off the page
          if (line) {
            lines.push(line);
            line = '';
          }
          let rest = w;
          while (rest.length > 1 && measure(rest) > wrapW) {
            let lo = 1;
            let hi = rest.length;
            while (lo < hi) {
              const mid = (lo + hi + 1) >> 1;
              if (measure(rest.slice(0, mid)) <= wrapW) lo = mid;
              else hi = mid - 1;
            }
            lines.push(rest.slice(0, lo));
            rest = rest.slice(lo);
          }
          line = rest;
          continue;
        }
        const test = line ? `${line} ${w}` : w;
        if (measure(test) > wrapW && line) {
          lines.push(line);
          line = w;
        } else {
          line = test;
        }
      }
      lines.push(line);
    }
  }
  let maxW = block.width;
  for (const ln of lines) {
    if (ln) maxW = Math.max(maxW, measure(ln));
  }
  const h = Math.max(block.height + 6, lines.length * lineH + 4);
  return {
    x: block.x - 2,
    y: block.y - 4,
    w: maxW + 4,
    h,
    lines,
    lineH,
  };
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
    // Collect each page's distinct pdf.js loadedNames in setFont order so we
    // can map them to the PDF's real BaseFont names (pdf.js never exposes
    // those in getTextContent — items only carry "g_d0_f1"-style keys).
    const setFontOp = lib.OPS?.setFont as number | undefined;
    const pageFontInputs: Array<{ pageNum: number; loadedNames: string[] }> = [];
    const pageTexts: Array<{ pageNum: number; vp: { width: number; height: number }; items: unknown[] }> = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = (await pdf.getPage(p)) as {
        getViewport: (o: { scale: number }) => { width: number; height: number };
        getTextContent: () => Promise<{ items: unknown[] }>;
        getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
        cleanup: () => void;
      };
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const loadedNames: string[] = [];
      if (setFontOp !== undefined) {
        try {
          const ops = await page.getOperatorList();
          const seen = new Set<string>();
          for (let i = 0; i < ops.fnArray.length; i++) {
            if (ops.fnArray[i] === setFontOp) {
              const nm = String((ops.argsArray[i] as unknown[])[0] ?? '');
              if (nm && !seen.has(nm)) {
                seen.add(nm);
                loadedNames.push(nm);
              }
            }
          }
        } catch {
          // font mapping degrades to the loadedName heuristic
        }
      }
      pageFontInputs.push({ pageNum: p, loadedNames });
      pageTexts.push({ pageNum: p, vp, items: tc.items });
      page.cleanup();
    }
    const fontMaps = await mapLoadedFontsToBaseFonts(new Uint8Array(data), pageFontInputs);
    for (const pt of pageTexts) {
      pages.push({
        pageNum: pt.pageNum,
        width: pt.vp.width,
        height: pt.vp.height,
        blocks: groupTextItems(pt.items, pt.pageNum, fontMaps[pt.pageNum]),
      });
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
export function safeWinAnsi(s: string): string {
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
 * Surgical redraw: copy every page as-is (unedited pages are byte-identical);
 * for edited blocks ONLY, paint a rectangle in the block's sampled background
 * color over the original and draw the new text in the sampled foreground
 * color at the original size/position. Design (colors, images, layout) is
 * preserved everywhere else.
 */
export async function renderEditedPdf(
  srcBytes: ArrayBuffer,
  pages: FinalPage[],
  outName: string
): Promise<ConvertResult> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const kit = await embedEditorFonts(out, StandardFonts);
  for (const fp of pages) {
    const [copied] = await out.copyPages(src, [fp.pageNum - 1]);
    out.addPage(copied);
    const pageW = copied.getWidth();
    for (const b of fp.blocks) {
      if (!b.edited) continue;
      const layout = await layoutEditedBlock(b, pageW);
      const bgc = b.bgRgb ?? { r: 1, g: 1, b: 1 };
      const fgc = b.fgRgb ?? { r: 0, g: 0, b: 0 };
      copied.drawRectangle({
        x: layout.x,
        y: layout.y,
        width: layout.w,
        height: layout.h,
        color: rgb(bgc.r, bgc.g, bgc.b),
        borderWidth: 0,
      });
      const font = kitFontFor(kit, pickEditorFontKind(b));
      layout.lines.forEach((ln, i) => {
        if (!ln) return;
        copied.drawText(safeWinAnsi(ln), {
          x: b.x,
          y: b.y - i * layout.lineH,
          size: b.fontSize,
          font,
          color: rgb(fgc.r, fgc.g, fgc.b),
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
    const paras = fp.blocks.map((b) => b.text);
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
    const paras = fp.blocks.map((b) => b.text);
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

// ---------------------------------------------------------------------------
// Text / Markdown / CSV -> PDF (styled document rendering, A4)
// ---------------------------------------------------------------------------

const TPW = 595; // A4 width (pt)
const TPH = 842; // A4 height (pt)
const TM = 56; // margin (pt)

function pdfOutName(file: File): string {
  return `${baseName(file)}.pdf`;
}

function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
}

/** Plain text -> simple paginated PDF. */
export async function textToPdf(file: File): Promise<ConvertResult> {
  const src = await file.text();
  if (!src.trim()) throw new Error('That text file looks empty.');
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const black = rgb(0, 0, 0);
  const size = 11;
  const maxW = TPW - 2 * TM;
  let page = doc.addPage([TPW, TPH]);
  let y = TPH - TM;
  for (const ln of wrapLines(src, font, size, maxW)) {
    if (y < TM + size) {
      page = doc.addPage([TPW, TPH]);
      y = TPH - TM;
    }
    if (ln) page.drawText(safeWinAnsi(ln), { x: TM, y: y - size, size, font, color: black });
    y -= size * 1.5;
  }
  const bytes = await doc.save();
  return { blob: pdfBlob(bytes), filename: pdfOutName(file) };
}

/** Markdown -> styled PDF: headings, lists, code blocks, bold/italic/code runs. */
export async function markdownToPdf(file: File): Promise<ConvertResult> {
  const src = await file.text();
  if (!src.trim()) throw new Error('That Markdown file looks empty.');
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold);
  const helvO = await doc.embedFont(StandardFonts.HelveticaOblique);
  const courier = await doc.embedFont(StandardFonts.Courier);
  const black = rgb(0, 0, 0);
  const gray = rgb(0.42, 0.42, 0.42);
  const codeBg = rgb(0.95, 0.95, 0.95);
  const maxW = TPW - 2 * TM;

  type Run = { text: string; font: typeof helv };
  const parseRuns = (s: string): Run[] => {
    const runs: Run[] = [];
    const re = /(\*\*.+?\*\*|\*[^*\n]+?\*|`[^`\n]+?`)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (m.index > last) runs.push({ text: s.slice(last, m.index), font: helv });
      const tok = m[0];
      if (tok.startsWith('**')) runs.push({ text: tok.slice(2, -2), font: helvB });
      else if (tok.startsWith('`')) runs.push({ text: tok.slice(1, -1), font: courier });
      else runs.push({ text: tok.slice(1, -1), font: helvO });
      last = m.index + tok.length;
    }
    if (last < s.length) runs.push({ text: s.slice(last), font: helv });
    return runs.filter((r) => r.text);
  };

  let page = doc.addPage([TPW, TPH]);
  let y = TPH - TM;
  const ensure = (need: number) => {
    if (y - need < TM) {
      page = doc.addPage([TPW, TPH]);
      y = TPH - TM;
    }
  };

  // Draw rich-text runs with word wrap; returns nothing (tracks page/y in closure).
  const drawRuns = (runs: Run[], x0: number, size: number, color: ReturnType<typeof rgb>) => {
    const words: Run[] = [];
    for (const r of runs) {
      const parts = r.text.split(/(\s+)/);
      for (const p of parts) if (p) words.push({ text: p, font: r.font });
    }
    let cx = x0;
    for (const w of words) {
      const safe = safeWinAnsi(w.text);
      const ww = w.font.widthOfTextAtSize(safe, size);
      if (cx + ww > x0 + maxW && cx > x0) {
        cx = x0;
        y -= size * 1.55;
        ensure(size * 1.55);
      }
      page.drawText(safe, { x: cx, y: y - size, size, font: w.font, color });
      cx += ww;
    }
    y -= size * 1.55;
  };

  const lines = src.split('\n');
  let inCode = false;
  let codeBuf: string[] = [];
  const flushCode = () => {
    if (!codeBuf.length) return;
    const size = 10;
    const lh = size * 1.6;
    ensure(lh + 8);
    const blockH = codeBuf.length * lh + 10;
    if (y - blockH < TM) {
      page = doc.addPage([TPW, TPH]);
      y = TPH - TM;
    }
    page.drawRectangle({ x: TM - 6, y: y - blockH, width: maxW + 12, height: blockH, color: codeBg });
    y -= 5;
    for (const ln of codeBuf) {
      y -= lh;
      page.drawText(safeWinAnsi(ln.slice(0, 120)), { x: TM, y, size, font: courier, color: black });
    }
    y -= 10;
    codeBuf = [];
  };

  for (const raw of lines) {
    const ln = raw.replace(/\s+$/, '');
    if (/^```/.test(ln)) {
      if (inCode) flushCode();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeBuf.push(ln);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(ln);
    if (h) {
      const level = h[1].length;
      const size = level === 1 ? 20 : level === 2 ? 16 : level === 3 ? 13 : 12;
      ensure(size * 2.2);
      y -= 4;
      drawRuns(parseRuns(h[2]).map((r) => ({ ...r, font: level <= 2 ? helvB : r.font })), TM, size, black);
      y -= 4;
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(ln);
    if (li) {
      const bullet = /^\d/.test(li[2]) ? `${li[2]} ` : '• ';
      ensure(14 * 2);
      drawRuns([{ text: bullet, font: helv }, ...parseRuns(li[3])], TM + (li[1].length > 0 ? 18 : 0), 11, black);
      continue;
    }
    const bq = /^>\s?(.*)$/.exec(ln);
    if (bq) {
      ensure(14 * 2);
      drawRuns(parseRuns(bq[1]), TM + 14, 11, gray);
      continue;
    }
    if (!ln.trim()) {
      y -= 7;
      continue;
    }
    ensure(14 * 2);
    drawRuns(parseRuns(ln), TM, 11, black);
  }
  flushCode();

  const bytes = await doc.save();
  return { blob: pdfBlob(bytes), filename: pdfOutName(file) };
}

/** CSV -> PDF table: header row, grid lines, auto-sized columns. */
export async function csvToPdf(file: File): Promise<ConvertResult> {
  const { parseCsv } = await import('./text');
  const src = await file.text();
  const rows = parseCsv(src);
  if (!rows.length) throw new Error('That CSV looks empty.');
  const MAXR = 500;
  const data = rows.slice(0, MAXR).map((r) => r.map((c) => (c.length > 220 ? c.slice(0, 220) : c)));
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const headBg = rgb(0.94, 0.94, 0.94);
  const grid = rgb(0.78, 0.78, 0.78);

  const cols = Math.max(...data.map((r) => r.length));
  const table = data.map((r) => {
    const n = [...r];
    while (n.length < cols) n.push('');
    return n;
  });

  const avail = TPW - 72;
  let size = 10;
  const measure = (s: number): number[] => {
    const w = new Array<number>(cols).fill(0);
    table.forEach((r, ri) => {
      r.forEach((c, i) => {
        const f = ri === 0 ? helvB : helv;
        w[i] = Math.max(w[i], f.widthOfTextAtSize(safeWinAnsi(c), s));
      });
    });
    return w;
  };
  let widths = measure(size);
  let totalPad = (cols + 1) * 6;
  let total = widths.reduce((a, b) => a + b, 0) + totalPad;
  while (total > avail && size > 7) {
    size -= 1;
    widths = measure(size);
    total = widths.reduce((a, b) => a + b, 0) + totalPad;
  }
  if (total > avail) {
    const k = avail / total;
    widths = widths.map((w) => w * k);
    total = avail;
  }
  const boundaries: number[] = [0];
  widths.forEach((w) => boundaries.push(boundaries[boundaries.length - 1] + w + 6));
  const rowH = size * 2.1;
  const x0 = 36 + (avail - total) / 2;

  let page = doc.addPage([TPW, TPH]);
  let y = TPH - 56;
  page.drawText(safeWinAnsi(baseName(file)), { x: 36, y: y - 14, size: 14, font: helvB, color: black });
  y -= 36;

  table.forEach((r, ri) => {
    const header = ri === 0;
    if (y - rowH < 40) {
      page = doc.addPage([TPW, TPH]);
      y = TPH - 56;
    }
    if (header) {
      page.drawRectangle({ x: x0, y: y - rowH, width: total, height: rowH, color: headBg });
    }
    const font = header ? helvB : helv;
    r.forEach((c, i) => {
      let txt = safeWinAnsi(c);
      const cw = widths[i];
      while (font.widthOfTextAtSize(txt, size) > cw && txt.length > 4) txt = txt.slice(0, -2);
      if (txt.length < c.length && txt.length > 4) txt = txt.slice(0, -1) + '…';
      page.drawText(txt, {
        x: x0 + boundaries[i] + 3,
        y: y - rowH + (rowH - size) / 2 - 1,
        size,
        font,
        color: black,
      });
    });
    page.drawLine({ start: { x: x0, y }, end: { x: x0 + total, y }, thickness: 0.75, color: grid });
    page.drawLine({ start: { x: x0, y: y - rowH }, end: { x: x0 + total, y: y - rowH }, thickness: 0.75, color: grid });
    boundaries.forEach((b) => {
      page.drawLine({ start: { x: x0 + b, y }, end: { x: x0 + b, y: y - rowH }, thickness: 0.75, color: grid });
    });
    y -= rowH;
  });

  const bytes = await doc.save();
  return { blob: pdfBlob(bytes), filename: pdfOutName(file) };
}
