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
  /** Block ids last touched by Text-view Apply (for "Discard text-view edits"). */
  tvTouched: string[];
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
    (n, p) => n + p.blocks.filter((b) => b.editedText != null && b.editedText !== b.text).length,
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
            tvTouched: [] as string[],
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
    setTextDraft(page.blocks.map((b) => b.text).join('\n\n'));
    setEditingId(null);
  }, [sel, page?.pageNum, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Live preview in Text view: the page thumbnail with the draft's pending
   * edits overlaid (approximate — the Review step shows the exact file).
   * Debounced while typing.
   */
  const drawTextPreview = useCallback(async () => {
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
    const mod = await import('@/lib/converters/pdf');
    const edits = mod.diffTextViewToBlocks(
      page.blocks.map((b) => ({ id: b.id, text: b.text })),
      textDraft
    );
    const changed = new Map(
      edits.filter((e) => e.newText !== null).map((e) => [e.blockId, e.newText as string])
    );
    const drawOverlay = () => {
      if (changed.size === 0) return;
      const sx = W / page.width;
      const sy = H / page.height;
      for (const b of page.blocks) {
        const nt = changed.get(b.id);
        if (nt == null) continue;
        const bx = b.x * sx;
        const bw = Math.max(6, b.width * sx);
        const byTop = (page.height - (b.y + b.height)) * sy;
        const bh = Math.max(8, b.height * 1.3 * sy);
        ctx.fillStyle = 'rgba(255,176,0,0.28)';
        ctx.fillRect(bx - 1, byTop - 1, bw + 2, bh + 2);
        ctx.fillStyle = '#333';
        ctx.font = `${Math.max(5, Math.min(9, b.fontSize * sx))}px sans-serif`;
        const first = nt.split('\n')[0] || '';
        const label = first.length > 34 ? `${first.slice(0, 34)}…` : first;
        if (label) ctx.fillText(label, bx, byTop + bh * 0.65);
      }
    };
    if (page.thumb) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, W, H);
        ctx.strokeStyle = '#e3e3e3';
        ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
        drawOverlay();
      };
      img.onerror = () => drawOverlay();
      img.src = page.thumb;
    } else {
      ctx.fillStyle = '#999';
      ctx.font = '12px sans-serif';
      ctx.fillText('Preview appears here', 16, 30);
      drawOverlay();
    }
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

  /**
   * Apply the Text-view draft as per-block edits (never a page-level reflow).
   * Pure: returns the updated pages array; caller commits it with setPages.
   * The diff fn is passed in because pdf.ts is dynamically imported.
   */
  function applyDraftPure(
    all: PageState[],
    selIdx: number,
    v: 'page' | 'text',
    draft: string,
    diffFn: (blocks: Array<{ id: string; text: string }>, d: string) => Array<{ blockId: string; newText: string | null }>
  ): PageState[] {
    if (v !== 'text') return all;
    const p = all[selIdx];
    if (!p) return all;
    const original = p.blocks.map((b) => b.text).join('\n\n');
    if (draft === original) return all;
    const edits = diffFn(
      p.blocks.map((b) => ({ id: b.id, text: b.text })),
      draft
    );
    const touched: string[] = [];
    const blocks = p.blocks.map((b) => {
      const e = edits.find((x) => x.blockId === b.id);
      if (!e || e.newText === null) return b;
      touched.push(b.id);
      return { ...b, editedText: e.newText === b.text ? null : e.newText };
    });
    return all.map((q, i) => (i === selIdx ? { ...q, blocks, tvTouched: touched } : q));
  }

  const applyTextView = useCallback(async () => {
    if (!page) return;
    const mod = await import('@/lib/converters/pdf');
    setPages((prev) => applyDraftPure(prev, sel, view, textDraft, mod.diffTextViewToBlocks));
  }, [sel, view, textDraft, page]);

  const discardTextView = useCallback(() => {
    setPages((prev) =>
      prev.map((p, i) =>
        i === sel
          ? {
              ...p,
              blocks: p.blocks.map((b) =>
                p.tvTouched.includes(b.id) ? { ...b, editedText: null } : b
              ),
              tvTouched: [],
            }
          : p
      )
    );
  }, [sel]);

  /** Cache of sampled design colors per page+block (original render never changes). */
  const colorCache = useRef(new Map<string, { bg: [number, number, number]; fg: [number, number, number] }>());

  /** Render one page offscreen (for color sampling on non-selected pages). */
  const renderPageOffscreen = useCallback(
    async (pageNum: number, scale: number): Promise<HTMLCanvasElement | null> => {
      if (!docRef.current) return null;
      try {
        const pg = (await docRef.current.getPage(pageNum)) as {
          getViewport: (o: { scale: number }) => { width: number; height: number };
          render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
          cleanup: () => void;
        };
        const vp = pg.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        await pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
        pg.cleanup();
        return c;
      } catch {
        return null;
      }
    },
    []
  );

  /**
   * Build FinalPages with sampled design colors for edited blocks.
   * Takes the effective pages array (draft already applied) — pure except
   * for the async sampling renders.
   */
  const buildFinalPagesWithColors = useCallback(
    async (effective: PageState[]): Promise<FinalPage[]> => {
      const mod = await import('@/lib/converters/pdf');
      const out: FinalPage[] = [];
      for (const p of effective) {
        const edited = p.blocks.filter((b) => b.editedText != null && b.editedText !== b.text);
        const colors = new Map<string, { bg: [number, number, number]; fg: [number, number, number] }>();
        if (edited.length > 0) {
          let canvas: HTMLCanvasElement | null = null;
          if (p.pageNum === page?.pageNum && canvasRef.current && canvasRef.current.width > 0) {
            canvas = canvasRef.current; // selected page: reuse the original render
          } else {
            canvas = await renderPageOffscreen(p.pageNum, 1.5);
          }
          const ctx = canvas?.getContext('2d', { willReadFrequently: true }) ?? null;
          if (canvas && ctx) {
            let img: ImageData | null = null;
            try {
              img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            } catch {
              img = null;
            }
            if (img) {
              for (const b of edited) {
                const key = `${p.pageNum}:${b.id}`;
                let c = colorCache.current.get(key);
                if (!c) {
                  const layout = await mod.layoutEditedBlock(
                    { ...b, text: b.editedText ?? b.text },
                    p.width
                  );
                  const s = mod.sampleBlockColors(
                    { data: img.data, width: img.width, height: img.height },
                    p.width,
                    p.height,
                    layout
                  );
                  c = {
                    bg: [s.bg.r, s.bg.g, s.bg.b],
                    fg: [s.fg.r, s.fg.g, s.fg.b],
                  };
                  colorCache.current.set(key, c);
                }
                colors.set(b.id, c);
              }
            }
          }
        }
        out.push({
          pageNum: p.pageNum,
          blocks: p.blocks.map((b) => {
            const fin = b.editedText ?? b.text;
            const isEdited = b.editedText != null && b.editedText !== b.text;
            const c = colors.get(b.id);
            return {
              ...b,
              text: fin,
              edited: isEdited,
              bgRgb: c ? { r: c.bg[0], g: c.bg[1], b: c.bg[2] } : undefined,
              fgRgb: c ? { r: c.fg[0], g: c.fg[1], b: c.fg[2] } : undefined,
            };
          }),
        });
      }
      return out;
    },
    [page?.pageNum, renderPageOffscreen]
  );

  const pushOutput = useCallback((blob: Blob, filename: string, label: string) => {
    const url = URL.createObjectURL(blob);
    setOutputs((os) => [...os.filter((o) => o.label !== label), { blob, filename, label, url }]);
  }, []);

  /**
   * Commit any pending Text-view draft, then build color-sampled FinalPages.
   * Single choke point for Preview/Downloads so fresh typing is never missed.
   */
  const prepareFinalPages = useCallback(async (): Promise<FinalPage[] | null> => {
    const mod = await import('@/lib/converters/pdf');
    const effective = applyDraftPure(pages, sel, view, textDraft, mod.diffTextViewToBlocks);
    if (effective !== pages) setPages(effective);
    return buildFinalPagesWithColors(effective);
  }, [pages, sel, view, textDraft, buildFinalPagesWithColors]);

  const downloadPdf = useCallback(async () => {
    if (!srcRef.current || working) return;
    setWorking(true);
    setWorkLabel('Building your edited PDF…');
    setError(null);
    try {
      const mod = await import('@/lib/converters/pdf');
      const final = await prepareFinalPages();
      if (!final) throw new Error('Could not prepare the pages.');
      const r = await mod.renderEditedPdf(
        srcRef.current.slice(0),
        final,
        `${baseName(fileLabel)}-edited.pdf`
      );
      pushOutput(r.blob, r.filename, 'PDF');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the PDF. Please try again.');
    } finally {
      setWorking(false);
    }
  }, [working, prepareFinalPages, fileLabel, pushOutput]);

  const downloadClean = useCallback(async () => {
    if (working) return;
    setWorking(true);
    setWorkLabel('Building a plain-text PDF…');
    setError(null);
    try {
      const mod = await import('@/lib/converters/pdf');
      const final = await prepareFinalPages();
      if (!final) throw new Error('Could not prepare the pages.');
      const r = await mod.renderCleanPdf(final, `${baseName(fileLabel)}-plain-text.pdf`);
      pushOutput(r.blob, r.filename, 'Plain-text PDF');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the PDF. Please try again.');
    } finally {
      setWorking(false);
    }
  }, [working, prepareFinalPages, fileLabel, pushOutput]);

  const downloadDocx = useCallback(async () => {
    if (working) return;
    setWorking(true);
    setWorkLabel('Building your Word file…');
    setError(null);
    try {
      const mod = await import('@/lib/converters/pdf');
      const final = await prepareFinalPages();
      if (!final) throw new Error('Could not prepare the pages.');
      const r = await mod.renderEditedDocx(final, `${baseName(fileLabel)}-edited.docx`);
      pushOutput(r.blob, r.filename, 'Word');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the Word file. Please try again.');
    } finally {
      setWorking(false);
    }
  }, [working, prepareFinalPages, fileLabel, pushOutput]);

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
      const final = await prepareFinalPages();
      if (!final) throw new Error('Could not prepare the pages.');
      if (token !== previewToken.current) return;
      const r = await mod.renderEditedPdf(
        srcRef.current.slice(0),
        final,
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
  }, [working, prepareFinalPages, fileLabel]);

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
                  {p.blocks.some((b) => b.editedText != null && b.editedText !== b.text) && (
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
                    // Overlay box: straddle the baseline (descenders dip below it),
                    // so the outline sits on the visible glyphs, not above them.
                    const boxH = b.height * 1.35;
                    const boxBottom = b.y - b.height * 0.25;
                    const style = {
                      left: `${(b.x / page.width) * 100}%`,
                      top: `${((page.height - (boxBottom + boxH)) / page.height) * 100}%`,
                      width: `${(b.width / page.width) * 100}%`,
                      height: `${(boxH / page.height) * 100}%`,
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
                          ref={(el) => {
                            // Focus once so the caret appears immediately after click.
                            if (el && document.activeElement !== el) {
                              el.focus();
                              const range = document.createRange();
                              range.selectNodeContents(el);
                              range.collapse(false);
                              const sel = window.getSelection();
                              sel?.removeAllRanges();
                              sel?.addRange(range);
                            }
                          }}
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
                        className={`edit-block${isEdited ? ' edited' : ''}${showOutlines ? ' outlined' : ''}`}
                        style={style}
                        title="Click to edit"
                        onClick={() => setEditingId(b.id)}
                      />
                    );
                  })}
                </div>
                <p className="opt-hint" style={{ marginTop: '0.5rem' }}>
                  Click any text on the page to edit it in place. Edited blocks are highlighted.
                </p>
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
                  {page.tvTouched.length > 0 && (
                    <button type="button" className="btn secondary" onClick={discardTextView}>
                      Discard text-view edits
                    </button>
                  )}
                </div>
                <p className="opt-hint">
                  Edit freely, then apply — your changes land on the matching text blocks and the page keeps its design.
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

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem', alignItems: 'flex-end' }}>
              {outputs.length === 0 ? (
                <>
                  <div>
                    <button className="btn" onClick={openPreview} disabled={working || totalEdits === 0}>
                      {working ? 'Working…' : '👁 Review & Download'}
                    </button>
                    <div className="opt-hint" style={{ marginTop: '0.25rem' }}>
                      Keeps your design — only your edited words change.
                    </div>
                  </div>
                  <div>
                    <button className="btn secondary" onClick={downloadClean} disabled={working}>
                      Download as plain-text PDF
                    </button>
                    <div className="opt-hint" style={{ marginTop: '0.25rem' }}>
                      Simple layout — colors and styling are not kept.
                    </div>
                  </div>
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
              <p className="opt-hint">Make at least one edit to enable “Review & Download” — or grab a plain-text rebuild any time.</p>
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
                Best for text-based PDFs (reports, contracts, resumes). Only the words you edit
                are redrawn — colors, images and layout stay as they were. Longer replacement
                text grows its box to the right; nearby content never moves. Complex tables may
                shift slightly. Redrawn text uses a matching font (Noto Sans for Noto-based PDFs,
                Helvetica otherwise); non-Latin scripts may still show as ?. Scanned PDFs
                (pictures of text) can’t be edited — they need OCR first.
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
