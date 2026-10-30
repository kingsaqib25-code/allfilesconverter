'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import SearchBar from './SearchBar';
import FeedbackButton from './FeedbackButton';
import HeaderSummaryButton from './HeaderSummaryButton';
import { CATEGORIES, convertersByCategory, standaloneToolsByCategory, TAGLINE } from '@/lib/converters/registry';

import { ToolIcon } from './ToolIcons';

const catCount = (id: (typeof CATEGORIES)[number]['id']) =>
  convertersByCategory(id).length + standaloneToolsByCategory(id).length;

const VISIBLE_CATEGORIES = CATEGORIES.filter((c) => catCount(c.id) > 0);

/** Category order for the desktop mega menu. */
const MEGA_ORDER: (typeof CATEGORIES)[number]['id'][] = [
  'pdf',
  'image',
  'video',
  'audio',
  'text',
  'data',
  'subtitle',
  'tools',
];

function MegaMenu() {
  return (
    <div className="nav-drop-panel nav-drop-mega" role="menu" aria-label="All tools by category">
      {MEGA_ORDER.map((cid) => {
        const cat = CATEGORIES.find((c) => c.id === cid)!;
        const tools = convertersByCategory(cid);
        const standalone = standaloneToolsByCategory(cid);
        const gifMaker = cid === 'video' ? [{ id: 'gif-maker', title: 'GIF Maker', href: '/gif-maker/' }] : [];
        const rows = [
          ...tools.map((t) => ({ id: t.id, title: t.title.replace(/ Converter$/, ''), href: `/convert/${t.id}` })),
          ...standalone.map((t) => ({ id: t.id, title: t.title, href: t.href })),
          ...gifMaker,
        ];
        if (rows.length === 0) return null;
        return (
          <div className="mega-col" key={cid}>
            <div className="mega-col-title">{cat.name.replace(/ Converters$/, '')}</div>
            {rows.map((r) => (
              <Link key={r.id} href={r.href} className="mega-row" role="menuitem">
                <ToolIcon id={r.id} size={26} title={r.title} />
                <span className="mega-row-t">{r.title}</span>
              </Link>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ConvertersDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const close = () => setOpen(false);
  const desktopHover = () =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;

  return (
    <div
      className="nav-drop"
      ref={ref}
      data-slot="converters-dropdown"
      onMouseEnter={() => {
        if (desktopHover()) setOpen(true);
      }}
      onMouseLeave={() => {
        if (desktopHover()) setOpen(false);
      }}
    >
      <button
        ref={btnRef}
        type="button"
        className="nav-drop-btn"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        Converters <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <>
          <div className="nav-drop-panel nav-drop-list" role="menu">
            <Link href="/all-converters" className="nav-drop-item nav-drop-all" role="menuitem" onClick={close}>
              All converters
              <span className="nav-drop-count">{VISIBLE_CATEGORIES.reduce((n, c) => n + catCount(c.id), 0)}</span>
            </Link>
            {VISIBLE_CATEGORIES.map((c) => (
              <Link
                key={c.id}
                href={`/categories/${c.id}`}
                className="nav-drop-item"
                role="menuitem"
                onClick={close}
              >
                {c.name}
                <span className="nav-drop-count">{catCount(c.id)}</span>
              </Link>
            ))}
          </div>
          <MegaMenu />
        </>
      )}
    </div>
  );
}

function MobileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // shadcn Sheet behavior: body scroll-lock while open, Esc closes, backdrop closes.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open ]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const close = () => setOpen(false);

  return (
    <div className="mmenu" ref={ref} data-slot="mobile-menu">
      <button
        ref={btnRef}
        type="button"
        className="menu-btn"
        aria-expanded={open}
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{open ? '✕' : '☰'}</span>
      </button>
      {open && (
        <>
          <div className="mmenu-backdrop" aria-hidden="true" onClick={close} />
          <div className="mmenu-panel" role="menu" aria-label="Site menu">
            <div className="mmenu-head">
              <span className="mmenu-title">Menu</span>
              <button
                type="button"
                className="mmenu-close"
                aria-label="Close menu"
                onClick={close}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
            <div className="mmenu-search">
              <SearchBar />
            </div>
            <Link href="/all-converters" className="mmenu-item mmenu-all" role="menuitem" onClick={close}>
              All converters
            </Link>
            {VISIBLE_CATEGORIES.map((c) => (
              <Link
                key={c.id}
                href={`/categories/${c.id}`}
                className="mmenu-item"
                role="menuitem"
                onClick={close}
              >
                {c.name}
                <span className="nav-drop-count">{catCount(c.id)}</span>
              </Link>
            ))}
            <div className="mmenu-sep" role="separator" />
            <div className="mmenu-item mmenu-summary">
              <HeaderSummaryButton />
            </div>
            <Link href="/about" className="mmenu-item" role="menuitem" onClick={close}>About</Link>
            <Link href="/contact" className="mmenu-item" role="menuitem" onClick={close}>Contact</Link>
            <Link href="/privacy" className="mmenu-item" role="menuitem" onClick={close}>Privacy</Link>
            <div className="mmenu-item mmenu-feedback">
              <FeedbackButton />
            </div>
          </div>
        </>
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
            <small>{TAGLINE}</small>
          </span>
        </Link>
        <SearchBar />
        <nav className="nav" aria-label="Main navigation">
          <ConvertersDropdown />
          <Link href="/categories/image" className="nav-link">Images</Link>
          <Link href="/categories/data" className="nav-link">Data</Link>
          <Link href="/about" className="nav-link">About</Link>
          <HeaderSummaryButton />
        </nav>
        <MobileMenu />
      </div>
    </header>
  );
}
