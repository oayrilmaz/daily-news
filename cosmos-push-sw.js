/* COSMOS push service worker v2.2.2 — resilient direct-to-moment routing. */
/* Stores ONLY an opaque notification ID for a short time after a notification tap.
   No private post content, contact details, or location data is cached. */
const COSMOS_PAGE='https://ptdtoday.com/cosmos-next.html';
const ID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DB_NAME='cosmos_pending_notification_v222';
const DB_TTL=20*60*1000;
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

function validNoticeId(value){const id=String(value||'');return ID_PATTERN.test(id)?id:'';}
function getTarget(id){return COSMOS_PAGE+'?v=222'+(id?'&notice='+encodeURIComponent(id):'&inbox=1');}
function openDb(){return new Promise((resolve,reject)=>{
  if(!self.indexedDB)return reject(new Error('IndexedDB unavailable'));
  const request=indexedDB.open(DB_NAME,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('pending'))request.result.createObjectStore('pending');};
  request.onerror=()=>reject(request.error||new Error('Database unavailable'));
  request.onsuccess=()=>resolve(request.result);
});}
async function dbGet(){
  const db=await openDb();
  try{return await new Promise((resolve,reject)=>{
    const t=db.transaction('pending','readonly');const q=t.objectStore('pending').get('latest');
    q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);
  });}finally{db.close();}
}
async function dbWrite(record){
  const db=await openDb();
  try{await new Promise((resolve,reject)=>{
    const t=db.transaction('pending','readwrite');t.objectStore('pending').put(record,'latest');
    t.oncomplete=resolve;t.onerror=()=>reject(t.error);
  });}finally{db.close();}
}
async function dbClear(id){
  const db=await openDb();
  try{await new Promise((resolve,reject)=>{
    const t=db.transaction('pending','readwrite');const store=t.objectStore('pending');const q=store.get('latest');
    q.onsuccess=()=>{const rec=q.result;if(!id||rec?.id===id)store.delete('latest');};
    t.oncomplete=resolve;t.onerror=()=>reject(t.error);
  });}finally{db.close();}
}
self.addEventListener('message',event=>{
  const type=event.data?.type;
  if(type==='COSMOS_GET_PENDING'){
    const job=(async()=>{
      let id='';try{const rec=await dbGet();if(rec && Date.now()-rec.at<DB_TTL)id=validNoticeId(rec.id);else if(rec)await dbClear(rec.id);}catch{}
      event.ports?.[0]?.postMessage({notice_id:id});
    })();event.waitUntil(job);
  }else if(type==='COSMOS_ACK_NOTIFICATION'){
    const id=validNoticeId(event.data?.notice_id);
    if(id)event.waitUntil(dbClear(id).catch(()=>{}));
  }
});
self.addEventListener('push',event=>{
  let payload={title:'COSMOS',body:'A moment is waiting for you.'};
  try{if(event.data)payload={...payload,...event.data.json()};}catch{}
  const noticeId=validNoticeId(payload.notice_id);
  const href=getTarget(noticeId);
  event.waitUntil(self.registration.showNotification(String(payload.title||'COSMOS').slice(0,80),{
    body:String(payload.body||'Open Cosmos to discover your moment.').slice(0,160),
    tag:'cosmos-'+(noticeId||String(Date.now())),renotify:false,
    icon:'/cosmos-app-icon-192.png',badge:'/cosmos-app-icon-192.png',
    data:{href,notice_id:noticeId}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const data=event.notification.data||{};
  let id=validNoticeId(data.notice_id);
  if(!id){try{id=validNoticeId(new URL(data.href).searchParams.get('notice'));}catch{}}
  const href=getTarget(id);
  event.waitUntil((async()=>{
    // iOS standalone apps sometimes reopen at their start_url instead of notification URL.
    // Storing this short-lived ID lets the already-installed app recover its destination.
    if(id)try{await dbWrite({id,at:Date.now()});}catch{}
    const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
    const opened=windows.find(c=>c.url && c.url.startsWith(COSMOS_PAGE));
    if(opened){
      try{
        const focused=await opened.focus();
        focused.postMessage({type:'COSMOS_OPEN_NOTIFICATION',notice_id:id});
        // Also navigate for older open tabs that do not yet listen for messages.
        const navigated=await focused.navigate(href);
        if(navigated && id)navigated.postMessage({type:'COSMOS_OPEN_NOTIFICATION',notice_id:id});
        return;
      }catch{
        // If navigation is unavailable, focus/message and the pending ID still work.
        try{opened.postMessage({type:'COSMOS_OPEN_NOTIFICATION',notice_id:id});await opened.focus();return;}catch{}
      }
    }
    await clients.openWindow(href);
  })());
});
