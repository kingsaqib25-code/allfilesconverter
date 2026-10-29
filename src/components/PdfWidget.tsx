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

const MULTI_IDS = new Set(['jpg-to-pdf', 'png-to-pdf', 'webp-to-pdf', 'gif-to-pdf', 'bmp-to-pdf', 'heic-to-pdf', 'merge-pdf', 'compress-pdf']);

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
  // Second-wave PDF tools (competitor-gap round).
  const [angle, setAngle] = useState<'90' | '180' | '270'>('90');
  const [wmText, setWmText] = useState('');
  const [wmOpacity, setWmOpacity] = useState(25);
  const [wmSize, setWmSize] = useState<'32' | '48' | '72'>('48');
  const [pnPosition, setPnPosition] = useState('bottom-center');
  const [password, setPassword] = useState('');
  const [redactWords, setRedactWords] = useState('');
  const [cropMargin, setCropMargin] = useState(10);
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
    [entry, multi, clearOutputs]
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
  }, [clearOutputs]);

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
        case 'png-to-pdf':
        case 'webp-to-pdf':
        case 'gif-to-pdf':
        case 'bmp-to-pdf':
        case 'heic-to-pdf': {
          const r = await mod.imagesToPdf(files, { quality });
          outs.push({ blob: r.blob, filename: r.filename });
          break;
        }
        case 'txt-to-pdf': {
          const r = await mod.textToPdf(files[0]);
          outs.push({ blob: r.blob, filename: r.filename });
          break;
        }
        case 'md-to-pdf': {
          const r = await mod.markdownToPdf(files[0]);
          outs.push({ blob: r.blob, filename: r.filename });
          break;
        }
        case 'csv-to-pdf': {
          const r = await mod.csvToPdf(files[0]);
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
          for (const f of files) {
            const r = await mod.compressPdf(f, compressLevel);
            outs.push({ blob: r.blob, filename: r.filename, label: r.filename });
          }
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
        case 'rotate-pdf': {
          const tools = await import('@/lib/converters/pdf-tools');
          const r = await tools.rotatePdf(files[0], parseInt(angle, 10) as 90 | 180 | 270, range);
          outs.push({ blob: r.blob, filename: r.filename });
          break;
        }
        case 'watermark-pdf': {
          if (!wmText.trim()) throw new Error('Type the watermark text first.');
          const tools = await import('@/lib/converters/pdf-tools');
          const r = await tools.watermarkPdf(files[0], wmText, wmOpacity / 100, parseInt(wmSize, 10));
          outs.push({ blob: r.blob, filename: r.filename });
          break;
        }
        case 'page-numbers-pdf': {
          const tools = await import('@/lib/converters/pdf-tools');
          const r = await tools.addPageNumbers(
            files[0],
            pnPosition as 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right'
          );
          outs.push({ blob: r.blob, filename: r.filename });
          break;
        }
        case 'unlock-pdf': {
          const tools = await import('@/lib/converters/pdf-tools');
          const r = await tools.unlockPdf(files[0], password);
          outs.push({ blob: r.blob, filename: r.filename });
          break;
        }
        case 'extract-images-pdf': {
          const tools = await import('@/lib/converters/pdf-tools');
          const imgs = await tools.extractImagesFromPdf(files[0]);
          imgs.forEach((im) => outs.push({ blob: im.blob, filename: im.filename }));
          break;
        }
        case 'redact-pdf': {
          const words = redactWords
            .split(/[\n,]+/)
            .map((w) => w.trim())
            .filter((w) => w.length > 0);
          if (words.length === 0) throw new Error('Type at least one word or phrase to redact.');
          const tools = await import('@/lib/converters/pdf-tools');
          const r = await tools.redactPdf(files[0], words);
          outs.push({ blob: r.blob, filename: r.filename });
          break;
        }
        case 'delete-pages-pdf': {
          if (!range.trim()) throw new Error('Tell us which pages to delete, e.g. "1-3, 5".');
          const tools = await import('@/lib/converters/pdf-tools');
          const r = await tools.deletePagesFromPdf(files[0], range);
          outs.push({ blob: r.blob, filename: r.filename });
          break;
        }
        case 'crop-pdf': {
          const tools = await import('@/lib/converters/pdf-tools');
          const r = await tools.cropPdf(files[0], cropMargin);
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
  }, [files, working, entry, range, compressLevel, quality, clearOutputs, angle, wmText, wmOpacity, wmSize, pnPosition, password, redactWords, cropMargin]);

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
  const showQuality =
    entry.id === 'jpg-to-pdf' ||
    entry.id === 'png-to-pdf' ||
    entry.id === 'webp-to-pdf' ||
    entry.id === 'gif-to-pdf' ||
    entry.id === 'bmp-to-pdf' ||
    entry.id === 'heic-to-pdf';
  const showReorder = entry.id === 'merge-pdf';
  const showRotate = entry.id === 'rotate-pdf';
  const showWatermark = entry.id === 'watermark-pdf';
  const showPageNumbers = entry.id === 'page-numbers-pdf';
  const showUnlock = entry.id === 'unlock-pdf';
  const showRedact = entry.id === 'redact-pdf';
  const showDeleteRange = entry.id === 'delete-pages-pdf';
  const showCrop = entry.id === 'crop-pdf';
  const hasOptions =
    showRange ||
    showCompress ||
    showQuality ||
    showRotate ||
    showWatermark ||
    showPageNumbers ||
    showUnlock ||
    showRedact ||
    showDeleteRange ||
    showCrop;
  const showSidebar = hasOptions && outputs.length === 0;

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
        {showSidebar && (
          <aside className="tool-side" aria-label="Options">
            <h2 className="tool-side-title">Options</h2>
            {showRange && (
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
            {showRotate && (
              <>
                <label className="opt-row">
                  <span className="opt-label">Rotation</span>
                  <select
                    value={angle}
                    onChange={(e) => setAngle(e.target.value as '90' | '180' | '270')}
                    aria-label="Rotation angle"
                  >
                    <option value="90">90° clockwise</option>
                    <option value="180">180° (upside down)</option>
                    <option value="270">90° counter-clockwise</option>
                  </select>
                </label>
                <label className="opt-row">
                  <span className="opt-label">
                    Pages <span className="opt-hint">(blank = all pages, e.g. 1-3, 5)</span>
                  </span>
                  <input
                    type="text"
                    value={range}
                    onChange={(e) => setRange(e.target.value)}
                    placeholder="all pages"
                    aria-label="Pages to rotate"
                    style={{ maxWidth: '12rem' }}
                  />
                </label>
              </>
            )}
            {showWatermark && (
              <>
                <label className="opt-row">
                  <span className="opt-label">Watermark text</span>
                  <input
                    type="text"
                    value={wmText}
                    onChange={(e) => setWmText(e.target.value)}
                    placeholder="e.g. DRAFT, CONFIDENTIAL"
                    aria-label="Watermark text"
                    style={{ maxWidth: '12rem' }}
                  />
                </label>
                <label className="opt-row">
                  <span className="opt-label">Text size</span>
                  <select
                    value={wmSize}
                    onChange={(e) => setWmSize(e.target.value as '32' | '48' | '72')}
                    aria-label="Watermark text size"
                  >
                    <option value="32">Small</option>
                    <option value="48">Medium</option>
                    <option value="72">Large</option>
                  </select>
                </label>
                <label className="opt-row">
                  <span className="opt-label">
                    Opacity: <strong>{wmOpacity}%</strong>
                  </span>
                  <input
                    type="range"
                    min={5}
                    max={90}
                    value={wmOpacity}
                    onChange={(e) => setWmOpacity(Number(e.target.value))}
                    aria-label="Watermark opacity"
                  />
                </label>
              </>
            )}
            {showPageNumbers && (
              <label className="opt-row">
                <span className="opt-label">Position</span>
                <select
                  value={pnPosition}
                  onChange={(e) => setPnPosition(e.target.value)}
                  aria-label="Page number position"
                >
                  <option value="bottom-center">Bottom center</option>
                  <option value="bottom-right">Bottom right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="top-center">Top center</option>
                  <option value="top-right">Top right</option>
                </select>
              </label>
            )}
            {showUnlock && (
              <>
                <label className="opt-row">
                  <span className="opt-label">PDF password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter the PDF password"
                    aria-label="PDF password"
                    autoComplete="off"
                    style={{ maxWidth: '12rem' }}
                  />
                </label>
                <p className="opt-hint">
                  Your password is used once, inside your browser, and never stored or sent
                  anywhere. Note: the unlocked PDF is rebuilt from page images, so text is no
                  longer selectable.
                </p>
              </>
            )}
            {showRedact && (
              <>
                <label className="opt-row">
                  <span className="opt-label">
                    Words/phrases to black out{' '}
                    <span className="opt-hint">(comma or line separated)</span>
                  </span>
                  <textarea
                    value={redactWords}
                    onChange={(e) => setRedactWords(e.target.value)}
                    placeholder={'secret-project\n123-45-6789'}
                    aria-label="Words to redact"
                    rows={3}
                    style={{ maxWidth: '12rem' }}
                  />
                </label>
                <p className="opt-hint">
                  Visual redaction: matches are covered with black boxes. The underlying text
                  data stays in the file — for legally watertight redaction, use desktop
                  software.
                </p>
              </>
            )}
            {showDeleteRange && (
              <label className="opt-row">
                <span className="opt-label">
                  Pages to delete <span className="opt-hint">(e.g. 1-3, 5)</span>
                </span>
                <input
                  type="text"
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                  placeholder="1-3, 5"
                  aria-label="Pages to delete"
                  style={{ maxWidth: '12rem' }}
                />
              </label>
            )}
            {showCrop && (
              <label className="opt-row">
                <span className="opt-label">
                  Margin to trim: <strong>{cropMargin}%</strong>{' '}
                  <span className="opt-hint">(all four sides)</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={40}
                  value={cropMargin}
                  onChange={(e) => setCropMargin(Number(e.target.value))}
                  aria-label="Crop margin percent"
                />
              </label>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
