'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { searchSite } from '@/lib/site-search';

/** Results block only — the search form itself is server-rendered in page.tsx. */
export default function SearchResults() {
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const hits = useMemo(() => searchSite(q), [q]);

  if (!q) return null;

  return (
    <>
      <p className="ai-panel-sub" role="status">
        {hits.length === 0
          ? `No converters found for “${q}”.`
          : `${hits.length} result${hits.length === 1 ? '' : 's'} for “${q}”:`}
      </p>
      <div className="tools-grid">
        {hits.map((h) => (
          <Link key={h.href} href={h.href} className="card">
            <div className="card-t">{h.title}</div>
            <div className="card-d">{h.sub}</div>
          </Link>
        ))}
      </div>
      {hits.length === 0 && (
        <p>
          Try the <Link href="/all-converters">full converter list</Link> or suggest a
          new converter via the <Link href="/contact">contact page</Link>.
        </p>
      )}
    </>
  );
}
