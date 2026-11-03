'use client';

import { useMemo } from 'react';
import { CATEGORIES, CONVERTERS, convertersByCategory, type Category } from '@/lib/converters/registry';

export type CategoryFilter = 'all' | Category;

/** Window event syncing the hero pills with the tools-grid pills. */
export const FILTER_EVENT = 'qfc:filter';

/** Category filter pills, shared by the hero (sticky) and the tools grid. */
export default function CategoryPills({
  filter,
  onSelect,
}: {
  filter: CategoryFilter;
  onSelect: (f: CategoryFilter) => void;
}) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of CATEGORIES) m.set(c.id, convertersByCategory(c.id).length);
    return m;
  }, []);

  return (
    <div className="pills" role="tablist" aria-label="Filter tools by category">
      <button
        type="button"
        role="tab"
        aria-selected={filter === 'all'}
        className={`pill${filter === 'all' ? ' on' : ''}`}
        onClick={() => onSelect('all')}
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
          onClick={() => onSelect(c.id)}
        >
          {c.name.replace(' Converters', '')} <span className="pill-n">{counts.get(c.id) ?? 0}</span>
        </button>
      ))}
    </div>
  );
}
