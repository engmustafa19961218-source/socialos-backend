const V = 'sos-v57';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.map(c => caches.delete(c)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method === 'GET') e.respondWith(fetch(e.request).catch(() => new Response('')));
});
