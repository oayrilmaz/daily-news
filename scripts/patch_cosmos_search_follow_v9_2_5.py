#!/usr/bin/env python3
"""COSMOS v9.2.5 — add opt-in directory UI to current v9.2.4 application.
Idempotent, fail-closed; changes only cosmos-next.html. Run after v9.2.4.
"""
from pathlib import Path
import sys, argparse
DIRECTORY_JS_V925 = r'''
  // COSMOS PROFILE DIRECTORY v9.2.5 — independent, opt-in search/follow per universe.
  // This UI never attempts to read private timelines or protected Business posts.
  function cosmosDirectoryViewV925(kind='personal',mode='search'){
    const u=kind==='business'?'business':'personal';
    openSheet(`<section class="cosmos-directory-v925" aria-label="COSMOS profile directory">
      <div class="actions"><button type="button" id="dirV925Back">← ${u==='business'?'Business':'Personal'} timeline</button></div>
      <h2>${u==='business'?'Business':'Personal'} COSMOS · People</h2>
      <p class="micro">Find members who chose to be discoverable. Following never grants private or Connections-only access.</p>
      <div class="actions"><button type="button" id="dirV925Search">Search</button><button type="button" id="dirV925Following">Following</button><button type="button" id="dirV925Settings">My privacy settings</button></div>
      <div id="dirV925Content" aria-live="polite"></div>
    </section>`);
    const root=$('dirV925Content');
    $('dirV925Back').onclick=()=>u==='business'?openBusinessHub('metro'):closeSheet();
    $('dirV925Search').onclick=()=>cosmosDirectoryContentV925(u,'search',root);
    $('dirV925Following').onclick=()=>cosmosDirectoryContentV925(u,'following',root);
    $('dirV925Settings').onclick=()=>cosmosDirectoryContentV925(u,'settings',root);
    void cosmosDirectoryContentV925(u,mode,root);
  }
  window.cosmosOpenDirectoryV925=cosmosDirectoryViewV925;
  function cosmosDirectoryCardsV925(items,u,root){
    if(!items.length){root.innerHTML='<p class="micro">No matching discoverable profiles. Try another name or @handle.</p>';return;}
    root.innerHTML=items.map(p=>`<div class="cosmos-directory-card-v925">
      <strong>${escapeHtml(p.name||('@'+p.handle))}</strong>
      <div class="micro">@${escapeHtml(p.handle||'')}</div>
      ${u==='business'&&p.headline?`<p>${escapeHtml(p.headline)}</p>`:''}
      ${u==='business'&&p.company?`<div class="micro">${escapeHtml(p.company)}</div>`:''}
      <div class="actions"><button type="button" data-dir-preview="${escapeHtml(p.user_id)}">View profile</button>
      ${p.allow_followers?`<button type="button" data-dir-follow="${escapeHtml(p.user_id)}" data-following="${p.following?'1':'0'}" class="primary">${p.following?'Following ✓':'Follow +'}</button>`:'<span class="micro">Not accepting followers</span>'}</div></div>`).join('');
    root.querySelectorAll('[data-dir-preview]').forEach(b=>b.onclick=()=>void cosmosDirectoryProfileV925(u,b.dataset.dirPreview));
    root.querySelectorAll('[data-dir-follow]').forEach(b=>b.onclick=async()=>{
      b.disabled=true;
      try{
        const next=b.dataset.following!=='1';
        await api('/api/directory/follow?universe='+u,{method:next?'POST':'DELETE',body:JSON.stringify({user_id:b.dataset.dirFollow})});
        b.dataset.following=next?'1':'0';b.textContent=next?'Following ✓':'Follow +';
        toastMsg(next?'Following public updates.':'Unfollowed.');
      }catch(e){toastMsg(e.message,5000);}finally{b.disabled=false;}
    });
  }
  async function cosmosDirectoryProfileV925(u,id){
    try{
      const r=await api('/api/directory/profile/'+encodeURIComponent(id)+'?universe='+u);
      const p=r.profile;
      openSheet(`<div class="cosmos-directory-v925"><h2>${escapeHtml(p.name||('@'+p.handle))}</h2>
        <p>@${escapeHtml(p.handle)}</p>
        ${u==='business'?`<p>${escapeHtml(p.headline||'')}</p><p>${escapeHtml(p.company||'')}</p>`:''}
        <p class="micro">This is a discoverable profile preview, not a private timeline. Following does not create a Connection.</p>
        <div class="actions"><button id="dirV925ProfileBack">Back to search</button>
        ${p.allow_followers?`<button class="primary" id="dirV925ProfileFollow">${p.following?'Unfollow':'Follow'}</button>`:''}</div></div>`);
      $('dirV925ProfileBack').onclick=()=>cosmosDirectoryViewV925(u,'search');
      const follow=$('dirV925ProfileFollow');if(follow)follow.onclick=async()=>{
        follow.disabled=true;
        try{await api('/api/directory/follow?universe='+u,{method:p.following?'DELETE':'POST',body:JSON.stringify({user_id:id})});
          toastMsg(p.following?'Unfollowed.':'Following public updates.');cosmosDirectoryViewV925(u,'following');
        }catch(e){toastMsg(e.message,4500);follow.disabled=false;}
      };
    }catch(e){toastMsg(e.message,5000);}
  }
  async function cosmosDirectoryContentV925(u,mode,root){
    if(!root?.isConnected)return;
    if(mode==='settings'){
      root.innerHTML='<p>Loading privacy settings…</p>';
      try{
        const r=await api('/api/directory/settings?universe='+u);if(!root.isConnected)return;
        root.innerHTML=`<div class="cosmos-directory-card-v925"><h3>${u==='business'?'Business':'Personal'} visibility</h3>
          <label><input type="checkbox" id="dirV925Discoverable" ${r.discoverable?'checked':''}> Appear in signed-in member search</label>
          <label><input type="checkbox" id="dirV925AllowFollow" ${r.allow_followers?'checked':''}> Allow people to follow this profile</label>
          <p class="micro">Off by default. If enabled, members can search your display name and @handle${u==='business'?', and see your professional headline and company':''}. Your email, location, private posts and Connections-only moments remain hidden.</p>
          <p class="micro">Followers: ${Number(r.followers||0)}. Switching either option off removes existing followers.</p>
          ${u==='business'?'<p class="micro">Save a separate Business name and @handle in your Business profile first.</p>':''}
          <div class="actions"><button class="primary" type="button" id="dirV925Save">Save discovery settings</button></div>
        </div>`;
        $('dirV925Discoverable').onchange=()=>{if(!$('dirV925Discoverable').checked)$('dirV925AllowFollow').checked=false;};
        $('dirV925Save').onclick=async()=>{
          const button=$('dirV925Save');button.disabled=true;
          const discoverable=$('dirV925Discoverable').checked,allow_followers=$('dirV925AllowFollow').checked;
          if((!discoverable||!allow_followers)&&r.followers>0&& !confirm('Disable discovery/following and remove existing followers?')){button.disabled=false;return;}
          try{await api('/api/directory/settings?universe='+u,{method:'PATCH',body:JSON.stringify({discoverable,allow_followers})});
            toastMsg('Your '+u+' search and follow preferences are saved.');
            await cosmosDirectoryContentV925(u,'settings',root);
          }catch(e){toastMsg(e.message,5000);button.disabled=false;}
        };
      }catch(e){root.textContent='Settings unavailable: '+e.message;}
      return;
    }
    if(mode==='following'){
      root.textContent='Loading followed profiles…';
      try{const r=await api('/api/directory/following?universe='+u);if(root.isConnected)cosmosDirectoryCardsV925(r.following||[],u,root);}
      catch(e){if(root.isConnected)root.textContent='Following unavailable: '+e.message;}
      return;
    }
    root.innerHTML=`<div class="field"><label for="dirV925Query">Search ${u==='business'?'Business':'Personal'} profiles</label>
      <input id="dirV925Query" type="search" maxlength="60" placeholder="Name or @handle" autocomplete="off"></div>
      <div class="actions"><button type="button" class="primary" id="dirV925Go">Search profiles</button></div>
      <div id="dirV925Results" aria-live="polite"><p class="micro">Enter at least 3 characters to find opted-in profiles.</p></div>`;
    const search=async()=>{
      const q=$('dirV925Query').value.trim(),zone=$('dirV925Results');
      if(q.replace(/^@/,'').length<3){zone.textContent='Enter at least 3 characters.';return;}
      zone.textContent='Searching…';
      try{const r=await api('/api/directory/search?universe='+u+'&q='+encodeURIComponent(q));
        if(zone.isConnected)cosmosDirectoryCardsV925(r.results||[],u,zone);
      }catch(e){if(zone.isConnected)zone.textContent='Search unavailable: '+e.message;}
    };
    $('dirV925Go').onclick=search;
    $('dirV925Query').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();void search();}};
  }

'''
ap=argparse.ArgumentParser();ap.add_argument('--check',action='store_true');a=ap.parse_args()
p=Path('cosmos-next.html');s=p.read_text(encoding='utf-8')
marker='COSMOS PROFILE DIRECTORY v9.2.5'
if marker in s:
    if s.count(marker)==1 and s.count('COSMOS PROFILE DIRECTORY v9.2.5 CSS')==0 and 'id="businessDirectoryV925"' in s:
        print('PASS: v9.2.5 already installed');sys.exit(0)
    sys.exit('ERROR: partial v9.2.5 markers; refusing changes')
for m in ['COSMOS BUSINESS PROFILE + CENTERED DOCK v9.2.4 JS',
          'COSMOS MATCHED METRO LAYOUT v9.2.3 JS','function openBusinessHub(',
          'accountButton.addEventListener("click",()=>{','id="bVisitorOptIn"',
          'function businessFrame(tab,body)']:
    if m not in s:sys.exit('ERROR: expected current source anchor missing: '+m)

def repl(old,new):
    global s
    if s.count(old)!=1:sys.exit('ERROR: expected one match ('+str(s.count(old))+'): '+old[:100])
    s=s.replace(old,new,1)
# Make the Business profile privacy description precise: only the limited opt-in
# directory preview is visible to non-connections; full profile remains protected.
repl('Only accepted Connections can view this Business profile in the current beta.',
     'Full Business profiles remain for accepted Connections. You can separately opt into a limited, searchable preview for signed-in COSMOS members.')
# Add one entry point directly to each profile's existing settings view.
repl('<label class="business-check"><input type="checkbox" id="bVisitorOptIn"',
     '<div class="business-actions"><button type="button" id="businessDirectoryV925">Search visibility & followers</button></div>\n          <label class="business-check"><input type="checkbox" id="bVisitorOptIn"')
repl("        $('businessSaveProfile').onclick=async()=>{",
     "        $('businessDirectoryV925').onclick=()=>cosmosDirectoryViewV925('business','settings');\n        $('businessSaveProfile').onclick=async()=>{")
repl('<div class="actions"><button id="openNotifications" class="primary">Notifications</button>',
     '<div class="actions"><button type="button" id="personalDirectoryV925">Search people & follower settings</button></div><div class="actions"><button id="openNotifications" class="primary">Notifications</button>')
repl('    $("openNotifications").onclick=showCosmosNotifications;',
     '    $("personalDirectoryV925").onclick=()=>cosmosDirectoryViewV925("personal","search");\n    $("openNotifications").onclick=showCosmosNotifications;')
# Business directory search from Connections list as well.
repl("        root.querySelectorAll('[data-business-person]').forEach(b=>b.onclick=()=>openBusinessPerson(b.dataset.businessPerson));",
     "        root.insertAdjacentHTML('afterbegin','<div class=\"business-actions\"><button type=\"button\" id=\"businessSearchV925\">Search Business profiles</button></div>');\n        $('businessSearchV925').onclick=()=>cosmosDirectoryViewV925('business','search');\n        root.querySelectorAll('[data-business-person]').forEach(b=>b.onclick=()=>openBusinessPerson(b.dataset.businessPerson));")
# Add a lightweight searchable directory in the main application's existing scope.
repl('  accountButton.addEventListener("click",()=>{',
     DIRECTORY_JS_V925+'\n  accountButton.addEventListener("click",()=>{')
# The v9.2.3 More menu is its own script and can delegate into main scope.
repl("['origins','Origins · Original COSMOS'],",
     "['origins','Origins · Original COSMOS'],['directory','Search Personal people'],")
repl("['feed','Work feed'],['profile','Business profile'],['visitors','Profile visitors'],",
     "['feed','Work feed'],['profile','Business profile'],['visitors','Profile visitors'],['directory','Search Business people'],")
repl('    const name=item.dataset.cosmosMenuAction;\n    close();',
     "    const name=item.dataset.cosmosMenuAction;\n    close();\n    if(name==='directory'){window.cosmosOpenDirectoryV925?.(overlay.dataset.cosmosUniverseV925||'personal','search');return;}")
repl("    lastOrigin=origin;\n    document.getElementById('cosmosMetroMoreTitleV923').textContent=",
     "    lastOrigin=origin;overlay.dataset.cosmosUniverseV925=kind;\n    document.getElementById('cosmosMetroMoreTitleV923').textContent=")
css='''
/* COSMOS SEARCH FOLLOW v9.2.5: isolated directory elements only. */
.cosmos-directory-v925{padding:8px 4px 36px;max-width:780px;margin:auto}
.cosmos-directory-v925 .actions{display:flex;gap:9px;flex-wrap:wrap;margin:14px 0}
.cosmos-directory-v925 input[type=search]{width:100%;padding:13px;border:1px solid #bfcbd5;border-radius:12px;font-size:16px}
.cosmos-directory-v925 input[type=checkbox]{width:21px;height:21px;vertical-align:middle;margin-right:8px}
.cosmos-directory-v925 label{display:block;padding:12px 0}
.cosmos-directory-card-v925{padding:16px;margin:12px 0;background:#fff;border:1px solid #dae3eb;border-radius:16px}
.cosmos-directory-card-v925 .micro{overflow-wrap:anywhere}
'''
repl('</style>',css+'\n</style>')
if s.count(marker)!=1 or s.count('id="businessDirectoryV925"')!=1 or s.count('id="personalDirectoryV925"')!=1:
    sys.exit('ERROR: final v9.2.5 anchor verification failed')
if a.check:print('PASS: v9.2.5 compatible; no files changed')
else:p.write_text(s,encoding='utf-8');print('PASS: v9.2.5 integrated; only cosmos-next.html changed')
