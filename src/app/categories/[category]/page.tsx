import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import AiSummarize from '@/components/AiSummarize';
import { ToolCard } from '@/components/ToolCard';
import { BRAND, CATEGORIES, convertersByCategory, categoryMeta, STANDALONE_TOOLS } from '@/lib/converters/registry';
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
  const converters = convertersByCategory(meta.id).sort(
    (a, b) => (b.to === 'PDF' ? 1 : 0) - (a.to === 'PDF' ? 1 : 0)
  );
  const standalone = STANDALONE_TOOLS.filter((t) => t.category === meta.id);
  const totalTools = converters.length + standalone.length;

  return (
    <div className="wrap">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link> › {meta.name}
      </nav>
      <div className="page-head compact">
        <h1>{meta.name}</h1>
        <div className="cat-sub">
          <p className="tool-tagline">
            {totalTools} free tools · No sign-up · Files never leave your device
          </p>
          <AiSummarize
            compact
            summaryText={`${meta.name} converters on ${BRAND}. ${meta.description} TL;DR: every tool on this page is free forever with no sign-up, and your files never leave your device because all conversions run on-device in your browser.`}
          />
        </div>
      </div>
      <div className="tools-grid">
        {converters.map((c) => (
          <ToolCard
            key={c.id}
            entry={{ id: c.id, title: c.title, description: c.description, category: c.category }}
          />
        ))}
        {standalone.map((t) => (
          <ToolCard
            key={t.id}
            entry={{ id: t.id, title: t.title, description: t.description, category: t.category, href: t.href }}
          />
        ))}
      </div>
      <section className="prose">
        <h2>About {meta.name}</h2>
        <p>{meta.description}</p>
      </section>
      <p style={{ marginTop: '2rem' }}>
        <Link href="/all-converters">Browse all categories →</Link>
      </p>
    </div>
  );
}
