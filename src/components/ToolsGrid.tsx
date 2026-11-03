'use client';

import { useEffect, useMemo, useState } from 'react';
import { CONVERTERS } from '@/lib/converters/registry';
import { ToolCard } from './ToolCard';
import CategoryPills, { type CategoryFilter, FILTER_EVENT } from './CategoryPills';

/** iLovePDF-style "All tools" grid with client-side category filter pills. */
export default function ToolsGrid() {
  const [filter, setFilter] = useState<CategoryFilter>('all');

  // Stay in sync with the sticky hero pills (both dispatch on this event).
  useEffect(() => {
    const onEvt = (e: Event) => setFilter((e as CustomEvent<CategoryFilter>).detail);
    window.addEventListener(FILTER_EVENT, onEvt);
    return () => window.removeEventListener(FILTER_EVENT, onEvt);
  }, []);

  const select = (f: CategoryFilter) => {
    setFilter(f);
    window.dispatchEvent(new CustomEvent(FILTER_EVENT, { detail: f }));
  };
  const list = useMemo(
    () => (filter === 'all' ? CONVERTERS : CONVERTERS.filter((c) => c.category === filter || c.alsoIn?.includes(filter))),
    [filter]
  );

  return (
    <section aria-label="All converter tools" id="all-tools">
      <CategoryPills filter={filter} onSelect={select} />
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
