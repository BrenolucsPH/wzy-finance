const CACHE='wzy-shell-v3';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/','/wzy-horse.png','/favicon.svg'])).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/')||url.searchParams.has('reset'))return;
  if(request.mode==='navigate'){event.respondWith(fetch(request).then(response=>{if(response.ok&&!response.redirected&&url.pathname==='/'){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put('/',copy))}return response}).catch(()=>caches.match('/')));return;}
  if(url.pathname.startsWith('/_next/static/')||['/wzy-horse.png','/favicon.svg'].includes(url.pathname))event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok&&!response.redirected){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy))}return response})));
});
self.addEventListener('push',event=>{event.waitUntil(self.registration.showNotification('WZY',{body:'Você tem compromissos nos próximos dias. Abra o WZY para conferir.',icon:'/wzy-horse.png',badge:'/wzy-horse.png',tag:'wzy-upcoming'}))});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{const client=clients.find(c=>new URL(c.url).origin===location.origin);return client?client.focus():self.clients.openWindow('/')}))});
