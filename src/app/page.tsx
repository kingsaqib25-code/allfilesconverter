import Link from 'next/link';
import HeroDropZone from '@/components/HeroDropZone';
import AiSummarize from '@/components/AiSummarize';
import ToolsGrid from '@/components/ToolsGrid';
import { ToolCard } from '@/components/ToolCard';
import { BRAND, TAGLINE, CONVERTERS } from '@/lib/converters/registry';
import { SITE_URL } from '@/lib/site';
import { ldScript, websiteOrgJsonLd } from '@/lib/jsonld';

const POPULAR_IDS = [
  'edit-pdf',
  'pdf-to-jpg',
  'jpg-to-pdf',
  'merge-pdf',
  'pdf-to-word',
  'heic-to-jpg',
  'mp4-to-mp3',
  'png-to-jpg',
  'jpg-to-webp',
  'webp-to-jpg',
  'mov-to-mp4',
  'json-to-csv',
  'srt-to-vtt',
];

export default function Home() {
  const popular = POPULAR_IDS.map((id) => CONVERTERS.find((c) => c.id === id)!).filter(Boolean);

  return (
    <>
      <section className="hero">
        <div className="wrap">
          <span className="kicker">100% free · No sign-up</span>
          <h1>Free File Converter</h1>
          <p className="lead">{BRAND} — {TAGLINE} Your files never leave your device.</p>
          <HeroDropZone />
        </div>
      </section>

      <div className="wrap">
        <AiSummarize
          summaryText={`${BRAND} — ${TAGLINE} Convert PDF, images, video, audio, text, data and subtitles between ${CONVERTERS.length}+ formats, right here in your browser. TL;DR: pick any converter, drop your file, and download the result in seconds. Free forever, no sign-up, no watermarks — and your files never leave your device because every conversion runs on-device in your browser.`}
        />
        <div className="badge-row" aria-label="Why Quick Files Converter">
          <span className="badge">🔒 No upload — files stay on your device</span>
          <span className="badge">✨ Free forever</span>
          <span className="badge">🚫 No sign-up</span>
        </div>

        <h2>All converter tools</h2>
        <ToolsGrid />

        <h2>Popular conversions</h2>
        <div className="tools-grid">
          {popular.map((c) => (
            <ToolCard
              key={c.id}
              entry={{ id: c.id, title: c.title, description: c.description, category: c.category }}
            />
          ))}
        </div>

        <div className="cta-band">
          <h2>Need a different conversion?</h2>
          <p>Browse the full list of {CONVERTERS.length} free converters — new formats are added regularly.</p>
          <Link href="/all-converters" className="btn">See all converters →</Link>
        </div>

        <section className="prose">
          <h2>How it works</h2>
          <p>
            Most online converters upload your files to somebody else's server. {BRAND} does
            the opposite: the conversion happens inside your browser using modern web
            technology (Canvas, WebAssembly and the File API). That means your photos,
            documents and data are never sent anywhere — they literally cannot leak,
            because there is no server processing them.
          </p>
          <ul>
            <li><strong>Pick a converter</strong> — or drop any file above and we will suggest the right one.</li>
            <li><strong>Convert on your device</strong> — the work happens locally, usually in seconds.</li>
            <li><strong>Download the result</strong> — the new file saves straight to your downloads.</li>
          </ul>
          <h2>Why on-device?</h2>
          <p>
            Privacy is the point. Legal documents, family photos, work spreadsheets —
            some files should never travel the internet. With on-device conversion you
            get the convenience of an online tool with the privacy of desktop software,
            and it works even on slow connections since nothing is uploaded.
          </p>
        </section>

        <div className="cta-band">
          <h2>Make a perfect GIF from any video</h2>
          <p>Trim the exact moment, set size, FPS and quality — rendered in your browser, no watermark.</p>
          <Link href="/gif-maker" className="btn">Open the GIF Maker →</Link>
        </div>
      </div>

      {websiteOrgJsonLd().map((d, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={ldScript(d)} />
      ))}
    </>
  );
}
