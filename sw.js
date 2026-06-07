// ========== SocialOS Service Worker ==========
const CACHE_NAME = 'socialos-v1';
const API_ORIGIN = 'https://socialos-production-4aa6.up.railway.app';

// الملفات التي تُحفظ للعمل بدون إنترنت
const STATIC_ASSETS = [
  '/',
  '/app.html',
  '/manifest.json'
];

// ========== INSTALL ==========
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.log('SW install error:', err))
  );
});

// ========== ACTIVATE ==========
self.addEventListener('activate', (event) => {
  event.waitUntil(
    // حذف الـ cache القديم
    caches.keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ========== FETCH ==========
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls — لا تُحفظ، دائماً من الشبكة
  if (url.origin === API_ORIGIN || url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .catch(() => new Response(
          JSON.stringify({ success: false, message: 'لا يوجد اتصال بالإنترنت' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        ))
    );
    return;
  }

  // Google Fonts و CDN — شبكة أولاً ثم cache
  if (
    url.origin.includes('googleapis.com') ||
    url.origin.includes('gstatic.com') ||
    url.origin.includes('jsdelivr.net') ||
    url.origin.includes('accounts.google.com')
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // حفظ نسخة في الـ cache
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // الملفات الثابتة — cache أولاً ثم شبكة
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;

        return fetch(request)
          .then((response) => {
            // حفظ الملفات الجديدة في الـ cache
            if (response.ok && request.method === 'GET') {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
            }
            return response;
          })
          .catch(() => {
            // صفحة offline لو طلب صفحة HTML
            if (request.headers.get('accept')?.includes('text/html')) {
              return caches.match('/app.html');
            }
            return new Response('', { status: 503 });
          });
      })
  );
});

// ========== PUSH NOTIFICATIONS ==========
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body || '',
      icon: data.icon || '/icon-192.png',
      badge: '/icon-72.png',
      dir: 'rtl',
      lang: 'ar',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' },
      actions: data.actions || []
    };

    event.waitUntil(
      self.registration.showNotification(data.title || 'SocialOS ⚡', options)
    );
  } catch (e) {
    console.log('Push notification error:', e);
  }
});

// ========== NOTIFICATION CLICK ==========
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // لو التطبيق مفتوح بالفعل، افتح الـ tab الموجود
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus();
            client.navigate(urlToOpen);
            return;
          }
        }
        // لو مو مفتوح، افتح نافذة جديدة
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// ========== BACKGROUND SYNC ==========
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncPendingData());
  }
});

async function syncPendingData() {
  try {
    // مزامنة البيانات المعلقة عند عودة الاتصال
    console.log('SW: syncing pending data...');
  } catch (e) {
    console.log('SW sync error:', e);
  }
}
