importScripts('db.js');
const CACHE = 'igsaver-v2';
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

  // Android share sheet -> this endpoint (link and optional PNG/MP4 file)
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      let status = 'nolink';
      try {
        const f = await req.formData();
        const text = [f.get('url'), f.get('text'), f.get('title')].filter(Boolean).join(' ');
        const r = await saveLink(text, f.get('media'));
        status = r ? r.status : 'nolink';
      } catch (err) { status = 'nolink'; }
      return Response.redirect(new URL('./?' + status, self.registration.scope).href, 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(c => c || fetch(req)));
});
