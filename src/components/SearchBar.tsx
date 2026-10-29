'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  CATEGORIES,
  CONVERTERS,
  categoryMeta,
  convertersByCategory,
} from '@/lib/converters/registry';

const SUGGEST_ENDPOINT = process.env.NEXT_PUBLIC_SUGGEST_ENDPOINT;

interface Hit {
  kind: 'converter' | 'category';
  id: string;
  title: string;
  sub: string;
  href: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+ ]/g, ' ');
}

function searchConverters(q: string): Hit[] {
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored: { hit: Hit; score: number }[] = [];

  for (const c of CONVERTERS) {
    const cat = categoryMeta(c.category);
    const hay = norm(`${c.title} ${c.id.replace(/-/g, ' ')} ${c.from} ${c.to} ${c.description} ${cat.name}`);
    if (!tokens.every((t) => hay.includes(t))) continue;
    let score = 0;
    const titleN = norm(c.title);
    if (titleN.startsWith(norm(q).trim())) score += 3;
    if (norm(c.id.replace(/-/g, ' ')).includes(norm(q).trim())) score += 2;
    if (tokens.some((t) => norm(c.from).includes(t) || norm(c.to).includes(t))) score += 1;
    scored.push({
      hit: {
        kind: 'converter',
        id: c.id,
        title: c.title,
        sub: `${c.from} → ${c.to} · ${cat.name.replace(' Converters', '')}`,
        href: `/convert/${c.id}`,
      },
      score,
    });
  }
  for (const cat of CATEGORIES) {
    const hay = norm(`${cat.name} ${cat.tagline}`);
    if (!tokens.every((t) => hay.includes(t))) continue;
    scored.push({
      hit: {
        kind: 'category',
        id: cat.id,
        title: cat.name,
        sub: `${convertersByCategory(cat.id).length} converters`,
        href: `/categories/${cat.id}`,
      },
      score: 1,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  // de-dupe by href (a converter may also match its category text)
  const seen = new Set<string>();
  return scored
    .filter((s) => (seen.has(s.hit.href) ? false : (seen.add(s.hit.href), true)))
    .slice(0, 8)
    .map((s) => s.hit);
}

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

export default function SearchBar() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [suggestText, setSuggestText] = useState('');
  const [suggestDone, setSuggestDone] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentNoResult = useRef<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hits = useMemo(() => searchConverters(q), [q]);
  const showResults = open && q.trim().length >= 2;

  // Silent no-result beacon (debounced, once per query) so the owner sees
  // what people search for and can add missing converters.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const query = q.trim();
    if (!SUGGEST_ENDPOINT || query.length < 2) return;
    debounceRef.current = setTimeout(() => {
      const h = searchConverters(query);
      if (h.length === 0 && !sentNoResult.current.has(query.toLowerCase())) {
        sentNoResult.current.add(query.toLowerCase());
        postPayload({ type: 'no-result', text: query, page: window.location.href });
      }
    }, 1500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => setActive(0), [q]);

  const submitSuggestion = useCallback(async () => {
    const text = suggestText.trim();
    if (!text || suggestBusy) return;
    setSuggestBusy(true);
    const ok = await postPayload({
      type: 'suggestion',
      text,
      page: window.location.href,
    });
    setSuggestBusy(false);
    if (ok) {
      setSuggestDone(true);
      setSuggestText('');
    }
  }, [suggestText, suggestBusy]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && hits.length > 0) {
      e.preventDefault();
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === 'ArrowUp' && hits.length > 0) {
      e.preventDefault();
      setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter' && hits.length > 0 && document.activeElement === inputRef.current) {
      e.preventDefault();
      window.location.href = hits[active]?.href ?? hits[0].href;
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="hsearch" ref={wrapRef}>
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setSuggestDone(false);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder="Search converters… (e.g. heic to jpg)"
        aria-label="Search converters"
        autoComplete="off"
        role="combobox"
        aria-expanded={showResults}
        aria-controls="hsearch-list"
      />
      {showResults && (
        <div className="hsearch-results" id="hsearch-list" role="listbox">
          {hits.length > 0 ? (
            hits.map((h, i) => (
              <Link
                key={h.href}
                href={h.href}
                className={`hsearch-item${i === active ? ' active' : ''}`}
                role="option"
                aria-selected={i === active}
                onClick={() => setOpen(false)}
                onMouseEnter={() => setActive(i)}
              >
                <span className="hsearch-title">{h.title}</span>
                <span className="hsearch-sub">{h.sub}</span>
                {h.kind === 'category' && <span className="hsearch-badge">Category</span>}
              </Link>
            ))
          ) : (
            <div className="hsearch-empty">
              <p>
                No converter found for “<strong>{q.trim()}</strong>”.
              </p>
              {SUGGEST_ENDPOINT ? (
                suggestDone ? (
                  <p className="hsearch-thanks" role="status">
                    Thanks — noted! 🙏
                  </p>
                ) : (
                  <div className="hsearch-suggest">
                    <label htmlFor="hsearch-suggest-input">
                      Didn&apos;t find the converter you need? Suggest it:
                    </label>
                    <div className="hsearch-suggest-row">
                      <input
                        id="hsearch-suggest-input"
                        type="text"
                        value={suggestText}
                        onChange={(e) => setSuggestText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            submitSuggestion();
                          }
                        }}
                        placeholder="e.g. docx to pdf"
                        aria-label="Suggest a converter"
                      />
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={suggestBusy || suggestText.trim().length === 0}
                        onClick={submitSuggestion}
                      >
                        {suggestBusy ? 'Sending…' : 'Send'}
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <p>
                  <Link href="/contact" onClick={() => setOpen(false)}>
                    Request it via the Contact page →
                  </Link>
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
