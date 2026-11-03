'use client';

import { useRef, useState } from 'react';
import type { ConverterEntry } from '@/lib/converters/registry';
import { compressImageSmart } from '@/lib/converters/image';

type Props = { entry: ConverterEntry };

const PRESETS = [
  { id: 'custom', label: 'Custom', hint: '' },
  { id: 'instagram', label: 'Instagram', hint: '1080px wide' },
  { id: 'whatsapp', label: 'WhatsApp', hint: 'compact' },
  { id: 'email500', label: 'Email 500KB', hint: 'under 500 KB' },
  { id: 'form200', label: 'Form 200KB', hint: 'under 200 KB' },
] as const;

type PresetId = (typeof PRESETS)[number]['id'];

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function CompressImageWidget({ entry }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState<PresetId>('custom');
  const [quality, setQuality] = useState(75);
  const [maxWidth, setMaxWidth] = useState('');
  const [targetKB, setTargetKB] = useState('');
  const [format, setFormat] = useState<'keep' | 'jpg' | 'webp' | 'png'>('keep');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    url: string;
    name: string;
    orig: number;
    out: number;
    width: number;
    height: number;
    qualityUsed: number;
  } | null>(null);

  const applyPreset = (id: PresetId) => {
    setPreset(id);
    if (id === 'instagram') {
      setMaxWidth('1080');
      setTargetKB('');
      setQuality(80);
      setFormat('jpg');
    } else if (id === 'whatsapp') {
      setMaxWidth('1280');
      setTargetKB('');
      setQuality(70);
      setFormat('jpg');
    } else if (id === 'email500') {
      setMaxWidth('');
      setTargetKB('500');
      setFormat('keep');
    } else if (id === 'form200') {
      setMaxWidth('');
      setTargetKB('200');
      setFormat('keep');
    }
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
  };

  const compress = async () => {
    if (!file) {
      setError('Choose an image file first.');
      return;
    }
    setWorking(true);
    setError(null);
    setResult(null);
    try {
      const r = await compressImageSmart(file, {
        quality,
        maxWidth: maxWidth ? parseInt(maxWidth, 10) : undefined,
        targetKB: targetKB ? parseFloat(targetKB) : undefined,
        format,
      });
      const url = URL.createObjectURL(r.blob);
      setResult({
        url,
        name: r.filename,
        orig: r.origBytes,
        out: r.outBytes,
        width: r.width,
        height: r.height,
        qualityUsed: r.qualityUsed,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Compression failed. Try another image.');
    } finally {
      setWorking(false);
    }
  };

  const saved = result ? Math.round((1 - result.out / result.orig) * 100) : 0;

  return (
    <div className="tool-grid has-side">
      <div className="tool-main">
        <div
          className="dropzone"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFile(e.dataTransfer.files?.[0]);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') fileRef.current?.click();
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          {file ? (
            <p>
              <strong>{file.name}</strong> · {fmt(file.size)}
              <br />
              <span className="muted">Click or drop to choose a different image</span>
            </p>
          ) : (
            <p>
              <strong>Drop an image here</strong> or click to choose
              <br />
              <span className="muted">JPG, PNG, WebP, AVIF, HEIC — stays on your device</span>
            </p>
          )}
        </div>

        <div className="preset-row" style={{ marginTop: 12 }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`pill-btn${preset === p.id ? ' active' : ''}`}
              onClick={() => applyPreset(p.id)}
              title={p.hint ?? ''}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="opt-grid" style={{ marginTop: 12 }}>
          <label className="opt">
            <span>
              Quality: <strong>{quality}</strong>
              <span className="muted"> (target size overrides this)</span>
            </span>
            <input
              type="range"
              min={10}
              max={100}
              value={quality}
              onChange={(e) => {
                setQuality(parseInt(e.target.value, 10));
                setPreset('custom');
              }}
            />
          </label>
          <label className="opt">
            <span>Max width (px, keeps aspect)</span>
            <input
              type="number"
              min={0}
              placeholder="e.g. 1080"
              value={maxWidth}
              onChange={(e) => {
                setMaxWidth(e.target.value);
                setPreset('custom');
              }}
            />
          </label>
          <label className="opt">
            <span>Target size (KB, exact)</span>
            <input
              type="number"
              min={0}
              placeholder="e.g. 200"
              value={targetKB}
              onChange={(e) => {
                setTargetKB(e.target.value);
                setPreset('custom');
              }}
            />
          </label>
          <label className="opt">
            <span>Output format</span>
            <select
              value={format}
              onChange={(e) => {
                setFormat(e.target.value as typeof format);
                setPreset('custom');
              }}
            >
              <option value="keep">Keep original</option>
              <option value="jpg">JPG (smallest photos)</option>
              <option value="webp">WebP (modern, tiny)</option>
              <option value="png">PNG (lossless)</option>
            </select>
          </label>
        </div>

        {error && <p className="error">{error}</p>}

        <button
          type="button"
          className="btn-primary"
          onClick={compress}
          disabled={working || !file}
          style={{ marginTop: 12 }}
        >
          {working ? 'Compressing…' : 'Compress image'}
        </button>

        {result && (
          <div className="result-card">
            <p>
              <strong>
                {fmt(result.orig)} → {fmt(result.out)}
              </strong>{' '}
              <span className={saved >= 0 ? 'good' : 'warn'}>
                ({saved >= 0 ? `${saved}% smaller` : `${-saved}% larger`})
              </span>
            </p>
            <p className="muted">
              {result.width}×{result.height}px · quality {result.qualityUsed}
              {targetKB ? ` · target was ${targetKB} KB` : ''}
            </p>
            <a href={result.url} download={result.name} className="btn-primary">
              Download {result.name}
            </a>
          </div>
        )}
      </div>

      <aside className="tool-side">
        <h3>How it works</h3>
        <p>
          Pick a preset or tune it yourself. <strong>Target size</strong> hunts the exact
          quality that lands your image at or under that size. Everything runs in your
          browser — the image never leaves your device.
        </p>
        <h3>Tips</h3>
        <ul>
          <li>Instagram recompresses uploads anyway — 1080px at 80 is the sweet spot.</li>
          <li>WhatsApp shrinks photos itself; send compact to save data.</li>
          <li>For forms with strict limits, use the exact target-size box.</li>
        </ul>
      </aside>
    </div>
  );
}
