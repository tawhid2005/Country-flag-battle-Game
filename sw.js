// Cache only public game resources. Never cache administrative or API responses.
const CACHE_NAME = 'cfb-cache-v17';
const PUBLIC_ASSETS = ['/', '/index.html', '/vendor/matter.min.js', '/client-access.js', '/activation-links.js', '/checkout.css', '/checkout-themes.css', '/assets/payments/bkash-mark.png', '/assets/payments/nagad-logo.png', '/assets/payments/rocket-logo.png', '/manifest.json', '/icon-192.png', '/icon-512.png', '/favicon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PUBLIC_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('cfb-cache-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/') || url.search || url.hash) return;
  if (event.request.mode === 'navigate') {
    if (!['/', '/index.html'].includes(url.pathname)) return;
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone())));
      return response;
    }).catch(async () => (await caches.match(event.request)) || (await caches.match('/index.html')) || Response.error()));
    return;
  }
  if (!PUBLIC_ASSETS.includes(url.pathname)) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
