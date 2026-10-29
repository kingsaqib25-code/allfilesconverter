'use client';

import { useCallback, useRef, useState } from 'react';
import { getConverter, type ConverterEntry } from '@/lib/converters/registry';

interface Props {
  entryId: string;
}

interface OutFile {
  blob: Blob;
  filename: string;
  label?: string;
  url: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const MULTI_IDS = new Set(['jpg-to-pdf', 'png-to-pdf', 'merge-pdf']);

export default function PdfWidget({ entryId }: Props) {
  const entry = getConverter(entryId) as ConverterEntry;
  const multi = MULTI_IDS.has(entry.id);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [working, setWorking] = useState(false);
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<OutFile[]>([]);
  const [range, setRange] = useState('');
  const [compressLevel, setCompressLevel] = useState<'high' | 'medium' | 'low'>('medium');
  const [quality, setQuality] = useState(92);
  const inputRef = useRef<HTMLInputElement>(null);

  const clearOutputs = useCallback(() => {
    setOutputs((os) => {
      os.forEach((o) => {
        try {
          URL.revokeObjectURL(o.url);
        } catch {
          /* ignore */
        }
      });
      return [];
    });
  }, []);

  const pickFiles = useCallback(
    (list: FileList | null) => {
      setError(null);
      clearOutputs();
      if (!list) return;
      const picked = [...list].filter((f) => {
        const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
        return entry.fromExts.includes(ext);
      });
      if (picked.length === 0) {
        setError(
          `Those files don't look like ${entry.from} (${entry.fromExts.map((e) => '.' + e).join(', ')}). Please pick the right files.`
        );
        return;
      }
      setFiles((prev) => (multi ? [...prev, ...picked] : picked.slice(0, 1)));
    },
    [entry, multi]
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
    clearOutputs();
    setRange('');
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const run = useCallback(async () => {
    if (files.length === 0 || working) return;
    setWorking(true);
    setError(null);
    clearOutputs();
    if (entry.loadingNote) setLoadNote(entry.loadingNote);
    try {
      const mod = await import('@/lib/converters/pdf');
      setLoadNote(null);
      const outs: { blob: Blob; filename: string; label?: string }[] = [];
      switch (entry.id) {
        case 'pdf-to-jpg': {
          const pages = await mod.pdfToImages(files[0], 'jpeg');
          pages.forEach((p) => outs.push({ blob: p.blob, filename: p.filename, label: `Page ${p.pageNumber}` }));
          break;
        }
        case 'pdf-to-png': {
          const pages = await mod.pdfToImages(files[0], 'png');
          pages.forEach((p) => outs.push({ blob: p.blob, filename: p.filename, label: `Page ${p.pageNumber}` }));
          break;
        }
        case 'jpg-to-pdf':
        case 'png-to-pdf': {
          const r = await mod.imagesToPdf(files, { quality });
          outs.push({ blob: r.blob, filename: r.filename });
          break;
        }
        case 'merge-pdf': {
          const r = await mod.mergePdfs(files);
          outs.push({ blob: r.blob, filename: r.filename });
          break;
        }
        case 'split-pdf': {
          const r = await mod.splitPdf(files[0], range);
          outs.push({ blob: r.blob, filename: r.filename });
          break;
        }
        case 'compress-pdf': {
          const r = await mod.compressPdf(files[0], compressLevel);
          outs.push({ blob: r.blob, filename: r.filename });
          break;
        }
        case 'pdf-to-text': {
          const r = await mod.pdfToText(files[0]);
          outs.push({ blob: r.blob, filename: r.filename });
          break;
        }
        case 'pdf-to-word': {
          const r = await mod.pdfToWord(files[0]);
          outs.push({ blob: r.blob, filename: r.filename });
          break;
        }
        default:
          throw new Error('This PDF tool is not wired up yet.');
      }
      setOutputs(outs.map((o) => ({ ...o, url: URL.createObjectURL(o.blob) })));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Something went wrong. Please try again with another file.'
      );
    } finally {
      setLoadNote(null);
      setWorking(false);
    }
  }, [files, working, entry, range, compressLevel, quality, clearOutputs]);

  const downloadZip = useCallback(async () => {
    if (outputs.length === 0) return;
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const o of outputs) zip.file(o.filename, o.blob);
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${entry.id}-pages.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      setError('Could not build the ZIP file. Please download pages individually.');
    }
  }, [outputs, entry.id]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pickFiles(e.dataTransfer.files);
  };

  const showRange = entry.id === 'split-pdf';
  const showCompress = entry.id === 'compress-pdf';
  const showQuality = entry.id === 'jpg-to-pdf' || entry.id === 'png-to-pdf';
  const showReorder = entry.id === 'merge-pdf';

  return (
    <div className="widget" aria-label={`${entry.title} tool`}>
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={`Drop your ${entry.from} file(s) here or click to browse`}
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
        <div className="dz-title">Drop your {entry.from} file{multi ? 's' : ''} here</div>
        <div className="dz-sub">
          or click to browse — accepts {entry.fromExts.map((e) => '.' + e).join(', ')}
          {multi ? ' (you can add several)' : ''}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple={multi}
          accept={entry.fromExts.map((e) => '.' + e).join(',')}
          onChange={(e) => pickFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <div className="file-list" aria-label="Selected files">
          {files.map((f, i) => (
            <div className="file-row" key={`${f.name}-${i}`}>
              <span aria-hidden="true">{entry.from === 'PDF' ? '📕' : '🖼️'}</span>
              <span className="fname">{f.name}</span>
              <span className="fsize">{formatSize(f.size)}</span>
              {showReorder && (
                <>
                  <button className="mini-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                  <button className="mini-btn" onClick={() => move(i, 1)} disabled={i === files.length - 1} aria-label="Move down">↓</button>
                  <button className="mini-btn" onClick={() => removeAt(i)} aria-label="Remove">✕</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {showRange && files.length > 0 && (
        <label className="opt-row">
          <span className="opt-label">Pages to extract <span className="opt-hint">(e.g. 1-3, 5)</span></span>
          <input
            type="text"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            placeholder="1-3, 5"
            aria-label="Page range"
            style={{ maxWidth: '12rem' }}
          />
        </label>
      )}

      {showCompress && (
        <label className="opt-row">
          <span className="opt-label">Compression</span>
          <select
            value={compressLevel}
            onChange={(e) => setCompressLevel(e.target.value as 'high' | 'medium' | 'low')}
            aria-label="Compression level"
          >
            <option value="high">High quality (larger file)</option>
            <option value="medium">Balanced</option>
            <option value="low">Smallest file</option>
          </select>
        </label>
      )}

      {showQuality && (
        <label className="opt-row">
          <span className="opt-label">
            Quality: <strong>{quality}</strong> <span className="opt-hint">(Lower = smaller PDF)</span>
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

      {working ? (
        <div role="status" aria-label={loadNote ?? 'Converting…'}>
          {loadNote ? <div className="load-note">{loadNote}</div> : null}
          <div className="progress"><div /></div>
        </div>
      ) : null}

      {outputs.length > 0 && (
        <div className="alert ok">
          Done! {outputs.length === 1 ? 'Your file is ready.' : `${outputs.length} files ready.`}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {outputs.length === 0 ? (
          <button className="btn" onClick={run} disabled={working || files.length === 0}>
            {working ? 'Working…' : `${entry.title} →`}
          </button>
        ) : (
          <>
            {outputs.slice(0, 12).map((o, i) => (
              <a key={i} className="btn secondary" href={o.url} download={o.filename}>
                ⬇ {o.label ?? o.filename}
              </a>
            ))}
            {outputs.length > 1 && (
              <button className="btn" onClick={downloadZip}>
                ⬇ Download all as ZIP
              </button>
            )}
          </>
        )}
        <button className="btn secondary" onClick={reset}>
          {outputs.length > 0 ? 'Start over' : 'Clear'}
        </button>
      </div>
      {outputs.length > 12 && (
        <p className="opt-hint">Showing first 12 pages — use “Download all as ZIP” for the rest.</p>
      )}

      {error && (
        <div className="alert err" role="alert">
          {error}
        </div>
      )}
      <div className="privacy-note">
        <span aria-hidden="true">🔒</span>
        <span>
          Private by design: this file is converted inside your browser and never uploaded anywhere.
        </span>
      </div>
    </div>
  );
}
