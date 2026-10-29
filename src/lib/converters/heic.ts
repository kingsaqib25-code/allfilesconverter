/**
 * HEIC / HEIF (iPhone photos) -> JPG / PNG via the heic2any library.
 * Decoding happens fully on-device with WebAssembly. No upload, no server.
 */

export async function convertHeic(
  file: File,
  toExt: 'jpg' | 'png',
  quality = 0.92
): Promise<{ blob: Blob; filename: string }> {
  // Dynamic import: heic2any touches browser APIs, so it must only load in the browser.
  const mod = await import('heic2any');
  const heic2any = (mod as { default: unknown }).default as (opts: {
    blob: Blob;
    toType: string;
    quality?: number;
  }) => Promise<Blob | Blob[]>;

  let result: Blob | Blob[];
  try {
    result = await heic2any({
      blob: file,
      toType: toExt === 'jpg' ? 'image/jpeg' : 'image/png',
      quality,
    });
  } catch {
    throw new Error(
      'We could not decode that HEIC file. It may be corrupt or use an unsupported variant.'
    );
  }

  const blob = Array.isArray(result) ? result[0] : result;
  if (!blob) throw new Error('Conversion produced no output. Please try another file.');
  const base = file.name.replace(/\.[^.]+$/, '');
  return { blob, filename: `${base}.${toExt}` };
}
