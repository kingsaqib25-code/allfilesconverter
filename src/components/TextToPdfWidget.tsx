'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ConverterEntry } from '@/lib/converters/registry';
import {
  DEFAULT_TEXT_PDF_SETTINGS,
  MARGIN_CHOICES,
  PAGE_SIZES,
  buildTextPdf,
  createMeasureFn,
  paginateText,
  textPdfFilename,
  type MeasureFn,
  type PdfPage,
  type TextPdfAlign,
  type TextPdfFont,
  type TextPdfPageSize,
  type TextPdfSettings,
} from '@/lib/converters/text-to-pdf';

type Props = { entry: ConverterEntry };

const SAMPLE_TEXT = `My Project Proposal

This is a sample document. Type or paste your own text on the left and watch the preview update live on the right.

You can make words **bold** or *italic* using simple markers, and \`code\` shows up in monospace. Everything runs in your browser — nothing is uploaded.

When you are happy with how it looks, hit Download PDF and the file is yours in one click.`;

const FONT_CSS: Record<TextPdfFont, string> = {
  helvetica: 'Arial, Helvetica, sans-serif',
  times: "'Times New Roman', Times, serif",
  courier: "'Courier New', Courier, monospace",
};

const SCALE = 0.72;

function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export default function TextToPdfWidget({ entry }: Props) {
  const [text, setText] = useState('');
  const [settings, setSettings] = useState<TextPdfSettings>(DEFAULT_TEXT_PDF_SETTINGS);
  const [measure, setMeasure] = useState<MeasureFn | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const deferredText = useDeferredValue(text);

  // (Re)embed the selected font family for live measurement.
  useEffect(() => {
    let alive = true;
    setMeasure(null);
    createMeasureFn(settings.font)
      .then((m) => {
        if (alive) setMeasure(m);
      })
      .catch(() => {
        if (alive) setError('The PDF font could not load. Reload the page and try again.');
      });
    return () => {
      alive = false;
    };
  }, [settings.font]);

  const pages: PdfPage[] = useMemo(() => {
    if (!measure) return [];
    try {
      return paginateText(deferredText, settings, measure);
    } catch {
      return [];
    }
  }, [deferredText, settings, measure]);

  const set = <K extends keyof TextPdfSettings>(key: K, value: TextPdfSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  const loadFile = async (file: File) => {
    setError(null);
    try {
      const src = await file.text();
      if (!src.trim()) throw new Error('That text file looks empty.');
      setText(src);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  const download = async () => {
    if (!text.trim()) {
      setError('Type or paste some text first.');
      return;
    }
    setWorking(true);
    setError(null);
    setDone(false);
    try {
      const blob = await buildTextPdf(text, settings);
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

  const pageSize = PAGE_SIZES[settings.pageSize];
  const pageW = Math.round(pageSize.width * SCALE);
  const pageH = Math.round(pageSize.height * SCALE);

  return (
    <div className="widget widget-wide ttp-widget">
      {/* ---------- toolbar ---------- */}
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
        <label className="ttp-check">
          <input type="checkbox" checked={settings.boldAll} onChange={(e) => set('boldAll', e.target.checked)} />
          Bold all text
        </label>
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
            <strong>Your text</strong>
            <span>
              {wordCount(text)} words · {text.length} characters
            </span>
          </div>
          <textarea
            className="ttp-textarea"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDone(false);
            }}
            placeholder="Type or paste your text here…

Tip: **bold**, *italic* and `code` work too."
            aria-label="Text to convert to PDF"
            spellCheck
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
            <button type="button" className="btn secondary" onClick={() => setText(SAMPLE_TEXT)}>
              Sample text
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setText('');
                setDone(false);
              }}
            >
              Clear
            </button>
          </div>
          <p className="ttp-hint">
            Formatting tip: wrap words in <code>**bold**</code>, <code>*italic*</code> or{' '}
            <code>`code`</code> — they render in the preview and the PDF.
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
            ) : !text.trim() ? (
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
                  }}
                >
                  {pg.lines.map((line, li) => {
                    const ls = line.isTitle ? settings.fontSize + 8 : settings.fontSize;
                    const lh = (line.isTitle ? ls * 1.4 : ls * settings.lineHeight) * SCALE;
                    return (
                      <div
                        key={li}
                        style={{
                          fontSize: `${ls * SCALE}px`,
                          lineHeight: `${lh}px`,
                          fontWeight: line.isTitle ? 700 : undefined,
                          textAlign: line.isTitle
                            ? 'center'
                            : settings.align === 'justify'
                              ? 'justify'
                              : settings.align,
                          textAlignLast: settings.align === 'justify' && !line.lastInPara ? 'justify' : undefined,
                          minHeight: `${lh}px`,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {line.blank
                          ? '\u00a0'
                          : line.words.map((w, wi) => (
                              <span key={wi}>
                                {wi > 0 ? ' ' : ''}
                                {w.runs.map((r, ri) => (
                                  <span
                                    key={ri}
                                    style={{
                                      fontWeight: r.style === 'bold' || r.style === 'boldItalic' ? 700 : undefined,
                                      fontStyle: r.style === 'italic' || r.style === 'boldItalic' ? 'italic' : undefined,
                                      fontFamily: r.style === 'code' ? "'Courier New', Courier, monospace" : undefined,
                                      background: r.style === 'code' ? '#f1f1f1' : undefined,
                                      padding: r.style === 'code' ? '0 2px' : undefined,
                                    }}
                                  >
                                    {r.text}
                                  </span>
                                ))}
                              </span>
                            ))}
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

      <button type="button" className="btn block ttp-download" onClick={() => void download()} disabled={working || !text.trim()}>
        {working ? 'Building your PDF…' : '⬇ Download PDF'}
      </button>
      <p className="ttp-privacy">
        Free forever · No sign-up · Your text never leaves your device — the PDF is built in your browser.
      </p>
    </div>
  );
}
