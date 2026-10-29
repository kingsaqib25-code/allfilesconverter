/**
 * Video/audio conversion via ffmpeg.wasm — 100% on-device.
 *
 * Uses the SINGLE-THREADED core (@ffmpeg/core, not -mt) served from
 * /ffmpeg-core/ (copied there at build time by scripts/copy-ffmpeg-core.mjs),
 * so no COOP/COEP headers are needed and there is no runtime CDN dependency.
 *
 * LAZY-LOADING: this module (and @ffmpeg/ffmpeg with it) must only ever be
 * loaded via dynamic import() — from registry entries or components — never
 * via a static import, so the ~30MB engine never touches the homepage bundle.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

export type FfmpegLoadState = 'idle' | 'loading' | 'ready';

/** Browser-memory guard: files bigger than this get a friendly warning, not a crash. */
export const MAX_MEDIA_BYTES = 500 * 1024 * 1024;

/** Shown while the engine downloads/initializes (one-time per browser). */
export const FFMPEG_LOADING_NOTE = 'Preparing converter… (~30 MB one-time download)';

export interface ConvertResult {
  blob: Blob;
  filename: string;
}

/** Builds the ffmpeg argv for a single-pass conversion. */
export type ArgBuilder = (input: string, output: string) => string[];

// ---------------------------------------------------------------------------
// Load-state events (so the UI can show "Preparing converter…" while loading)
// ---------------------------------------------------------------------------

let loadState: FfmpegLoadState = 'idle';
const listeners = new Set<(s: FfmpegLoadState) => void>();

export function onFfmpegLoadState(cb: (s: FfmpegLoadState) => void): () => void {
  listeners.add(cb);
  cb(loadState);
  return () => {
    listeners.delete(cb);
  };
}

function setLoadState(s: FfmpegLoadState): void {
  loadState = s;
  listeners.forEach((cb) => {
    try {
      cb(s);
    } catch {
      /* listener errors must never break conversion */
    }
  });
}

// ---------------------------------------------------------------------------
// Singleton engine + progress forwarding
// ---------------------------------------------------------------------------

let ffmpeg: FFmpeg | null = null;
let progressHandler: ((ratio: number) => void) | null = null;

/** Forward ffmpeg's time-based progress (0..1) to whoever is converting now. */
export function setProgressHandler(cb: ((ratio: number) => void) | null): void {
  progressHandler = cb;
}

async function getFfmpeg(): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  setLoadState('loading');
  try {
    const inst = new FFmpeg();
    inst.on('progress', ({ progress }) => {
      if (progressHandler) {
        const r = typeof progress === 'number' && isFinite(progress) ? progress : 0;
        progressHandler(Math.min(1, Math.max(0, r)));
      }
    });
    await inst.load({
      coreURL: '/ffmpeg-core/ffmpeg-core.js',
      wasmURL: '/ffmpeg-core/ffmpeg-core.wasm',
    });
    ffmpeg = inst;
    setLoadState('ready');
    return inst;
  } catch {
    setLoadState('idle');
    throw new Error(
      'The video engine could not start in this browser. Please try the latest Chrome or Edge on a desktop computer.'
    );
  }
}

function guardSize(file: File): void {
  if (file.size > MAX_MEDIA_BYTES) {
    throw new Error(
      'That file is over 500 MB — browsers usually run out of memory on files that big. ' +
        'Please try a shorter clip or a smaller file.'
    );
  }
}

function baseName(file: File): string {
  return file.name.replace(/\.[^.]+$/, '') || 'converted';
}

function friendlyError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/memory|OOM|out of memory|abort\(/i.test(msg)) {
    return new Error(
      'Your browser ran out of memory during conversion. Try a smaller file, or close other tabs and try again.'
    );
  }
  return new Error(
    'We could not convert that file — it may use an unsupported codec or be damaged. Please try another file.'
  );
}

function isKnownError(e: unknown): boolean {
  return (
    e instanceof Error &&
    /over 500 MB|ran out of memory|could not convert|produced no output|failed with code|video engine could not start/i.test(
      e.message
    )
  );
}

// ---------------------------------------------------------------------------
// Single-pass conversion
// ---------------------------------------------------------------------------

export async function convertMedia(
  file: File,
  buildArgs: ArgBuilder,
  outExt: string,
  mime: string
): Promise<ConvertResult> {
  guardSize(file);
  const ff = await getFfmpeg();
  const inExt = (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 8);
  const input = `input.${inExt}`;
  const output = `output.${outExt}`;
  try {
    await ff.writeFile(input, await fetchFile(file));
    const code = await ff.exec(buildArgs(input, output));
    if (code !== 0) throw new Error(`ffmpeg failed with code ${code}`);
    const data = (await ff.readFile(output)) as Uint8Array;
    if (!data || data.length === 0) {
      throw new Error(
        'Conversion produced no output — the file may use an unsupported codec or be damaged.'
      );
    }
    return { blob: new Blob([data as unknown as BlobPart], { type: mime }), filename: `${baseName(file)}.${outExt}` };
  } catch (e) {
    if (isKnownError(e)) throw e;
    throw friendlyError(e);
  } finally {
    try {
      await ff.deleteFile(input);
    } catch {
      /* ignore */
    }
    try {
      await ff.deleteFile(output);
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Two-pass GIF (palettegen -> paletteuse) — the quality way to make GIFs
// ---------------------------------------------------------------------------

export interface GifOptions {
  /** Start time in seconds. */
  start: number;
  /** Clip length in seconds (capped at 15 by callers). */
  duration: number;
  /** Output width in px; height scales to keep aspect ratio. */
  width: number;
  /** Frames per second. */
  fps: number;
  quality: 'standard' | 'high';
  onProgress?: (ratio: number) => void;
}

export async function videoToGif(file: File, opts: GifOptions): Promise<ConvertResult> {
  guardSize(file);
  const ff = await getFfmpeg();
  const inExt = (file.name.split('.').pop() || 'mp4').toLowerCase().slice(0, 8);
  const input = `input.${inExt}`;
  const palette = 'palette.png';
  const output = 'output.gif';

  const ss = Math.max(0, opts.start).toFixed(2);
  const t = Math.max(0.5, Math.min(15, opts.duration)).toFixed(2);
  const vfBase = `fps=${opts.fps},scale=${opts.width}:-1:flags=lanczos`;
  const paletteGen =
    opts.quality === 'high'
      ? `${vfBase},palettegen=max_colors=256:reserve_transparent=0`
      : `${vfBase},palettegen`;
  const paletteUse =
    opts.quality === 'high'
      ? `${vfBase}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`
      : `${vfBase}[x];[x][1:v]paletteuse`;

  setProgressHandler(opts.onProgress ? (r) => opts.onProgress!(r * 0.35) : null);
  try {
    await ff.writeFile(input, await fetchFile(file));

    // Pass 1: build the optimal palette for this exact clip.
    let code = await ff.exec(['-ss', ss, '-t', t, '-i', input, '-vf', paletteGen, palette]);
    if (code !== 0) throw new Error(`ffmpeg failed with code ${code} (palette pass)`);

    // Pass 2: render the GIF using that palette.
    setProgressHandler(opts.onProgress ? (r) => opts.onProgress!(0.35 + r * 0.65) : null);
    code = await ff.exec([
      '-ss',
      ss,
      '-t',
      t,
      '-i',
      input,
      '-i',
      palette,
      '-lavfi',
      paletteUse,
      output,
    ]);
    if (code !== 0) throw new Error(`ffmpeg failed with code ${code} (render pass)`);

    const data = (await ff.readFile(output)) as Uint8Array;
    if (!data || data.length === 0) {
      throw new Error(
        'Conversion produced no output — the file may use an unsupported codec or be damaged.'
      );
    }
    return { blob: new Blob([data as unknown as BlobPart], { type: 'image/gif' }), filename: `${baseName(file)}.gif` };
  } catch (e) {
    if (isKnownError(e)) throw e;
    throw friendlyError(e);
  } finally {
    setProgressHandler(null);
    for (const f of [input, palette, output]) {
      try {
        await ff.deleteFile(f);
      } catch {
        /* ignore */
      }
    }
  }
}
