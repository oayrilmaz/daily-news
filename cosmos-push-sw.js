/* COSMOS push service worker v2.2: no caching, no location tracking, no message content. */
self.addEventListener('push', event=>{
  let payload={title:'COSMOS',body:'A moment is waiting for you.'};
  try{if(event.data)payload={...payload,...event.data.json()};}catch{}
  const title=String(payload.title||'COSMOS').slice(0,80);
  const body=String(payload.body||'Open Cosmos to discover your moment.').slice(0,160);
  const href='https://ptdtoday.com/cosmos-next.html?v=22&inbox=1';
  event.waitUntil(self.registration.showNotification(title,{
    body,tag:'cosmos-'+String(payload.notice_id||Date.now()),renotify:false,
    icon:'/cosmos-app-icon-192.png',badge:'/cosmos-app-icon-192.png',
    data:{href}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const href=event.notification.data?.href||'https://ptdtoday.com/cosmos-next.html?v=22&inbox=1';
  event.waitUntil((async()=>{
    const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      if(client.url?.startsWith('https://ptdtoday.com/cosmos-next.html')){
        await client.navigate(href);return client.focus();
      }
    }
    return clients.openWindow(href);
  })());
});
