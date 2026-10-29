import type { Metadata } from 'next';
import { BRAND } from '@/lib/converters/registry';

export const metadata: Metadata = {
  title: 'Privacy Policy — Your Files Never Leave Your Device',
  description: `${BRAND} privacy policy: no uploads, no accounts, no tracking. Conversions run 100% on-device in your browser.`,
  alternates: { canonical: '/privacy/' },
};

export default function Privacy() {
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Privacy policy</h1>
        <p className="lead">Short version: your files never leave your device. Long version below.</p>
      </div>
      <section className="prose">
        <h2>1. We never receive your files</h2>
        <p>
          Every converter on {BRAND} runs 100% on-device, inside your web
          browser, using the File API, Canvas and WebAssembly. When you drop a
          file into a converter, it is read by your browser, converted by your
          browser, and the result is downloaded by your browser. No file is ever
          uploaded to our servers — because there is no server-side processing
          at all.
        </p>
        <h2>2. No accounts, no personal data</h2>
        <p>
          There is no sign-up, no login and no profile. We do not ask for your
          name, email or anything else, so we have nothing to store, leak or sell.
        </p>
        <h2>3. No analytics in v1</h2>
        <p>
          This version of the site ships with no analytics, no tracking pixels
          and no third-party scripts that observe your conversions. The only
          network requests are the ones that load the site's own pages.
        </p>
        <h2>4. Contact form</h2>
        <p>
          If you email us via the <a href="/contact">contact page</a>, we receive
          only what you choose to write. We do not share it with anyone.
        </p>
        <h2>5. Changes</h2>
        <p>
          If this policy ever changes, the change will be described here in plain
          language. The on-device promise is the foundation of this site — it is
          not going away.
        </p>
        <p><em>Last updated: October 2026.</em></p>
      </section>
    </div>
  );
}
