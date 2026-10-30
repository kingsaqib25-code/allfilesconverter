'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Category } from '@/lib/converters/registry';
import { ToolIcon } from './ToolIcons';

/** One-line card description: trimmed registry description, word-boundary cut. */
export function cardDesc(c: { description: string }, max = 96): string {
  const d = c.description.replace(/\s+/g, ' ').trim();
  if (d.length <= max) return d;
  const cut = d.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

export function ToolCard({
  entry,
}: {
  entry: { id: string; title: string; description: string; category: Category } & { href?: string };
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Link
      href={entry.href ?? `/convert/${entry.id}`}
      className={'tool-card' + (expanded ? ' expanded' : '')}
      data-slot="tool-card"
    >
      <ToolIcon id={entry.id} title={entry.title} />
      <span className="tool-card-body">
        <span className="tool-card-t">{entry.title}</span>
        <span className="tool-card-d">{cardDesc(entry)}</span>
      </span>
      <button
        type="button"
        className="tool-card-expand"
        aria-expanded={expanded}
        aria-label={expanded ? `Show less: ${entry.title}` : `Show more: ${entry.title}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
      >
        <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
      </button>
    </Link>
  );
}
