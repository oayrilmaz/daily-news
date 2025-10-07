const CACHE = 'ptd-v1';
const ASSETS = [
  '/', '/index.html',
  '/assets/main.css', '/assets/app.js',
  '/icons/favicon.svg'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e=>{
  const {request} = e;
  if(request.method!=='GET') return;
  e.respondWith(
    caches.match(request).then(hit=> hit || fetch(request).then(res=>{
      const copy = res.clone();
      caches.open(CACHE).then(c=>c.put(request, copy)).catch(()=>{});
      return res;
    }).catch(()=> hit || new Response('',{status:504})))
  );
});