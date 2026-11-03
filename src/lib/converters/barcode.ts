/**
 * UPC-A barcode generator. Everything runs on-device: the 95-module bar
 * pattern is drawn to SVG (print-sharp) or canvas PNG. No upload, no server.
 *
 * Encoding (GS1 General Specifications):
 * - 12 digits: [start guard 101][6 left digits, L-code][middle 01010]
 *   [6 right digits, R-code][end guard 101] = 95 modules
 * - Check digit (12th): odd positions x3 + even positions x1, then
 *   (10 - sum % 10) % 10
 */

// L-code patterns (left half), 7 modules each. R-code = bitwise inverse.
const L_PATTERNS = [
  '0001101', // 0
  '0011001', // 1
  '0010011', // 2
  '0111101', // 3
  '0100011', // 4
  '0110001', // 5
  '0101111', // 6
  '0111011', // 7
  '0110111', // 8
  '0001011', // 9
];

function invert(pattern: string): string {
  return pattern
    .split('')
    .map((c) => (c === '1' ? '0' : '1'))
    .join('');
}

/** Check digit for the first 11 digits of a UPC-A. */
export function upcCheckDigit(d11: string): string {
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const d = parseInt(d11[i], 10);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return String((10 - (sum % 10)) % 10);
}

/** Validate a full 12-digit UPC-A (digits + correct check digit). */
export function isValidUpc(d12: string): boolean {
  if (!/^\d{12}$/.test(d12)) return false;
  return upcCheckDigit(d12.slice(0, 11)) === d12[11];
}

/**
 * Normalize user input: accepts 11 digits (computes check digit) or
 * 12 digits (validates). Returns the full 12 digits or throws.
 */
export function normalizeUpc(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 11) return digits + upcCheckDigit(digits);
  if (digits.length === 12) {
    if (!isValidUpc(digits)) {
      throw new Error(
        `The check digit is wrong — the correct 12th digit for ${digits.slice(0, 11)} is ${upcCheckDigit(digits.slice(0, 11))}.`
      );
    }
    return digits;
  }
  throw new Error('Type 11 digits (we add the check digit) or the full 12 digits.');
}

/** 95-module bar pattern for a valid 12-digit UPC-A. '1' = black bar. */
export function encodeUpcA(d12: string): string {
  let out = '101'; // start guard
  for (let i = 0; i < 6; i++) out += L_PATTERNS[parseInt(d12[i], 10)];
  out += '01010'; // middle guard
  for (let i = 6; i < 12; i++) out += invert(L_PATTERNS[parseInt(d12[i], 10)]);
  out += '101'; // end guard
  return out;
}

export interface UpcSvgOpts {
  /** width of one module in SVG units */
  module?: number;
  /** bar height in SVG units (default ~ 95 modules wide ratio) */
  barHeight?: number;
  /** quiet-zone modules on each side (GS1: 9) */
  quiet?: number;
}

/**
 * Build a print-ready SVG: quiet zones, bars, guard bars slightly taller,
 * human-readable digits underneath. Returns the SVG markup string.
 */
export function upcAToSvg(d12: string, opts: UpcSvgOpts = {}): string {
  const module = opts.module ?? 2;
  const quiet = opts.quiet ?? 9;
  const pattern = encodeUpcA(d12);
  const totalModules = quiet + pattern.length + quiet;
  const W = totalModules * module;
  const barH = opts.barHeight ?? module * 46;
  const guardExtra = module * 5;
  const textH = module * 11;
  const H = barH + guardExtra + textH;

  const x0 = quiet * module;
  let rects = '';
  let runStart = -1;
  const flush = (end: number) => {
    if (runStart >= 0) {
      const x = x0 + runStart * module;
      const w = (end - runStart) * module;
      // Guard bars (0-2, 45-49, 92-94) run taller
      const isGuard =
        (runStart < 3 && end <= 3) ||
        (runStart >= 45 && end <= 50) ||
        (runStart >= 92);
      const h = isGuard ? barH + guardExtra : barH;
      rects += `<rect x="${x}" y="0" width="${w}" height="${h}" fill="#000"/>`;
      runStart = -1;
    }
  };
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '1') {
      if (runStart < 0) runStart = i;
    } else {
      flush(i);
    }
  }
  flush(pattern.length);

  // Human-readable digits: first digit left of start guard, then groups.
  const fs = module * 8;
  let texts = '';
  const ty = barH + guardExtra + module * 8.5;
  // Leading digit (number system), placed in left quiet zone
  texts += `<text x="${x0 - module * 4}" y="${ty}" font-size="${fs}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif">${d12[0]}</text>`;
  // Left 6 digits under left half (skip first, shown at side per common style — actually show all 6 grouped)
  const leftX = x0 + 3 * module;
  const leftW = 42 * module;
  const rightX = x0 + 50 * module;
  const rightW = 42 * module;
  // Standard layout: digit 1 at left, digits 2-6 centered under left half, 7-11 under right half, 12 at right
  texts += `<text x="${leftX + leftW / 2}" y="${ty}" font-size="${fs}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif">${d12.slice(1, 6)}</text>`;
  texts += `<text x="${rightX + rightW / 2}" y="${ty}" font-size="${fs}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif">${d12.slice(6, 11)}</text>`;
  texts += `<text x="${x0 + 95 * module + module * 4}" y="${ty}" font-size="${fs}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif">${d12[11]}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${rects}${texts}</svg>`;
}

export interface UpcPngOpts {
  /** GS1 size: 80–200% (100% = 0.33mm module). Affects pixel scale. */
  sizePct?: number;
  /** printer resolution for dot-rounding honesty */
  dpi?: number;
}

/**
 * Render a PNG via canvas. Module pixels are rounded so bars land on whole
 * pixels (like the pro tools do for printer dots).
 */
export async function upcAToPng(
  d12: string,
  opts: UpcPngOpts = {}
): Promise<Blob> {
  const sizePct = opts.sizePct ?? 100;
  // 100% => module 0.33mm. At 300dpi: 0.33mm = 3.9px -> round to 4px.
  const dpi = opts.dpi ?? 300;
  const mmPerModule = 0.33 * (sizePct / 100);
  const pxPerModule = Math.max(1, Math.round((mmPerModule / 25.4) * dpi));
  const pattern = encodeUpcA(d12);
  const quiet = 9;
  const W = (quiet + pattern.length + quiet) * pxPerModule;
  const barH = Math.round(pxPerModule * 46);
  const guardExtra = pxPerModule * 5;
  const textH = pxPerModule * 12;
  const H = barH + guardExtra + textH;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000000';

  const x0 = quiet * pxPerModule;
  let runStart = -1;
  const flush = (end: number) => {
    if (runStart >= 0) {
      const x = x0 + runStart * pxPerModule;
      const w = (end - runStart) * pxPerModule;
      const isGuard =
        (runStart < 3 && end <= 3) ||
        (runStart >= 45 && end <= 50) ||
        (runStart >= 92);
      ctx.fillRect(x, 0, w, isGuard ? barH + guardExtra : barH);
      runStart = -1;
    }
  };
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '1') {
      if (runStart < 0) runStart = i;
    } else {
      flush(i);
    }
  }
  flush(pattern.length);

  ctx.fillStyle = '#000000';
  ctx.font = `${Math.round(pxPerModule * 8)}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const ty = barH + guardExtra + pxPerModule * 9;
  ctx.fillText(d12[0], x0 - pxPerModule * 4, ty);
  ctx.fillText(d12.slice(1, 6), x0 + 3 * pxPerModule + 21 * pxPerModule, ty);
  ctx.fillText(d12.slice(6, 11), x0 + 50 * pxPerModule + 21 * pxPerModule, ty);
  ctx.fillText(d12[11], x0 + 95 * pxPerModule + pxPerModule * 4, ty);

  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, 'image/png')
  );
  if (!blob) throw new Error('This browser refused to encode the PNG.');
  return blob;
}
