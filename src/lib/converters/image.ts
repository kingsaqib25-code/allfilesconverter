/**
 * Canvas-based raster image converters. Everything runs on-device:
 * the file is decoded with createImageBitmap, drawn to a <canvas>,
 * and re-encoded with canvas.toBlob. No upload, no server.
 */

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif';

const EXT_TO_MIME: Record<string, ImageMime> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
};

let avifSupport: boolean | null = null;

/** Runtime check: can this browser encode AVIF via canvas? */
export function supportsAvifEncode(): boolean {
  if (avifSupport !== null) return avifSupport;
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    avifSupport = c.toDataURL('image/avif').startsWith('data:image/avif');
  } catch {
    avifSupport = false;
  }
  return avifSupport;
}

export function mimeForExt(ext: string): ImageMime | null {
  return EXT_TO_MIME[ext.toLowerCase()] ?? null;
}

export interface ConvertedImage {
  blob: Blob;
  filename: string;
}

/**
 * Convert a raster image File to another raster format.
 * @param quality 0..1, used for lossy targets (jpeg/webp/avif). Defaults to 0.92.
 */
export async function convertImage(
  file: File,
  toExt: string,
  quality = 0.92
): Promise<ConvertedImage> {
  const mime = mimeForExt(toExt);
  if (!mime) {
    throw new Error(`Sorry, we can't write .${toExt} images yet.`);
  }
  if (mime === 'image/avif' && !supportsAvifEncode()) {
    throw new Error(
      'AVIF output is not supported in this browser. Try Chrome or Edge, or pick JPG, PNG or WebP instead.'
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      'We could not read that image. It may be corrupt, or the format is not supported for reading in this browser.'
    );
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    // JPEG has no alpha channel: paint white behind transparent pixels.
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mime, quality)
    );
    if (!blob) {
      throw new Error(
        `This browser refused to encode ${toExt.toUpperCase()}. Try PNG or JPG instead.`
      );
    }
    const base = file.name.replace(/\.[^.]+$/, '');
    return { blob, filename: `${base}.${toExt}` };
  } finally {
    bitmap.close();
  }
}

/* ------------------------- bulk resize / rotate ------------------------ */
/* Used by the bulk widget: one file in, one file out, original format kept. */

function imgBase(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'image';
}

function imgExt(name: string): string {
  const e = name.split('.').pop()?.toLowerCase() ?? 'png';
  return e === 'jpeg' ? 'jpg' : e;
}

async function encodeCanvas(
  canvas: HTMLCanvasElement,
  file: File,
  suffix: string
): Promise<ConvertedImage> {
  const ext = imgExt(file.name);
  const mime = mimeForExt(ext) ?? 'image/png';
  if (mime === 'image/jpeg') {
    // JPEG has no transparency — paint white behind, like convertImage does.
    const bg = document.createElement('canvas');
    bg.width = canvas.width;
    bg.height = canvas.height;
    const bctx = bg.getContext('2d')!;
    bctx.fillStyle = '#ffffff';
    bctx.fillRect(0, 0, bg.width, bg.height);
    bctx.drawImage(canvas, 0, 0);
    canvas = bg;
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, 0.92)
  );
  if (!blob) throw new Error('This browser refused to encode the image. Try PNG or JPG.');
  return { blob, filename: `${imgBase(file.name)}-${suffix}.${ext}` };
}

/**
 * Resize by percent, or to an exact width/height (aspect ratio kept).
 * mode: 'percent' | 'width' | 'height'; value: % or px.
 */
export async function resizeImage(
  file: File,
  mode: 'percent' | 'width' | 'height',
  value: number
): Promise<ConvertedImage> {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) throw new Error('Enter a valid resize value.');
  const bitmap = await createImageBitmap(file);
  try {
    let w = bitmap.width;
    let h = bitmap.height;
    if (mode === 'percent') {
      if (v < 5 || v > 400) throw new Error('Percent must be between 5 and 400.');
      w = Math.round((w * v) / 100);
      h = Math.round((h * v) / 100);
    } else if (mode === 'width') {
      if (v < 1 || v > 12000) throw new Error('Width must be between 1 and 12000 px.');
      h = Math.round((h * v) / w);
      w = Math.round(v);
    } else {
      if (v < 1 || v > 12000) throw new Error('Height must be between 1 and 12000 px.');
      w = Math.round((w * v) / h);
      h = Math.round(v);
    }
    w = Math.max(1, w);
    h = Math.max(1, h);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    return encodeCanvas(canvas, file, `${w}x${h}`);
  } finally {
    bitmap.close();
  }
}

/** Rotate 90/180/270 degrees clockwise. */
export async function rotateImageFile(
  file: File,
  angle: 90 | 180 | 270
): Promise<ConvertedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const swap = angle === 90 || angle === 270;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? bitmap.height : bitmap.width;
    canvas.height = swap ? bitmap.width : bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    return encodeCanvas(canvas, file, `rot${angle}`);
  } finally {
    bitmap.close();
  }
}

export interface SmartCompressOpts {
  /** 0..100, used when no targetKB is set */
  quality: number;
  /** max output width in px (aspect kept); 0/undefined = keep original */
  maxWidth?: number;
  /** exact target size in KB; binary-searches quality (lossy formats only) */
  targetKB?: number;
  /** output format; 'keep' = original extension */
  format: 'keep' | 'jpg' | 'webp' | 'png';
}

export interface SmartCompressResult extends ConvertedImage {
  origBytes: number;
  outBytes: number;
  width: number;
  height: number;
  qualityUsed: number;
}

/**
 * Smart image compressor for the /convert/compress-image/ pillar page.
 * Quality slider, optional max-width resize, optional exact target-KB
 * (binary search on quality for JPEG/WebP). Everything on-device.
 */
export async function compressImageSmart(
  file: File,
  opts: SmartCompressOpts
): Promise<SmartCompressResult> {
  const origExt = imgExt(file.name);
  const outExt =
    opts.format === 'keep' ? (mimeForExt(origExt) ? origExt : 'jpg') : opts.format;
  const mime = mimeForExt(outExt);
  if (!mime) throw new Error(`Sorry, we can't write .${outExt} images yet.`);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      'We could not read that image. It may be corrupt, or the format is not supported for reading in this browser.'
    );
  }

  try {
    let w = bitmap.width;
    let h = bitmap.height;
    const maxW = opts.maxWidth ?? 0;
    if (maxW > 0 && w > maxW) {
      h = Math.round((h * maxW) / w);
      w = maxW;
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    ctx.imageSmoothingQuality = 'high';
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);

    const encode = (q: number): Promise<Blob | null> =>
      new Promise((res) => canvas.toBlob(res, mime, q));

    const lossy = mime === 'image/jpeg' || mime === 'image/webp';
    let qualityUsed = Math.min(100, Math.max(1, opts.quality)) / 100;
    let blob: Blob | null = null;

    if (opts.targetKB && opts.targetKB > 0 && lossy) {
      // Binary search quality so the output lands at/under the target size.
      const target = opts.targetKB * 1024;
      let lo = 0.05;
      let hi = 0.95;
      let best: Blob | null = null;
      let bestQ = lo;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        const b = await encode(mid);
        if (!b) break;
        if (b.size <= target) {
          best = b;
          bestQ = mid;
          lo = mid; // try higher quality while staying under target
        } else {
          hi = mid;
        }
      }
      blob = best ?? (await encode(lo));
      qualityUsed = bestQ;
      if (blob && blob.size > target) {
        // Even the lowest quality overshoots (e.g. huge dimensions):
        // keep the smallest we got; the UI reports the honest numbers.
      }
    } else {
      blob = await encode(qualityUsed);
    }

    if (!blob) {
      throw new Error(
        `This browser refused to encode ${outExt.toUpperCase()}. Try PNG or JPG instead.`
      );
    }
    const base = file.name.replace(/\.[^.]+$/, '') || 'image';
    return {
      blob,
      filename: `${base}-compressed.${outExt}`,
      origBytes: file.size,
      outBytes: blob.size,
      width: w,
      height: h,
      qualityUsed: Math.round(qualityUsed * 100),
    };
  } finally {
    bitmap.close();
  }
}
