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
  // Direct XObject extraction via pdf-lib (deterministic — no pdf.js worker
  // object-loading timing issues). Handles JPEG (DCTDecode) directly and
  // decodes FlateDecode RGB/Gray images to PNG via canvas.
  // (QC: pdf.js page.objs.get callback never fired — silent hang.)
  const { PDFDocument, PDFName, PDFRawStream } = await loadPdfLib();
  const { inflate } = await import('pako');
  const pdf = await PDFDocument.load(await file.arrayBuffer());
  const outs: ToolFileResult[] = [];
  let imgIdx = 0;

  const ascii85Decode = (data: Uint8Array): Uint8Array => {
    // Strip whitespace; Adobe markers optional. Handles 'z' = 4 zero bytes.
    let s = '';
    for (let i = 0; i < data.length; i++) {
      const c = data[i];
      if (c === 32 || c === 10 || c === 13 || c === 9 || c === 12) continue;
      s += String.fromCharCode(c);
    }
    if (s.startsWith('<~')) s = s.slice(2);
    if (s.endsWith('~>')) s = s.slice(0, -2);
    const out: number[] = [];
    for (let i = 0; i < s.length; ) {
      if (s[i] === 'z') {
        out.push(0, 0, 0, 0);
        i++;
        continue;
      }
      const chunk = s.slice(i, i + 5);
      const n = chunk.length;
      let val = 0;
      for (let j = 0; j < 5; j++) {
        val = val * 85 + (j < n ? s.charCodeAt(i + j) - 33 : 84);
      }
      const bytes = n === 5 ? 4 : n - 1;
      for (let j = 0; j < bytes; j++) out.push((val >>> (8 * (3 - j))) & 0xff);
      i += 5;
    }
    return new Uint8Array(out);
  };

  const decodeStream = (raw: Uint8Array, filters: string[]): Uint8Array => {
    let data = raw;
    for (const f of filters) {
      if (f === 'ASCII85Decode' || f === 'A85') data = ascii85Decode(data);
      else if (f === 'FlateDecode' || f === 'Fl') data = inflate(data);
      else if (f === 'DCTDecode' || f === 'DCT') return data; // handled by caller
      else throw new Error('unsupported filter ' + f);
    }
    return data;
  };

  for (let p = 0; p < pdf.getPageCount(); p++) {
    const page = pdf.getPage(p);
    const res = page.node.Resources();
    if (!res) continue;
    const xo = res.lookup(PDFName.of('XObject'));
    if (!xo || !(xo as any).entries) continue;
    for (const [, ref] of (xo as any).entries()) {
      const obj = pdf.context.lookup(ref);
      if (!(obj instanceof PDFRawStream)) continue;
      const dict: any = obj.dict;
      const subtype = dict.lookup(PDFName.of('Subtype'));
      if (!subtype || subtype.toString() !== '/Image') continue;
      const w = Number(dict.lookup(PDFName.of('Width'))?.toString() ?? 0);
      const h = Number(dict.lookup(PDFName.of('Height'))?.toString() ?? 0);
      if (!w || !h || w > 8000 || h > 8000) continue;
      let filters: string[] = [];
      const fObj = dict.lookup(PDFName.of('Filter'));
      if (fObj) {
        const fStr = fObj.toString();
        filters = fStr.startsWith('[')
          ? fStr.slice(1, -1).trim().split(/\s+/).map((x: string) => x.replace(/^\//, ''))
          : [fStr.replace(/^\//, '')];
      }
      const raw = obj.getContents();
      imgIdx++;
      try {
        if (filters.includes('DCTDecode') || filters.includes('DCT')) {
          // Raw JPEG bytes — save directly.
          const blob = new Blob([raw as unknown as BlobPart], { type: 'image/jpeg' });
          outs.push({ blob, filename: `${baseName(file.name)}-p${p + 1}-img${imgIdx}.jpg` });
          continue;
        }
        // FlateDecode (possibly after ASCII85): decode to pixels.
        const decoded = decodeStream(raw, filters.filter((f) => f !== 'DCTDecode' && f !== 'DCT'));
        const csObj = dict.lookup(PDFName.of('ColorSpace'));
        const cs = csObj ? csObj.toString() : '/DeviceRGB';
        const bpc = Number(dict.lookup(PDFName.of('BitsPerComponent'))?.toString() ?? 8);
        if (bpc !== 8) continue; // exotic depth — skip rather than corrupt
        let comps = 3;
        if (cs === '/DeviceGray' || cs === '/G') comps = 1;
        else if (cs === '/DeviceRGB' || cs === '/RGB') comps = 3;
        else if (cs === '/DeviceCMYK' || cs === '/CMYK') comps = 4;
        else continue;
        // PNG predictors (DecodeParms Predictor 10-15) or raw rows.
        let predictor = 1;
        const dp = dict.lookup(PDFName.of('DecodeParms'));
        if (dp) {
          const pm = /\/Predictor\s+(\d+)/.exec(dp.toString());
          if (pm) predictor = Number(pm[1]);
        }
        const rowLen = w * comps;
        const rgba = new Uint8ClampedArray(w * h * 4);
        let src = 0;
        const prev = new Uint8Array(rowLen);
        for (let y = 0; y < h; y++) {
          let filt = 0;
          if (predictor >= 10) {
            filt = decoded[src++];
          }
          const row = decoded.subarray(src, src + rowLen);
          src += rowLen;
          const recon = new Uint8Array(rowLen);
          for (let x = 0; x < rowLen; x++) {
            const a = x >= comps ? recon[x - comps] : 0;
            const b = prev[x];
            const c = x >= comps ? prev[x - comps] : 0;
            let v: number = row[x];
            if (filt === 1) v = (v + a) & 0xff;
            else if (filt === 2) v = (v + b) & 0xff;
            else if (filt === 3) v = (v + ((a + b) >> 1)) & 0xff;
            else if (filt === 4) {
              const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
              const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
              v = (v + pr) & 0xff;
            }
            recon[x] = v;
          }
          prev.set(recon);
          for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4;
            if (comps === 1) {
              rgba[o] = rgba[o + 1] = rgba[o + 2] = recon[x];
            } else if (comps === 3) {
              rgba[o] = recon[x * 3]; rgba[o + 1] = recon[x * 3 + 1]; rgba[o + 2] = recon[x * 3 + 2];
            } else {
              // CMYK → RGB (naive invert)
              rgba[o] = 255 - Math.min(255, recon[x * 4] + recon[x * 4 + 3]);
              rgba[o + 1] = 255 - Math.min(255, recon[x * 4 + 1] + recon[x * 4 + 3]);
              rgba[o + 2] = 255 - Math.min(255, recon[x * 4 + 2] + recon[x * 4 + 3]);
            }
            rgba[o + 3] = 255;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
        const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) continue;
        outs.push({ blob, filename: `${baseName(file.name)}-p${p + 1}-img${imgIdx}.png` });
      } catch {
        /* skip undecodable image rather than failing the whole job */
      }
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
  // pdf.js may detach/transfer the buffer it receives — give it its own copy
  // and keep the original for pdf-lib. (QC: detached ArrayBuffer crash.)
  const doc = await lib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  const pdf = await PDFDocument.load(bytes);
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
