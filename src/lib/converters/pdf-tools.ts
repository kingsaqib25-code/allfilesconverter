/**
 * Second-wave PDF tools (competitor-gap round): rotate, watermark, page
 * numbers, unlock, extract images, redact, delete pages, crop.
 *
 * All 100% on-device (pdf.js + pdf-lib, lazy-loaded). No uploads, no server.
 * Kept in this file (separate from pdf.ts) to keep modules focused.
 */

export interface ToolFileResult {
  blob: Blob;
  filename: string;
}

async function loadPdfLib() {
  return await import('pdf-lib');
}

let pdfjs: any = null;
async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  const mod: any = await import('pdfjs-dist');
  mod.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
  pdfjs = mod;
  return pdfjs;
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'file';
}

function pdfBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes);
  return new Blob([copy.buffer as ArrayBuffer], { type: 'application/pdf' });
}

/** Parse "1-3, 5" into 0-based page indices. */
export function parsePageRange(range: string, numPages: number): number[] {
  const out = new Set<number>();
  for (const part of range.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = Math.max(1, parseInt(m[1], 10));
      const b = Math.min(numPages, parseInt(m[2], 10));
      for (let i = a; i <= b; i++) out.add(i - 1);
    } else {
      const n = parseInt(t, 10);
      if (Number.isFinite(n) && n >= 1 && n <= numPages) out.add(n - 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/* ------------------------------- rotate -------------------------------- */

export async function rotatePdf(
  file: File,
  angle: 90 | 180 | 270,
  range?: string
): Promise<ToolFileResult> {
  const { PDFDocument, degrees } = await loadPdfLib();
  const pdf = await PDFDocument.load(await file.arrayBuffer());
  const n = pdf.getPageCount();
  const targets =
    range && range.trim() ? parsePageRange(range, n) : Array.from({ length: n }, (_, i) => i);
  if (targets.length === 0) throw new Error('No pages matched that range. Try e.g. "1-3, 5".');
  for (const i of targets) {
    const page = pdf.getPage(i);
    const cur = page.getRotation().angle;
    page.setRotation(degrees((cur + angle) % 360));
  }
  const bytes = await pdf.save();
  return { blob: pdfBlob(bytes), filename: `${baseName(file.name)}-rotated.pdf` };
}

/* ------------------------------ watermark ------------------------------ */

export async function watermarkPdf(
  file: File,
  text: string,
  opacity = 0.25,
  fontSize = 48
): Promise<ToolFileResult> {
  const clean = text.trim().slice(0, 80);
  if (!clean) throw new Error('Type the watermark text first.');
  const { PDFDocument, rgb, degrees, StandardFonts } = await loadPdfLib();
  const pdf = await PDFDocument.load(await file.arrayBuffer());
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    let size = Math.min(fontSize, height * 0.2);
    let tw = font.widthOfTextAtSize(clean, size);
    if (tw > width * 0.92) {
      size = (size * width * 0.92) / tw;
      tw = font.widthOfTextAtSize(clean, size);
    }
    page.drawText(clean, {
      x: width / 2 - tw / 2,
      y: height / 2,
      size,
      font,
      color: rgb(0.45, 0.45, 0.45),
      opacity: Math.min(0.9, Math.max(0.05, opacity)),
      rotate: degrees(-45),
    });
  }
  const bytes = await pdf.save();
  return { blob: pdfBlob(bytes), filename: `${baseName(file.name)}-watermarked.pdf` };
}

/* ---------------------------- page numbers ----------------------------- */

export type PageNumberPosition =
  | 'bottom-center'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-center'
  | 'top-right';

export async function addPageNumbers(
  file: File,
  position: PageNumberPosition = 'bottom-center'
): Promise<ToolFileResult> {
  const { PDFDocument, rgb, StandardFonts } = await loadPdfLib();
  const pdf = await PDFDocument.load(await file.arrayBuffer());
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const n = pdf.getPageCount();
  pdf.getPages().forEach((page, i) => {
    const { width, height } = page.getSize();
    const label = `Page ${i + 1} of ${n}`;
    const size = 9;
    const tw = font.widthOfTextAtSize(label, size);
    const m = 28;
    let x = width / 2 - tw / 2;
    let y = m;
    if (position === 'bottom-right') x = width - tw - m;
    else if (position === 'bottom-left') x = m;
    else if (position === 'top-center') y = height - m;
    else if (position === 'top-right') {
      x = width - tw - m;
      y = height - m;
    }
    page.drawText(label, { x, y, size, font, color: rgb(0.35, 0.35, 0.35) });
  });
  const bytes = await pdf.save();
  return { blob: pdfBlob(bytes), filename: `${baseName(file.name)}-numbered.pdf` };
}

/* ------------------------------- unlock -------------------------------- */
/* Opens a password-protected PDF with pdf.js, then rebuilds it without the
   password. Pages become high-quality images — text is no longer selectable.
   The password is used once in memory and never stored or sent anywhere. */

export async function unlockPdf(file: File, password: string): Promise<ToolFileResult> {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  let doc: any;
  try {
    doc = await lib.getDocument({ data, password: password || '' }).promise;
  } catch (e: any) {
    if (e && (e.name === 'PasswordException' || /password/i.test(String(e?.message)))) {
      throw new Error(
        password
          ? 'Wrong password — please check it and try again.'
          : 'This PDF is password-protected. Type its password above to unlock it.'
      );
    }
    throw e;
  }
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not render this PDF in your browser.');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Page render failed.'))), 'image/jpeg', 0.92)
    );
    const img = await out.embedJpg(await blob.arrayBuffer());
    const pg = out.addPage([viewport.width / 2, viewport.height / 2]);
    pg.drawImage(img, { x: 0, y: 0, width: pg.getWidth(), height: pg.getHeight() });
    try {
      page.cleanup();
    } catch {
      /* ignore */
    }
  }
  const bytes = await out.save();
  return { blob: pdfBlob(bytes), filename: `${baseName(file.name)}-unlocked.pdf` };
}

/* --------------------------- extract images ---------------------------- */

export async function extractImagesFromPdf(file: File): Promise<ToolFileResult[]> {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const OPS = lib.OPS;
  const outs: ToolFileResult[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const opList = await page.getOperatorList();
    let imgIdx = 0;
    for (let i = 0; i < opList.fn.length; i++) {
      const fn = opList.fn[i];
      if (fn !== OPS.paintImageXObject && fn !== OPS.paintJpegXObject) continue;
      const name = opList.args[i]?.[0];
      if (!name) continue;
      imgIdx++;
      const img: any = await new Promise((resolve) => {
        try {
          page.objs.get(name, resolve);
        } catch {
          resolve(null);
        }
      });
      if (!img || !img.width || !img.height || !img.data) continue;
      const w = img.width;
      const h = img.height;
      let rgba: Uint8ClampedArray<ArrayBuffer>;
      if (img.data.length === w * h * 4) {
        rgba = new Uint8ClampedArray(img.data);
      } else if (img.data.length === w * h * 3) {
        rgba = new Uint8ClampedArray(w * h * 4);
        for (let k = 0; k < w * h; k++) {
          rgba[k * 4] = img.data[k * 3];
          rgba[k * 4 + 1] = img.data[k * 3 + 1];
          rgba[k * 4 + 2] = img.data[k * 3 + 2];
          rgba[k * 4 + 3] = 255;
        }
      } else {
        continue; // exotic colorspace — skip rather than corrupt
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
      if (!blob) continue;
      outs.push({ blob, filename: `${baseName(file.name)}-p${p}-img${imgIdx}.png` });
    }
    try {
      page.cleanup();
    } catch {
      /* ignore */
    }
  }
  if (outs.length === 0) {
    throw new Error('No extractable images found in this PDF. (Vector graphics and icons are not embedded images.)');
  }
  return outs;
}

/* ------------------------------- redact -------------------------------- */
/* Visual redaction: covers every occurrence of the given words/phrases with
   solid black boxes, using pdf.js text positions. Honest note: the underlying
   text bytes remain in the file — this is a visual cover, not forensic
   redaction. For legally watertight redaction use desktop software. */

export async function redactPdf(file: File, phrases: string[]): Promise<ToolFileResult> {
  const clean = phrases.map((w) => w.trim().toLowerCase()).filter((w) => w.length > 0);
  if (clean.length === 0) throw new Error('Type at least one word or phrase to redact.');
  const lib = await loadPdfJs();
  const { PDFDocument, rgb } = await loadPdfLib();
  const bytes = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
  const pdf = await PDFDocument.load(bytes.slice(0));
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const pdfPage = pdf.getPage(p - 1);
    for (const item of tc.items as any[]) {
      const s: string = item.str ?? '';
      if (!s.trim()) continue;
      const low = s.toLowerCase();
      const t = item.transform ?? [1, 0, 0, 1, 0, 0];
      const x0: number = t[4] ?? 0;
      const baseline: number = t[5] ?? 0; // PDF points, y from bottom
      const itemW: number = item.width ?? 0;
      const h: number = item.height ?? Math.abs(t[3] ?? 12) ?? 12;
      if (!itemW || !s.length) continue;
      for (const phrase of clean) {
        let idx = low.indexOf(phrase);
        while (idx !== -1) {
          const x = x0 + (itemW * idx) / s.length;
          const w = (itemW * phrase.length) / s.length;
          pdfPage.drawRectangle({
            x: Math.max(0, x - 1),
            y: baseline - h * 0.25,
            width: w + 2,
            height: h * 1.3,
            color: rgb(0, 0, 0),
          });
          idx = low.indexOf(phrase, idx + 1);
        }
      }
    }
    try {
      page.cleanup();
    } catch {
      /* ignore */
    }
  }
  const out = await pdf.save();
  return { blob: pdfBlob(out), filename: `${baseName(file.name)}-redacted.pdf` };
}

/* ---------------------------- delete pages ----------------------------- */

export async function deletePagesFromPdf(file: File, range: string): Promise<ToolFileResult> {
  if (!range.trim()) throw new Error('Tell us which pages to delete, e.g. "1-3, 5".');
  const { PDFDocument } = await loadPdfLib();
  const pdf = await PDFDocument.load(await file.arrayBuffer());
  const n = pdf.getPageCount();
  const del = new Set(parsePageRange(range, n));
  if (del.size === 0) throw new Error('No pages matched that range. Try e.g. "1-3, 5".');
  if (del.size >= n) throw new Error('That would delete every page — keep at least one.');
  const keep: number[] = [];
  for (let i = 0; i < n; i++) if (!del.has(i)) keep.push(i);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(pdf, keep);
  pages.forEach((pg) => out.addPage(pg));
  const bytes = await out.save();
  return { blob: pdfBlob(bytes), filename: `${baseName(file.name)}-pages-removed.pdf` };
}

/* -------------------------------- crop --------------------------------- */

export async function cropPdf(file: File, marginPct: number): Promise<ToolFileResult> {
  const m = Math.min(40, Math.max(0, marginPct));
  const { PDFDocument } = await loadPdfLib();
  const pdf = await PDFDocument.load(await file.arrayBuffer());
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const mx = (width * m) / 100;
    const my = (height * m) / 100;
    page.setCropBox(mx, my, Math.max(1, width - 2 * mx), Math.max(1, height - 2 * my));
  }
  const bytes = await pdf.save();
  return { blob: pdfBlob(bytes), filename: `${baseName(file.name)}-cropped.pdf` };
}
