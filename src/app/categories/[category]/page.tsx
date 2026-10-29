import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import AiSummarize from '@/components/AiSummarize';
import { buildSummaryPrompt } from '@/lib/ai';
import { CATEGORIES, convertersByCategory, categoryMeta } from '@/lib/converters/registry';
import { SITE_URL } from '@/lib/site';

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const meta = CATEGORIES.find((c) => c.id === category);
  if (!meta) return {};
  return {
    title: `${meta.name} — Free, No Upload`,
    description: meta.description,
    alternates: { canonical: `/categories/${meta.id}/` },
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const meta = CATEGORIES.find((c) => c.id === category);
  if (!meta) notFound();
  const converters = convertersByCategory(meta.id);

  return (
    <div className="wrap">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link> › {meta.name}
      </nav>
      <div className="page-head">
        <h1>{meta.name}</h1>
        <p className="lead">{meta.description}</p>
      </div>
      <AiSummarize
        prompt={buildSummaryPrompt(
          `${SITE_URL}/categories/${meta.id}/`,
          `the ${meta.name} category page on All in One Converter`
        )}
      />
      <div className="grid c3">
        {converters.map((c) => (
          <Link key={c.id} href={`/convert/${c.id}`} className="card">
            <div className="card-t">{c.title}</div>
            <div className="card-d">{c.description}</div>
          </Link>
        ))}
      </div>
      <p style={{ marginTop: '2rem' }}>
        <Link href="/all-converters">Browse all categories →</Link>
      </p>
    </div>
  );
}
