const CACHE_NAME = 'socialos-v2';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Don't cache API calls
  if (event.request.url.includes('/api/')) return;
  // Network first strategy
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'SocialOS ⚡', {
      body: data.body || 'لديك إشعار جديد',
      dir: 'rtl',
      lang: 'ar'
    })
  );
});
