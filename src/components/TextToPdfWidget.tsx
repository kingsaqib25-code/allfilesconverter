'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ConverterEntry } from '@/lib/converters/registry';
import {
  DEFAULT_TEXT_PDF_SETTINGS,
  MARGIN_CHOICES,
  PAGE_SIZES,
  buildTextPdf,
  createMeasureFn,
  pageDimensions,
  paginateBlocks,
  textToBlocks,
  textPdfFilename,
  type Block,
  type MeasureFn,
  type PdfPage,
  type TextPdfAlign,
  type TextPdfFont,
  type TextPdfOrientation,
  type TextPdfPageSize,
  type TextPdfSettings,
  type TextRun,
} from '@/lib/converters/text-to-pdf';

type Props = { entry: ConverterEntry };

const SAMPLE_BLOCKS: Block[] = [
  { kind: 'h1', runs: [{ text: 'My Project Proposal' }] },
  {
    kind: 'para',
    runs: [
      { text: 'This is a sample document. Select any words above and use the ' },
      { text: 'B', bold: true },
      { text: ', ' },
      { text: 'I', italic: true },
      { text: ' and ' },
      { text: 'U', underline: true },
      { text: ' buttons — or make a ' },
      { text: 'heading', bold: true },
      { text: ' and a ' },
      { text: 'list', bold: true },
      { text: ' with the toolbar. Type or paste your own text and watch the preview update live.' },
    ],
  },
  { kind: 'h2', runs: [{ text: 'What this editor can do' }] },
  { kind: 'bullet', runs: [{ text: 'Bold, italic and underline on any selection' }] },
  { kind: 'bullet', runs: [{ text: 'Headings and bulleted or numbered lists' }] },
  { kind: 'bullet', runs: [{ text: 'Fonts, sizes, spacing, alignment, margins, colour, A4 or Letter, portrait or landscape' }] },
  {
    kind: 'para',
    runs: [
      { text: 'When you are happy with how it looks, hit Download PDF and the file is yours in one click. ' },
      { text: 'Everything runs in your browser — nothing is uploaded.', italic: true },
    ],
  },
  { kind: 'number', runs: [{ text: 'Write your text' }] },
  { kind: 'number', runs: [{ text: 'Style it with the toolbar' }] },
  { kind: 'number', runs: [{ text: 'Download the PDF' }] },
];

const FONT_CSS: Record<TextPdfFont, string> = {
  helvetica: 'Arial, Helvetica, sans-serif',
  times: "'Times New Roman', Times, serif",
  courier: "'Courier New', Courier, monospace",
};

const COLOR_SWATCHES = ['#000000', '#1e3a5f', '#0f766e', '#7c2d12', '#444444', '#1d4ed8'];

const SCALE = 0.72;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function runToHtml(r: TextRun): string {
  let t = escapeHtml(r.text);
  if (r.code) t = `<code>${t}</code>`;
  if (r.underline) t = `<u>${t}</u>`;
  if (r.italic) t = `<i>${t}</i>`;
  if (r.bold) t = `<b>${t}</b>`;
  if (r.strike) t = `<s>${t}</s>`;
  if (r.color) t = `<span style="color:${escapeHtml(r.color)}">${t}</span>`;
  if (r.highlight) t = `<span style="background-color:${escapeHtml(r.highlight)}">${t}</span>`;
  if (r.link) t = `<a href="${escapeHtml(r.link)}">${t}</a>`;
  return t;
}

function blocksToHtml(blocks: Block[]): string {
  let out = '';
  let list: 'ul' | 'ol' | null = null;
  const close = () => {
    if (list) {
      out += `</${list}>`;
      list = null;
    }
  };
  for (const b of blocks) {
    if (b.kind === 'image' && b.image) {
      close();
      out += `<p><img src="${escapeHtml(b.image.src)}" width="${b.image.width}" height="${b.image.height}" alt=""></p>`;
      continue;
    }
    const inner = b.runs.map(runToHtml).join('') || '<br>';
    const alignAttr = b.align ? ` style="text-align:${b.align}"` : '';
    if (b.kind === 'bullet' || b.kind === 'number') {
      const want = b.kind === 'bullet' ? 'ul' : 'ol';
      if (list !== want) {
        close();
        out += `<${want}>`;
        list = want;
      }
      out += `<li${alignAttr}>${inner}</li>`;
    } else {
      close();
      const tag = b.kind === 'h1' ? 'h1' : b.kind === 'h2' ? 'h2' : 'p';
      out += `<${tag}${alignAttr}>${inner}</${tag}>`;
    }
  }
  close();
  return out;
}

/** Editor HTML -> blocks. Browser-only (DOMParser). */
function parseEditorHtml(html: string): Block[] {
  if (typeof window === 'undefined' || !html.trim()) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks: Block[] = [];

  const walkRuns = (
    node: Node,
    flags: Omit<TextRun, 'text'>,
    out: TextRun[],
  ) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        const t = child.textContent ?? '';
        if (t) out.push({ ...flags, text: t });
      } else if (child.nodeType === 1) {
        const el = child as HTMLElement;
        const tag = el.tagName.toLowerCase();
        const f: Omit<TextRun, 'text'> = { ...flags };
        if (tag === 'b' || tag === 'strong') f.bold = true;
        if (tag === 'i' || tag === 'em') f.italic = true;
        if (tag === 'u') f.underline = true;
        if (tag === 'code') f.code = true;
        if (tag === 's' || tag === 'del' || tag === 'strike') f.strike = true;
        if (tag === 'a') {
          const href = el.getAttribute('href');
          if (href) f.link = href;
        }
        if (tag === 'font') {
          const c = el.getAttribute('color');
          if (c) f.color = c;
        }
        if (el.style.color) f.color = el.style.color;
        if (el.style.backgroundColor) f.highlight = el.style.backgroundColor;
        if (tag === 'br') {
          out.push({ ...flags, text: '\n' });
          return;
        }
        const w = parseInt(el.style.fontWeight || '0', 10);
        if (w >= 600 || el.style.fontWeight === 'bold') f.bold = true;
        if (el.style.fontStyle === 'italic') f.italic = true;
        if ((el.style.textDecoration || '').includes('underline')) f.underline = true;
        walkRuns(el, f, out);
      }
    });
  };

  const runsOf = (el: Element): TextRun[] => {
    const out: TextRun[] = [];
    walkRuns(el, {}, out);
    return out;
  };

  // <br> inside a block splits it into separate blocks.
  const pushKind = (kind: Block['kind'], runs: TextRun[], align?: TextPdfAlign, image?: Block['image']) => {
    let cur: TextRun[] = [];
    const flush = () => {
      blocks.push({ kind, runs: cur, align, image });
      cur = [];
    };
    for (const r of runs) {
      const parts = r.text.split('\n');
      parts.forEach((p, i) => {
        if (i > 0) flush();
        if (p) cur.push({ ...r, text: p });
      });
    }
    flush();
  };

  /** text-align set by the toolbar's alignment buttons (execCommand justify*). */
  const blockAlign = (el: Element): TextPdfAlign | undefined => {
    const t = (el as HTMLElement).style?.textAlign?.toLowerCase();
    return t === 'left' || t === 'center' || t === 'right' || t === 'justify' ? t : undefined;
  };

  doc.body.childNodes.forEach((node) => {
    if (node.nodeType === 3) {
      const t = node.textContent ?? '';
      if (t.trim()) pushKind('para', [{ text: t }]);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    // Pictures: a bare <img>, or an <img> nested in a block (the toolbar's
    // insert wraps it in a <p>). Any text around it becomes its own block.
    if (tag === 'img' || tag === 'p' || tag === 'div') {
      const imgEls =
        tag === 'img' ? [el] : Array.from(el.querySelectorAll('img'));
      if (imgEls.length > 0) {
        const textRuns = runsOf(el);
        if (textRuns.some((r) => r.text.trim())) {
          pushKind('para', textRuns, blockAlign(el));
        }
        for (const im of imgEls) {
          const src = im.getAttribute('src') ?? '';
          const w = parseInt(im.getAttribute('width') || '', 10) || 600;
          const h = parseInt(im.getAttribute('height') || '', 10) || 400;
          if (src) blocks.push({ kind: 'image', runs: [], image: { src, width: w, height: h } });
        }
        return;
      }
    }
    if (tag === 'h1') pushKind('h1', runsOf(el), blockAlign(el));
    else if (tag === 'h2') pushKind('h2', runsOf(el), blockAlign(el));
    else if (tag === 'ul') {
      el.querySelectorAll(':scope > li').forEach((li) => pushKind('bullet', runsOf(li), blockAlign(li)));
    } else if (tag === 'ol') {
      el.querySelectorAll(':scope > li').forEach((li) => pushKind('number', runsOf(li), blockAlign(li)));
    } else if (tag === 'li') pushKind('bullet', runsOf(el), blockAlign(el));
    else pushKind('para', runsOf(el), blockAlign(el));
  });
  return blocks;
}

function plainTextOf(blocks: Block[]): string {
  return blocks.flatMap((b) => b.runs.map((r) => r.text)).join('');
}

function wordCountOf(blocks: Block[]): number {
  const t = plainTextOf(blocks).trim();
  return t ? t.split(/\s+/).length : 0;
}

interface FmtState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  block: string;
  ul: boolean;
  ol: boolean;
  align: TextPdfAlign;
  link: string | null;
}

/** Downscale + convert an uploaded picture to a PDF-safe data URL (PNG kept
 *  when small, otherwise JPEG on white). Caps width at 1200px. */
function prepareImage(file: File): Promise<{ src: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a readable image.'));
      img.onload = () => {
        const maxW = 1200;
        const scaleDown = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
        const w = Math.max(1, Math.round(img.naturalWidth * scaleDown));
        const h = Math.max(1, Math.round(img.naturalHeight * scaleDown));
        const keepPng = file.type === 'image/png' && file.size <= 800 * 1024 && scaleDown === 1;
        if (keepPng) {
          resolve({ src: String(reader.result), width: w, height: h });
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not process that image.'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ src: canvas.toDataURL('image/jpeg', 0.85), width: w, height: h });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export default function TextToPdfWidget({ entry }: Props) {
  const [html, setHtml] = useState('');
  const [settings, setSettings] = useState<TextPdfSettings>(DEFAULT_TEXT_PDF_SETTINGS);
  const [measure, setMeasure] = useState<MeasureFn | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [fmt, setFmt] = useState<FmtState>({ bold: false, italic: false, underline: false, strike: false, block: 'p', ul: false, ol: false, align: 'left', link: null });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const imgRef = useRef<HTMLInputElement>(null);
  // Editor/preview split: editor width in % of the row (draggable divider).
  const [split, setSplit] = useState(50);
  // Preview scale: A4 at 0.72 fits a wide column; shrink it to fit when the
  // user drags the preview narrower (or on a small screen) so the page never
  // runs wider than its column.
  const [scale, setScale] = useState(SCALE);
  const gridRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const deferredHtml = useDeferredValue(html);

  // (Re)embed the selected font family for live measurement.
  useEffect(() => {
    let alive = true;
    setMeasure(null);
    createMeasureFn(settings.font)
      .then((m) => {
        // NOTE: wrap in () => m — passing a function straight to a useState
        // setter makes React call it as an updater with the previous state,
        // so setMeasure(m) invoked the measure fn as m(null) and crashed
        // the page ("Cannot read properties of null (reading 'replace')").
        if (alive) setMeasure(() => m);
      })
      .catch(() => {
        if (alive) setError('The PDF font could not load. Reload the page and try again.');
      });
    return () => {
      alive = false;
    };
  }, [settings.font]);

  const blocks: Block[] = useMemo(() => parseEditorHtml(deferredHtml), [deferredHtml]);
  const plain = plainTextOf(blocks);
  const hasContent =
    plain.trim() !== '' || blocks.some((b) => b.kind === 'image' && b.image);

  const pages: PdfPage[] = useMemo(() => {
    if (!measure || !hasContent) return [];
    try {
      return paginateBlocks(blocks, settings, measure);
    } catch {
      return [];
    }
  }, [blocks, settings, measure, hasContent]);

  const refreshFmt = () => {
    try {
      const sel = window.getSelection();
      const anchor = sel?.anchorNode;
      const anchorEl =
        anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
      const linkEl = anchorEl?.closest?.('a') as HTMLAnchorElement | null;
      setFmt({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strike: document.queryCommandState('strikeThrough'),
        block: (document.queryCommandValue('formatBlock') || 'p').toLowerCase(),
        ul: document.queryCommandState('insertUnorderedList'),
        ol: document.queryCommandState('insertOrderedList'),
        align: document.queryCommandState('justifyCenter')
          ? 'center'
          : document.queryCommandState('justifyRight')
            ? 'right'
            : document.queryCommandState('justifyFull')
              ? 'justify'
              : 'left',
        link: linkEl?.getAttribute('href') ?? null,
      });
    } catch {
      /* selection outside the editor — ignore */
    }
  };

  useEffect(() => {
    document.addEventListener('selectionchange', refreshFmt);
    return () => document.removeEventListener('selectionchange', refreshFmt);
  }, []);

  const syncHtml = () => setHtml(editorRef.current?.innerHTML ?? '');

  const setEditorHtml = (next: string) => {
    if (editorRef.current) editorRef.current.innerHTML = next;
    setHtml(next);
    setDone(false);
  };

  const exec = (cmd: string, value?: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus();
    document.execCommand(cmd, false, value);
    syncHtml();
    refreshFmt();
  };

  /** Apply a hyperlink to the current selection (or remove it when empty). */
  const applyLink = () => {
    const url = linkUrl.trim();
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus();
    if (!url) {
      document.execCommand('unlink', false);
    } else {
      const full = /^([a-z][a-z0-9+.-]*:|#|mailto:)/i.test(url) ? url : `https://${url}`;
      document.execCommand('createLink', false, full);
    }
    setLinkOpen(false);
    syncHtml();
    refreshFmt();
  };

  const openLinkBox = () => {
    setLinkUrl(fmt.link ?? '');
    setLinkOpen(true);
  };

  /** Insert an uploaded picture at the caret as its own paragraph. */
  const insertImage = async (file: File) => {
    setError(null);
    try {
      const pic = await prepareImage(file);
      const ed = editorRef.current;
      if (!ed) return;
      ed.focus();
      document.execCommand(
        'insertHTML',
        false,
        `<p><img src="${pic.src}" width="${pic.width}" height="${pic.height}" alt=""></p><p><br></p>`,
      );
      syncHtml();
      setDone(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that image.');
    }
  };

  const toggleHeading = (tag: 'h1' | 'h2') => {
    exec('formatBlock', fmt.block === tag ? 'p' : tag);
  };

  const clearFormatting = () => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus();
    document.execCommand('removeFormat', false);
    document.execCommand('formatBlock', false, 'p');
    if (fmt.ul) document.execCommand('insertUnorderedList', false);
    if (fmt.ol) document.execCommand('insertOrderedList', false);
    syncHtml();
    refreshFmt();
  };

  const set = <K extends keyof TextPdfSettings>(key: K, value: TextPdfSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  const loadFile = async (file: File) => {
    setError(null);
    try {
      const src = await file.text();
      if (!src.trim()) throw new Error('That text file looks empty.');
      setEditorHtml(blocksToHtml(textToBlocks(src)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  const download = async () => {
    if (!hasContent) {
      setError('Type or paste some text first.');
      return;
    }
    setWorking(true);
    setError(null);
    setDone(false);
    try {
      const blob = await buildTextPdf(blocks, settings);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = textPdfFilename(settings.title);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The PDF could not be built. Try again.');
    } finally {
      setWorking(false);
    }
  };

  const dims = pageDimensions(settings);
  const pageW = Math.round(dims.width * scale);
  const pageH = Math.round(dims.height * scale);

  // Keep the preview page fitting its column: re-measure whenever the column
  // width can change (drag, page size, orientation).
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const update = () => {
      const avail = el.clientWidth - 32; // container padding
      const w = pageDimensions(settings).width;
      setScale(Math.min(SCALE, Math.max(0.3, avail / w)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [settings]);

  // Divider drag (mouse + touch via pointer events).
  const moveSplit = (clientX: number) => {
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    if (rect.width <= 0) return;
    setSplit(Math.min(75, Math.max(25, ((clientX - rect.left) / rect.width) * 100)));
  };
  const onSplitterDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.classList.add('dragging');
    moveSplit(e.clientX);
  };
  const onSplitterMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) moveSplit(e.clientX);
  };
  const onSplitterUp = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    e.currentTarget.classList.remove('dragging');
  };
  const onSplitterKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSplit((s) => Math.max(25, s - step));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSplit((s) => Math.min(75, s + step));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setSplit(50);
    }
  };

  return (
    <div className="widget widget-wide ttp-widget">
      {/* ---------- formatting toolbar ---------- */}
      <div className="ttp-formatbar" role="toolbar" aria-label="Text formatting">
        <button
          type="button"
          className={`ttp-fmt-btn ${fmt.bold ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('bold')}
          aria-pressed={fmt.bold}
          title="Bold (Ctrl+B)"
        >
          <b>B</b>
        </button>
        <button
          type="button"
          className={`ttp-fmt-btn ${fmt.italic ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('italic')}
          aria-pressed={fmt.italic}
          title="Italic (Ctrl+I)"
        >
          <i>I</i>
        </button>
        <button
          type="button"
          className={`ttp-fmt-btn ${fmt.underline ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('underline')}
          aria-pressed={fmt.underline}
          title="Underline (Ctrl+U)"
        >
          <u>U</u>
        </button>
        <span className="ttp-fmt-sep" />
        <button
          type="button"
          className={`ttp-fmt-btn ${fmt.block === 'h1' ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleHeading('h1')}
          aria-pressed={fmt.block === 'h1'}
          title="Heading 1"
        >
          H1
        </button>
        <button
          type="button"
          className={`ttp-fmt-btn ${fmt.block === 'h2' ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleHeading('h2')}
          aria-pressed={fmt.block === 'h2'}
          title="Heading 2"
        >
          H2
        </button>
        <span className="ttp-fmt-sep" />
        <button
          type="button"
          className={`ttp-fmt-btn ${fmt.ul ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('insertUnorderedList')}
          aria-pressed={fmt.ul}
          title="Bulleted list"
        >
          • List
        </button>
        <button
          type="button"
          className={`ttp-fmt-btn ${fmt.ol ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('insertOrderedList')}
          aria-pressed={fmt.ol}
          title="Numbered list"
        >
          1. List
        </button>
        <span className="ttp-fmt-sep" />
        <button
          type="button"
          className="ttp-fmt-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={clearFormatting}
          title="Clear formatting"
        >
          Clear format
        </button>
        <span className="ttp-fmt-sep" />
        <button
          type="button"
          className={`ttp-fmt-btn ${fmt.strike ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('strikeThrough')}
          aria-pressed={fmt.strike}
          title="Strikethrough"
        >
          <span style={{ textDecoration: 'line-through' }}>S</span>
        </button>
        <button
          type="button"
          className="ttp-fmt-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openLinkBox}
          title="Add a link to the selected text"
        >
          🔗 Link
        </button>
        <button
          type="button"
          className="ttp-fmt-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => imgRef.current?.click()}
          title="Insert an image"
        >
          🖼 Image
        </button>
        <input
          ref={imgRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void insertImage(f);
            e.target.value = '';
          }}
        />
        <span className="ttp-fmt-sep" />
        <button
          type="button"
          className={`ttp-fmt-btn ${fmt.align === 'left' ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('justifyLeft')}
          aria-pressed={fmt.align === 'left'}
          title="Align left"
        >
          Left
        </button>
        <button
          type="button"
          className={`ttp-fmt-btn ${fmt.align === 'center' ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('justifyCenter')}
          aria-pressed={fmt.align === 'center'}
          title="Align center"
        >
          Center
        </button>
        <button
          type="button"
          className={`ttp-fmt-btn ${fmt.align === 'right' ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('justifyRight')}
          aria-pressed={fmt.align === 'right'}
          title="Align right"
        >
          Right
        </button>
        <button
          type="button"
          className={`ttp-fmt-btn ${fmt.align === 'justify' ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('justifyFull')}
          aria-pressed={fmt.align === 'justify'}
          title="Justify"
        >
          Justify
        </button>
        <span className="ttp-fmt-sep" />
        <label className="ttp-fmt-color" title="Text colour — applies to the selected text">
          A
          <input
            type="color"
            defaultValue="#000000"
            aria-label="Text colour for selected text"
            onChange={(e) => exec('foreColor', e.target.value)}
          />
        </label>
        <label className="ttp-fmt-color" title="Highlight — applies to the selected text">
          ✎
          <input
            type="color"
            defaultValue="#ffff00"
            aria-label="Highlight colour for selected text"
            onChange={(e) => exec('hiliteColor', e.target.value)}
          />
        </label>
        <button
          type="button"
          className="ttp-fmt-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('hiliteColor', 'transparent')}
          title="Clear highlight"
        >
          ✕ HL
        </button>
      </div>

      {/* ---------- link popover ---------- */}
      {linkOpen ? (
        <div className="ttp-linkbar">
          <span>{fmt.link ? 'Edit the link for the selected text.' : 'Select text first, then add the link.'}</span>
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://example.com"
            aria-label="Link address"
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyLink();
            }}
          />
          <button type="button" className="btn secondary" onClick={applyLink}>
            Apply link
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              const ed = editorRef.current;
              if (ed) {
                ed.focus();
                document.execCommand('unlink', false);
                syncHtml();
                refreshFmt();
              }
              setLinkOpen(false);
            }}
          >
            Remove link
          </button>
          <button type="button" className="btn secondary" onClick={() => setLinkOpen(false)}>
            Cancel
          </button>
        </div>
      ) : null}

      {/* ---------- document settings ---------- */}
      <div className="ttp-toolbar">
        <label className="ttp-field">
          <span>Document title</span>
          <input
            type="text"
            value={settings.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Optional — appears at the top of page 1"
            aria-label="Document title"
          />
        </label>
        <label className="ttp-field">
          <span>Font</span>
          <select value={settings.font} onChange={(e) => set('font', e.target.value as TextPdfFont)} aria-label="Font">
            <option value="helvetica">Helvetica (clean)</option>
            <option value="times">Times (classic)</option>
            <option value="courier">Courier (typewriter)</option>
          </select>
        </label>
        <label className="ttp-field">
          <span>Text size</span>
          <select
            value={settings.fontSize}
            onChange={(e) => set('fontSize', Number(e.target.value))}
            aria-label="Text size"
          >
            {[10, 11, 12, 14, 16, 18].map((n) => (
              <option key={n} value={n}>
                {n} pt
              </option>
            ))}
          </select>
        </label>
        <label className="ttp-field">
          <span>Line spacing</span>
          <select
            value={settings.lineHeight}
            onChange={(e) => set('lineHeight', Number(e.target.value))}
            aria-label="Line spacing"
          >
            <option value={1.15}>Single</option>
            <option value={1.5}>1.5 lines</option>
            <option value={2}>Double</option>
          </select>
        </label>
        <label className="ttp-field">
          <span>Align</span>
          <select value={settings.align} onChange={(e) => set('align', e.target.value as TextPdfAlign)} aria-label="Alignment">
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
            <option value="justify">Justified</option>
          </select>
        </label>
        <label className="ttp-field">
          <span>Margins</span>
          <select
            value={settings.margin}
            onChange={(e) => set('margin', Number(e.target.value))}
            aria-label="Margins"
          >
            {MARGIN_CHOICES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ttp-field">
          <span>Page size</span>
          <select
            value={settings.pageSize}
            onChange={(e) => set('pageSize', e.target.value as TextPdfPageSize)}
            aria-label="Page size"
          >
            <option value="a4">A4</option>
            <option value="letter">Letter (US)</option>
          </select>
        </label>
        <label className="ttp-field">
          <span>Orientation</span>
          <select
            value={settings.orientation}
            onChange={(e) => set('orientation', e.target.value as TextPdfOrientation)}
            aria-label="Orientation"
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
        <div className="ttp-field">
          <span>Text colour</span>
          <div className="ttp-color-row">
            <input
              type="color"
              value={settings.color}
              onChange={(e) => set('color', e.target.value)}
              aria-label="Text colour"
            />
            {COLOR_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                className={`ttp-swatch ${settings.color.toLowerCase() === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => set('color', c)}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
        </div>
        <label className="ttp-check">
          <input
            type="checkbox"
            checked={settings.pageNumbers}
            onChange={(e) => set('pageNumbers', e.target.checked)}
          />
          Page numbers
        </label>
      </div>

      {/* ---------- editor + live preview ---------- */}
      <div className="ttp-grid" ref={gridRef}>
        <div className="ttp-editor-col" style={{ flexBasis: `calc(${split}% - 8px)` }}>
          <div className="ttp-col-head">
            <strong>Your document</strong>
            <span>
              {wordCountOf(blocks)} words · {plain.length} characters
            </span>
          </div>
          <div
            ref={editorRef}
            className="ttp-editor"
            contentEditable
            suppressContentEditableWarning
            spellCheck
            data-placeholder="Type or paste your text here… Select words and use B, I, U, headings and lists above."
            aria-label="Text editor"
            onInput={() => {
              syncHtml();
              setDone(false);
            }}
            onPaste={(e) => {
              e.preventDefault();
              const pasted = e.clipboardData?.getData('text/plain') ?? '';
              if (!pasted) return;
              exec('insertHTML', blocksToHtml(textToBlocks(pasted)));
            }}
          />
          <div className="ttp-actions-row">
            <button type="button" className="btn secondary" onClick={() => fileRef.current?.click()}>
              Upload .txt file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,text/plain"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFile(f);
                e.target.value = '';
              }}
            />
            <button type="button" className="btn secondary" onClick={() => setEditorHtml(blocksToHtml(SAMPLE_BLOCKS))}>
              Sample text
            </button>
            <button type="button" className="btn secondary" onClick={() => setEditorHtml('')}>
              Clear
            </button>
          </div>
          <p className="ttp-hint">
            Select text, then use the toolbar — <b>B</b> bold, <i>I</i> italic, <u>U</u> underline,
            H1/H2 headings, bulleted and numbered lists. Pasted plain text keeps its{' '}
            <code># headings</code>, <code>- bullets</code>, <code>1. lists</code>,{' '}
            <code>**bold**</code> and <code>*italic*</code> too.
          </p>
        </div>

        {/* Draggable divider — drag left/right to resize editor vs preview.
            Double-click resets to 50/50; arrow keys work when focused. */}
        <div
          className="ttp-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Adjust editor and preview widths"
          aria-valuenow={Math.round(split)}
          aria-valuemin={25}
          aria-valuemax={75}
          tabIndex={0}
          onPointerDown={onSplitterDown}
          onPointerMove={onSplitterMove}
          onPointerUp={onSplitterUp}
          onPointerCancel={onSplitterUp}
          onKeyDown={onSplitterKey}
          onDoubleClick={() => setSplit(50)}
          title="Drag to resize — double-click to reset"
        />

        <div className="ttp-preview-col">
          <div className="ttp-col-head">
            <strong>Live preview</strong>
            <span>
              {pages.length} page{pages.length === 1 ? '' : 's'} · {entry.title}
            </span>
          </div>
          <div className="ttp-preview" ref={previewRef}>
            {!measure ? (
              <div className="ttp-page ttp-page-empty" style={{ width: pageW, height: pageH }}>
                Loading preview…
              </div>
            ) : !hasContent ? (
              <div className="ttp-page ttp-page-empty" style={{ width: pageW, height: pageH }}>
                Your PDF preview will appear here as you type.
              </div>
            ) : (
              pages.map((pg, pi) => (
                <div
                  key={pi}
                  className="ttp-page"
                  style={{
                    width: pageW,
                    height: pageH,
                    padding: `${Math.round(settings.margin * scale)}px`,
                    fontFamily: FONT_CSS[settings.font],
                    color: settings.color,
                  }}
                >
                  {pg.lines.map((line, li) => {
                    const ls = line.size;
                    const lh = line.lineH * scale;
                    return (
                      <div
                        key={li}
                        style={{
                          fontSize: `${ls * scale}px`,
                          lineHeight: `${lh}px`,
                          fontWeight:
                            line.isTitle || line.kind === 'h1' || line.kind === 'h2' ? 700 : undefined,
                          textAlign: line.isTitle
                            ? 'center'
                            : line.align === 'justify'
                              ? 'justify'
                              : line.align,
                          textAlignLast: line.align === 'justify' && !line.lastInPara ? 'justify' : undefined,
                          minHeight: `${lh}px`,
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                          paddingLeft: `${line.indent * scale}px`,
                        }}
                      >
                        {line.image ? (
                          <img
                            src={line.image.src}
                            alt=""
                            style={{
                              display: 'block',
                              width: `${line.image.width * scale}px`,
                              height: `${line.image.height * scale}px`,
                              maxWidth: '100%',
                            }}
                          />
                        ) : line.blank ? (
                          '\u00a0'
                        ) : (
                            <>
                              {line.prefix ? (
                                <span
                                  style={{
                                    display: 'inline-block',
                                    width: `${line.indent * scale}px`,
                                    marginLeft: `${-line.indent * scale}px`,
                                  }}
                                >
                                  {line.prefix.text}
                                </span>
                              ) : null}
                              {line.words.map((w, wi) => (
                                <span key={wi}>
                                  {wi > 0 ? ' ' : ''}
                                  {w.runs.map((r, ri) => {
                                    const deco = [r.underline ? 'underline' : '', r.strike ? 'line-through' : '']
                                      .filter(Boolean)
                                      .join(' ') || undefined;
                                    const inner = (
                                      <span
                                        key={ri}
                                        style={{
                                          fontWeight: r.bold ? 700 : undefined,
                                          fontStyle: r.italic ? 'italic' : undefined,
                                          textDecoration: deco,
                                          fontFamily: r.code ? "'Courier New', Courier, monospace" : undefined,
                                          background: r.code ? '#f1f1f1' : r.highlight ? r.highlight : undefined,
                                          color: r.color ? r.color : undefined,
                                          padding: r.code ? '0 2px' : undefined,
                                        }}
                                      >
                                        {r.text}
                                      </span>
                                    );
                                    return r.link ? (
                                      <a
                                        key={ri}
                                        href={r.link}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ color: r.color ?? '#1d4ed8', textDecoration: 'underline' }}
                                      >
                                        {inner}
                                      </a>
                                    ) : (
                                      inner
                                    );
                                  })}
                                </span>
                              ))}
                            </>
                          )}
                      </div>
                    );
                  })}
                  {settings.pageNumbers && pages.length > 1 ? (
                    <div className="ttp-pagenum">
                      Page {pi + 1} of {pages.length}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {error ? <p className="ttp-error">{error}</p> : null}
      {done ? <p className="ttp-done">Your PDF downloaded — check your downloads folder.</p> : null}

      <button type="button" className="btn block ttp-download" onClick={() => void download()} disabled={working || !hasContent}>
        {working ? 'Building your PDF…' : '⬇ Download PDF'}
      </button>
      <p className="ttp-privacy">
        Free forever · No sign-up · Your text never leaves your device — the PDF is built in your browser.
      </p>
    </div>
  );
}
