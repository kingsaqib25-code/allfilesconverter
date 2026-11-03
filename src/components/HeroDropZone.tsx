'use client';

/**
 * Smart Converter — the homepage hero widget.
 *
 * Drop ANY file → we detect its type (extension → MIME → magic bytes) →
 * we suggest every conversion we can do → pick the target by typing or
 * scrolling the dropdown → convert right here, no page-hopping.
 *
 * Converters with an on-device `convert()` run inline. Converters that need
 * a dedicated interface (PDF tools, mergers, editor) link out to their page.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  findConvertersForExt,
  type ConverterEntry,
  type ConvertOptions,
  type OptionDef,
} from '@/lib/converters/registry';
import { detectFileType } from '@/lib/detect-file';

type Phase = 'idle' | 'ready' | 'working' | 'done';

interface DoneResult {
  url: string;
  name: string;
  size: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function HeroDropZone() {
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [detectedLabel, setDetectedLabel] = useState('');
  const [inline, setInline] = useState<ConverterEntry[]>([]);
  const [dedicated, setDedicated] = useState<ConverterEntry[]>([]);
  const [noMatch, setNoMatch] = useState(false);

  // target-format combobox
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // conversion
  const [optValues, setOptValues] = useState<ConvertOptions>({});
  const [working, setWorking] = useState(false);
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DoneResult | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const comboRef = useRef<HTMLDivElement>(null);

  const selected: ConverterEntry | undefined = inline.find((c) => c.id === selectedId);

  const filtered = inline.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      c.to.toLowerCase().includes(q) ||
      c.toExt.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q)
    );
  });

  // close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open ]);

  const resetAll = useCallback(() => {
    setResult((r) => {
      if (r) {
        try { URL.revokeObjectURL(r.url); } catch { /* ignore */ }
      }
      return null;
    });
    setPhase('idle');
    setFile(null);
    setDetectedLabel('');
    setInline([]);
    setDedicated([]);
    setNoMatch(false);
    setQuery('');
    setOpen(false);
    setActiveIdx(-1);
    setSelectedId(null);
    setOptValues({});
    setError(null);
    setLoadNote(null);
    setWorking(false);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const handleFile = useCallback(async (f: File | undefined | null) => {
    if (!f) return;
    resetAll();
    setFile(f);
    setPhase('ready');
    const detected = await detectFileType(f);
    setDetectedLabel(detected.label);
    const matches = detected.ext ? findConvertersForExt(detected.ext) : [];
    const inlineC = matches.filter((c) => typeof c.convert === 'function');
    const dedicatedC = matches.filter((c) => typeof c.convert !== 'function');
    setInline(inlineC);
    setDedicated(dedicatedC);
    setNoMatch(matches.length === 0);
    // one obvious target → preselect it so a single tap converts
    if (inlineC.length === 1) {
      setSelectedId(inlineC[0].id);
      setQuery(`${inlineC[0].to} (.${inlineC[0].toExt})`);
      const init: ConvertOptions = {};
      for (const o of inlineC[0].options ?? []) init[o.id] = o.default;
      setOptValues(init);
    }
  }, [resetAll]);

  const pickTarget = useCallback((c: ConverterEntry) => {
    setSelectedId(c.id);
    setQuery(`${c.to} (.${c.toExt})`);
    setOpen(false);
    setActiveIdx(-1);
    setError(null);
    setResult(null);
    const init: ConvertOptions = {};
    for (const o of c.options ?? []) init[o.id] = o.default;
    setOptValues(init);
  }, []);

  const onComboKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = filtered[activeIdx] ?? filtered[0];
      if (c) pickTarget(c);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIdx(-1);
    }
  }, [filtered, activeIdx, pickTarget]);

  const convertNow = useCallback(async () => {
    if (!file || !selected?.convert || working) return;
    setWorking(true);
    setPhase('working');
    setError(null);
    setResult(null);
    let unsub: (() => void) | undefined;
    try {
      if (selected.loadingNote) {
        const mod = await import('@/lib/converters/video');
        unsub = mod.onFfmpegLoadState((s) =>
          setLoadNote(s === 'loading' ? selected.loadingNote ?? null : null)
        );
      }
      const { blob, filename } = await selected.convert(file, optValues);
      const url = URL.createObjectURL(blob);
      setResult({ url, name: filename, size: formatSize(blob.size) });
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Conversion failed. Try another file.');
      setPhase('ready');
    } finally {
      unsub?.();
      setLoadNote(null);
      setWorking(false);
    }
  }, [file, selected, working, optValues]);

  const renderOption = (opt: OptionDef) => {
    const val = optValues[opt.id] ?? opt.default;
    if (opt.type === 'slider') {
      return (
        <label key={opt.id} className="opt-row">
          <span className="opt-label">
            {opt.label}: <strong>{val}</strong>
            {opt.hint ? <span className="opt-hint"> ({opt.hint})</span> : null}
          </span>
          <input
            type="range"
            min={opt.min ?? 1}
            max={opt.max ?? 100}
            step={opt.step ?? 1}
            value={Number(val)}
            onChange={(e) => setOptValues((v) => ({ ...v, [opt.id]: Number(e.target.value) }))}
            aria-label={opt.label}
          />
        </label>
      );
    }
    if (opt.type === 'number') {
      return (
        <label key={opt.id} className="opt-row">
          <span className="opt-label">
            {opt.label}
            {opt.hint ? <span className="opt-hint"> ({opt.hint})</span> : null}
          </span>
          <input
            type="number"
            min={opt.min ?? 1}
            max={opt.max ?? 100000}
            step={opt.step ?? 1}
            value={Number(val)}
            onChange={(e) => setOptValues((v) => ({ ...v, [opt.id]: Number(e.target.value) }))}
            aria-label={opt.label}
            style={{ maxWidth: '8rem' }}
          />
        </label>
      );
    }
    return (
      <label key={opt.id} className="opt-row">
        <span className="opt-label">{opt.label}</span>
        <select
          value={String(val)}
          onChange={(e) => setOptValues((v) => ({ ...v, [opt.id]: e.target.value }))}
          aria-label={opt.label}
        >
          {(opt.choices ?? []).map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </label>
    );
  };

  return (
    <>
      {phase === 'idle' && (
        <div
          className={`dropzone${dragging ? ' dragging' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="Drop any file here — we detect its format and convert it on the spot"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
          }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="dz-icon" aria-hidden="true">📂</div>
          <div className="dz-title">Drop any file here — we do the rest</div>
          <div className="dz-sub">
            We detect the format, suggest every conversion, and convert on the spot.
            Images, video, audio, PDFs, documents, data.
          </div>
          <input ref={inputRef} type="file" onChange={(e) => handleFile(e.target.files?.[0])} />
        </div>
      )}

      {(phase === 'ready' || phase === 'working' || phase === 'done') && file && (
        <div className="smart-panel" aria-live="polite">
          <div className="smart-file">
            <span aria-hidden="true">📄</span>
            <span className="smart-file-info">
              <span className="smart-file-name">{file.name}</span>
              <span className="smart-file-meta">{formatSize(file.size)} · detected: {detectedLabel}</span>
            </span>
            {phase !== 'working' && (
              <button className="mini-btn" onClick={resetAll} aria-label="Choose a different file">✕</button>
            )}
          </div>

          {noMatch && (
            <div className="alert err" role="alert">
              We do not have a converter for “{file.name}” yet.{' '}
              <Link href="/all-converters">Browse all converters</Link> — new formats are added regularly.
            </div>
          )}

          {inline.length > 0 && phase !== 'done' && (
            <div className="smart-convert-row">
              <div className="combo" ref={comboRef}>
                <label className="combo-label" htmlFor="smart-target">Convert to:</label>
                <input
                  id="smart-target"
                  type="text"
                  role="combobox"
                  aria-expanded={open}
                  aria-controls="smart-target-list"
                  aria-activedescendant={activeIdx >= 0 ? `smart-opt-${filtered[activeIdx]?.id}` : undefined}
                  autoComplete="off"
                  placeholder="Type a format (e.g. jpg, mp3, pdf) or pick from the list…"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIdx(-1); }}
                  onFocus={() => setOpen(true)}
                  onKeyDown={onComboKey}
                />
                <button
                  className="combo-toggle"
                  aria-label={open ? 'Close format list' : 'Open format list'}
                  onClick={() => setOpen((o) => !o)}
                  tabIndex={-1}
                >
                  ▾
                </button>
                {open && filtered.length > 0 && (
                  <ul className="combo-list" id="smart-target-list" role="listbox">
                    {filtered.map((c, i) => (
                      <li
                        key={c.id}
                        id={`smart-opt-${c.id}`}
                        role="option"
                        aria-selected={c.id === selectedId}
                        className={`combo-item${i === activeIdx ? ' active' : ''}${c.id === selectedId ? ' selected' : ''}`}
                        onMouseDown={(e) => { e.preventDefault(); pickTarget(c); }}
                        onMouseEnter={() => setActiveIdx(i)}
                      >
                        <span className="combo-to">{c.to}</span>
                        <span className="combo-ext">.{c.toExt}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {open && filtered.length === 0 && (
                  <div className="combo-list combo-empty" role="status">
                    No conversion to “{query.trim()}” for this file.
                  </div>
                )}
              </div>

              {selected && (selected.options?.length ?? 0) > 0 && (
                <div className="smart-opts">{selected.options!.map(renderOption)}</div>
              )}

              <div className="smart-actions">
                <button className="btn block" onClick={convertNow} disabled={working || !selected}>
                  {working ? (loadNote ?? 'Converting…') : selected ? `Convert to ${selected.to} →` : 'Pick a format above'}
                </button>
                {working && (
                  <div className="progress determinate" aria-hidden="true"><div style={{ width: '60%' }} /></div>
                )}
              </div>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="smart-result">
              <div className="alert ok" role="status">Done ✓ — your file is ready.</div>
              <div className="smart-actions">
                <a className="btn block" href={result.url} download={result.name}>
                  ⬇ Download {result.name} ({result.size})
                </a>
                <button className="btn secondary block" onClick={resetAll}>Convert another file</button>
              </div>
            </div>
          )}

          {error && <div className="alert err" role="alert">{error}</div>}

          {dedicated.length > 0 && phase !== 'working' && (
            <div className="smart-dedicated">
              <div className="detect-head">Also available in a dedicated tool:</div>
              {dedicated.map((c) => (
                <Link key={c.id} href={`/convert/${c.id}`} className="detect-card">
                  <span>
                    <span className="t">{c.title}</span>
                    <br />
                    <span className="d">{c.fromExts.map((e) => '.' + e).join(', ')} → .{c.toExt}</span>
                  </span>
                  <span className="go">Open →</span>
                </Link>
              ))}
            </div>
          )}

          <div className="privacy-note">
            <span aria-hidden="true">🔒</span>
            <span>Private by design: conversion runs inside your browser — files never leave your device.</span>
          </div>
        </div>
      )}
    </>
  );
}
