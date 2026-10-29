'use client';

/**
 * On-device PDF text editor ("Edit PDF") — flagship tool.
 *
 * Drop a PDF -> every text block (grouped from pdf.js text items) becomes
 * clickable -> edit in place -> download the PDF with surgical redraw
 * (pdf-lib), a rebuilt "clean" PDF, or a Word file. A "Text view" mode edits
 * a whole page as plain text. Nothing is ever uploaded.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorBlock, EditorPageData, FinalPage } from '@/lib/converters/pdf';

interface BlockState extends EditorBlock {
  editedText: string | null;
}

interface PageState extends EditorPageData {
  blocks: BlockState[];
  textOverride: string | null;
  thumb: string | null;
}

interface OutFile {
  blob: Blob;
  filename: string;
  label: string;
  url: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'document';
}

type Phase = 'idle' | 'loading' | 'ready';

export default function PdfEditor() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [pages, setPages] = useState<PageState[]>([]);
  const [sel, setSel] = useState(0);
  const [view, setView] = useState<'page' | 'text'>('page');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showOutlines, setShowOutlines] = useState(false);
  const [working, setWorking] = useState(false);
  const [workLabel, setWorkLabel] = useState('');
  const [outputs, setOutputs] = useState<OutFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  const [preview, setPreview] = useState<{
    bytes: ArrayBuffer;
    filename: string;
    total: number;
    rendered: number;
    pageUrls: string[];
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const srcRef = useRef<ArrayBuffer | null>(null);
  const previewToken = useRef(0);
  const tvPreviewRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<{ getPage: (n: number) => Promise<unknown>; destroy?: () => void } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thumbsDone = useRef(false);

  const page = pages[sel];
  const totalEdits = pages.reduce(
    (n, p) =>
      n +
      (p.textOverride != null ? 1 : 0) +
      p.blocks.filter((b) => b.editedText != null && b.editedText !== b.text).length,
    0
  );

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

  const resetAll = useCallback(() => {
    try {
      docRef.current?.destroy?.();
    } catch {
      /* ignore */
    }
    docRef.current = null;
    srcRef.current = null;
    thumbsDone.current = false;
    setPages([]);
    setSel(0);
    setView('page');
    setEditingId(null);
    setError(null);
    setFileLabel('');
    setPhase('idle');
    clearOutputs();
    if (inputRef.current) inputRef.current.value = '';
  }, [clearOutputs]);

  const loadFile = useCallback(
    async (file: File) => {
      resetAll();
      setPhase('loading');
      setError(null);
      try {
        const buf = await file.arrayBuffer();
        srcRef.current = buf;
        const pdfMod = await import('@/lib/converters/pdf');
        const extracted = await pdfMod.extractEditablePages(file);
        // Keep one pdf.js document for rendering pages/thumbnails.
        const lib = await import('pdfjs-dist');
        lib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
        const doc = await lib.getDocument({ data: buf.slice(0) }).promise;
        docRef.current = doc;
        setPages(
          extracted.map((p) => ({
            ...p,
            blocks: p.blocks.map((b) => ({ ...b, editedText: null })),
            textOverride: null,
            thumb: null,
          }))
        );
        setFileLabel(file.name);
        setFileSize(formatSize(file.size));
        setSel(0);
        setPhase('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not read that PDF. Please try another file.');
        setPhase('idle');
      }
    },
    [resetAll]
  );

  const pickFile = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const f = list[0];
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      if (ext !== 'pdf') {
        setError('That file is not a PDF. Please pick a .pdf file.');
        return;
      }
      void loadFile(f);
    },
    [loadFile]
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pickFile(e.dataTransfer.files);
  };

  // ---- render selected page canvas ----
  useEffect(() => {
    if (phase !== 'ready' || !page || !canvasRef.current || !docRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const pg = (await docRef.current!.getPage(page.pageNum)) as {
          getViewport: (o: { scale: number }) => { width: number; height: number };
          render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
          cleanup: () => void;
        };
        const vp = pg.getViewport({ scale: 2 });
        const canvas = canvasRef.current!;
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        const ctx = canvas.getContext('2d')!;
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
        pg.cleanup();
      } catch {
        if (!cancelled) setError('Could not render that page. Try another file.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, page, sel]);

  // ---- thumbnails (once) ----
  useEffect(() => {
    if (phase !== 'ready' || thumbsDone.current || !docRef.current || pages.length === 0) return;
    thumbsDone.current = true;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < pages.length; i++) {
        if (cancelled) break;
        try {
          const pg = (await docRef.current!.getPage(pages[i].pageNum)) as {
            getViewport: (o: { scale: number }) => { width: number; height: number };
            render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
            cleanup: () => void;
          };
          const v1 = pg.getViewport({ scale: 1 });
          const scale = 120 / v1.width;
          const vp = pg.getViewport({ scale });
          const c = document.createElement('canvas');
          c.width = Math.floor(vp.width);
          c.height = Math.floor(vp.height);
          await pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
          pg.cleanup();
          const url = c.toDataURL('image/jpeg', 0.55);
          if (!cancelled) {
            setPages((prev) => prev.map((p, k) => (k === i ? { ...p, thumb: url } : p)));
          }
        } catch {
          /* thumbnail failed — page still editable */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, pages.length]);

  // ---- text view draft follows selection ----
  useEffect(() => {
    if (!page) return;
    setTextDraft(page.textOverride ?? page.blocks.map((b) => b.text).join('\n\n'));
    setEditingId(null);
  }, [sel, page?.pageNum, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Live page preview in Text view: a cheap 2D-canvas sketch of what the
   * page will look like after applying the draft (approximate layout —
   * the Review step shows the exact output). Debounced while typing.
   */
  const drawTextPreview = useCallback(() => {
    const canvas = tvPreviewRef.current;
    if (!canvas || !page) return;
    const W = 240;
    const H = Math.max(80, Math.round((W * page.height) / page.width));
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#e3e3e3';
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    const blocks = page.blocks;
    if (!blocks.length) {
      ctx.fillStyle = '#999';
      ctx.font = '12px sans-serif';
      ctx.fillText('No text on this page', 16, 30);
      return;
    }
    const sx = W / page.width;
    const sy = H / page.height;
    const ux0 = Math.min(...blocks.map((b) => b.x));
    const ux1 = Math.max(...blocks.map((b) => b.x + b.width));
    const utop = Math.max(...blocks.map((b) => b.y + b.height));
    const ubot = Math.min(...blocks.map((b) => b.y));
    const size = Math.max(4, 11 * sx);
    ctx.font = `${size}px sans-serif`;
    ctx.fillStyle = '#3a3a3a';
    const maxW = Math.max(10, (ux1 - ux0) * sx);
    const lines: string[] = [];
    for (const para of textDraft.split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push('');
        continue;
      }
      let line = '';
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > maxW && line) {
          lines.push(line);
          line = w;
        } else {
          line = test;
        }
      }
      lines.push(line);
    }
    const lh = size * 1.4;
    let cy = utop * sy - size * 0.3;
    const floor = ubot * sy;
    for (const ln of lines) {
      if (cy < floor + 2) break;
      if (ln) ctx.fillText(ln, ux0 * sx, cy);
      cy -= lh;
    }
    ctx.strokeStyle = 'rgba(43,122,120,.45)';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(ux0 * sx, ubot * sy, (ux1 - ux0) * sx, (utop - ubot) * sy);
    ctx.setLineDash([]);
  }, [page, textDraft]);

  useEffect(() => {
    if (view !== 'text' || phase !== 'ready') return;
    const t = setTimeout(drawTextPreview, 500);
    return () => clearTimeout(t);
  }, [view, phase, drawTextPreview]);

  const saveBlockEdit = useCallback(
    (blockId: string, newText: string) => {
      setPages((prev) =>
        prev.map((p, i) =>
          i === sel
            ? {
                ...p,
                blocks: p.blocks.map((b) =>
                  b.id === blockId
                    ? { ...b, editedText: newText === b.text ? null : newText }
                    : b
                ),
              }
            : p
        )
      );
      setEditingId(null);
    },
    [sel]
  );

  const applyTextView = useCallback(() => {
    const original = page.blocks.map((b) => b.text).join('\n\n');
    setPages((prev) =>
      prev.map((p, i) =>
        i === sel ? { ...p, textOverride: textDraft === original ? null : textDraft } : p
      )
    );
  }, [sel, textDraft, page]);

  const discardTextView = useCallback(() => {
    setPages((prev) => prev.map((p, i) => (i === sel ? { ...p, textOverride: null } : p)));
  }, [sel]);

  const buildFinalPages = useCallback((): FinalPage[] => {
    return pages.map((p) => ({
      pageNum: p.pageNum,
      textOverride: p.textOverride,
      blocks: p.blocks.map((b) => ({
        ...b,
        text: b.editedText ?? b.text,
        edited: b.editedText != null && b.editedText !== b.text,
      })),
    }));
  }, [pages]);

  /**
   * Like buildFinalPages, but also folds in a not-yet-applied Text-view draft
   * for the selected page, so Preview/Downloads never miss fresh typing.
   */
  const getEffectiveFinalPages = useCallback((): FinalPage[] => {
    return pages.map((p, i) => {
      let override = p.textOverride;
      if (i === sel && view === 'text' && page) {
        const original = p.blocks.map((b) => b.text).join('\n\n');
        const pending = textDraft === original ? null : textDraft;
        if (pending !== override) {
          override = pending;
          // keep UI state consistent with what we are about to build
          setPages((prev) => prev.map((q, k) => (k === i ? { ...q, textOverride: pending } : q)));
        }
      }
      return {
        pageNum: p.pageNum,
        textOverride: override,
        blocks: p.blocks.map((b) => ({
          ...b,
          text: b.editedText ?? b.text,
          edited: b.editedText != null && b.editedText !== b.text,
        })),
      };
    });
  }, [pages, sel, view, textDraft, page]);

  const pushOutput = useCallback((blob: Blob, filename: string, label: string) => {
    const url = URL.createObjectURL(blob);
    setOutputs((os) => [...os.filter((o) => o.label !== label), { blob, filename, label, url }]);
  }, []);

  const downloadPdf = useCallback(async () => {
    if (!srcRef.current || working) return;
    setWorking(true);
    setWorkLabel('Building your edited PDF…');
    setError(null);
    try {
      const mod = await import('@/lib/converters/pdf');
      const r = await mod.renderEditedPdf(
        srcRef.current.slice(0),
        getEffectiveFinalPages(),
        `${baseName(fileLabel)}-edited.pdf`
      );
      pushOutput(r.blob, r.filename, 'PDF');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the PDF. Please try again.');
    } finally {
      setWorking(false);
    }
  }, [working, getEffectiveFinalPages, fileLabel, pushOutput]);

  const downloadClean = useCallback(async () => {
    if (working) return;
    setWorking(true);
    setWorkLabel('Building a clean PDF…');
    setError(null);
    try {
      const mod = await import('@/lib/converters/pdf');
      const r = await mod.renderCleanPdf(getEffectiveFinalPages(), `${baseName(fileLabel)}-clean.pdf`);
      pushOutput(r.blob, r.filename, 'Clean PDF');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the PDF. Please try again.');
    } finally {
      setWorking(false);
    }
  }, [working, getEffectiveFinalPages, fileLabel, pushOutput]);

  const downloadDocx = useCallback(async () => {
    if (working) return;
    setWorking(true);
    setWorkLabel('Building your Word file…');
    setError(null);
    try {
      const mod = await import('@/lib/converters/pdf');
      const r = await mod.renderEditedDocx(getEffectiveFinalPages(), `${baseName(fileLabel)}-edited.docx`);
      pushOutput(r.blob, r.filename, 'Word');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the Word file. Please try again.');
    } finally {
      setWorking(false);
    }
  }, [working, getEffectiveFinalPages, fileLabel, pushOutput]);

  const closePreview = useCallback(() => {
    previewToken.current += 1;
    setPreview((prev) => {
      // page preview images are data URLs — nothing to revoke
      return null;
    });
  }, []);

  /**
   * Review step: build the final PDF fully in-memory with the SAME pipeline
   * as download, then render THOSE bytes (not the original) in a modal so
   * the user sees exactly what they will download.
   */
  const openPreview = useCallback(async () => {
    if (!srcRef.current || working) return;
    setWorking(true);
    setWorkLabel('Building preview…');
    setError(null);
    const token = ++previewToken.current;
    try {
      const mod = await import('@/lib/converters/pdf');
      const r = await mod.renderEditedPdf(
        srcRef.current.slice(0),
        getEffectiveFinalPages(),
        `${baseName(fileLabel)}-edited.pdf`
      );
      if (token !== previewToken.current) return;
      const bytes = await r.blob.arrayBuffer();
      const lib = await import('pdfjs-dist');
      lib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      const doc = (await lib.getDocument({ data: bytes.slice(0) }).promise) as unknown as {
        numPages: number;
        getPage: (n: number) => Promise<{
          getViewport: (o: { scale: number }) => { width: number; height: number };
          render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
          cleanup: () => void;
        }>;
        destroy?: () => void;
      };
      const total = doc.numPages;
      setPreview({ bytes, filename: r.filename, total, rendered: 0, pageUrls: [] });
      setWorking(false);
      for (let i = 1; i <= total; i++) {
        if (token !== previewToken.current) break;
        const pg = await doc.getPage(i);
        const v1 = pg.getViewport({ scale: 1 });
        const vp = pg.getViewport({ scale: 560 / v1.width });
        const c = document.createElement('canvas');
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        await pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
        pg.cleanup();
        const url = c.toDataURL('image/jpeg', 0.72);
        if (token !== previewToken.current) break;
        setPreview((prev) => (prev ? { ...prev, rendered: i, pageUrls: [...prev.pageUrls, url] } : prev));
      }
      doc.destroy?.();
    } catch (e) {
      if (token !== previewToken.current) return;
      setError(e instanceof Error ? e.message : 'Could not build the preview. Please try again.');
      setWorking(false);
    }
  }, [working, getEffectiveFinalPages, fileLabel]);

  /** Download the exact bytes shown in the preview — no rebuild. */
  const downloadPreviewBytes = useCallback(() => {
    if (!preview) return;
    const blob = new Blob([preview.bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = preview.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [preview]);

  // Escape closes the preview modal.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePreview();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [preview, closePreview]);

  const locked = !!page?.textOverride;

  return (
    <div className="widget widget-wide" aria-label="Edit PDF tool">
      {phase !== 'ready' && (
        <div className="tool-main">
          <div
            className={`dropzone${dragging ? ' dragging' : ''}`}
            role="button"
            tabIndex={0}
            aria-label="Drop your PDF here or click to browse"
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
            <div className="dz-icon" aria-hidden="true">📕</div>
            <div className="dz-title">
              {phase === 'loading' ? 'Reading your PDF…' : 'Drop your PDF here'}
            </div>
            <div className="dz-sub">
              {phase === 'loading'
                ? 'Extracting editable text — one moment.'
                : 'or click to browse — accepts .pdf (up to 50 pages)'}
            </div>
            <input ref={inputRef} type="file" accept=".pdf" onChange={(e) => pickFile(e.target.files)} />
          </div>
          {phase === 'loading' && (
            <div className="progress" role="status" aria-label="Loading PDF">
              <div />
            </div>
          )}
          {error && (
            <div className="alert err" role="alert">
              {error}
            </div>
          )}
          <div className="privacy-note">
            <span aria-hidden="true">🔒</span>
            <span>
              Private by design: editing happens inside your browser — your PDF is never uploaded anywhere.
            </span>
          </div>
        </div>
      )}

      {phase === 'ready' && page && (
        <div className="edit-grid">
          {/* thumbnails */}
          <div className="edit-thumbs" aria-label="Pages">
            {pages.map((p, i) => (
              <button
                key={p.pageNum}
                type="button"
                className={`edit-thumb${i === sel ? ' active' : ''}`}
                onClick={() => setSel(i)}
                aria-label={`Page ${p.pageNum}`}
              >
                {p.thumb ? (
                  <img src={p.thumb} alt={`Page ${p.pageNum}`} />
                ) : (
                  <span className="edit-thumb-ph">{p.pageNum}</span>
                )}
                <span className="edit-thumb-n">
                  {p.pageNum}
                  {(p.textOverride != null ||
                    p.blocks.some((b) => b.editedText != null && b.editedText !== b.text)) && (
                    <span className="edit-dot" aria-label="edited"> ●</span>
                  )}
                </span>
              </button>
            ))}
          </div>

          {/* center: page canvas or text view */}
          <div className="tool-main">
            <div className="edit-bar">
              <strong>
                {fileLabel} <span className="opt-hint">({fileSize})</span>
              </strong>
              <span className="opt-hint">
                Page {page.pageNum} of {pages.length}
                {totalEdits > 0 && (
                  <>
                    {' '}· <span className="edit-count">{totalEdits} edit{totalEdits === 1 ? '' : 's'}</span>
                  </>
                )}
              </span>
            </div>

            {view === 'page' ? (
              <div className="edit-canvas-wrap">
                <canvas ref={canvasRef} className="edit-canvas" aria-label={`Page ${page.pageNum} preview`} />
                <div className="edit-overlay" aria-hidden={editingId != null}>
                  {page.blocks.map((b) => {
                    const isEditing = editingId === b.id;
                    const isEdited = b.editedText != null && b.editedText !== b.text;
                    const style = {
                      left: `${(b.x / page.width) * 100}%`,
                      top: `${((page.height - (b.y + b.height)) / page.height) * 100}%`,
                      width: `${(b.width / page.width) * 100}%`,
                      minHeight: `${((b.height * 1.3) / page.height) * 100}%`,
                    } as React.CSSProperties;
                    if (isEditing) {
                      return (
                        <div
                          key={b.id}
                          className="edit-block editing"
                          style={style}
                          contentEditable
                          suppressContentEditableWarning
                          spellCheck={false}
                          onBlur={(e) => {
                            if ((e.currentTarget as HTMLElement).dataset.cancel === '1') {
                              delete (e.currentTarget as HTMLElement).dataset.cancel;
                              setEditingId(null);
                              return;
                            }
                            saveBlockEdit(b.id, e.currentTarget.innerText.replace(/\n{3,}/g, '\n\n').trimEnd());
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              (e.currentTarget as HTMLElement).dataset.cancel = '1';
                              e.currentTarget.blur();
                            }
                            e.stopPropagation();
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {b.editedText ?? b.text}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={b.id}
                        className={`edit-block${isEdited ? ' edited' : ''}${showOutlines ? ' outlined' : ''}${locked ? ' locked' : ''}`}
                        style={style}
                        title={locked ? 'Page edited in Text view' : 'Click to edit'}
                        onClick={() => {
                          if (!locked) setEditingId(b.id);
                        }}
                      />
                    );
                  })}
                </div>
                {locked && (
                  <div className="alert ok" style={{ marginTop: '0.75rem' }}>
                    This page was edited in Text view — the original layout is shown above.{' '}
                    <button type="button" className="mini-btn" onClick={discardTextView}>
                      Discard text-view edits
                    </button>
                  </div>
                )}
                {!locked && (
                  <p className="opt-hint" style={{ marginTop: '0.5rem' }}>
                    Click any text on the page to edit it in place. Edited blocks are highlighted.
                  </p>
                )}
              </div>
            ) : (
              <div className="edit-textview">
                <label className="opt-label" htmlFor="edit-textarea">
                  Page {page.pageNum} — full text in reading order
                </label>
                <div className="tv-row">
                  <textarea
                    id="edit-textarea"
                    className="edit-textarea"
                    value={textDraft}
                    onChange={(e) => setTextDraft(e.target.value)}
                    rows={18}
                    spellCheck={false}
                  />
                  <div className="tv-preview-wrap">
                    <span className="opt-label">Live preview</span>
                    <canvas ref={tvPreviewRef} className="tv-preview" aria-label="Live preview of page text" />
                    <span className="opt-hint">Approximate layout — Review shows the exact file.</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                  <button type="button" className="btn" onClick={applyTextView}>
                    Apply text to page {page.pageNum}
                  </button>
                  {page.textOverride != null && (
                    <button type="button" className="btn secondary" onClick={discardTextView}>
                      Discard text-view edits
                    </button>
                  )}
                </div>
                <p className="opt-hint">
                  Edit freely, then apply — the page keeps its place in the document and downloads with your new text.
                </p>
              </div>
            )}

            {working && (
              <div role="status" aria-label={workLabel} style={{ marginTop: '1rem' }}>
                <div className="load-note">{workLabel}</div>
                <div className="progress"><div /></div>
              </div>
            )}

            {outputs.length > 0 && (
              <div className="alert ok" style={{ marginTop: '1rem' }}>
                Done! Your file{outputs.length === 1 ? ' is' : 's are'} ready below.
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
              {outputs.length === 0 ? (
                <>
                  <button className="btn" onClick={openPreview} disabled={working || totalEdits === 0}>
                    {working ? 'Working…' : '👁 Review & Download'}
                  </button>
                  <button className="btn secondary" onClick={downloadClean} disabled={working}>
                    Download as clean PDF
                  </button>
                  <button className="btn secondary" onClick={downloadDocx} disabled={working}>
                    Download as Word (.docx)
                  </button>
                </>
              ) : (
                <>
                  {outputs.map((o, i) => (
                    <a key={i} className="btn secondary" href={o.url} download={o.filename}>
                      ⬇ {o.label}: {o.filename}
                    </a>
                  ))}
                </>
              )}
              <button className="btn secondary" onClick={resetAll}>
                {outputs.length > 0 ? 'Edit another PDF' : 'Start over'}
              </button>
            </div>
            {totalEdits === 0 && outputs.length === 0 && (
              <p className="opt-hint">Make at least one edit to enable “Review & Download” — or grab a clean rebuild any time.</p>
            )}
            {error && (
              <div className="alert err" role="alert" style={{ marginTop: '1rem' }}>
                {error}
              </div>
            )}
            <div className="privacy-note">
              <span aria-hidden="true">🔒</span>
              <span>
                Private by design: editing happens inside your browser — your PDF is never uploaded anywhere.
              </span>
            </div>
          </div>

          {/* options sidebar */}
          <aside className="tool-side edit-side" aria-label="Options">
            <h2 className="tool-side-title">Options</h2>
            <div className="opt-row">
              <span className="opt-label">View</span>
              <div className="seg" role="group" aria-label="Editor view">
                <button
                  type="button"
                  className={view === 'page' ? 'active' : ''}
                  onClick={() => setView('page')}
                >
                  Page view
                </button>
                <button
                  type="button"
                  className={view === 'text' ? 'active' : ''}
                  onClick={() => setView('text')}
                >
                  Text view
                </button>
              </div>
              <span className="opt-hint">
                {view === 'page'
                  ? 'Click text on the page to edit it in place.'
                  : 'Edit the whole page as plain text, then apply.'}
              </span>
            </div>
            <label className="opt-row opt-check">
              <input
                type="checkbox"
                checked={showOutlines}
                onChange={(e) => setShowOutlines(e.target.checked)}
              />
              <span className="opt-label">Show text block outlines</span>
            </label>
            <div className="opt-row">
              <span className="opt-label">Document</span>
              <span className="opt-hint">
                {pages.length} page{pages.length === 1 ? '' : 's'} ·{' '}
                {page.blocks.length} text blocks on this page · {totalEdits} edit{totalEdits === 1 ? '' : 's'}
              </span>
            </div>
            <div className="opt-row">
              <span className="opt-label">Good to know</span>
              <span className="opt-hint">
                Best for text-based PDFs (reports, contracts, resumes). Complex layouts or tables
                may shift slightly, and original fonts are approximated. Scanned PDFs (pictures of
                text) can’t be edited — they need OCR first.
              </span>
            </div>
          </aside>
        </div>
      )}

      {preview && (
        <div className="modal-overlay" onClick={closePreview} role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Review your edited PDF"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <strong>Review your edited PDF</strong>
                <div className="opt-hint">
                  {preview.total} page{preview.total === 1 ? '' : 's'} · exactly what you’ll download
                </div>
              </div>
              <button type="button" className="mini-btn" onClick={closePreview} aria-label="Close preview">
                ✕
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={downloadPreviewBytes}>
                ⬇ Download PDF
              </button>
              <span className="opt-hint">This saves the file shown below — no rebuild, byte for byte.</span>
            </div>
            <div className="modal-body">
              {preview.rendered < preview.total && (
                <div className="load-note" role="status">
                  Rendering page {preview.rendered + 1} of {preview.total}…
                </div>
              )}
              {preview.pageUrls.map((u, i) => (
                <img key={i} src={u} alt={`Preview of edited page ${i + 1}`} className="modal-page" />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
