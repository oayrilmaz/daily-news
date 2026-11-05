#!/usr/bin/env python3
"""COSMOS v9.2.3: consistent Personal / Business Metro layout.

Frontend-only and additive. Does not touch API routes, accounts, permissions, R2,
D1, AI, public publishing or saved moments.

Run from the root of the CURRENT daily-news/main checkout:
    python3 scripts/patch_cosmos_identical_metros_v9_2_3.py --check
    python3 scripts/patch_cosmos_identical_metros_v9_2_3.py
"""
from pathlib import Path
import argparse
import sys

arg = argparse.ArgumentParser()
arg.add_argument('--check', action='store_true')
a = arg.parse_args()
p = Path('cosmos-next.html')
if not p.is_file():
    sys.exit('ERROR: cosmos-next.html missing. Run from daily-news repo root.')
s = p.read_text(encoding='utf-8')
CSS_MARK = 'COSMOS MATCHED METRO LAYOUT v9.2.3 CSS'
JS_MARK = 'COSMOS MATCHED METRO LAYOUT v9.2.3 JS'
BUSINESS_MARK = 'COSMOS MATCHED METRO LAYOUT v9.2.3 BUSINESS'
BRIDGE_MARK = 'COSMOS MATCHED METRO LAYOUT v9.2.3 BRIDGE'
markers = [CSS_MARK, JS_MARK, BUSINESS_MARK, BRIDGE_MARK]
if any(marker in s for marker in markers):
    if all(s.count(marker) == 1 for marker in markers):
        print('PASS: v9.2.3 is already installed; no changes required.')
        sys.exit(0)
    sys.exit('ERROR: partial v9.2.3 installation detected. No changes made.')

required = [
    'COSMOS CENTRAL TIMELINE v9.0',
    'COSMOS LINKEDIN SHARE v9.1',
    'id="returnNow"', 'id="journeyLabel"', 'id="coreOrb"',
    'id="businessMetroCompose"', 'id="businessMetroAll"',
    'id="businessMetroJobs"', 'id="businessMetroNow"',
    'id="metroDayScroll"', 'id="sheet"',
]
missing = [x for x in required if x not in s]
if missing or s.count('</style>') != 1 or s.count('</body>') != 1:
    sys.exit('ERROR: unsupported COSMOS source, missing: '+', '.join(missing)+'. No changes made.')

old_business = '''      <div class="business-metro-main-selector">
        <button type="button" id="businessMetroAll" aria-label="Show all permitted business moments">ALL WORK MOMENTS</button>
        <button type="button" id="businessMetroJobs" aria-label="Find jobs or talent in COSMOS">Jobs</button>
        <button type="button" id="businessMetroNow" aria-label="Go to today" title="Today">▦</button>
      </div>'''
new_business = '''      <!-- COSMOS MATCHED METRO LAYOUT v9.2.3 BUSINESS: identical control order to Personal -->
      <div class="business-metro-main-selector">
        <button type="button" id="businessMetroNow" aria-label="Return to NOW in Business Metro" title="Today">◯ NOW</button>
        <button type="button" id="businessMetroAll" aria-label="Show all permitted business moments">ALL WORK MOMENTS</button>
        <label class="cosmos-metro-date-label" aria-label="Jump to a Business timeline date" title="Choose a date">▦<input id="businessMetroDate" type="date" value="${escapeHtml(local)}" aria-label="Choose a Business timeline date"></label>
        <button type="button" id="businessMetroJobs" class="cosmos-kept-shortcut" aria-label="Find jobs or talent in COSMOS" tabindex="-1">Jobs</button>
      </div>'''
if s.count(old_business) != 1:
    sys.exit('ERROR: Business Metro selector changed since baseline; no changes made.')

old_now_handler = "    $('businessMetroNow').onclick=()=>{businessMetroFocus=businessMetroAtNoon(new Date());businessMetroDay=businessMetroAtNoon(new Date());loadBusinessMetroWeek();};"
new_now_handler = old_now_handler + '''
    // The Business date picker uses the same calendar-day navigation as Personal.
    $('businessMetroDate').onchange=event=>{
      const value=String(event.target.value||'');
      if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(value))return;
      const date=metroDateLocal(value);
      if(!(date instanceof Date)||!Number.isFinite(date.getTime()))return;
      businessMetroFocus=businessMetroAtNoon(date);
      businessMetroDay=businessMetroAtNoon(date);
      loadBusinessMetroWeek();
    };'''
if s.count(old_now_handler) != 1:
    sys.exit('ERROR: Business NOW handler changed; no changes made.')

old_bridge = '  $("returnNow").addEventListener("click",goNow);'
new_bridge = old_bridge + '''
  // COSMOS MATCHED METRO LAYOUT v9.2.3 BRIDGE
  // Menu actions call EXISTING handlers. This does not bypass permission checks.
  window.cosmosMetroShortcutsV923 = {
    ask:()=>showUnifiedAskComposer(),
    business:()=>enterUniverse('business'),
    personal:()=>enterUniverse('private'),
    people:()=>openFriends(),
    together:()=>openTogetherSpaces(),
    origins:()=>location.assign('/cosmos-original-home.html'),
    jobs:()=>openBusinessJobs('browse'),
    profile:()=>openBusinessHub('profile'),
    visitors:()=>openBusinessHub('visitors'),
    account:()=>{const inBusiness=document.getElementById('sheet')?.classList.contains('business-modal');const b=document.getElementById(inBusiness?'businessHeaderProfile':'accountButton');b?.click();},
    feed:()=>openBusinessHub('feed'),
  };'''
if s.count(old_bridge) != 1:
    sys.exit('ERROR: shared time-navigation handler changed; no changes made.')

css = r'''
/* COSMOS MATCHED METRO LAYOUT v9.2.3 CSS
   Shared visual shell only: Personal and Business retain separate data/permissions. */
#app.metro-live .journey-controls,
#sheet.business-modal .business-metro-main-selector {
  display:flex!important; align-items:center!important; justify-content:center!important;
  gap:8px!important; width:100%!important; min-width:0!important;
  box-sizing:border-box!important; flex-wrap:nowrap!important;
}
#app.metro-live .journey-controls > #returnNow,
#sheet.business-modal .business-metro-main-selector > #businessMetroNow {
  display:inline-flex!important; justify-content:center!important; align-items:center!important;
  flex:0 0 auto!important; white-space:nowrap!important; min-height:43px!important;
  border:1px solid #d9dfe3!important; border-radius:999px!important;
  background:#fff!important; color:#202832!important; font-size:13px!important;
  font-weight:800!important; letter-spacing:.025em!important; padding:9px 12px!important;
}
/* The brand and top-row buttons use the same visual scale in both modes. */
#app.metro-live .topbar .brand,
#sheet.business-modal .business-header-brand strong{
  color:#222a31!important; font-size:12px!important; font-weight:850!important;
  letter-spacing:.20em!important; line-height:1.25!important;
}
#app.metro-live .topbar .tagline,
#sheet.business-modal .business-header-brand span{
  color:#353c44!important; font-size:11px!important; letter-spacing:0!important;
}
#app.metro-live .cosmos-head-actions > button,
#sheet.business-modal .business-header-actions > button,
#sheet.business-modal .business-head-avatar{
  border-radius:999px!important; border:1px solid #d9dfe3!important;
  background:#fff!important; color:#232b35!important;
}
/* The owner-requested NOW shortcut must remain visible even when selected. */
#app.metro-live .journey-controls > #returnNow[hidden] {display:inline-flex!important;}
#app.metro-live .journey-controls > #journeyLabel,
#sheet.business-modal .business-metro-main-selector > #businessMetroAll {
  display:flex!important; align-items:center!important; justify-content:center!important;
  min-width:0!important; flex:1 1 auto!important; max-width:420px!important;
  padding:9px 12px!important; min-height:43px!important; box-sizing:border-box!important;
  border-radius:999px!important; border:1px solid #d9dfe3!important;
  background:#fff!important; color:#202832!important; box-shadow:0 3px 14px #00000008!important;
  font-size:12px!important; font-weight:850!important; letter-spacing:.06em!important;
  text-align:center!important; white-space:nowrap!important; overflow:hidden!important;
  text-overflow:ellipsis!important;
}
#app.metro-live .journey-controls > #jumpDate,
#sheet.business-modal .business-metro-main-selector > .cosmos-metro-date-label {
  position:relative!important; display:flex!important; align-items:center!important;
  justify-content:center!important; flex:0 0 43px!important; min-width:43px!important;
  width:43px!important; height:43px!important; min-height:43px!important;
  padding:0!important; box-sizing:border-box!important; border:1px solid #d9dfe3!important;
  background:#fff!important; color:#26313b!important; border-radius:999px!important;
  font-size:19px!important; font-weight:700!important; cursor:pointer!important;
}
#sheet.business-modal .cosmos-metro-date-label input[type="date"]{
  position:absolute; inset:0; width:100%;height:100%;opacity:0;cursor:pointer;
  font-size:16px;z-index:2;
}
#sheet.business-modal .business-metro-main-selector .cosmos-kept-shortcut{
  display:none!important;
}
/* The crossed-out top shortcut/profile pills move into the MORE menu.
   The existing actions still work by their original handlers. */
#app.metro-live .topbar #cosmosUniverseSwitch,
#app.metro-live .topbar #accountButton,
#sheet.business-modal .sheet-quickbar #businessHeaderPrivate,
#sheet.business-modal .sheet-quickbar #businessHeaderJobs,
#sheet.business-modal .sheet-quickbar #businessHeaderProfile{display:none!important;}
/* Hide clutter in the main chronology, not the underlying features. */
#app.metro-live .journey-stage .metro-filters [data-cosmos-business-nav],
#app.metro-live .journey-stage .metro-filters [data-cosmos-ask-nav],
#app.metro-live .journey-stage .metro-filters .cosmos-origins-nav,
#app.metro-live .metro-day-heading .cosmos-together-head-actions,
#app.metro-live .metro-day-heading #metroPeople,
#app.metro-live .metro-day-heading #metroTogether{
  display:none!important;
}
/* Same compact filter row across both universes. */
#app.metro-live .journey-stage .metro-filters,
#sheet.business-modal .shared-metro-engine .metro-filters{
  display:flex!important;justify-content:center!important;align-items:center!important;
  gap:6px!important; flex-wrap:nowrap!important; max-width:100%!important;
  width:100%!important; padding:7px 0!important;
  overflow-x:auto!important;overflow-y:visible!important;
  -webkit-overflow-scrolling:touch!important; scrollbar-width:none!important;
}
#app.metro-live .journey-stage .metro-filters::-webkit-scrollbar,
#sheet.business-modal .shared-metro-engine .metro-filters::-webkit-scrollbar{display:none;}
#app.metro-live .journey-stage .metro-filters button,
#sheet.business-modal .shared-metro-engine .metro-filters button,
.cosmos-metro-more-button{
  min-height:37px!important; flex:0 0 auto!important; padding:7px 10px!important;
  border:1px solid #d9dfe3!important;border-radius:999px!important;
  background:#fff!important;color:#30363b!important;
  font-size:12px!important;font-weight:700!important;white-space:nowrap!important;
}
#app.metro-live .journey-stage .metro-filters button.active,
#sheet.business-modal .shared-metro-engine .metro-filters button.active{
  background:#30363b!important;color:#fff!important;border-color:#30363b!important;
}
.cosmos-metro-more-button{cursor:pointer!important;position:sticky!important;right:0!important;z-index:3!important;}
.cosmos-metro-more-button:focus-visible,.cosmos-menu-entry:focus-visible{
  outline:3px solid #2e789b;outline-offset:2px;
}
.cosmos-metro-public-coming{opacity:.48!important;cursor:not-allowed!important;}
/* Both creation circles occupy the SAME centered dock; not two different locations. */
#app.metro-live .bottom,
#sheet.business-modal .business-metro-dock{
  left:50%!important; right:auto!important; transform:translateX(-50%)!important;
  width:max-content!important; max-width:calc(100vw - 18px)!important;
  bottom:calc(14px + env(safe-area-inset-bottom))!important;
  padding:0!important; margin:0!important; display:flex!important;
  flex-direction:column!important; align-items:center!important; justify-content:center!important;
  gap:9px!important;pointer-events:none!important;z-index:101!important;
}
#app.metro-live .bottom button,
#sheet.business-modal .business-metro-dock button {pointer-events:auto!important;}
#app.metro-live .bottom #coreOrb,
#sheet.business-modal .business-metro-dock #businessMetroCompose{
  width:68px!important;height:68px!important;min-width:68px!important;min-height:68px!important;
  padding:0!important; border-radius:50%!important;border:2px solid #aeb8c0!important;
  background:#fff!important;box-shadow:0 8px 20px #00000013!important;
}
#sheet.business-modal .business-metro-dock #businessMetroCompose span{
  width:40px!important;height:40px!important;border-radius:50%!important;
}
#app.metro-live .bottom .hint{display:none!important;}
#app.metro-live .bottom .dim-nav button,
#sheet.business-modal .business-metro-dock #businessMetroDockAll{
  min-height:41px!important;max-width:calc(100vw - 32px)!important;
  background:#30363b!important;color:#fff!important;border-radius:999px!important;
  border:1px solid #30363b!important;padding:9px 17px!important;
  font-size:11px!important;font-weight:850!important;letter-spacing:.06em!important;
  white-space:nowrap!important;box-shadow:0 7px 16px #00000019!important;
}
/* Ensure scrollable moments don't disappear under the fixed center dock. */
#app.metro-live .journey-stage{bottom:calc(140px + env(safe-area-inset-bottom))!important;}
#sheet.business-modal .shared-metro-engine .metro-day-scroll{
  padding-bottom:155px!important;-webkit-overflow-scrolling:touch!important;
}
#app.metro-live #metroMain.cosmos-public-scroller{
  padding-bottom:calc(160px + env(safe-area-inset-bottom))!important;
}
/* Menu is a modal overlay and cannot accidentally expose data. */
.cosmos-metro-more-overlay[hidden]{display:none!important;}
.cosmos-metro-more-overlay{position:fixed;inset:0;z-index:10000;
  display:flex;align-items:flex-end;justify-content:center;background:#0a142866;
  padding:16px 13px calc(18px + env(safe-area-inset-bottom));}
.cosmos-metro-more-panel{width:min(440px,100%);max-height:min(70dvh,650px);
  overflow-y:auto;background:white;border-radius:24px;padding:17px 15px;
  box-shadow:0 18px 65px #09131d35;color:#202832;}
.cosmos-metro-more-panel h2{font-size:18px;margin:4px 2px 14px;}
.cosmos-metro-more-grid{display:grid;gap:7px;}
.cosmos-menu-entry{display:block;width:100%;text-align:left;background:#fff;
  border:1px solid #dae1e4;border-radius:13px;padding:13px 14px;
  font-size:14px;font-weight:700;line-height:1.4;font-family:inherit;color:#202832;cursor:pointer;}
.cosmos-menu-entry[disabled]{opacity:.5;cursor:not-allowed;}
.cosmos-menu-close{float:right;border:1px solid #dae1e4;border-radius:999px;
  background:#fff;padding:8px 12px;color:#202832;}
@media(max-width:650px){
  #app.metro-live .journey-controls{left:0!important;right:0!important;top:calc(env(safe-area-inset-top) + 81px)!important;padding:0 11px!important;}
  #app.metro-live .journey-stage{top:calc(env(safe-area-inset-top) + 133px)!important;left:0!important;right:0!important;transform:none!important;width:100vw!important;max-width:100vw!important;padding:0 10px 4px!important;}
  #app.metro-live .journey-controls > #journeyLabel,
  #sheet.business-modal .business-metro-main-selector > #businessMetroAll{font-size:11px!important;letter-spacing:.035em!important;padding:8px 5px!important;}
  #app.metro-live .journey-controls > #returnNow,
  #sheet.business-modal .business-metro-main-selector > #businessMetroNow{font-size:12px!important;padding:8px!important;}
  #app.metro-live .journey-stage .metro-filters button,
  #sheet.business-modal .shared-metro-engine .metro-filters button,
  .cosmos-metro-more-button{font-size:11px!important;padding:7px 9px!important;}
  #sheet.business-modal .business-metro-main-selector{padding:0 2px!important;}
  #sheet.business-modal .sheet-inner{padding:12px 10px 0!important;}
  #sheet.business-modal .business-metro-dock{bottom:calc(14px + env(safe-area-inset-bottom))!important;}
}
'''

js = r'''
<script>
/* COSMOS MATCHED METRO LAYOUT v9.2.3 JS
   One overflow menu per current timeline; all commands use existing handlers. */
(function(){
  'use strict';
  const stage=document.getElementById('journeyStage');
  const sheet=document.getElementById('sheet');
  if(!stage||!sheet)return;
  let scheduled=false,lastOrigin=null;
  const actions={
    personal:[
      ['ask','✧ Ask COSMOS'],['business','◈ Business timeline'],
      ['people','People & Connections'],['together','♫ Together'],
      ['origins','Origins · Original COSMOS'],['account','Account & settings'],
    ],
    business:[
      ['personal','◈ Personal timeline'],['jobs','Jobs & talent'],
      ['feed','Work feed'],['profile','Business profile'],['visitors','Profile visitors'],['account','Account & settings'],
    ],
  };
  let overlay=document.getElementById('cosmosMetroMoreOverlayV923');
  if(!overlay){
    overlay=document.createElement('div');
    overlay.id='cosmosMetroMoreOverlayV923';
    overlay.className='cosmos-metro-more-overlay';
    overlay.hidden=true;
    overlay.innerHTML='<div class="cosmos-metro-more-panel" role="dialog" aria-modal="true" aria-labelledby="cosmosMetroMoreTitleV923"><button type="button" class="cosmos-menu-close" data-menu-close>Close ✕</button><h2 id="cosmosMetroMoreTitleV923">COSMOS</h2><div class="cosmos-metro-more-grid" id="cosmosMetroMoreListV923"></div></div>';
    document.body.appendChild(overlay);
  }
  const close=()=>{overlay.hidden=true;if(lastOrigin?.isConnected)lastOrigin.focus();};
  overlay.addEventListener('click',event=>{
    if(event.target===overlay||event.target.closest('[data-menu-close]'))return close();
    const item=event.target.closest('[data-cosmos-menu-action]');
    if(!item||item.disabled)return;
    const name=item.dataset.cosmosMenuAction;
    close();
    const handlers=window.cosmosMetroShortcutsV923;
    if(handlers&&typeof handlers[name]==='function')handlers[name]();
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!overlay.hidden)close();});
  function open(kind,origin){
    lastOrigin=origin;
    document.getElementById('cosmosMetroMoreTitleV923').textContent=kind==='business'?'Business COSMOS':'Personal COSMOS';
    document.getElementById('cosmosMetroMoreListV923').innerHTML=actions[kind].map(([value,label])=>
      `<button type="button" class="cosmos-menu-entry" data-cosmos-menu-action="${value}">${label}</button>`).join('');
    overlay.hidden=false;
    overlay.querySelector('.cosmos-menu-close').focus();
  }
  function addMenu(filters,kind){
    if(!filters||filters.querySelector('[data-cosmos-metro-more]'))return;
    const b=document.createElement('button');
    b.type='button';b.className='cosmos-metro-more-button';
    b.dataset.cosmosMetroMore=kind;b.textContent='••• More';
    b.setAttribute('aria-label','More '+kind+' COSMOS features');
    b.addEventListener('click',()=>open(kind,b));
    filters.appendChild(b);
  }
  function sync(){
    if(stage.isConnected && document.getElementById('app')?.classList.contains('metro-live')){
      addMenu(stage.querySelector('.week-metro .metro-filters'),'personal');
    }
    const work=sheet.classList.contains('business-modal')&&sheet.dataset.businessTab==='metro';
    if(work){
      const filters=sheet.querySelector('.business-metro-shell .metro-filters');
      if(filters){
        // Match four visible audience labels, but don't offer a fake public Business feed.
        if(!filters.querySelector('[data-business-metro-filter="public"]')&&!filters.querySelector('.cosmos-metro-public-coming')){
          const disabled=document.createElement('button');
          disabled.type='button';disabled.disabled=true;disabled.textContent='Public';
          disabled.className='cosmos-metro-public-coming';
          disabled.title='Business Public becomes available after its backend permission controls are enabled.';
          filters.appendChild(disabled);
        }
        addMenu(filters,'business');
      }
    }
  }
  function request(){
    if(scheduled)return;
    scheduled=true;
    queueMicrotask(()=>{scheduled=false;sync();});
  }
  new MutationObserver(request).observe(stage,{childList:true});
  new MutationObserver(request).observe(sheet,{childList:true,subtree:true});
  sync();
})();
</script>
'''

s = s.replace(old_business, new_business, 1)
s = s.replace(old_now_handler, new_now_handler, 1)
s = s.replace(old_bridge, new_bridge, 1)
s = s.replace('</style>', css+'\n</style>', 1)
s = s.replace('</body>', js+'\n</body>', 1)
for marker in markers:
    if s.count(marker) != 1:
        sys.exit('ERROR: marker check failed for '+marker+'. No files changed.')
if a.check:
    print('PASS: current v9 source supports unified Metro layout; no files changed.')
    sys.exit(0)
p.write_text(s, encoding='utf-8')
print('PASS: matched Personal and Business Metro layout installed. No backend or data changes.')
