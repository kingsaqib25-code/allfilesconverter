import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import SearchResults from './SearchResults';
import { BRAND } from '@/lib/converters/registry';

/**
 * Real search endpoint (also the SearchAction target in the homepage
 * WebSite JSON-LD). The form is server-rendered (plain GET) so crawlers and
 * no-JS visitors get a working search; results hydrate client-side from ?q=.
 * Kept out of the search index (utility page).
 */
export const metadata: Metadata = {
  title: 'Search converters',
  description: `Search every free file converter on ${BRAND}.`,
  robots: { index: false, follow: true },
  alternates: { canonical: '/search/' },
};

export default function SearchPage() {
  return (
    <div className="wrap">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link> › Search
      </nav>
      <div className="page-head">
        <h1>Search converters</h1>
        <form className="hsearch-form" role="search" action="/search" method="get">
          <input
            type="search"
            name="q"
            placeholder="Search converters… (e.g. heic to jpg)"
            aria-label="Search converters"
          />
          <button type="submit" className="btn">Search</button>
        </form>
      </div>
      <Suspense fallback={<p>Loading…</p>}>
        <SearchResults />
      </Suspense>
    </div>
  );
}
