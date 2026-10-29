'use client';

/**
 * Compact "✨ Summary" button for the site header (every page, mobile +
 * desktop). Opens the same AI summary panel, fed with THAT page's summary
 * from the build-time PAGE_SUMMARIES map (homepage = full-site summary).
 * Unknown paths fall back to the full-site summary.
 */
import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import AiSummarize from './AiSummarize';
import { PAGE_SUMMARIES, FULL_SITE_SUMMARY } from '@/lib/site-summary.generated';

function normPath(p: string | null): string {
  if (!p) return '/';
  const noQuery = p.split(/[?#]/)[0];
  const withLead = noQuery.startsWith('/') ? noQuery : '/' + noQuery;
  return withLead.endsWith('/') ? withLead : withLead + '/';
}

export default function HeaderSummaryButton() {
  const pathname = usePathname();
  const { key, text } = useMemo(() => {
    const k = normPath(pathname);
    return { key: k, text: PAGE_SUMMARIES[k] || FULL_SITE_SUMMARY };
  }, [pathname]);
  // key resets panel state when navigating between pages
  return <AiSummarize key={key} summaryText={text} compact />;
}
