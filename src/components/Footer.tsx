import Link from 'next/link';
import { CATEGORIES, CONVERTERS } from '@/lib/converters/registry';

export default function Footer() {
  const popular = ['heic-to-jpg', 'png-to-jpg', 'jpg-to-webp', 'mp4-to-mp3', 'json-to-csv', 'srt-to-vtt']
    .map((id) => CONVERTERS.find((c) => c.id === id))
    .filter((c) => c !== undefined);
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <h4>Quick Files Converter</h4>
            <p style={{ fontSize: '0.94rem', color: 'var(--ink-soft)', maxWidth: '300px' }}>
              Free file converter. Your files never leave your device — every
              conversion runs in your browser, with no uploads and no sign-up.
            </p>
          </div>
          <div>
            <h4>Categories</h4>
            <ul>
              {CATEGORIES.map((c) => (
                <li key={c.id}>
                  <Link href={`/categories/${c.id}`}>{c.name}</Link>
                </li>
              ))}
              <li>
                <Link href="/all-converters">All converters</Link>
              </li>
            </ul>
          </div>
          <div>
            <h4>Popular</h4>
            <ul>
              {popular.map((c) => (
                <li key={c!.id}>
                  <Link href={`/convert/${c!.id}`}>{c!.title}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4>Site</h4>
            <ul>
              <li><Link href="/about">About</Link></li>
              <li><Link href="/privacy">Privacy policy</Link></li>
              <li><Link href="/contact">Contact</Link></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Quick Files Converter. Free forever.</span>
          <span>No uploads. No accounts. No tracking.</span>
        </div>
      </div>
    </footer>
  );
}
