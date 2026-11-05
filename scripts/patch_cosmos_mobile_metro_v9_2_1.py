#!/usr/bin/env python3
"""COSMOS v9.2.1 — mobile Public/All Metro scrolling and whole-card tap fix.

Additive frontend-only patch. Does not modify Cloudflare, authentication,
private media, or existing member posts. Safe before or after v9.4.
"""
from pathlib import Path
import argparse
import sys

p = argparse.ArgumentParser()
p.add_argument('--check', action='store_true')
args = p.parse_args()
file = Path('cosmos-next.html')
if not file.is_file():
    sys.exit('ERROR: Run from the daily-news repository root; cosmos-next.html not found.')
source = file.read_text(encoding='utf-8')
marker = 'COSMOS MOBILE METRO SCROLL AND TAP v9.2.1'
if marker in source:
    if source.count(marker) != 2 or 'cosmosPublicScrollRefresh' not in source:
        sys.exit('ERROR: partial v9.2.1 installation detected. No changes made.')
    print('PASS: v9.2.1 already installed, no changes needed.')
    sys.exit(0)
if ('COSMOS CENTRAL TIMELINE v9.0' not in source or
        'cosmos-public-card' not in source or
        'id="journeyStage"' not in source or
        source.count('</style>') != 1 or source.count('</body>') != 1):
    sys.exit('ERROR: This source does not match the existing central-timeline app. No changes made.')

CSS = r'''
/* COSMOS MOBILE METRO SCROLL AND TAP v9.2.1
 * Public cards were appended to #metroMain, whose old rules force overflow:hidden.
 * Make ONE native iOS scroller when the Public or All view contains public cards.
 * Keep the original private-only Metro scroller unchanged. */
#app.metro-live #metroMain.cosmos-public-scroller {
  display:block!important;
  overflow-y:auto!important;
  overflow-x:hidden!important;
  min-height:0!important;
  flex:1 1 auto!important;
  -webkit-overflow-scrolling:touch!important;
  touch-action:pan-y!important;
  overscroll-behavior-y:contain;
  scrollbar-width:thin;
  scroll-padding-bottom:110px;
  padding:0 0 calc(120px + env(safe-area-inset-bottom))!important;
}
#app.metro-live #metroMain.cosmos-public-scroller > .metro-day-heading,
#app.metro-live #metroMain.cosmos-public-scroller > .cosmos-public-stack {
  display:block;
  width:100%;
  flex:none!important;
}
/* When Private and Public share the All view, avoid nested iOS scrollers. */
#app.metro-live #metroMain.cosmos-public-scroller > .metro-day-scroll {
  flex:none!important;
  height:auto!important;
  min-height:0!important;
  max-height:none!important;
  overflow:visible!important;
  overscroll-behavior:auto!important;
  touch-action:pan-y!important;
  -webkit-mask-image:none!important;
  mask-image:none!important;
}
#app.metro-live #metroMain.cosmos-public-scroller .living-day-chart {
  height:auto!important;
}
#app.metro-live #metroMain.cosmos-public-scroller .cosmos-public-card {
  cursor:pointer;
  touch-action:pan-y;
  -webkit-tap-highlight-color:rgba(30,105,143,.14);
}
#app.metro-live #metroMain.cosmos-public-scroller .cosmos-public-card:focus-visible {
  outline:3px solid #217fa6;
  outline-offset:3px;
}
#app.metro-live #metroMain.cosmos-public-scroller .cosmos-public-tap-hint {
  display:inline-flex;
  align-items:center;
  width:max-content;
  max-width:100%;
  padding:7px 10px;
  font-size:12px;
  line-height:1.4;
  font-weight:750;
  border-radius:999px;
  background:#e7f3f9;
  color:#165573;
}
'''

JS = r'''
<script>
/* COSMOS MOBILE METRO SCROLL AND TAP v9.2.1
 * Installs independently from the central Metro implementation, so v9.3/v9.4
 * can be applied later without replacing or reverting their function anchors. */
(function(){
  'use strict';
  const stage=document.getElementById('journeyStage');
  if(!stage)return;
  function safeArticlePath(link){
    try{
      const u=new URL(link.getAttribute('href')||'',location.origin);
      if(u.origin!==location.origin || u.search || u.hash)return '';
      return /^\/q\/trends\/global-[a-z0-9-]+\.html$/.test(u.pathname)?u.pathname:'';
    }catch{return '';}
  }
  function cosmosPublicScrollRefresh(){
    const main=stage.querySelector('#metroMain');
    if(!main)return;
    const cards=main.querySelectorAll('.cosmos-public-card');
    main.classList.toggle('cosmos-public-scroller',cards.length>0);
    cards.forEach(card=>{
      if(card.dataset.cosmosPublicTapReady==='1')return;
      const article=Array.from(card.querySelectorAll('a')).find(a=>safeArticlePath(a));
      if(!article)return;
      card.dataset.cosmosPublicTapReady='1';
      card.dataset.cosmosPublicOpen=safeArticlePath(article);
      card.tabIndex=0;
      card.setAttribute('role','link');
      card.setAttribute('aria-label','Read COSMOS public moment: '+(card.querySelector('h3')?.textContent||'Published answer'));
      const label=document.createElement('span');
      label.className='cosmos-public-tap-hint';
      label.textContent='Tap anywhere to read this moment ↗';
      const title=card.querySelector('h3');
      if(title)title.insertAdjacentElement('afterend',label);
    });
  }
  // A redraw replaces #metroMain; observe that direct replacement only.
  // We deliberately don't observe descendants, avoiding observer loops.
  let queued=false;
  const observer=new MutationObserver(()=>{
    if(queued)return;
    queued=true;
    queueMicrotask(()=>{queued=false;cosmosPublicScrollRefresh();});
  });
  observer.observe(stage,{childList:true});
  cosmosPublicScrollRefresh();

  // Let native anchors and existing buttons do their own actions.
  // Tapping the rest of the card opens the published source-linked answer.
  stage.addEventListener('click',event=>{
    if(event.target.closest('a,button,input,select,textarea'))return;
    const card=event.target.closest('.cosmos-public-card[data-cosmos-public-open]');
    if(!card||!stage.contains(card))return;
    const path=card.dataset.cosmosPublicOpen;
    if(!/^\/q\/trends\/global-[a-z0-9-]+\.html$/.test(path||''))return;
    location.assign(path);
  });
  stage.addEventListener('keydown',event=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    const card=event.target;
    if(!card?.matches?.('.cosmos-public-card[data-cosmos-public-open]'))return;
    const path=card.dataset.cosmosPublicOpen;
    if(!/^\/q\/trends\/global-[a-z0-9-]+\.html$/.test(path||''))return;
    event.preventDefault();
    location.assign(path);
  });
})();
</script>
'''

if args.check:
    print('PASS: expected Central Timeline and Public card anchors found. No files changed.')
    sys.exit(0)

updated=source.replace('</style>', CSS+'\n</style>',1).replace('</body>',JS+'\n</body>',1)
if updated.count(marker)!=2:
    sys.exit('ERROR: patch marker count invalid. No changes made.')
file.write_text(updated,encoding='utf-8')
print('PASS: v9.2.1 frontend scroll/tap fix installed; original account/Metro/Worker unchanged.')
