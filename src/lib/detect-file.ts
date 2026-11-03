/**
 * Smart file-type detection for the homepage Smart Converter.
 *
 * Detection order (first hit wins):
 *  1. File extension from the name (fast path, covers ~99% of drops)
 *  2. Browser MIME type (file.type) mapped to an extension
 *  3. Magic bytes — first 16 bytes of the file (catches renamed / extension-less files)
 *
 * Pure function, no DOM beyond File/Blob — unit-testable in Node.
 */

export interface DetectedType {
  /** normalized extension, e.g. 'png' ('' when unknown) */
  ext: string;
  /** human label, e.g. 'PNG image' */
  label: string;
  /** how we figured it out — shown nowhere, useful for debugging */
  via: 'extension' | 'mime' | 'magic' | 'unknown';
}

const LABELS: Record<string, string> = {
  png: 'PNG image', jpg: 'JPG image', jpeg: 'JPG image', webp: 'WebP image',
  avif: 'AVIF image', gif: 'GIF image', bmp: 'BMP image', heic: 'HEIC photo',
  heif: 'HEIF image', svg: 'SVG vector', ico: 'ICO icon',
  pdf: 'PDF document',
  mp4: 'MP4 video', mov: 'MOV video', mkv: 'MKV video', webm: 'WebM video',
  avi: 'AVI video',
  mp3: 'MP3 audio', wav: 'WAV audio', flac: 'FLAC audio', ogg: 'OGG audio',
  m4a: 'M4A audio', aac: 'AAC audio', wma: 'WMA audio',
  srt: 'SRT subtitles', vtt: 'WebVTT subtitles', ass: 'ASS subtitles', ssa: 'SSA subtitles',
  txt: 'plain text', md: 'Markdown', markdown: 'Markdown', html: 'HTML page', htm: 'HTML page',
  json: 'JSON data', csv: 'CSV spreadsheet', yaml: 'YAML data', yml: 'YAML data',
  toml: 'TOML data', xml: 'XML data',
};

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif',
  'image/gif': 'gif', 'image/bmp': 'bmp', 'image/heic': 'heic', 'image/heif': 'heif',
  'image/svg+xml': 'svg', 'image/x-icon': 'ico',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac',
  'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
  'text/plain': 'txt', 'text/markdown': 'md', 'text/html': 'html',
  'application/json': 'json', 'text/csv': 'csv',
};

interface MagicSig { ext: string; offset: number; bytes: number[] }

const MAGIC: MagicSig[] = [
  { ext: 'png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'jpg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { ext: 'gif', offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: 'pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
  // RIFF....WEBP
  { ext: 'webp', offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
  // RIFF....WAVE
  { ext: 'wav', offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
  { ext: 'mp3', offset: 0, bytes: [0x49, 0x44, 0x33] }, // ID3
  { ext: 'mp3', offset: 0, bytes: [0xff, 0xfb] },
  { ext: 'ogg', offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53] }, // OggS
  { ext: 'flac', offset: 0, bytes: [0x66, 0x4c, 0x61, 0x43] }, // fLaC
  // ftyp at offset 4 → MP4/MOV (ambiguous between them; ext/MIME preferred)
  { ext: 'mp4', offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
];

function labelFor(ext: string): string {
  return LABELS[ext] ?? (ext ? `.${ext.toUpperCase()} file` : 'unknown file');
}

/** Synchronous magic-byte match against a 16-byte header. Exported for tests. */
export function matchMagic(header: Uint8Array): string | null {
  for (const sig of MAGIC) {
    let ok = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (header[sig.offset + i] !== sig.bytes[i]) { ok = false; break; }
    }
    if (!ok) continue;
    if (sig.ext === 'webp') {
      // confirm the 'WEBP' marker at offset 8 (else it may be WAV)
      if (header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50) return 'webp';
      continue;
    }
    if (sig.ext === 'wav') {
      // confirm the 'WAVE' marker at offset 8 (else it may be WebP)
      if (header[8] === 0x57 && header[9] === 0x41 && header[10] === 0x56 && header[11] === 0x45) return 'wav';
      continue;
    }
    return sig.ext;
  }
  return null;
}

export async function detectFileType(file: File): Promise<DetectedType> {
  // 1. extension
  const parts = file.name.split('.');
  const ext = parts.length > 1 ? (parts.pop() ?? '').toLowerCase() : '';
  if (ext) return { ext, label: labelFor(ext), via: 'extension' };

  // 2. MIME type
  const mimeExt = file.type ? MIME_TO_EXT[file.type.toLowerCase()] : undefined;
  if (mimeExt) return { ext: mimeExt, label: labelFor(mimeExt), via: 'mime' };

  // 3. magic bytes (first 16 bytes only — cheap)
  try {
    const buf = await file.slice(0, 16).arrayBuffer();
    const header = new Uint8Array(buf);
    const magicExt = matchMagic(header);
    if (magicExt) return { ext: magicExt, label: labelFor(magicExt), via: 'magic' };
  } catch {
    /* fall through to unknown */
  }

  return { ext: '', label: 'unknown file', via: 'unknown' };
}
