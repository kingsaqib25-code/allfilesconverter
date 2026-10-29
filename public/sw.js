/* Quick Files Converter service worker.
 * Strategy: NETWORK-FIRST for navigations (users + Googlebot always get fresh
 * HTML — SEO-safe), CACHE-FIRST for versioned static assets, images and the
 * heavy on-device engine bundles (ffmpeg-core, pdfjs, fonts). Versioned cache
 * name; old caches are deleted on activate. */

const VERSION = 'qfc-v1';
const SHELL = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];
const STATIC_RE = /\/(_next\/static|ffmpeg-core|pdfjs|fonts)\//;
const IMG_RE = /\.(png|jpg|jpeg|webp|svg|ico)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // leave CDN/API traffic alone

  if (request.mode === 'navigate') {
    // Network first — always serve fresh HTML when online.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() =>
          caches
            .match(request)
            .then((hit) => hit || caches.match('/')),
        ),
    );
    return;
  }

  if (STATIC_RE.test(url.pathname) || IMG_RE.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
            return res;
          }),
      ),
    );
  }
});
