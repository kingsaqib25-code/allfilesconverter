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
import type { EditorBlock, EditorPageData, FinalPage, PageOverlay } from '@/lib/converters/pdf';

/** Annotation toolbar tools (iLovePDF-style). */
type AnnotTool = 'select' | 'edit-text' | 'add-text' | 'highlight' | 'underline' | 'strikeout' | 'draw' | 'shape' | 'image' | 'whiteout';
type ShapeKind = 'rect' | 'ellipse' | 'line';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
function rgbToCss(c: { r: number; g: number; b: number }, a = 1): string {
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${a})`;
}

function rgbToHex(c: { r: number; g: number; b: number }): string {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

interface BlockState extends EditorBlock {
  editedText: string | null;
  /** Sampled foreground (glyph) color 0..1, for auto-matching edit/add-text styling. */
  fgRgb?: { r: number; g: number; b: number };
  /** Sampled page background behind the block, for masking original glyphs under edited text. */
  bgRgb?: { r: number; g: number; b: number };
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

/**
 * Best-effort font stack for the in-place editing box, from the PDF's raw
 * font name. We can't use the embedded font on a DOM overlay, but matching
 * the generic family + exact size removes the "pasted layer" look.
 */
function fontStackForBlock(b: { fontName: string }): string {
  const n = (b.fontName || '').toLowerCase();
  if (/mono|courier|consol|typewriter/.test(n))
    return 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';
  if (/calibri|carlito/.test(n))
    return '"Carlito", Calibri, "Segoe UI", Arial, sans-serif';
  if (/cambria|caladea/.test(n))
    return '"Caladea", Cambria, Georgia, serif';
  if (/times|georgia|garamond|palatino|bookman|serif/.test(n))
    return 'Georgia, "Times New Roman", Times, serif';
  return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
}

type TextFam = 'serif' | 'sans' | 'mono';

/** Map a PDF font name to our small family enum (matches fontStackForBlock). */
function fontFamForBlock(b: { fontName: string }): TextFam {
  const n = (b.fontName || '').toLowerCase();
  if (/mono|courier|consol|typewriter/.test(n)) return 'mono';
  if (/times|georgia|garamond|palatino|bookman|serif/.test(n)) return 'serif';
  return 'sans';
}

function cssStackForFam(fam: TextFam): string {
  if (fam === 'mono') return 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';
  if (fam === 'serif') return 'Georgia, "Times New Roman", Times, serif';
  return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
}

/** Display stack for an added-text overlay: its real font name wins over the coarse family. */
function cssStackForOverlay(o: { fontName?: string; fontFamily?: TextFam }): string {
  const n = (o.fontName || '').toLowerCase();
  if (/calibri|carlito/.test(n)) return '"Carlito", Calibri, "Segoe UI", Arial, sans-serif';
  if (/cambria|caladea/.test(n)) return '"Caladea", Cambria, Georgia, serif';
  return cssStackForFam(o.fontFamily ?? 'sans');
}

/** Nearest text block to a PDF-unit point (for style auto-pickup), or null. */
function nearestBlock<T extends { x: number; y: number; width: number; height: number }>(
  blocks: T[],
  x: number,
  y: number,
  maxDist: number
): T | null {
  let best: T | null = null;
  let bestD = maxDist;
  for (const b of blocks) {
    // Distance to the block's RECT (closest point), not its center — a wide
    // block's center can be far from a click on its own text, which used to
    // let a nearer wrong (black) block win and break color pickup.
    const dx = Math.max(b.x - x, 0, x - (b.x + b.width));
    const yTop = b.y + b.height;
    const yBot = b.y - b.height * 0.3;
    const dy = Math.max(yBot - y, 0, y - yTop);
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/**
 * Snap a highlight's vertical band to the text line the drag is on. A free
 * drag follows the mouse, so dragging along the BOTTOM of a line used to
 * land the rect a whole line below the phrase. Snapping to the nearest
 * block's glyph band (baseline + 0.3×fontSize, height 1.4×fontSize) makes
 * any drag on the line land ON the line. Falls back to the raw drag line
 * (min one line height) when no block is near.
 */
function snapHighlightY(
  blocks: { y: number; fontSize: number }[],
  midY: number
): { cy: number; h: number } {
  let best: { y: number; fontSize: number } | null = null;
  let bestD = Infinity;
  for (const b of blocks) {
    const cy = b.y + b.fontSize * 0.3;
    const d = Math.abs(midY - cy);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (best && bestD < best.fontSize * 1.2) {
    return { cy: best.y + best.fontSize * 0.3, h: Math.max(12, best.fontSize * 1.4) };
  }
  return { cy: midY, h: 12 };
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
  /** Zoom for the page view (read small text, then edit it). 1 = 100%. */
  const [zoom, setZoom] = useState(1);
  const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  const zoomIn = useCallback(() => {
    setZoom((z) => {
      const i = ZOOM_STEPS.findIndex((s) => s > z + 1e-9);
      return i === -1 ? z : ZOOM_STEPS[i];
    });
  }, []);
  const zoomOut = useCallback(() => {
    setZoom((z) => {
      const below = [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-9);
      return below === undefined ? z : below;
    });
  }, []);

  const [working, setWorking] = useState(false);
  const [workLabel, setWorkLabel] = useState('');
  const [outputs, setOutputs] = useState<OutFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  // Baseline the Text-view draft was last synced from (effective block text).
  // Apply diffs baseline -> draft, never current blocks -> draft, so even a
  // stale draft cannot clobber page-view edits made after the draft was built.
  const draftBaseRef = useRef<{ blocks: Array<{ id: string; text: string }>; text: string } | null>(null);
  const textDraftRef = useRef('');
  textDraftRef.current = textDraft;
  const [preview, setPreview] = useState<{
    bytes: ArrayBuffer;
    filename: string;
    total: number;
    rendered: number;
    pageUrls: string[];
  } | null>(null);

  // ---- annotation tools (toolbar) ----
  const [tool, setTool] = useState<AnnotTool>('edit-text');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  const [overlays, setOverlays] = useState<PageOverlay[]>([]);
  const [selOverlay, setSelOverlay] = useState<string | null>(null);
  const [selBlock, setSelBlock] = useState<string | null>(null);
  const [penHex, setPenHex] = useState('#000000');
  const [textSize, setTextSize] = useState(14);
  /** Pending add-text style (used when no nearby text to auto-pickup from). */
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);
  const [textUnderline, setTextUnderline] = useState(false);
  const [textAlign, setTextAlignState] = useState<'left' | 'center' | 'right'>('left');
  const [textFont, setTextFont] = useState<'auto' | TextFam>('auto');
  const [penThick, setPenThick] = useState(2.5);
  const [histPast, setHistPast] = useState<PageOverlay[][]>([]);
  const [histFuture, setHistFuture] = useState<PageOverlay[][]>([]);
  const overlaysRef = useRef<PageOverlay[]>([]);
  overlaysRef.current = overlays;
  /** Switch annotation tool, clearing any in-progress text edit/selection. */
  const pickTool = useCallback((t: AnnotTool) => {
    setEditingId(null);
    setSelBlock(null);
    setSelOverlay(null);
    setTool(t);
  }, []);
  /** Commit a new overlays array with undo history. */
  const commitOverlays = useCallback((next: PageOverlay[]) => {
    setHistPast((h) => [...h.slice(-49), overlaysRef.current]);
    setHistFuture([]);
    setOverlays(next);
  }, []);
  const undoAnnot = useCallback(() => {
    setHistPast((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setHistFuture((f) => [overlaysRef.current, ...f].slice(0, 50));
      setOverlays(prev);
      setSelOverlay(null);
      return h.slice(0, -1);
    });
  }, []);
  const redoAnnot = useCallback(() => {
    setHistFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setHistPast((h) => [...h.slice(-49), overlaysRef.current]);
      setOverlays(next);
      setSelOverlay(null);
      return f.slice(1);
    });
  }, []);

  const inputRef = useRef<HTMLInputElement>(null);
  const srcRef = useRef<ArrayBuffer | null>(null);
  const previewToken = useRef(0);
  const tvPreviewRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /** In-progress annotation gesture (highlight rect / draw stroke / shape). */
  const gestureRef = useRef<{
    kind: 'highlight' | 'underline' | 'strikeout' | 'draw' | 'shape' | 'whiteout';
    startX: number;
    startY: number;
    pts: Array<{ x: number; y: number }>;
  } | null>(null);
  const [gestureTick, setGestureTick] = useState(0); // re-render during gesture
  const imgInputRef = useRef<HTMLInputElement>(null);
  const imgUrlCache = useRef(new Map<string, string>());
  const pendingImgPos = useRef<{ x: number; y: number } | null>(null);
  /** Signature pad (draw with pen / finger / stylus / mouse). */
  const [sigPadOpen, setSigPadOpen] = useState(false);
  const [sigHasInk, setSigHasInk] = useState(false);
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const sigDrawing = useRef(false);
  const sigLast = useRef<{ x: number; y: number } | null>(null);
  const pendingSigBytes = useRef<{ buf: ArrayBuffer; mime: string } | null>(null);
  const docRef = useRef<{ getPage: (n: number) => Promise<unknown>; destroy?: () => void } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thumbsDone = useRef(false);

  const page = pages[sel];

  const localOvId = () =>
    `ov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  /** Client coords -> PDF-unit point on the selected page. */
  const toPdfPoint = useCallback(
    (clientX: number, clientY: number) => {
      const el = wrapRef.current;
      const pg = pages[sel];
      if (!el || !pg) return null;
      const r = el.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const fy = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
      return { x: fx * pg.width, y: (1 - fy) * pg.height };
    },
    [pages, sel]
  );

  const commitGesture = useCallback(
    (g: { kind: 'highlight' | 'underline' | 'strikeout' | 'draw' | 'shape' | 'whiteout'; startX: number; startY: number; pts: Array<{ x: number; y: number }> }) => {
      if (g.kind === 'draw') {
        if (g.pts.length < 2) return;
        const xs = g.pts.map((p) => p.x);
        const ys = g.pts.map((p) => p.y);
        const pad = 3;
        commitOverlays([
          ...overlaysRef.current,
          {
            id: localOvId(),
            kind: 'draw',
            pageNum: pages[sel]?.pageNum ?? 1,
            x: Math.min(...xs) - pad,
            y: Math.min(...ys) - pad,
            w: Math.max(...xs) - Math.min(...xs) + pad * 2,
            h: Math.max(...ys) - Math.min(...ys) + pad * 2,
            strokes: [g.pts],
            color: hexToRgb(penHex),
            thickness: penThick,
          },
        ]);
        return;
      }
      const last = g.pts[g.pts.length - 1];
      const x0 = Math.min(g.startX, last.x);
      const x1 = Math.max(g.startX, last.x);
      const y0 = Math.min(g.startY, last.y);
      const y1 = Math.max(g.startY, last.y);
      if (x1 - x0 < 4 && y1 - y0 < 4) return; // accidental click, not a drag
      if (g.kind === 'highlight') {
        // A natural highlight drag runs ALONG the text line, so its raw
        // height is ~0 — and a zero-height rect fills nothing anywhere
        // (editor, preview, download), even though the overlay commits and
        // counts as an edit. Snap the band to the text line the drag is on
        // (a low drag on a line must not land a line below the phrase).
        const midY = (y0 + y1) / 2;
        const snap = snapHighlightY(pages[sel]?.blocks ?? [], midY);
        commitOverlays([
          ...overlaysRef.current,
          {
            id: localOvId(),
            kind: 'highlight',
            pageNum: pages[sel]?.pageNum ?? 1,
            x: x0, y: snap.cy - snap.h / 2, w: x1 - x0, h: snap.h,
            fill: { r: 1, g: 0.92, b: 0.35 },
            opacity: 0.35,
          },
        ]);
      } else if (g.kind === 'underline' || g.kind === 'strikeout') {
        commitOverlays([
          ...overlaysRef.current,
          {
            id: localOvId(),
            kind: g.kind,
            pageNum: pages[sel]?.pageNum ?? 1,
            x: x0, y: y0, w: x1 - x0, h: Math.max(y1 - y0, 8),
            color: hexToRgb(penHex),
            thickness: 1.5,
          },
        ]);
      } else if (g.kind === 'whiteout') {
        // Whiteout covers the dragged box with opaque white. A short drag
        // over a text line snaps to that line's band (like a highlight), so
        // one drag hides the whole line instead of half of it; a tall drag
        // keeps its own box (for covering images or blocks of text).
        let wy0 = y0;
        let wh = Math.max(y1 - y0, 8);
        if (y1 - y0 < 20) {
          const snap = snapHighlightY(pages[sel]?.blocks ?? [], (y0 + y1) / 2);
          wy0 = snap.cy - snap.h / 2;
          wh = snap.h;
        }
        commitOverlays([
          ...overlaysRef.current,
          {
            id: localOvId(),
            kind: 'whiteout',
            pageNum: pages[sel]?.pageNum ?? 1,
            x: x0, y: wy0, w: Math.max(x1 - x0, 5), h: wh,
          },
        ]);
      } else {
        commitOverlays([
          ...overlaysRef.current,
          {
            id: localOvId(),
            kind: 'shape',
            shape: shapeKind,
            pageNum: pages[sel]?.pageNum ?? 1,
            x: x0, y: y0,
            w: Math.max(x1 - x0, 5), h: Math.max(y1 - y0, 5),
            color: hexToRgb(penHex),
            thickness: 2,
          },
        ]);
      }
    },
    [commitOverlays, penHex, penThick, shapeKind, pages, sel]
  );

  const addTextAt = useCallback(
    (p: { x: number; y: number }) => {
      const id = localOvId();
      const pg = pages[sel];
      if (!pg) return;
      // Auto-pickup: inherit font/size/color/bold from the nearest text block
      // so added text blends in. Falls back to the panel's pending style.
      const near = nearestBlock(pg.blocks, p.x, p.y, 150);
      const fs = near ? near.fontSize : textSize;
      const fam: TextFam = near ? fontFamForBlock(near) : textFont === 'auto' ? 'sans' : textFont;
      let color = near?.fgRgb ?? hexToRgb(penHex);
      // White-on-white guard: a white-on-dark block's white text (e.g. the
      // banner) must not be inherited for a click on a LIGHT strip outside
      // that block — the added text would be invisible. Fall back to dark.
      if (near?.fgRgb && near.bgRgb) {
        const lum = (c: { r: number; g: number; b: number }) =>
          0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        const inBlock =
          p.x >= near.x && p.x <= near.x + near.width &&
          p.y >= near.y - near.height * 0.3 && p.y <= near.y + near.height;
        if (lum(near.fgRgb) > 0.8 && lum(near.bgRgb) < 0.35 && !inBlock) {
          color = { r: 0.1, g: 0.1, b: 0.1 };
        }
      }
      const ov: PageOverlay = {
        id,
        kind: 'text',
        pageNum: pg.pageNum,
        x: Math.max(0, p.x - 4),
        y: Math.max(0, p.y - fs - 4),
        w: 220,
        h: fs + 8,
        text: 'Your text here',
        fontSize: fs,
        fontFamily: fam,
        // Keep the nearest block's real font name so the download can map
        // Calibri/Cambria to their metric twins (Carlito/Caladea).
        fontName: near?.fontName,
        bold: near ? near.bold : textBold,
        italic: near ? false : textItalic,
        underline: textUnderline,
        align: textAlign,
        color,
      };
      commitOverlays([...overlaysRef.current, ov]);
      setSelOverlay(id);
      setTool('select');
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-ov-id="${id}"] [contenteditable]`)?.focus();
      });
    },
    [commitOverlays, penHex, textSize, textBold, textItalic, textUnderline, textAlign, textFont, pages, sel]
  );

  /** Place image bytes (file pick or drawn signature) as an overlay at pos. */
  const placeImageBytes = useCallback(
    async (buf: ArrayBuffer, mime: string, pos: { x: number; y: number }) => {
      if (!page) return;
      // natural size for aspect ratio
      const url = URL.createObjectURL(new Blob([buf], { type: mime }));
      const dims = await new Promise<{ w: number; h: number }>((res) => {
        const im = new Image();
        im.onload = () => res({ w: im.naturalWidth || 300, h: im.naturalHeight || 200 });
        im.onerror = () => res({ w: 300, h: 200 });
        im.src = url;
      });
      URL.revokeObjectURL(url);
      const w = Math.min(220, page.width * 0.5);
      const h = (w * dims.h) / Math.max(1, dims.w);
      const ov: PageOverlay = {
        id: localOvId(),
        kind: 'image',
        pageNum: page.pageNum,
        x: Math.max(0, pos.x - w / 2),
        y: Math.max(0, pos.y - h / 2),
        w, h,
        imageBytes: buf,
        imageMime: mime,
      };
      imgUrlCache.current.set(ov.id, URL.createObjectURL(new Blob([buf], { type: mime })));
      commitOverlays([...overlaysRef.current, ov]);
      setSelOverlay(ov.id);
      setTool('select');
    },
    [page, commitOverlays]
  );

  const onAnnotDown = useCallback(
    (e: React.PointerEvent) => {
      if (tool === 'add-text') {
        const p = toPdfPoint(e.clientX, e.clientY);
        if (p) addTextAt(p);
        return;
      }
      if (tool === 'image') {
        const p = toPdfPoint(e.clientX, e.clientY);
        if (!p) return;
        // A drawn signature waiting to be placed goes down directly (no
        // file picker); otherwise open the picker for an image file.
        const sig = pendingSigBytes.current;
        if (sig) {
          pendingSigBytes.current = null;
          void placeImageBytes(sig.buf, sig.mime, p);
        } else {
          pendingImgPos.current = p;
          imgInputRef.current?.click();
        }
        return;
      }
      if (tool === 'highlight' || tool === 'underline' || tool === 'strikeout' || tool === 'draw' || tool === 'shape' || tool === 'whiteout') {
        const p = toPdfPoint(e.clientX, e.clientY);
        if (!p) return;
        gestureRef.current = { kind: tool, startX: p.x, startY: p.y, pts: [{ x: p.x, y: p.y }] };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    },
    [tool, toPdfPoint, addTextAt, placeImageBytes]
  );

  const onAnnotMove = useCallback(
    (e: React.PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      const p = toPdfPoint(e.clientX, e.clientY);
      if (!p) return;
      g.pts.push({ x: p.x, y: p.y });
      setGestureTick((t) => t + 1);
    },
    [toPdfPoint]
  );

  const onAnnotUp = useCallback(() => {
    const g = gestureRef.current;
    gestureRef.current = null;
    setGestureTick((t) => t + 1);
    if (g) commitGesture(g);
  }, [commitGesture]);

  /** Place image bytes (file pick or drawn signature) as an overlay at pos. */
  const onImagePicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      const pos = pendingImgPos.current;
      pendingImgPos.current = null;
      // A file pick discards any undrawn-placed signature.
      pendingSigBytes.current = null;
      if (!f || !pos) return;
      const buf = await f.arrayBuffer();
      await placeImageBytes(buf, f.type, pos);
    },
    [placeImageBytes]
  );

  /** Size the signature canvas to its displayed box when the pad opens. */
  useEffect(() => {
    if (!sigPadOpen) return;
    const c = sigCanvasRef.current;
    if (!c) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cw = Math.max(280, c.clientWidth || 480);
    c.width = Math.round(cw * dpr);
    c.height = Math.round(180 * dpr);
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, 180);
    }
    setSigHasInk(false);
  }, [sigPadOpen]);

  /** Signature pad drawing (PointerEvents: pen / finger / stylus / mouse). */
  const sigPos = (e: React.PointerEvent) => {
    const c = sigCanvasRef.current;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const sigStart = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = sigPos(e);
    if (!p) return;
    sigDrawing.current = true;
    sigLast.current = p;
    setSigHasInk(true);
    const ctx = sigCanvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = '#111111';
      ctx.fill();
    }
  };
  const sigMove = (e: React.PointerEvent) => {
    if (!sigDrawing.current) return;
    const p = sigPos(e);
    const last = sigLast.current;
    if (!p || !last) return;
    const ctx = sigCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    sigLast.current = p;
  };
  const sigEnd = () => {
    sigDrawing.current = false;
    sigLast.current = null;
  };
  const sigClear = () => {
    const c = sigCanvasRef.current;
    const ctx = c?.getContext('2d');
    if (c && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.restore();
    }
    setSigHasInk(false);
  };
  /** Save the drawing as a transparent PNG and arm it for placement. */
  const sigPlace = () => {
    const c = sigCanvasRef.current;
    if (!c || !sigHasInk) return;
    c.toBlob(async (blob) => {
      if (!blob) return;
      const buf = await blob.arrayBuffer();
      pendingSigBytes.current = { buf, mime: 'image/png' };
      setSigPadOpen(false);
      pickTool('image');
    }, 'image/png');
  };

  const deleteSelOverlay = useCallback(() => {
    if (!selOverlay) return;
    const url = imgUrlCache.current.get(selOverlay);
    if (url) {
      URL.revokeObjectURL(url);
      imgUrlCache.current.delete(selOverlay);
    }
    commitOverlays(overlaysRef.current.filter((o) => o.id !== selOverlay));
    setSelOverlay(null);
  }, [selOverlay, commitOverlays]);

  /** Selected text overlay (for the formatting controls). */
  const selTextOv = overlays.find((o) => o.id === selOverlay && o.kind === 'text') ?? null;

  const bumpTextSize = useCallback(
    (d: number) => {
      const ov = overlaysRef.current.find((o) => o.id === selOverlay && o.kind === 'text');
      if (ov) {
        const ns = Math.min(72, Math.max(6, (ov.fontSize ?? 14) + d));
        commitOverlays(overlaysRef.current.map((o) => (o.id === ov.id ? { ...o, fontSize: ns, h: ns + 8 } : o)));
      } else {
        setTextSize((v) => Math.min(72, Math.max(6, v + d)));
      }
    },
    [selOverlay, commitOverlays]
  );

  const toggleTextStyle = useCallback(
    (k: 'bold' | 'italic') => {
      const ov = overlaysRef.current.find((o) => o.id === selOverlay && o.kind === 'text');
      if (ov) {
        commitOverlays(overlaysRef.current.map((o) => (o.id === ov.id ? { ...o, [k]: !o[k] } : o)));
      } else {
        // No text selected: toggle the pending add-text style instead.
        if (k === 'bold') setTextBold((v) => !v);
        else setTextItalic((v) => !v);
      }
    },
    [selOverlay, commitOverlays]
  );

  /** Toggle underline on the selected text overlay, or the pending style. */
  const toggleTextUnderline = useCallback(() => {
    const ov = overlaysRef.current.find((o) => o.id === selOverlay && o.kind === 'text');
    if (ov) {
      commitOverlays(overlaysRef.current.map((o) => (o.id === ov.id ? { ...o, underline: !o.underline } : o)));
    } else {
      setTextUnderline((v) => !v);
    }
  }, [selOverlay, commitOverlays]);

  /** Set alignment on the selected text overlay, or the pending style. */
  const setTextAlign = useCallback(
    (a: 'left' | 'center' | 'right') => {
      const ov = overlaysRef.current.find((o) => o.id === selOverlay && o.kind === 'text');
      if (ov) {
        commitOverlays(overlaysRef.current.map((o) => (o.id === ov.id ? { ...o, align: a } : o)));
      } else {
        setTextAlignState(a);
      }
    },
    [selOverlay, commitOverlays]
  );

  /** Set font family for the selected text overlay, or the pending add-text style. */
  const setTextFontFam = useCallback(
    (fam: 'auto' | TextFam) => {
      const ov = overlaysRef.current.find((o) => o.id === selOverlay && o.kind === 'text');
      if (ov) {
        const real: TextFam = fam === 'auto' ? 'sans' : fam;
        commitOverlays(overlaysRef.current.map((o) => (o.id === ov.id ? { ...o, fontFamily: real } : o)));
      } else {
        setTextFont(fam);
      }
    },
    [selOverlay, commitOverlays]
  );

  /** Set color for the selected text overlay, or the pending pen color. */
  const setTextColor = useCallback(
    (hex: string) => {
      const ov = overlaysRef.current.find((o) => o.id === selOverlay && o.kind === 'text');
      if (ov) {
        commitOverlays(overlaysRef.current.map((o) => (o.id === ov.id ? { ...o, color: hexToRgb(hex) } : o)));
      }
      setPenHex(hex);
    },
    [selOverlay, commitOverlays]
  );

  /** Commit an in-place text overlay edit (empty text removes the overlay). */
  const commitTextOverlay = useCallback(
    (id: string, text: string) => {
      const ov = overlaysRef.current.find((o) => o.id === id);
      if (!ov) return;
      const t = text.replace(/\n{3,}/g, '\n\n').trimEnd();
      if (!t) {
        const url = imgUrlCache.current.get(id);
        if (url) {
          URL.revokeObjectURL(url);
          imgUrlCache.current.delete(id);
        }
        commitOverlays(overlaysRef.current.filter((o) => o.id !== id));
      } else if (t !== ov.text) {
        commitOverlays(overlaysRef.current.map((o) => (o.id === id ? { ...o, text: t } : o)));
      }
      // NOTE: blur does NOT deselect here. Clearing the selection on blur
      // used to re-render the toolbar between mousedown and click, so a
      // colour/bold/font click on a selected text box saw an empty selection
      // and did nothing (only the pen default changed). The box stays
      // selected after editing; clicking empty page space deselects it.
    },
    [commitOverlays]
  );

  // Delete key removes the selected overlay (not while typing in one).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName));
      if ((e.key === 'Delete' || e.key === 'Backspace') && selOverlay && !typing) {
        e.preventDefault();
        deleteSelOverlay();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selOverlay, deleteSelOverlay]);

  // Revoke image object URLs on unmount.
  useEffect(() => {
    const cache = imgUrlCache.current;
    return () => {
      cache.forEach((u) => URL.revokeObjectURL(u));
      cache.clear();
    };
  }, []);
  // Edits = edited text blocks PLUS annotation overlays (highlight, underline,
  // strikeout, draw, shape, image, added text). Counting blocks only meant a
  // highlight-only document showed "0 edits" and could never be Reviewed or
  // downloaded — the Highlight re-test hit exactly that wall.
  const totalEdits =
    pages.reduce(
      (n, p) => n + p.blocks.filter((b) => b.editedText != null && b.editedText !== b.text).length,
      0
    ) + overlays.length;

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
        // Best-effort: sample every text block's glyph color once (offscreen
        // render) so text edits and added text can auto-match the color of
        // the surrounding text. The editor works fine without it.
        const fgById = new Map<string, { r: number; g: number; b: number }>();
        const bgById = new Map<string, { r: number; g: number; b: number }>();
        for (const p of extracted) {
          try {
            const pg = (await doc.getPage(p.pageNum)) as unknown as {
              getViewport: (o: { scale: number }) => { width: number; height: number };
              render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
              cleanup: () => void;
            };
            const vp = pg.getViewport({ scale: 2 });
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.ceil(vp.width));
            cv.height = Math.max(1, Math.ceil(vp.height));
            const ctx = cv.getContext('2d', { willReadFrequently: true });
            if (!ctx) continue;
            await pg.render({ canvasContext: ctx, viewport: vp }).promise;
            pg.cleanup();
            const img = ctx.getImageData(0, 0, cv.width, cv.height);
            for (const b of p.blocks) {
              try {
                const s = pdfMod.sampleBlockColors(
                  { data: img.data, width: img.width, height: img.height },
                  p.width,
                  p.height,
                  { x: b.x, y: b.y - b.height * 0.25, w: b.width, h: b.height * 1.15 }
                );
                fgById.set(b.id, { r: s.fg.r, g: s.fg.g, b: s.fg.b });
                bgById.set(b.id, { r: s.bg.r, g: s.bg.g, b: s.bg.b });
              } catch {
                /* leave this block uncolored */
              }
            }
          } catch {
            /* sampling is best-effort; editor works without it */
          }
        }
        setPages(
          extracted.map((p) => ({
            ...p,
            blocks: p.blocks.map((b) => ({ ...b, editedText: null, fgRgb: fgById.get(b.id), bgRgb: bgById.get(b.id) })),
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
        const vp = pg.getViewport({ scale: 2 * zoom });
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
  }, [phase, page, sel, zoom]);

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

  // ---- text view draft follows selection AND page-view edits ----
  // The draft is built from the EFFECTIVE text (editedText ?? text). It
  // refreshes whenever the page's block text changes (blocksSig) so page-view
  // edits appear here — but only while the user has no unapplied text-view
  // typing, so their in-progress draft is never discarded. Apply is safe
  // either way: it diffs baseline -> draft (see applyDraftPure), so even a
  // stale draft cannot clobber page-view edits.
  const blocksSig = page ? page.blocks.map((b) => b.editedText ?? b.text).join('\n') : '';
  useEffect(() => {
    if (!page) return;
    const effBlocks = page.blocks.map((b) => ({ id: b.id, text: b.editedText ?? b.text }));
    const effText = effBlocks.map((b) => b.text).join('\n\n');
    const draftClean = draftBaseRef.current == null || textDraftRef.current === draftBaseRef.current.text;
    if (draftClean) {
      setTextDraft(effText);
      draftBaseRef.current = { blocks: effBlocks, text: effText };
    }
    setEditingId(null);
  }, [sel, page?.pageNum, phase, blocksSig]); // eslint-disable-line react-hooks/exhaustive-deps

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
    diffFn: (blocks: Array<{ id: string; text: string }>, d: string) => Array<{ blockId: string; newText: string | null }>,
    baseline?: Array<{ id: string; text: string }>
  ): PageState[] {
    if (v !== 'text') return all;
    const p = all[selIdx];
    if (!p) return all;
    // Diff BASELINE -> draft, never current blocks -> draft: a stale draft
    // (built before page-view edits) then carries only the user's text-view
    // changes, so Apply can never revert page-view edits.
    const cur = (b: BlockState) => b.editedText ?? b.text;
    const base = baseline ?? p.blocks.map((b) => ({ id: b.id, text: cur(b) }));
    const original = base.map((b) => b.text).join('\n\n');
    if (draft === original) return all;
    const edits = diffFn(base, draft);
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
    const next = applyDraftPure(pages, sel, view, textDraft, mod.diffTextViewToBlocks, draftBaseRef.current?.blocks);
    setPages(next);
    // Baseline moves to the applied state so the next Apply diffs from here.
    const np = next[sel];
    if (np) {
      const eff = np.blocks.map((b) => ({ id: b.id, text: b.editedText ?? b.text }));
      draftBaseRef.current = { blocks: eff, text: eff.map((b) => b.text).join('\n\n') };
    }
  }, [sel, view, textDraft, page, pages]);

  const discardTextView = useCallback(() => {
    if (!page) return;
    const next = pages.map((p, i) =>
      i === sel
        ? {
            ...p,
            blocks: p.blocks.map((b) =>
              p.tvTouched.includes(b.id) ? { ...b, editedText: null } : b
            ),
            tvTouched: [],
          }
        : p
    );
    setPages(next);
    // Keep the draft and baseline in step with the reverted page, or the next
    // Apply would resurrect the discarded text-view edits.
    const np = next[sel];
    if (np) {
      const eff = np.blocks.map((b) => ({ id: b.id, text: b.editedText ?? b.text }));
      const effText = eff.map((b) => b.text).join('\n\n');
      setTextDraft(effText);
      draftBaseRef.current = { blocks: eff, text: effText };
    }
  }, [sel, page, pages]);

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
          overlays: overlays.filter((o) => o.pageNum === p.pageNum),
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
    [page?.pageNum, renderPageOffscreen, overlays]
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
    const effective = applyDraftPure(pages, sel, view, textDraft, mod.diffTextViewToBlocks, draftBaseRef.current?.blocks);
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
              <span className="edit-zoom" role="group" aria-label="Zoom page view">
                <button type="button" className="mini-btn" onClick={zoomOut} disabled={zoom <= 0.5} aria-label="Zoom out">
                  −
                </button>
                <button
                  type="button"
                  className="mini-btn edit-zoom-label"
                  onClick={() => setZoom(1)}
                  aria-label="Reset zoom to 100%"
                  title="Reset zoom"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button type="button" className="mini-btn" onClick={zoomIn} disabled={zoom >= 3} aria-label="Zoom in">
                  +
                </button>
              </span>
            </div>

            {view === 'page' && (
              <div className="annot-toolbar" role="toolbar" aria-label="PDF annotation tools">
                <div className="annot-group" role="group" aria-label="Mode">
                  <button
                    type="button"
                    className={`annot-btn${tool === 'select' ? ' on' : ''}`}
                    onClick={() => pickTool('select')}
                    title="Select text and annotations"
                  >
                    <span aria-hidden="true">⬚</span> Select
                  </button>
                  <button
                    type="button"
                    className={`annot-btn${tool === 'edit-text' ? ' on' : ''}`}
                    onClick={() => pickTool('edit-text')}
                    title="Click any text to edit it"
                  >
                    <span aria-hidden="true">✎</span> Edit text
                  </button>
                </div>
                <div className="annot-group" role="group" aria-label="Annotate">
                  <button
                    type="button"
                    className={`annot-btn${tool === 'add-text' ? ' on' : ''}`}
                    onClick={() => pickTool('add-text')}
                    title="Click anywhere to add text"
                  >
                    <span aria-hidden="true">A</span> Add text
                  </button>
                  <button
                    type="button"
                    className={`annot-btn${tool === 'highlight' ? ' on' : ''}`}
                    onClick={() => pickTool('highlight')}
                    title="Drag over text to highlight it"
                  >
                    <span aria-hidden="true">🖍</span> Highlight
                  </button>
                  <button
                    type="button"
                    className={`annot-btn${tool === 'whiteout' ? ' on' : ''}`}
                    onClick={() => pickTool('whiteout')}
                    title="Drag over content to cover it with white"
                  >
                    <span aria-hidden="true">◻</span> Whiteout
                  </button>
                  <button
                    type="button"
                    className={`annot-btn${tool === 'underline' ? ' on' : ''}`}
                    onClick={() => pickTool('underline')}
                    title="Drag under text to underline it"
                  >
                    <span aria-hidden="true" style={{ textDecoration: 'underline' }}>U</span> Underline
                  </button>
                  <button
                    type="button"
                    className={`annot-btn${tool === 'strikeout' ? ' on' : ''}`}
                    onClick={() => pickTool('strikeout')}
                    title="Drag over text to strike it through"
                  >
                    <span aria-hidden="true" style={{ textDecoration: 'line-through' }}>S</span> Strikeout
                  </button>
                  <button
                    type="button"
                    className={`annot-btn${tool === 'draw' ? ' on' : ''}`}
                    onClick={() => pickTool('draw')}
                    title="Draw freehand"
                  >
                    <span aria-hidden="true">✏</span> Draw
                  </button>
                  <button
                    type="button"
                    className={`annot-btn${tool === 'shape' ? ' on' : ''}`}
                    onClick={() => pickTool('shape')}
                    title="Draw a shape"
                  >
                    <span aria-hidden="true">{shapeKind === 'rect' ? '▢' : shapeKind === 'ellipse' ? '○' : '╱'}</span> Shape
                  </button>
                  {tool === 'shape' && (
                    <span className="annot-shapes" role="group" aria-label="Shape kind">
                      {(['rect', 'ellipse', 'line'] as ShapeKind[]).map((k) => (
                        <button
                          key={k}
                          type="button"
                          className={`annot-btn annot-btn-sm${shapeKind === k ? ' on' : ''}`}
                          onClick={() => setShapeKind(k)}
                          title={k}
                        >
                          <span aria-hidden="true">{k === 'rect' ? '▢' : k === 'ellipse' ? '○' : '╱'}</span>
                        </button>
                      ))}
                    </span>
                  )}
                  <button
                    type="button"
                    className={`annot-btn${tool === 'image' ? ' on' : ''}`}
                    onClick={() => pickTool('image')}
                    title="Click to place an image"
                  >
                    <span aria-hidden="true">🖼</span> Image
                  </button>
                  <button
                    type="button"
                    className="annot-btn"
                    onClick={() => setSigPadOpen(true)}
                    title="Draw your signature, then click the page to place it"
                  >
                    <span aria-hidden="true">✍</span> Signature
                  </button>
                </div>
                {(tool === 'add-text' || selTextOv) && (
                  <div className="annot-group" role="group" aria-label="Text formatting">
                    <button type="button" className="annot-btn annot-btn-sm" onClick={() => bumpTextSize(-2)} title="Smaller text">
                      <span aria-hidden="true">A−</span>
                    </button>
                    <span className="annot-val" aria-label="Font size">{selTextOv?.fontSize ?? textSize}</span>
                    <button type="button" className="annot-btn annot-btn-sm" onClick={() => bumpTextSize(2)} title="Larger text">
                      <span aria-hidden="true">A+</span>
                    </button>
                    <button
                      type="button"
                      className={`annot-btn annot-btn-sm${(selTextOv ? !!selTextOv.bold : textBold) ? ' on' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => toggleTextStyle('bold')}
                      title={selTextOv ? 'Bold' : 'Bold for new text'}
                    >
                      <span aria-hidden="true" style={{ fontWeight: 800 }}>B</span>
                    </button>
                    <button
                      type="button"
                      className={`annot-btn annot-btn-sm${(selTextOv ? !!selTextOv.italic : textItalic) ? ' on' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => toggleTextStyle('italic')}
                      title={selTextOv ? 'Italic' : 'Italic for new text'}
                    >
                      <span aria-hidden="true" style={{ fontStyle: 'italic' }}>I</span>
                    </button>
                    <button
                      type="button"
                      className={`annot-btn annot-btn-sm${(selTextOv ? !!selTextOv.underline : textUnderline) ? ' on' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => toggleTextUnderline()}
                      title={selTextOv ? 'Underline' : 'Underline for new text'}
                    >
                      <span aria-hidden="true" style={{ textDecoration: 'underline' }}>U</span>
                    </button>
                    {(['left', 'center', 'right'] as const).map((a) => (
                      <button
                        key={a}
                        type="button"
                        className={`annot-btn annot-btn-sm${(selTextOv ? (selTextOv.align ?? 'left') : textAlign) === a ? ' on' : ''}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setTextAlign(a)}
                        title={a === 'left' ? 'Align left' : a === 'center' ? 'Align center' : 'Align right'}
                      >
                        <span aria-hidden="true">{a === 'left' ? '⫷' : a === 'center' ? '☰' : '⫸'}</span>
                      </button>
                    ))}
                    <select
                      className="annot-select"
                      aria-label="Font family"
                      title={selTextOv ? 'Font family' : 'Font family for new text'}
                      value={selTextOv ? selTextOv.fontFamily ?? 'sans' : textFont}
                      onChange={(e) => setTextFontFam(e.target.value as 'auto' | TextFam)}
                    >
                      {!selTextOv && <option value="auto">Auto font</option>}
                      <option value="serif">Serif</option>
                      <option value="sans">Sans</option>
                      <option value="mono">Mono</option>
                    </select>
                  </div>
                )}
                {(tool === 'draw' || tool === 'shape') && (
                  <div className="annot-group" role="group" aria-label="Stroke thickness">
                    {[2, 4, 6].map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`annot-btn annot-btn-sm${penThick === t ? ' on' : ''}`}
                        onClick={() => setPenThick(t)}
                        title={`${t} pt stroke`}
                      >
                        {t}pt
                      </button>
                    ))}
                  </div>
                )}
                <div className="annot-group" role="group" aria-label="Color">
                  {['#000000', '#d62626', '#1a56db', '#0f7a3d'].map((c) => {
                    // Show the selected text's own color (not the pen's) so the
                    // toolbar never lies about what is on the page.
                    const shown = selTextOv && selTextOv.color ? rgbToHex(selTextOv.color) : penHex;
                    return (
                      <button
                        key={c}
                        type="button"
                        className={`annot-swatch${shown.toLowerCase() === c ? ' on' : ''}`}
                        style={{ background: c }}
                        // Keep focus in the text box: without this, mousedown
                        // blurs the editor, the blur clears the selection, and
                        // the click then sees no selected text to recolour.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setTextColor(c)}
                        aria-label={`Color ${c}`}
                        title={selTextOv ? `Color ${c} (selected text)` : c}
                      />
                    );
                  })}
                  <input
                    type="color"
                    className="annot-swatch annot-custom"
                    value={selTextOv && selTextOv.color ? rgbToHex(selTextOv.color) : penHex}
                    onChange={(e) => setTextColor(e.target.value)}
                    aria-label="Custom color"
                    title={selTextOv ? 'Custom color (selected text)' : 'Custom color'}
                  />
                </div>
                <div className="annot-group" role="group" aria-label="Undo and redo">
                  <button type="button" className="annot-btn" onClick={undoAnnot} disabled={histPast.length === 0} title="Undo annotation">
                    <span aria-hidden="true">↩</span>
                  </button>
                  <button type="button" className="annot-btn" onClick={redoAnnot} disabled={histFuture.length === 0} title="Redo annotation">
                    <span aria-hidden="true">↪</span>
                  </button>
                </div>
                <input
                  ref={imgInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={onImagePicked}
                  aria-hidden="true"
                  tabIndex={-1}
                />
              </div>
            )}

            {view === 'page' ? (
              <>
              <div className="edit-zoom-scroll">
                <div className="edit-canvas-wrap" ref={wrapRef} style={{ width: `${zoom * 100}%` }}>
                  <canvas ref={canvasRef} className="edit-canvas" aria-label={`Page ${page.pageNum} preview`} />
                <div className="edit-overlay" aria-hidden={editingId != null}>
                  {page.blocks.map((b) => {
                    const isEditing = editingId === b.id;
                    const isEdited = b.editedText != null && b.editedText !== b.text;
                    // Tight box: hover/click targeting so clicks land on the exact
                    // line — tall boxes overlap neighbours and steal clicks.
                    const boxH = b.height * 1.1;
                    const boxBottom = b.y - b.height * 0.2;
                    const style = {
                      left: `${(b.x / page.width) * 100}%`,
                      top: `${((page.height - (boxBottom + boxH)) / page.height) * 100}%`,
                      width: `${(b.width / page.width) * 100}%`,
                      height: `${(boxH / page.height) * 100}%`,
                    } as React.CSSProperties;
                    // Editing box: generous fontSize-based cover so the white
                    // background fully hides the original glyphs underneath
                    // (the tight box left descenders peeking out — the
                    // "double text" look). Slightly overlaps neighbours while
                    // editing, which is fine — it collapses back on blur.
                    const editTop = b.y + b.fontSize * 0.95;
                    const editBottom = b.y - b.fontSize * 0.4;
                    const editStyle = {
                      left: `${(b.x / page.width) * 100}%`,
                      top: `${((page.height - editTop) / page.height) * 100}%`,
                      width: `${(b.width / page.width) * 100}%`,
                      height: `${((editTop - editBottom) / page.height) * 100}%`,
                      // Match the PDF's own text size/family so the edit box
                      // doesn't look like a foreign layer pasted on top.
                      // cqw = % of the page wrap width → auto-scales with zoom.
                      fontSize: `${(b.fontSize / page.width) * 100}cqw`,
                      fontFamily: fontStackForBlock(b),
                      fontWeight: b.bold ? 700 : 400,
                      lineHeight: 1.25,
                      // Auto-match the block's sampled glyph color while editing.
                      ...(b.fgRgb ? { color: rgbToCss(b.fgRgb) } : null),
                    } as React.CSSProperties;
                    if (isEditing) {
                      return (
                        <div
                          key={b.id}
                          className="edit-block editing"
                          style={editStyle}
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
                    // Edited blocks show their NEW text on the page (not just
                    // a wash over the bitmap's old glyphs): the div masks the
                    // original line with the sampled background and draws the
                    // edited words in the block's own font/color/size — the
                    // same cover-and-redraw the download does. Unedited blocks
                    // stay empty so the bitmap shows through untouched.
                    const displayStyle = isEdited
                      ? {
                          ...editStyle,
                          background: b.bgRgb ? rgbToCss(b.bgRgb) : '#ffffff',
                          whiteSpace: 'pre-wrap' as const,
                          overflow: 'visible' as const,
                        }
                      : style;
                    return (
                      <div
                        key={b.id}
                        className={`edit-block${isEdited ? ' edited' : ''}${showOutlines ? ' outlined' : ''}${tool === 'select' && selBlock === b.id ? ' selected' : ''}`}
                        style={displayStyle}
                        title={tool === 'select' ? 'Click to select, double-click to edit' : 'Click to edit'}
                        onClick={() => {
                          if (tool === 'select') {
                            setSelBlock(b.id);
                            setSelOverlay(null);
                          } else {
                            setEditingId(b.id);
                          }
                        }}
                        onDoubleClick={() => {
                          if (tool === 'select') setEditingId(b.id);
                        }}
                      >
                        {isEdited ? b.editedText : null}
                      </div>
                    );
                  })}
                </div>
                {/* ---- annotation display layer (toolbar overlays) ---- */}
                <div
                  className="annot-layer"
                  style={{ pointerEvents: 'none' }}
                  onClick={() => {
                    setSelOverlay(null);
                    setSelBlock(null);
                  }}
                >
                  {/* vector overlays: drawings + shapes (+ live gesture preview) */}
                  <svg
                    className="annot-svg"
                    viewBox={`0 0 ${page.width} ${page.height}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {overlays
                      .filter((o) => o.pageNum === page.pageNum && (o.kind === 'draw' || o.kind === 'shape' || o.kind === 'underline' || o.kind === 'strikeout'))
                      .map((o) => {
                        const col = rgbToCss(o.color ?? { r: 0, g: 0, b: 0 }, o.opacity ?? 1);
                        const fy = (y: number) => page.height - y;
                        const sel = selOverlay === o.id;
                        if (o.kind === 'underline' || o.kind === 'strikeout') {
                          const ly = o.kind === 'underline' ? o.y + 2 : o.y + o.h * 0.45;
                          return (
                            <g key={o.id}>
                              <line x1={o.x} y1={fy(ly)} x2={o.x + o.w} y2={fy(ly)}
                                stroke={sel ? '#0f766e' : col} strokeWidth={o.thickness ?? 1.5} strokeLinecap="round" />
                              {sel && (
                                <rect x={o.x} y={fy(o.y + o.h)} width={o.w} height={o.h}
                                  fill="none" stroke="#0f766e" strokeWidth={1.5} strokeDasharray="5 3" />
                              )}
                            </g>
                          );
                        }
                        if (o.kind === 'draw' && o.strokes) {
                          return (
                            <g key={o.id}>
                              {o.strokes.map((st, i) => (
                                <polyline
                                  key={i}
                                  points={st.map((p) => `${p.x},${fy(p.y)}`).join(' ')}
                                  fill="none"
                                  stroke={col}
                                  strokeWidth={o.thickness ?? 2.5}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              ))}
                              {sel && (
                                <rect
                                  x={o.x} y={fy(o.y + o.h)} width={o.w} height={o.h}
                                  fill="none" stroke="#0f766e" strokeWidth={1.5} strokeDasharray="5 3"
                                />
                              )}
                            </g>
                          );
                        }
                        if (o.kind === 'shape') {
                          const sw = o.thickness ?? 2;
                          const dash = sel ? { strokeDasharray: '5 3' } : {};
                          if (o.shape === 'ellipse')
                            return (
                              <ellipse
                                key={o.id} cx={o.x + o.w / 2} cy={fy(o.y + o.h / 2)}
                                rx={Math.max(0.5, o.w / 2)} ry={Math.max(0.5, o.h / 2)}
                                fill={o.fill ? rgbToCss(o.fill, o.opacity ?? 0.25) : 'none'}
                                stroke={sel ? '#0f766e' : col} strokeWidth={sw} {...dash}
                              />
                            );
                          if (o.shape === 'line')
                            return (
                              <line
                                key={o.id} x1={o.x} y1={fy(o.y)} x2={o.x + o.w} y2={fy(o.y + o.h)}
                                stroke={sel ? '#0f766e' : col} strokeWidth={sw} strokeLinecap="round" {...dash}
                              />
                            );
                          return (
                            <rect
                              key={o.id} x={o.x} y={fy(o.y + o.h)} width={o.w} height={o.h}
                              fill={o.fill ? rgbToCss(o.fill, o.opacity ?? 0.25) : 'none'}
                              stroke={sel ? '#0f766e' : col} strokeWidth={sw} {...dash}
                            />
                          );
                        }
                        return null;
                      })}
                    {(() => {
                      const g = gestureRef.current;
                      if (!g) return null;
                      const col = rgbToCss(hexToRgb(penHex), 0.9);
                      const fy = (y: number) => page.height - y;
                      if (g.kind === 'draw')
                        return (
                          <polyline
                            points={g.pts.map((p) => `${p.x},${fy(p.y)}`).join(' ')}
                            fill="none" stroke={col} strokeWidth={2.5}
                            strokeLinecap="round" strokeLinejoin="round"
                          />
                        );
                      const last = g.pts[g.pts.length - 1];
                      const x0 = Math.min(g.startX, last.x);
                      const x1 = Math.max(g.startX, last.x);
                      const y0 = Math.min(g.startY, last.y);
                      const y1 = Math.max(g.startY, last.y);
                      if (g.kind === 'highlight') {
                        // Preview uses the same snapped band as the commit, so
                        // the yellow the user sees while dragging is the yellow
                        // that lands (a raw drag rect is ~0 high = invisible).
                        const midY = (y0 + y1) / 2;
                        const snap = snapHighlightY(page.blocks, midY);
                        return (
                          <rect x={x0} y={fy(snap.cy + snap.h / 2)} width={x1 - x0} height={snap.h}
                            fill="rgba(255, 224, 102, 0.45)" stroke="none" />
                        );
                      }
                      if (g.kind === 'whiteout') {
                        // White fill + dashed grey edge so the cover is visible
                        // while dragging (a plain white rect on white is not).
                        return (
                          <rect x={x0} y={fy(y1)} width={x1 - x0} height={y1 - y0}
                            fill="#ffffff" stroke="#999" strokeWidth={1} strokeDasharray="4 3" />
                        );
                      }
                      if (g.kind === 'underline' || g.kind === 'strikeout') {
                        const ly = g.kind === 'underline' ? y0 + 2 : (y0 + y1) / 2;
                        return <line x1={x0} y1={fy(ly)} x2={x1} y2={fy(ly)} stroke={col} strokeWidth={1.5} strokeLinecap="round" />;
                      }
                      if (shapeKind === 'ellipse')
                        return <ellipse cx={(x0 + x1) / 2} cy={fy((y0 + y1) / 2)} rx={(x1 - x0) / 2} ry={(y1 - y0) / 2} fill="none" stroke={col} strokeWidth={2} />;
                      if (shapeKind === 'line')
                        return <line x1={x0} y1={fy(y0)} x2={x1} y2={fy(y1)} stroke={col} strokeWidth={2} strokeLinecap="round" />;
                      return <rect x={x0} y={fy(y1)} width={x1 - x0} height={y1 - y0} fill="none" stroke={col} strokeWidth={2} />;
                    })()}
                  </svg>
                  {/* box overlays: text / highlight / image */}
                  {overlays
                    .filter((o) => o.pageNum === page.pageNum && (o.kind === 'text' || o.kind === 'highlight' || o.kind === 'image' || o.kind === 'whiteout'))
                    .map((o) => {
                      const sel = selOverlay === o.id;
                      const boxStyle = {
                        left: `${(o.x / page.width) * 100}%`,
                        top: `${((page.height - (o.y + o.h)) / page.height) * 100}%`,
                        width: `${(o.w / page.width) * 100}%`,
                        height: `${(o.h / page.height) * 100}%`,
                      } as React.CSSProperties;
                      if (o.kind === 'highlight') {
                        return (
                          <div
                            key={o.id}
                            data-ov-id={o.id}
                            className={`annot annot-hl${sel ? ' selected' : ''}`}
                            style={{ ...boxStyle, background: rgbToCss(o.fill ?? { r: 1, g: 0.92, b: 0.35 }, o.opacity ?? 0.35), pointerEvents: 'auto' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelOverlay(o.id);
                            }}
                          >
                            {sel && (
                              <button type="button" className="annot-del" aria-label="Delete highlight"
                                onClick={(e) => { e.stopPropagation(); deleteSelOverlay(); }}>×</button>
                            )}
                          </div>
                        );
                      }
                      if (o.kind === 'whiteout') {
                        return (
                          <div
                            key={o.id}
                            data-ov-id={o.id}
                            className={`annot annot-whiteout${sel ? ' selected' : ''}`}
                            style={{ ...boxStyle, pointerEvents: 'auto' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelOverlay(o.id);
                            }}
                          >
                            {sel && (
                              <button type="button" className="annot-del" aria-label="Delete whiteout"
                                onClick={(e) => { e.stopPropagation(); deleteSelOverlay(); }}>×</button>
                            )}
                          </div>
                        );
                      }
                      if (o.kind === 'image') {
                        const url = imgUrlCache.current.get(o.id);
                        return (
                          <div
                            key={o.id}
                            data-ov-id={o.id}
                            className={`annot annot-img${sel ? ' selected' : ''}`}
                            style={{ ...boxStyle, pointerEvents: 'auto' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelOverlay(o.id);
                            }}
                          >
                            {url ? <img src={url} alt="Placed image" draggable={false} /> : null}
                            {sel && (
                              <button type="button" className="annot-del" aria-label="Delete image"
                                onClick={(e) => { e.stopPropagation(); deleteSelOverlay(); }}>×</button>
                            )}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={o.id}
                          data-ov-id={o.id}
                          className={`annot annot-text${sel ? ' selected' : ''}`}
                          // Height hugs the wrapped text: a fixed single-line
                          // box height let 3 wrapped lines spill outside the
                          // dashed outline (and below the page edge in the
                          // editor). minHeight keeps a 1-line box unchanged.
                          style={{ ...boxStyle, height: 'auto', minHeight: boxStyle.height, pointerEvents: 'auto' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelOverlay(o.id);
                          }}
                        >
                          <div
                            contentEditable
                            suppressContentEditableWarning
                            spellCheck={false}
                            className="annot-textedit"
                            style={{
                              fontSize: `${(((o.fontSize ?? 14) / page.width) * 100).toFixed(3)}cqw`,
                              color: rgbToCss(o.color ?? { r: 0, g: 0, b: 0 }),
                              fontFamily: cssStackForOverlay(o),
                              fontWeight: o.bold ? 700 : 400,
                              fontStyle: o.italic ? 'italic' : 'normal',
                              textAlign: o.align ?? 'left',
                              textDecoration: o.underline ? 'underline' : 'none',
                              lineHeight: 1.25,
                            }}
                            ref={(el) => {
                              if (el && document.activeElement !== el && el.innerText !== (o.text ?? '')) {
                                el.innerText = o.text ?? '';
                              }
                            }}
                            onFocus={() => setSelOverlay(o.id)}
                            onBlur={(e) => commitTextOverlay(o.id, e.currentTarget.innerText)}
                          />
                          {sel && (
                            <button type="button" className="annot-del" aria-label="Delete text"
                              onClick={(e) => { e.stopPropagation(); deleteSelOverlay(); }}>×</button>
                            )}
                        </div>
                      );
                    })}
                </div>
                {/* ---- capture layer for annotation gestures ---- */}
                {(tool === 'add-text' || tool === 'highlight' || tool === 'underline' || tool === 'strikeout' || tool === 'draw' || tool === 'shape' || tool === 'image' || tool === 'whiteout') && (
                  <div
                    className="annot-capture"
                    style={{ cursor: tool === 'add-text' || tool === 'image' ? 'text' : 'crosshair', touchAction: 'none' }}
                    onPointerDown={onAnnotDown}
                    onPointerMove={onAnnotMove}
                    onPointerUp={onAnnotUp}
                    onPointerCancel={onAnnotUp}
                    title={
                      tool === 'add-text' ? 'Click to place text'
                      : tool === 'image' ? 'Click to place an image'
                      : 'Drag to annotate'
                    }
                  />
                )}
              </div>
            </div>
            <p className="opt-hint" style={{ marginTop: '0.5rem' }}>
              Click any text on the page to edit it in place. Edited blocks are highlighted.
            </p>
              </>
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

      {sigPadOpen && (
        <div className="modal-overlay" role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Draw your signature"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <strong>Draw your signature</strong>
                <div className="opt-hint">Pen, finger, stylus or mouse — then click the page to place it.</div>
              </div>
              <button type="button" className="mini-btn" onClick={() => setSigPadOpen(false)} aria-label="Close signature pad">
                ✕
              </button>
            </div>
            <div className="modal-body">
              <canvas
                ref={sigCanvasRef}
                className="sig-pad"
                style={{ touchAction: 'none', cursor: 'crosshair' }}
                onPointerDown={sigStart}
                onPointerMove={sigMove}
                onPointerUp={sigEnd}
                onPointerCancel={sigEnd}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={sigPlace} disabled={!sigHasInk}>
                Place signature
              </button>
              <button type="button" className="mini-btn" onClick={sigClear}>
                Clear
              </button>
              <span className="opt-hint">After placing, click on the page where the signature goes.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
