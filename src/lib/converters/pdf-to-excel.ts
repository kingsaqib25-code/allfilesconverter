/**
 * PDF -> Excel (.xlsx) — honest best-effort table reconstruction, 100% on-device.
 *
 * How it works: pdf.js gives every text fragment with its x/y position.
 * We group fragments into rows by y-position, then split each row into
 * columns wherever the horizontal gap between fragments is clearly larger
 * than normal word spacing. The result is written as a real .xlsx workbook
 * with SheetJS (lazy-loaded, only when this tool is used).
 *
 * Honest limits (surfaced in UI + FAQ, never hidden):
 * - PDFs store text + coordinates, NOT "this is a table". Clean tables
 *   (bank statements, invoices, price lists) reconstruct well; complex or
 *   multi-column layouts may need manual cleanup in Excel.
 * - Scanned/image PDFs contain no text at all -> we throw a clear error.
 */

export interface ToolFileResult {
  blob: Blob;
  filename: string;
}

/** One positioned text fragment from pdf.js. */
export interface TextFrag {
  x: number;
  y: number;
  w: number; // estimated advance width in the same units as x
  str: string;
}

let pdfjs: unknown = null;
async function loadPdfJs(): Promise<any> {
  if (pdfjs) return pdfjs;
  const mod: any = await import('pdfjs-dist');
  mod.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
  pdfjs = mod;
  return pdfjs;
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'converted';
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

/**
 * Pure table reconstruction: fragments -> rows of cell strings.
 * Kept pure (no pdf.js) so it is unit-testable in Node.
 */
export function reconstructTable(frags: TextFrag[]): string[][] {
  const items = frags.filter((f) => f.str && f.str.trim().length > 0);
  if (items.length === 0) return [];

  // Dedupe exact overlaps (some PDFs emit the same fragment twice).
  const seen = new Set<string>();
  const uniq = items.filter((f) => {
    const k = `${f.x.toFixed(1)}|${f.y.toFixed(1)}|${f.str}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Median character width -> basis for "is this gap a column break?".
  const charWidths = uniq
    .map((f) => (f.w > 0 ? f.w / Math.max(1, f.str.length) : 0))
    .filter((w) => w > 0.5 && w < 50)
    .sort((a, b) => a - b);
  const medChar = charWidths.length
    ? charWidths[Math.floor(charWidths.length / 2)]
    : 6;
  const colGapThreshold = Math.max(8, medChar * 2.2);

  // Group into rows by y (tolerance scales a little with font size).
  const rowTol = Math.max(2.5, medChar * 0.45);
  const sorted = [...uniq].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextFrag[][] = [];
  for (const f of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - f.y) <= rowTol);
    if (row) row.push(f);
    else rows.push([f]);
  }

  // Split each row into columns on wide x-gaps; merge tight fragments.
  return rows.map((row) => {
    const cells = row.slice().sort((a, b) => a.x - b.x);
    const out: string[] = [];
    let cur = '';
    let prevEnd = -Infinity;
    for (const c of cells) {
      const gap = c.x - prevEnd;
      if (cur && gap > colGapThreshold) {
        out.push(cur.trim());
        cur = '';
      }
      cur += (cur ? ' ' : '') + c.str;
      prevEnd = c.x + c.w;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  });
}

interface PageRows {
  pageNumber: number;
  rows: string[][];
}

async function extractPageFrags(
  pdf: any,
  pageIdx: number
): Promise<PageRows> {
  const page = await pdf.getPage(pageIdx + 1);
  try {
    const tc = await page.getTextContent();
    const frags: TextFrag[] = [];
    for (const raw of tc.items as Array<{
      str: string;
      transform: number[];
      width?: number;
    }>) {
      if (!raw.str || !raw.str.trim()) continue;
      const t = raw.transform;
      const fontSize = Math.abs(t[0]) || 10;
      // pdf.js item.width is normally in the same page units as x/y;
      // fall back to a font-size estimate when it looks wrong.
      let w = raw.str.length * fontSize * 0.5;
      if (typeof raw.width === 'number' && raw.width > 0 && raw.width <= 2000) {
        w = raw.width;
      }
      frags.push({ x: t[4], y: t[5], w, str: raw.str });
    }
    return { pageNumber: pageIdx + 1, rows: reconstructTable(frags) };
  } finally {
    page.cleanup();
  }
}

export interface PdfToExcelOptions {
  /** e.g. "1-3, 5"; blank = all pages */
  range?: string;
  /** one worksheet per PDF page instead of a single sheet */
  perPage?: boolean;
}

export async function pdfToExcel(
  file: File,
  opts: PdfToExcelOptions = {}
): Promise<ToolFileResult> {
  const lib = await loadPdfJs();
  const data = await file.arrayBuffer();
  let pdf: any;
  try {
    pdf = await lib.getDocument({ data }).promise;
  } catch (e) {
    if (e instanceof Error && e.name === 'PasswordException') {
      throw new Error(
        'This PDF is password-protected. Remove the password first (for example with the free Unlock PDF tool) and try again.'
      );
    }
    throw new Error(
      'We could not read that PDF. It may be corrupt or use an unsupported feature.'
    );
  }

  const numPages: number = pdf.numPages;
  const targets =
    opts.range && opts.range.trim()
      ? parsePageRange(opts.range, numPages)
      : Array.from({ length: numPages }, (_, i) => i);
  if (targets.length === 0) {
    throw new Error('No pages matched that range. Try e.g. "1-3, 5".');
  }

  const pages: PageRows[] = [];
  for (const i of targets) {
    const pr = await extractPageFrags(pdf, i);
    if (pr.rows.length > 0) pages.push(pr);
  }

  if (pages.length === 0) {
    throw new Error(
      'No text found in these pages — this looks like a scanned PDF (pictures of text). ' +
        'Scanned PDFs need OCR first, which the browser version does not do yet.'
    );
  }

  const XLSX: any = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const addSheet = (name: string, rows: string[][]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Sensible column widths from content (capped so one long cell
    // doesn't blow out the sheet).
    const colCount = Math.max(...rows.map((r) => r.length), 1);
    const widths: number[] = new Array(colCount).fill(10);
    for (const r of rows) {
      r.forEach((cell, ci) => {
        widths[ci] = Math.max(widths[ci], Math.min(50, cell.length + 2));
      });
    }
    ws['!cols'] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  if (opts.perPage) {
    for (const p of pages) addSheet(`Page ${p.pageNumber}`, p.rows);
  } else {
    const all: string[][] = [];
    pages.forEach((p, idx) => {
      if (idx > 0) all.push([]); // blank separator row between pages
      all.push(...p.rows);
    });
    addSheet('Sheet1', all);
  }

  const bytes: Uint8Array = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const copy = new Uint8Array(bytes);
  const blob = new Blob([copy.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return { blob, filename: `${baseName(file.name)}.xlsx` };
}
