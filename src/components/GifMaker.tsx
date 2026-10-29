'use client';

/**
 * GIF Maker studio — the flagship video-to-GIF tool.
 *
 * Drop a video, preview it, trim the exact moment (max 15 s), pick width /
 * FPS / quality, and render a two-pass palette GIF — all on-device via the
 * lazily-loaded ffmpeg.wasm module.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const WIDTHS = [320, 480, 640];
const FPSES = [10, 12, 15, 20];
const MAX_GIF_SECONDS = 15;
const VIDEO_EXTS = ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', '3g2', 'ogv'];

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function GifMaker() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [vidW, setVidW] = useState(0);
  const [vidH, setVidH] = useState(0);
  const [cur, setCur] = useState(0);
  const [start, setStart] = useState(0);
  const [len, setLen] = useState(6);
  const [width, setWidth] = useState(480);
  const [fps, setFps] = useState(10);
  const [quality, setQuality] = useState<'standard' | 'high'>('standard');
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
      const isVideo = f.type.startsWith('video/') || VIDEO_EXTS.includes(ext);
      if (!isVideo) {
        setError(
          `That looks like a .${ext || '?'} file — the GIF Maker needs a video file (${VIDEO_EXTS.map((e) => '.' + e).join(', ')}).`
        );
        return;
      }
      reset();
      setFile(f);
      setVideoUrl(URL.createObjectURL(f));
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
    setLen(Math.min(6, Math.max(1, Math.floor(d) || 6)));
  }, []);

  // Keep the scrubber in sync while the preview plays.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCur(v.currentTime);
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [videoUrl]);

  const clampLen = useCallback(
    (wanted: number, s: number, d: number) =>
      Math.max(1, Math.min(MAX_GIF_SECONDS, wanted, Math.max(1, d - s))),
    []
  );

  const onStartChange = useCallback(
    (v: number) => {
      const s = Math.max(0, Math.min(v, Math.max(0, duration - 1)));
      setStart(s);
      setLen((l) => clampLen(l, s, duration));
      if (videoRef.current) videoRef.current.currentTime = s;
    },
    [duration, clampLen]
  );

  const onLenChange = useCallback(
    (v: number) => setLen(clampLen(v, start, duration)),
    [start, duration, clampLen]
  );

  const onQualityChange = useCallback((q: 'standard' | 'high') => {
    setQuality(q);
    // High quality pairs a better palette with a higher default frame rate.
    setFps((f) => (q === 'high' && f < 15 ? 15 : q === 'standard' && f > 10 ? 10 : f));
  }, []);

  // Rough size estimate: 1 byte/px palette frame, LZW typically ~2.5x smaller.
  const estH = vidW > 0 && vidH > 0 ? Math.round((width * vidH) / vidW) : Math.round(width * 0.5625);
  const estBytes = Math.round(width * estH * fps * len * 0.4);
  const cappedNote = len >= MAX_GIF_SECONDS;

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
  }, [file, working, start, len, width, fps, quality]);

  return (
    <div className="widget gif-studio" aria-label="Video to GIF Maker studio">
      {!file ? (
        <div
          className="dropzone"
          role="button"
          tabIndex={0}
          aria-label="Drop your video here or click to browse"
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
          <div className="dz-icon" aria-hidden="true">🎬</div>
          <div className="dz-title">Drop your video here</div>
          <div className="dz-sub">or click to browse — MP4, MOV, MKV, WebM, AVI and more</div>
          <input
            ref={inputRef}
            type="file"
            accept="video/*,.mkv,.avi,.mov,.flv,.wmv"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>
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

              <div className="gm-row">
                <label htmlFor="gm-len">
                  GIF length <span className="gm-val">{len.toFixed(1)}s</span>
                </label>
                <input
                  id="gm-len"
                  type="range"
                  min={1}
                  max={MAX_GIF_SECONDS}
                  step={0.5}
                  value={len}
                  onChange={(e) => onLenChange(Number(e.target.value))}
                />
                {cappedNote && (
                  <p className="gm-note">
                    Capped at {MAX_GIF_SECONDS} seconds — longer GIFs become enormous files nobody wants to load.
                  </p>
                )}
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

              <p className="gm-est">
                Rough size estimate: <strong>~{fmtSize(estBytes)}</strong>{' '}
                <span className="gm-est-sub">
                  ({width}×{estH}px · {fps} fps · {len.toFixed(1)}s · {quality})
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
          Private by design: your video is processed inside your browser and never uploaded anywhere.
          No watermark, ever.
        </span>
      </div>
    </div>
  );
}
