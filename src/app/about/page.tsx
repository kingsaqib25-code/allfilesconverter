import Link from 'next/link';
import type { Metadata } from 'next';
import { BRAND, CONVERTERS } from '@/lib/converters/registry';

export const metadata: Metadata = {
  title: 'About — Free On-Device File Converter',
  description: `What ${BRAND} is and why it converts files in your browser instead of on a server.`,
  alternates: { canonical: '/about/' },
};

export default function About() {
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>About {BRAND}</h1>
        <p className="lead">
          A free file converter with a simple idea: your files should never have
          to leave your device to change format.
        </p>
      </div>
      <section className="prose">
        <h2>What this is</h2>
        <p>
          {BRAND} is a collection of {CONVERTERS.length} free converters for
          images, text documents, data formats and subtitles. Every conversion —
          HEIC to JPG, JSON to CSV, SRT to WebVTT, PNG to WebP and the rest —
          runs entirely in your browser using modern web technology.
        </p>
        <h2>Why on-device?</h2>
        <p>
          Almost every online converter works the same way: you upload your file
          to their server, they convert it, you download the result. That means
          your photos, documents and data sit on a stranger's computer, even if
          only for a moment.
        </p>
        <p>We do it differently:</p>
        <ul>
          <li><strong>No uploads.</strong> Your file is read and converted locally by your own browser.</li>
          <li><strong>No accounts.</strong> There is nothing to sign up for, because there is nothing to store.</li>
          <li><strong>No tracking.</strong> We do not run analytics on file conversions — there is nothing to analyse.</li>
          <li><strong>Works offline-ish.</strong> Once the page loads, conversion needs no network at all.</li>
        </ul>
        <h2>What is coming</h2>
        <p>
          Video and audio converters (MP4 to MP3 and friends) are next — they need
          a bigger on-device engine, so they are arriving in version 2. More
          image, document and archive formats will follow. If there is a
          conversion you need, <Link href="/contact">tell us</Link>.
        </p>
        <h2>Free forever</h2>
        <p>
          All converters are free with no limits, no watermarks and no "pro"
          upsell standing between you and your files.
        </p>
      </section>
    </div>
  );
}
