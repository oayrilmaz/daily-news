#!/usr/bin/env python3
"""COSMOS v9.4.5: guarded, frontend-only unification over v9.4.4.

No Cloudflare or D1 changes. Only cosmos-next.html is edited in apply mode.
"""
import argparse
import hashlib
import pathlib
import re
import sys
import tempfile
import subprocess

SOURCE_SHA = '6d52dde9e0dae3afb483020ea11051b74778064ce5afde4bdfe9944e7689172a'
TARGET_SHA = 'd8726f986edf168544a60a8540d4112a379d689b59e806d10339c8ef2a88ee38'

# v9.4.5 keeps the public editorial validation and existing permissioned API
# boundaries. Public editorial data is adapted to the shared Metro renderer.
CSS = r'''
<style id="cosmos945UnifiedUnobstructedMetro">
/* COSMOS v9.4.5: one timeline treatment in Personal, Business and Public.
   Deliberately scoped to the timeline; no effect on Jobs, Profile or editors. */
#app.metro-live .journey-stage>.week-metro,
#sheet.business-modal[data-business-tab="metro"] .business-metro-shell>.week-metro,
#sheet.business-modal[data-business-tab="metro"] .business-metro-main-selector{
  background:transparent!important;
  background-image:none!important;
  box-shadow:none!important;
  -webkit-backdrop-filter:none!important;
  backdrop-filter:none!important;
  border-color:transparent!important;
}
#app.metro-live .journey-stage>.week-metro{top:0!important;z-index:9!important}
#sheet.business-modal[data-business-tab="metro"] .business-metro-shell>.week-metro{
  top:49px!important;z-index:24!important;
}
#sheet.business-modal[data-business-tab="metro"] .business-metro-main-selector{
  top:0!important;z-index:25!important;
}
#sheet.business-modal[data-business-tab="metro"] .sheet-inner,
#sheet.business-modal[data-business-tab="metro"] .business-shell.business-timeline-first,
#sheet.business-modal[data-business-tab="metro"] #businessBody,
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine,
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .week-metro,
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .metro-main,
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .metro-day-scroll,
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .living-day-chart{
  background:transparent!important;
  box-shadow:none!important;
  -webkit-backdrop-filter:none!important;backdrop-filter:none!important;
}
/* Don't mask the owner's wallpaper with white translucent fullscreen layers. */
#sheet.business-modal[data-business-tab="metro"].cosmos933-has-business-bg .sheet-inner{
  background:transparent!important;
  -webkit-backdrop-filter:none!important;backdrop-filter:none!important;
}
#sheet.business-modal[data-business-tab="metro"] .sheet-quickbar{
  background:rgba(255,255,255,.10)!important;
  -webkit-backdrop-filter:none!important;backdrop-filter:none!important;
}
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .living-empty,
#app.metro-live .journey-stage .living-empty{
  background:rgba(255,255,255,.74)!important;
  border:1px solid rgba(255,255,255,.8)!important;
  -webkit-backdrop-filter:none!important;backdrop-filter:none!important;
  box-shadow:0 2px 12px rgba(0,0,0,.05)!important;
  border-radius:16px!important;
  width:auto!important;max-width:min(100%,780px)!important;
  margin:10px auto!important;
  padding:12px 16px!important;
  min-height:0!important;
}
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .living-entry,
#app.metro-live .journey-stage .living-entry{
  background:rgba(255,255,255,.88)!important;
  -webkit-backdrop-filter:none!important;backdrop-filter:none!important;
  color:#243546!important;
}
/* A slim, readable strip. Full-screen reader remains available by button. */
#app.metro-live .cosmos942-discover,
#sheet.business-modal[data-business-tab="metro"] .cosmos942-discover{
  background:rgba(250,252,255,.29)!important;
  border:1px solid rgba(255,255,255,.42)!important;
  -webkit-backdrop-filter:none!important;backdrop-filter:none!important;
  box-shadow:none!important;
  padding:10px 12px!important;
  max-width:1100px!important;
}
#app.metro-live .cosmos942-discover .cosmos942-list a,
#sheet.business-modal[data-business-tab="metro"] .cosmos942-discover .cosmos942-list a{
  background:rgba(255,255,255,.91)!important;
}
/* Public editorial now lives on the same date/hour branches as authorized
   private moments. It is neither made writable nor joined to private APIs. */
#app.metro-live #metroMain .cosmos945-public-moment{
  display:block!important;cursor:auto!important;
  padding:0!important;overflow:hidden!important;
  border:1px solid rgba(214,224,232,.9)!important;
  background:rgba(255,255,255,.89)!important;
  border-radius:14px!important;
  width:100%!important;max-width:100%!important;
  box-sizing:border-box!important;
  color:#243744!important;
}
#app.metro-live #metroMain .cosmos945-public-moment>summary{
  display:flex;align-items:center;gap:10px;
  padding:11px 12px;cursor:pointer;list-style:none;
  min-height:52px;
}
#app.metro-live #metroMain .cosmos945-public-moment>summary::-webkit-details-marker{display:none}
#app.metro-live #metroMain .cosmos945-public-moment>summary::marker{content:''}
#app.metro-live #metroMain .cosmos945-public-moment .cosmos945-public-orb{
  width:36px;height:36px;min-width:36px;border-radius:50%;border:1px solid #b9cbd7;
  background:#f1f6fa;display:grid;place-items:center;font-size:15px;color:#38566e;
}
#app.metro-live #metroMain .cosmos945-public-moment .cosmos945-public-copy{
  display:grid;gap:3px;min-width:0;flex:1;
}
#app.metro-live #metroMain .cosmos945-public-moment .cosmos945-public-copy strong{
  font-size:clamp(12px,1.2vw,15px);line-height:1.35;overflow-wrap:anywhere;
}
#app.metro-live #metroMain .cosmos945-public-moment .cosmos945-public-copy small{
  font-size:10px;color:#506c80;
}
#app.metro-live #metroMain .cosmos945-public-moment .cosmos945-public-chevron{
  font-size:18px;color:#536f83;margin-left:auto;transition:transform .15s ease;
}
#app.metro-live #metroMain .cosmos945-public-moment[open] .cosmos945-public-chevron{transform:rotate(90deg)}
#app.metro-live #metroMain .cosmos945-public-details{
  padding:11px 13px 14px 57px;border-top:1px solid #dae5ed;
  font-size:13px;line-height:1.5;color:#334c61;
}
#app.metro-live #metroMain .cosmos945-public-details p{margin:0 0 10px}
#app.metro-live #metroMain .cosmos945-public-details a{
  display:inline-flex;padding:8px 11px;background:#fff;border:1px solid #bfd3df;
  border-radius:50px;color:#195b81;font-weight:750;text-decoration:none;
}
#app.metro-live #metroMain .cosmos929-public-filter{
  background:rgba(255,255,255,.76)!important;
  border:1px solid rgba(255,255,255,.9)!important;
  padding:7px 9px!important;margin:4px 0 8px!important;
  -webkit-backdrop-filter:none!important;backdrop-filter:none!important;
}
#app.metro-live #metroMain .cosmos929-question[hidden]{display:none!important}
#app.metro-live #metroMain .metro-day-scroll,
#sheet.business-modal[data-business-tab="metro"] .business-metro-shell .metro-day-scroll{
  overflow:visible!important;max-height:none!important;height:auto!important;
  -webkit-mask-image:none!important;mask-image:none!important;
  padding-bottom:calc(120px + env(safe-area-inset-bottom))!important;
}
#sheet.business-modal[data-business-tab="metro"] .sheet-inner{
  overflow-y:auto!important;-webkit-overflow-scrolling:touch!important;
  max-width:none!important;width:100%!important;
}
#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine{
  width:100%!important;max-width:1250px!important;
}
@media(max-width:650px){
 #app.metro-live .journey-stage>.week-metro{top:0!important}
 #sheet.business-modal[data-business-tab="metro"] .business-metro-shell>.week-metro{top:44px!important}
 #app.metro-live #metroMain .cosmos945-public-details{padding:10px 12px}
 #app.metro-live .cosmos942-discover,
 #sheet.business-modal[data-business-tab="metro"] .cosmos942-discover{width:calc(100% - 6px)!important;padding:8px!important}
}
</style>
'''

# Exact source snippets are anchored deliberately: source drift halts instead of
# applying to a different version of a very large app.
OLD_PUBLIC_FILTER = "const stack=stage.querySelector('.cosmos-public-stack');if(!stack)return;"
NEW_PUBLIC_FILTER = "const stack=stage.querySelector('.cosmos929-question')?.closest('.living-day-chart');if(!stack)return;"

OLD_MAIN = '''    const privateToday=privateFor(weekMetroDay),publicToday=cosmosPublicForDay(weekMetroDay);
    let main=metroViewFilter==='public'?cosmosRenderPublicDay(weekMetroDay):
      (privateToday.length||historicalFor(weekMetroDay).length||!publicToday.length?
       metroRenderDay(privateToday.concat(historicalFor(weekMetroDay))):'')+
      (metroViewFilter==='all'?cosmosRenderPublicDay(weekMetroDay):'');'''
NEW_MAIN = '''    const privateToday=privateFor(weekMetroDay),publicToday=cosmosPublicForDay(weekMetroDay);
    // Public records are validated source-linked editorial questions. Join only
    // the renderer, NOT the private data or access-control pipelines.
    const publicMetroToday=(metroViewFilter==='all'||metroViewFilter==='public')?
      publicToday.map(x=>({...x,_public_editorial:true,date:x.published_at,
        key:String(x.id),title:String(x.question),kind:'link'})):[];
    const authorizedToday=metroViewFilter==='public'?[]:
      privateToday.concat(historicalFor(weekMetroDay));
    const main=metroRenderDay(authorizedToday.concat(publicMetroToday),{day:weekMetroDay});'''

OLD_CARD_START = '''      const cards=items.map(item=>{
        const d=new Date(item.date),stamp=d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});'''
NEW_CARD_START = '''      const cards=items.map(item=>{
        const d=new Date(item.date),stamp=d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
        if(item._public_editorial){
          const link=cosmosSafePublicPath(item.url,/^\\/q\\/trends\\/global-[a-z0-9-]+\\.html$/);
          if(!link)return '';
          const regionTags=Array.isArray(item.regions)?item.regions.filter(v=>typeof v==='string'&&/^[A-Z]{2,3}$/.test(v)).slice(0,20):[];
          const cat=String(item.category||'Intelligence');
          return `<details class="living-entry cosmos945-public-moment cosmos929-question" data-cosmos929-category="${escapeHtml(cat)}" data-cosmos929-regions="${escapeHtml(regionTags.join(','))}">
            <summary aria-label="Public question, ${escapeHtml(cat)}, ${escapeHtml(stamp)}: ${escapeHtml(item.question)}. Expand for details.">
              <span class="cosmos945-public-orb" aria-hidden="true">✧</span>
              <span class="cosmos945-public-copy"><strong>${escapeHtml(item.question)}</strong><small>${escapeHtml(stamp)} · Public · ${escapeHtml(cat)}</small></span>
              <span class="cosmos945-public-chevron" aria-hidden="true">›</span>
            </summary>
            <div class="cosmos945-public-details"><p>${escapeHtml(item.short_answer||'Read the source-linked answer for details.')}</p>
              <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Read sourced answer ↗</a></div>
          </details>`;
        }'''
# Actual literal above should use JS regex without Python escapes inserted incorrectly.
NEW_CARD_START = NEW_CARD_START.replace('/^\\\\/q\\\\/trends\\\\/global-[a-z0-9-]+\\\\.html$/', '/^\\/q\\/trends\\/global-[a-z0-9-]+\\.html$/')

OLD_PUBLIC_BUSY = "if(!friend && !business && weekMetroBusy)return heading('Finding your real Cosmoses…')"
NEW_PUBLIC_BUSY = "if(!friend && !business && metroViewFilter!=='public' && weekMetroBusy)return heading('Finding your real Cosmoses…')"
OLD_PUBLIC_ERROR = "if(!friend && !business && weekMetroError)return heading('Unable to load')"
NEW_PUBLIC_ERROR = "if(!friend && !business && metroViewFilter!=='public' && weekMetroError)return heading('Unable to load')"
OLD_EMPTY = "metroViewFilter==='public'?'Public sharing is not activated yet. No public posts are shown.'"
NEW_EMPTY = "metroViewFilter==='public'?'No published public moments on this day. Select another date to explore.'"

OLD_HEADING = "heading(`${events.length} ${business?'work':'real'} moment${events.length===1?'':'s'} · swipe up or down anywhere · tap a tile`)"
NEW_HEADING = "heading(`${events.length} ${business?'work':events.some(x=>x._public_editorial)?'COSMOS':'real'} moment${events.length===1?'':'s'} · swipe up or down anywhere · tap a moment`)"


def one_replace(source, old, new, what):
    n=source.count(old)
    if n!=1:raise ValueError(f'{what}: expected exactly one source anchor; found {n}. No files changed.')
    return source.replace(old,new,1)


def build(source):
    s=source
    s=one_replace(s, OLD_MAIN, NEW_MAIN, 'shared chronological Metro')
    s=one_replace(s, OLD_CARD_START, NEW_CARD_START, 'public moment cards')
    s=one_replace(s, OLD_PUBLIC_FILTER, NEW_PUBLIC_FILTER, 'public question controls')
    s=one_replace(s, OLD_EMPTY, NEW_EMPTY, 'empty Public day message')
    s=one_replace(s, OLD_PUBLIC_BUSY, NEW_PUBLIC_BUSY, 'public rendering independent of private request')
    s=one_replace(s, OLD_PUBLIC_ERROR, NEW_PUBLIC_ERROR, 'public rendering independent of private error')
    s=one_replace(s, OLD_HEADING, NEW_HEADING, 'day heading')
    s=one_replace(s, '</body>\n</html>', CSS+'\n</body>\n</html>', 'style insertion')
    return s


def sha(s):return hashlib.sha256(s.encode('utf-8')).hexdigest()

def check_js(html):
    scripts=re.findall(r'<script([^>]*)>(.*?)</script>', html, re.S|re.I)
    for i,(attrs,body) in enumerate(scripts):
        if re.search(r'\bsrc\s*=', attrs, re.I):continue
        with tempfile.NamedTemporaryFile('w',suffix='.js',encoding='utf-8',delete=False) as f:
            f.write(body);p=pathlib.Path(f.name)
        try:
            r=subprocess.run(['node','--check',str(p)],capture_output=True,text=True)
            if r.returncode:raise ValueError(f'inline JS {i} syntax error: {r.stderr[:500]}')
        finally:p.unlink(missing_ok=True)


def main():
    a=argparse.ArgumentParser()
    a.add_argument('--mode',choices=['validate','apply'],required=True)
    a.add_argument('--file',default='cosmos-next.html')
    args=a.parse_args()
    target=pathlib.Path(args.file)
    if not target.is_file():raise SystemExit(f'Frontend not found: {target}')
    source=target.read_text(encoding='utf-8')
    digest=sha(source)
    if digest==TARGET_SHA:
        print('COSMOS v9.4.5 already installed; no changes required.')
        return
    if digest!=SOURCE_SHA:
        raise SystemExit('Guard stopped installation: current frontend differs from the known v9.4.4 source. Back up and reconcile changes before installing.')
    try:out=build(source)
    except ValueError as err:raise SystemExit(str(err))
    if sha(out)!=TARGET_SHA:raise SystemExit('Generated frontend does not match verified v9.4.5 checksum; refusing to write.')
    check_js(out)
    assert 'cosmos945-public-moment' in out and 'cosmos944TimeRailPhotoLocation' in out
    if args.mode=='apply':
        target.write_text(out,encoding='utf-8')
        print('Applied v9.4.5 to cosmos-next.html. No Worker, D1 or workflow files touched.')
    else:print('Validation passed: guarded v9.4.4 to v9.4.5 patch, JS syntax and content checksum. No files changed.')

if __name__=='__main__': main()
