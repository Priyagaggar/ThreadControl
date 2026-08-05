self.addEventListener('install', e => {
  self.skipWaiting(); // activate new SW immediately
});
self.addEventListener('activate', e => {
  // Delete ALL old caches on activate
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});
self.addEventListener('fetch', e => {
  // Network first for HTML (ensures latest version always loads)
  if(e.request.mode === 'navigate'){
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
  // Cache first for other assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      return cached || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open('tc-assets').then(c => c.put(e.request, clone));
        return res;
      });
    })
  );
});
