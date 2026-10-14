/* COSMOS push service worker v2.2.1 — open the exact permitted moment. */
/* No caching, tracking, message content or contact info in the notification. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
const COSMOS_PAGE='https://ptdtoday.com/cosmos-next.html';
function targetFromNotice(data){
  // The random notification ID is not an authorization token. The signed-in app
  // checks recipient ownership on the server before opening any Cosmos.
  const id=String(data?.notice_id||'');
  const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  return COSMOS_PAGE+'?v=221'+(valid?'&notice='+encodeURIComponent(id):'&inbox=1');
}
self.addEventListener('push',event=>{
  let payload={title:'COSMOS',body:'A moment is waiting for you.'};
  try{if(event.data)payload={...payload,...event.data.json()};}catch{}
  const title=String(payload.title||'COSMOS').slice(0,80);
  const body=String(payload.body||'Open Cosmos to discover your moment.').slice(0,160);
  const href=targetFromNotice(payload);
  event.waitUntil(self.registration.showNotification(title,{
    body,tag:'cosmos-'+String(payload.notice_id||Date.now()),renotify:false,
    icon:'/cosmos-app-icon-192.png',badge:'/cosmos-app-icon-192.png',
    data:{href}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const href=event.notification.data?.href||COSMOS_PAGE+'?v=221&inbox=1';
  event.waitUntil((async()=>{
    const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      if(client.url?.startsWith(COSMOS_PAGE)){
        try{await client.navigate(href);return await client.focus();}catch{}
      }
    }
    return clients.openWindow(href);
  })());
});
