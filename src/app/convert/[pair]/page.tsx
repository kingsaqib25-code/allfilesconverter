import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import ConverterWidget from '@/components/ConverterWidget';
import PdfWidget from '@/components/PdfWidget';
import MergeWidget from '@/components/MergeWidget';
import PdfEditor from '@/components/PdfEditor';
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
  const isEdit = entry.id === 'edit-pdf';

  const howToSteps = isEdit
    ? [
        {
          name: 'Drop your PDF',
          text: 'Drag your PDF into the box above, or click to browse your device. The editor loads it entirely in your browser.',
        },
        {
          name: 'Click any text and edit',
          text: 'Every text block becomes clickable — click it and type your changes right on the page, or switch to Text view for full-page edits.',
        },
        {
          name: 'Download your updated PDF',
          text: 'Hit "Download PDF" to get your file back with the edits baked in — or grab a clean rebuild or a Word file instead.',
        },
      ]
    : [
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
          {isEdit
            ? '.pdf → edited .pdf'
            : `${entry.fromExts.map((e) => '.' + e).join(', ')} → .${entry.toExt}`}
        </span>
        <h1>Free {entry.title}</h1>
        <p className="lead">{entry.description}</p>
      </div>

      {entry.widget === 'pdf' ? (
        <PdfWidget entryId={entry.id} />
      ) : entry.widget === 'merge' ? (
        <MergeWidget entryId={entry.id} />
      ) : entry.widget === 'edit' ? (
        <PdfEditor />
      ) : (
        <ConverterWidget entryId={entry.id} />
      )}

      <AiSummarize
        summaryText={
          isEdit
            ? `${entry.title}. ${entry.description} TL;DR: Drop a PDF, click any text to edit it right on the page, and download the updated PDF in seconds. Free forever, no sign-up — and your file never leaves your device because editing runs in your browser. About PDFs: ${entry.aboutFrom} About editing: ${entry.aboutTo}`
            : buildConverterSummaryText({
                title: entry.title,
                description: entry.description,
                from: entry.from,
                to: entry.to,
                aboutFrom: entry.aboutFrom,
                aboutTo: entry.aboutTo,
                loadingNote: entry.loadingNote,
              })
        }
      />

      <p className="tldr">
        {isEdit ? (
          <>
            <strong>TL;DR:</strong> Drop a PDF, click any text, and type your changes right on
            the page. Download the updated PDF in seconds. Free forever, no sign-up — and your
            file never leaves your device because the editing runs in your browser.
          </>
        ) : (
          <>
            <strong>TL;DR:</strong> Drop a {entry.from} file, get a {entry.to} file back in
            seconds. Free forever, no sign-up — and your file never leaves your device because
            the conversion runs in your browser.
            {entry.loadingNote
              ? ' First use downloads a ~30 MB converter engine (one time); after that it’s instant.'
              : null}
          </>
        )}
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

      {entry.id === 'pdf-to-word' || entry.id === 'pdf-to-text' ? (
        <div className="cta-band slim">
          <h2>Want to edit the text first?</h2>
          <p>
            Click any text in your PDF and type your changes right on the page — then download
            the updated file. All in your browser, nothing uploaded.
          </p>
          <Link href="/convert/edit-pdf" className="btn">
            Open the PDF editor →
          </Link>
        </div>
      ) : null}

      <section className="prose">
        <h2>{isEdit ? 'How to edit a PDF online' : `How to convert ${entry.from} to ${entry.to}`}</h2>
        <div className="steps">
          {howToSteps.map((s, i) => (
            <div className="step" key={s.name}>
              <div className="s-t">
                {i + 1}. {s.name}
              </div>
              <div className="s-d">{s.text}</div>
            </div>
          ))}
        </div>

        <h2>{isEdit ? 'About PDFs and editing them' : `About ${entry.from} and ${entry.to}`}</h2>
        <p>
          <strong>{entry.from}:</strong> {entry.aboutFrom}
        </p>
        <p>
          <strong>{entry.to}:</strong> {entry.aboutTo}
        </p>

        <h2>{isEdit ? 'When to use the PDF editor' : 'When to use this conversion'}</h2>
        <ul>
          {entry.useCases.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>

        <div className="tip-note" role="note">
          <strong>Practical tip:</strong> {entry.tip}
        </div>

        <h2>{isEdit ? 'Edit PDF online — FAQs' : `${entry.from} to ${entry.to} — FAQs`}</h2>
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
              isEdit ? 'How to edit a PDF online' : `How to convert ${entry.from} to ${entry.to}`,
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
