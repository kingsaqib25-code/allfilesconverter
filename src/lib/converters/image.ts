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
