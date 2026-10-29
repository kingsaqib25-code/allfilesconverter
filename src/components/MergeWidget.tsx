'use client';

import { useCallback, useRef, useState } from 'react';
import { getConverter, type ConverterEntry } from '@/lib/converters/registry';
import type { MergeImageLayout } from '@/lib/converters/pdf';

interface Props {
  entryId: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const LAYOUTS: { value: MergeImageLayout; label: string }[] = [
  { value: 'grid2', label: 'Grid 2×2' },
  { value: 'grid3', label: 'Grid 3×3' },
  { value: 'horizontal', label: 'Horizontal strip' },
  { value: 'vertical', label: 'Vertical strip' },
];

export default function MergeWidget({ entryId }: Props) {
  const entry = getConverter(entryId) as ConverterEntry;
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [working, setWorking] = useState(false);
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  const [doneName, setDoneName] = useState('');
  const [doneSize, setDoneSize] = useState('');
  // Merge options
  const [layout, setLayout] = useState<MergeImageLayout>('grid2');
  const [perPage, setPerPage] = useState<'1' | '2' | '4'>('1');
  const [quality, setQuality] = useState(92);
  const [crf, setCrf] = useState('23');
  const [bitrate, setBitrate] = useState('192k');
  const inputRef = useRef<HTMLInputElement>(null);

  const isImageMerge = entry.id.startsWith('merge-images');
  const isPdfOut = entry.id === 'merge-images-pdf';
  const isVideo = entry.id === 'merge-videos';

  const pickFiles = useCallback(
    (list: FileList | null) => {
      setError(null);
      setDoneUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      if (!list) return;
      const picked = [...list].filter((f) => {
        const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
        return entry.fromExts.includes(ext);
      });
      if (picked.length === 0) {
        setError(
          `Those files don't look right — this tool merges ${entry.fromExts.map((e) => '.' + e).join(', ')} files.`
        );
        return;
      }
      setFiles((prev) => [...prev, ...picked].slice(0, 20));
    },
    [entry]
  );

  const move = (i: number, dir: -1 | 1) => {
    setFiles((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const removeAt = (i: number) => setFiles((prev) => prev.filter((_, k) => k !== i));

  const reset = useCallback(() => {
    setFiles([]);
    setError(null);
    setDoneUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const run = useCallback(async () => {
    if (files.length < 2 || working) return;
    setWorking(true);
    setError(null);
    if (entry.loadingNote) setLoadNote(entry.loadingNote);
    try {
      let blob: Blob;
      let filename: string;
      if (isImageMerge) {
        const mod = await import('@/lib/converters/pdf');
        setLoadNote(null);
        if (isPdfOut) {
          const r = await mod.mergeImagesToPdf(files, Number(perPage) as 1 | 2 | 4, quality / 100);
          blob = r.blob;
          filename = r.filename;
        } else {
          const fmt = entry.toExt === 'png' ? 'png' : 'jpeg';
          const r = await mod.mergeImages(files, layout, fmt, quality / 100);
          blob = r.blob;
          filename = r.filename;
        }
      } else {
        const mod = await import('@/lib/converters/video');
        setLoadNote(null);
        const r = await mod.concatMedia(
          files,
          entry.toExt,
          isVideo ? 'video/mp4' : 'audio/mpeg',
          isVideo ? 'video' : 'audio',
          isVideo ? { crf } : { bitrate }
        );
        blob = r.blob;
        filename = r.filename;
      }
      const url = URL.createObjectURL(blob);
      setDoneUrl(url);
      setDoneName(filename);
      setDoneSize(formatSize(blob.size));
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'Something went wrong. Please try again.';
      setError(msg);
    } finally {
      setLoadNote(null);
      setWorking(false);
    }
  }, [files, working, entry, isImageMerge, isPdfOut, isVideo, layout, perPage, quality, crf, bitrate]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pickFiles(e.dataTransfer.files);
  };

  const showSidebar = !doneUrl;

  return (
    <div className="widget widget-wide" aria-label={`${entry.title} tool`}>
      <div className={`tool-grid${showSidebar ? ' has-side' : ''}`}>
        <div className="tool-main">
          <div
            className={`dropzone${dragging ? ' dragging' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`Drop your ${entry.from.toLowerCase()} files here or click to browse`}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <div className="dz-icon" aria-hidden="true">📚</div>
            <div className="dz-title">Drop your files here (2 or more)</div>
            <div className="dz-sub">
              or click to browse — accepts {entry.fromExts.map((e) => '.' + e).join(', ')}
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={entry.fromExts.map((e) => '.' + e).join(',')}
              onChange={(e) => pickFiles(e.target.files)}
            />
          </div>

          {files.length > 0 && (
            <div className="file-list" aria-label="Files to merge, in order">
              {files.map((f, i) => (
                <div className="file-row" key={`${f.name}-${i}`}>
                  <span className="forder" aria-hidden="true">{i + 1}</span>
                  <span className="fname">{f.name}</span>
                  <span className="fsize">{formatSize(f.size)}</span>
                  <button className="mini-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                  <button className="mini-btn" onClick={() => move(i, 1)} disabled={i === files.length - 1} aria-label="Move down">↓</button>
                  <button className="mini-btn" onClick={() => removeAt(i)} aria-label="Remove">✕</button>
                </div>
              ))}
            </div>
          )}

          {working ? (
            <div role="status" aria-label={loadNote ?? 'Merging…'}>
              {loadNote ? <div className="load-note">{loadNote}</div> : null}
              <div className="progress"><div /></div>
            </div>
          ) : null}

          {doneUrl && (
            <div className="alert ok">Done! Your merged file is ready ({doneSize}).</div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {!doneUrl ? (
              <button className="btn" onClick={run} disabled={working || files.length < 2}>
                {working ? 'Merging…' : `Merge ${files.length > 0 ? `${files.length} files` : ''} →`}
              </button>
            ) : (
              <a className="btn" href={doneUrl} download={doneName}>
                ⬇ Download {doneName}
              </a>
            )}
            <button className="btn secondary" onClick={reset}>
              {doneUrl ? 'Merge more' : 'Clear'}
            </button>
          </div>

          {error && (
            <div className="alert err" role="alert">
              {error}
            </div>
          )}
          <div className="privacy-note">
            <span aria-hidden="true">🔒</span>
            <span>
              Private by design: your files are merged inside your browser and never uploaded anywhere.
            </span>
          </div>
        </div>
        {showSidebar && (
          <aside className="tool-side" aria-label="Options">
            <h2 className="tool-side-title">Options</h2>
            {isImageMerge && !isPdfOut && (
              <label className="opt-row">
                <span className="opt-label">Layout</span>
                <select value={layout} onChange={(e) => setLayout(e.target.value as MergeImageLayout)} aria-label="Layout">
                  {LAYOUTS.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </label>
            )}
            {isPdfOut && (
              <label className="opt-row">
                <span className="opt-label">Images per page</span>
                <select value={perPage} onChange={(e) => setPerPage(e.target.value as '1' | '2' | '4')} aria-label="Images per page">
                  <option value="1">1 per page</option>
                  <option value="2">2 per page</option>
                  <option value="4">4 per page</option>
                </select>
              </label>
            )}
            {(isImageMerge || isPdfOut) && entry.toExt !== 'png' && (
              <label className="opt-row">
                <span className="opt-label">
                  Quality: <strong>{quality}</strong> <span className="opt-hint">(Lower = smaller file)</span>
                </span>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                  aria-label="Quality"
                />
              </label>
            )}
            {isVideo && (
              <label className="opt-row">
                <span className="opt-label">Quality</span>
                <select value={crf} onChange={(e) => setCrf(e.target.value)} aria-label="Quality">
                  <option value="18">High quality (larger file)</option>
                  <option value="23">Balanced</option>
                  <option value="28">Small file</option>
                </select>
              </label>
            )}
            {!isVideo && !isImageMerge && (
              <label className="opt-row">
                <span className="opt-label">Bitrate</span>
                <select value={bitrate} onChange={(e) => setBitrate(e.target.value)} aria-label="Bitrate">
                  <option value="128k">128 kbps — smaller file</option>
                  <option value="192k">192 kbps — balanced</option>
                  <option value="320k">320 kbps — best quality</option>
                </select>
              </label>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
