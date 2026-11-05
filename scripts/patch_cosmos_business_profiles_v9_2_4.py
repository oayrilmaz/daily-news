#!/usr/bin/env python3
"""COSMOS v9.2.4: independent Personal/Business profile presentation and centered Metro dock.

This script changes ONLY cosmos-next.html. No automatic Cloudflare/D1 operations.
Run from root of CURRENT repository checkout:
    python3 scripts/patch_cosmos_identical_metros_v9_2_3.py
    python3 scripts/patch_cosmos_business_profiles_v9_2_4.py --check
    python3 scripts/patch_cosmos_business_profiles_v9_2_4.py
"""
from pathlib import Path
import argparse, sys

ap = argparse.ArgumentParser()
ap.add_argument('--check', action='store_true')
a = ap.parse_args()
p=Path('cosmos-next.html')
if not p.is_file(): sys.exit('ERROR: cosmos-next.html not found at repository root.')
s=p.read_text(encoding='utf-8')
MARK_CSS='COSMOS BUSINESS PROFILE + CENTERED DOCK v9.2.4 CSS'
MARK_JS='COSMOS BUSINESS PROFILE + CENTERED DOCK v9.2.4 JS'
MARK_UI='COSMOS BUSINESS PROFILE + CENTERED DOCK v9.2.4 UI'
markers=[MARK_CSS,MARK_JS,MARK_UI]
if any(m in s for m in markers):
    if all(s.count(m)==1 for m in markers):
        print('PASS: v9.2.4 already installed. No changes.')
        sys.exit(0)
    sys.exit('ERROR: partially installed v9.2.4; stop before replacing anything.')
need=['id="businessSaveProfile"','id="bHeadline"','id="businessHeaderProfile"',
      'id="businessMetroCompose"','businessFrame(tab,body)',
      'function businessInitials(name)', '/api/business/me',
      'COSMOS MATCHED METRO LAYOUT v9.2.3 CSS']
miss=[n for n in need if n not in s]
if miss or s.count('</style>')!=1 or s.count('</body>')!=1:
    sys.exit('ERROR: unsupported current page; missing '+str(miss)+'. No changes.')

def replace_once(old,new):
    global s
    n=s.count(old)
    if n!=1: sys.exit('ERROR: expected one original UI anchor, found '+str(n)+': '+old[:100]+'. No changes.')
    s=s.replace(old,new,1)

replace_once('''root.innerHTML=`<div class="business-surface"><h3>My professional profile</h3><p class="business-note">Your display name and @handle come from your COSMOS identity. Only accepted Connections can see this profile in the current beta.</p>
          <div class="business-field"><label for="bHeadline">Headline</label>''', '''root.innerHTML=`<div class="business-surface"><h3>My Business profile</h3>
          <!-- COSMOS BUSINESS PROFILE + CENTERED DOCK v9.2.4 UI -->
          <p class="business-note">One COSMOS login, two independent profiles. Your Business name and @handle can differ from your Personal name and @handle. Only accepted Connections can view this Business profile in the current beta.</p>
          <div class="business-field"><label for="bBusinessName">Business display name</label><input id="bBusinessName" maxlength="60" autocomplete="organization" value="${escapeHtml(p.business_name||'')}" placeholder="Company, brand or professional name"></div>
          <div class="business-field"><label for="bBusinessHandle">Business @handle (optional)</label><input id="bBusinessHandle" maxlength="20" autocapitalize="none" autocomplete="off" spellcheck="false" value="${escapeHtml(p.business_handle||'')}" placeholder="unique_business_handle"><small>3–20 characters, starting with a letter. A separate public identifier from your Personal @handle. Leave blank to use your existing account @handle.</small></div>
          <div class="business-field"><label for="bHeadline">Headline</label>''')

replace_once('''try{await api('/api/business/me',{method:'PATCH',body:JSON.stringify({headline:$('bHeadline').value,
            company:''', '''try{const response=await api('/api/business/me',{method:'PATCH',body:JSON.stringify({
            business_name:$('bBusinessName').value.trim(),business_handle:$('bBusinessHandle').value.trim(),
            headline:$('bHeadline').value,
            company:''')
replace_once('''allow_named_visits:$('bVisitorOptIn').checked})});toastMsg('Professional profile saved.');await openBusinessHub('profile');}''', '''allow_named_visits:$('bVisitorOptIn').checked})});
            cosmosBusinessIdentityV924=response.profile||null;
            cosmosUpdateBusinessAvatarV924();
            toastMsg('Business profile saved independently of Personal.');await openBusinessHub('profile');}''')

replace_once('''  function businessFrame(tab,body){''','''  // COSMOS BUSINESS PROFILE + CENTERED DOCK v9.2.4 JS
  let cosmosBusinessIdentityV924=null;
  function cosmosUpdateBusinessAvatarV924(){
    const avatar=document.getElementById('businessHeaderProfile');
    if(!avatar)return;
    const p=cosmosBusinessIdentityV924;
    const name=p?.name||me?.display_name||me?.username||'Me';
    avatar.textContent=businessInitials(name);
    avatar.title='Business: '+name;
    avatar.setAttribute('aria-label','Business profile for '+name);
  }
  async function cosmosLoadBusinessIdentityV924(){
    if(cosmosBusinessIdentityV924){cosmosUpdateBusinessAvatarV924();return;}
    try{
      const r=await api('/api/business/me');
      if(r?.profile)cosmosBusinessIdentityV924=r.profile;
      cosmosUpdateBusinessAvatarV924();
    }catch(_){/* A temporary profile fetch failure must never block the Metro. */}
  }
  function businessFrame(tab,body){''')
replace_once('''    $('businessHeaderUniverse').onclick=showUniverseEntry;''','''    void cosmosLoadBusinessIdentityV924();
    $('businessHeaderUniverse').onclick=showUniverseEntry;''')

css='''
/* COSMOS BUSINESS PROFILE + CENTERED DOCK v9.2.4 CSS
   Both Personal and Business use viewport center; no right-side anchoring. */
#sheet.business-modal .business-metro-dock,
#app.metro-live .bottom {
  position:fixed!important;
  left:50vw!important;
  inset-inline-start:50vw!important;
  right:auto!important;
  inset-inline-end:auto!important;
  top:auto!important;
  transform:translate3d(-50%,0,0)!important;
  translate:none!important;
  margin-left:0!important;
  margin-right:0!important;
  width:max-content!important;
  max-width:calc(100vw - 24px)!important;
  bottom:calc(17px + env(safe-area-inset-bottom))!important;
  display:flex!important;
  flex-direction:column!important;
  justify-content:center!important;
  align-items:center!important;
  gap:10px!important;
  pointer-events:none!important;
  z-index:150!important;
}
#sheet.business-modal .business-metro-dock button,
#app.metro-live .bottom button {pointer-events:auto!important;}
#sheet.business-modal .business-metro-dock #businessMetroCompose,
#app.metro-live .bottom #coreOrb{
  margin-inline:auto!important;
  display:grid!important;
  place-items:center!important;
  flex:none!important;
}
#sheet.business-modal .business-metro-dock #businessMetroDockAll{
  margin-inline:auto!important;
  max-width:calc(100vw - 24px)!important;
}
#sheet.business-modal .shared-metro-engine .metro-day-scroll{
  padding-bottom:170px!important;
  -webkit-overflow-scrolling:touch;
}
'''
s=s.replace('</style>',css+'\n</style>',1)
if not all(s.count(m)==1 for m in markers):
    sys.exit('ERROR: v9.2.4 marker check failed. No changes made.')
if a.check:
    print('PASS: frontend supports separate Business profile fields and viewport-centered Metro. No changes.')
else:
    p.write_text(s,encoding='utf-8')
    print('PASS: v9.2.4 installed in cosmos-next.html only; no permissions or stored moments changed.')
