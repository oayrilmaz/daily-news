#!/usr/bin/env python3
"""COSMOS v9.0: additive client-side central-timeline bridge.

Patches the CURRENT repository's cosmos-next.html, not a stale replacement.
No changes to login/session backend, Cloudflare, private permissions or v8 publisher.
Exits nonzero if anchors no longer match. Idempotent if already installed.
"""
import argparse
import difflib
from pathlib import Path

MARKER='COSMOS CENTRAL TIMELINE v9.0'

CSS=r'''
/* COSMOS CENTRAL TIMELINE v9.0 — single identity, central Metro, public editorial moments */
.cosmos-membership-intro{font-size:13px;line-height:1.55;color:#425367;max-width:410px;margin:8px auto 16px;text-align:center}
.cosmos-public-stack{display:grid;gap:11px;margin:13px 0 20px}
.cosmos-public-card{display:grid;grid-template-columns:1fr;gap:9px;text-align:left;background:#fff;border:1px solid #dfe8eb;border-radius:17px;padding:14px;color:#27313a;box-shadow:0 3px 12px rgba(20,48,60,.035)}
.cosmos-public-card .cosmos-public-eyebrow{font-size:10px;letter-spacing:.09em;text-transform:uppercase;font-weight:780;color:#397d94}
.cosmos-public-card h3{margin:0;font-size:17px;line-height:1.32;color:#172835;overflow-wrap:anywhere}
.cosmos-public-card p{margin:0;color:#445765;font-size:13px;line-height:1.55;overflow-wrap:anywhere}
.cosmos-public-card img{max-width:100%;height:auto;max-height:210px;object-fit:contain;border-radius:10px;background:#f7fafb}
.cosmos-public-card .cosmos-public-links{display:flex;flex-wrap:wrap;gap:9px}
.cosmos-public-card a{font-size:12px;color:#176382;font-weight:700;border:1px solid #d0e0e7;border-radius:999px;padding:8px 12px;text-decoration:none;display:inline-flex;align-items:center}
.cosmos-public-card a:focus-visible{outline:3px solid #177699;outline-offset:2px}
.cosmos-public-stack .metro-zero{margin:0}
.metro-filters [data-cosmos-business-nav],.metro-filters [data-cosmos-ask-nav]{border:1px solid #bcd0d9;border-radius:100px;background:#fff;color:#2b5566;font-weight:750;padding:9px 12px;cursor:pointer}
@media(max-width:640px){.cosmos-public-card{padding:12px}.cosmos-public-card h3{font-size:15px}.metro-filters [data-cosmos-business-nav],.metro-filters [data-cosmos-ask-nav]{font-size:12px}}
'''

PUBLIC=r'''
  // COSMOS CENTRAL TIMELINE v9.0: only PUBLIC editorial records are loaded here.
  // Private records still come exclusively from the authenticated Cloudflare Worker.
  const COSMOS_PUBLIC_FEED='/data/cosmos-public-timeline.json';
  const COSMOS_PUBLIC_DIRECT_ID=/^global-[a-z0-9-]{8,120}$/.test(qs.get('public_moment')||'')?qs.get('public_moment'):'';
  let cosmosPublicMoments=[],cosmosPublicState='idle',cosmosPublicLast=0,cosmosPublicDeepLinkHandled=false;
  function cosmosSafePublicPath(raw,pattern){
    try{const u=new URL(String(raw||''),location.origin);return u.protocol==='https:' && u.origin===location.origin && !u.username && !u.password && !u.search && !u.hash && !/%2f|%5c/i.test(u.pathname) && pattern.test(u.pathname)?u.pathname:'';}
    catch{return '';}
  }
  function cosmosPublicForDay(d){
    const key=metroKeyLocal(d);
    return cosmosPublicMoments.filter(x=>metroKeyLocal(x.published_at)===key);
  }
  function cosmosRenderPublicDay(d,withHeading=true){
    const items=cosmosPublicForDay(d);
    if(!items.length){
      return metroViewFilter==='public'?`<div class="cosmos-public-stack"><div class="metro-zero">No published public intelligence moments on this date. Explore another day or use My and Connections.</div></div>`:'';
    }
    return `${withHeading?'<div class="metro-day-heading"><div class="d-text"><h2>Public intelligence</h2><p>Published, source-linked moments · read-only</p></div></div>':''}<div class="cosmos-public-stack">${items.map(x=>{
      const link=cosmosSafePublicPath(x.url,/^\/q\/trends\/global-[a-z0-9-]+\.html$/);
      const img=cosmosSafePublicPath(x.image_url,/^\/assets\/cosmos-approved-cards\/global-[a-z0-9-]+\.png$/);
      if(!link)return '';
      return `<article class="cosmos-public-card"><div class="cosmos-public-eyebrow">◎ Public · ${escapeHtml(x.category||'Intelligence')} · ${escapeHtml(new Date(x.published_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}))}</div>
      <h3>${escapeHtml(x.question)}</h3><p>${escapeHtml(x.short_answer)}</p>
      ${img?`<img src="${escapeHtml(img)}" loading="lazy" alt="COSMOS card for ${escapeHtml(x.question)}">`:''}
      <div class="cosmos-public-links"><a href="${escapeHtml(link)}">Read sources & full answer ↗</a><a href="/cosmos-next.html?public_moment=${encodeURIComponent(x.id)}">This moment in COSMOS</a></div></article>`;
    }).join('')}</div>`;
  }
  async function cosmosRefreshPublicTimeline(force=false){
    if(!token||!me||!auth.hidden||cosmosPublicState==='loading')return;
    if(!force&&cosmosPublicLast&&Date.now()-cosmosPublicLast<15*60*1000)return;
    cosmosPublicLast=Date.now();cosmosPublicState='loading';
    try{
      // PUBLIC endpoint only. Never send a bearer token or private data to this feed.
      const response=await fetch(COSMOS_PUBLIC_FEED,{cache:'no-store',credentials:'omit'});
      if(!response.ok)throw Error('Public feed unavailable');
      const data=await response.json();if(data?.public_only!==true||!Array.isArray(data.items))throw Error('Invalid public feed');
      const seen=new Set();cosmosPublicMoments=data.items.filter(x=>{
        if(!x||x.visibility!=='public'||x.type!=='cosmos_editorial_question'||!/^global-[a-z0-9-]{8,120}$/.test(x.id||'')||seen.has(x.id))return false;
        if(!cosmosSafePublicPath(x.url,/^\/q\/trends\/global-[a-z0-9-]+\.html$/))return false;
        if(!Number.isFinite(Date.parse(x.published_at))||typeof x.question!=='string'||typeof x.short_answer!=='string')return false;
        seen.add(x.id);return true;
      }).slice(0,100);
      cosmosPublicState='ready';
      if(COSMOS_PUBLIC_DIRECT_ID&&!cosmosPublicDeepLinkHandled){
        const item=cosmosPublicMoments.find(x=>x.id===COSMOS_PUBLIC_DIRECT_ID);
        if(item){cosmosPublicDeepLinkHandled=true;metroViewFilter='public';weekMetroDay=new Date(item.published_at);weekMetroDay.setHours(12,0,0,0);weekMetroCacheKey='';}
      }
    }catch(e){cosmosPublicState='error';console.warn('COSMOS public feed temporarily unavailable:',e.message);}
    finally{if(token&&me&&auth.hidden)renderWeekMetro();}
  }
'''

def replace_once(src, before, after, name):
    count=src.count(before)
    if count!=1:raise RuntimeError(f'{name}: expected 1 anchor, found {count}. No changes written.')
    return src.replace(before,after,1)


def patch(src):
    if MARKER in src:
        return src  # Already applied: safe to rerun.
    if len(src)<250_000 or 'ptdtoday-cosmos-life.ptdtoday.workers.dev' not in src:
        raise RuntimeError('Not the expected COSMOS Next application. Refusing replacement.')
    s=src
    s=replace_once(s,'</style>','\n'+CSS+'\n</style>','CSS insertion')
    s=replace_once(s,'<h2>Look deeper.</h2>','<h2>Look deeper.</h2>\n      <p class="cosmos-membership-intro">One account, one timeline. Join COSMOS to save moments, connect with people, explore public intelligence and build your professional universe.</p>','sign-in copy')
    s=replace_once(s,
      "if(button){button.textContent=currentUniverse==='business'?'◈ Business':'◈ Private';button.setAttribute('aria-label','Current universe: '+currentUniverse+'. Switch universe');}",
      "if(button){button.textContent=currentUniverse==='business'?'← Timeline':'▣ Business';button.setAttribute('aria-label',currentUniverse==='business'?'Return to central timeline':'Open Business timeline');}",
      'business toggle labels')
    old="""  function scheduleUniverseEntry(){
    if(shouldBypassUniverseEntry())return;
    // Show explicit universe choice on each normal page opening; switching stays available in the header.
    setTimeout(showUniverseEntry,250);
  }"""
    new="""  function scheduleUniverseEntry(){
    // COSMOS CENTRAL TIMELINE v9.0: login opens the timeline, not a second universe selector.
    // Existing private-moment, invite and notification deep links remain unchanged.
    return;
  }"""
    s=replace_once(s,old,new,'unified entry')
    s=replace_once(s,"  $('cosmosUniverseSwitch').addEventListener('click',showUniverseEntry);",
      "  $('cosmosUniverseSwitch').addEventListener('click',()=>enterUniverse(currentUniverse==='business'?'private':'business'));",'business button')
    s=replace_once(s,"  setEmailAuthMode('login');\n\n  let preferredCameraFacing=", "  setEmailAuthMode(qs.get('join')==='1'||qs.get('signup')==='1'?'register':'login');\n\n  let preferredCameraFacing=",'signup deep links')
    deep_ask="  // COSMOS CENTRAL TIMELINE v9.0: private same-tab Ask handoff from the homepage.\n  // Questions are NOT put into URLs, server logs, or referrers; nothing is submitted automatically.\n  const COSMOS_ASK_HANDOFF_KEY='ptdtoday_cosmos_ask_handoff_v9';\n  function cosmosReadAskHandoff(){\n    if(qs.get('ask')!=='1')return '';\n    try{\n      const draft=JSON.parse(sessionStorage.getItem(COSMOS_ASK_HANDOFF_KEY)||'null');\n      if(!draft||!Number.isFinite(draft.created_at)||Date.now()-draft.created_at>86400000||draft.created_at>Date.now()+60000)return '';\n      return String(draft.question||'').trim().slice(0,650);\n    }catch{return '';}\n  }\n  const COSMOS_ASK_DEEP_LINK=cosmosReadAskHandoff();\n  let cosmosAskDeepLinkHandled=false;\n  function maybeOpenCosmosAskDeepLink(){\n    if(cosmosAskDeepLinkHandled||COSMOS_ASK_DEEP_LINK.length<4||!token||!me||!auth.hidden||usernameRequired)return;\n    // Private invitations and notifications always take priority.\n    if(FAMILY_INVITE_CODE||pendingNoticeId||pendingSharedMoment||ARRIVED_FROM_X||OPEN_INBOX_FROM_LINK)return;\n    cosmosAskDeepLinkHandled=true;\n    setTimeout(()=>{\n      if(token&&me&&auth.hidden&&sheet.hidden&&!usernameRequired){\n        try{sessionStorage.removeItem(COSMOS_ASK_HANDOFF_KEY);}catch{}\n        const newUrl=new URL(location.href);newUrl.searchParams.delete('ask');\n        history.replaceState(null,'',newUrl.pathname+newUrl.search+newUrl.hash);\n        showUnifiedAskComposer({question:COSMOS_ASK_DEEP_LINK});\n      }else{cosmosAskDeepLinkHandled=false;}\n    },400);\n  }\n"
    s=replace_once(s,"  let metroViewFilter='all';",PUBLIC+deep_ask+"\n  let metroViewFilter='all';",'public feed + Ask bridges')
    s=replace_once(s,'Private family beta. Younger family members can explore with a parent.',
      'One COSMOS account. Email verification is required. Your private moments stay private.','account onboarding copy')
    s=replace_once(s,'journeyLabel.textContent=`${names[dimension]}${timeMode===',
      'journeyLabel.textContent=`${names[metroViewFilter]||names[dimension]}${timeMode===','active Metro filter label')
    s=replace_once(s,'    dimension="all";journeyFocus=null;journeyAt=new Date().toISOString();journeyKey="";',
      '    dimension="all";metroViewFilter="all";journeyFocus=null;journeyAt=new Date().toISOString();journeyKey="";','NOW returns to combined timeline')

    s=replace_once(s,"        renderJourney();refreshFriendsSummary();refreshNoticeBadge();\n        scheduleUniverseEntry();", "        renderJourney();refreshFriendsSummary();refreshNoticeBadge();\n        maybeOpenCosmosAskDeepLink();scheduleUniverseEntry();",'username completed then Ask')
    s=replace_once(s,"      renderJourney();refreshFriendsSummary();\n      renewSessionIfDue();", "      renderJourney();refreshFriendsSummary();maybeOpenCosmosAskDeepLink();\n      renewSessionIfDue();",'resumed session then Ask')
    s=replace_once(s,"    refreshFriendsSummary();renderJourney();\n    if(FAMILY_INVITE_CODE)", "    refreshFriendsSummary();renderJourney();maybeOpenCosmosAskDeepLink();\n    if(FAMILY_INVITE_CODE)",'new session then Ask')
    old="""    const countFor=d=>weekMetroItems.filter(i=>metroKeyLocal(i.date)===metroKeyLocal(d)&&metroFilterMatches(i));
    const week=metroWeekStationHtml(ds,chosen,countFor,'data-metro-day','Cosmos moments');
    let main=metroRenderDay(countFor(weekMetroDay));
    if(dimension==='public')main=`<div class="metro-day-heading"><div class="d-text"><h2>${escapeHtml(weekMetroDay.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}))}</h2><p>Public Cosmos</p></div></div>
      <div class="metro-zero"><strong>Public Cosmos is preparing.</strong><br>Only moderated, opt-in public stories will appear here once enabled.<br>Future surprises will remain sealed until reveal.</div>`;"""
    new="""    const privateFor=d=>weekMetroItems.filter(i=>metroKeyLocal(i.date)===metroKeyLocal(d)&&metroFilterMatches(i));
    const countFor=d=>[...privateFor(d),...(metroViewFilter==='all'||metroViewFilter==='public'?cosmosPublicForDay(d):[])];
    const week=metroWeekStationHtml(ds,chosen,countFor,'data-metro-day','Cosmos moments');
    const privateToday=privateFor(weekMetroDay),publicToday=cosmosPublicForDay(weekMetroDay);
    let main=metroViewFilter==='public'?cosmosRenderPublicDay(weekMetroDay):
      (privateToday.length||!publicToday.length?metroRenderDay(privateToday):'')+
      (metroViewFilter==='all'?cosmosRenderPublicDay(weekMetroDay):'');"""
    s=replace_once(s,old,new,'central Metro rendering')
    old="""<div class="metro-filters" role="group" aria-label="Filter Cosmos moments">${[['all','All'],['mine','My'],['connections','Connections'],['public','Public']].map(([value,label])=>`<button type="button" data-metro-filter="${value}" class="${metroViewFilter===value?'active':''}" aria-pressed="${metroViewFilter===value}">${label}${value==='public'?' · Soon':''}</button>`).join('')}</div>"""
    new="""<div class="metro-filters" role="group" aria-label="Filter Cosmos moments">${[['all','All'],['mine','My'],['connections','Connections'],['public','Public']].map(([value,label])=>`<button type="button" data-metro-filter="${value}" class="${metroViewFilter===value?'active':''}" aria-pressed="${metroViewFilter===value}">${label}</button>`).join('')}<button type="button" data-cosmos-business-nav>Business</button><button type="button" data-cosmos-ask-nav>✧ Ask COSMOS</button></div>"""
    s=replace_once(s,old,new,'timeline controls')
    old="""    journeyStage.querySelectorAll('[data-metro-filter]').forEach(btn=>btn.onclick=()=>{metroViewFilter=btn.dataset.metroFilter;renderWeekMetro();});"""
    new="""    journeyStage.querySelectorAll('[data-metro-filter]').forEach(btn=>btn.onclick=()=>{metroViewFilter=btn.dataset.metroFilter;renderWeekMetro();});
    journeyStage.querySelector('[data-cosmos-business-nav]')?.addEventListener('click',()=>enterUniverse('business'));
    journeyStage.querySelector('[data-cosmos-ask-nav]')?.addEventListener('click',()=>showUnifiedAskComposer());"""
    s=replace_once(s,old,new,'timeline actions')
    old="""    if(!weekMetroBusy && !weekMetroError)fetchMetroWeek();
  }
  // Never convert horizontal browsing"""
    new="""    if(!weekMetroBusy && !weekMetroError)fetchMetroWeek();
    if(cosmosPublicState==='idle'||(['ready','error'].includes(cosmosPublicState)&&Date.now()-cosmosPublicLast>60*60*1000))cosmosRefreshPublicTimeline();
  }
  // Never convert horizontal browsing"""
    s=replace_once(s,old,new,'public loading hook')
    s=replace_once(s,"      if(dy<0)setDimension(dimension==='connections'?'mine':'public');\n      else setDimension(dimension==='public'?'mine':'connections');",
      "      if(dy<0)metroViewFilter=metroViewFilter==='connections'?'mine':'public';\n      else metroViewFilter=metroViewFilter==='public'?'mine':'connections';\n      renderWeekMetro();",'vertical timeline swipe')
    s=replace_once(s,"    else if(e.key==='ArrowUp'){e.preventDefault();setDimension(dimension==='connections'?'mine':'public');}\n    else if(e.key==='ArrowDown'){e.preventDefault();setDimension(dimension==='public'?'mine':'connections');}",
      "    else if(e.key==='ArrowUp'){e.preventDefault();metroViewFilter=metroViewFilter==='connections'?'mine':'public';renderWeekMetro();}\n    else if(e.key==='ArrowDown'){e.preventDefault();metroViewFilter=metroViewFilter==='public'?'mine':'connections';renderWeekMetro();}",'keyboard timeline navigation')
    return s



def patch_public_distribution(src):
    """Update only the PUBLIC website template; preserve existing publisher/approved feed."""
    if 'COSMOS CENTRAL TIMELINE v9.0 JOIN LINKS' in src:
        return src  # Already applied: safe to rerun.
    if 'COSMOS v8.1' not in src or 'cosmos-public-moments.html' not in src:
        raise RuntimeError('Expected existing v8.1 public distribution generator; refusing unsafe change.')
    marker='// COSMOS CENTRAL TIMELINE v9.0 JOIN LINKS — public teaser remains indexed, participation needs account.\n'
    s=marker+src
    old='<header><a href="/cosmos.html">PTD TODAY / COSMOS</a><nav class="links"><a href="/q/trends/">Global Questions</a><a href="/cosmos.html">Explore COSMOS</a></nav></header>'
    new='<header><a href="/cosmos-next.html">PTD TODAY / COSMOS</a><nav class="links"><a href="/q/trends/">Global Questions</a><a href="/cosmos-next.html?join=1">Join COSMOS</a></nav></header>'
    s=replace_once(s,old,new,'single entry links in public page')
    old='<a class="primary" href="${h(x.url)}">Read answer ↗</a><a href="${h(intent(x))}"'
    new='<a class="primary" href="${h(x.url)}">Read answer ↗</a><a href="/cosmos-next.html?public_moment=${encodeURIComponent(x.id)}">Explore in COSMOS ↗</a><a href="${h(intent(x))}"'
    s=replace_once(s,old,new,'public moment signup CTA')
    return s

def patch_home(src):
    """Keep existing Topic Memory links; new questions enter the signed-in timeline."""
    marker='COSMOS CENTRAL TIMELINE v9.0 HOME JOIN'
    if marker in src:
        if 'cosmos-next.html?ask=1' not in src or 'cosmosJoinTimeline' not in src or 'id="askForm"' not in src:
            raise RuntimeError('Incomplete v9 homepage patch detected.')
        return src
    if '<title>Cosmos by PTD Today' not in src or 'id="askForm"' not in src:
        raise RuntimeError('Unexpected homepage version; no changes written.')
    s=src
    original='return `/cosmos.html?${params.toString()}`;'
    updated="try{sessionStorage.setItem('ptdtoday_cosmos_ask_handoff_v9',JSON.stringify({question:String(question||'').trim().slice(0,650),created_at:Date.now()}));}catch{}return '/cosmos-next.html?ask=1';"
    s=replace_once(s,original,updated,'route fresh homepage Ask to central timeline')
    styles='''
/* COSMOS CENTRAL TIMELINE v9.0 HOME JOIN */
.cosmosJoinTimeline{margin:18px auto 3px;display:flex;justify-content:center;flex-wrap:wrap;gap:9px;position:relative;z-index:4}
.cosmosJoinTimeline a{display:inline-block;text-decoration:none;border:1px solid rgba(169,196,222,.45);border-radius:999px;padding:10px 15px;color:#eff8ff;background:rgba(19,46,67,.70);font-size:12px;font-weight:750}
.cosmosJoinTimeline a:last-child{background:transparent}
.cosmosJoinTimeline a:focus-visible{outline:3px solid #70cfff;outline-offset:3px}
'''
    s=replace_once(s,'</style>',styles+'\n</style>','homepage CTA styling')
    before='<div class="hint" id="hint">Type a question or a subject. Cosmos will build the experience around you.</div>'
    after=before+'\n      <div class="cosmosJoinTimeline" id="cosmosJoinTimeline"><a href="/cosmos-next.html">Enter my timeline</a><a href="/cosmos-next.html?join=1">Create a COSMOS account</a></div>'
    s=replace_once(s,before,after,'homepage membership actions')
    return s

def patch_entry(src):
    marker='COSMOS CENTRAL TIMELINE v9.0 ENTRY ROUTE'
    if marker in src:
        if '/cosmos-next.html?ask=' not in src or 'id="askForm"' not in src:raise RuntimeError('Incomplete v9 entry patch detected.')
        return src
    if 'id="askForm"' not in src:raise RuntimeError('Unexpected legacy entry page; no changes written.')
    s=replace_once(src,'return `/cosmos.html?${params.toString()}`;',
      "try{sessionStorage.setItem('ptdtoday_cosmos_ask_handoff_v9',JSON.stringify({question:String(question||'').trim().slice(0,650),created_at:Date.now()}));}catch{}return '/cosmos-next.html?ask=1';",
      'legacy Ask routes to central identity')
    return s.replace('  <script>','  <!-- COSMOS CENTRAL TIMELINE v9.0 ENTRY ROUTE -->\n  <script>',1)

def main():
    ap=argparse.ArgumentParser(description='Safe, additive v9 patch against current GitHub files.')
    ap.add_argument('--file',default='cosmos-next.html')
    ap.add_argument('--public-distribution',default='scripts/cosmos_public_distribution_v8_1.mjs')
    ap.add_argument('--home',default='index.html')
    ap.add_argument('--entry',default='cosmos-entry-v0.1.html')
    ap.add_argument('--check',action='store_true')
    args=ap.parse_args()
    paths=[Path(args.file),Path(args.public_distribution),Path(args.home),Path(args.entry)]
    if not all(p.is_file() for p in paths):
        missing=[str(p) for p in paths if not p.is_file()]
        raise RuntimeError(f'Missing expected files: {missing}. No changes written.')
    transforms=[patch,patch_public_distribution,patch_home,patch_entry]
    originals=[p.read_text(encoding='utf-8') for p in paths]
    updated=[fn(s) for fn,s in zip(transforms,originals)]
    # All transforms succeed before ANY modification. Fail closed on changed anchors.
    if args.check:
        print('v9 CHECK PASS: all four current files matched expected secure anchors. No files modified.')
    else:
        for p,contents in zip(paths,updated):p.write_text(contents,encoding='utf-8')
        print('v9 APPLIED: central app + public discovery + root homepage + legacy entry (no private backend changes).')
    for p,a,b in zip(paths,originals,updated):
        print(f'{p}: {len(a)} → {len(b)} bytes'+(' [already patched]' if a==b else ' [updated]'))

if __name__=='__main__':main()
