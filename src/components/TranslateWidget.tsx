'use client';

import { useCallback, useRef, useState } from 'react';
import type { ConverterEntry } from '@/lib/converters/registry';

type Props = { entry: ConverterEntry };

const PAIRS = [
  { id: 'en-es', label: 'English → Spanish', model: 'Xenova/opus-mt-en-es' },
  { id: 'es-en', label: 'Spanish → English', model: 'Xenova/opus-mt-es-en' },
  { id: 'en-fr', label: 'English → French', model: 'Xenova/opus-mt-en-fr' },
  { id: 'fr-en', label: 'French → English', model: 'Xenova/opus-mt-fr-en' },
  { id: 'en-de', label: 'English → German', model: 'Xenova/opus-mt-en-de' },
  { id: 'de-en', label: 'German → English', model: 'Xenova/opus-mt-de-en' },
  { id: 'en-ar', label: 'English → Arabic', model: 'Xenova/opus-mt-en-ar' },
  { id: 'ar-en', label: 'Arabic → English', model: 'Xenova/opus-mt-ar-en' },
  { id: 'en-hi', label: 'English → Hindi', model: 'Xenova/opus-mt-en-hi' },
  { id: 'hi-en', label: 'Hindi → English', model: 'Xenova/opus-mt-hi-en' },
];

const pipeCache: Record<string, any> = {};

export default function TranslateWidget({ entry }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [pairId, setPairId] = useState('en-es');
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  const [doneName, setDoneName] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  const log = (m: string) => setStatus(m);

  const translate = useCallback(async () => {
    if (!file) { setError('Choose a PDF file first.'); return; }
    const pair = PAIRS.find((p) => p.id === pairId)!;
    setWorking(true);
    setError(null);
    setDoneUrl(null);
    setProgress(null);
    try {
      // 1. Extract text
      log('Reading PDF text…');
      const pdfMod = await import('@/lib/converters/pdf');
      const pages: string[][] = await pdfMod.extractPageTexts(file);

      // 2. Load translation model (cached after first download)
      let pipe = pipeCache[pair.model];
      if (!pipe) {
        log(`Downloading translation model (${pair.label}) — one-time, ~50MB…`);
        const { pipeline } = await import('@huggingface/transformers');
        pipe = await pipeline('translation', pair.model, {
          progress_callback: (p: any) => {
            if (p.status === 'progress' && p.total) {
              setProgress(Math.round((p.loaded / p.total) * 100));
            }
          },
        });
        pipeCache[pair.model] = pipe;
        setProgress(null);
      }
      // 3. Translate paragraph by paragraph
      const total = pages.flat().length;
      let done = 0;
      const outPages: string[][] = [];
      for (const paras of pages) {
        const out: string[] = [];
        for (const para of paras) {
          done++;
          if (done % 5 === 0) log(`Translating… ${done}/${total}`);
          const t = para.trim();
          if (!t) { out.push(''); continue; }
          // Split very long paragraphs into sentences for the model
          const chunks = t.length > 400 ? t.match(/[^.!?]+[.!?]+["']?|\S+/g) ?? [t] : [t];
          const tr: string[] = [];
          for (const c of chunks) {
            const r: any = await pipe(c.slice(0, 500));
            tr.push(r?.[0]?.translation_text ?? c);
          }
          out.push(tr.join(' '));
        }
        outPages.push(out);
      }
      // 4. Render translated PDF
      log('Building translated PDF…');
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
      const { safeWinAnsi } = pdfMod as any;
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const fontB = await doc.embedFont(StandardFonts.HelveticaBold);
      const black = rgb(0, 0, 0);
      const TPW = 595, TPH = 842, TM = 56;
      const maxW = TPW - 2 * TM;
      for (const paras of outPages) {
        let page = doc.addPage([TPW, TPH]);
        let y = TPH - TM;
        for (const para of paras) {
          const words = para.split(/\s+/).filter(Boolean);
          let line = '';
          const size = 11;
          const flush = (ln: string) => {
            if (y - size * 1.5 < TM) { page = doc.addPage([TPW, TPH]); y = TPH - TM; }
            if (ln) page.drawText(safeWinAnsi(ln), { x: TM, y: y - size, size, font, color: black });
            y -= size * 1.5;
          };
          for (const w of words) {
            const test = line ? line + ' ' + w : w;
            if (font.widthOfTextAtSize(safeWinAnsi(test), size) > maxW && line) {
              flush(line);
              line = w;
            } else line = test;
          }
          flush(line);
          y -= 4;
        }
      }
      const bytes = await doc.save();
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      const base = file.name.replace(/\.pdf$/i, '');
      setDoneName(`${base}-${pairId}.pdf`);
      setDoneUrl(URL.createObjectURL(blob));
      log(`Done — ${total} paragraphs translated.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Translation failed.');
      log('');
    } finally {
      setWorking(false);
      setProgress(null);
    }
  }, [file, pairId]);

  return (
    <div className="widget">
      <div className="tool-grid has-side">
        <div className="tool-main">
          <label className="opt-row">
            <span className="opt-label">PDF file</span>
            <input type="file" accept=".pdf,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {status && <p style={{ fontSize: 13, color: '#0f766e', marginTop: '0.5rem' }}>{status}</p>}
          {progress !== null && (
            <div style={{ marginTop: '0.5rem', background: '#e2e8f0', borderRadius: 6, height: 10 }}>
              <div style={{ width: `${progress}%`, background: '#0f766e', height: 10, borderRadius: 6 }} />
            </div>
          )}
          <div ref={logRef} />
        </div>
        <aside className="tool-side">
          <h2 className="tool-side-title">Options</h2>
          <label className="opt-row">
            <span className="opt-label">Language pair</span>
            <select value={pairId} onChange={(e) => setPairId(e.target.value)}>
              {PAIRS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <button type="button" className="btn-primary" onClick={translate} disabled={working} style={{ marginTop: '0.75rem' }}>
            {working ? 'Translating…' : 'Translate PDF'}
          </button>
          {error && <p className="widget-error">{error}</p>}
          {doneUrl && (
            <a className="btn-primary" href={doneUrl} download={doneName} style={{ marginTop: '0.75rem', display: 'inline-block' }}>
              Download {doneName}
            </a>
          )}
          <p style={{ fontSize: 12, color: '#64748b', marginTop: '0.75rem' }}>
            AI translation runs 100% on your device — no text is sent anywhere.
            Quality is good, not perfect. First use downloads the language model once (~30–100MB).
          </p>
        </aside>
      </div>
    </div>
  );
}
