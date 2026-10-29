import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import ConverterWidget from '@/components/ConverterWidget';
import PdfWidget from '@/components/PdfWidget';
import MergeWidget from '@/components/MergeWidget';
import AiSummarize from '@/components/AiSummarize';
import { buildConverterSummaryText } from '@/lib/ai';
import {
  BRAND,
  CONVERTERS,
  getConverter,
  relatedConverters,
  categoryMeta,
} from '@/lib/converters/registry';
import { SITE_URL } from '@/lib/site';
import {
  ldScript,
  webApplicationJsonLd,
  faqPageJsonLd,
  breadcrumbJsonLd,
  howToJsonLd,
} from '@/lib/jsonld';

export function generateStaticParams() {
  return CONVERTERS.map((c) => ({ pair: c.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ pair: string }>;
}): Promise<Metadata> {
  const { pair } = await params;
  const entry = getConverter(pair);
  if (!entry) return {};
  return {
    title: `${entry.title} — Free, No Upload`,
    description: `${entry.description} Free forever, no sign-up. Your files never leave your device.`,
    alternates: { canonical: `/convert/${entry.id}/` },
  };
}

export default async function ConvertPage({
  params,
}: {
  params: Promise<{ pair: string }>;
}) {
  const { pair } = await params;
  const entry = getConverter(pair);
  if (!entry) notFound();
  const related = relatedConverters(entry);
  const cat = categoryMeta(entry.category);
  const pageUrl = `${SITE_URL}/convert/${entry.id}/`;

  const howToSteps = [
    {
      name: 'Drop your file',
      text: `Drag your ${entry.from} file (${entry.fromExts.map((e) => '.' + e).join(', ')}) into the box above, or click to browse your device.`,
    },
    {
      name: 'Convert on your device',
      text: `Hit "Convert to ${entry.to}". The conversion runs entirely in your browser — nothing is uploaded.`,
    },
    {
      name: 'Download the result',
      text: `Your new .${entry.toExt} file downloads instantly, ready to use anywhere.`,
    },
  ];

  return (
    <div className="wrap">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link> › <Link href={`/categories/${cat.id}`}>{cat.name}</Link> ›{' '}
        {entry.title}
      </nav>

      <div className="page-head compact">
        <span className="pill">
          {entry.fromExts.map((e) => '.' + e).join(', ')} → .{entry.toExt}
        </span>
        <h1>Free {entry.title}</h1>
        <p className="lead">{entry.description}</p>
      </div>

      {entry.widget === 'pdf' ? (
        <PdfWidget entryId={entry.id} />
      ) : entry.widget === 'merge' ? (
        <MergeWidget entryId={entry.id} />
      ) : (
        <ConverterWidget entryId={entry.id} />
      )}

      <AiSummarize
        summaryText={buildConverterSummaryText({
          title: entry.title,
          description: entry.description,
          from: entry.from,
          to: entry.to,
          aboutFrom: entry.aboutFrom,
          aboutTo: entry.aboutTo,
          loadingNote: entry.loadingNote,
        })}
      />

      <p className="tldr">
        <strong>TL;DR:</strong> Drop a {entry.from} file, get a {entry.to} file back in
        seconds. Free forever, no sign-up — and your file never leaves your device because
        the conversion runs in your browser.
        {entry.loadingNote
          ? ' First use downloads a ~30 MB converter engine (one time); after that it’s instant.'
          : null}
      </p>

      {entry.id === 'video-to-gif' ? (
        <div className="cta-band slim">
          <h2>Want frame-perfect control?</h2>
          <p>
            Trim the exact moment, set size, FPS and quality with two-pass color rendering.
          </p>
          <Link href="/gif-maker" className="btn">
            Open the GIF Maker studio →
          </Link>
        </div>
      ) : null}

      <section className="prose">
        <h2>How to convert {entry.from} to {entry.to}</h2>
        <div className="steps">
          <div className="step">
            <div className="s-t">1. Drop your file</div>
            <div className="s-d">
              Drag your {entry.from} file ({entry.fromExts.map((e) => '.' + e).join(', ')}) into
              the box above, or click to browse your device.
            </div>
          </div>
          <div className="step">
            <div className="s-t">2. Convert on your device</div>
            <div className="s-d">
              Hit “Convert to {entry.to}”. The conversion runs entirely in your browser —
              nothing is uploaded.
            </div>
          </div>
          <div className="step">
            <div className="s-t">3. Download the result</div>
            <div className="s-d">
              Your new .{entry.toExt} file downloads instantly, ready to use anywhere.
            </div>
          </div>
        </div>

        <h2>
          About {entry.from} and {entry.to}
        </h2>
        <p>
          <strong>{entry.from}:</strong> {entry.aboutFrom}
        </p>
        <p>
          <strong>{entry.to}:</strong> {entry.aboutTo}
        </p>

        <h2>When to use this conversion</h2>
        <ul>
          {entry.useCases.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>

        <div className="tip-note" role="note">
          <strong>Practical tip:</strong> {entry.tip}
        </div>

        <h2>
          {entry.from} to {entry.to} — FAQs
        </h2>
        {entry.faqs.map((f) => (
          <details key={f.q} className="faq">
            <summary>{f.q}</summary>
            <div className="faq-a">{f.a}</div>
          </details>
        ))}

        <h2>About this conversion</h2>
        <p>
          {entry.description} Like every tool on {BRAND}, this converter is free
          forever with no sign-up and no watermarks. Because the work happens
          on-device, it is also private by design: your {entry.from} file never
          travels over the internet, so sensitive documents and personal photos
          stay exactly where they belong — with you.
        </p>

        <h2>Related converters</h2>
        <div className="grid c3">
          {related.map((c) => (
            <Link key={c.id} href={`/convert/${c.id}`} className="card">
              <div className="card-t">{c.title}</div>
              <div className="card-d">
                {c.fromExts.map((e) => '.' + e).join(', ')} → .{c.toExt}
              </div>
            </Link>
          ))}
        </div>
        <p style={{ marginTop: '1.5rem' }}>
          <Link href="/all-converters">See all {CONVERTERS.length} converters →</Link>
        </p>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ldScript(webApplicationJsonLd(entry, `/convert/${entry.id}/`))}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ldScript(faqPageJsonLd(entry.faqs))}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ldScript(
          breadcrumbJsonLd([
            { name: 'Home', url: `${SITE_URL}/` },
            { name: cat.name, url: `${SITE_URL}/categories/${cat.id}/` },
            { name: entry.title, url: pageUrl },
          ])
        )}
      />
      {entry.flagship ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={ldScript(
            howToJsonLd(
              `How to convert ${entry.from} to ${entry.to}`,
              entry.description,
              howToSteps,
              pageUrl
            )
          )}
        />
      ) : null}
    </div>
  );
}
