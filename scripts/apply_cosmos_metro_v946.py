#!/usr/bin/env python3
"""COSMOS v9.4.6 guarded frontend-only layout and owner controls patch.

Only modifies cosmos-next.html when --mode apply is explicitly supplied.
NEVER changes Cloudflare Worker, D1, or repository workflow files.
"""
import argparse
import hashlib
import pathlib
import subprocess
import tempfile
import re
import sys
SOURCE_SHA='d8726f986edf168544a60a8540d4112a379d689b59e806d10339c8ef2a88ee38'
TARGET_SHA='55a560ab2f54baf68f12c3a5287367a68f05da7ca45777e118f98da297556db1'
parser=argparse.ArgumentParser()
parser.add_argument('--mode',choices=['validate','apply'],default='validate')
args=parser.parse_args()
source=pathlib.Path('cosmos-next.html')
if not source.is_file():raise SystemExit('ERROR: cosmos-next.html missing at GitHub repository root.')
original=source.read_bytes()
current=hashlib.sha256(original).hexdigest()
if current==TARGET_SHA:
    print('COSMOS v9.4.6 already installed. No changes.');sys.exit(0)
if current!=SOURCE_SHA:
    raise SystemExit('ERROR: Protected source mismatch. Expected v9.4.5, got '+current+'. No file changed.')
s=original.decode('utf-8')
# Precise edits for feed's metadata and controls. No rewriting actual article dates.
s_look="(date?' · '+escape(date):'')+' · '+escape((x.topics||[]).slice(0,2).map(t=>name(space,t)).join(', '))+'</small>'+"
s_replace="(date?' · Published '+escape(date):' · Date unavailable')+' · '+escape((x.topics||[]).slice(0,2).map(t=>name(space,t)).join(', '))+'</small>'+"
assert s.count(s_look)==1
s=s.replace(s_look,s_replace)
# Show only up to three discover cards on the timeline, but still provide all 50 in full-screen reader.
old="'<div class=\"cosmos942-list\">'+entry.items.slice(0,15).map(x=>discoveryCard(x,space)).join('')+'</div>')+"
new="'<div class=\"cosmos942-list\">'+entry.items.slice(0,3).map(x=>discoveryCard(x,space)).join('')+'</div>')+"
assert s.count(old)==1
s=s.replace(old,new)
# Replace misleading controls: 'Full screen' pertains to the article reader, not background wallpaper.
s1="'<button type=\"button\" data-location>News location</button><button type=\"button\" data-open-full>Full screen ↗</button>'+"
s2="'<button type=\"button\" data-location>News location</button><button type=\"button\" data-refresh-feed>Refresh news</button><button type=\"button\" data-open-full>All news ↗</button>'+"
assert s.count(s1)==1
s=s.replace(s1,s2)
needle="    el.querySelector('[data-location]').onclick=()=>openLocationEditor(space);\n    el.querySelector('[data-open-full]').onclick=()=>openDiscoveryFullScreen(space);"
insert="""    el.querySelector('[data-location]').onclick=()=>openLocationEditor(space);
    el.querySelector('[data-refresh-feed]').onclick=async()=>{
      const button=el.querySelector('[data-refresh-feed]');button.disabled=true;
      button.textContent='Refreshing…';
      if(state.locations[space]){state.localKey[space]='';delete state.local[space];}
      else{delete state.feeds[space];}
      if(state.locations[space])liveLocal(space);else await feed(space);
      render(space,container);
    };
    el.querySelector('[data-open-full]').onclick=()=>openDiscoveryFullScreen(space);"""
assert s.count(needle)==1
s=s.replace(needle,insert)
# Remove redundant space before punctuation and say data was generated at a specific date.
a="' · Coverage depends on the publishers and discovery providers'+(entry.feed?.updated_at?' · Updated '+escape(String(entry.feed.updated_at).slice(0,10)):'')+'.</p>';"
b="' · Coverage depends on publishers'+(entry.feed?.updated_at?' · Feed checked '+escape(String(entry.feed.updated_at).slice(0,10)):' · Feed date unavailable')+'. Articles retain their own published dates.</p>';"
assert s.count(a)==1
s=s.replace(a,b)
# Day heading: make owner-selected day the center of chronology, avoid ambiguous '0 work moments' if no events.
a='const label=selectedDay.toLocaleDateString(\'en-US\',{weekday:\'long\',month:\'short\',day:\'numeric\',year:\'numeric\'});'
b="const label=selectedDay.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric',year:'numeric'});"
assert s.count(a)==1
# Existing chronological hour groups are left untouched.
CSS=r'''<style id="cosmos946ClearMetroAndNews">
/* v9.4.6: no floating photo controls in the center of the Business Metro.
   They are accessible from the authenticated owner portrait dialog instead. */
#sheet.business-modal[data-business-tab="metro"] .cosmos943-wallpaper-tools{display:none!important}
/* Owner navigation is moved into the owner portrait. If unsigned, leave More available. */
html.cosmos946-personal-owner-ready #app.metro-live .week-metro .metro-filters [data-cosmos-metro-more="personal"],
html.cosmos946-business-owner-ready #sheet.business-modal[data-business-tab="metro"] .metro-filters [data-cosmos-metro-more="business"]{display:none!important}
/* No large false-white layer over selected wallpapers, and no clipped teaser cards. */
#app.metro-live .cosmos942-discover,
#sheet.business-modal[data-business-tab="metro"] .cosmos942-discover{
  background:rgba(249,252,255,.18)!important;border:1px solid rgba(255,255,255,.4)!important;
  -webkit-backdrop-filter:none!important;backdrop-filter:none!important;
  box-shadow:none!important;overflow:visible!important;max-width:min(1180px,calc(100% - 24px))!important;
  padding:12px!important;
}
#app.metro-live .cosmos942-list,
#sheet.business-modal[data-business-tab="metro"] .cosmos942-list{
  display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;
  gap:10px!important;max-width:none!important;width:100%!important;
  overflow:visible!important;scroll-snap-type:none!important;
}
#app.metro-live .cosmos942-list a,
#sheet.business-modal[data-business-tab="metro"] .cosmos942-list a{
  display:block!important;flex:none!important;width:auto!important;min-width:0!important;
  max-width:none!important;overflow-wrap:anywhere!important;scroll-snap-align:none!important;
  background:rgba(255,255,255,.94)!important;border:1px solid rgba(202,217,228,.85)!important;
  min-height:78px!important;padding:12px 14px!important;
}
/* Prevent giant empty space after date heading, but keep the real hour-by-hour branches. */
#app.metro-live .journey-stage #metroMain,
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .metro-main{
  min-height:0!important;height:auto!important;max-height:none!important;
}
#app.metro-live .journey-stage .metro-day-scroll,
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .metro-day-scroll{
  min-height:180px!important;max-height:none!important;height:auto!important;
  padding-bottom:30px!important;overflow:visible!important;
}
#app.metro-live .journey-stage .living-day-chart,
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .living-day-chart{
  min-height:150px!important;height:auto!important;padding-bottom:22px!important;
}
#app.metro-live .journey-stage .living-branch,
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .living-branch{
  margin-block:10px!important;min-height:65px!important;
}
/* Keep the selected day's date and its hours legible even over a busy cover photo. */
#app.metro-live .journey-stage .metro-day-heading,
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .metro-day-heading{
  display:flex!important;flex-wrap:wrap!important;gap:6px 14px!important;align-items:center!important;
  padding:9px 12px!important;margin-top:12px!important;
  border-radius:12px!important;background:rgba(246,250,253,.84)!important;
}
#app.metro-live .journey-stage .metro-day-heading h2,
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .metro-day-heading h2{
  color:#1b303f!important;text-shadow:none!important;font-size:clamp(16px,2.1vw,23px)!important;
  line-height:1.3!important;
}
#app.metro-live .journey-stage .metro-day-heading p,
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .metro-day-heading p{
  color:#41596b!important;text-shadow:none!important;font-size:12px!important;
}
#app.metro-live .journey-stage .living-time-label,
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .living-time-label{
  background:rgba(255,255,255,.93)!important;color:#1d3b50!important;
  border-radius:100px!important;padding:3px 8px!important;font-weight:740!important;
}
/* Make each actual hour group a readable timeline row on both surfaces. */
#app.metro-live .journey-stage .living-rail,
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .living-rail{
  overflow:visible!important;max-height:none!important;flex-wrap:wrap!important;
}
#app.metro-live .journey-stage .living-entry,
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .living-entry{
  max-width:100%!important;white-space:normal!important;overflow-wrap:anywhere!important;
}
#app.metro-live .journey-stage .living-empty,
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .living-empty{
  margin:15px auto!important;padding:13px 16px!important;max-width:640px!important;
}
.cosmos946-portrait-extras{border-top:1px solid #dde6ed;margin-top:12px;padding-top:13px;display:grid;gap:10px}
.cosmos946-portrait-extras h3{font-size:15px;color:#263d51;margin:0}
.cosmos946-portrait-extras p{font-size:12px;color:#526677;margin:0}
.cosmos946-extras-buttons{display:flex;gap:8px;flex-wrap:wrap}
.cosmos946-extras-buttons button{background:#fff!important;color:#1f394c!important;border:1px solid #c6d5df!important;
  font-weight:720!important;border-radius:99px!important;padding:10px 14px!important;min-height:40px!important}
.cosmos946-extras-buttons button[aria-pressed="true"]{background:#233c4e!important;color:#fff!important}
@media(max-width:800px){
 #app.metro-live .cosmos942-list,
 #sheet.business-modal[data-business-tab="metro"] .cosmos942-list{grid-template-columns:repeat(2,minmax(0,1fr))!important}
}
@media(max-width:540px){
 #app.metro-live .cosmos942-list,
 #sheet.business-modal[data-business-tab="metro"] .cosmos942-list{grid-template-columns:1fr!important}
 #app.metro-live .cosmos942-discover,
 #sheet.business-modal[data-business-tab="metro"] .cosmos942-discover{max-width:calc(100% - 8px)!important;padding:8px!important}
 #app.metro-live .journey-stage .metro-day-heading,
 #sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .metro-day-heading{padding:9px 10px!important}
}
</style>'''
JS=r'''<script id="cosmos946OwnerNavigation">
(()=>{'use strict';
  // Add one owner-centered navigation point without changing auth, posts or the original menu handlers.
  const sync=()=>{
    const personal=!!document.getElementById('cosmos933-avatar-personal');
    const business=!!document.getElementById('cosmos933-avatar-business');
    document.documentElement.classList.toggle('cosmos946-personal-owner-ready',personal);
    document.documentElement.classList.toggle('cosmos946-business-owner-ready',business);
    const dialog=document.querySelector('.cosmos933-profile-dialog');
    if(!dialog||dialog.querySelector('.cosmos946-portrait-extras'))return;
    const title=dialog.querySelector('.cosmos933-photo-heading h2')?.textContent||'';
    const universe=/Business/i.test(title)?'business':'personal';
    const tools=dialog.querySelector('.cosmos933-photo-tools');
    if(!tools)return;
    const extra=document.createElement('section');extra.className='cosmos946-portrait-extras';
    extra.innerHTML='<h3>Timeline and settings</h3><p>Open your COSMOS navigation from your profile photo instead of crowding the Metro.</p>'+ 
      '<div class="cosmos946-extras-buttons"><button type="button" data-owner-more>More COSMOS options</button></div>'+
      (universe==='business'?'<h3>Business background</h3><div class="cosmos946-extras-buttons">'+
       '<button type="button" data-wallpaper="whole">Fit whole photo</button>'+ 
       '<button type="button" data-wallpaper="fill">Fill screen</button>'+ 
       '<button type="button" data-wallpaper="view">View full background</button></div>':'');
    tools.insertAdjacentElement('afterend',extra);
    extra.querySelector('[data-owner-more]').addEventListener('click',()=>{
      dialog.querySelector('[data-cosmos933-close]')?.click();
      const more=document.querySelector('[data-cosmos-metro-more="'+universe+'"]');
      if(more)more.click();
    });
    const get=()=>{try{return localStorage.getItem('cosmos944_wallpaper_fit')!=='fill';}catch{return true;}};
    const mark=()=>extra.querySelectorAll('[data-wallpaper]').forEach(b=>{
      const t=b.dataset.wallpaper;
      if(t!=='view')b.setAttribute('aria-pressed',String(t==='whole'?get():!get()));
    });
    extra.querySelectorAll('[data-wallpaper]').forEach(b=>b.addEventListener('click',()=>{
      const actual=document.querySelector('#sheet.business-modal .cosmos943-wallpaper-tools [data-'+
        (b.dataset.wallpaper==='whole'?'whole':b.dataset.wallpaper==='fill'?'fill':'view')+']');
      if(actual){actual.click();mark();}
    }));
    mark();
  };
  let queued=false;
  const run=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;sync();});};
  const stage=document.getElementById('journeyStage'),sheet=document.getElementById('sheet');
  if(stage)new MutationObserver(run).observe(stage,{childList:true,subtree:true});
  if(sheet)new MutationObserver(run).observe(sheet,{childList:true,subtree:true});
  // Profile dialogs are appended to body, not to either Metro.
  new MutationObserver(run).observe(document.body,{childList:true});
  run();
})();
</script>'''
assert '</body>' in s
s=s.replace('</body>',CSS+'\n'+JS+'\n</body>')

expected=hashlib.sha256(s.encode('utf-8')).hexdigest()
if expected!=TARGET_SHA:
    raise SystemExit('ERROR: Generated target digest mismatch. No changes made: '+expected)
# Parse embedded scripts and run Node syntax checks without network or dependencies.
for number,code in enumerate(re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>',s,re.S|re.I),1):
    with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',suffix='.js',delete=False) as f:
        f.write(code);path=f.name
    try:
        result=subprocess.run(['node','--check',path],text=True,capture_output=True)
        if result.returncode:raise SystemExit(f'ERROR: JS syntax check failed in script {number}: '+result.stderr)
    finally:
        pathlib.Path(path).unlink(missing_ok=True)
print('Validated COSMOS v9.4.6 source, scripts, digest, and version guard.')
if args.mode=='apply':
    # Git records prior version; do not create a second backup file in the repo.
    source.write_bytes(s.encode('utf-8'))
    print('Applied v9.4.6 to cosmos-next.html only.')
else:
    print('Validation only; cosmos-next.html was NOT modified.')
