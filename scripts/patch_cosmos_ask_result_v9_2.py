#!/usr/bin/env python3
"""COSMOS v9.2: persistent Ask COSMOS progress and recoverable saved results.

Run from repository root. Changes only cosmos-next.html. Fails closed if expected
current Ask COSMOS anchors are absent. Never alters the Cloudflare Worker,
account rules, published questions, private records, or other timeline code.
"""
from pathlib import Path
import argparse

ROOT = Path.cwd()
TARGET = ROOT / 'cosmos-next.html'
MARK = 'COSMOS ASK RESULT DELIVERY v9.2'

OLD_MAIN = '''    $('unifiedAskSend').onclick=async()=>{
      const question=$('unifiedQuestion').value.trim();
      if(question.length<4)return toastMsg('Ask a question of at least four characters.');
      const button=$('unifiedAskSend');button.disabled=true;button.textContent='COSMOS is exploring…';
      try{
        const payload=camera?{question,origin:'camera_look',camera_observation:$('cosmosCameraObservation').value.trim().slice(0,500)}:{question};
        const result=await api('/api/unified/ask',{method:'POST',body:JSON.stringify(payload)});
        if(!result.cosmos_id)throw new Error('COSMOS did not return a saved moment ID.');
        weekMetroCacheKey='';weekMetroPopId=null;closeSheet();
        renderJourney();refreshConnections();
        toastMsg('Discovery saved privately to your Metro.');
        await openCosmos(result.cosmos_id);
      }catch(e){toastMsg(e.message||'Unable to explore.',6000);button.disabled=false;button.textContent='Explore & save privately';}
    };'''

# v9.x renders the same handlers; older v9 source differs only in spacing in some copies.
OLD_MAIN_ALT = OLD_MAIN.replace("        weekMetroCacheKey='';weekMetroPopId=null;closeSheet();\n        renderJourney();refreshConnections();",
                                "        weekMetroCacheKey='';weekMetroPopId=null;closeSheet();\n        renderJourney();refreshConnections();")

NEW_MAIN = r'''    // COSMOS ASK RESULT DELIVERY v9.2: keep the composer until the result is
    // visible; never mistake a saved moment for a successfully opened one.
    const askStatus=document.createElement('div');
    askStatus.id='cosmosAskDeliveryStatus';askStatus.hidden=true;
    askStatus.setAttribute('role','status');askStatus.setAttribute('aria-live','polite');
    askStatus.style.cssText='margin:12px 0;padding:14px 16px;border-radius:14px;border:1px solid #c9dbe6;background:#f2f8fc;color:#173b52;line-height:1.5;white-space:pre-line;font-size:14px';
    $('unifiedAskSend').closest('.actions').before(askStatus);
    $('unifiedAskSend').onclick=async()=>{
      const question=$('unifiedQuestion').value.trim();
      if(question.length<4)return toastMsg('Ask a question of at least four characters.');
      const button=$('unifiedAskSend'),back=$('unifiedAskBack');
      if(button.disabled)return;
      const cameraObservation=camera?$('cosmosCameraObservation').value.trim().slice(0,500):'';
      button.disabled=true;back.disabled=true;
      button.textContent='COSMOS is exploring…';
      askStatus.hidden=false;askStatus.style.color='#173b52';
      askStatus.textContent='Researching your question. COSMOS will open your answer here when it is ready. Your discovery stays private.';
      const started=Date.now();
      const progress=setInterval(()=>{
        if(!askStatus.isConnected)return;
        const secs=Math.floor((Date.now()-started)/1000);
        askStatus.textContent=secs>=80?'Still exploring. COSMOS may be waiting for external intelligence. Please keep this window open.':
          secs>=40?'Checking evidence and connections. This is taking longer than usual…':
          secs>=15?'Connecting the findings and preparing your private discovery…':
          'Researching your question. COSMOS will open your answer here when it is ready. Your discovery stays private.';
      },2000);
      // Bounded wait for errors: an aborted request may still have saved on the
      // server, so we never automatically retry a POST (duplicate risk).
      const controller=new AbortController();
      const expiry=setTimeout(()=>controller.abort(),135000);
      try{
        const payload=camera?{question,origin:'camera_look',camera_observation:cameraObservation}:{question};
        const result=await api('/api/unified/ask',{
          method:'POST',body:JSON.stringify(payload),signal:controller.signal
        });
        const cosmosId=String(result?.cosmos_id||'').trim();
        if(!cosmosId)throw new Error('COSMOS responded but did not confirm a saved moment. Check My timeline before trying again.');
        askStatus.textContent='Your discovery was saved privately. Opening the complete answer…';
        // Attempt to open before changing the sheet. The old flow closed the
        // sheet first and silently ignored openCosmos(false).
        weekMetroCacheKey='';weekMetroPopId=null;
        const opened=await cosmosRevealSavedAskV92(cosmosId,question);
        if(opened)toastMsg('Discovery saved privately to your Metro.',3900);
        try{renderJourney();}catch(e){console.warn('COSMOS Metro refresh:',e);}
        Promise.resolve().then(()=>refreshConnections()).catch(()=>{});
      }catch(e){
        const timeout=e?.name==='AbortError';
        if(askStatus.isConnected){
          askStatus.style.color='#803221';
          askStatus.textContent=timeout?
            'The exploration is taking too long. Your question is still here. The request may have saved a moment: check My timeline before submitting it again.':
            'The exploration did not finish: '+String(e?.message||'Unknown error')+'\nYour question is preserved. If this happened after a long wait, check My timeline before trying again.';
        }
        toastMsg(timeout?'The exploration timed out. Check your Metro before retrying.':(e?.message||'Unable to explore.'),6000);
        if(button.isConnected){button.disabled=false;button.textContent='Try exploring again';}
        if(back.isConnected)back.disabled=false;
      }finally{clearInterval(progress);clearTimeout(expiry);}
    };'''

HELPER = r'''
  // COSMOS ASK RESULT DELIVERY v9.2
  // The ONLY success condition is an answer visible in the authenticated UI.
  // A saved but temporarily unreadable answer gets a persistent recovery screen.
  async function cosmosRevealSavedAskV92(cosmosId,question){
    let normalOpened=false;
    try{
      normalOpened=await openCosmos(cosmosId);
      if(normalOpened && !sheet.hidden && Boolean(sheet.querySelector('.cosmos-studio')))return true;
    }catch(e){console.warn('COSMOS discovery open:',e);}
    // If the Metro opening endpoint fails, attempt the independently
    // authenticated private discovery GET; never make a public URL.
    let result=null,detailError='';
    try{result=await api('/api/unified/ask/'+encodeURIComponent(cosmosId));}
    catch(e){detailError=String(e?.message||'The private result is temporarily unavailable.');}
    const turns=Array.isArray(result?.turns)?result.turns:[];
    const latest=[...turns].sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0))[0];
    const sources=latest?unifiedSourcesHtml(latest):'';
    const answer=String(latest?.answer||latest?.short_answer||'').trim();
    const visible=Boolean(answer);
    openSheet(`<div style="max-width:850px;margin:auto;line-height:1.65">
      <div class="cosmos-ask-privacy">✳ YOUR DISCOVERY · ONLY ME · SAVED PRIVATELY</div>
      <h2>${escapeHtml(visible?'Your COSMOS discovery':'Your discovery was saved')}</h2>
      <h3 style="margin:12px 0;overflow-wrap:anywhere">${escapeHtml(String(latest?.question||question))}</h3>
      ${visible?`<div style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:48vh;overflow-y:auto;padding:14px;border:1px solid #d9e3e8;border-radius:12px">${escapeHtml(answer)}</div>${sources}`:
        `<p>The saved moment has not opened yet. ${escapeHtml(detailError||'The full response was not ready when COSMOS tried to display it.')} Do not submit the question again: retry opening this saved moment instead.</p>`}
      <div class="actions" style="flex-wrap:wrap"><button type="button" class="primary" id="cosmosV92RetryOpen">Open full discovery</button>
      <button type="button" id="cosmosV92BackMetro">Back to Metro</button></div>
      <p class="micro">The original question and private saved moment were preserved. Nothing was shared publicly or to Connections.</p>
    </div>`);
    $('cosmosV92RetryOpen').onclick=async()=>{
      const retry=$('cosmosV92RetryOpen');retry.disabled=true;retry.textContent='Opening saved discovery…';
      try{await cosmosRevealSavedAskV92(cosmosId,question);}
      catch(e){retry.disabled=false;retry.textContent='Try opening again';toastMsg(e.message||'Unable to open saved discovery.',6000);}
    };
    $('cosmosV92BackMetro').onclick=()=>{
      closeSheet();weekMetroCacheKey='';
      try{setMetroDay(new Date(),'day');renderJourney();}catch(e){console.warn('COSMOS Metro:',e);}
    };
    return visible;
  }
'''

OLD_FOLLOW = '''        weekMetroCacheKey='';weekMetroPopId=null;renderJourney();refreshConnections();
        toastMsg('Connected discovery saved as a new private Metro moment.');
        await openCosmos(result.cosmos_id);'''
NEW_FOLLOW = '''        weekMetroCacheKey='';weekMetroPopId=null;
        await cosmosRevealSavedAskV92(String(result.cosmos_id),question);
        try{renderJourney();}catch(e){console.warn('COSMOS Metro refresh:',e);}
        Promise.resolve().then(()=>refreshConnections()).catch(()=>{});
        toastMsg('Connected discovery saved as a new private Metro moment.');'''


def patch(src):
    if MARK in src:
        return src
    if 'COSMOS CENTRAL TIMELINE v9.0' not in src or 'COSMOS LINKEDIN SHARE v9.1' not in src:
        raise RuntimeError('Current v9.1 COSMOS application not detected. No changes made.')
    if src.count(OLD_MAIN)!=1:
        raise RuntimeError('Expected Ask COSMOS submit handler not found exactly once. No changes made.')
    if src.count(OLD_FOLLOW)!=1:
        raise RuntimeError('Expected follow-up submit handler not found exactly once. No changes made.')
    if src.count('  function showUnifiedAskComposer(seed=null){')!=1:
        raise RuntimeError('COSMOS composer anchor missing. No changes made.')
    out=src.replace('  function showUnifiedAskComposer(seed=null){',HELPER+'\n  function showUnifiedAskComposer(seed=null){',1)
    out=out.replace(OLD_MAIN,NEW_MAIN,1)
    out=out.replace(OLD_FOLLOW,NEW_FOLLOW,1)
    assert MARK in out and 'cosmosRevealSavedAskV92' in out
    return out


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--check',action='store_true',help='Validate anchors; do not write')
    args=parser.parse_args()
    if not TARGET.is_file(): raise SystemExit('Missing cosmos-next.html in repository root')
    before=TARGET.read_text(encoding='utf-8')
    after=patch(before)
    if args.check:
        print('COSMOS v9.2 CHECK PASS: '+('already applied' if after==before else 'safe patch available'))
    elif after==before:
        print('COSMOS v9.2 already applied; no changes')
    else:
        TARGET.write_text(after,encoding='utf-8')
        print('COSMOS v9.2 APPLY PASS: updated only cosmos-next.html')

if __name__=='__main__': main()
