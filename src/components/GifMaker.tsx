'use client';

/**
 * GIF Maker studio — the flagship video-to-GIF tool, plus a GIF optimizer.
 *
 * VIDEO → GIF: drop a video, preview it, trim the exact moment (start/end,
 * max 15 s — 10 s for ping-pong), pick a size preset or custom width/FPS,
 * add effects (speed, reverse, ping-pong, loop count, crop), and render a
 * two-pass palette GIF — all on-device via the lazily-loaded ffmpeg.wasm
 * module.
 *
 * OPTIMIZE GIF: drop an existing GIF and re-compress it (fewer colors,
 * smaller dimensions / frame rate) to shrink the file.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const WIDTHS = [240, 320, 480, 640];
const FPSES = [8, 10, 12, 15, 20];
const MAX_GIF_SECONDS = 15;
const MAX_PINGPONG_SECONDS = 10;
const VIDEO_EXTS = ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', '3g2', 'ogv'];

const PRESETS = [
  { id: 'discord', label: '💬 Discord', width: 320, fps: 10 },
  { id: 'balanced', label: '⚖ Balanced', width: 480, fps: 12 },
  { id: 'hd', label: '🎞 HD', width: 640, fps: 15 },
  { id: 'tiny', label: '📦 Tiny', width: 240, fps: 8 },
];

const SPEEDS = [0.5, 1, 1.5, 2];

const PLAY_MODES = [
  { id: 'normal', label: '▶ Normal' },
  { id: 'reverse', label: '◀ Reverse' },
  { id: 'pingpong', label: '🔁 Ping-pong' },
] as const;
type PlayMode = (typeof PLAY_MODES)[number]['id'];

// Netscape loop value = repeats AFTER the first play: 0 = infinite,
// 1 = 2 total plays, 2 = 3 total plays.
const LOOPS = [
  { id: 0, label: '∞ Infinite' },
  { id: 1, label: '2 plays' },
  { id: 2, label: '3 plays' },
];

const CROP_MODES = [
  { id: 'none', label: 'No crop' },
  { id: 'square', label: '⬛ Square 1:1' },
  { id: 'wide', label: '🖥 16:9' },
  { id: 'std', label: '▦ 4:3' },
  { id: 'custom', label: '✏ Custom' },
] as const;
type CropMode = (typeof CROP_MODES)[number]['id'];

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function fmtTimePrecise(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00.0';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const whole = Math.floor(sec);
  const tenth = Math.floor((sec - whole) * 10);
  return `${m}:${whole.toString().padStart(2, '0')}.${tenth}`;
}

/** Accepts "m:ss", "m:ss.s" or plain seconds. */
function parseTimeInput(str: string): number | null {
  const s = str.trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface CropRect {
  w: number;
  h: number;
  x: number;
  y: number;
}

/** Centered crop rect for a preset aspect, computed from source dimensions. */
function presetCrop(kind: 'square' | 'wide' | 'std', vw: number, vh: number): CropRect | null {
  if (!(vw > 0 && vh > 0)) return null;
  if (kind === 'square') {
    const s = Math.min(vw, vh);
    return { w: s, h: s, x: Math.round((vw - s) / 2), y: Math.round((vh - s) / 2) };
  }
  const ratio = kind === 'wide' ? 16 / 9 : 4 / 3;
  if (vw / vh >= ratio) {
    const h = vh;
    const w = Math.round(vh * ratio);
    return { w, h, x: Math.round((vw - w) / 2), y: 0 };
  }
  const w = vw;
  const h = Math.round(vw / ratio);
  return { w, h, x: 0, y: Math.round((vh - h) / 2) };
}

function clampCustomCrop(c: CropRect, vw: number, vh: number): CropRect | null {
  if (!(vw > 0 && vh > 0)) return null;
  const x = Math.max(0, Math.min(Math.round(c.x) || 0, vw - 1));
  const y = Math.max(0, Math.min(Math.round(c.y) || 0, vh - 1));
  const w = Math.max(1, Math.min(Math.round(c.w) || 0, vw - x));
  const h = Math.max(1, Math.min(Math.round(c.h) || 0, vh - y));
  return { w, h, x, y };
}

export default function GifMaker() {
  const [mode, setMode] = useState<'video' | 'optimize'>('video');
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [vidW, setVidW] = useState(0);
  const [vidH, setVidH] = useState(0);
  const [cur, setCur] = useState(0);
  const [start, setStart] = useState(0);
  const [len, setLen] = useState(6);
  const [startTxt, setStartTxt] = useState('0:00.0');
  const [endTxt, setEndTxt] = useState('0:06.0');
  const [width, setWidth] = useState(480);
  const [fps, setFps] = useState(10);
  const [quality, setQuality] = useState<'standard' | 'high'>('standard');
  const [speed, setSpeed] = useState(1);
  const [playMode, setPlayMode] = useState<PlayMode>('normal');
  const [loopCount, setLoopCount] = useState(0);
  const [cropMode, setCropMode] = useState<CropMode>('none');
  const [cropCustom, setCropCustom] = useState<CropRect>({ w: 320, h: 320, x: 0, y: 0 });
  // Optimize-mode controls
  const [optWidth, setOptWidth] = useState(0); // 0 = keep original
  const [optFps, setOptFps] = useState(0); // 0 = keep original
  const [optColors, setOptColors] = useState<256 | 128 | 64>(128);
  const [optDone, setOptDone] = useState<{ url: string; name: string; orig: number; out: number } | null>(null);

  const [working, setWorking] = useState(false);
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  const [doneName, setDoneName] = useState('');
  const [doneSize, setDoneSize] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setVideoUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setDoneUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setOptDone((d) => {
      if (d) URL.revokeObjectURL(d.url);
      return null;
    });
    setFile(null);
    setDuration(0);
    setCur(0);
    setStart(0);
    setLen(6);
    setError(null);
    setProgress(0);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const pickFile = useCallback(
    (f: File | undefined | null) => {
      setError(null);
      if (!f) return;
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      const isGif = ext === 'gif' || f.type === 'image/gif';
      const isVideo = f.type.startsWith('video/') || VIDEO_EXTS.includes(ext);
      if (!isVideo && !isGif) {
        setError(
          `That looks like a .${ext || '?'} file — drop a video file (${VIDEO_EXTS.map((e) => '.' + e).join(', ')}) or a .gif to optimize.`
        );
        return;
      }
      reset();
      setFile(f);
      setVideoUrl(URL.createObjectURL(f));
      setMode(isGif ? 'optimize' : 'video');
    },
    [reset]
  );

  const onLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const d = isFinite(v.duration) ? v.duration : 0;
    setDuration(d);
    setVidW(v.videoWidth || 0);
    setVidH(v.videoHeight || 0);
    setStart(0);
    const l = Math.min(6, Math.max(1, Math.floor(d) || 6));
    setLen(l);
    setStartTxt(fmtTimePrecise(0));
    setEndTxt(fmtTimePrecise(l));
  }, []);

  // Keep the scrubber in sync while the preview plays.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCur(v.currentTime);
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [videoUrl]);

  const maxLen = playMode === 'pingpong' ? MAX_PINGPONG_SECONDS : MAX_GIF_SECONDS;

  const clampLen = useCallback(
    (wanted: number, s: number, d: number) =>
      Math.max(1, Math.min(maxLen, wanted, Math.max(1, d - s))),
    [maxLen]
  );

  const onStartChange = useCallback(
    (v: number) => {
      const s = Math.max(0, Math.min(v, Math.max(0, duration - 1)));
      setStart(s);
      setStartTxt(fmtTimePrecise(s));
      setLen((l) => {
        const nl = clampLen(l, s, duration);
        setEndTxt(fmtTimePrecise(s + nl));
        return nl;
      });
      if (videoRef.current) videoRef.current.currentTime = s;
    },
    [duration, clampLen]
  );

  const onLenChange = useCallback(
    (v: number) => {
      const nl = clampLen(v, start, duration);
      setLen(nl);
      setEndTxt(fmtTimePrecise(start + nl));
    },
    [start, duration, clampLen]
  );

  const onStartText = useCallback(
    (txt: string) => {
      setStartTxt(txt);
      const v = parseTimeInput(txt);
      if (v !== null) onStartChange(v);
    },
    [onStartChange]
  );

  const onEndText = useCallback(
    (txt: string) => {
      setEndTxt(txt);
      const v = parseTimeInput(txt);
      if (v !== null) onLenChange(Math.max(0.5, v - start));
    },
    [onLenChange, start]
  );

  const useCurrentPosition = useCallback(() => {
    onStartChange(cur);
  }, [cur, onStartChange]);

  const onPlayModeChange = useCallback(
    (m: PlayMode) => {
      setPlayMode(m);
      if (m === 'pingpong') {
        setLen((l) => {
          const nl = Math.min(l, MAX_PINGPONG_SECONDS);
          setEndTxt(fmtTimePrecise(start + nl));
          return nl;
        });
      }
    },
    [start]
  );

  const onQualityChange = useCallback((q: 'standard' | 'high') => {
    setQuality(q);
    // High quality pairs a better palette with a higher default frame rate.
    setFps((f) => (q === 'high' && f < 15 ? 15 : q === 'standard' && f > 10 ? 10 : f));
  }, []);

  const applyPreset = useCallback(
    (p: { width: number; fps: number }) => {
      setWidth(p.width);
      setFps(p.fps);
    },
    []
  );

  const activePreset = PRESETS.find((p) => p.width === width && p.fps === fps)?.id ?? null;

  const resolvedCrop: CropRect | null =
    cropMode === 'none'
      ? null
      : cropMode === 'custom'
        ? clampCustomCrop(cropCustom, vidW, vidH)
        : presetCrop(cropMode, vidW, vidH);

  // Rough size estimate: 1 byte/px palette frame, LZW typically ~2.5x smaller.
  const estH = vidW > 0 && vidH > 0 ? Math.round((width * vidH) / vidW) : Math.round(width * 0.5625);
  const effDur = len / speed;
  const outFrames = effDur * fps * (playMode === 'pingpong' ? 2 : 1);
  const estBytes = Math.round(width * estH * outFrames * 0.4);
  const cappedNote = len >= maxLen;

  const convert = useCallback(async () => {
    if (!file || working) return;
    setWorking(true);
    setError(null);
    setProgress(0);
    let unsub: (() => void) | undefined;
    try {
      const mod = await import('@/lib/converters/video');
      unsub = mod.onFfmpegLoadState((s) =>
        setLoadNote(s === 'loading' ? mod.FFMPEG_LOADING_NOTE : null)
      );
      const { blob, filename } = await mod.videoToGif(file, {
        start,
        duration: len,
        width,
        fps,
        quality,
        speed,
        playMode,
        loop: loopCount,
        crop: resolvedCrop,
        onProgress: (r) => setProgress(r),
      });
      const url = URL.createObjectURL(blob);
      setDoneUrl(url);
      setDoneName(filename);
      setDoneSize(fmtSize(blob.size));
      setProgress(1);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Something went wrong while making your GIF. Please try a shorter clip.'
      );
    } finally {
      unsub?.();
      setLoadNote(null);
      setWorking(false);
    }
  }, [file, working, start, len, width, fps, quality, speed, playMode, loopCount, resolvedCrop]);

  const optimize = useCallback(async () => {
    if (!file || working) return;
    setWorking(true);
    setError(null);
    setProgress(0);
    let unsub: (() => void) | undefined;
    try {
      const mod = await import('@/lib/converters/video');
      unsub = mod.onFfmpegLoadState((s) =>
        setLoadNote(s === 'loading' ? mod.FFMPEG_LOADING_NOTE : null)
      );
      const { blob, filename } = await mod.optimizeGif(file, {
        width: optWidth,
        fps: optFps,
        colors: optColors,
        onProgress: (r) => setProgress(r),
      });
      const url = URL.createObjectURL(blob);
      setOptDone({ url, name: filename, orig: file.size, out: blob.size });
      setProgress(1);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Something went wrong while optimizing your GIF. Please try again.'
      );
    } finally {
      unsub?.();
      setLoadNote(null);
      setWorking(false);
    }
  }, [file, working, optWidth, optFps, optColors]);

  const dropzoneLabel =
    mode === 'video' ? 'Drop your video here' : 'Drop your GIF here to shrink it';
  const dropzoneSub =
    mode === 'video'
      ? 'or click to browse — MP4, MOV, MKV, WebM, AVI and more'
      : 'or click to browse — .gif files';

  return (
    <div className="widget gif-studio" aria-label="Video to GIF Maker studio">
      <div className="gm-tabs" role="tablist" aria-label="GIF tools">
        <button
          role="tab"
          aria-selected={mode === 'video'}
          type="button"
          className={mode === 'video' ? 'gm-tab on' : 'gm-tab'}
          onClick={() => {
            reset();
            setMode('video');
          }}
        >
          🎬 Video → GIF
        </button>
        <button
          role="tab"
          aria-selected={mode === 'optimize'}
          type="button"
          className={mode === 'optimize' ? 'gm-tab on' : 'gm-tab'}
          onClick={() => {
            reset();
            setMode('optimize');
          }}
        >
          🗜 Optimize GIF
        </button>
      </div>

      {!file ? (
        <div
          className="dropzone"
          role="button"
          tabIndex={0}
          aria-label={dropzoneLabel}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pickFile(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="dz-icon" aria-hidden="true">{mode === 'video' ? '🎬' : '🗜'}</div>
          <div className="dz-title">{dropzoneLabel}</div>
          <div className="dz-sub">{dropzoneSub}</div>
          <input
            ref={inputRef}
            type="file"
            accept={mode === 'video' ? 'video/*,.mkv,.avi,.mov,.flv,.wmv' : '.gif,image/gif'}
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>
      ) : mode === 'optimize' ? (
        <>
          <img
            src={videoUrl ?? undefined}
            alt="GIF to optimize"
            className="gif-preview"
            style={{ objectFit: 'contain' }}
          />
          <p className="gm-note">
            Original: <strong>{fmtSize(file.size)}</strong> — pick how aggressively to shrink it.
          </p>

          <div className="gm-opts">
            <div className="gm-opt">
              <span className="gm-label">Width</span>
              <div className="gm-btns" role="group" aria-label="Output width">
                {[{ id: 0, label: 'Original' }, ...WIDTHS.map((w) => ({ id: w, label: `${w}px` }))].map(
                  (o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={optWidth === o.id ? 'gm-chip on' : 'gm-chip'}
                      onClick={() => setOptWidth(o.id)}
                    >
                      {o.label}
                    </button>
                  )
                )}
              </div>
            </div>
            <div className="gm-opt">
              <span className="gm-label">Frame rate</span>
              <div className="gm-btns" role="group" aria-label="Frames per second">
                {[{ id: 0, label: 'Original' }, ...[8, 10, 15].map((f) => ({ id: f, label: `${f} fps` }))].map(
                  (o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={optFps === o.id ? 'gm-chip on' : 'gm-chip'}
                      onClick={() => setOptFps(o.id)}
                    >
                      {o.label}
                    </button>
                  )
                )}
              </div>
            </div>
            <div className="gm-opt">
              <span className="gm-label">Colors</span>
              <div className="gm-btns" role="group" aria-label="Palette colors">
                {([256, 128, 64] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={optColors === c ? 'gm-chip on' : 'gm-chip'}
                    onClick={() => setOptColors(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="gm-note">
            Fewer colors = smaller file. 128 colors looks near-identical for most GIFs and
            typically saves 30–50%.
          </p>

          {working ? (
            <div role="status" aria-label={loadNote ?? 'Optimizing GIF…'}>
              {loadNote ? <div className="load-note">{loadNote}</div> : null}
              <div className="progress determinate">
                <div style={{ width: `${Math.round(progress * 100)}%`, animation: 'none', marginLeft: 0 }} />
              </div>
              <p className="gm-note">Optimizing… {Math.round(progress * 100)}%</p>
            </div>
          ) : optDone ? (
            <div className="alert ok">
              Done! {fmtSize(optDone.orig)} → <strong>{fmtSize(optDone.out)}</strong> (
              {Math.max(0, Math.round((1 - optDone.out / optDone.orig) * 100))}% smaller).
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {!optDone ? (
              <button className="btn" onClick={optimize} disabled={working}>
                {working ? 'Optimizing…' : 'Optimize my GIF →'}
              </button>
            ) : (
              <a className="btn" href={optDone.url} download={optDone.name}>
                ⬇ Download {optDone.name}
              </a>
            )}
            <button className="btn secondary" onClick={reset}>
              {optDone ? 'Optimize another' : 'Choose different file'}
            </button>
          </div>
        </>
      ) : (
        <>
          <video
            ref={videoRef}
            src={videoUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={onLoadedMetadata}
            className="gif-preview"
            aria-label="Video preview"
          />
          {duration > 0 && (
            <>
              <div className="gm-row">
                <label htmlFor="gm-scrub">
                  Preview <span className="gm-val">{fmtTime(cur)} / {fmtTime(duration)}</span>
                </label>
                <input
                  id="gm-scrub"
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={Math.min(cur, duration)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setCur(v);
                    if (videoRef.current) videoRef.current.currentTime = v;
                  }}
                />
              </div>

              <div className="gm-row">
                <label htmlFor="gm-start">
                  Start at <span className="gm-val">{fmtTime(start)}</span>
                </label>
                <input
                  id="gm-start"
                  type="range"
                  min={0}
                  max={Math.max(0, duration - 1)}
                  step={0.1}
                  value={start}
                  onChange={(e) => onStartChange(Number(e.target.value))}
                />
              </div>

              <div className="gm-timerow">
                <div className="gm-timefield">
                  <label htmlFor="gm-start-txt">Start (m:ss)</label>
                  <input
                    id="gm-start-txt"
                    type="text"
                    inputMode="decimal"
                    value={startTxt}
                    onChange={(e) => onStartText(e.target.value)}
                    aria-label="Exact start time"
                  />
                </div>
                <div className="gm-timefield">
                  <label htmlFor="gm-end-txt">End (m:ss)</label>
                  <input
                    id="gm-end-txt"
                    type="text"
                    inputMode="decimal"
                    value={endTxt}
                    onChange={(e) => onEndText(e.target.value)}
                    aria-label="Exact end time"
                  />
                </div>
                <button type="button" className="mini-btn" onClick={useCurrentPosition}>
                  ⏱ Use current position
                </button>
              </div>

              <div className="gm-row">
                <label htmlFor="gm-len">
                  GIF length <span className="gm-val">{len.toFixed(1)}s</span>
                </label>
                <input
                  id="gm-len"
                  type="range"
                  min={1}
                  max={maxLen}
                  step={0.5}
                  value={len}
                  onChange={(e) => onLenChange(Number(e.target.value))}
                />
                {cappedNote && (
                  <p className="gm-note">
                    Capped at {maxLen} seconds
                    {playMode === 'pingpong'
                      ? ' for ping-pong (the output doubles, so this becomes a 20-second GIF)'
                      : ' — longer GIFs become enormous files nobody wants to load'}.
                  </p>
                )}
              </div>

              <p className="gm-sect">Size presets</p>
              <div className="gm-btns" role="group" aria-label="Size presets" style={{ marginBottom: '0.5rem' }}>
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={activePreset === p.id ? 'gm-chip on' : 'gm-chip'}
                    onClick={() => applyPreset(p)}
                    title={`${p.width}px wide, ${p.fps} fps`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="gm-opts">
                <div className="gm-opt">
                  <span className="gm-label">Width</span>
                  <div className="gm-btns" role="group" aria-label="Output width">
                    {WIDTHS.map((w) => (
                      <button
                        key={w}
                        type="button"
                        className={width === w ? 'gm-chip on' : 'gm-chip'}
                        onClick={() => setWidth(w)}
                      >
                        {w}px
                      </button>
                    ))}
                  </div>
                </div>
                <div className="gm-opt">
                  <span className="gm-label">Frame rate</span>
                  <div className="gm-btns" role="group" aria-label="Frames per second">
                    {FPSES.map((f) => (
                      <button
                        key={f}
                        type="button"
                        className={fps === f ? 'gm-chip on' : 'gm-chip'}
                        onClick={() => setFps(f)}
                      >
                        {f} fps
                      </button>
                    ))}
                  </div>
                </div>
                <div className="gm-opt">
                  <span className="gm-label">Quality</span>
                  <div className="gm-btns" role="group" aria-label="Quality">
                    {(['standard', 'high'] as const).map((q) => (
                      <button
                        key={q}
                        type="button"
                        className={quality === q ? 'gm-chip on' : 'gm-chip'}
                        onClick={() => onQualityChange(q)}
                      >
                        {q === 'standard' ? 'Standard' : 'High'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <p className="gm-sect">Effects</p>
              <div className="gm-opts">
                <div className="gm-opt">
                  <span className="gm-label">Play mode</span>
                  <div className="gm-btns" role="group" aria-label="Play mode">
                    {PLAY_MODES.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={playMode === m.id ? 'gm-chip on' : 'gm-chip'}
                        onClick={() => onPlayModeChange(m.id)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="gm-opt">
                  <span className="gm-label">Speed</span>
                  <div className="gm-btns" role="group" aria-label="Playback speed">
                    {SPEEDS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={speed === s ? 'gm-chip on' : 'gm-chip'}
                        onClick={() => setSpeed(s)}
                      >
                        {s}×
                      </button>
                    ))}
                  </div>
                </div>
                <div className="gm-opt">
                  <span className="gm-label">Loop</span>
                  <div className="gm-btns" role="group" aria-label="Loop count">
                    {LOOPS.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        className={loopCount === l.id ? 'gm-chip on' : 'gm-chip'}
                        onClick={() => setLoopCount(l.id)}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {playMode === 'pingpong' && (
                <p className="gm-note">
                  Ping-pong plays your clip forward then backward (boomerang style) — the output
                  is twice as long as the clip.
                </p>
              )}

              <p className="gm-sect">Crop</p>
              <div className="gm-btns" role="group" aria-label="Crop mode" style={{ marginBottom: '0.5rem' }}>
                {CROP_MODES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={cropMode === c.id ? 'gm-chip on' : 'gm-chip'}
                    onClick={() => setCropMode(c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              {cropMode === 'custom' && (
                <div className="gm-cropgrid">
                  {(['x', 'y', 'w', 'h'] as const).map((k) => (
                    <label key={k}>
                      {k.toUpperCase()}
                      <input
                        type="number"
                        min={0}
                        value={cropCustom[k]}
                        onChange={(e) =>
                          setCropCustom((c) => ({ ...c, [k]: Math.max(0, Number(e.target.value) || 0) }))
                        }
                        aria-label={`Crop ${k}`}
                      />
                    </label>
                  ))}
                </div>
              )}
              {resolvedCrop && cropMode !== 'none' && (
                <p className="gm-note">
                  Cropping to {resolvedCrop.w}×{resolvedCrop.h}px
                  {cropMode !== 'custom' ? ' (centered)' : ''} before rendering.
                </p>
              )}

              <p className="gm-est">
                Rough size estimate: <strong>~{fmtSize(estBytes)}</strong>{' '}
                <span className="gm-est-sub">
                  ({width}×{estH}px · {fps} fps · {effDur.toFixed(1)}s
                  {playMode === 'pingpong' ? ' ×2 ping-pong' : ''} · {quality}
                  {speed !== 1 ? ` · ${speed}× speed` : ''})
                </span>
              </p>

              {working ? (
                <div role="status" aria-label={loadNote ?? 'Rendering GIF…'}>
                  {loadNote ? <div className="load-note">{loadNote}</div> : null}
                  <div className="progress determinate">
                    <div style={{ width: `${Math.round(progress * 100)}%`, animation: 'none', marginLeft: 0 }} />
                  </div>
                  <p className="gm-note">Rendering your GIF… {Math.round(progress * 100)}%</p>
                </div>
              ) : doneUrl ? (
                <div className="alert ok">Done! Your GIF is ready ({doneSize}).</div>
              ) : null}

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {!doneUrl ? (
                  <button className="btn" onClick={convert} disabled={working}>
                    {working ? 'Rendering…' : 'Make my GIF →'}
                  </button>
                ) : (
                  <a className="btn" href={doneUrl} download={doneName}>
                    ⬇ Download {doneName}
                  </a>
                )}
                <button className="btn secondary" onClick={reset}>
                  {doneUrl ? 'Make another' : 'Choose different video'}
                </button>
              </div>
            </>
          )}
        </>
      )}
      {error && (
        <div className="alert err" role="alert">
          {error}
        </div>
      )}
      <div className="privacy-note">
        <span aria-hidden="true">🔒</span>
        <span>
          Private by design: your {mode === 'video' ? 'video' : 'GIF'} is processed inside your
          browser and never uploaded anywhere. No watermark, ever.
        </span>
      </div>
    </div>
  );
}
