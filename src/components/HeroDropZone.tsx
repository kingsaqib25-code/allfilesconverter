'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { findConvertersForExt } from '@/lib/converters/registry';

export default function HeroDropZone() {
  const [dragging, setDragging] = useState(false);
  const [matches, setMatches] = useState<ReturnType<typeof findConvertersForExt> | null>(null);
  const [fileName, setFileName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File | undefined | null) => {
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    setFileName(f.name);
    setMatches(findConvertersForExt(ext));
  }, []);

  return (
    <>
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Drop any file here to find matching converters"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
      >
        <div className="dz-icon" aria-hidden="true">📂</div>
        <div className="dz-title">Drop a file to get started</div>
        <div className="dz-sub">
          We detect its format and suggest the right converter — images, documents, data, subtitles
        </div>
        <input ref={inputRef} type="file" onChange={(e) => handleFile(e.target.files?.[0])} />
      </div>
      {matches !== null && (
        <div className="detect-results" aria-live="polite">
          {matches.length > 0 ? (
            <>
              <div className="detect-head">
                {fileName} — {matches.length} converter{matches.length === 1 ? '' : 's'} found:
              </div>
              {matches.map((c) => (
                <Link key={c.id} href={`/convert/${c.id}`} className="detect-card">
                  <span>
                    <span className="t">{c.title}</span>
                    <br />
                    <span className="d">{c.fromExts.map((e) => '.' + e).join(', ')} → .{c.toExt}</span>
                  </span>
                  <span className="go">Convert →</span>
                </Link>
              ))}
            </>
          ) : (
            <div className="alert err" role="alert">
              We do not have a converter for “{fileName}” yet. Try one of the{' '}
              <Link href="/all-converters">40 converters</Link> below — video and audio
              converters are coming soon.
            </div>
          )}
        </div>
      )}
    </>
  );
}
