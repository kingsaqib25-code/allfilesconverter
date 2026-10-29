import Link from 'next/link';

export default function Header() {
  return (
    <header className="site-header">
      <div className="wrap">
        <Link href="/" className="logo" aria-label="Quick Files Converter — home">
          <span className="logo-mark" aria-hidden="true">⇄</span>
          <span>
            Quick Files Converter
            <small>Free file converter</small>
          </span>
        </Link>
        <nav className="nav" aria-label="Main navigation">
          <Link href="/all-converters">All converters</Link>
          <Link href="/categories/image">Images</Link>
          <Link href="/categories/data">Data</Link>
          <Link href="/about">About</Link>
        </nav>
      </div>
    </header>
  );
}
