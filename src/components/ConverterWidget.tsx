'use client';

import { useCallback, useRef, useState } from 'react';
import { getConverter, type ConverterEntry } from '@/lib/converters/registry';

interface Props {
  entryId: string;
  compact?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ConverterWidget({ entryId }: Props) {
  const entry = getConverter(entryId) as ConverterEntry;
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [working, setWorking] = useState(false);
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  const [doneName, setDoneName] = useState<string>('');
  const [doneSize, setDoneSize] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = useCallback(
    (f: File | undefined | null) => {
      setError(null);
      setDoneUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      if (!f) return;
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      if (!entry.fromExts.includes(ext)) {
        setError(
          `That looks like a .${ext || '?'} file, but this tool converts ${entry.from} (${entry.fromExts
            .map((e) => '.' + e)
            .join(', ')}) to ${entry.to}. Please pick the right file — or try another converter.`
        );
        setFile(null);
        return;
      }
      setFile(f);
    },
    [entry]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      pickFile(e.dataTransfer.files?.[0]);
    },
    [pickFile]
  );

  const convert = useCallback(async () => {
    if (!file || working) return;
    setWorking(true);
    setError(null);
    // Heavy engines (ffmpeg.wasm) report their load state so the UI can show
    // "Preparing converter…" instead of a generic spinner. The module is
    // dynamically imported here so it never lands in the main bundle.
    let unsub: (() => void) | undefined;
    try {
      if (entry.loadingNote) {
        const mod = await import('@/lib/converters/video');
        unsub = mod.onFfmpegLoadState((s) =>
          setLoadNote(s === 'loading' ? entry.loadingNote ?? null : null)
        );
      }
      const { blob, filename } = await entry.convert(file);
      const url = URL.createObjectURL(blob);
      setDoneUrl(url);
      setDoneName(filename);
      setDoneSize(formatSize(blob.size));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Something went wrong during conversion. Please try again with another file.'
      );
    } finally {
      unsub?.();
      setLoadNote(null);
      setWorking(false);
    }
  }, [file, working, entry]);

  const reset = useCallback(() => {
    setFile(null);
    setError(null);
    setDoneUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  return (
    <div className="widget" aria-label={`${entry.title} tool`}>
      {!file ? (
        <div
          className={`dropzone${dragging ? ' dragging' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={`Drop your ${entry.from} file here or click to browse`}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="dz-icon" aria-hidden="true">📁</div>
          <div className="dz-title">Drop your {entry.from} file here</div>
          <div className="dz-sub">
            or click to browse — accepts {entry.fromExts.map((e) => '.' + e).join(', ')}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={entry.fromExts.map((e) => '.' + e).join(',')}
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>
      ) : (
        <>
          <div className="file-row">
            <span aria-hidden="true">📄</span>
            <span className="fname">{file.name}</span>
            <span className="fsize">{formatSize(file.size)}</span>
          </div>
          {working ? (
            <div role="status" aria-label={loadNote ?? 'Converting…'}>
              {loadNote ? <div className="load-note">{loadNote}</div> : null}
              <div className="progress">
                <div />
              </div>
            </div>
          ) : doneUrl ? (
            <div className="alert ok">
              Done! Your {entry.to} file is ready ({doneSize}).
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {!doneUrl ? (
              <button className="btn" onClick={convert} disabled={working}>
                {working ? 'Converting…' : `Convert to ${entry.to} →`}
              </button>
            ) : (
              <a className="btn" href={doneUrl} download={doneName}>
                ⬇ Download {doneName}
              </a>
            )}
            <button className="btn secondary" onClick={reset}>
              {doneUrl ? 'Convert another' : 'Choose different file'}
            </button>
          </div>
        </>
      )}
      {error && (
        <div className="alert err" role="alert">
          {error}
        </div>
      )}
      <div className="privacy-note">
        <span aria-hidden="true">🔒</span>
        <span>
          Private by design: this file is converted inside your browser and never
          uploaded anywhere.
        </span>
      </div>
    </div>
  );
}
