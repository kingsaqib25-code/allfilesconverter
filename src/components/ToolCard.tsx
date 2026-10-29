'use client';

import Link from 'next/link';
import type { Category, ConverterEntry } from '@/lib/converters/registry';

/** Category brand colors — consistent 2-color flat icon style (iLovePDF-like). */
const CAT_STYLE: Record<Category, { fg: string; bg: string }> = {
  pdf: { fg: '#dc2626', bg: '#fee2e2' },
  image: { fg: '#7c3aed', bg: '#ede9fe' },
  video: { fg: '#2563eb', bg: '#dbeafe' },
  audio: { fg: '#059669', bg: '#d1fae5' },
  text: { fg: '#d97706', bg: '#fef3c7' },
  data: { fg: '#0891b2', bg: '#cffafe' },
  subtitle: { fg: '#db2777', bg: '#fce7f3' },
};

function IconPaths({ category }: { category: Category }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (category) {
    case 'pdf':
      return (
        <g {...common}>
          <path d="M6 2.5h8l4 4V21.5H6z" />
          <path d="M14 2.5v4h4" />
          <path d="M9 12h6M9 15.5h6M9 19h4" />
        </g>
      );
    case 'image':
      return (
        <g {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.5" />
          <path d="M3 17.5l5-5 4 4 3-3 6 6" />
        </g>
      );
    case 'video':
      return (
        <g {...common}>
          <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
          <path d="M10.5 9.5l5 2.5-5 2.5z" />
        </g>
      );
    case 'audio':
      return (
        <g {...common}>
          <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3" />
        </g>
      );
    case 'text':
      return (
        <g {...common}>
          <path d="M4 6.5h16M4 11h16M4 15.5h10M4 20h7" />
        </g>
      );
    case 'data':
      return (
        <g {...common}>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <path d="M3.5 9.5h17M9.5 9.5v10" />
        </g>
      );
    case 'subtitle':
      return (
        <g {...common}>
          <path d="M4 5.5h16v10H9.5L4 19.5z" />
          <path d="M7.5 9.5h9M7.5 12.5h5.5" />
        </g>
      );
  }
}

export function ToolIcon({ category, size = 40 }: { category: Category; size?: number }) {
  const s = CAT_STYLE[category];
  return (
    <span
      className="tool-icon"
      aria-hidden="true"
      style={{ width: size, height: size, color: s.fg, background: s.bg }}
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24">
        <IconPaths category={category} />
      </svg>
    </span>
  );
}

/** One-line card description: trimmed registry description, word-boundary cut. */
export function cardDesc(c: Pick<ConverterEntry, 'description'>, max = 96): string {
  const d = c.description.replace(/\s+/g, ' ').trim();
  if (d.length <= max) return d;
  const cut = d.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

export function ToolCard({ entry }: { entry: Pick<ConverterEntry, 'id' | 'title' | 'description' | 'category'> }) {
  return (
    <Link href={`/convert/${entry.id}`} className="tool-card">
      <ToolIcon category={entry.category} />
      <span className="tool-card-body">
        <span className="tool-card-t">{entry.title}</span>
        <span className="tool-card-d">{cardDesc(entry)}</span>
      </span>
    </Link>
  );
}
