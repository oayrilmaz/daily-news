#!/usr/bin/env python3
"""COSMOS v9.4.7 guarded frontend-only update.

Assumes the exact v9.4.6 frontend. Does not touch D1, Workers,
private moments, profiles, or unrelated GitHub files.
"""
import argparse,hashlib,pathlib,subprocess,tempfile,re,sys
SOURCE_SHA='55a560ab2f54baf68f12c3a5287367a68f05da7ca45777e118f98da297556db1'
TARGET_SHA='c46d85ff20136cd34106487e6b933de80d7650bdd5459c87232a646aff05a170'
parser=argparse.ArgumentParser()
parser.add_argument('--mode',choices=['validate','apply'],default='validate')
args=parser.parse_args()
path=pathlib.Path('cosmos-next.html')
if not path.is_file():raise SystemExit('ERROR: cosmos-next.html not found at repository root.')
original=path.read_bytes()
current=hashlib.sha256(original).hexdigest()
if current==TARGET_SHA:
 print('COSMOS v9.4.7 already installed; no modifications required.');sys.exit(0)
if current!=SOURCE_SHA:
 raise SystemExit('ERROR: v9.4.6 source fingerprint mismatch: '+current+'. No changes applied.')
html=original.decode('utf-8')
changes=[]
def replace(old,new,tag):
 global html
 n=html.count(old)
 if n!=1: raise RuntimeError(f'{tag}: expected one occurrence, found {n}')
 html=html.replace(old,new,1);changes.append(tag)
replace('  async function cosmos933Upload(universe,kind,file,status){',
        '  // v9.4.7: available only through explicit owner profile-menu action.\n  window.cosmos947OpenOwnerProfile=cosmos933OpenProfile;\n  async function cosmos933Upload(universe,kind,file,status){', 'profile-expose')
replace("    personal:[\n      ['ask','✧ Ask COSMOS']", "    personal:[\n      ['owner-profile','My Personal profile'],['ask','✧ Ask COSMOS']",'personal-profile-entry')
replace("    business:[\n      ['personal','◈ Personal timeline']", "    business:[\n      ['owner-profile','My Business profile'],['personal','◈ Personal timeline']",'business-profile-entry')
replace("    if(name==='directory'){window.cosmosOpenDirectoryV925?.(overlay.dataset.cosmosUniverseV925||'personal','search');return;}",
        "    if(name==='owner-profile'){window.cosmos947OpenOwnerProfile?.(overlay.dataset.cosmosUniverseV925||'personal');return;}\n    if(name==='news'){window.cosmos947OpenNews?.(overlay.dataset.cosmosUniverseV925||'personal');return;}\n    if(name==='directory'){window.cosmosOpenDirectoryV925?.(overlay.dataset.cosmosUniverseV925||'personal','search');return;}", 'menu-handlers')
replace("['owner-profile','My Personal profile'],['ask','✧ Ask COSMOS']", "['owner-profile','My Personal profile'],['news','News & discoveries'],['ask','✧ Ask COSMOS']",'personal-news-entry')
replace("['owner-profile','My Business profile'],['personal','◈ Personal timeline']", "['owner-profile','My Business profile'],['news','News & discoveries'],['personal','◈ Personal timeline']",'business-news-entry')
replace(" function openLocationEditor(space){\n", " window.cosmos947OpenNews=openDiscoveryFullScreen;\n function openLocationEditor(space){\n", 'news-expose')
# keep source-linked news under actual selected day, never present stale articles on future dates.
replace("  if(!el){el=document.createElement('section');el.className='cosmos942-discover';el.setAttribute('aria-label',space+' discovery');container.prepend(el);}\n  liveLocal(space);\n  const entry=discoverySet(space),status=discoveryMessage(space,entry),loc=entry.loc;",
"""  if(!el){el=document.createElement('section');el.className='cosmos942-discover';el.setAttribute('aria-label',space+' discovery');container.prepend(el);}
  // Put discovery inside the day's main reading order, not above the weekly time rail.
  const heading=container.querySelector('.metro-day-heading');
  if(heading&&heading.nextElementSibling!==el)heading.insertAdjacentElement('afterend',el);
  liveLocal(space);
  const entry=discoverySet(space),status=discoveryMessage(space,entry),loc=entry.loc;
  const chosenLabel=heading?.querySelector('h2')?.textContent||'';
  const chosen=new Date(chosenLabel);
  const chosenKey=Number.isFinite(chosen.getTime())?
    [chosen.getFullYear(),String(chosen.getMonth()+1).padStart(2,'0'),String(chosen.getDate()).padStart(2,'0')].join('-'):'';
  const selectedItems=chosenKey?entry.items.filter(x=>String(x.published_at||'').slice(0,10)===chosenKey)
    .sort((a,b)=>String(b.published_at||'').localeCompare(String(a.published_at||''))):[];
""", 'news-day-placement')
replace("  const markup='<div class=\"cosmos942-head\"><h3>✦ For you · '+(space==='personal'?'Personal':'Business')+'</h3>'+",
"  const markup='<div class=\"cosmos942-head\"><h3>✦ News · '+(space==='personal'?'Personal':'Business')+(chosenLabel?' · '+escape(chosenLabel):'')+'</h3>'+",'day-news-heading')
replace("   (status?'<p class=\"cosmos943-feedback\" role=\"status\">'+escape(status)+'</p>':\n   '<div class=\"cosmos942-list\">'+entry.items.slice(0,3).map(x=>discoveryCard(x,space)).join('')+'</div>')+\n   '<p>Source-linked news · '+(loc?'Chosen place: '+escape(loc):'Available worldwide sources')+\n   ' · Coverage depends on publishers'+(entry.feed?.updated_at?' · Feed checked '+escape(String(entry.feed.updated_at).slice(0,10)):' · Feed date unavailable')+'. Articles retain their own published dates.</p>';",
"""   (status?'<p class="cosmos943-feedback" role="status">'+escape(status)+'</p>':
   selectedItems.length?'<div class="cosmos942-list" role="list">'+selectedItems.map(x=>discoveryCard(x,space)).join('')+'</div>':
   '<p class="cosmos947-no-news">No source-linked articles published on this day for your interests. Older articles remain on their actual publication dates. Select a previous day, or open All news.</p>')+
   '<p class="cosmos947-discovery-foot">Published date determines timeline placement · '+(loc?'Chosen place: '+escape(loc):'Worldwide sources')+
   (entry.feed?.updated_at?' · Feed checked '+escape(String(entry.feed.updated_at).slice(0,10)):'')+'.</p>';""",'filter-news-to-day')
# Provide date-specific Time Lens entry when a day has no posts, without inventing timestamps.
replace("    const empty=rows.length?'':`<div class=\"living-empty\">", "    const empty=rows.length?'':`<div class=\"living-empty\">", 'empty-anchor-noop') if False else None
replace("    return heading(`${events.length} ${business?'work':events.some(x=>x._public_editorial)?'COSMOS':'real'} moment${events.length===1?'':'s'} · swipe up or down anywhere · tap a moment`)+\n      `<div class=\"metro-day-scroll compact-no-gaps\" id=\"metroDayScroll\"",
"""    const emptyDayGuide=rows.length||friend?'':`<section class="cosmos947-day-guide" aria-label="Daily timeline hours">
      <p>Timeline hours · no recorded moments at these times</p>
      <div class="cosmos947-hour-guide" aria-hidden="true"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span></div>
      <button type="button" data-cosmos947-place-date="${business?'business':'personal'}">+ Leave a moment on this day</button>
      <small>Places a moment on the selected calendar day; no historical hour is fabricated.</small></section>`;
    return heading(`${events.length} ${business?'work':events.some(x=>x._public_editorial)?'COSMOS':'real'} moment${events.length===1?'':'s'} · swipe up or down anywhere · tap a moment`)+
      `<div class="metro-day-scroll compact-no-gaps" id="metroDayScroll""",'add-empty-guide')
replace("          <div class=\"living-trunk\" aria-hidden=\"true\"></div>${branches.join('')}${empty}</div></div>`;",
        "          <div class=\"living-trunk\" aria-hidden=\"true\"></div>${branches.join('')}${empty}${emptyDayGuide}</div></div>`;",'render-empty-guide')
# Create date-specific Time Lens entry for the day guide.
replace("  async function cosmos940Fetch(append=false){",
"""  window.cosmos947TimeForDate=(space,dateText)=>{
    const parts=String(dateText||'').match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
    if(!parts)return;
    cosmos940.prefillDate={month:Number(parts[2]),day:Number(parts[3])};
    cosmos940.busy=true; // First render must not consume the prefill before the fetch returns.
    cosmos940Open(space,{era:'CE',year:String(Number(parts[1]))});
  };
  async function cosmos940Fetch(append=false){""", 'expose-dated-time-lens')
replace("    root.querySelectorAll('[data-time-media]').forEach(m=>cosmos940Media(m));\n  }\n  async function cosmos940Media(mount){",
"""    root.querySelectorAll('[data-time-media]').forEach(m=>cosmos940Media(m));
    if(!cosmos940.busy&&!error&&cosmos940.prefillDate){
      const chosen=cosmos940.prefillDate;cosmos940.prefillDate=null;
      cosmos940Compose();
      const month=root.querySelector('#cosmos940Month'),day=root.querySelector('#cosmos940Day');
      if(month)month.value=String(chosen.month);
      if(day)day.value=String(chosen.day);
    }
  }
  async function cosmos940Media(mount){""",'prefill-time-lens-month-day')
# Add bottom stylesheet/scripts, no Worker or D1 changes.
addon='''
<style id="cosmos947ChronologicalHomeAndOwner">
/* The header portrait is a direct navigation entry, while the full-page
   profile remains reachable from the very first menu option. */
.cosmos933-photo-overlay:has(.cosmos933-profile-dialog){padding:0!important;display:block!important;overflow:hidden!important}
.cosmos933-photo-overlay .cosmos933-profile-dialog{
  width:100vw!important;max-width:100vw!important;height:100dvh!important;max-height:100dvh!important;
  min-height:100dvh!important;border-radius:0!important;box-shadow:none!important;
}
.cosmos933-profile-dialog .cosmos933-photo-heading{position:sticky;top:0;z-index:2;background:#fff;padding:14px max(16px,env(safe-area-inset-right))!important}
.cosmos933-profile-dialog .cosmos933-photo-body{flex:1!important;overflow-y:auto!important;overscroll-behavior:contain!important;padding:clamp(10px,2vw,25px)!important}
.cosmos933-profile-dialog .cosmos933-profile-backdrop{height:clamp(210px,42vh,550px)!important;border-radius:12px!important}
.cosmos933-profile-dialog .cosmos933-photo-tools{justify-content:center!important;max-width:1200px;margin:18px auto!important}
.cosmos933-profile-dialog .cosmos933-profile-name{font-size:clamp(19px,2.4vw,29px)!important}
/* Dated news lives directly inside the selected day's reading flow. */
#app.metro-live #metroMain>.cosmos942-discover,
#sheet.business-modal[data-business-tab="metro"] #businessMetroMain>.cosmos942-discover{
  order:0!important;position:relative!important;width:100%!important;max-width:none!important;
  margin:8px 0 12px!important;padding:10px 14px!important;
  background:rgba(245,249,251,.55)!important;border-radius:10px!important;
  border:1px solid rgba(255,255,255,.34)!important;overflow:visible!important;
  -webkit-backdrop-filter:none!important;backdrop-filter:none!important;
}
#app.metro-live #metroMain>.cosmos942-discover .cosmos942-list,
#sheet.business-modal[data-business-tab="metro"] #businessMetroMain>.cosmos942-discover .cosmos942-list{
  display:flex!important;flex-direction:column!important;gap:6px!important;overflow:visible!important;
  width:100%!important;max-width:none!important;scroll-snap-type:none!important;
}
#app.metro-live #metroMain>.cosmos942-discover .cosmos942-list>a,
#sheet.business-modal[data-business-tab="metro"] #businessMetroMain>.cosmos942-discover .cosmos942-list>a{
  box-sizing:border-box!important;display:block!important;width:100%!important;max-width:none!important;
  flex:none!important;min-height:unset!important;padding:12px 15px!important;scroll-snap-align:none!important;
  border-radius:9px!important;background:rgba(255,255,255,.91)!important;
}
.cosmos947-no-news{padding:8px 0!important;margin:0!important;font-size:13px!important}
.cosmos947-discovery-foot{font-size:11px!important;margin:7px 0 0!important}
.cosmos947-day-guide{position:relative;z-index:2;margin:10px 14px 15px clamp(45px,9%,100px);
  padding:14px;border-radius:12px;border:1px solid rgba(210,224,237,.9);background:rgba(255,255,255,.73);
  display:flex;flex-direction:column;gap:10px;color:#263d50;}
.cosmos947-day-guide p{margin:0;font-weight:700;font-size:12px}
.cosmos947-hour-guide{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;
  padding:12px 0;border-top:1px solid #d7e1ea;border-bottom:1px solid #d7e1ea}
.cosmos947-hour-guide span{font-size:10px;color:#587185;text-align:center;border-left:1px solid #b4cad9}
.cosmos947-day-guide button{align-self:flex-start;border-radius:99px;background:#223747;color:white;
  border:1px solid #223747;padding:9px 15px;min-height:40px;font-weight:800;cursor:pointer}
.cosmos947-day-guide small{color:#566b7a;font-size:11px}
/* The legacy empty-state card was positioned absolutely; keep it in flow so
   it cannot cover the new date-linked action or its hour guide. */
#app.metro-live .living-day-chart:has(.cosmos947-day-guide) .living-empty,
#sheet.business-modal[data-business-tab="metro"] .living-day-chart:has(.cosmos947-day-guide) .living-empty{
  position:relative!important;top:auto!important;bottom:auto!important;left:auto!important;right:auto!important;
  width:auto!important;max-width:none!important;margin:9px 14px!important;text-align:left!important;
}
#app.metro-live .living-day-chart:has(.cosmos947-day-guide),
#sheet.business-modal[data-business-tab="metro"] .living-day-chart:has(.cosmos947-day-guide){min-height:220px!important;}
@media(max-width:600px){
 .cosmos947-day-guide{margin:10px 7px 15px 40px;padding:11px}
 .cosmos947-hour-guide span{font-size:9px}
 .cosmos933-profile-dialog .cosmos933-profile-backdrop{height:35dvh!important}
}
</style>
<script id="cosmos947OwnerQuickMenuAndDailyActions">
(()=>{'use strict';
 // The original avatar click opens the photo modal. On a Metro, route the
 // first tap to the existing COSMOS menu instead; its first item opens Profile.
 document.addEventListener('click',event=>{
   const avatar=event.target.closest?.('#cosmos933-avatar-personal,#cosmos933-avatar-business');
   if(!avatar||!avatar.isConnected||window.cosmos947AllowProfileClick)return;
   const space=avatar.id.endsWith('business')?'business':'personal';
   const menu=document.querySelector('[data-cosmos-metro-more="'+space+'"]');
   if(!menu)return;
   event.preventDefault();event.stopImmediatePropagation();
   menu.click();
 },true);
 document.addEventListener('click',event=>{
   const action=event.target.closest?.('[data-cosmos947-place-date]');
   if(!action)return;
   const space=action.dataset.cosmos947PlaceDate;
   const main=action.closest('.metro-main');
   const label=main?.querySelector('.metro-day-heading h2')?.textContent||'';
   const day=new Date(label);
   if(!Number.isFinite(day.getTime()))return;
   const key=[day.getFullYear(),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0')].join('-');
   window.cosmos947TimeForDate?.(space,key);
 });
})();
</script>
'''
replace('</body>\n</html>', addon+'</body>\n</html>', 'append-v947')
result=html.encode('utf-8')
sha=hashlib.sha256(result).hexdigest()
if sha!=TARGET_SHA:raise SystemExit('ERROR: assembled HTML differs from reviewed version: '+sha)
blocks=re.findall(r'<script\b([^>]*)>([\s\S]*?)</script>',html,re.I)
for i,(attrs,js) in enumerate(blocks):
 if 'src=' in attrs or not js.strip():continue
 with tempfile.NamedTemporaryFile('w',suffix='.js',delete=False,encoding='utf-8') as f:
  f.write(js); tmp=pathlib.Path(f.name)
 try:
  p=subprocess.run(['node','--check',str(tmp)],capture_output=True,text=True)
  if p.returncode:raise SystemExit('ERROR: JavaScript block '+str(i)+' failed syntax check: '+p.stderr[:800])
 finally:tmp.unlink(missing_ok=True)
print('Validated '+str(len(changes))+' guarded edits and JavaScript syntax.')
if args.mode=='apply':
 path.write_bytes(result)
 print('Applied v9.4.7 to cosmos-next.html; new SHA256 '+sha)
else:
 print('VALIDATE ONLY: no repository files changed.')
