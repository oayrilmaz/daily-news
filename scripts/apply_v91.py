#!/usr/bin/env python3
"""COSMOS v9.1: clean entry + consent-based LinkedIn drafts.

Applies only to the CURRENT GitHub files. Backs up the original homepage,
never modifies private Worker auth/permissions, and refuses unknown anchors.
"""
import argparse
import json
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent
ROOT = Path.cwd()
MARKER = 'COSMOS ENTRY v9.1'
PATCH_MARKER = 'COSMOS LINKEDIN SHARE v9.1'

PRIVATE_SHARE = r'''
  // COSMOS LINKEDIN SHARE v9.1 — this never changes a private moment's audience.
  // A public LinkedIn post is a separate, explicit user action. No private permalink is included.
  function cosmosLinkedInHashtags(question){
    const q=String(question||'').toLowerCase();
    const tags=['#COSMOS','#ExploreTheConnections'];
    const keywords=[[/\bdata\s?center|datacenter\b/,'#DataCenters'],[/\bgrid|high voltage|\bhv\b/,'#PowerGrid'],
      [/\bartificial intelligence\b|\bai\b/,'#AI'],[/\bproject\b/,'#ProjectManagement'],
      [/\benergy|renewable\b/,'#Energy'],[/\bbusiness|market\b/,'#Business'],
      [/\belection|midterm\b/,'#Elections'],[/\btechnology\b/,'#Technology'],
      [/\bclimate\b/,'#Climate'],[/\bscience\b/,'#Science']];
    keywords.forEach(([re,t])=>{if(re.test(q)&&tags.length<6)tags.push(t);});
    return tags.join(' ');
  }
  function cosmosSocialExcerpt(t){
    const raw=String(t?.short_answer||t?.answer||'').replace(/\s+/g,' ').trim();
    if(raw.length<=470)return raw;
    const prefix=raw.slice(0,460);const cut=prefix.lastIndexOf('. ');
    return (cut>150?prefix.slice(0,cut+1):prefix.trim())+'…';
  }
  function cosmosSocialDraft(item,discovery){
    const turns=Array.isArray(discovery?.turns)?discovery.turns:[];
    const latest=[...turns].sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0))[0]||{};
    const question=String(latest.question||item.content_text||'A discovery').replace(/\s+/g,' ').trim().slice(0,340);
    const answer=cosmosSocialExcerpt(latest);
    const hashtags=cosmosLinkedInHashtags(question);
    return ['A question I explored through COSMOS:',question,answer,'What connections do you see?',hashtags].filter(Boolean).join('\n\n');
  }
  async function cosmosCopySocialText(content){
    let done=false;
    try{await navigator.clipboard.writeText(content);done=true;}
    catch{const t=document.createElement('textarea');t.value=content;t.style.cssText='position:fixed;left:-9999px;top:0';
      document.body.appendChild(t);t.select();done=document.execCommand('copy');t.remove();}
    toastMsg(done?'LinkedIn caption and hashtags copied. Paste them into a new LinkedIn post.':'Copy unavailable. Select the text manually.',4800);
  }
  function cosmosOpenDiscoveryShare(item,discovery){
    const url=privateMomentUrl(item.id);
    const draft=cosmosSocialDraft(item,discovery);
    openSheet(`<h2>Share this discovery</h2>
      <p class="cosmos-share-intro"><strong>🔒 Only me — PRIVATE</strong>. Your COSMOS discovery is not a public article. Its original link only works for authorized COSMOS accounts; posting that link on LinkedIn will not make it public.</p>
      <div class="cosmos-maps"><strong>Share privately inside COSMOS</strong><p class="micro">This does not grant anyone new access.</p>
        <button type="button" id="v91CopyPrivate" class="cosmos-share-pill">Copy private COSMOS link</button></div>
      <div class="cosmos-maps" style="margin-top:13px"><strong>Prepare a separate public LinkedIn post</strong>
        <p class="micro">Only the previewed text below will be copied. No private links, attachments, profile details or sealed content are included. Your original COSMOS remains PRIVATE.</p>
        <textarea id="v91LinkedInDraft" readonly rows="8" style="display:block;width:100%;min-height:150px;border:1px solid #d9e2e8;border-radius:12px;padding:12px;background:white;color:#243544;white-space:pre-wrap">${escapeHtml(draft)}</textarea>
        <label style="display:flex;align-items:flex-start;gap:9px;font-size:12px;margin:12px 0;color:#384b5a"><input type="checkbox" id="v91SocialConsent" style="width:20px;height:20px;flex:none">I choose to share this preview text publicly outside COSMOS. I understand others may copy it.</label>
        <div class="cosmos-share-actions"><button type="button" class="primary" id="v91CopyLinkedIn" disabled>Copy post + hashtags</button>
        <button type="button" id="v91OpenLinkedIn" disabled>Open LinkedIn ↗</button></div>
        <p class="micro">LinkedIn cannot reliably prefill the caption from an external link. Copy the post first, then paste it into LinkedIn. No automatic posting occurs.</p></div>
      <div class="cosmos-share-actions"><button type="button" id="v91ReturnDiscovery">← Back to discovery</button></div>`);
    sheet.classList.add('liquid-compact-step');
    $('v91CopyPrivate').onclick=()=>copyCosmosShareUrl(url);
    $('v91SocialConsent').onchange=()=>{$('v91CopyLinkedIn').disabled=!$('v91SocialConsent').checked;$('v91OpenLinkedIn').disabled=!$('v91SocialConsent').checked;};
    $('v91CopyLinkedIn').onclick=()=>cosmosCopySocialText($('v91LinkedInDraft').value);
    $('v91OpenLinkedIn').onclick=()=>window.open('https://www.linkedin.com/feed/','_blank','noopener,noreferrer');
    $('v91ReturnDiscovery').onclick=()=>openCosmos(item.id);
  }
'''

PUBLIC_BUTTON_OLD = 'aria-label="Share this COSMOS moment on X">Share on X ↗</a>'
PUBLIC_BUTTON_NEW = r'''aria-label="Share this COSMOS moment on X">Share on X ↗</a><button type="button" class="linkedin-copy" data-li-title="${h(x.question)}" data-li-answer="${h(x.short_answer)}" data-li-url="${h(x.url)}" data-li-category="${h(x.category)}">Copy LinkedIn post + hashtags</button><a href="${h('https://www.linkedin.com/sharing/share-offsite/?url='+encodeURIComponent(x.url))}" target="_blank" rel="noopener noreferrer">Open LinkedIn ↗</a>'''
PUBLIC_LISTENER = r'''
// COSMOS LINKEDIN SHARE v9.1: user-initiated copy. Never posts automatically.
function cosmosLinkedInText(b){
 const category=String(b.dataset.liCategory||'').toLowerCase();
 const tag={technology:'#Technology',business:'#Business',science:'#Science',entertainment:'#Entertainment',sports:'#Sports',world:'#WorldNews',lifestyle:'#Lifestyle',transport:'#Transport'}[category]||'#Discoveries';
 return [String(b.dataset.liTitle||''),String(b.dataset.liAnswer||''),'Explore the sources: '+String(b.dataset.liUrl||''),['#COSMOS','#PTDToday',tag].join(' ')].filter(Boolean).join('\n\n');
}
async function cosmosSocialCopy(t){try{await navigator.clipboard.writeText(t);return true}catch{let f=document.createElement('textarea');f.value=t;f.style.cssText='position:fixed;left:-9999px';document.body.appendChild(f);f.select();let ok=document.execCommand('copy');f.remove();return ok}}
document.querySelectorAll('.linkedin-copy').forEach(b=>b.addEventListener('click',async()=>{
 const ok=await cosmosSocialCopy(cosmosLinkedInText(b));
 b.textContent=ok?'Copied — paste into LinkedIn':'Copy failed — try again';
}));
'''


def replace_one(s, old, new, desc):
    n=s.count(old)
    if n!=1: raise RuntimeError(f'{desc}: expected one insertion anchor, found {n}. Nothing written.')
    return s.replace(old,new,1)


def patch_app(s):
    if PATCH_MARKER in s:return s
    if 'COSMOS CENTRAL TIMELINE v9.0' not in s or 'This is a private access-controlled link' not in s:
        raise RuntimeError('Current COSMOS Next does not match v9 secure sharing anchors.')
    s=replace_one(s,'  function shareMomentPart(item,part=\'\'){',PRIVATE_SHARE+'\n  function shareMomentPart(item,part=\'\'){','insert disclosure and social draft')
    s=replace_one(s,"      $('cosmosStoryShare').onclick=()=>shareMomentPart(item);",
                  "      $('cosmosStoryShare').onclick=()=>cosmosOpenDiscoveryShare(item,unifiedDiscovery);",'wire Discovery share (private link preserved)')
    # The original COSMOS sphere remains available INSIDE timeline options, not on the entry page.
    s=replace_one(s,
       '<button type="button" data-cosmos-ask-nav>✧ Ask COSMOS</button></div>',
       '<button type="button" data-cosmos-ask-nav>✧ Ask COSMOS</button><a class="cosmos-origins-nav" href="/cosmos-original-home.html" title="Original COSMOS and saved journeys">◯ Origins</a></div>',
       'keep original COSMOS in timeline options')
    s=replace_one(s,'</style>',
       '.metro-filters .cosmos-origins-nav{display:inline-flex;align-items:center;border:1px solid #bcd0d9;border-radius:100px;background:#fff;color:#2b5566;font-weight:750;padding:9px 12px;text-decoration:none;font-size:12px}</style>',
       'Origin timeline option style')
    return s


def patch_public(s):
    if PATCH_MARKER in s:return s
    if 'COSMOS v8.1' not in s or PUBLIC_BUTTON_OLD not in s:raise RuntimeError('Public distribution template unexpectedly changed.')
    s=replace_one(s,PUBLIC_BUTTON_OLD,PUBLIC_BUTTON_NEW,'LinkedIn action in public cards')
    s=replace_one(s,'</style></head><body>',
                  '.actions button{font-size:13px;font-weight:700;border:1px solid #c6dce6;border-radius:999px;padding:9px 14px;background:#fff;color:#21576b;cursor:pointer}</style></head><body>',
                  'public action styles')
    s=replace_one(s,'</script></body></html>`;',PUBLIC_LISTENER+'</script></body></html>`;','LinkedIn copy listener')
    return '// '+PATCH_MARKER+'\n'+s


def patch_publisher(s):
    if PATCH_MARKER in s:return s
    if 'COSMOS v8' not in s and '<meta property="og:title" content="${esc(rec.question)}">' not in s:
        raise RuntimeError('Publisher does not match v8 record template.')
    s=replace_one(s,'<meta property="og:title" content="${esc(rec.question)}">',
       '<meta property="og:type" content="article"><meta property="og:url" content="${esc(rec.url)}"><meta property="og:title" content="${esc(rec.question)}">',
       'canonical LinkedIn Open Graph metadata')
    return '// '+PATCH_MARKER+'\n'+s


def html_og(existing, row):
    if '<meta property="og:url"' in existing:return existing
    if '<meta property="og:title"' not in existing:raise RuntimeError('Published page is missing expected og:title; refusing risky change.')
    url=str(row['url'])
    return existing.replace('<meta property="og:title"',
       f'<meta property="og:type" content="article"><meta property="og:url" content="{url}"><meta property="og:title"',1)


def upgrade_existing_og():
    file=ROOT/'data/cosmos-approved-moments.json'
    if not file.exists():return {}
    data=json.loads(file.read_text()); changes={}
    for rec in data.get('items',[])[:100]:
      if not isinstance(rec,dict) or rec.get('publication_status')!='published':continue
      url=str(rec.get('url',''))
      m=re.fullmatch(r'https://ptdtoday\.com(/q/trends/global-[a-z0-9-]+\.html)',url)
      if not m:continue
      p=ROOT/m.group(1).lstrip('/')
      if not p.is_file():continue
      s=p.read_text();updated=html_og(s,rec)
      if updated!=s:changes[str(p.relative_to(ROOT))]=updated
    return changes


def run(check=False):
    source=ROOT/'index.html';backup=ROOT/'cosmos-original-home.html'
    app=ROOT/'cosmos-next.html';dist=ROOT/'scripts/cosmos_public_distribution_v8_1.mjs';publisher=ROOT/'scripts/cosmos_autonomous_publish_v7_4.mjs'
    if not all(x.is_file() for x in [source,app,dist,publisher]):
       raise RuntimeError('Missing a required current v8/v9 repository file. No changes written.')
    home=source.read_text()
    if MARKER in home: newhome=home
    else:
       if 'COSMOS CENTRAL TIMELINE v9.0 HOME JOIN' not in home or '<title>Cosmos by PTD Today' not in home:
          raise RuntimeError('Expected current v9 homepage is missing; refusing to replace unrecognized home.')
       newhome=(BASE/'home_v91.html').read_text()
    if not backup.is_file() and MARKER in home:
       raise RuntimeError('v9.1 homepage exists but its original backup is missing; do not overwrite.')
    changes={}
    if home!=newhome:changes['index.html']=newhome
    if not backup.is_file() and MARKER not in home:changes['cosmos-original-home.html']=home
    for p,fn in [(app,patch_app),(dist,patch_public),(publisher,patch_publisher)]:
       old=p.read_text();new=fn(old)
       if new!=old:changes[str(p.relative_to(ROOT))]=new
    changes.update(upgrade_existing_og())
    member_feed=ROOT/'data/cosmos-member-public-moments.json'
    if not member_feed.exists():
       changes['data/cosmos-member-public-moments.json']=json.dumps({'version':'9.1.0','public_only':True,'items':[]},indent=2)+'\n'
    for rel,text in changes.items():
       if '..' in Path(rel).parts:raise RuntimeError('Unexpected file path')
    if not check:
      for rel,body in changes.items():
       target=ROOT/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(body)
      manifest=ROOT/'artifacts/cosmos-v9_1/changed-paths.txt';manifest.parent.mkdir(parents=True,exist_ok=True)
      manifest.write_text('\n'.join(sorted(changes))+'\n')
    print(('CHECK' if check else 'APPLY')+' PASS: '+str(len(changes))+' safe changes')
    for item in sorted(changes):print('  '+item)
    return changes


if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('--check',action='store_true')
    args=ap.parse_args();run(check=args.check)
