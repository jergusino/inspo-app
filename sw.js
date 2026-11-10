importScripts('db.js');
const CACHE = 'igsaver-v1';
const SHELL = ['./', 'index.html', 'db.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  // Android share sheet -> this endpoint
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      let status = null;
      try {
        const f = await req.formData();
        const text = [f.get('url'), f.get('text'), f.get('title')].filter(Boolean).join(' ');
        const file = f.get('media');
        status = await saveLink(text, file && file.size ? file : null);
      } catch (err) { status = null; }
      const q = status === 'saved' ? 'saved' : status === 'dup' ? 'dup' : 'nolink';
      return Response.redirect(new URL('./?' + q, self.registration.scope).href, 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(c => c || fetch(req)));
});
