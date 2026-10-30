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

/** Per-conversion options forwarded from the widget (quality presets etc.). */
export type ConvertOptions = Record<string, string | number>;

/** Builds the ffmpeg argv for a single-pass conversion. */
export type ArgBuilder = (
  input: string,
  output: string,
  opts?: ConvertOptions
) => string[];

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
  mime: string,
  opts?: ConvertOptions
): Promise<ConvertResult> {
  guardSize(file);
  const ff = await getFfmpeg();
  const inExt = (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 8);
  const input = `input.${inExt}`;
  const output = `output.${outExt}`;
  try {
    await ff.writeFile(input, await fetchFile(file));
    const code = await ff.exec(buildArgs(input, output, opts));
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

export interface GifCrop {
  /** Crop rectangle in SOURCE pixels (applied before scaling). */
  w: number;
  h: number;
  x: number;
  y: number;
}

export interface GifOptions {
  /** Start time in seconds. */
  start: number;
  /** Clip length in seconds (capped at 15 by callers; 10 for ping-pong). */
  duration: number;
  /** Output width in px; height scales to keep aspect ratio. */
  width: number;
  /** Frames per second. */
  fps: number;
  quality: 'standard' | 'high';
  /** Playback speed multiplier, e.g. 0.5 | 1 | 1.5 | 2 (default 1). */
  speed?: number;
  /** 'normal' | 'reverse' | 'pingpong' (default 'normal'). */
  playMode?: 'normal' | 'reverse' | 'pingpong';
  /**
   * GIF loop count (Netscape extension): 0 = infinite (default).
   * N > 0 = N repeats after the first play, so 1 = 2 total plays.
   */
  loop?: number;
  /** Crop region in source pixels; null/undefined = no crop. */
  crop?: GifCrop | null;
  onProgress?: (ratio: number) => void;
}

function sanitizeCrop(c: GifCrop | null | undefined): string | null {
  if (!c) return null;
  const w = Math.round(c.w);
  const h = Math.round(c.h);
  const x = Math.round(c.x);
  const y = Math.round(c.y);
  if (!(w > 0 && h > 0) || x < 0 || y < 0) return null;
  return `crop=${w}:${h}:${x}:${y}`;
}

export async function videoToGif(file: File, opts: GifOptions): Promise<ConvertResult> {
  guardSize(file);
  const ff = await getFfmpeg();
  const inExt = (file.name.split('.').pop() || 'mp4').toLowerCase().slice(0, 8);
  const input = `input.${inExt}`;
  const palette = 'palette.png';
  const output = 'output.gif';

  const mode = opts.playMode ?? 'normal';
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const maxT = mode === 'pingpong' ? 10 : 15;
  const ss = Math.max(0, opts.start).toFixed(2);
  const t = Math.max(0.5, Math.min(maxT, opts.duration)).toFixed(2);

  // Base filter chain (no stream labels) applied before palette work.
  const chain: string[] = [`fps=${opts.fps}`];
  const cropF = sanitizeCrop(opts.crop);
  if (cropF) chain.push(cropF);
  chain.push(`scale=${opts.width}:-1:flags=lanczos`);
  if (speed !== 1) chain.push(`setpts=${(1 / speed).toFixed(4)}*PTS`);
  const base = chain.join(',');
  const rev = mode === 'reverse' ? ',reverse' : '';

  const palGenOpts =
    opts.quality === 'high' ? 'palettegen=max_colors=256:reserve_transparent=0' : 'palettegen';
  const palUseOpts =
    opts.quality === 'high'
      ? 'paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle'
      : 'paletteuse';

  // Ping-pong needs a split/reverse/concat graph; everything else is linear.
  const genVf =
    mode === 'pingpong'
      ? `${base},split[a][b];[a]reverse[r];[b][r]concat=n=2:v=1,${palGenOpts}`
      : `${base}${rev},${palGenOpts}`;
  const useVf =
    mode === 'pingpong'
      ? `${base},split[a][b];[a]reverse[r];[b][r]concat=n=2:v=1[x];[x][1:v]${palUseOpts}`
      : `${base}${rev}[x];[x][1:v]${palUseOpts}`;

  const loop = Math.max(0, Math.round(opts.loop ?? 0));

  setProgressHandler(opts.onProgress ? (r) => opts.onProgress!(r * 0.35) : null);
  try {
    await ff.writeFile(input, await fetchFile(file));

    // Pass 1: build the optimal palette for this exact clip.
    let code = await ff.exec(['-ss', ss, '-t', t, '-i', input, '-lavfi', genVf, palette]);
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
      useVf,
      '-loop',
      String(loop),
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

// ---------------------------------------------------------------------------
// GIF optimizer — re-compress an existing GIF (fewer colors, smaller size)
// ---------------------------------------------------------------------------

export interface GifOptimizeOptions {
  /** Output width in px; 0 = keep original. */
  width: number;
  /** Output fps; 0 = keep original. */
  fps: number;
  /** Palette size: 256 | 128 | 64. */
  colors: 256 | 128 | 64;
  onProgress?: (ratio: number) => void;
}

export async function optimizeGif(
  file: File,
  opts: GifOptimizeOptions
): Promise<ConvertResult> {
  guardSize(file);
  const ff = await getFfmpeg();
  const input = 'input.gif';
  const palette = 'palette.png';
  const output = 'output.gif';

  const pre: string[] = [];
  if (opts.fps > 0) pre.push(`fps=${opts.fps}`);
  if (opts.width > 0) pre.push(`scale=${opts.width}:-1:flags=lanczos`);
  const v = pre.length ? pre.join(',') : 'null';
  const genVf = `${v},palettegen=max_colors=${opts.colors}`;
  const useVf = `${v}[x];[x][1:v]paletteuse`;

  setProgressHandler(opts.onProgress ? (r) => opts.onProgress!(r * 0.4) : null);
  try {
    await ff.writeFile(input, await fetchFile(file));

    // Pass 1: palette for the (possibly resized) frames.
    let code = await ff.exec(['-i', input, '-lavfi', genVf, palette]);
    if (code !== 0) throw new Error(`ffmpeg failed with code ${code} (palette pass)`);

    // Pass 2: render the optimized GIF (keeps infinite looping).
    setProgressHandler(opts.onProgress ? (r) => opts.onProgress!(0.4 + r * 0.6) : null);
    code = await ff.exec([
      '-i',
      input,
      '-i',
      palette,
      '-lavfi',
      useVf,
      '-loop',
      '0',
      output,
    ]);
    if (code !== 0) throw new Error(`ffmpeg failed with code ${code} (render pass)`);

    const data = (await ff.readFile(output)) as Uint8Array;
    if (!data || data.length === 0) {
      throw new Error('Optimization produced no output — the file may be damaged.');
    }
    return {
      blob: new Blob([data as unknown as BlobPart], { type: 'image/gif' }),
      filename: `${baseName(file)}-optimized.gif`,
    };
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

// ---------------------------------------------------------------------------
// Concat: join several media files into one (merge-video / merge-audio)
// ---------------------------------------------------------------------------

/**
 * Join multiple media files. Tries the fast concat-demuxer path with stream
 * copy first (no re-encode when the files share a codec); falls back to a
 * full re-encode so mixed inputs still work.
 */
export async function concatMedia(
  files: File[],
  outExt: string,
  mime: string,
  kind: 'video' | 'audio',
  opts?: ConvertOptions
): Promise<ConvertResult> {
  if (files.length < 2) {
    throw new Error('Merging needs at least 2 files — add another one.');
  }
  if (files.length > 20) {
    throw new Error('Please merge at most 20 files at once — browsers run out of memory beyond that.');
  }
  files.forEach(guardSize);
  const ff = await getFfmpeg();
  const output = `merged.${outExt}`;
  const names: string[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const ext = (files[i].name.split('.').pop() || 'bin').toLowerCase().slice(0, 8);
      const name = `part${i}.${ext}`;
      names.push(name);
      await ff.writeFile(name, await fetchFile(files[i]));
    }
    const list = names.map((n) => `file '${n}'`).join('\n');
    await ff.writeFile('list.txt', new TextEncoder().encode(list));

    // Fast path: concat demuxer + stream copy (no quality loss, quick).
    let code = await ff.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', output]);
    if (code !== 0) {
      // Fallback: re-encode everything so mixed codecs/containers still join.
      const crf = String(opts?.crf ?? '23');
      const bitrate = String(opts?.bitrate ?? '192k');
      const args =
        kind === 'video'
          ? ['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c:v', 'libx264', '-crf', crf, '-preset', 'veryfast', '-c:a', 'aac', output]
          : ['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c:a', 'libmp3lame', '-b:a', bitrate, output];
      code = await ff.exec(args);
      if (code !== 0) throw new Error(`ffmpeg failed with code ${code}`);
    }
    const data = (await ff.readFile(output)) as Uint8Array;
    if (!data || data.length === 0) {
      throw new Error(
        'Merging produced no output — the files may use incompatible codecs or be damaged.'
      );
    }
    return { blob: new Blob([data as unknown as BlobPart], { type: mime }), filename: `merged.${outExt}` };
  } catch (e) {
    if (isKnownError(e)) throw e;
    throw friendlyError(e);
  } finally {
    for (const n of [...names, 'list.txt', output]) {
      try {
        await ff.deleteFile(n);
      } catch {
        /* ignore */
      }
    }
  }
}
