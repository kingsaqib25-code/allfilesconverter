/**
 * Shared site-search matching (used by the /search page; mirrors the
 * header SearchBar's token logic so both rank the same way).
 */
import {
  BRAND,
  CATEGORIES,
  CONVERTERS,
  STANDALONE_TOOLS,
  categoryMeta,
  convertersByCategory,
} from './converters/registry';

export interface SiteSearchHit {
  kind: 'converter' | 'category' | 'tool';
  id: string;
  title: string;
  sub: string;
  href: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+ ]/g, ' ');
}

export function searchSite(q: string, limit = 24): SiteSearchHit[] {
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored: { hit: SiteSearchHit; score: number }[] = [];

  for (const c of CONVERTERS) {
    const cat = categoryMeta(c.category);
    const hay = norm(
      `${c.title} ${c.id.replace(/-/g, ' ')} ${c.from} ${c.to} ${c.description} ${cat.name}`
    );
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

  for (const t of STANDALONE_TOOLS) {
    const hay = norm(`${t.title} ${t.id.replace(/-/g, ' ')} ${t.description}`);
    if (!tokens.every((tk) => hay.includes(tk))) continue;
    scored.push({
      hit: {
        kind: 'tool',
        id: t.id,
        title: t.title,
        sub: 'File tool',
        href: t.href.replace(/\/$/, ''),
      },
      score: 2,
    });
  }

  // Flagship GIF maker (standalone page, not in the registry).
  {
    const hay = norm(`video to gif maker gif ${BRAND}`);
    if (tokens.every((tk) => hay.includes(tk) || 'gif'.includes(tk))) {
      scored.push({
        hit: {
          kind: 'tool',
          id: 'gif-maker',
          title: 'Video to GIF Maker',
          sub: 'Flagship tool',
          href: '/gif-maker',
        },
        score: tokens.includes('gif') ? 4 : 0,
      });
    }
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
  const seen = new Set<string>();
  return scored
    .filter((s) => (seen.has(s.hit.href) ? false : (seen.add(s.hit.href), true)))
    .slice(0, limit)
    .map((s) => s.hit);
}
