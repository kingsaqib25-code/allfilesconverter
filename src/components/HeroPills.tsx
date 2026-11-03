'use client';

import { useCallback, useEffect, useState } from 'react';
import CategoryPills, { type CategoryFilter, FILTER_EVENT } from './CategoryPills';

/** Event name syncing the hero pills with the tools-grid pills. */
export { FILTER_EVENT };

/**
 * Category pills at the very top of the homepage hero (sticky on desktop
 * for fast filtering). Selecting one filters the tools grid below and
 * smooth-scrolls to it.
 */
export default function HeroPills() {
  const [filter, setFilter] = useState<CategoryFilter>('all');

  useEffect(() => {
    const onEvt = (e: Event) => setFilter((e as CustomEvent<CategoryFilter>).detail);
    window.addEventListener(FILTER_EVENT, onEvt);
    return () => window.removeEventListener(FILTER_EVENT, onEvt);
  }, []);

  const select = useCallback((f: CategoryFilter) => {
    setFilter(f);
    window.dispatchEvent(new CustomEvent(FILTER_EVENT, { detail: f }));
    document.getElementById('all-tools')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="hero-pills">
      <div className="wrap">
        <CategoryPills filter={filter} onSelect={select} />
      </div>
    </div>
  );
}
