'use client';

import { useMemo, useState } from 'react';
import type { ConverterEntry } from '@/lib/converters/registry';
import {
  normalizeUpc,
  upcCheckDigit,
  upcAToSvg,
  upcAToPng,
} from '@/lib/converters/barcode';

type Props = { entry: ConverterEntry };

const SIZES = [80, 100, 120, 150, 200];

export default function BarcodeWidget({ entry }: Props) {
  const [digits, setDigits] = useState('');
  const [sizePct, setSizePct] = useState(100);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clean = digits.replace(/\D/g, '').slice(0, 12);

  const full = useMemo(() => {
    if (clean.length !== 11 && clean.length !== 12) return null;
    try {
      return normalizeUpc(clean);
    } catch {
      return null;
    }
  }, [clean]);

  const checkHint =
    clean.length === 11 ? `Check digit: ${upcCheckDigit(clean)}` : null;

  const svg = useMemo(() => {
    if (!full) return null;
    try {
      return upcAToSvg(full, { module: 3 });
    } catch {
      return null;
    }
  }, [full]);

  const doDownload = async (kind: 'svg' | 'png') => {
    if (!full) {
      setError('Type 11 digits first (we add the check digit).');
      return;
    }
    setWorking(true);
    setError(null);
    try {
      if (kind === 'svg') {
        // Print-size SVG: module scaled to the GS1 size percentage
        const module = 2 * (sizePct / 100);
        const markup = upcAToSvg(full, { module });
        const blob = new Blob([markup], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `upc-${full}.svg`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } else {
        const blob = await upcAToPng(full, { sizePct });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `upc-${full}-${sizePct}pct.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the barcode.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="tool-grid has-side">
      <div className="tool-main">
        <label className="opt-row">
          <span className="opt-label">
            UPC digits <span className="opt-hint">(11 digits — we add the check digit, or full 12)</span>
          </span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="e.g. 03600029145"
            value={digits}
            onChange={(e) => {
              setDigits(e.target.value);
              setError(null);
            }}
            aria-label="UPC digits"
            style={{ fontSize: 20, letterSpacing: 4, maxWidth: '20rem' }}
          />
        </label>
        {checkHint && <p className="opt-hint">{checkHint} — full code: {clean}{upcCheckDigit(clean)}</p>}

        {svg && (
          <div
            className="barcode-preview"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: svg }}
            style={{ marginTop: 16, overflowX: 'auto', background: '#fff', padding: 12, border: '1px solid var(--border, #e2e8f0)', borderRadius: 12 }}
          />
        )}

        <div className="opt-grid" style={{ marginTop: 12 }}>
          <label className="opt">
            <span>Print size (GS1)</span>
            <select value={sizePct} onChange={(e) => setSizePct(Number(e.target.value))}>
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}%{s === 100 ? ' (standard)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <p className="error">{error}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => doDownload('svg')}
            disabled={working || !full}
          >
            {working ? 'Working…' : 'Download SVG (print)'}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => doDownload('png')}
            disabled={working || !full}
            style={{ background: '#fff', color: 'var(--brand)', border: '1px solid var(--brand)' }}
          >
            Download PNG (labels)
          </button>
        </div>
      </div>

      <aside className="tool-side">
        <h3>How it works</h3>
        <p>
          Type 11 digits and the 12th (check digit) is worked out for you. The
          preview redraws live. <strong>SVG</strong> stays sharp at any size —
          for packaging and designers. <strong>PNG</strong> is sized for your
          printer so bars land on whole dots.
        </p>
        <h3>Honest notes</h3>
        <ul>
          <li>This draws the barcode — the <em>number</em> is separate. For store shelves you need a GS1-licensed number; for your own stock labels, use one starting with 4.</li>
          <li>Leave the white space on both sides alone — scanners need it.</li>
          <li>Always print a test and scan it before a full run.</li>
        </ul>
      </aside>
    </div>
  );
}
