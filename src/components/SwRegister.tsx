'use client';

import { useEffect } from 'react';

/** Registers the PWA service worker (production only — never in dev). */
export default function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* a broken SW is worse than none — fail silently */
      });
    }
  }, []);
  return null;
}
