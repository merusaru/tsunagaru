// ═══════════════════════════════════════════════
// つながる — Service Worker v3
// 2026年最新PWA実装 (GitHub Pages サブパス対応)
// Cache-first for static, Network-first for API
// ═══════════════════════════════════════════════

const CACHE_NAME = 'tsunagaru-v3';
// GitHub Pages サブパス対応: SW のスコープからベースパスを算出
const BASE = new URL('./', self.registration.scope).pathname;
const OFFLINE_URL = BASE + 'offline.html';

// インストール時にキャッシュするリソース（すべて相対で解決）
const PRECACHE = [
  BASE,
  BASE + 'index.html',
  BASE + 'snsmap.html',
  BASE + 'manifest.json',
  BASE + 'offline.html',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Inter:wght@400;500;600&display=swap'
];

// ── INSTALL ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // 外部フォントは no-cors、それ以外は同一オリジン扱い。1つずつ登録して失敗を握り潰す
        return Promise.all(PRECACHE.map(url => {
          const req = url.startsWith('https://fonts')
            ? new Request(url, { mode: 'no-cors' })
            : new Request(url);
          return fetch(req)
            .then(res => (res && (res.ok || res.type === 'opaque')) ? cache.put(req, res.clone()) : null)
            .catch(err => console.warn('[SW] precache miss:', url, err));
        }));
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
    url.hostname.includes('firebase.com') ||
    request.method !== 'GET'
  ) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // HTMLページ：Stale-While-Revalidate
  if (request.destination === 'document' || request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);
        const networkPromise = fetch(request).then(response => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        }).catch(() => null);

        // 即座にキャッシュ返し、裏で更新
        return cached || (await networkPromise) || caches.match(OFFLINE_URL);
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
      }).catch(() => {
        // 画像リクエスト失敗時はプレースホルダーで代替
        if (request.destination === 'image') {
          return new Response('', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } });
        }
        return caches.match(OFFLINE_URL);
      });
    })
  );
});

// ── PUSH NOTIFICATIONS ────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch (e) { data = { body: event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'つながる', {
      body: data.body || '✦ あなたの星座が広がりました',
      icon: BASE + 'icon-192.png',
      badge: BASE + 'icon-72.png',
      tag: 'tsunagaru-notif',
      data: { url: data.url || BASE },
      vibrate: [100, 50, 100],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // 既に開いてるタブがあればフォーカス
      const url = event.notification.data && event.notification.data.url || BASE;
      for (const client of list) {
        if (client.url.includes(BASE) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
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
  try {
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
  } catch (e) {
    console.warn('[SW] Sync error:', e);
  }
}

// ── MESSAGE (skipWaiting トリガー) ─────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
