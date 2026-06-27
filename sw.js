// ═══════════════════════════════════════════════
// つながる — Service Worker v2
// 2026年最新PWA実装
// Cache-first for static, Network-first for API
// ═══════════════════════════════════════════════

const CACHE_NAME = 'tsunagaru-v2';
const OFFLINE_URL = '/offline.html';

// インストール時にキャッシュするリソース
const PRECACHE = [
  '/',
  '/index.html',
  '/snsmap.html',
  '/manifest.json',
  '/offline.html',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Inter:wght@400;500;600&display=swap'
];

// ── INSTALL ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // フォントはno-corsで取得
        const requests = PRECACHE.map(url => {
          if (url.startsWith('https://fonts')) {
            return new Request(url, { mode: 'no-cors' });
          }
          return url;
        });
        return cache.addAll(requests).catch(err => {
          console.warn('[SW] Precache partial fail:', err);
        });
      })
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Firebase / 外部APIはネットワーク優先
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    request.method !== 'GET'
  ) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // HTMLページ：Stale-While-Revalidate
  if (request.destination === 'document') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);
        const networkPromise = fetch(request).then(response => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        }).catch(() => null);

        return cached || networkPromise || caches.match(OFFLINE_URL);
      })
    );
    return;
  }

  // 静的アセット：Cache-First
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (!response.ok) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        return response;
      }).catch(() => caches.match(OFFLINE_URL));
    })
  );
});

// ── PUSH NOTIFICATIONS ────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'つながる', {
      body: data.body || '✦ あなたの星座が広がりました',
      icon: '/icon-192.png',
      badge: '/icon-72.png',
      tag: 'tsunagaru-notif',
      data: { url: data.url || '/' },
      vibrate: [100, 50, 100],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});

// ── BACKGROUND SYNC ───────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-posts') {
    event.waitUntil(syncPendingPosts());
  }
});

async function syncPendingPosts() {
  // オフライン中の投稿をFirebaseに同期
  const cache = await caches.open('pending-posts');
  const keys = await cache.keys();
  for (const key of keys) {
    try {
      const response = await fetch(key);
      if (response.ok) await cache.delete(key);
    } catch (e) {
      console.warn('[SW] Sync failed for:', key);
    }
  }
}
