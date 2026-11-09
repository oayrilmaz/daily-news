#!/usr/bin/env python3
"""Reproducibly patch the exact uploaded 2026-11-09 COSMOS HTML. Fail closed on drift."""
from pathlib import Path
import difflib,hashlib,re
ROOT=Path('/tmp')
SRC=Path('cosmos-next.html')
s=SRC.read_text(encoding='utf-8')
initial=s
EXPECTED_BASE='a238e8823b1947ed8b88e533ccd9575bd243bbf03fe16daf81a2002082d4907c'
EXPECTED_OUTPUT='df7e8ab3b0990c802f6c01fa41979422ed86d5f83cab62d77837af805419229e'
import sys
mode=sys.argv[1] if len(sys.argv)>1 else 'validate'
if mode not in ('validate','apply'):raise SystemExit('Use validate or apply')
if hashlib.sha256(s.encode()).hexdigest()==EXPECTED_OUTPUT:
 Path('/tmp/cosmos_v929_preview.html').write_text(s,encoding='utf-8')
 print('COSMOS v9.2.9 already installed. No changes needed.');sys.exit(0)
if hashlib.sha256(s.encode()).hexdigest()!=EXPECTED_BASE:
 raise SystemExit('STOP: GitHub cosmos-next.html does not match the uploaded baseline. Do not apply this patch or revert newer changes.')
assert len(s)>380000 and 'cosmos-next-v3.6a9-camera-opt-in' in s, 'Refuse unexpected source'
def replace_once(old,new,explain):
 global s
 n=s.count(old)
 if n!=1:raise RuntimeError(f'{explain}: expected 1 match, found {n}')
 s=s.replace(old,new,1)
def inject_before(marker,content,explain):
 replace_once(marker,content+'\n'+marker,explain)
# Avoid dependency on older dynamically injected v928 assets; keep files already in GitHub untouched.
replace_once('<link rel="stylesheet" href="/assets/cosmos-v928-ui.css" data-cosmos-patch="v928">','', 'remove outdated external CSS')
replace_once('<script src="/assets/cosmos-v928-ui.js" defer data-cosmos-patch="v928"></script>','', 'remove outdated external JS')
replace_once('content="cosmos-next-v3.6a9-camera-opt-in"','content="cosmos-next-v9.2.9-source-corrected"','version marker')
# Brand links: the existing application already uses the Origins route; don't invent a new URL.
replace_once('<div><div class="brand">COSMOS<span class="tagline">Look deeper.</span></div></div>',
 '''<div class="cosmos929-brand"><a class="cosmos929-origin-orb" href="/cosmos-original-home.html" aria-label="Open original COSMOS Origins" title="Original COSMOS"><span aria-hidden="true"></span></a><div class="brand">COSMOS<span class="tagline">Look deeper.</span></div></div>''', 'header Origins circle')
# Remove duplicate Work Feed navigation rather than pretending to integrate posts.
replace_once("const labels={metro:'Business Metro',feed:'Work feed',people:'Business Connections'", "const labels={metro:'Business Metro',feed:'Business Metro',people:'Business Connections'",'nav heading')
assert s.count("['feed','Work feed'],['people','Connections']")==2, 'Expected both Business navigation entries'
s=s.replace("['feed','Work feed'],['people','Connections']", "['people','Connections']")
replace_once("  async function openBusinessHub(tab='metro',cursor='',append=false){\n    const selected=", "  async function openBusinessHub(tab='metro',cursor='',append=false){\n    if(tab==='feed')tab='metro'; // v9.2.9: one authoritative dated Business Metro.\n    const selected=", 'redirect old feed links')
replace_once("    feed:()=>openBusinessHub('feed'),", "    feed:()=>openBusinessHub('metro'),",'redirect old More shortcut')
# Reinforce standalone Marketplace links in visible Business navigation.
replace_once('''      <button type="button" id="businessMenuPrivate" role="menuitem">Switch to Private</button></div></div></div>`;''',
 '''      <a role="menuitem" class="cosmos929-market-menu" href="/cosmos-market-business.html">Business Marketplace</a>
      <button type="button" id="businessMenuPrivate" role="menuitem">Switch to Private</button></div></div></div>`;''','business marketplace menu')
replace_once('''        <div class="metro-filters" role="group" aria-label="Business timeline filters">
          ${[['connections','All'],['mine','My'],['others','Connections']].map(([k,v])=>`<button type="button" data-business-metro-filter="${k}" class="${businessFilter===k?'active':''}" aria-pressed="${businessFilter===k}">${v}</button>`).join('')}</div>''',
 '''        <div class="metro-filters" role="group" aria-label="Business timeline filters">
          ${[['connections','All'],['mine','My'],['others','Connections']].map(([k,v])=>`<button type="button" data-business-metro-filter="${k}" class="${businessFilter===k?'active':''}" aria-pressed="${businessFilter===k}">${v}</button>`).join('')}
          <button type="button" id="businessMetroRecent" class="cosmos929-extra-btn">Recent work</button>
          <a class="cosmos929-market-link" href="/cosmos-market-business.html">Marketplace</a></div>''', 'native Business shortcuts')
replace_once("    $('businessMetroJobs').onclick=()=>openBusinessJobs('browse');", "    $('businessMetroJobs').onclick=()=>openBusinessJobs('browse');\n    $('businessMetroRecent').onclick=cosmos929ShowRecentWork;",'Business recent work hookup')
# Put a current-date Business archive into a native function using the internal authenticated api and cache.
recent='''
  /* v9.2.9 Recent work is a navigator into Business Metro, not a second feed.
     Authorizations stay within existing /api/business/feed and /api/business/metro routes. */
  async function cosmos929ShowRecentWork(){
    const overlay=document.createElement('div');overlay.className='cosmos929-overlay';overlay.id='cosmos929RecentWork';
    overlay.innerHTML='<section class="cosmos929-dialog" role="dialog" aria-modal="true" aria-label="Recent work moments"><div class="cosmos929-dialog-head"><h2>Recent work moments</h2><button type="button" data-close>Close ✕</button></div><p>Choose a post to return to its original date on your Business Metro.</p><div id="cosmos929RecentList" role="status">Loading authorized work moments…</div></section>';
    document.getElementById('cosmos929RecentWork')?.remove();document.body.appendChild(overlay);
    overlay.addEventListener('click',e=>{if(e.target===overlay||e.target.closest('[data-close]'))overlay.remove();});
    const list=overlay.querySelector('#cosmos929RecentList');
    try{
      const r=await api('/api/business/feed?filter='+encodeURIComponent(businessFilter==='mine'?'mine':'connections'));
      if(!overlay.isConnected)return;
      const posts=(r.posts||[]).filter(p=>businessFilter!=='others'||!p.can_delete).slice().sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,60);
      for(const p of posts)businessFeedCache.set(String(p.id),p);
      list.innerHTML=posts.length?posts.map(p=>`<button type="button" class="cosmos929-work-row" data-work-id="${escapeHtml(p.id)}"><span><strong>${escapeHtml(String(p.text||p.category||'Work moment').slice(0,160))}</strong><small>${escapeHtml(p.author_name||p.author_username||'Professional')} · ${escapeHtml(businessDate(p.created_at))}</small></span><span aria-hidden="true">›</span></button>`).join(''):'<p>No authorized work moments were returned. Try another week in the Metro.</p>';
      list.querySelectorAll('[data-work-id]').forEach(button=>button.onclick=async()=>{
        const post=posts.find(p=>String(p.id)===button.dataset.workId);if(!post)return;
        const date=new Date(post.created_at);if(!Number.isFinite(date.getTime()))return;
        overlay.remove();businessMetroFocus=businessMetroAtNoon(date);businessMetroDay=businessMetroAtNoon(date);
        await openBusinessHub('metro');openBusinessMetroMoment(post.id);
      });
      if(r.next_cursor){const note=document.createElement('p');note.className='cosmos929-footnote';note.textContent='Showing the newest available page. Earlier moments remain on their original Metro dates.';list.append(note);}
    }catch(e){if(overlay.isConnected)list.textContent='Unable to load your work moments: '+(e.message||'Unknown error');}
  }
'''
inject_before('  async function loadBusinessMetroWeek(more=false){',recent,'recent work function insertion')
# Add upload widgets using existing backend and existing IIFE api/token. No insecure public image endpoints.
profile='''
  /* v9.2.9: Separate owner-only Personal/Business profile photos.
     Cloudflare Worker rejects metadata-bearing image originals; browser re-encodes.
     Never expose a bearer token in image URLs or to the public editorial feed. */
  const cosmos929ImageUrls=new Map();
  async function cosmos929ReadPhoto(path){
    const headers={Authorization:'Bearer '+token};
    const response=await fetch(API+path,{headers,cache:'no-store'});
    if(response.status===404)return null;
    if(!response.ok)throw Error('Photo request returned '+response.status);
    const blob=await response.blob();return URL.createObjectURL(blob);
  }
  async function cosmos929AvatarHeader(u){
    if(!token)return;
    try{
      const key=u+':avatar';let url=cosmos929ImageUrls.get(key);
      if(!url){url=await cosmos929ReadPhoto('/api/identity-media/'+u+'/avatar');if(!url)return;cosmos929ImageUrls.set(key,url);}
      const element=u==='business' ? $('businessHeaderProfile') : $('accountButton');
      if(element){element.style.backgroundImage='url("'+url+'")';element.style.backgroundSize='cover';element.style.backgroundPosition='center';element.style.color='transparent';}
    }catch(e){/* Avatars are optional: never block login or navigation. */}
  }
  async function cosmos929CanvasPhoto(file,edge){
    if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose a JPG, PNG or WebP image.');
    if(file.size>15*1024*1024)throw Error('Select an image smaller than 15 MB.');
    const bitmap=await createImageBitmap(file);
    const scale=Math.min(1,edge/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
    const output=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));
    if(!output)throw Error('Image conversion failed.');
    return new File([output],'cosmos-profile.jpg',{type:'image/jpeg'});
  }
  async function cosmos929ShowPhotos(u,section){
    for(const kind of ['avatar','cover']){
      const box=section.querySelector('[data-cosmos929-preview="'+kind+'"]');if(!box)continue;
      try{
        const url=await cosmos929ReadPhoto('/api/identity-media/'+u+'/'+kind);
        if(!section.isConnected){if(url)URL.revokeObjectURL(url);continue;}
        if(url){const key=u+':'+kind,old=cosmos929ImageUrls.get(key);if(old)URL.revokeObjectURL(old);
          cosmos929ImageUrls.set(key,url);const img=document.createElement('img');img.src=url;img.alt=u+' '+kind+' image';box.replaceChildren(img);
          if(kind==='avatar'){
            const header=u==='business'?$('businessHeaderProfile'):$('accountButton');
            if(header){header.style.backgroundImage='url("'+url+'")';header.style.backgroundSize='cover';header.style.backgroundPosition='center';header.style.color='transparent';}
          }
        }
      }catch(e){section.querySelector('.cosmos929-photo-status').textContent='Could not load saved photo: '+e.message;}
    }
  }
  function cosmos929MountPhotos(universe,container){
    if(!container||container.querySelector('[data-cosmos929-profile]'))return;
    const section=document.createElement('section');section.className='cosmos929-profile-media';section.dataset.cosmos929Profile=universe;
    section.innerHTML=`<h3>${universe==='business'?'Business':'Personal'} profile photos</h3><p>Upload a separate profile photo and cover image for this universe. Images are stripped of metadata before they reach Cloudflare.</p>
      <div class="cosmos929-photo-grid">${['avatar','cover'].map(kind=>`<div><label for="cosmos929-${universe}-${kind}">${kind==='avatar'?'Profile photo':'Cover / background photo'}</label><div class="cosmos929-photo-preview ${kind}" data-cosmos929-preview="${kind}">${kind==='avatar'?'◯':'No cover image'}</div><input id="cosmos929-${universe}-${kind}" type="file" accept="image/jpeg,image/png,image/webp" data-cosmos929-upload="${kind}"></div>`).join('')}</div><p class="cosmos929-photo-status" role="status" aria-live="polite">Only your Personal and Business image galleries are separate; your COSMOS login remains shared.</p>`;
    container.prepend(section);
    section.querySelectorAll('[data-cosmos929-upload]').forEach(input=>input.addEventListener('change',async()=>{
      const file=input.files?.[0];if(!file)return;const kind=input.dataset.cosmos929Upload;
      const status=section.querySelector('.cosmos929-photo-status');input.disabled=true;status.textContent='Processing photo…';
      try{const clean=await cosmos929CanvasPhoto(file,kind==='avatar'?700:1600);
        const form=new FormData();form.append('file',clean);
        await api('/api/identity-media/'+universe+'/'+kind,{method:'POST',body:form});
        status.textContent='Photo saved. This image belongs only to your '+universe+' profile.';
        await cosmos929ShowPhotos(universe,section);
      }catch(e){status.textContent='Photo not saved: '+(e.message||'Unknown error');}
      finally{input.disabled=false;input.value='';}
    }));
    void cosmos929ShowPhotos(universe,section);
  }
  window.addEventListener('pagehide',()=>{for(const u of cosmos929ImageUrls.values())URL.revokeObjectURL(u);cosmos929ImageUrls.clear();});
'''
inject_before('  accountButton.addEventListener("click",()=>{',profile,'profile helper insertion')
# Optional avatars are visible again on a fresh login, without visiting settings.
replace_once("      renderJourney();refreshFriendsSummary();maybeOpenCosmosAskDeepLink();",
 "      renderJourney();refreshFriendsSummary();maybeOpenCosmosAskDeepLink();\n      void cosmos929AvatarHeader('personal');",'bootstrap avatar hydration')
replace_once("    refreshFriendsSummary();renderJourney();maybeOpenCosmosAskDeepLink();",
 "    refreshFriendsSummary();renderJourney();maybeOpenCosmosAskDeepLink();\n    void cosmos929AvatarHeader('personal');",'sign-in avatar hydration')
replace_once("      openBusinessHub('metro');\n    }else{",
 "      openBusinessHub('metro');\n      void cosmos929AvatarHeader('business');\n    }else{",'business entry avatar hydration')
# Call native profile UI injection at creation: attach after openSheet exactly before noticeToggle handler
replace_once('''    $("noticeToggle").onchange=async e=>''','''    cosmos929MountPhotos('personal',$('displayName')?.closest('.sheet-inner')||$('sheet')?.querySelector('.sheet-inner'));
    $("noticeToggle").onchange=async e=>''','personal profile hookup')
assert "        root.innerHTML=`<div class=\"business-surface\"><h3>My Business profile</h3>" in s
# business profile rendered then apply after template DOM, direct before existing businessDirectory binding
replace_once("        $('businessDirectoryV925').onclick=()=>cosmosDirectoryViewV925('business','settings');",
 "        cosmos929MountPhotos('business',root);\n        $('businessDirectoryV925').onclick=()=>cosmosDirectoryViewV925('business','settings');", 'business profile hookup')
# Job automatic matching on ready résumé on open/select; if PDF extraction unready, remain manual.
replace_once('<label for="jobsTargetRole">Target position for external search</label>', '<label for="jobsTargetRole">Target position for external search (optional)</label>', 'target position label')
replace_once("          const selector=$('businessJobResume');selector.onchange=()=>{businessJobsResumeId=selector.value;};",
 "          const selector=$('businessJobResume');selector.onchange=()=>{businessJobsResumeId=selector.value;const d=resumes.find(x=>x.id===selector.value);if(d?.parse_status==='ready')$('jobsRefreshMatches')?.click();};", 'job selected resume autostart')
assert "          $('jobsRefreshMatches').onclick=async()=>{" in s
# Insert after handler and before the following closing braces for the view; find unique trailing marker.
replace_once("            }catch(e){$('jobsMatches').textContent=e.message;}\n          };",
 "            }catch(e){$('jobsMatches').textContent=e.message;}\n          };\n          // Automatically start internal-first matching for a ready saved/uploaded résumé.\n          // No résumé bytes are sent to external providers by this browser action.\n          if(selector.value&&resumes.some(d=>d.id===selector.value&&d.parse_status==='ready')){\n            queueMicrotask(()=>{if($('jobsRefreshMatches')&&$('businessJobResume')===selector)$('jobsRefreshMatches').click();});\n          }",'autoload resume matches')
# Public questions: native compact markup, no large image or excerpt, click article links accessible.
old='''      const img=cosmosSafePublicPath(x.image_url,/^\\/assets\\/cosmos-approved-cards\\/global-[a-z0-9-]+\\.png$/);
      if(!link)return '';
      return `<article class="cosmos-public-card"><div class="cosmos-public-eyebrow">◎ Public · ${escapeHtml(x.category||'Intelligence')} · ${escapeHtml(new Date(x.published_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}))}</div>
      <h3>${escapeHtml(x.question)}</h3><p>${escapeHtml(x.short_answer)}</p>
      ${img?`<img src="${escapeHtml(img)}" loading="lazy" alt="COSMOS card for ${escapeHtml(x.question)}">`:''}
      <div class="cosmos-public-links"><a href="${escapeHtml(link)}">Read sources & full answer ↗</a><a href="/cosmos-next.html?public_moment=${encodeURIComponent(x.id)}">This moment in COSMOS</a></div></article>`;'''
new='''      if(!link)return '';
      const taggedRegions=Array.isArray(x.regions)?x.regions.filter(v=>typeof v==='string' && /^[A-Z]{2,3}$/.test(v)).slice(0,20):[];
      return `<article class="cosmos-public-card cosmos929-question" data-cosmos929-category="${escapeHtml(x.category||'Other')}" data-cosmos929-regions="${escapeHtml(taggedRegions.join(','))}">
        <div class="cosmos-public-eyebrow">${escapeHtml(x.category||'Intelligence')} · ${escapeHtml(new Date(x.published_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}))}</div>
        <h3>${escapeHtml(x.question)}</h3>
        <div class="cosmos-public-links"><a href="${escapeHtml(link)}">Read answer ↗</a></div></article>`;'''
replace_once(old,new,'native compact public cards')
# Public More menu native entries, rather than MutationObserver-created fragile controls.
replace_once("['origins','Origins · Original COSMOS'],['directory','Search Personal people']", "['origins','Origins · Original COSMOS'],['marketplace','Personal Marketplace'],['questions','Global questions'],['directory','Search Personal people']",'Personal More native options')
replace_once("      ['feed','Work feed'],['profile','Business profile']", "      ['marketplace','Business Marketplace'],['questions','Global questions'],['profile','Business profile']",'Business More options')
replace_once("    if(name==='directory'){window.cosmosOpenDirectoryV925?.(overlay.dataset.cosmosUniverseV925||'personal','search');return;}",
 "    if(name==='directory'){window.cosmosOpenDirectoryV925?.(overlay.dataset.cosmosUniverseV925||'personal','search');return;}\n    if(name==='marketplace'){location.assign(overlay.dataset.cosmosUniverseV925==='business'?'/cosmos-market-business.html':'/cosmos-market-personal.html');return;}\n    if(name==='questions'){window.cosmos929OpenQuestionArchive?.();return;}", 'More action handlers')
# CSS force override and deterministic local JS enhancements inserted after all original styles, before closing style.
STYLE=r'''
/* COSMOS v9.2.9 — Verified against uploaded live source. Self-contained frontend. */
#sheet.business-modal{width:100vw!important;max-width:100vw!important;}
#sheet.business-modal .sheet-inner{width:100%!important;max-width:none!important;margin:0!important;padding-inline:clamp(12px,2.3vw,42px)!important}
#sheet.business-modal .business-shell.business-timeline-first{width:100%!important;max-width:none!important;margin:0!important}
#sheet.business-modal .business-metro-shell,#sheet.business-modal .shared-metro-engine,
#sheet.business-modal #businessBody,#sheet.business-modal .shared-metro-engine .week-metro,
#sheet.business-modal .shared-metro-engine .metro-main{width:100%!important;max-width:none!important}
#sheet.business-modal .shared-metro-engine .metro-day-scroll{max-width:none!important;width:100%!important}
#sheet.business-modal .business-metro-shell{padding-bottom:125px!important}
#sheet.business-modal .business-profile-menu a.cosmos929-market-menu{display:block;padding:12px 13px;border-radius:11px;border:1px solid #e3e7e9;background:#fff;color:#26333c;text-decoration:none;font-weight:700}
.cosmos929-brand{display:flex;align-items:center;gap:11px;pointer-events:auto}
.cosmos929-origin-orb{width:34px;height:34px;flex:0 0 34px;border:1.5px solid #8c9ba6;background:#fff;border-radius:50%;display:grid;place-items:center;text-decoration:none;box-shadow:0 2px 12px #00000012;pointer-events:auto}
.cosmos929-origin-orb span{width:18px;height:18px;border:1px solid #6b8295;border-radius:50%}
.cosmos929-origin-orb:focus-visible{outline:3px solid #3380d1;outline-offset:2px}
.cosmos929-extra-btn,.cosmos929-market-link{display:inline-flex;align-items:center;justify-content:center;border:1px solid #cfd9de!important;background:#fff!important;color:#2d3f49!important;min-height:34px;padding:8px 11px!important;border-radius:999px;font-size:11px!important;font-weight:760;text-decoration:none!important}
/* Public editorial: only a question and one answer link, no duplicated article cards. */
#app.metro-live .cosmos-public-stack{display:grid;gap:5px;margin:4px 0 15px}
#app.metro-live .cosmos-public-card.cosmos929-question{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:3px 10px!important;align-items:center!important;padding:10px 12px!important;min-height:60px!important;border:1px solid #e1e7eb!important;border-radius:12px!important;box-shadow:none!important;cursor:pointer}
#app.metro-live .cosmos929-question .cosmos-public-eyebrow{grid-column:1;grid-row:1;font-size:9px!important}
#app.metro-live .cosmos929-question h3{grid-column:1;grid-row:2;font-size:clamp(12px,1.3vw,15px)!important;line-height:1.33;margin:0!important}
#app.metro-live .cosmos929-question .cosmos-public-links{grid-column:2;grid-row:1/span 2;margin:0!important;flex-wrap:nowrap!important}
#app.metro-live .cosmos929-question .cosmos-public-links a{font-size:11px!important;white-space:nowrap;padding:7px 10px!important}
#app.metro-live .cosmos929-question[hidden]{display:none!important}
#app.metro-live .cosmos929-question .cosmos-public-tap-hint{display:none!important}
.cosmos929-public-filter{display:flex;flex-wrap:wrap;align-items:end;gap:8px;padding:10px 12px;margin:5px 0 8px;background:#f7fafb;border:1px solid #e0e7e9;border-radius:13px}
.cosmos929-public-filter strong{font-size:14px;margin-right:auto;align-self:center}
.cosmos929-public-filter label{font-size:11px;display:grid;gap:3px;color:#5d6d78;font-weight:650}
.cosmos929-public-filter select{min-height:34px;max-width:180px;border-radius:9px;border:1px solid #cdd9df;padding:6px;background:white;color:#273c48}
.cosmos929-public-filter button,.cosmos929-dialog button[data-close]{min-height:35px;padding:7px 11px;background:#fff;border:1px solid #ccd9e1;border-radius:10px;color:#30414e;font-weight:700}
.cosmos929-overlay{position:fixed;z-index:15000;inset:0;display:grid;place-items:center;background:#0d172a7d;padding:14px}
.cosmos929-dialog{width:min(880px,100%);max-height:90dvh;overflow:auto;background:#fff;color:#263540;border-radius:20px;padding:17px 20px 22px;box-shadow:0 22px 60px #06102140}
.cosmos929-dialog-head{display:flex;justify-content:space-between;align-items:center;gap:15px}
.cosmos929-dialog h2{font-size:clamp(19px,3vw,27px);margin:4px 0}
.cosmos929-dialog p{font-size:12px;line-height:1.5;color:#687781}
.cosmos929-archive-filters{display:flex;flex-wrap:wrap;gap:10px;margin:13px 0}
.cosmos929-archive-filters label{display:grid;gap:4px;font-size:11px;font-weight:750}
.cosmos929-archive-filters select{padding:8px;border:1px solid #d3dde3;border-radius:10px;background:#fff}
.cosmos929-work-row,.cosmos929-public-archive-row{width:100%;display:flex;justify-content:space-between;align-items:center;gap:13px;text-align:left;padding:13px 9px;background:white;border:0;border-bottom:1px solid #e3e8eb;color:#273540;text-decoration:none}
.cosmos929-work-row span,.cosmos929-public-archive-row span{display:grid;gap:5px}
.cosmos929-work-row strong,.cosmos929-public-archive-row strong{font-size:14px;line-height:1.4}
.cosmos929-work-row small,.cosmos929-public-archive-row small{color:#71818b;font-size:11px}
.cosmos929-footnote{font-size:11px;color:#6c7c85}
.cosmos929-profile-media{padding:16px;border:1px solid #dde5e9;background:#fff;border-radius:17px;margin:12px 0 20px}
.cosmos929-profile-media h3{font-size:18px;margin:0 0 5px;color:#273946}
.cosmos929-profile-media p{font-size:12px;line-height:1.5;color:#687985}
.cosmos929-photo-grid{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin:13px 0}
.cosmos929-photo-grid label{font-size:12px;font-weight:750;display:block;margin-bottom:6px}
.cosmos929-photo-grid input[type=file]{width:100%;max-width:100%;font-size:12px;margin-top:8px}
.cosmos929-photo-preview{height:140px;border-radius:13px;border:1px solid #d9e3e8;background:#f3f7f9;display:grid;place-items:center;color:#80909a;overflow:hidden}
.cosmos929-photo-preview.avatar{width:140px;height:140px;border-radius:50%}
.cosmos929-photo-preview img{width:100%;height:100%;object-fit:cover}
@media(max-width:640px){.cosmos929-photo-grid{grid-template-columns:1fr}.cosmos929-photo-preview.avatar{width:110px;height:110px}
 #sheet.business-modal .sheet-inner{padding-inline:8px!important}.cosmos929-public-filter{padding:9px;gap:6px}
 .cosmos929-public-filter strong{flex:1 0 100%}}
'''
# inject in last style which closes near HTML markup; find unique preceding css tail marker for closing style
anchor='</style>'
assert s.count(anchor)==1
s=s.replace(anchor,STYLE+'\n'+anchor,1)
# Stable native archive/filter script (public-only); removed older v928 dependency.
PUBLIC_JS=r'''<script>
/* COSMOS v9.2.9 public-only question controls. Never access token or private records. */
(()=>{'use strict';
 const stage=document.getElementById('journeyStage');if(!stage)return;
 const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const unique=a=>[...new Set(a.filter(Boolean))].sort();
 let rememberedCategory='all',rememberedRegion='all',pending=false;
 function taggedRegions(x){return Array.isArray(x.regions)?x.regions.filter(v=>typeof v==='string'&&/^[A-Z]{2,3}$/.test(v)):[];}
 function safeUrl(x){try{const u=new URL(x,location.origin);return u.origin===location.origin&&/^\/q\/trends\/global-[a-z0-9-]+\.html$/.test(u.pathname)&&!u.search&&!u.hash?u.pathname:null;}catch{return null;}}
 function updatePublic(){
   const stack=stage.querySelector('.cosmos-public-stack');if(!stack)return;
   const cards=[...stack.querySelectorAll('.cosmos929-question')];if(!cards.length)return;
   const container=stack.parentElement;if(!container)return;
   if(!container.querySelector(':scope > .cosmos929-public-filter')){
     const categories=unique(cards.map(c=>c.dataset.cosmos929Category));
     const regions=unique(cards.flatMap(c=>(c.dataset.cosmos929Regions||'').split(',').filter(Boolean)));
     const bar=document.createElement('div');bar.className='cosmos929-public-filter';
     bar.innerHTML=`<strong>Public questions · ${cards.length}</strong><label>Category<select data-filter-category><option value="all">All topics</option>${categories.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select></label>
      <label>Source region<select data-filter-region ${regions.length?'':'disabled title="No verified region tags in the published feed"'}><option value="all">All tagged regions</option>${regions.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select></label><button type="button" data-cosmos929-archive>All dates</button>`;
     container.insertBefore(bar,stack);
     bar.querySelector('[data-filter-category]').value=categories.includes(rememberedCategory)?rememberedCategory:'all';
     bar.querySelector('[data-filter-region]').value=regions.includes(rememberedRegion)?rememberedRegion:'all';
     bar.addEventListener('change',e=>{if(e.target.matches('[data-filter-category]'))rememberedCategory=e.target.value;
       if(e.target.matches('[data-filter-region]'))rememberedRegion=e.target.value;apply(stack,bar);});
     bar.querySelector('[data-cosmos929-archive]').onclick=openArchive;
   }
   apply(stack,container.querySelector(':scope > .cosmos929-public-filter'));
 }
 function apply(stack,bar){
   const cat=bar.querySelector('[data-filter-category]').value,region=bar.querySelector('[data-filter-region]').value;
   for(const c of stack.querySelectorAll('.cosmos929-question'))c.hidden=!( (cat==='all'||c.dataset.cosmos929Category===cat) && (region==='all'||(c.dataset.cosmos929Regions||'').split(',').includes(region)) );
 }
 async function openArchive(){
   document.getElementById('cosmos929QuestionsArchive')?.remove();
   const overlay=document.createElement('div');overlay.id='cosmos929QuestionsArchive';overlay.className='cosmos929-overlay';
   overlay.innerHTML='<section class="cosmos929-dialog" role="dialog" aria-modal="true" aria-label="Global questions archive"><div class="cosmos929-dialog-head"><h2>Global questions</h2><button type="button" data-close>Close ✕</button></div><p>Public, source-linked questions only. Categories and source-region tags reflect recorded evidence, not a worldwide popularity ranking.</p><div id="cosmos929ArchiveBody">Loading public questions…</div></section>';
   document.body.appendChild(overlay);overlay.onclick=e=>{if(e.target===overlay||e.target.closest('[data-close]'))overlay.remove();};
   try{
     const response=await fetch('/data/cosmos-public-timeline.json',{credentials:'omit',cache:'no-store'});
     if(!response.ok)throw Error('Unable to retrieve public questions.');
     const r=await response.json();if(r.public_only!==true||!Array.isArray(r.items))throw Error('The feed did not contain a valid public-only collection.');
     const items=r.items.filter(x=>x?.visibility==='public'&&x.type==='cosmos_editorial_question'&&safeUrl(x.url)&&Number.isFinite(Date.parse(x.published_at)))
       .sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)).slice(0,300);
     const cats=unique(items.map(x=>x.category||'Other')),regions=unique(items.flatMap(taggedRegions));
     const body=overlay.querySelector('#cosmos929ArchiveBody');if(!body)return;
     body.innerHTML=`<div class="cosmos929-archive-filters"><label>Topic<select data-archive-cat><option value="all">All topics</option>${cats.map(c=>`<option>${esc(c)}</option>`).join('')}</select></label>
       <label>Source region<select data-archive-region ${regions.length?'':'disabled'}><option value="all">All tagged regions</option>${regions.map(c=>`<option>${esc(c)}</option>`).join('')}</select></label></div><div data-archive-rows></div>`;
     function show(){const cat=body.querySelector('[data-archive-cat]').value,reg=body.querySelector('[data-archive-region]').value;
       const matched=items.filter(x=>(cat==='all'||(x.category||'Other')===cat)&&(reg==='all'||taggedRegions(x).includes(reg)));
       body.querySelector('[data-archive-rows]').innerHTML=matched.length?matched.map(x=>`<a class="cosmos929-public-archive-row" href="${esc(safeUrl(x.url))}"><span><small>${esc(x.category||'Other')} · ${esc(new Date(x.published_at).toLocaleDateString())}</small><strong>${esc(x.question)}</strong></span><span>↗</span></a>`).join(''):'<p>No questions match that selection.</p>';
     }body.querySelectorAll('select').forEach(el=>el.onchange=show);show();
   }catch(e){if(overlay.isConnected)overlay.querySelector('#cosmos929ArchiveBody').textContent=e.message;}
 }
 window.cosmos929OpenQuestionArchive=openArchive;
 new MutationObserver(()=>{if(pending)return;pending=true;queueMicrotask(()=>{pending=false;updatePublic();});}).observe(stage,{childList:true});
 updatePublic();
})();
</script>'''
# Insert after old More script before body close. (No external assets required.)
assert s.count('</body>')==1
s=s.replace('</body>',PUBLIC_JS+'\n</body>',1)
# Sanity guards required features
for check in ['cosmos929ShowRecentWork','cosmos929MountPhotos','cosmos929-question','cosmos929-origin-orb','cosmos929OpenQuestionArchive','cosmos929-public-filter']:
 assert check in s,check
# Only create a temporary file for syntax checks. Never commit private sources or logs.
output=Path('/tmp/cosmos_v929_preview.html')
output.write_text(s,encoding='utf-8')
if hashlib.sha256(s.encode()).hexdigest()!=EXPECTED_OUTPUT:
 raise SystemExit('STOP: Generated output hash differs from reviewed package.')
if mode=='apply':
 SRC.write_text(s,encoding='utf-8')
print('COSMOS v9.2.9',mode.upper(),'PASS: /tmp/cosmos_v929_preview.html')
print('Base bytes',len(initial.encode()),'updated bytes',len(s.encode()))
