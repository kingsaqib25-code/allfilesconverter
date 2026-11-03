'use client';

import { useRef, useState } from 'react';
import type { ConverterEntry } from '@/lib/converters/registry';

type Props = { entry: ConverterEntry };

const SAMPLE = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>My Document</title></head>
<body style="font-family: sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px;">
<h1>My Document</h1>
<p>Paste your HTML here, then print it to PDF. Everything runs in your browser.</p>
<ul><li>First point</li><li>Second point</li></ul>
</body>
</html>`;

export default function HtmlWidget({ entry }: Props) {
  const [html, setHtml] = useState(SAMPLE);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const printPdf = () => {
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    // Let the document render before printing
    setTimeout(() => {
      w.print();
    }, 400);
  };

  return (
    <div className="widget">
      <div className="tool-grid has-side">
        <div className="tool-main">
          <label className="opt-row" style={{ alignItems: 'stretch' }}>
            <span className="opt-label">HTML code</span>
            <textarea
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              rows={12}
              spellCheck={false}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }}
            />
          </label>
          <div className="opt-label" style={{ marginTop: '0.75rem' }}>Preview</div>
          <iframe
            ref={iframeRef}
            title="HTML preview"
            srcDoc={html}
            sandbox=""
            style={{ width: '100%', height: 320, border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }}
          />
        </div>
        <aside className="tool-side">
          <h2 className="tool-side-title">Options</h2>
          <p style={{ fontSize: 13, color: '#475569' }}>
            Your browser turns the page into a PDF. In the print dialog, choose
            <strong> &ldquo;Save as PDF&rdquo; </strong>
            as the destination.
          </p>
          <button type="button" className="btn-primary" onClick={printPdf} style={{ marginTop: '0.75rem' }}>
            Print / Save as PDF
          </button>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: '0.75rem' }}>
            Honest note: this uses your browser&rsquo;s own PDF printer, so the
            output matches the preview exactly. Nothing is uploaded.
          </p>
        </aside>
      </div>
    </div>
  );
}
