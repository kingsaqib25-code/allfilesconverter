import Link from 'next/link';
import HeroDropZone from '@/components/HeroDropZone';
import AiSummarize from '@/components/AiSummarize';
import { BRAND, TAGLINE, CATEGORIES, CONVERTERS, convertersByCategory } from '@/lib/converters/registry';
import { SITE_URL } from '@/lib/site';
import { ldScript, websiteOrgJsonLd } from '@/lib/jsonld';

const CAT_EMOJI: Record<string, string> = {
  pdf: '📄',
  image: '🖼️',
  video: '🎬',
  audio: '🎵',
  text: '📝',
  data: '🧮',
  subtitle: '💬',
};

const POPULAR_IDS = [
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
          <p className="lead">{BRAND} — {TAGLINE} Convert PDF, images, video, audio, text, data and subtitles between {CONVERTERS.length}+ formats — right here in your browser.</p>
          <HeroDropZone />
        </div>
      </section>

      <div className="wrap">
        <AiSummarize
          summaryText={`${BRAND} — ${TAGLINE} Convert PDF, images, video, audio, text, data and subtitles between ${CONVERTERS.length}+ formats, right here in your browser. TL;DR: pick any converter, drop your file, and download the result in seconds. Free forever, no sign-up, no watermarks — and your files never leave your device because every conversion runs on-device in your browser.`}
        />
        <div className="badge-row" aria-label="Why All Files Converter">
          <span className="badge">🔒 No upload — files stay on your device</span>
          <span className="badge">✨ Free forever</span>
          <span className="badge">🚫 No sign-up</span>
        </div>

        <h2>Browse by category</h2>
        <div className="grid c4">
          {CATEGORIES.map((cat) => (
            <Link key={cat.id} href={`/categories/${cat.id}`} className="card cat-card">
              <div className="cat-emoji" aria-hidden="true">{CAT_EMOJI[cat.id]}</div>
              <div className="card-t">{cat.name}</div>
              <div className="card-d">
                {cat.tagline} ({convertersByCategory(cat.id).length} tools)
              </div>
            </Link>
          ))}
        </div>

        <h2>Popular conversions</h2>
        <div className="grid c4">
          {popular.map((c) => (
            <Link key={c.id} href={`/convert/${c.id}`} className="card">
              <div className="card-t">{c.title}</div>
              <div className="card-d">
                {c.fromExts.map((e) => '.' + e).join(', ')} → .{c.toExt}
              </div>
            </Link>
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
