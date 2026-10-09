// No private API, HTML, passage, result, or annotation response is cached.
const CACHE = 'cet6-static-v1';
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !/^\/assets\/[^/]+\.(js|css|woff2)$/.test(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && !response.redirected && response.headers.get('content-type')?.match(/javascript|text\/css|font\//)) {
      const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) || Response.error()));
});
