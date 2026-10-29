'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const SUGGEST_ENDPOINT = process.env.NEXT_PUBLIC_SUGGEST_ENDPOINT;

async function postPayload(payload: Record<string, string>): Promise<boolean> {
  if (!SUGGEST_ENDPOINT) return false;
  try {
    const r = await fetch(SUGGEST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Footer "Feedback" entry point. When no suggest endpoint is configured at
 * build time, this degrades to a plain link to the contact page — feedback
 * is never faked as saved.
 */
export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    if (open) {
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open ]);

  if (!SUGGEST_ENDPOINT) {
    return <Link href="/contact">Feedback</Link>;
  }

  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await postPayload({
      type: 'feedback',
      text: t,
      contact: contact.trim(),
      page: window.location.href,
    });
    setBusy(false);
    if (ok) {
      setDone(true);
      setText('');
      setContact('');
    } else {
      setFailed(true);
    }
  };

  return (
    <>
      <button type="button" className="footer-link-btn" onClick={() => { setOpen(true); setDone(false); setFailed(false); }}>
        Feedback
      </button>
      {open && (
        <div
          className="modal-overlay"
          ref={overlayRef}
          onClick={(e) => {
            if (e.target === overlayRef.current) setOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Send feedback"
        >
          <div className="modal">
            <h2>Send feedback</h2>
            {done ? (
              <>
                <p className="hsearch-thanks" role="status">
                  Thanks — noted! 🙏
                </p>
                <button type="button" className="btn" onClick={() => setOpen(false)}>
                  Close
                </button>
              </>
            ) : (
              <>
                <p className="modal-sub">
                  Spotted a bug, missing a converter, or have an idea? Tell us —
                  files are never included, only your words.
                </p>
                <label htmlFor="fb-text">Your message</label>
                <textarea
                  id="fb-text"
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="e.g. The MP4 to MP3 tool failed on my file…"
                />
                <label htmlFor="fb-contact">
                  Contact (optional) <span className="opt-hint">— only if you want a reply</span>
                </label>
                <input
                  id="fb-contact"
                  type="text"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="email or name"
                />
                {failed && (
                  <p className="alert err" role="alert">
                    Couldn&apos;t send. Please try again — or use the{' '}
                    <Link href="/contact">contact page</Link>.
                  </p>
                )}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || text.trim().length === 0}
                    onClick={submit}
                  >
                    {busy ? 'Sending…' : 'Send feedback'}
                  </button>
                  <button type="button" className="btn secondary" onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
