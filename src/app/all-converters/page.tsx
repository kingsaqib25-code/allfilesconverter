import Link from 'next/link';
import type { Metadata } from 'next';
import { BRAND, CATEGORIES, CONVERTERS, convertersByCategory } from '@/lib/converters/registry';

export const metadata: Metadata = {
  title: 'All Converters — Free, No Upload',
  description: `Browse every free file converter on ${BRAND}: images, text, data and subtitles. All run on-device — your files never leave your device.`,
  alternates: { canonical: '/all-converters/' },
};

export default function AllConverters() {
  return (
    <div className="wrap">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link> › All converters
      </nav>
      <div className="page-head compact">
        <h1>All converters</h1>
        <p className="tool-tagline">
          {CONVERTERS.length} free tools · No sign-up · Files never leave your device
        </p>
      </div>
      {CATEGORIES.map((cat) => (
        <section key={cat.id}>
          <h2>
            <Link href={`/categories/${cat.id}`} style={{ color: 'var(--ink)' }}>
              {cat.name}
            </Link>
          </h2>
          <div className="grid c3">
            {convertersByCategory(cat.id).map((c) => (
              <Link key={c.id} href={`/convert/${c.id}`} className="card">
                <div className="card-t">{c.title}</div>
                <div className="card-d">
                  {c.id === 'edit-pdf'
                    ? '.pdf → edited .pdf'
                    : `${c.fromExts.map((e) => '.' + e).join(', ')} → .${c.toExt}`}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
