import Link from 'next/link';
import type { Metadata } from 'next';
import GifMaker from '@/components/GifMaker';
import AiSummarize from '@/components/AiSummarize';
import { BRAND, getConverter } from '@/lib/converters/registry';
import { SITE_URL } from '@/lib/site';
import { ldScript, webApplicationJsonLd, faqPageJsonLd, breadcrumbJsonLd, howToJsonLd } from '@/lib/jsonld';

export const metadata: Metadata = {
  title: 'Video to GIF Maker — Free, No Upload, No Watermark | All Files Converter',
  description:
    'Turn any video into a high-quality GIF free: trim the exact moment, set size, FPS and quality. Two-pass palette rendering, 100% in your browser — no upload, no watermark, no sign-up.',
  alternates: { canonical: '/gif-maker/' },
};

const FAQS = [
  {
    q: 'Why is my GIF so big?',
    a: 'GIFs store every frame as a full image, so they are inherently heavy — a few seconds at 640px can easily reach tens of megabytes. Shrink it with a shorter clip, 320px width, or 10 fps. The studio shows a rough size estimate before you render, so there are no surprises.',
  },
  {
    q: 'How long can my GIF be?',
    a: 'Up to 15 seconds. That cap exists because longer GIFs become enormous files that are painful to share and slow to load anywhere. For longer clips, convert to MP4 instead — it looks better at a tenth of the size.',
  },
  {
    q: 'Is there really no watermark?',
    a: 'Really none. No logo, no text overlay, no "made with" branding — your GIF is clean. We don\u2019t need watermarks because there\u2019s no account or upsell behind the tool.',
  },
  {
    q: 'Are my videos uploaded anywhere?',
    a: `No. Like every tool on ${BRAND}, the GIF Maker runs entirely in your browser using WebAssembly. Your video never leaves your device — there is no server processing it, so nothing can leak.`,
  },
  {
    q: 'Which browser works best?',
    a: 'The latest Chrome or Edge on a desktop computer — they handle the video engine fastest. It also works in Firefox and Safari, just a little slower on long clips.',
  },
];

const HOWTO_STEPS = [
  {
    name: 'Drop your video',
    text: 'Drag any video file (MP4, MOV, MKV, WebM, AVI and more) into the studio. It stays on your device — nothing is uploaded.',
  },
  {
    name: 'Trim the exact moment',
    text: 'Scrub the timeline to preview, then set the start time and clip length (up to 15 seconds) with the sliders.',
  },
  {
    name: 'Tune size, FPS and quality',
    text: 'Pick an output width (320, 480 or 640px), a frame rate (10–20 fps), and Standard or High quality rendering.',
  },
  {
    name: 'Render and download',
    text: 'Hit "Make my GIF". The studio renders a two-pass palette GIF for the best colors, then you download it — no watermark.',
  },
];

const PAGE_URL = `${SITE_URL}/gif-maker/`;

export default function GifMakerPage() {
  const simpleGif = getConverter('video-to-gif');
  return (
    <div className="wrap">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link> › GIF Maker
      </nav>

      <div className="page-head">
        <span className="pill">VIDEO → GIF</span>
        <h1>Free Video to GIF Maker</h1>
        <p className="lead">
          Turn any video into a crisp, high-quality GIF — trim the exact moment, set the size,
          frame rate and quality, and render with true two-pass color. Free forever, no sign-up,
          no watermark, and your video never leaves your device.
        </p>
        <p className="tldr">
          <strong>TL;DR:</strong> Drop a video, pick your 15-second (or shorter) moment, tune
          width/FPS/quality, and download a clean GIF in seconds. Free, private, no watermark —
          everything happens in your browser.
        </p>
      </div>

      <AiSummarize
        summaryText={`Free Video to GIF Maker on ${BRAND}. TL;DR: drop a video, pick your 15-second (or shorter) moment, tune width, FPS and quality, and download a clean GIF in seconds with two-pass color rendering. Free, private, no watermark — everything happens in your browser, so your video never leaves your device.`}
      />

      <GifMaker />

      <section className="prose">
        <h2>How to make a GIF from a video</h2>
        <div className="steps">
          {HOWTO_STEPS.map((s, i) => (
            <div className="step" key={s.name} id={`step-${i + 1}`}>
              <div className="s-t">{s.name}</div>
              <div className="s-d">{s.text}</div>
            </div>
          ))}
        </div>

        <h2>Why two-pass rendering matters</h2>
        <p>
          Most free GIF tools do a quick single-pass conversion, which is why their GIFs look
          banded and washed out. This studio always renders in two passes: first it analyzes
          your exact clip to build the perfect 256-color palette, then it renders the GIF
          against that palette. High quality mode goes further with finer dithering. The
          result: smoother gradients and truer colors than one-click converters.
        </p>

        <h2>Video to GIF — FAQs</h2>
        {FAQS.map((f) => (
          <details key={f.q} className="faq">
            <summary>{f.q}</summary>
            <div className="faq-a">{f.a}</div>
          </details>
        ))}

        <h2>Prefer one click?</h2>
        <p>
          {simpleGif ? (
            <>
              The <Link href={`/convert/${simpleGif.id}`}>{simpleGif.title}</Link> converts the
              first 10 seconds of any MP4 or MOV instantly — no settings, no trimming. And the{' '}
              <Link href="/convert/mp4-to-mp3">MP4 to MP3 converter</Link> pulls just the audio
              out of a video. Browse all <Link href="/categories/video">video converters</Link>{' '}
              for the full set.
            </>
          ) : (
            <>
              Browse all <Link href="/categories/video">video converters</Link> for the full set,
              including the one-click Video to GIF converter.
            </>
          )}
        </p>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ldScript(
          webApplicationJsonLd(
            {
              id: 'gif-maker',
              title: 'Video to GIF Maker',
              description:
                'Free video-to-GIF studio: trim the exact moment, set size, FPS and quality, and render two-pass palette GIFs in your browser.',
            },
            '/gif-maker/'
          )
        )}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={ldScript(faqPageJsonLd(FAQS))} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ldScript(
          breadcrumbJsonLd([
            { name: 'Home', url: `${SITE_URL}/` },
            { name: 'GIF Maker', url: PAGE_URL },
          ])
        )}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ldScript(
          howToJsonLd('How to make a GIF from a video', 'Trim a video clip and render a high-quality GIF in your browser.', HOWTO_STEPS, PAGE_URL)
        )}
      />
    </div>
  );
}
