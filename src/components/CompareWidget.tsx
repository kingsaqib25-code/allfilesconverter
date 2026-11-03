'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConverterEntry } from '@/lib/converters/registry';

type Props = { entry: ConverterEntry };

export default function CompareWidget({ entry }: Props) {
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [page, setPage] = useState(1);
  const [maxPage, setMaxPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const refA = useRef<HTMLCanvasElement>(null);
  const refB = useRef<HTMLCanvasElement>(null);

  const render = useCallback(async () => {
    if (!fileA || !fileB) return;
    setError(null);
    try {
      const pdfjs: any = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      const load = async (f: File) => {
        const buf = await f.arrayBuffer();
        const task = (pdfjs as any).getDocument({ data: new Uint8Array(buf) });
        return task.promise;
      };
      const [da, db] = await Promise.all([load(fileA), load(fileB)]);
      const n = Math.min(da.numPages, db.numPages);
      setMaxPage(n);
      const p = Math.min(Math.max(1, page), n);
      const draw = async (doc: any, ref: React.RefObject<HTMLCanvasElement | null>) => {
        const pg = await doc.getPage(p);
        const vp = pg.getViewport({ scale: 1.2 });
        const cv = ref.current!;
        cv.width = Math.floor(vp.width);
        cv.height = Math.floor(vp.height);
        const ctx = cv.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cv.width, cv.height);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
        pg.cleanup();
      };
      await Promise.all([draw(da, refA), draw(db, refB)]);
      da.destroy();
      db.destroy();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not render the PDFs.');
    }
  }, [fileA, fileB, page]);

  useEffect(() => {
    render();
  }, [render]);

  return (
    <div className="widget">
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <label className="opt-row">
          <span className="opt-label">First PDF</span>
          <input type="file" accept=".pdf,application/pdf" onChange={(e) => setFileA(e.target.files?.[0] ?? null)} />
        </label>
        <label className="opt-row">
          <span className="opt-label">Second PDF</span>
          <input type="file" accept=".pdf,application/pdf" onChange={(e) => setFileB(e.target.files?.[0] ?? null)} />
        </label>
        <label className="opt-row">
          <span className="opt-label">Page</span>
          <input
            type="number" min={1} max={maxPage} value={page}
            onChange={(e) => setPage(parseInt(e.target.value, 10) || 1)}
            style={{ maxWidth: '5rem' }}
          />
          <span className="opt-hint">of {maxPage}</span>
        </label>
      </div>
      {error && <p className="widget-error">{error}</p>}
      {fileA && fileB ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <div className="opt-label" style={{ marginBottom: 4 }}>{fileA.name}</div>
            <canvas ref={refA} style={{ width: '100%', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }} />
          </div>
          <div>
            <div className="opt-label" style={{ marginBottom: 4 }}>{fileB.name}</div>
            <canvas ref={refB} style={{ width: '100%', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }} />
          </div>
        </div>
      ) : (
        <p style={{ color: '#64748b' }}>Choose two PDFs to compare them side by side, page by page.</p>
      )}
    </div>
  );
}
