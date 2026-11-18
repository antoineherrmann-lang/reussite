/* Réussite — service worker
   Stratégie : réseau d'abord (on voit toujours la dernière version), cache en repli (hors ligne).
   Les requêtes de vérification de mise à jour (?_=…) ne sont jamais mises en cache.
   À CHAQUE NOUVELLE VERSION : changer VERSION ici ET APP_VERSION dans index.html. */
const VERSION = '1.1.0';
const CACHE = 'reussite-' + VERSION;
const FONTS = 'reussite-fonts';
const IMG = 'reussite-img';      // photos de Découvrir (Wikimedia), gardées d'une version à l'autre
const IMG_MAX = 320;
const PRECACHE = ['./', 'index.html', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png',
  'icon-maskable-512.png', 'glass-kit.js', 'glass-kit-loader.js', 'config.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(PRECACHE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => (k.indexOf('reussite-') === 0 && k !== CACHE && k !== FONTS && k !== IMG) || k.indexOf('revision-') === 0).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

/* ---------- rappels : notification reçue du Worker Cloudflare ---------- */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { try { d = { body: e.data.text() }; } catch (err2) {} }
  e.waitUntil(self.registration.showNotification(d.title || 'Réussite', {
    body: d.body || 'Ta séance du jour t’attend.', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag || 'reussite-rappel', data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* polices Google : cache d'abord, rafraîchi en arrière-plan */
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  /* photos de Découvrir : cache d'abord (elles ne changent pas), avec un plafond */
  if (url.hostname === 'upload.wikimedia.org') {
    e.respondWith(caches.open(IMG).then(async c => {
      const hit = await c.match(req.url);
      if (hit) return hit;
      const r = await fetch(req);
      if (r && r.ok) {
        c.put(req.url, r.clone());
        c.keys().then(keys => { for (let i = 0; i < keys.length - IMG_MAX; i++) c.delete(keys[i]); });
      }
      return r;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  /* vérification de mise à jour : toujours le réseau, jamais le cache */
  if (url.searchParams.has('_')) { e.respondWith(fetch(req, { cache: 'no-store' })); return; }

  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(r => {
      if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
