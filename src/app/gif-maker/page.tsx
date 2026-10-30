import Link from 'next/link';
import type { Metadata } from 'next';
import GifMaker from '@/components/GifMaker';
import AiSummarize from '@/components/AiSummarize';
import { BRAND, getConverter } from '@/lib/converters/registry';
import { SITE_URL } from '@/lib/site';
import { ldScript, webApplicationJsonLd, faqPageJsonLd, breadcrumbJsonLd, howToJsonLd } from '@/lib/jsonld';

export const metadata: Metadata = {
  title: 'Video to GIF Converter — Free MP4 to GIF Maker Online | Quick Files Converter',
  description:
    'Convert video to GIF online free: turn MP4, MOV or WebM into a high-quality GIF, trim exact moments, pick Discord-ready sizes, add reverse or boomerang effects, crop, and compress GIFs. 100% in your browser — no upload, no watermark.',
  alternates: { canonical: '/gif-maker/' },
};

const FAQS = [
  {
    q: 'Why is my GIF so big?',
    a: 'GIFs store every frame as a full image, so they are inherently heavy — a few seconds at 640px can easily reach tens of megabytes. Shrink it with a shorter clip, 320px width, 10 fps, or fewer colors. The studio shows a rough size estimate before you render, and the Optimize GIF tab can shrink any existing GIF by 30–70% with no visible difference.',
  },
  {
    q: 'How long can my GIF be?',
    a: 'Up to 15 seconds (10 seconds for ping-pong/boomerang clips, since the output doubles). The cap exists because longer GIFs become enormous files that are painful to share and slow to load anywhere. For longer clips, convert to MP4 instead — it looks better at a tenth of the size.',
  },
  {
    q: 'Is there really no watermark?',
    a: 'Really none. No logo, no text overlay, no "made with" branding — your GIF is clean. We don\u2019t need watermarks because there\u2019s no account or upsell behind the tool.',
  },
  {
    q: 'Are my videos uploaded anywhere?',
    a: `No. Like every tool on ${BRAND}, the GIF studio runs entirely in your browser using WebAssembly. Your video never leaves your device — there is no server processing it, so nothing can leak. That is the honest difference from converters that upload your file first.`,
  },
  {
    q: 'Which browser works best?',
    a: 'The latest Chrome or Edge on a desktop computer — they handle the video engine fastest. It also works in Firefox and Safari, just a little slower on long clips.',
  },
  {
    q: 'How do I make a GIF for Discord?',
    a: 'Drop your video, pick the 💬 Discord preset (320px wide, 10 fps), keep the clip to a few seconds, and render. The preset is tuned to stay well under Discord\u2019s upload limits while still looking sharp. Shorter + smaller = faster to send and always accepted.',
  },
  {
    q: 'How do I reverse a GIF or make a boomerang?',
    a: 'In the Effects section choose ◀ Reverse to play your clip backwards, or 🔁 Ping-pong for the boomerang effect — the clip plays forward then backward in one seamless loop. Ping-pong doubles the output length, so the source clip is capped at 10 seconds.',
  },
  {
    q: 'How do I make my GIF file smaller?',
    a: 'Three levers, biggest first: (1) smaller dimensions — 320px instead of 640px roughly quarters the size; (2) lower frame rate — 10 fps instead of 20 halves it; (3) fewer colors — 128 instead of 256 in the Optimize GIF tab. The tab shows you the before/after size so you can see exactly what you saved.',
  },
  {
    q: 'Can I stop my GIF from looping forever?',
    a: 'Yes. GIFs loop forever by default, but the Loop control lets you set 2 plays or 3 plays instead — handy for reaction GIFs that should land once and stop, or presentations where a looping animation would distract.',
  },
];

const HOWTO_STEPS = [
  {
    name: 'Drop your video',
    text: 'Drag any video file (MP4, MOV, MKV, WebM, AVI, WMV and more) into the studio. It stays on your device — nothing is uploaded, ever.',
  },
  {
    name: 'Mark your exact moment',
    text: 'Scrub the timeline to preview, then set start and end times — with the sliders, by typing m:ss.s, or by pausing and hitting "Use current position". Up to 15 seconds.',
  },
  {
    name: 'Tune size, speed and effects',
    text: 'Pick a preset (💬 Discord, ⚖ Balanced, 🎞 HD, 📦 Tiny) or set width and frame rate yourself. Add 0.5×–2× speed, reverse, ping-pong, a loop count, or crop the frame.',
  },
  {
    name: 'Render in two passes',
    text: 'Hit "Make my GIF". The studio analyzes your exact clip to build the perfect 256-color palette, then renders against it — smoother gradients and truer colors than one-click converters.',
  },
  {
    name: 'Download — or shrink it further',
    text: 'Download your clean GIF with no watermark. Too big? Drop it straight into the Optimize GIF tab to cut 30–70% off the file size.',
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
        <h1>Free Video to GIF Converter</h1>
        <p className="lead">
          Convert any video to a high-quality animated GIF — MP4 to GIF, MOV to GIF, WebM to
          GIF and more. Trim the exact second, pick a Discord-ready size, add reverse or
          boomerang effects, crop the frame, and render with true two-pass color. Free
          forever, no sign-up, no watermark, and your video never leaves your device.
        </p>
        <p className="tldr">
          <strong>TL;DR:</strong> Drop a video, mark your moment with frame-accurate start/end
          times, tune size, speed and effects, and download a clean GIF in seconds. Already
          have a GIF that is too big? The Optimize tab shrinks it by 30–70%. Free, private,
          no watermark — everything happens in your browser.
        </p>
      </div>

      <AiSummarize
        summaryText={`Free Video to GIF Converter on ${BRAND}. TL;DR: drop a video (MP4, MOV, WebM, AVI and more), mark your moment with frame-accurate start/end times, tune size, speed and effects (reverse, ping-pong, loop count, crop), and download a clean GIF in seconds with two-pass color rendering. The Optimize GIF tab shrinks existing GIFs by 30-70%. Free, private, no watermark — everything happens in your browser, so your video never leaves your device.`}
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

        <h2>Every feature, explained</h2>
        <p>
          This is not a one-button converter. Every control below exists because GIFs are
          fiddly — small choices change the file size by 10×. Here is what each one does and
          when to reach for it.
        </p>
        <h3>Precise trimming</h3>
        <p>
          Drag the sliders for a rough cut, then type exact start/end times (m:ss.s) for
          frame-accurate control — or pause the preview on the perfect frame and hit
          &ldquo;Use current position&rdquo;. The end time is derived live, so you always see
          exactly how long your GIF will be before you render.
        </p>
        <h3>Size presets</h3>
        <p>
          Four one-tap presets set width and frame rate together: <strong>💬 Discord</strong>{' '}
          (320px, 10 fps — tuned to stay well under Discord&rsquo;s upload limits),{' '}
          <strong>⚖ Balanced</strong> (480px, 12 fps — the everyday sweet spot),{' '}
          <strong>🎞 HD</strong> (640px, 15 fps — maximum quality), and <strong>📦 Tiny</strong>{' '}
          (240px, 8 fps — smallest possible file). Prefer manual control? Widths from 240 to
          640px and frame rates from 8 to 20 fps are all one tap away.
        </p>
        <h3>Speed control</h3>
        <p>
          0.5× for dramatic slow-motion, 1.5× or 2× to squeeze a longer moment into a short
          GIF. Faster playback also means fewer frames, so 2× roughly halves the file size —
          a legitimate trick when a GIF is just over a size limit.
        </p>
        <h3>Reverse and ping-pong</h3>
        <p>
          <strong>◀ Reverse</strong> plays your clip backwards — great for rewind gags and
          reveals. <strong>🔁 Ping-pong</strong> plays it forward then backward in one
          seamless loop, the classic boomerang effect. Because ping-pong doubles the output,
          the source clip is capped at 10 seconds (which becomes a 20-second GIF).
        </p>
        <h3>Loop control</h3>
        <p>
          GIFs loop forever by default. Set <strong>2 plays</strong> or{' '}
          <strong>3 plays</strong> for a reaction GIF that should land and stop, or for
          slides and pages where a forever-looping animation would distract.
        </p>
        <h3>Crop</h3>
        <p>
          Cut distractions out of the frame <em>before</em> rendering — square 1:1 for
          avatars and stickers, 16:9 for widescreen, 4:3, or a fully custom rectangle in
          source pixels. Cropping first also shrinks the file, since there are fewer pixels
          to store.
        </p>
        <h3>Optimize existing GIFs</h3>
        <p>
          The second tab, <strong>🗜 Optimize GIF</strong>, takes any GIF you already have
          and re-compresses it: fewer palette colors (256 → 128 → 64), smaller dimensions,
          lower frame rate. It shows the before/after file size so you can see exactly what
          you saved — typically 30–70% with no visible difference at 128 colors.
        </p>

        <h2>Video to GIF for Discord</h2>
        <p>
          Discord is where most video-to-GIF conversions end up — custom emojis, stickers,
          and animated avatars. The catch is file size: oversized GIFs get rejected or
          compressed into mush. The workflow that works: keep the clip to 2–4 seconds, hit
          the 💬 Discord preset, and if it is still too big, run it through the Optimize
          tab at 128 colors. You will land a crisp GIF that uploads first try, every try.
        </p>

        <h2>Make your GIFs smaller</h2>
        <p>
          GIF is a 1980s format — it was never designed for video, which is why files
          explode. But three levers control the size, in order of impact: (1){' '}
          <strong>dimensions</strong> — 320px instead of 640px roughly quarters the file;
          (2) <strong>frame rate</strong> — 10 fps instead of 20 halves it; (3){' '}
          <strong>colors</strong> — 128 instead of 256 in the optimizer. The studio shows a
          size estimate <em>before</em> you render, so there are no surprises — and if the
          estimate is too big, the Optimize GIF tab is one click away.
        </p>

        <h2>Why two-pass rendering matters</h2>
        <p>
          Most free GIF tools do a quick single-pass conversion, which is why their GIFs look
          banded and washed out. This studio always renders in two passes: first it analyzes
          your exact clip to build the perfect 256-color palette, then it renders the GIF
          against that palette. High quality mode goes further with finer dithering. The
          result: smoother gradients and truer colors than one-click converters.
        </p>

        <h2>Quick Files Converter vs Ezgif — an honest comparison</h2>
        <p>
          Ezgif is the best-known video-to-GIF site, so here is where each one wins, plainly
          stated:
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Quick Files Converter</th>
                <th>Ezgif</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Privacy</td>
                <td>100% in your browser — your video is never uploaded</td>
                <td>Uploads to their server (auto-deleted after 1 hour)</td>
              </tr>
              <tr>
                <td>Watermark</td>
                <td>None</td>
                <td>None</td>
              </tr>
              <tr>
                <td>Cost / account</td>
                <td>Free, no sign-up</td>
                <td>Free, no sign-up</td>
              </tr>
              <tr>
                <td>Max clip length</td>
                <td>15 seconds (10 for ping-pong)</td>
                <td>Longer at low frame rates (e.g. 60s at 5 fps)</td>
              </tr>
              <tr>
                <td>Max input file</td>
                <td>500 MB (browser memory guard)</td>
                <td>200 MB upload</td>
              </tr>
              <tr>
                <td>Reverse / ping-pong / speed / loop / crop</td>
                <td>Built into one studio</td>
                <td>Crop, resize and optimize are separate post-tools</td>
              </tr>
              <tr>
                <td>GIF compressor</td>
                <td>Built-in Optimize GIF tab</td>
                <td>Separate optimizer tool</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          The trade-off is stated openly: if you need a minute-long GIF, Ezgif&rsquo;s
          server can do what a browser should not attempt. For everything else — privacy,
          speed, and all controls in one place — the studio above wins.
        </p>

        <h2>Great uses for video GIFs</h2>
        <p>
          <strong>Reaction memes and Discord stickers</strong> — the classic: a 2-second
          moment, Tiny preset, under every size limit. <strong>Tutorial snippets</strong> —
          a 5-second UI action beats a paragraph of explanation in docs and chats.{' '}
          <strong>Product demos</strong> — show the feature moving, right in the landing
          page. <strong>Bug reports</strong> — developers love a GIF that reproduces the
          issue in 3 seconds. <strong>Social replies</strong> — a perfectly timed reaction
          says more than text. <strong>Boomerangs</strong> — ping-pong mode turns any
          back-and-forth motion (waves, swings, blinks) into a hypnotic loop.
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
              title: 'Video to GIF Converter',
              description:
                'Free video-to-GIF studio: convert MP4/MOV/WebM to GIF, trim exact moments, Discord-ready presets, reverse, ping-pong, speed, loop and crop controls, GIF optimizer — all in your browser.',
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
          howToJsonLd('How to convert video to GIF', 'Trim a video clip, tune size and effects, and render a high-quality GIF in your browser.', HOWTO_STEPS, PAGE_URL)
        )}
      />
    </div>
  );
}
