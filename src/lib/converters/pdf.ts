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
// Organize PDF (reorder pages: "3,1,2" — duplicates and out-of-range dropped)
// ---------------------------------------------------------------------------

function parseOrder(order: string, numPages: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const part of order.split(',')) {
    const n = parseInt(part.trim(), 10);
    if (!Number.isNaN(n) && n >= 1 && n <= numPages && !seen.has(n)) {
      seen.add(n);
      out.push(n - 1);
    }
  }
  return out;
}

export async function organizePdf(file: File, order: string): Promise<ConvertResult> {
  const pdf = await openPdf(file);
  const indices = parseOrder(order, pdf.numPages);
  if (indices.length === 0) {
    throw new Error(
      'No valid page numbers found — type the new order like "3, 1, 2". ' +
        `This PDF has ${pdf.numPages} pages.`
    );
  }
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
    filename: `${base}-organized.pdf`,
  };
}

// ---------------------------------------------------------------------------
// Repair PDF (rebuild a damaged PDF by re-saving what still parses)
// ---------------------------------------------------------------------------

export async function repairPdf(file: File): Promise<ConvertResult> {
  const { PDFDocument } = await import('pdf-lib');
  let src: Awaited<ReturnType<typeof PDFDocument.load>>;
  try {
    src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  } catch (e) {
    throw new Error(
      'This PDF is too damaged to repair — none of its pages could be read. ' +
        'Try re-downloading or re-exporting the original file.'
    );
  }
  const out = await PDFDocument.create();
  const n = src.getPageCount();
  if (n === 0) throw new Error('No readable pages found in this PDF.');
  const pages = await out.copyPages(src, [...Array(n).keys()]);
  pages.forEach((p) => out.addPage(p));
  const bytes = await out.save();
  const base = baseName(file);
  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
    filename: `${base}-repaired.pdf`,
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
  return compressPdfAtLevel(file, level);
}

/**
 * Compress a PDF aiming for an exact target size: tries 'low' first, then
 * steps quality UP while the result stays at/under the target, so the user
 * gets the best quality that still fits. Returns the smallest result when
 * even 'low' overshoots (honest — the UI reports actual bytes).
 */
export async function compressPdfToSize(
  file: File,
  targetBytes: number
): Promise<ConvertResult & { levelUsed: CompressLevel; hitTarget: boolean }> {
  const order: CompressLevel[] = ['low', 'medium', 'high'];
  let bestFit: (ConvertResult & { levelUsed: CompressLevel }) | null = null;
  let smallest: (ConvertResult & { levelUsed: CompressLevel }) | null = null;
  for (const level of order) {
    const r = await compressPdfAtLevel(file, level);
    const tagged = { ...r, levelUsed: level };
    if (!smallest || r.blob.size < smallest.blob.size) smallest = tagged;
    if (r.blob.size <= targetBytes) {
      bestFit = tagged; // fits — try one step better quality
    } else {
      break; // overshoots — stop here
    }
  }
  const winner = bestFit ?? smallest!;
  return { ...winner, hitTarget: winner.blob.size <= targetBytes };
}

async function compressPdfAtLevel(
  file: File,
  level: CompressLevel
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

export async function extractPageTexts(file: File): Promise<string[][]> {
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
// PDF -> Markdown (text extraction with heading/list structure)
// ---------------------------------------------------------------------------

export async function pdfToMarkdown(file: File): Promise<ConvertResult> {
  const pages = await extractPageTexts(file);
  const hasText = pages.some((p) => p.join('').trim().length > 0);
  if (!hasText) {
    throw new Error(
      'No text found in this PDF — it may be a scanned document (pictures of text). ' +
        'Scanned PDFs need OCR, which the browser version does not do yet.'
    );
  }
  const md: string[] = [];
  pages.forEach((paras, pi) => {
    if (pi > 0) md.push('\n---\n');
    paras.forEach((para, idx) => {
      const t = para.trim();
      if (!t) return;
      const isHeading = idx === 0 && t.length < 80 && !/[.!?]$/.test(t);
      const isList = /^([•\-\*]|\d+[.)])\s+/.test(t);
      if (isHeading) md.push(`# ${t}\n`);
      else if (isList) md.push(`- ${t.replace(/^([•\-\*]|\d+[.)])\s+/, '')}\n`);
      else md.push(`${t}\n`);
    });
  });
  const base = baseName(file);
  return { blob: new Blob([md.join('\n')], { type: 'text/markdown' }), filename: `${base}.md` };
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

/** One font run inside a block: consecutive glyphs sharing a font/weight. */
export interface TextRun {
  text: string;
  /** Raw pdf.js font name (lowercased) for this run. */
  fontName: string;
  bold: boolean;
  italic: boolean;
}

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
  /**
   * Per-run font splits (same order as the text). A line like "Insight: ..."
   * is usually bold label + regular body — redrawing the WHOLE line in bold
   * makes it up to ~7% wider than the original, which is what wrapped the
   * editor boxes and pushed redrawn lines past their card edge (QA run 1).
   */
  spans?: TextRun[];
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
  /** Original text before the edit (for cover sizing — see layoutEditedBlock). */
  origText?: string;
  /** Sampled from the original page render — cover fill for surgical redraw. */
  bgRgb?: SampledRgb;
  /** Sampled from the original page render — redrawn text color. */
  fgRgb?: SampledRgb;
}

export interface FinalPage {
  pageNum: number; // 1-based index into the source document
  blocks: FinalBlock[];
  overlays: PageOverlay[];
}

/**
 * A user annotation placed on a page (iLovePDF-style toolbar tools).
 * Coordinates are PDF units, origin bottom-left — the same space as blocks.
 */
export interface PageOverlay {
  id: string;
  kind: 'text' | 'highlight' | 'draw' | 'shape' | 'image' | 'underline' | 'strikeout' | 'whiteout';
  /** 1-based page number this overlay belongs to. */
  pageNum: number;
  /** Bounding box in PDF units (origin bottom-left). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** text kind */
  text?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  /** text font family: serif (Times), sans (Helvetica), mono (Courier). Default sans. */
  fontFamily?: 'serif' | 'sans' | 'mono';
  /** original PDF font name (lowercased) of the nearest block, for Calibri/Cambria mapping. */
  fontName?: string;
  /** text alignment inside the overlay box. Default left. */
  align?: 'left' | 'center' | 'right';
  /** underline the added text. Default false. */
  underline?: boolean;
  /** stroke/text color */
  color?: { r: number; g: number; b: number };
  /** shape kind: rect | ellipse | line */
  shape?: 'rect' | 'ellipse' | 'line';
  /** fill color for shapes, marker color for highlights */
  fill?: { r: number; g: number; b: number };
  opacity?: number;
  /** draw stroke width / shape border width (PDF units) */
  thickness?: number;
  /** draw kind: freehand strokes, absolute PDF-unit coords */
  strokes?: Array<Array<{ x: number; y: number }>>;
  /** image kind */
  imageBytes?: ArrayBuffer;
  imageMime?: string;
}

let overlaySeq = 0;
/** Fresh overlay id (unique per session). */
export function newOverlayId(): string {
  overlaySeq += 1;
  return `ov-${Date.now().toString(36)}-${overlaySeq}`;
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
      const spans: TextRun[] = [];
      const pushSpan = (s: string, fontName: string) => {
        if (!s) return;
        const last = spans[spans.length - 1];
        const bold = /bold|black|heavy|demi/.test(fontName);
        const italic = /italic|oblique/.test(fontName);
        if (last && last.fontName === fontName && last.bold === bold && last.italic === italic) {
          last.text += s;
        } else {
          spans.push({ text: s, fontName, bold, italic });
        }
      };
      cur.forEach((s, i) => {
        if (i > 0) {
          const prev = cur[i - 1];
          const gap = s.x - (prev.x + prev.w);
          if (gap > s.fontSize * 0.25 && !/\s$/.test(text) && !/^\s/.test(s.str)) {
            text += ' ';
            pushSpan(' ', prev.fontName);
          }
        }
        text += s.str;
        pushSpan(s.str, s.fontName);
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
        spans,
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
  // Transparent pixels are NOT paint — a never-painted canvas is all
  // RGBA(0,0,0,0), which the old code read as a black page with white
  // glyphs and produced the white-on-black download bars (QA run 1,
  // page 2: 19 black covers + 19 white text draws). Skip them entirely;
  // a fully transparent sample is an unpainted page: white bg, black fg.
  const opaque = (x: number, y: number): boolean => px.data[(y * px.width + x) * 4 + 3] >= 128;
  let opaqueSeen = 0;
  for (let y = oy0; y <= oy1; y += Math.max(1, Math.floor((oy1 - oy0) / 40))) {
    for (let x = ox0; x <= ox1; x += Math.max(1, Math.floor((ox1 - ox0) / 40))) {
      if (opaque(x, y)) opaqueSeen++;
    }
  }
  if (opaqueSeen === 0) return { bg: white, fg: black };
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
      if (!opaque(x, y)) continue;
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
      if (!opaque(x, y)) continue;
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
const editorFontBytes: {
  regular: Uint8Array | null;
  bold: Uint8Array | null;
  carlito: Uint8Array | null;
  carlitoB: Uint8Array | null;
  carlitoI: Uint8Array | null;
  carlitoBI: Uint8Array | null;
  caladea: Uint8Array | null;
  caladeaB: Uint8Array | null;
  caladeaI: Uint8Array | null;
  caladeaBI: Uint8Array | null;
  tried: boolean;
} = {
  regular: null,
  bold: null,
  carlito: null,
  carlitoB: null,
  carlitoI: null,
  carlitoBI: null,
  caladea: null,
  caladeaB: null,
  caladeaI: null,
  caladeaBI: null,
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
  const [reg, bold, carlito, carlitoB, carlitoI, carlitoBI, caladea, caladeaB, caladeaI, caladeaBI] =
    await Promise.all([
      get('/fonts/NotoSans-Regular.ttf'),
      get('/fonts/NotoSans-Bold.ttf'),
      get('/fonts/Carlito-Regular.ttf'),
      get('/fonts/Carlito-Bold.ttf'),
      get('/fonts/Carlito-Italic.ttf'),
      get('/fonts/Carlito-BoldItalic.ttf'),
      get('/fonts/Caladea-Regular.ttf'),
      get('/fonts/Caladea-Bold.ttf'),
      get('/fonts/Caladea-Italic.ttf'),
      get('/fonts/Caladea-BoldItalic.ttf'),
    ]);
  editorFontBytes.regular = reg;
  editorFontBytes.bold = bold;
  editorFontBytes.carlito = carlito;
  editorFontBytes.carlitoB = carlitoB;
  editorFontBytes.carlitoI = carlitoI;
  editorFontBytes.carlitoBI = carlitoBI;
  editorFontBytes.caladea = caladea;
  editorFontBytes.caladeaB = caladeaB;
  editorFontBytes.caladeaI = caladeaI;
  editorFontBytes.caladeaBI = caladeaBI;
}

type EditorFontKind =
  | 'noto'
  | 'notoB'
  | 'helv'
  | 'helvB'
  | 'carlito'
  | 'carlitoB'
  | 'carlitoI'
  | 'carlitoBI'
  | 'caladea'
  | 'caladeaB'
  | 'caladeaI'
  | 'caladeaBI';

/**
 * Match the original font name to an available font.
 * 'noto' in name -> embedded Noto Sans (measured from the owner's files:
 * Noto-Sans-Bold headers etc.); Calibri/Cambria -> their metric-identical
 * open twins Carlito/Caladea (real Calibri/Cambria are Microsoft-proprietary
 * and cannot be legally bundled); helvetica/arial -> standard Helvetica;
 * anything else -> Helvetica fallback. Exported for tests.
 */
export function pickEditorFontKind(block: { fontName: string; bold: boolean }): EditorFontKind {
  const name = (block.fontName || '').toLowerCase();
  return kindFromName(name, block.bold, false);
}

interface EditorFontKit {
  noto: unknown | null;
  notoB: unknown | null;
  carlito: unknown | null;
  carlitoB: unknown | null;
  carlitoI: unknown | null;
  carlitoBI: unknown | null;
  caladea: unknown | null;
  caladeaB: unknown | null;
  caladeaI: unknown | null;
  caladeaBI: unknown | null;
  helv: unknown;
  helvB: unknown;
  helvI: unknown;
  helvBI: unknown;
  times: unknown;
  timesB: unknown;
  timesI: unknown;
  timesBI: unknown;
  cour: unknown;
  courB: unknown;
  courO: unknown;
  courBO: unknown;
}

/** Embed the editor fonts into a pdf-lib document (TTFs cached, fail-soft). */
async function embedEditorFonts(
  doc: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    embedFont: (font: string | Uint8Array, options?: any) => Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerFontkit?: (fk: any) => void;
  },
  StandardFonts: {
    Helvetica: string;
    HelveticaBold: string;
    HelveticaOblique: string;
    HelveticaBoldOblique: string;
    TimesRoman: string;
    TimesRomanBold: string;
    TimesRomanItalic: string;
    TimesRomanBoldItalic: string;
    Courier: string;
    CourierBold: string;
    CourierOblique: string;
    CourierBoldOblique: string;
  }
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
  // Carlito / Caladea (metric twins of Calibri / Cambria), fail-soft to null.
  const embedOpt = async (bytes: Uint8Array | null): Promise<unknown | null> => {
    try {
      return bytes ? await doc.embedFont(bytes) : null;
    } catch {
      return null;
    }
  };
  const carlito = await embedOpt(editorFontBytes.carlito);
  const carlitoB = await embedOpt(editorFontBytes.carlitoB);
  const carlitoI = await embedOpt(editorFontBytes.carlitoI);
  const carlitoBI = await embedOpt(editorFontBytes.carlitoBI);
  const caladea = await embedOpt(editorFontBytes.caladea);
  const caladeaB = await embedOpt(editorFontBytes.caladeaB);
  const caladeaI = await embedOpt(editorFontBytes.caladeaI);
  const caladeaBI = await embedOpt(editorFontBytes.caladeaBI);
  return {
    noto,
    notoB,
    carlito,
    carlitoB,
    carlitoI,
    carlitoBI,
    caladea,
    caladeaB,
    caladeaI,
    caladeaBI,
    helv: await doc.embedFont(StandardFonts.Helvetica),
    helvB: await doc.embedFont(StandardFonts.HelveticaBold),
    helvI: await doc.embedFont(StandardFonts.HelveticaOblique),
    helvBI: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    times: await doc.embedFont(StandardFonts.TimesRoman),
    timesB: await doc.embedFont(StandardFonts.TimesRomanBold),
    timesI: await doc.embedFont(StandardFonts.TimesRomanItalic),
    timesBI: await doc.embedFont(StandardFonts.TimesRomanBoldItalic),
    cour: await doc.embedFont(StandardFonts.Courier),
    courB: await doc.embedFont(StandardFonts.CourierBold),
    courO: await doc.embedFont(StandardFonts.CourierOblique),
    courBO: await doc.embedFont(StandardFonts.CourierBoldOblique),
  };
}

function kitFontFor(
  kit: EditorFontKit,
  kind: EditorFontKind
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (kind === 'noto') return kit.noto ?? kit.helv;
  if (kind === 'notoB') return kit.notoB ?? kit.helvB;
  if (kind === 'carlito') return kit.carlito ?? kit.helv;
  if (kind === 'carlitoB') return kit.carlitoB ?? kit.helvB;
  if (kind === 'carlitoI') return kit.carlitoI ?? kit.helvI;
  if (kind === 'carlitoBI') return kit.carlitoBI ?? kit.helvBI;
  if (kind === 'caladea') return kit.caladea ?? kit.times;
  if (kind === 'caladeaB') return kit.caladeaB ?? kit.timesB;
  if (kind === 'caladeaI') return kit.caladeaI ?? kit.timesI;
  if (kind === 'caladeaBI') return kit.caladeaBI ?? kit.timesBI;
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
  /** Per-line font runs for drawing (same text as `lines`, split by font). */
  lineRuns?: Array<Array<{ text: string; kind: EditorFontKind }>>;
}

/** Font kind for one run, from its own font name + weight (not the block's). */
function kindFromName(name: string, bold: boolean, italic: boolean): EditorFontKind {
  const n = (name || '').toLowerCase();
  const isBold = bold || /bold|black|heavy|demi/.test(n);
  const isItalic = italic || /italic|oblique/.test(n);
  if (/calibri|carlito/.test(n)) {
    if (isBold && isItalic) return 'carlitoBI';
    if (isBold) return 'carlitoB';
    if (isItalic) return 'carlitoI';
    return 'carlito';
  }
  if (/cambria|caladea/.test(n)) {
    if (isBold && isItalic) return 'caladeaBI';
    if (isBold) return 'caladeaB';
    if (isItalic) return 'caladeaI';
    return 'caladea';
  }
  if (n.includes('noto')) return isBold ? 'notoB' : 'noto';
  // DejaVu / Arial / Helvetica / Liberation Sans: no bundled twin, but the
  // embedded Noto Sans is a close sans with far wider glyph coverage than
  // standard Helvetica — and standard fonts THROW on non-WinAnsi chars
  // (arrows, dashes) instead of drawing them.
  if (/dejavu|arial|helvetica|liberation/.test(n)) return isBold ? 'notoB' : 'noto';
  return isBold ? 'helvB' : 'helv';
}

/** True when the kind resolves to a bundled embedded TTF (wide glyph cover). */
function fontIsEmbedded(kit: EditorFontKit, kind: EditorFontKind): boolean {
  switch (kind) {
    case 'noto': return !!kit.noto;
    case 'notoB': return !!kit.notoB;
    case 'carlito': return !!kit.carlito;
    case 'carlitoB': return !!kit.carlitoB;
    case 'carlitoI': return !!kit.carlitoI;
    case 'carlitoBI': return !!kit.carlitoBI;
    case 'caladea': return !!kit.caladea;
    case 'caladeaB': return !!kit.caladeaB;
    case 'caladeaI': return !!kit.caladeaI;
    case 'caladeaBI': return !!kit.caladeaBI;
    default: return false;
  }
}

/**
 * Width of one run's text in its font. Embedded TTFs take the wide sanitizer
 * (dashes/arrows render); standard fonts take the strict WinAnsi sanitizer —
 * measuring '→' against Helvetica throws instead of drawing.
 */
function widthOfRun(kit: EditorFontKit, kind: EditorFontKind, text: string, size: number): number {
  const font = kitFontFor(kit, kind);
  const clean = fontIsEmbedded(kit, kind) ? sanitizeDrawText(text) : safeWinAnsi(text);
  return font.widthOfTextAtSize(clean, size);
}

/** Draw one run's text, with the sanitizer matching its font (see widthOfRun). */
function cleanRunText(kit: EditorFontKit, kind: EditorFontKind, text: string): string {
  return fontIsEmbedded(kit, kind) ? sanitizeDrawText(text) : safeWinAnsi(text);
}

/**
 * Map (possibly edited) text onto the block's original font runs, word by
 * word: word N of the new text takes the font of word N of the original
 * (extra words take the last run's font). So "Insight: ..." stays bold-label
 * + regular-body after any word edit, and the first word's replacement
 * inherits the first word's weight.
 */
export function runsForText(
  spans: TextRun[] | undefined,
  text: string,
  fallback: { fontName?: string; bold: boolean }
): Array<{ text: string; kind: EditorFontKind }> {
  const fallbackKind = pickEditorFontKind({ fontName: fallback.fontName ?? '', bold: fallback.bold });
  if (!spans || spans.length === 0 || !text) {
    return text ? [{ text, kind: fallbackKind }] : [];
  }
  const origKinds: EditorFontKind[] = [];
  for (const sp of spans) {
    const kind = kindFromName(sp.fontName, sp.bold, sp.italic);
    for (const w of sp.text.split(/\s+/).filter(Boolean)) origKinds.push(kind);
  }
  if (origKinds.length === 0) return [{ text, kind: fallbackKind }];
  const out: Array<{ text: string; kind: EditorFontKind }> = [];
  const push = (t: string, kind: EditorFontKind) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += t;
    else out.push({ text: t, kind });
  };
  let wi = 0;
  for (const tok of text.split(/(\s+)/)) {
    if (!tok) continue;
    const kind = origKinds[Math.min(wi, origKinds.length - 1)];
    push(tok, kind);
    if (!/^\s+$/.test(tok)) wi++;
  }
  return out;
}

function measureRuns(
  kit: EditorFontKit,
  runs: Array<{ text: string; kind: EditorFontKind }>,
  size: number
): number {
  let w = 0;
  for (const r of runs) {
    w += widthOfRun(kit, r.kind, r.text, size);
  }
  return w;
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
    spans?: TextRun[];
  },
  pageW: number,
  opts: { originalText?: string; maxRight?: number } = {}
): Promise<CoverLayout> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const probe = await PDFDocument.create();
  const kit = await embedEditorFonts(probe, StandardFonts);
  const size = block.fontSize;
  const lineH = size * 1.25;
  const EDGE = 8; // keep text off the page edge
  const wrapW = Math.max(40, block.width);
  // Right limit for a single line: page edge, or the next block on the same
  // visual row (never draw/cover over a neighbour's glyphs).
  const maxRight = opts.maxRight ?? pageW - EDGE;
  const measureText = (s: string) => measureRuns(kit, runsForText(block.spans, s, block), size);
  const lines: string[] = [];
  const lineRuns: Array<Array<{ text: string; kind: EditorFontKind }>> = [];
  const pushLine = (runs: Array<{ text: string; kind: EditorFontKind }>) => {
    lines.push(runs.map((r) => r.text).join(''));
    lineRuns.push(runs);
  };
  for (const para of block.text.split('\n')) {
    const clean = para.split(/\s+/).filter(Boolean).join(' ');
    if (!clean) {
      lines.push('');
      lineRuns.push([]);
      continue;
    }
    if (block.x + measureText(clean) + 4 <= maxRight) {
      pushLine(runsForText(block.spans, clean, block)); // fits on one line — box grows right
      continue;
    }
    // Wrap at the original block width — box grows taller instead.
    // Words keep their own font run so a wrapped line still measures/draws
    // bold-label + regular-body instead of one wide bold blob.
    const words: Array<{ word: string; kind: EditorFontKind; w: number }> = [];
    for (const r of runsForText(block.spans, clean, block)) {
      for (const w of r.text.split(/\s+/).filter(Boolean)) {
        words.push({ word: w, kind: r.kind, w: widthOfRun(kit, r.kind, w, size) });
      }
    }
    const spaceW = (kind: EditorFontKind) => widthOfRun(kit, kind, ' ', size);
    let line: Array<{ word: string; kind: EditorFontKind; w: number }> = [];
    let lineW = 0;
    const flushLine = () => {
      if (!line.length) return;
      const runs: Array<{ text: string; kind: EditorFontKind }> = [];
      for (const t of line) {
        const last = runs[runs.length - 1];
        if (last && last.kind === t.kind) last.text += ` ${t.word}`;
        else runs.push({ text: t.word, kind: t.kind });
      }
      pushLine(runs);
      line = [];
      lineW = 0;
    };
    for (const tok of words) {
      if (tok.word.length > 1 && tok.w > wrapW) {
        // A single word longer than the wrap width (URL, long string):
        // hard-break it instead of letting the box explode off the page.
        flushLine();
        let rest = tok.word;
        while (rest.length > 1 && widthOfRun(kit, tok.kind, rest, size) > wrapW) {
          let lo = 1;
          let hi = rest.length;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (widthOfRun(kit, tok.kind, rest.slice(0, mid), size) <= wrapW) lo = mid;
            else hi = mid - 1;
          }
          pushLine([{ text: rest.slice(0, lo), kind: tok.kind }]);
          rest = rest.slice(lo);
        }
        line = [{ word: rest, kind: tok.kind, w: widthOfRun(kit, tok.kind, rest, size) }];
        lineW = line[0].w;
        continue;
      }
      const add = line.length ? spaceW(line[line.length - 1].kind) + tok.w : tok.w;
      if (line.length && lineW + add > wrapW) {
        flushLine();
        line = [tok];
        lineW = tok.w;
      } else {
        line.push(tok);
        lineW += add;
      }
    }
    flushLine();
  }
  // Cover must hide the ORIGINAL line too — pdf.js block.width can understate
  // the true glyph extent (QA run 1: ")E)" tail peeking past the cover), so
  // size it to the widest of original width, measured original text and
  // measured new text. Clamp the right edge at maxRight so a neighbour on
  // the same row is never covered.
  let maxW = block.width;
  if (opts.originalText) maxW = Math.max(maxW, measureText(opts.originalText));
  for (const runs of lineRuns) {
    if (runs.length) maxW = Math.max(maxW, measureRuns(kit, runs, size));
  }
  const coverX = block.x - 2;
  let coverW = maxW + 4;
  const roomRight = maxRight - coverX;
  if (roomRight > 20) coverW = Math.min(coverW, roomRight);
  const h = Math.max(block.height + 6, lines.length * lineH + 4);
  return {
    x: coverX,
    y: block.y - 4,
    w: coverW,
    h,
    lines,
    lineH,
    lineRuns,
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
    // pdf.js detaches the buffer it is given — hand it a copy, keep the
    // original for pdf-lib use below (mapLoadedFontsToBaseFonts).
    // (QC: detached ArrayBuffer threw "attempting to access detached ArrayBuffer".)
    pdf = await lib.getDocument({ data: data.slice(0) }).promise;
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

/**
 * Sanitize text for drawing with an embedded TTF via pdf-lib/fontkit.
 * Verified by byte test (2026-11-05): the embedded Noto Sans renders
 * en/em dashes, curly quotes, ellipsis, bullets, arrows, accents, ©/®/™
 * correctly — the old WinAnsi-only filter turned ALL of them into '?'.
 * Only pictographs/emoji are dropped: no standard PDF font can draw color
 * emoji, and leaving them in renders as a stray fallback glyph.
 */
const EMOJI_RE =
  /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\uFE0E\uFE0F\u200D\u200B]/gu;
export function sanitizeDrawText(s: string): string {
  return s
    .replace(EMOJI_RE, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\S\n ]+/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/**
 * Standard PDF fonts only speak Latin — sanitize anything else.
 * Kept STRICT (WinAnsi only): several converters draw with StandardFonts
 * (Helvetica/Times), where pdf-lib throws on characters outside WinAnsi.
 * The editor's embedded-TTF paths use sanitizeDrawText instead, which
 * keeps dashes/arrows/quotes and only drops emoji.
 */
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
      // Same-row neighbour limit: the next block on this baseline (if any)
      // caps how far this block's cover/text may grow to the right.
      let maxRight = pageW - 8;
      for (const o of fp.blocks) {
        if (o !== b && Math.abs(o.y - b.y) <= 2.5 && o.x > b.x) {
          maxRight = Math.min(maxRight, o.x - 2);
        }
      }
      const layout = await layoutEditedBlock(b, pageW, {
        originalText: b.origText,
        maxRight,
      });
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
      // Draw per font run: "Insight:" stays bold, the body stays regular,
      // so the redrawn line measures (and looks) like the original.
      layout.lines.forEach((ln, i) => {
        if (!ln) return;
        const runs = layout.lineRuns?.[i] ?? [
          { text: ln, kind: pickEditorFontKind(b) },
        ];
        let cx = b.x;
        for (const r of runs) {
          if (!r.text) continue;
          const font = kitFontFor(kit, r.kind);
          copied.drawText(cleanRunText(kit, r.kind, r.text), {
            x: cx,
            y: b.y - i * layout.lineH,
            size: b.fontSize,
            font,
            color: rgb(fgc.r, fgc.g, fgc.b),
          });
          cx += widthOfRun(kit, r.kind, r.text, b.fontSize);
        }
      });
    }
    // ---- user annotations (toolbar tools) ----
    for (const o of fp.overlays ?? []) {
      const oc = o.color ?? { r: 0, g: 0, b: 0 };
      if (o.kind === 'highlight') {
        const fc = o.fill ?? { r: 1, g: 0.92, b: 0.35 };
        copied.drawRectangle({
          x: o.x,
          y: o.y,
          width: o.w,
          height: o.h,
          color: rgb(fc.r, fc.g, fc.b),
          opacity: o.opacity ?? 0.35,
          borderWidth: 0,
        });
      } else if (o.kind === 'whiteout') {
        // Opaque white cover — hides whatever was underneath, like correction
        // fluid. Drawn after earlier overlays in page order, so it covers
        // original content (and any highlight under it).
        copied.drawRectangle({
          x: o.x,
          y: o.y,
          width: o.w,
          height: o.h,
          color: rgb(1, 1, 1),
          opacity: 1,
          borderWidth: 0,
        });
      } else if (o.kind === 'underline' || o.kind === 'strikeout') {
        const ly = o.kind === 'underline' ? o.y + 2 : o.y + o.h * 0.45;
        copied.drawLine({
          start: { x: o.x, y: ly },
          end: { x: o.x + o.w, y: ly },
          thickness: Math.max(1, (o.thickness ?? 1.5)),
          color: rgb(oc.r, oc.g, oc.b),
          opacity: o.opacity ?? 1,
        });
      } else if (o.kind === 'text' && o.text) {
        // Pick the embedded font matching the overlay's family + bold/italic.
        // A Calibri/Cambria nearest block maps to its metric twin first.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const font: any = (() => {
          const fam = o.fontFamily ?? 'sans';
          const b = !!o.bold, i = !!o.italic;
          const fn = (o.fontName || '').toLowerCase();
          if (/calibri|carlito/.test(fn))
            return b && i ? kit.carlitoBI ?? kit.helvBI : b ? kit.carlitoB ?? kit.helvB : i ? kit.carlitoI ?? kit.helvI : kit.carlito ?? kit.helv;
          if (/cambria|caladea/.test(fn))
            return b && i ? kit.caladeaBI ?? kit.timesBI : b ? kit.caladeaB ?? kit.timesB : i ? kit.caladeaI ?? kit.timesI : kit.caladea ?? kit.times;
          if (fam === 'serif') return b && i ? kit.timesBI : b ? kit.timesB : i ? kit.timesI : kit.times;
          if (fam === 'mono') return b && i ? kit.courBO : b ? kit.courB : i ? kit.courO : kit.cour;
          return b && i ? kit.helvBI : b ? kit.helvB : i ? kit.helvI : kit.helv;
        })();
        const size = o.fontSize ?? 12;
        // Wrap added text at the overlay's own box width (what the editor
        // shows), not the full page width — a page-width line collides with
        // other content and looks nothing like the editor's box.
        const maxW = Math.max(40, o.w > 0 ? o.w : copied.getWidth() - o.x - 36);
        const lines: string[] = [];
        for (const raw of o.text.split('\n')) {
          let cur = '';
          for (const word of raw.split(' ')) {
            const trial = cur ? `${cur} ${word}` : word;
            if (!cur || font.widthOfTextAtSize(safeWinAnsi(trial), size) <= maxW) cur = trial;
            else {
              lines.push(cur);
              cur = word;
            }
          }
          lines.push(cur);
        }
        lines.forEach((ln, i) => {
          if (!ln) return;
          // Alignment shifts each line inside the overlay box (same wrap as
          // the editor); underline draws a rule under the line's baseline.
          const lw = font.widthOfTextAtSize(safeWinAnsi(ln), size);
          const xOff = o.align === 'center' ? (maxW - lw) / 2 : o.align === 'right' ? maxW - lw : 0;
          const ly = o.y + o.h - size * 0.8 - i * size * 1.25;
          copied.drawText(safeWinAnsi(ln), {
            x: o.x + xOff,
            y: ly,
            size,
            font,
            color: rgb(oc.r, oc.g, oc.b),
          });
          if (o.underline) {
            copied.drawLine({
              start: { x: o.x + xOff, y: ly - 1.5 },
              end: { x: o.x + xOff + lw, y: ly - 1.5 },
              thickness: 1,
              color: rgb(oc.r, oc.g, oc.b),
            });
          }
        });
      } else if (o.kind === 'draw' && o.strokes) {
        for (const st of o.strokes) {
          for (let i = 1; i < st.length; i++) {
            copied.drawLine({
              start: { x: st[i - 1].x, y: st[i - 1].y },
              end: { x: st[i].x, y: st[i].y },
              thickness: o.thickness ?? 2,
              color: rgb(oc.r, oc.g, oc.b),
              opacity: o.opacity ?? 1,
            });
          }
        }
      } else if (o.kind === 'shape' && o.shape) {
        const sc = { r: oc.r, g: oc.g, b: oc.b };
        const th = o.thickness ?? 2;
        if (o.shape === 'rect') {
          copied.drawRectangle({
            x: o.x, y: o.y, width: o.w, height: o.h,
            borderColor: rgb(sc.r, sc.g, sc.b), borderWidth: th,
            ...(o.fill ? { color: rgb(o.fill.r, o.fill.g, o.fill.b), opacity: o.opacity ?? 0.25 } : {}),
          });
        } else if (o.shape === 'ellipse') {
          copied.drawEllipse({
            x: o.x + o.w / 2, y: o.y + o.h / 2,
            xScale: Math.max(0.5, o.w / 2), yScale: Math.max(0.5, o.h / 2),
            borderColor: rgb(sc.r, sc.g, sc.b), borderWidth: th,
            ...(o.fill ? { color: rgb(o.fill.r, o.fill.g, o.fill.b), opacity: o.opacity ?? 0.25 } : {}),
          });
        } else {
          copied.drawLine({
            start: { x: o.x, y: o.y }, end: { x: o.x + o.w, y: o.y + o.h },
            thickness: th, color: rgb(sc.r, sc.g, sc.b), opacity: o.opacity ?? 1,
          });
        }
      } else if (o.kind === 'image' && o.imageBytes) {
        try {
          const mime = (o.imageMime || '').toLowerCase();
          const img = mime.includes('jpeg') || mime.includes('jpg')
            ? await out.embedJpg(o.imageBytes)
            : await out.embedPng(o.imageBytes);
          copied.drawImage(img, { x: o.x, y: o.y, width: o.w, height: o.h });
        } catch {
          // corrupt image bytes: skip this overlay, keep the rest
        }
      }
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

/** PDF -> PowerPoint (.pptx): each PDF page becomes a slide with its text. */
export async function pdfToPowerpoint(file: File): Promise<ConvertResult> {
  const pages = await extractPageTexts(file);
  const hasText = pages.some((p) => p.join('').trim().length > 0);
  if (!hasText) {
    throw new Error(
      'No text found in this PDF — it may be a scanned document (pictures of text). ' +
        'Scanned PDFs need OCR first.'
    );
  }
  const PptxMod = await import('pptxgenjs');
  const PptxGenJS = (PptxMod as any).default ?? PptxMod;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'W16x9', width: 13.33, height: 7.5 });
  pptx.layout = 'W16x9';
  pages.forEach((paras, pi) => {
    const slide = pptx.addSlide();
    const title = paras[0]?.trim() ?? `Page ${pi + 1}`;
    const body = paras.slice(1).join('\n\n');
    if (title.length < 90) {
      slide.addText(title, { x: 0.5, y: 0.3, w: 12.3, h: 0.8, fontSize: 28, bold: true, color: '0F766E' });
      if (body.trim()) {
        slide.addText(body.slice(0, 2000), { x: 0.5, y: 1.3, w: 12.3, h: 5.7, fontSize: 14, color: '333333', valign: 'top' });
      }
    } else {
      slide.addText([title, body].filter(Boolean).join('\n\n').slice(0, 2000), { x: 0.5, y: 0.3, w: 12.3, h: 6.9, fontSize: 14, color: '333333', valign: 'top' });
    }
    slide.addText(`Page ${pi + 1}`, { x: 12.3, y: 7.1, w: 0.8, h: 0.3, fontSize: 9, color: '999999', align: 'right' });
  });
  const base = baseName(file);
  const blob = (await pptx.write({ outputType: 'blob' })) as Blob;
  return { blob, filename: `${base}.pptx` };
};

/** Excel (.xlsx/.xls/.csv) -> PDF table: first sheet, header row, grid. */
export async function excelToPdf(file: File): Promise<ConvertResult> {
  const XLSXmod = await import('xlsx');
  const XLSX = (XLSXmod as any).default ?? XLSXmod;
  let rows: string[][];
  let sheetName = '';
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    if (!wb.SheetNames.length) throw new Error('empty');
    sheetName = wb.SheetNames[0];
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: false });
    rows = (raw as any[][]).map((r) => r.map((c) => String(c ?? '')));
  } catch (e) {
    throw new Error('Could not read that spreadsheet — it may be corrupt or password-protected.');
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim()));
  if (!nonEmpty.length) throw new Error('That spreadsheet looks empty — no data found.');
  const MAXR = 500;
  const data = nonEmpty.slice(0, MAXR).map((r) => r.map((c) => (c.length > 220 ? c.slice(0, 220) : c)));
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const headBg = rgb(0.94, 0.94, 0.94);
  const cols = Math.max(...data.map((r) => r.length));
  const table = data.map((r) => {
    const n = [...r];
    while (n.length < cols) n.push('');
    return n;
  });
  const avail = TPW - 72;
  let size = 10;
  const measure = (sz: number): number[] => {
    const w = new Array<number>(cols).fill(0);
    table.forEach((r, ri) => {
      r.forEach((c, i) => {
        const f = ri === 0 ? helvB : helv;
        w[i] = Math.max(w[i], f.widthOfTextAtSize(safeWinAnsi(c), sz));
      });
    });
    return w;
  };
  let widths = measure(size);
  const totalPad = (cols + 1) * 6;
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
  const rowH = size * 2.1;
  const x0 = 36 + (avail - total) / 2;
  let page = doc.addPage([TPW, TPH]);
  let y = TPH - 56;
  const title = sheetName ? `${baseName(file)} — ${sheetName}` : baseName(file);
  page.drawText(safeWinAnsi(title.slice(0, 80)), { x: 36, y: y - 14, size: 14, font: helvB, color: black });
  y -= 36;
  table.forEach((r, ri) => {
    const header = ri === 0;
    if (y - rowH < 40) {
      page = doc.addPage([TPW, TPH]);
      y = TPH - 56;
    }
    if (header) page.drawRectangle({ x: x0, y: y - rowH, width: total, height: rowH, color: headBg });
    const font = header ? helvB : helv;
    let cx = x0 + 3;
    r.forEach((c, i) => {
      let txt = safeWinAnsi(c);
      const cw = widths[i];
      while (font.widthOfTextAtSize(txt, size) > cw && txt.length > 4) txt = txt.slice(0, -2);
      page.drawText(txt, { x: cx, y: y - rowH + (rowH - size) / 2, size, font, color: black });
      cx += cw + 6;
    });
    y -= rowH;
  });
  const bytes = await doc.save();
  const base = baseName(file).replace(/\.xlsx?$|\.csv$/i, '');
  return { blob: pdfBlob(bytes), filename: `${base}.pdf` };
};

/** Word (.docx) -> PDF: headings, lists, bold/italic via mammoth + pdf-lib. */
export async function wordToPdf(file: File): Promise<ConvertResult> {
  const mammothMod = await import('mammoth');
  const mammoth = (mammothMod as any).default ?? mammothMod;
  const ab = await file.arrayBuffer();
  let html: string;
  try {
    // mammoth 1.x takes { buffer } (Uint8Array), not { arrayBuffer }
    const res = await mammoth.convertToHtml({ buffer: new Uint8Array(ab) });
    html = res.value;
  } catch (e) {
    throw new Error('Could not read that Word file — it may be corrupt or password-protected.');
  }
  if (!html.replace(/<[^>]+>/g, '').trim()) {
    throw new Error('That Word file looks empty — no text found to convert.');
  }
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold);
  const helvO = await doc.embedFont(StandardFonts.HelveticaOblique);
  const black = rgb(0, 0, 0);
  const maxW = TPW - 2 * TM;
  let page = doc.addPage([TPW, TPH]);
  let y = TPH - TM;
  const ensure = (need: number) => {
    if (y - need < TM) {
      page = doc.addPage([TPW, TPH]);
      y = TPH - TM;
    }
  };
  type Run = { text: string; font: typeof helv };
  // Parse one HTML element's inline content into bold/italic runs
  const parseRuns = (el: Element): Run[] => {
    const runs: Run[] = [];
    const walk = (node: Node, bold: boolean, italic: boolean) => {
      node.childNodes.forEach((ch) => {
        if (ch.nodeType === 3) {
          const t = (ch.textContent || '').replace(/\s+/g, ' ');
          if (t) runs.push({ text: t, font: bold ? helvB : italic ? helvO : helv });
        } else if (ch.nodeType === 1) {
          const tag = (ch as Element).tagName.toLowerCase();
          walk(ch, bold || tag === 'strong' || tag === 'b', italic || tag === 'em' || tag === 'i');
        }
      });
    };
    walk(el, false, false);
    return runs.filter((r) => r.text.trim());
  };
  const drawRuns = (runs: Run[], x0: number, size: number) => {
    const spaceW = helv.widthOfTextAtSize(' ', size);
    let cx = x0;
    const words: { text: string; font: typeof helv }[] = [];
    for (const r of runs) {
      for (const w of r.text.split(/(\s+)/)) {
        if (!w) continue;
        if (/^\s+$/.test(w)) { words.push({ text: ' ', font: r.font }); continue; }
        words.push({ text: w, font: r.font });
      }
    }
    let line: typeof words = [];
    let lw = 0;
    const flush = () => {
      if (!line.length) return;
      ensure(size * 1.55);
      let dx = x0;
      for (const w of line) {
        if (w.text === ' ') { dx += spaceW; continue; }
        const safe = safeWinAnsi(w.text);
        page.drawText(safe, { x: dx, y: y - size, size, font: w.font, color: black });
        dx += w.font.widthOfTextAtSize(safe, size) + spaceW;
      }
      y -= size * 1.55;
      line = [];
      lw = 0;
    };
    for (const w of words) {
      const ww = w.text === ' ' ? spaceW : w.font.widthOfTextAtSize(safeWinAnsi(w.text), size);
      if (lw + ww > maxW - (x0 - TM) && line.length) flush();
      if (w.text === ' ' && !line.length) continue;
      line.push(w);
      lw += ww + (w.text === ' ' ? 0 : spaceW);
    }
    flush();
  };
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const body = parsed.body;
  let drew = false;
  body.childNodes.forEach((node) => {
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag[1], 10);
      const size = level === 1 ? 20 : level === 2 ? 16 : 13;
      ensure(size * 2.2);
      y -= 4;
      drawRuns(parseRuns(el).map((r) => ({ ...r, font: helvB })), TM, size);
      y -= 6;
      drew = true;
    } else if (tag === 'p') {
      const runs = parseRuns(el);
      if (!runs.length) { y -= 7; return; }
      ensure(14 * 2);
      drawRuns(runs, TM, 11);
      drew = true;
    } else if (tag === 'ul' || tag === 'ol') {
      let i = 0;
      el.querySelectorAll(':scope > li').forEach((li) => {
        i++;
        const bullet = tag === 'ol' ? `${i}. ` : '• ';
        ensure(14 * 2);
        drawRuns([{ text: bullet, font: helv }, ...parseRuns(li)], TM, 11);
      });
      drew = true;
    } else if (tag === 'table') {
      // Tables: flatten rows into lines (honest simplification)
      el.querySelectorAll('tr').forEach((tr) => {
        const cells: string[] = [];
        tr.querySelectorAll('th, td').forEach((c) => cells.push((c.textContent || '').trim()));
        if (cells.some(Boolean)) {
          ensure(14 * 2);
          drawRuns([{ text: cells.join(' | '), font: helv }], TM, 10);
        }
      });
      drew = true;
    }
  });
  if (!drew) throw new Error('No readable content found in that Word file.');
  const bytes = await doc.save();
  const base = baseName(file).replace(/\.docx?$/i, '');
  return { blob: pdfBlob(bytes), filename: `${base}.pdf` };
};

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
