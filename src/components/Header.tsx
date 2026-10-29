'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import SearchBar from './SearchBar';
import { CATEGORIES, convertersByCategory } from '@/lib/converters/registry';

function ConvertersDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="nav-drop" ref={ref}>
      <button
        type="button"
        className="nav-drop-btn"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        Converters <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="nav-drop-panel" role="menu">
          <Link href="/all-converters" className="nav-drop-item nav-drop-all" role="menuitem" onClick={() => setOpen(false)}>
            All converters
            <span className="nav-drop-count">{CATEGORIES.reduce((n, c) => n + convertersByCategory(c.id).length, 0)}</span>
          </Link>
          {CATEGORIES.map((c) => (
            <Link
              key={c.id}
              href={`/categories/${c.id}`}
              className="nav-drop-item"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              {c.name}
              <span className="nav-drop-count">{convertersByCategory(c.id).length}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Header() {
  return (
    <header className="site-header">
      <div className="wrap header-wrap">
        <Link href="/" className="logo" aria-label="Quick Files Converter — home">
          <svg
            className="logo-mark"
            width="34"
            height="34"
            viewBox="0 0 64 64"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="2" y="2" width="60" height="60" rx="15" fill="#0f766e" />
            <polygon points="27,9 42,33 33,33 37,55 19,29 29,29" fill="#ffffff" />
          </svg>
          <span>
            Quick Files Converter
            <small>Free file converter</small>
          </span>
        </Link>
        <SearchBar />
        <nav className="nav" aria-label="Main navigation">
          <ConvertersDropdown />
          <Link href="/categories/image" className="nav-link">Images</Link>
          <Link href="/categories/data" className="nav-link">Data</Link>
          <Link href="/about" className="nav-link">About</Link>
        </nav>
      </div>
    </header>
  );
}
