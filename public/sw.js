// Morsel service worker — makes the app shell load offline. Logging keeps
// working offline too, via the built-in parser and food database that already
// live in the page. Journals never touch this cache (they're in localStorage),
// and API calls are never cached: the brain stays live-or-local.
const CACHE = 'morsel-shell-v1';

// The shell, expressed for both deployments: GitHub Pages serves one inlined
// document ('.'), the local brain server serves the split files. Whatever
// isn't there just doesn't get cached.
const SHELL = ['.', 'manifest.webmanifest', 'icon.png', 'app.css', 'app.js', 'engine.js'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Never cache the brain: parsing must be live (or the page's local fallback).
  if (event.request.method !== 'GET' || url.pathname.includes('/api/')) return;

  // Documents: network first, so online users always get the freshest build;
  // the cached copy is purely the offline fallback.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(event.request);
        cache.put(event.request, res.clone());
        return res;
      } catch {
        return (await cache.match(event.request)) || (await cache.match('.')) || Response.error();
      }
    })());
    return;
  }

  // Assets and fonts: serve from cache instantly, refresh in the background.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    const fresh = fetch(event.request).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(event.request, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await fresh) || Response.error();
  })());
});
