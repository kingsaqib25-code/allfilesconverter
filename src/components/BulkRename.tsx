'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_RULES,
  renameBatch,
  type CaseMode,
  type RenameRules,
  type SpaceMode,
} from '@/lib/rename';

/** Renaming never touches file contents — a generous cap is safe. */
const MAX_FILES = 500;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function BulkRename() {
  const [files, setFiles] = useState<File[]>([]);
  const [rules, setRules] = useState<RenameRules>(DEFAULT_RULES);
  const [dragging, setDragging] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const set = useCallback(<K extends keyof RenameRules>(key: K, value: RenameRules[K]) => {
    setRules((r) => ({ ...r, [key]: value }));
  }, []);

  const pickFiles = useCallback((list: FileList | null) => {
    setError(null);
    if (!list) return;
    const picked = Array.from(list);
    if (picked.length === 0) return;
    setFiles((prev) => {
      const next = [...prev, ...picked];
      if (next.length > MAX_FILES) {
        setError(`Kept the first ${MAX_FILES} files — rename the rest in a second batch.`);
        return next.slice(0, MAX_FILES);
      }
      return next;
    });
  }, []);

  const removeAt = useCallback((i: number) => {
    setFiles((prev) => prev.filter((_, k) => k !== i));
  }, []);

  const clearAll = useCallback(() => {
    setFiles([]);
    setError(null);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      pickFiles(e.dataTransfer.files);
    },
    [pickFiles]
  );

  // Live preview: old name → new name, recomputed on every keystroke.
  const preview = useMemo(() => {
    if (files.length === 0) return [];
    const newNames = renameBatch(
      files.map((f) => f.name),
      rules
    );
    return files.map((f, i) => ({ old: f.name, next: newNames[i], size: f.size }));
  }, [files, rules]);

  const changedCount = useMemo(
    () => preview.filter((p) => p.old !== p.next).length,
    [preview]
  );

  const downloadZip = useCallback(async () => {
    if (files.length === 0 || zipping) return;
    setZipping(true);
    setError(null);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const newNames = renameBatch(
        files.map((f) => f.name),
        rules
      );
      files.forEach((f, i) => zip.file(newNames[i], f));
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'renamed-files.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      setError('Could not build the ZIP. Try fewer files or a different browser.');
    } finally {
      setZipping(false);
    }
  }, [files, rules, zipping]);

  return (
    <div className="widget">
      {/* Drop zone */}
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Drop files here or click to choose files"
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
        <div className="dz-icon" aria-hidden="true">
          ✏️
        </div>
        <div className="dz-title">Drop files here to rename</div>
        <div className="dz-sub">Any file type · up to {MAX_FILES} files · names only — contents are never touched</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          onChange={(e) => {
            pickFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {files.length === 0 ? (
        <div className="empty-note">
          <p>
            <strong>No files yet.</strong> Add some files above and the live preview will
            show exactly what each file will be renamed to — before you download anything.
          </p>
        </div>
      ) : (
        <>
          {/* Rename rules */}
          <div className="options-panel" aria-label="Rename rules">
            <h3 className="opt-heading">Rename rules</h3>
            <p className="opt-hint">
              Rules apply top to bottom: find → replace, spaces, strip characters, case,
              prefix, numbering, suffix. The extension is always kept.
            </p>

            <label className="opt-row">
              <span className="opt-label">
                <input
                  type="checkbox"
                  checked={rules.findEnabled}
                  onChange={(e) => set('findEnabled', e.target.checked)}
                />{' '}
                Find &amp; replace
              </span>
              <span className="opt-inline">
                <input
                  type="text"
                  placeholder="Find"
                  value={rules.find}
                  disabled={!rules.findEnabled}
                  onChange={(e) => set('find', e.target.value)}
                  aria-label="Find text"
                />
                <input
                  type="text"
                  placeholder="Replace with"
                  value={rules.replace}
                  disabled={!rules.findEnabled}
                  onChange={(e) => set('replace', e.target.value)}
                  aria-label="Replace with"
                />
              </span>
            </label>
            {rules.findEnabled && (
              <div className="opt-row opt-toggles">
                <label>
                  <input
                    type="checkbox"
                    checked={rules.useRegex}
                    onChange={(e) => set('useRegex', e.target.checked)}
                  />{' '}
                  Regex
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={rules.caseSensitive}
                    onChange={(e) => set('caseSensitive', e.target.checked)}
                  />{' '}
                  Case sensitive
                </label>
              </div>
            )}

            <label className="opt-row">
              <span className="opt-label">Add prefix / suffix</span>
              <span className="opt-inline">
                <input
                  type="text"
                  placeholder="Prefix"
                  value={rules.prefix}
                  onChange={(e) => set('prefix', e.target.value)}
                  aria-label="Prefix"
                />
                <input
                  type="text"
                  placeholder="Suffix"
                  value={rules.suffix}
                  onChange={(e) => set('suffix', e.target.value)}
                  aria-label="Suffix"
                />
              </span>
            </label>

            <label className="opt-row">
              <span className="opt-label">
                <input
                  type="checkbox"
                  checked={rules.numberingEnabled}
                  onChange={(e) => set('numberingEnabled', e.target.checked)}
                />{' '}
                Sequential numbering
              </span>
              <span className="opt-inline">
                <select
                  value={rules.numberingPosition}
                  disabled={!rules.numberingEnabled}
                  onChange={(e) => set('numberingPosition', e.target.value as 'start' | 'end')}
                  aria-label="Numbering position"
                >
                  <option value="end">At end</option>
                  <option value="start">At start</option>
                </select>
                <input
                  type="number"
                  min={0}
                  value={rules.numberingStart}
                  disabled={!rules.numberingEnabled}
                  onChange={(e) => set('numberingStart', Number(e.target.value) || 0)}
                  aria-label="Start number"
                  title="Start number"
                  style={{ maxWidth: '5rem' }}
                />
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={rules.numberingPadding}
                  disabled={!rules.numberingEnabled}
                  onChange={(e) => set('numberingPadding', Math.min(6, Math.max(1, Number(e.target.value) || 1)))}
                  aria-label="Padding digits"
                  title="Padding digits (001)"
                  style={{ maxWidth: '5rem' }}
                />
                <input
                  type="text"
                  value={rules.numberingSep}
                  disabled={!rules.numberingEnabled}
                  onChange={(e) => set('numberingSep', e.target.value.slice(0, 3))}
                  aria-label="Separator"
                  title="Separator"
                  style={{ maxWidth: '4rem' }}
                  maxLength={3}
                />
              </span>
            </label>

            <label className="opt-row">
              <span className="opt-label">Change case</span>
              <select
                value={rules.caseMode}
                onChange={(e) => set('caseMode', e.target.value as CaseMode)}
                aria-label="Change case"
              >
                <option value="keep">Keep as is</option>
                <option value="lower">lowercase</option>
                <option value="upper">UPPERCASE</option>
                <option value="title">Title Case</option>
              </select>
            </label>

            <label className="opt-row">
              <span className="opt-label">Spaces become</span>
              <select
                value={rules.spaceMode}
                onChange={(e) => set('spaceMode', e.target.value as SpaceMode)}
                aria-label="Spaces become"
              >
                <option value="keep">Keep spaces</option>
                <option value="dash">Dashes (-)</option>
                <option value="underscore">Underscores (_)</option>
                <option value="remove">Remove</option>
              </select>
            </label>

            <label className="opt-row">
              <span className="opt-label">
                <input
                  type="checkbox"
                  checked={rules.stripSpecial}
                  onChange={(e) => set('stripSpecial', e.target.checked)}
                />{' '}
                Strip special characters
                <span className="opt-hint"> (keeps letters, numbers, - _ .)</span>
              </span>
            </label>
          </div>

          {/* Live preview */}
          <h3 className="opt-heading" style={{ marginTop: '1.25rem' }}>
            Live preview{' '}
            <span className="pill-n">
              {changedCount} of {files.length} will change
            </span>
          </h3>
          <div className="rename-preview" role="region" aria-label="Rename preview">
            <table>
              <thead>
                <tr>
                  <th scope="col">Current name</th>
                  <th scope="col">New name</th>
                  <th scope="col">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p, i) => (
                  <tr key={`${p.old}-${i}`}>
                    <td className="rn-old" title={p.old}>
                      {p.old}
                    </td>
                    <td className={p.old === p.next ? 'rn-same' : 'rn-new'} title={p.next}>
                      {p.next}
                      {p.old !== p.next && / \(\d+\)\./.test(p.next) && (
                        <span className="rn-conflict" title="Auto-renamed to avoid a duplicate">
                          {' '}
                          duplicate fixed
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="rn-remove"
                        onClick={() => removeAt(i)}
                        aria-label={`Remove ${p.old}`}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="widget-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={downloadZip}
              disabled={files.length === 0 || zipping}
            >
              {zipping ? 'Building ZIP…' : `Download all as ZIP (${files.length})`}
            </button>
            <button type="button" className="btn-ghost" onClick={clearAll}>
              Clear all
            </button>
          </div>

          <p className="opt-hint">
            Your original files are never modified or uploaded — the ZIP contains renamed{' '}
            <em>copies</em>. Extensions are always preserved.
          </p>
        </>
      )}
    </div>
  );
}