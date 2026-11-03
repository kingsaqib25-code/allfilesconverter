'use client';

/**
 * "Summarize with AI" — one button, on-page slide-over panel.
 *
 * The panel shows the page's built-in summary INSTANTLY on open (it's
 * pre-generated at build time — no waiting). In the background, the free
 * Pollinations text API (no key, no signup) tries to polish it into
 * plainer words; when that arrives it swaps in with an "AI-polished" note.
 * If the API is slow or fails, the built-in summary simply stays — the user
 * never stares at a spinner. Never redirects to external AI sites. User
 * files are never sent anywhere.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  /** The page's public summary text (TL;DR + about). Never user files. */
  summaryText: string;
  /** Compact header variant: small "✨ Summary" button instead of the full block. */
  compact?: boolean;
}

function renderAiText(text: string) {
  // Lightweight plain-text rendering: paragraphs + "-"/"•" bullets. No HTML injection.
  const blocks = text.split(/\n{2,}|\r\n\r\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((b, i) => {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
    const isList = lines.length > 1 && lines.every((l) => /^[-*•\d+[.)\]]\s/.test(l));
    if (isList) {
      return (
        <ul key={i} className="ai-panel-list">
          {lines.map((l, j) => (
            <li key={j}>{l.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '')}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={i} className="ai-panel-p">
        {lines.join(' ')}
      </p>
    );
  });
}

export default function AiSummarize({ summaryText, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const openPanel = useCallback(() => {
    setOpen(true);
    if (aiText || enhancing) return;
    // Background AI polish — the built-in summary is already visible,
    // this never blocks it.
    setEnhancing(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 20000);
    (async () => {
      try {
        const res = await fetch('https://text.pollinations.ai/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              {
                role: 'system',
                content:
                  'You summarize a file-converter tool page in plain, simple words. 2-3 short paragraphs plus 3-5 key bullets. No jargon.',
              },
              { role: 'user', content: summaryText },
            ],
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`AI request failed: ${res.status}`);
        const text = (await res.text()).trim();
        if (!text) throw new Error('Empty AI response');
        setAiText(text);
      } catch {
        // Silent: the built-in summary stays put. No spinner, no error.
      } finally {
        clearTimeout(timer);
        setEnhancing(false);
      }
    })();
  }, [summaryText, aiText, enhancing]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    setOpen(false);
  }, []);

  // Lock body scroll while the panel is open; close on Escape.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <div className={compact ? 'ai-sum ai-sum-compact' : 'ai-sum'} aria-label="Summarize this page with AI">
      <button type="button" className={compact ? 'ai-sum-compact-btn' : 'btn secondary ai-sum-open'} onClick={openPanel} aria-label={compact ? 'Summarize this page with AI' : undefined}>
        <span aria-hidden="true">✨</span> {compact ? 'Summary' : 'Summarize with AI'}
      </button>
      {!compact && (
        <p className="ai-sum-note">
          Only this page&apos;s public summary is sent to the AI — your files never leave your
          device.
        </p>
      )}

      {open && (
        <>
          <div
            className="ai-panel-overlay"
            onClick={close}
            aria-hidden="true"
          />
          <aside
            className="ai-panel"
            role="dialog"
            aria-modal="true"
            aria-label="AI summary of this page"
          >
            <div className="ai-panel-head">
              <strong>
                <span aria-hidden="true">✨</span> Page summary
              </strong>
              <button type="button" className="mini-btn" onClick={close} aria-label="Close panel">
                ✕
              </button>
            </div>
            {aiText ? (
              <p className="ai-panel-sub">
                <span aria-hidden="true">✨</span> AI-polished version
              </p>
            ) : null}
            <div className="ai-panel-body">{renderAiText(aiText ?? summaryText)}</div>
            {enhancing && !aiText && (
              <p className="ai-panel-sub" role="status">
                <span aria-hidden="true">✨</span> Polishing with AI…
              </p>
            )}
            <p className="ai-panel-foot">
              Generated from this page&apos;s public text only. Your files are never uploaded or
              shared.
            </p>
          </aside>
        </>
      )}
    </div>
  );
}
