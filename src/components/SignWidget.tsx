'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConverterEntry } from '@/lib/converters/registry';

type Props = { entry: ConverterEntry };

const POSITIONS = [
  { id: 'br', label: 'Bottom right' },
  { id: 'bl', label: 'Bottom left' },
  { id: 'tr', label: 'Top right' },
  { id: 'tl', label: 'Top left' },
] as const;

export default function SignWidget({ entry }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pageNum, setPageNum] = useState('1');
  const [pos, setPos] = useState<string>('br');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  const [doneName, setDoneName] = useState('');

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = 520 * dpr;
    cv.height = 180 * dpr;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
  }, []);

  const posOf = (e: React.PointerEvent) => {
    const cv = canvasRef.current!;
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const start = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = posOf(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = posOf(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasInk(true);
  };
  const clear = () => {
    const cv = canvasRef.current!;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, 520, 180);
    setHasInk(false);
  };

  const sign = useCallback(async () => {
    if (!file) { setError('Choose a PDF file first.'); return; }
    if (!hasInk) { setError('Draw your signature on the pad first.'); return; }
    setWorking(true);
    setError(null);
    setDoneUrl(null);
    try {
      const cv = canvasRef.current!;
      const sigBlob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'));
      if (!sigBlob) throw new Error('Could not capture the signature.');
      const sigBytes = new Uint8Array(await sigBlob.arrayBuffer());
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      const n = pdf.getPageCount();
      let p = parseInt(pageNum, 10);
      if (Number.isNaN(p) || p < 1) p = 1;
      if (p > n) p = n;
      const page = pdf.getPage(p - 1);
      const { width: pw, height: ph } = page.getSize();
      const img = await pdf.embedPng(sigBytes);
      const w = 150;
      const h = (img.height / img.width) * w;
      const m = 40;
      let x = pw - w - m, y = m;
      if (pos === 'bl') { x = m; y = m; }
      else if (pos === 'tr') { x = pw - w - m; y = ph - h - m; }
      else if (pos === 'tl') { x = m; y = ph - h - m; }
      page.drawImage(img, { x, y, width: w, height: h });
      const bytes = await pdf.save();
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      const base = file.name.replace(/\.pdf$/i, '');
      setDoneName(`${base}-signed.pdf`);
      setDoneUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setWorking(false);
    }
  }, [file, hasInk, pageNum, pos]);

  return (
    <div className="widget">
      <div className="tool-grid has-side">
        <div className="tool-main">
          <label className="opt-row">
            <span className="opt-label">PDF file</span>
            <input type="file" accept=".pdf,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <div className="opt-label" style={{ marginTop: '0.75rem' }}>Draw your signature</div>
          <canvas
            ref={canvasRef}
            style={{ width: '100%', maxWidth: 520, height: 180, border: '2px dashed #94a3b8', borderRadius: 8, background: '#fff', touchAction: 'none', cursor: 'crosshair' }}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={() => setDrawing(false)}
            onPointerLeave={() => setDrawing(false)}
          />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="button" className="btn-ghost" onClick={clear}>Clear</button>
          </div>
        </div>
        <aside className="tool-side">
          <h2 className="tool-side-title">Options</h2>
          <label className="opt-row">
            <span className="opt-label">Page number</span>
            <input type="number" min={1} value={pageNum} onChange={(e) => setPageNum(e.target.value)} style={{ maxWidth: '6rem' }} />
          </label>
          <label className="opt-row">
            <span className="opt-label">Position</span>
            <select value={pos} onChange={(e) => setPos(e.target.value)}>
              {POSITIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <button type="button" className="btn-primary" onClick={sign} disabled={working} style={{ marginTop: '0.75rem' }}>
            {working ? 'Signing…' : 'Sign PDF'}
          </button>
          {error && <p className="widget-error">{error}</p>}
          {doneUrl && (
            <a className="btn-primary" href={doneUrl} download={doneName} style={{ marginTop: '0.75rem', display: 'inline-block' }}>
              Download {doneName}
            </a>
          )}
        </aside>
      </div>
    </div>
  );
}
