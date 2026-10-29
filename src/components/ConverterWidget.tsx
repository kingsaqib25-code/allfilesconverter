'use client';

import { useCallback, useRef, useState } from 'react';
import {
  getConverter,
  type ConverterEntry,
  type ConvertOptions,
  type OptionDef,
} from '@/lib/converters/registry';

interface Props {
  entryId: string;
  compact?: boolean;
}

type ItemStatus = 'pending' | 'working' | 'done' | 'error';

interface BatchItem {
  file: File;
  status: ItemStatus;
  url: string | null;
  outName: string;
  outSize: string;
  error: string | null;
}

/** Guard: browsers run out of memory on huge batches — 20 files per batch. */
const MAX_BATCH = 20;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ConverterWidget({ entryId }: Props) {
  const entry = getConverter(entryId) as ConverterEntry;
  const [items, setItems] = useState<BatchItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [working, setWorking] = useState(false);
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Per-converter option controls (quality slider, bitrate, …) — forwarded to
  // convert() for EVERY file in the batch.
  const [optValues, setOptValues] = useState<ConvertOptions>(() => {
    const init: ConvertOptions = {};
    for (const o of entry.options ?? []) init[o.id] = o.default;
    return init;
  });

  const renderOption = (opt: OptionDef) => {
    const val = optValues[opt.id] ?? opt.default;
    if (opt.type === 'number') {
      return (
        <label key={opt.id} className="opt-row">
          <span className="opt-label">
            {opt.label}
            {opt.hint ? <span className="opt-hint"> ({opt.hint})</span> : null}
          </span>
          <input
            type="number"
            min={opt.min ?? 1}
            max={opt.max ?? 100000}
            step={opt.step ?? 1}
            value={Number(val)}
            onChange={(e) =>
              setOptValues((v) => ({ ...v, [opt.id]: Number(e.target.value) }))
            }
            aria-label={opt.label}
            style={{ maxWidth: '8rem' }}
          />
        </label>
      );
    }
    if (opt.type === 'slider') {
      return (
        <label key={opt.id} className="opt-row">
          <span className="opt-label">
            {opt.label}: <strong>{val}</strong>
            {opt.hint ? <span className="opt-hint"> ({opt.hint})</span> : null}
          </span>
          <input
            type="range"
            min={opt.min ?? 1}
            max={opt.max ?? 100}
            step={opt.step ?? 1}
            value={Number(val)}
            onChange={(e) =>
              setOptValues((v) => ({ ...v, [opt.id]: Number(e.target.value) }))
            }
            aria-label={opt.label}
          />
        </label>
      );
    }
    return (
      <label key={opt.id} className="opt-row">
        <span className="opt-label">{opt.label}</span>
        <select
          value={String(val)}
          onChange={(e) => setOptValues((v) => ({ ...v, [opt.id]: e.target.value }))}
          aria-label={opt.label}
        >
          {(opt.choices ?? []).map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
    );
  };

  const pickFiles = useCallback(
    (list: FileList | ArrayLike<File> | null) => {
      setError(null);
      if (!list) return;
      const picked = [...Array.from(list as unknown as File[])];
      const valid: File[] = [];
      const bad: string[] = [];
      for (const f of picked) {
        const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
        if (entry.fromExts.includes(ext)) valid.push(f);
        else bad.push(f.name);
      }
      if (bad.length > 0) {
        setError(
          `Skipped ${bad.length} file${bad.length > 1 ? 's' : ''} — this tool converts ${entry.from} (${entry.fromExts
            .map((e) => '.' + e)
            .join(', ')}) to ${entry.to}: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? '…' : ''}`
        );
      }
      if (valid.length === 0) return;
      setItems((prev) => {
        const next = [
          ...prev,
          ...valid.map(
            (file): BatchItem => ({
              file,
              status: 'pending',
              url: null,
              outName: '',
              outSize: '',
              error: null,
            })
          ),
        ];
        if (next.length > MAX_BATCH) {
          setError(
            `Kept the first ${MAX_BATCH} files — browsers run out of memory on bigger batches. Convert the rest in a second batch.`
          );
          return next.slice(0, MAX_BATCH);
        }
        return next;
      });
    },
    [entry]
  );

  const removeAt = useCallback((i: number) => {
    setItems((prev) => {
      const it = prev[i];
      if (it?.url) {
        try {
          URL.revokeObjectURL(it.url);
        } catch {
          /* ignore */
        }
      }
      return prev.filter((_, k) => k !== i);
    });
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      pickFiles(e.dataTransfer.files);
    },
    [pickFiles]
  );

  const convertAll = useCallback(async () => {
    if (items.length === 0 || working) return;
    if (!entry.convert) {
      setError('This converter needs its dedicated tool interface.');
      return;
    }
    setWorking(true);
    setError(null);
    // Heavy engines (ffmpeg.wasm) report their load state so the UI can show
    // "Preparing converter…" instead of a generic spinner. The module is
    // dynamically imported here so it never lands in the main bundle.
    let unsub: (() => void) | undefined;
    try {
      if (entry.loadingNote) {
        const mod = await import('@/lib/converters/video');
        unsub = mod.onFfmpegLoadState((s) =>
          setLoadNote(s === 'loading' ? entry.loadingNote ?? null : null)
        );
      }
      // Sequential: ffmpeg.wasm is a single instance, and sequential keeps
      // memory predictable for image batches too.
      for (let i = 0; i < items.length; i++) {
        if (items[i].status === 'done') continue;
        setItems((prev) =>
          prev.map((it, k) => (k === i ? { ...it, status: 'working' as const, error: null } : it))
        );
        try {
          const { blob, filename } = await entry.convert!(items[i].file, optValues);
          const url = URL.createObjectURL(blob);
          setItems((prev) =>
            prev.map((it, k) =>
              k === i
                ? { ...it, status: 'done' as const, url, outName: filename, outSize: formatSize(blob.size) }
                : it
            )
          );
        } catch (e) {
          const msg =
            e instanceof Error ? e.message : 'Conversion failed. Try another file.';
          setItems((prev) =>
            prev.map((it, k) => (k === i ? { ...it, status: 'error' as const, error: msg } : it))
          );
        }
      }
    } finally {
      unsub?.();
      setLoadNote(null);
      setWorking(false);
    }
  }, [items, working, entry, optValues]);

  const downloadZip = useCallback(async () => {
    const done = items.filter((it) => it.status === 'done' && it.url);
    if (done.length === 0) return;
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const seen = new Set<string>();
      for (const it of done) {
        const res = await fetch(it.url!);
        const blob = await res.blob();
        let name = it.outName || 'converted';
        let n = 1;
        while (seen.has(name)) {
          n += 1;
          const dot = it.outName.lastIndexOf('.');
          name = dot > 0 ? `${it.outName.slice(0, dot)}-${n}${it.outName.slice(dot)}` : `${it.outName}-${n}`;
        }
        seen.add(name);
        zip.file(name, blob);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${entry.id}-converted.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      setError('Could not build the ZIP file. Please download files individually.');
    }
  }, [items, entry.id]);

  const reset = useCallback(() => {
    setItems((prev) => {
      prev.forEach((it) => {
        if (it.url) {
          try {
            URL.revokeObjectURL(it.url);
          } catch {
            /* ignore */
          }
        }
      });
      return [];
    });
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const hasOptions = (entry.options?.length ?? 0) > 0;
  const doneCount = items.filter((it) => it.status === 'done').length;
  const pendingCount = items.filter((it) => it.status === 'pending' || it.status === 'error').length;
  const showSidebar = hasOptions && doneCount === 0;

  return (
    <div
      className={`widget${hasOptions ? ' widget-wide' : ''}`}
      aria-label={`${entry.title} tool`}
    >
      <div className={`tool-grid${showSidebar ? ' has-side' : ''}`}>
        <div className="tool-main">
          <div
            className={`dropzone${dragging ? ' dragging' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`Drop your ${entry.from} files here or click to browse`}
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
            <div className="dz-icon" aria-hidden="true">📁</div>
            <div className="dz-title">Drop your {entry.from} files here</div>
            <div className="dz-sub">
              or click to browse — accepts {entry.fromExts.map((e) => '.' + e).join(', ')} (up to {MAX_BATCH} at once)
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={entry.fromExts.map((e) => '.' + e).join(',')}
              onChange={(e) => pickFiles(e.target.files)}
            />
          </div>

          {items.length > 0 && (
            <div className="file-list" aria-label="Files to convert">
              {items.map((it, i) => (
                <div className="file-row batch-row" key={`${it.file.name}-${i}`}>
                  <span aria-hidden="true">📄</span>
                  <span className="batch-info">
                    <span className="fname">{it.file.name}</span>
                    <span className="fsize">
                      {formatSize(it.file.size)}
                      {it.status === 'done' ? ` → ${it.outSize}` : ''}
                    </span>
                    {it.status === 'working' && (
                      <span className="progress determinate batch-progress" aria-label="Converting…">
                        <div style={{ width: '60%' }} />
                      </span>
                    )}
                    {it.status === 'error' && it.error && (
                      <span className="batch-err" role="alert">{it.error}</span>
                    )}
                  </span>
                  <span className={`bstatus ${it.status}`}>
                    {it.status === 'pending' && 'Queued'}
                    {it.status === 'working' && 'Working…'}
                    {it.status === 'done' && 'Done ✓'}
                    {it.status === 'error' && 'Failed'}
                  </span>
                  {it.status === 'done' && it.url && (
                    <a className="mini-btn dl" href={it.url} download={it.outName} aria-label={`Download ${it.outName}`}>
                      ⬇
                    </a>
                  )}
                  {!working && (
                    <button className="mini-btn" onClick={() => removeAt(i)} aria-label={`Remove ${it.file.name}`}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {working && (
            <div role="status" aria-label={loadNote ?? 'Converting…'}>
              {loadNote ? <div className="load-note">{loadNote}</div> : null}
              <div className="progress determinate" aria-hidden="true">
                <div style={{ width: `${items.length ? Math.round((doneCount / items.length) * 100) : 0}%` }} />
              </div>
              <p className="opt-hint">
                Converting file {doneCount + 1} of {items.length}… (options apply to every file)
              </p>
            </div>
          )}

          {doneCount > 0 && !working && (
            <div className="alert ok">
              {doneCount} of {items.length} file{items.length > 1 ? 's' : ''} converted.
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {pendingCount > 0 && (
              <button className="btn" onClick={convertAll} disabled={working || items.length === 0}>
                {working ? 'Converting…' : `Convert ${items.length > 1 ? `all ${items.length} ` : ''}to ${entry.to} →`}
              </button>
            )}
            {doneCount > 1 && (
              <button className="btn" onClick={downloadZip}>
                ⬇ Download all as ZIP
              </button>
            )}
            {items.length > 0 && (
              <button className="btn secondary" onClick={reset} disabled={working}>
                {doneCount > 0 ? 'Start over' : 'Clear'}
              </button>
            )}
          </div>

          {error && (
            <div className="alert err" role="alert">
              {error}
            </div>
          )}
          <div className="privacy-note">
            <span aria-hidden="true">🔒</span>
            <span>
              Private by design: every file is converted inside your browser and never
              uploaded anywhere.
            </span>
          </div>
        </div>
        {showSidebar && (
          <aside className="tool-side" aria-label="Conversion options">
            <h2 className="tool-side-title">Options</h2>
            <p className="opt-hint">Applied to every file in the batch.</p>
            <div className="opt-block" aria-label="Conversion options">
              {(entry.options ?? []).map(renderOption)}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
