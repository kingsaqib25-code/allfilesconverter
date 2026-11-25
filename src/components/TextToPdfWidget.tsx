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
    const inner = b.runs.map(runToHtml).join('') || '<br>';
    if (b.kind === 'bullet' || b.kind === 'number') {
      const want = b.kind === 'bullet' ? 'ul' : 'ol';
      if (list !== want) {
        close();
        out += `<${want}>`;
        list = want;
      }
      out += `<li>${inner}</li>`;
    } else {
      close();
      const tag = b.kind === 'h1' ? 'h1' : b.kind === 'h2' ? 'h2' : 'p';
      out += `<${tag}>${inner}</${tag}>`;
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
  const pushKind = (kind: Block['kind'], runs: TextRun[]) => {
    let cur: TextRun[] = [];
    const flush = () => {
      blocks.push({ kind, runs: cur });
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

  doc.body.childNodes.forEach((node) => {
    if (node.nodeType === 3) {
      const t = node.textContent ?? '';
      if (t.trim()) pushKind('para', [{ text: t }]);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === 'h1') pushKind('h1', runsOf(el));
    else if (tag === 'h2') pushKind('h2', runsOf(el));
    else if (tag === 'ul') {
      el.querySelectorAll(':scope > li').forEach((li) => pushKind('bullet', runsOf(li)));
    } else if (tag === 'ol') {
      el.querySelectorAll(':scope > li').forEach((li) => pushKind('number', runsOf(li)));
    } else if (tag === 'li') pushKind('bullet', runsOf(el));
    else pushKind('para', runsOf(el));
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
  block: string;
  ul: boolean;
  ol: boolean;
}

export default function TextToPdfWidget({ entry }: Props) {
  const [html, setHtml] = useState('');
  const [settings, setSettings] = useState<TextPdfSettings>(DEFAULT_TEXT_PDF_SETTINGS);
  const [measure, setMeasure] = useState<MeasureFn | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [fmt, setFmt] = useState<FmtState>({ bold: false, italic: false, underline: false, block: 'p', ul: false, ol: false });
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

  const pages: PdfPage[] = useMemo(() => {
    if (!measure || !plain.trim()) return [];
    try {
      return paginateBlocks(blocks, settings, measure);
    } catch {
      return [];
    }
  }, [blocks, settings, measure, plain]);

  const refreshFmt = () => {
    try {
      setFmt({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        block: (document.queryCommandValue('formatBlock') || 'p').toLowerCase(),
        ul: document.queryCommandState('insertUnorderedList'),
        ol: document.queryCommandState('insertOrderedList'),
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
    if (!plain.trim()) {
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
  const pageW = Math.round(dims.width * SCALE);
  const pageH = Math.round(dims.height * SCALE);

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
      </div>

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
      <div className="ttp-grid">
        <div className="ttp-editor-col">
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

        <div className="ttp-preview-col">
          <div className="ttp-col-head">
            <strong>Live preview</strong>
            <span>
              {pages.length} page{pages.length === 1 ? '' : 's'} · {entry.title}
            </span>
          </div>
          <div className="ttp-preview">
            {!measure ? (
              <div className="ttp-page ttp-page-empty" style={{ width: pageW, height: pageH }}>
                Loading preview…
              </div>
            ) : !plain.trim() ? (
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
                    padding: `${Math.round(settings.margin * SCALE)}px`,
                    fontFamily: FONT_CSS[settings.font],
                    color: settings.color,
                  }}
                >
                  {pg.lines.map((line, li) => {
                    const ls = line.size;
                    const lh = line.lineH * SCALE;
                    return (
                      <div
                        key={li}
                        style={{
                          fontSize: `${ls * SCALE}px`,
                          lineHeight: `${lh}px`,
                          fontWeight:
                            line.isTitle || line.kind === 'h1' || line.kind === 'h2' ? 700 : undefined,
                          textAlign: line.isTitle
                            ? 'center'
                            : settings.align === 'justify'
                              ? 'justify'
                              : settings.align,
                          textAlignLast: settings.align === 'justify' && !line.lastInPara ? 'justify' : undefined,
                          minHeight: `${lh}px`,
                          whiteSpace: 'pre-wrap',
                          paddingLeft: `${line.indent * SCALE}px`,
                        }}
                      >
                        {line.blank
                          ? '\u00a0'
                          : (
                            <>
                              {line.prefix ? (
                                <span
                                  style={{
                                    display: 'inline-block',
                                    width: `${line.indent * SCALE}px`,
                                    marginLeft: `${-line.indent * SCALE}px`,
                                  }}
                                >
                                  {line.prefix.text}
                                </span>
                              ) : null}
                              {line.words.map((w, wi) => (
                                <span key={wi}>
                                  {wi > 0 ? ' ' : ''}
                                  {w.runs.map((r, ri) => (
                                    <span
                                      key={ri}
                                      style={{
                                        fontWeight: r.bold ? 700 : undefined,
                                        fontStyle: r.italic ? 'italic' : undefined,
                                        textDecoration: r.underline ? 'underline' : undefined,
                                        fontFamily: r.code ? "'Courier New', Courier, monospace" : undefined,
                                        background: r.code ? '#f1f1f1' : undefined,
                                        padding: r.code ? '0 2px' : undefined,
                                      }}
                                    >
                                      {r.text}
                                    </span>
                                  ))}
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

      <button type="button" className="btn block ttp-download" onClick={() => void download()} disabled={working || !plain.trim()}>
        {working ? 'Building your PDF…' : '⬇ Download PDF'}
      </button>
      <p className="ttp-privacy">
        Free forever · No sign-up · Your text never leaves your device — the PDF is built in your browser.
      </p>
    </div>
  );
}
