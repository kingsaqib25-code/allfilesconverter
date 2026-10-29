'use client';

import { useMemo, useState } from 'react';
import { CATEGORIES, CONVERTERS, convertersByCategory, type Category } from '@/lib/converters/registry';
import { ToolCard } from './ToolCard';

type Filter = 'all' | Category;

/** iLovePDF-style "All tools" grid with client-side category filter pills. */
export default function ToolsGrid() {
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of CATEGORIES) m.set(c.id, convertersByCategory(c.id).length);
    return m;
  }, []);

  const list = useMemo(
    () => (filter === 'all' ? CONVERTERS : CONVERTERS.filter((c) => c.category === filter || c.alsoIn?.includes(filter))),
    [filter]
  );

  return (
    <section aria-label="All converter tools">
      <div className="pills" role="tablist" aria-label="Filter tools by category">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={`pill${filter === 'all' ? ' on' : ''}`}
          onClick={() => setFilter('all')}
        >
          All <span className="pill-n">{CONVERTERS.length}</span>
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={filter === c.id}
            className={`pill${filter === c.id ? ' on' : ''}`}
            onClick={() => setFilter(c.id)}
          >
            {c.name.replace(' Converters', '')} <span className="pill-n">{counts.get(c.id) ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="tools-grid">
        {list.map((c) => (
          <ToolCard key={c.id} entry={c} />
        ))}
      </div>
      <p className="opt-hint" style={{ marginTop: '1rem' }}>
        Showing {list.length} of {CONVERTERS.length} free tools.
      </p>
    </section>
  );
}
