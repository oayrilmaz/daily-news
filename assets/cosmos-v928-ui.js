/* COSMOS v9.2.8 — conservative, additive interface integration.
   Preserves the original COSMOS IIFE and its authenticated business/private timeline.
   Marketplace and profile media calls use the existing Life Worker login token.
*/
(()=>{'use strict';
  const API='https://ptdtoday-cosmos-life.ptdtoday.workers.dev';
  const TOKEN='cosmos_life_token_v1',ORIGINS='/cosmos-original-home.html';
  const $=id=>document.getElementById(id);
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const market=u=>'/cosmos-market-'+(u==='business'?'business':'personal')+'.html';
  let myProfileId='',publicItems=null,publicPromise=null,currentCountry='all',currentCategory='all';
  let scanQueued=false,jobLastAttempt=new Set(),busy=false,loadedMedia=new Map();
  function token(){return localStorage.getItem(TOKEN)||'';}
  async function jsonCall(path,options={}){
    const headers=new Headers(options.headers||{});if(!token())throw new Error('Sign in to COSMOS first.');headers.set('Authorization','Bearer '+token());
    if(options.body&&!(options.body instanceof FormData)&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
    const r=await fetch(API+path,{...options,headers,cache:'no-store'});
    const result=await r.json().catch(()=>({error:'Unexpected response'}));
    if(!r.ok)throw new Error(result.error||'COSMOS request failed: '+r.status);return result;
  }
  async function objectMedia(path){
    if(!token())return null;
    const r=await fetch(API+path,{headers:{Authorization:'Bearer '+token()},cache:'no-store'});
    if(!r.ok)return null;return URL.createObjectURL(await r.blob());
  }
  async function userId(){if(!myProfileId){const r=await jsonCall('/api/me');myProfileId=r.id;}return myProfileId;}
  function originsOrb(){
    if(!document.querySelector('.topbar .cosmos-v928-origins')){
      const brand=document.querySelector('.topbar .brand')?.parentElement;
      if(brand){brand.classList.add('cosmos-v928-brandrow');const a=document.createElement('a');a.className='cosmos-v928-origins';a.href=ORIGINS;a.title='Open the original COSMOS circle';a.setAttribute('aria-label','Open original COSMOS circle');a.innerHTML='<span aria-hidden="true"></span>';brand.insertBefore(a,brand.firstChild);}
    }
    const header=$('businessHeaderUniverse');
    if(header&&!header.parentElement.querySelector('.cosmos-v928-workorigins')){
      const a=document.createElement('a');a.className='cosmos-v928-workorigins';a.href=ORIGINS;a.title='Open the original COSMOS circle';a.setAttribute('aria-label','Open original COSMOS circle');a.textContent='◯';header.insertAdjacentElement('afterend',a);
    }
  }
  function marketButtons(){
    const filters=document.querySelector('#app.metro-live .journey-stage .week-metro .metro-filters');
    if(filters&&!filters.querySelector('.cosmos-v928-market-link')){
      const a=document.createElement('a');a.className='cosmos-v928-market-link';a.href=market('personal');a.textContent='Marketplace';a.title='Open Personal Marketplace';filters.appendChild(a);
    }
    const business=document.querySelector('#sheet.business-modal .shared-metro-engine .metro-filters');
    if(business&&!business.querySelector('.cosmos-v928-market-link')){
      const a=document.createElement('a');a.className='cosmos-v928-market-link';a.href=market('business');a.textContent='Marketplace';a.title='Open Business Marketplace';business.appendChild(a);
    }
    document.querySelectorAll('#businessHeaderMenu [data-business-nav="feed"],#sheet.business-modal [data-business-tab="feed"]').forEach(n=>n.remove());
    const menu=$('businessHeaderMenu');
    if(menu&&!menu.querySelector('.cosmos-v928-market-link')){
      const a=document.createElement('a');a.className='cosmos-v928-market-link';a.href=market('business');a.textContent='Business Marketplace';menu.appendChild(a);
    }
    const more=$('cosmosMetroMoreListV923');
    if(more){
      for(const button of more.querySelectorAll('[data-cosmos-menu-action="origins"],[data-cosmos-menu-action="feed"]'))button.remove();
      const mode=$('cosmosMetroMoreTitleV923')?.textContent?.includes('Business')?'business':'personal';
      let a=more.querySelector('.cosmos-v928-market-link');if(!a){a=document.createElement('a');a.className='cosmos-menu-entry cosmos-v928-market-link';more.appendChild(a);}
      const destination=market(mode),label=(mode==='business'?'Business':'Personal')+' Marketplace';
      if(a.getAttribute('href')!==destination)a.setAttribute('href',destination);
      if(a.textContent!==label)a.textContent=label;
    }
  }
  function recentWorkButton(){
    const shell=document.querySelector('#sheet.business-modal .shared-metro-engine');
    if(!shell)return;const filters=shell.querySelector('.metro-filters');if(!filters||filters.querySelector('#cosmosV928RecentWork'))return;
    const b=document.createElement('button');b.id='cosmosV928RecentWork';b.type='button';b.textContent='Recent work';b.title='Find past work posts and navigate to their dates';filters.appendChild(b);
    b.onclick=async()=>{
      b.disabled=true;b.textContent='Checking…';
      try{const r=await jsonCall('/api/business/feed?filter=connections');const posts=(r.posts||[]).sort((a,c)=>Date.parse(c.created_at)-Date.parse(a.created_at));
        if(!posts.length){b.textContent='No work posts';return;}
        const latest=posts[0];const d=new Date(latest.created_at);if(!Number.isFinite(d.getTime()))return;
        const localDate=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
        const picker=$('businessMetroDate');if(picker){picker.value=localDate;picker.dispatchEvent(new Event('change',{bubbles:true}));}
        else b.textContent='Found '+posts.length+' posts';
      }catch(e){b.textContent=e.message.slice(0,42);}finally{setTimeout(()=>{if(b.isConnected){b.disabled=false;b.textContent='Recent work';}},4000);}
    };
  }
  async function fetchPublicItems(){
    if(publicItems)return publicItems;
    if(publicPromise)return publicPromise;
    publicPromise=fetch('/data/cosmos-public-timeline.json',{cache:'no-store',credentials:'omit'})
      .then(r=>r.ok?r.json():null).then(r=>{
        if(!r||r.public_only!==true||!Array.isArray(r.items))return [];
        return publicItems=r.items.filter(x=>x&&x.visibility==='public'&&x.type==='cosmos_editorial_question');
      }).catch(()=>[]).finally(()=>{publicPromise=null;});return publicPromise;
  }
  const unique=arr=>[...new Set(arr)].filter(Boolean).sort();
  function countryCodes(r){return Array.isArray(r.regions)?r.regions.map(String).filter(Boolean):[];}
  function renderPublicCompact(){
    const stack=document.querySelector('#app.metro-live .cosmos-public-stack');if(!stack||stack.dataset.v928==='yes')return;
    stack.dataset.v928='yes';stack.classList.add('cosmos-v928-compact-stack');
    const cards=[...stack.querySelectorAll('.cosmos-public-card')];
    if(!cards.length)return;
    for(const card of cards){
      const title=card.querySelector('h3'),anchor=card.querySelector('.cosmos-public-links a');
      if(!title||!anchor)continue;
      const item=publicItems?.find(x=>x.question===title.textContent.trim());
      card.dataset.v928Category=String(item?.category||card.querySelector('.cosmos-public-eyebrow')?.textContent?.split('·')[1]?.trim()||'Other');
      card.dataset.v928Countries=countryCodes(item||{}).join(',');
      anchor.classList.add('cosmos-v928-read');anchor.textContent='Open ↗';
      card.classList.add('cosmos-v928-row');
      // The original source links and article pages remain unchanged and accessible.
    }
    const dataCategories=unique(cards.map(c=>c.dataset.v928Category));
    const tagged=unique(cards.flatMap(c=>(c.dataset.v928Countries||'').split(',').filter(Boolean)));
    const bar=document.createElement('div');bar.className='cosmos-v928-topic-bar';
    bar.innerHTML=`<div class="cosmos-v928-topic-heading"><strong>Global questions</strong><small>Verified articles · ${cards.length} on this date · not a worldwide search ranking</small></div>
      <label>Category <select id="cosmosV928TopicCat"><option value="all">All categories</option>${dataCategories.map(c=>`<option value="${escape(c)}">${escape(c)}</option>`).join('')}</select></label>
      <label>Source region <select id="cosmosV928TopicRegion"><option value="all">All tagged regions</option>${tagged.map(c=>`<option value="${escape(c)}">${escape(c)}</option>`).join('')}</select></label>
      <button type="button" id="cosmosV928AllQuestions">All dates</button>`;
    stack.parentElement.insertBefore(bar,stack);
    bar.querySelector('#cosmosV928TopicCat').value=dataCategories.includes(currentCategory)?currentCategory:'all';
    bar.querySelector('#cosmosV928TopicRegion').value=tagged.includes(currentCountry)?currentCountry:'all';
    bar.querySelector('#cosmosV928TopicCat').onchange=e=>{currentCategory=e.target.value;applyPublicFilters(stack,bar);};
    bar.querySelector('#cosmosV928TopicRegion').onchange=e=>{currentCountry=e.target.value;applyPublicFilters(stack,bar);};
    bar.querySelector('#cosmosV928AllQuestions').onclick=showPublicArchive;
    if(!tagged.length){bar.querySelector('#cosmosV928TopicRegion').disabled=true;bar.querySelector('#cosmosV928TopicRegion').title='The public feed does not include source-region tags for these questions.';}
    applyPublicFilters(stack,bar);
  }
  function applyPublicFilters(stack,bar){
    let shown=0;for(const c of stack.querySelectorAll('.cosmos-v928-row')){
      const ok=(currentCategory==='all'||c.dataset.v928Category===currentCategory)&&
        (currentCountry==='all'||(c.dataset.v928Countries||'').split(',').includes(currentCountry));
      c.hidden=!ok;if(ok)shown++;
    }
    let empty=bar.querySelector('.cosmos-v928-topic-empty');
    if(!empty){empty=document.createElement('p');empty.className='cosmos-v928-topic-empty';bar.appendChild(empty);}
    empty.textContent=shown?`${shown} verified question${shown!==1?'s':''}`:'No verified questions match this selection on the selected day.';
  }
  async function showPublicArchive(){
    const items=(await fetchPublicItems()).slice().sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)).slice(0,300);
    let overlay=$('cosmosV928PublicArchive');
    if(!overlay){overlay=document.createElement('div');overlay.id='cosmosV928PublicArchive';overlay.className='cosmos-v928-archive-overlay';document.body.appendChild(overlay);}
    const categories=unique(items.map(x=>x.category||'Other')),regions=unique(items.flatMap(countryCodes));
    overlay.innerHTML=`<section class="cosmos-v928-archive-panel" role="dialog" aria-modal="true" aria-label="Global questions archive">
      <div class="cosmos-v928-archive-header"><div><h2>Global questions</h2><p>Published, source-linked questions across all dates.</p></div><button type="button" id="cosmosV928CloseArchive">Close ✕</button></div>
      <div class="cosmos-v928-archive-filters"><label>Category <select id="cosmosV928ArchiveCategory"><option value="all">All categories</option>${categories.map(x=>`<option>${escape(x)}</option>`).join('')}</select></label>
      <label>Source region <select id="cosmosV928ArchiveRegion"><option value="all">All tagged regions</option>${regions.map(x=>`<option>${escape(x)}</option>`).join('')}</select></label></div>
      <div id="cosmosV928ArchiveList"></div><p class="cosmos-v928-disclaimer">Source-region tags indicate where a trend was observed when available; they do not establish global search rank. Always check original reporting for the latest details.</p></section>`;
    function showList(){const c=$('cosmosV928ArchiveCategory').value,r=$('cosmosV928ArchiveRegion').value;
      const matches=items.filter(x=>(c==='all'||(x.category||'Other')===c)&&(r==='all'||countryCodes(x).includes(r)));
      $('cosmosV928ArchiveList').innerHTML=matches.length?matches.map(x=>{
        const url=String(x.url||''),valid=/^https:\/\/ptdtoday\.com\/q\/trends\/global-[a-z0-9-]+\.html$/.test(url)||/^\/q\/trends\/global-[a-z0-9-]+\.html$/.test(url);
        if(!valid)return '';return `<a class="cosmos-v928-archive-item" href="${escape(url)}"><span><small>${escape(x.category||'Other')} · ${escape(new Date(x.published_at).toLocaleDateString())}</small><strong>${escape(x.question)}</strong></span><b>↗</b></a>`;
      }).join(''):'<p>No published questions match those filters.</p>';
    }
    $('cosmosV928ArchiveCategory').onchange=showList;$('cosmosV928ArchiveRegion').onchange=showList;
    $('cosmosV928CloseArchive').onclick=()=>overlay.remove();overlay.onclick=e=>{if(e.target===overlay)overlay.remove();};showList();
  }
  async function compressPhoto(file,maxEdge){
    if(!file||!file.type.startsWith('image/'))throw new Error('Choose a JPG, PNG or WebP photo.');
    if(file.size>15*1024*1024)throw new Error('Photo too large (15 MB input limit).');
    const img=await createImageBitmap(file);const factor=Math.min(1,maxEdge/Math.max(img.width,img.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*factor));canvas.height=Math.max(1,Math.round(img.height*factor));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);img.close?.();
    const result=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.83));if(!result)throw new Error('Photo conversion failed.');
    return new File([result],'cosmos-photo.jpg',{type:'image/jpeg'});
  }
  async function loadProfileMedia(u,root){
    for(const kind of ['avatar','cover']){
      const box=root.querySelector('[data-cosmos-profile-preview="'+kind+'"]');if(!box)continue;
      const url=await objectMedia('/api/identity-media/'+u+'/'+kind);
      if(box.isConnected&&url){const old=loadedMedia.get(u+kind);if(old)URL.revokeObjectURL(old);loadedMedia.set(u+kind,url);
        box.innerHTML='<img src="'+url+'" alt="Your '+kind+'">';}
    }
    if(u==='personal')applyHeaderPhoto();else applyBusinessHeaderPhoto();
  }
  function applyBusinessHeaderPhoto(){
    const url=loadedMedia.get('businessavatar'),b=$('businessHeaderProfile');if(!b||!url)return;
    b.style.backgroundImage='url("'+url+'")';b.style.backgroundSize='cover';b.style.backgroundPosition='center';b.style.color='transparent';b.title='My Business profile';
  }
  function applyHeaderPhoto(){const url=loadedMedia.get('personalavatar'),b=$('accountButton');if(!b||!url)return;
    b.style.backgroundImage='url("'+url+'")';b.style.backgroundSize='cover';b.style.backgroundPosition='center';b.style.color='transparent';b.title='My Personal profile';
  }
  function profileEditor(universe){
    const section=document.createElement('section');section.className='cosmos-v928-profile-media';section.dataset.cosmosProfileMedia=universe;
    section.innerHTML=`<h3>${universe==='business'?'Business':'Personal'} profile photos</h3><p>Separate ${universe} avatar and background. Photos follow the same profile visibility rules as your existing COSMOS settings.</p>
      <div class="cosmos-v928-photo-pair"><div><label>Profile photo</label><div class="cosmos-v928-photo-box avatar" data-cosmos-profile-preview="avatar">◯</div>
      <input type="file" accept="image/jpeg,image/png,image/webp" data-cosmos-photo-input="avatar" aria-label="Upload ${universe} profile photo"></div>
      <div><label>Background / cover photo</label><div class="cosmos-v928-photo-box cover" data-cosmos-profile-preview="cover">No cover photo</div>
      <input type="file" accept="image/jpeg,image/png,image/webp" data-cosmos-photo-input="cover" aria-label="Upload ${universe} background photo"></div></div>
      <p class="cosmos-v928-photo-status" aria-live="polite">Images are optimized locally to remove photo metadata before upload.</p>`;
    section.querySelectorAll('[data-cosmos-photo-input]').forEach(input=>input.onchange=async()=>{
      const f=input.files?.[0];if(!f)return;
      const kind=input.dataset.cosmosPhotoInput,status=section.querySelector('.cosmos-v928-photo-status');
      input.disabled=true;status.textContent='Optimizing and saving photo…';
      try{const file=await compressPhoto(f,kind==='avatar'?700:1600),form=new FormData();form.set('file',file);
        await jsonCall('/api/identity-media/'+universe+'/'+kind,{method:'POST',body:form});status.textContent='Photo saved securely in COSMOS.';await loadProfileMedia(universe,section);
      }catch(e){status.textContent='Photo not saved: '+e.message;}finally{input.disabled=false;input.value='';}
    });
    loadProfileMedia(universe,section).catch(()=>{});return section;
  }
  function attachProfileEditors(){
    const sheet=$('sheet');if(!sheet||sheet.hidden)return;
    if(sheet.classList.contains('business-modal')&&sheet.dataset.businessTab==='profile'){
      const body=$('businessBody');if(body&&!body.querySelector('[data-cosmos-profile-media]')){
        const editor=profileEditor('business');body.insertBefore(editor,body.firstChild);
      }
    }else if(!sheet.classList.contains('business-modal')&&$('profileUsername')&&!sheet.querySelector('[data-cosmos-profile-media]')){
      const editor=profileEditor('personal'),target=$('displayName')?.closest('.field');
      if(target)target.parentElement.insertBefore(editor,target);
    }
  }
  function autoJobs(){
    const sheet=$('sheet');if(!sheet||sheet.hidden||sheet.dataset.businessTab!=='jobs')return;
    const b=$('jobsRefreshMatches'),selected=$('businessJobResume'),loc=$('jobsTargetLocation');
    if(!b||!selected||!selected.value||!$('jobsMatches')||b.dataset.cosmosV928Autoload)return;
    const key=selected.value+'|'+($('jobsTargetRole')?.value||'')+'|'+(loc?.value||'');
    if(jobLastAttempt.has(key))return;jobLastAttempt.add(key);b.dataset.cosmosV928Autoload='pending';
    // Trigger the existing backend's internal-first + external provider logic.
    setTimeout(()=>{if(b.isConnected&&!b.disabled){b.dataset.cosmosV928Autoload='done';b.click();}},500);
  }
  function schedule(){if(scanQueued)return;scanQueued=true;setTimeout(()=>{scanQueued=false;scan();},60);}
  function scan(){if(busy)return;busy=true;try{originsOrb();marketButtons();recentWorkButton();renderPublicCompact();attachProfileEditors();autoJobs();applyHeaderPhoto();applyBusinessHeaderPhoto();}finally{busy=false;}}
  const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true});
  fetchPublicItems().then(schedule).catch(()=>{});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')$('cosmosV928PublicArchive')?.remove();});
  window.addEventListener('pagehide',()=>{for(const url of loadedMedia.values())URL.revokeObjectURL(url);});
  scan();
})();
