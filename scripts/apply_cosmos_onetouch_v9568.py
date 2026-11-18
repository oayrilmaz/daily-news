#!/usr/bin/env python3
"""COSMOS v9.5.6.8 - Restore OneTouch camera and capture entry points.

Guarded reversible HTML-only update. Run from the GitHub repo root.
"""
import argparse, os, re, subprocess, tempfile
from pathlib import Path

HTML=Path('cosmos-next.html')
PAIRS=[("  recent(space){return api('/api/discovery/recent?space='+encodeURIComponent(space==='business'?'business':'personal'));},", "  // v9.5.6.8: OneTouch exposes existing camera/capture code without unmasking the legacy dashboard.\n  // Live background camera stays Personal-only. Business photo/video capture is permitted\n  // through its existing composer with a separate, user-initiated camera permission request.\n  cameraStatus(space){\n    return {available:space!=='business',active:space!=='business' &&\n      !preferWhiteMetro && app.classList.contains('cosmos-camera-live'),\n      facing:preferredCameraFacing};\n  },\n  cameraCycle(space){\n    if(space==='business')throw new Error('Live camera background is available in Personal. Use Photo or Video to capture a Business moment.');\n    return cycleMetroCamera();\n  },\n  capture(space,kind){\n    if(!['photo','video'].includes(kind))throw new Error('Choose Photo or Video.');\n    if(space==='business'){\n      businessBeginDraft();\n      return businessChooseKind(kind);\n    }\n    beginCompose();\n    return chooseContent(kind);\n  },\n  recent(space){return api('/api/discovery/recent?space='+encodeURIComponent(space==='business'?'business':'personal'));},"), ("      ['view','View selected day'],['create','Create a moment'],['now','Back to today'],['time','Travel across time']]},", "      ['view','View selected day'],['create','Create a moment'],['camera','Camera & capture'],['now','Back to today'],['time','Travel across time']]},"), ("  function dispatch(action) {\n    if (action==='now'){now();closeMenu();return;}", "  // The camera is an explicit user opt-in, never started on sign-in or page load.\n  function showCameraOptions(){\n    const groups=$('cosmosV956Groups');groups.replaceChildren();\n    $('cosmosV956Selection').textContent=(currentUniverse==='business'?'Business':'Personal')+' · Camera & capture';\n    const note=document.createElement('p');note.className='co-moment-preview';\n    note.textContent=currentUniverse==='business' ?\n      'Take a work photo or record a work video. The live Personal camera never runs behind Business.' :\n      'Open the live camera behind your timeline, or capture a photo or video moment. Camera access is requested only when you choose to use it.';\n    groups.append(note);\n    const options=document.createElement('div');options.className='co-menu-options';\n    const add=(name,handler)=>{const button=document.createElement('button');button.type='button';button.textContent=name;button.addEventListener('click',handler);options.append(button);};\n    const bridge=window.cosmosOneTouchBridgeV9563;\n    if(currentUniverse==='personal'){\n      const status=bridge?.cameraStatus?.(currentUniverse);\n      add(status?.active?'Switch camera / White view':'Open live camera',async()=>{\n        closeMenu(false);\n        try {if(!bridge?.cameraCycle)throw Error('Camera controls are not installed.');\n          await bridge.cameraCycle('personal');sync(true);\n        } catch(error){showInformation('Camera unavailable',String(error?.message||'Camera could not be opened.'));}\n      });\n    }\n    add('Take a photo',()=>startNativeFeature(()=>{\n      if(!bridge?.capture)throw Error('Photo composer unavailable.');\n      return bridge.capture(currentUniverse,'photo');\n    },'Take a photo'));\n    add('Record a video',()=>startNativeFeature(()=>{\n      if(!bridge?.capture)throw Error('Video composer unavailable.');\n      return bridge.capture(currentUniverse,'video');\n    },'Record a video'));\n    add('← Back to OneTouch',()=>{renderMenu();$('cosmosV956Close').focus();});\n    groups.append(options);\n    menu.hidden=false;menuOpen=true;ring.setAttribute('aria-expanded','true');\n    $('cosmosV956Close').focus();\n  }\n  function dispatch(action) {\n    if (action==='camera')return showCameraOptions();\n    if (action==='now'){now();closeMenu();return;}"), ("version:'9.5.6.7',reset:now", "version:'9.5.6.8',reset:now")]
OLD="version:'9.5.6.7',reset:now"
NEW="version:'9.5.6.8',reset:now"

def version(source):
    before=source.count(OLD)
    after=source.count(NEW)
    if before==1 and after==0:return 'v9.5.6.7'
    if before==0 and after==1:return 'v9.5.6.8'
    raise ValueError('Expected exactly one v9.5.6.7 or v9.5.6.8 marker. Stop: unknown frontend version.')

def transform(source,rollback=False):
    for i,(before,after) in enumerate(PAIRS,1):
        a,b=(after,before) if rollback else (before,after)
        if source.count(a)!=1:raise ValueError(f'Changed or partially updated source at guarded section {i} (matches={source.count(a)}).')
        source=source.replace(a,b,1)
    return source

def validate_js(source):
    blocks=re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>',source,re.S)
    if len(blocks)<5:raise ValueError('Script blocks missing.')
    with tempfile.TemporaryDirectory() as folder:
        for i,code in enumerate(blocks):
            if not code.strip():continue
            path=Path(folder)/f'block-{i}.js';path.write_text(code,encoding='utf-8')
            r=subprocess.run(['node','--check',str(path)],capture_output=True,text=True)
            if r.returncode:raise ValueError(f'JavaScript block {i} failed syntax check: {r.stderr[:300]}')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--mode',choices=['validate','apply','rollback'],default='validate')
    args=parser.parse_args()
    if not HTML.is_file():raise SystemExit('BLOCKED: cosmos-next.html not found. Run from repository root.')
    src=HTML.read_text(encoding='utf-8')
    try:
        old=version(src)
        if args.mode=='rollback' and old=='v9.5.6.8':dst=transform(src,True)
        elif args.mode!='rollback' and old=='v9.5.6.7':dst=transform(src)
        else:dst=src
        validate_js(dst)
        if dst!=src and transform(dst,rollback=args.mode!='rollback')!=src:raise ValueError('Patch is not reversible.')
    except ValueError as e:raise SystemExit('BLOCKED: '+str(e))
    print('PASS: Camera & capture menu; Personal-only live camera; Business capture; JS; rollback.')
    print('Current:',old,'Result:',version(dst),'Changed:',dst!=src)
    if args.mode=='validate' or dst==src:return
    tmp=HTML.with_suffix('.v9568.tmp');tmp.write_text(dst,encoding='utf-8',newline='');os.replace(tmp,HTML)
    print('UPDATED cosmos-next.html')
if __name__=='__main__':main()
