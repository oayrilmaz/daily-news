#!/usr/bin/env python3
"""COSMOS v9.5.6.6: repair OneTouch moment creation and opaque Business editor.
Works only on exact v9.5.6.5 anchors; does not modify Cloudflare, D1 or secrets.
Run in the repository root: python scripts/apply_cosmos_onetouch_v9566.py --mode validate|apply|rollback
"""
from pathlib import Path
import argparse, os, subprocess, tempfile, re
SOURCE=Path('cosmos-next.html')
CSS = "/* COSMOS v9.5.6.6 — Solid, keyboard-ready OneTouch feature composer.\n   The owner's Business wallpaper belongs to the timeline, not inside an editor. */\nhtml.cosmos-v956-feature-popup #app > #sheet.business-modal,\nhtml.cosmos-v956-feature-popup #app > #sheet.business-modal.cosmos933-has-business-bg {\n  background:#f8fafc!important;background-image:none!important;\n}\nhtml.cosmos-v956-feature-popup #app > #sheet.business-modal .sheet-inner,\nhtml.cosmos-v956-feature-popup #app > #sheet.business-modal.cosmos933-has-business-bg .sheet-inner,\nhtml.cosmos-v956-feature-popup #app > #sheet.business-modal .sheet-quickbar {\n  background:#f8fafc!important;background-image:none!important;\n}\nhtml.cosmos-v956-feature-popup #app > #sheet.business-modal .sheet-inner {\n  overflow-y:auto!important;overflow-x:hidden!important;\n  overscroll-behavior-y:contain!important;-webkit-overflow-scrolling:touch!important;\n  touch-action:pan-y!important;\n}\nhtml.cosmos-v956-feature-popup #app > #sheet.business-modal input,\nhtml.cosmos-v956-feature-popup #app > #sheet.business-modal select,\nhtml.cosmos-v956-feature-popup #app > #sheet.business-modal textarea,\nhtml.cosmos-v956-feature-popup #app > #sheet.business-modal #bizMomentText {\n  box-sizing:border-box!important;max-width:100%!important;\n  background:#fff!important;background-image:none!important;\n  opacity:1!important;color:#1d3041!important;caret-color:#1d3041!important;\n  pointer-events:auto!important;-webkit-user-select:text!important;user-select:text!important;\n}\nhtml.cosmos-v956-feature-popup #app > #sheet.business-modal #bizMomentText {\n  display:block!important;width:100%!important;min-height:145px!important;\n  padding:14px!important;border:1px solid #bacbd9!important;\n  border-radius:14px!important;font-size:16px!important;line-height:1.5!important;\n  resize:vertical!important;\n}\nhtml.cosmos-v956-feature-popup #app > #sheet.business-modal #bizMomentText:focus {\n  outline:2px solid #5a93b5!important;outline-offset:1px!important;\n}"
REPLACEMENTS = [("  compose(space){\n    if(space==='business')return businessBeginDraft();\n    return $('coreOrb')?.click();\n  },", "  compose(space){\n    // coreOrb has pointerdown/pointerup handlers, not a click handler.\n    // Invoke the existing private composer directly; do not fake a click.\n    if(space==='business')return businessBeginDraft();\n    return beginCompose();\n  },"), ("  function businessMode() {\n    return sheet.classList.contains('business-modal') && (sheet.dataset.businessTab === 'metro' || !!sheet.querySelector('.business-metro-shell'));\n  }", '  function businessMode() {\n    // A stale data-business-tab="metro" persists while Business creates a moment.\n    // Only an actual Metro shell is the background; editors are foreground sheets.\n    return !sheet.hidden && sheet.classList.contains(\'business-modal\') &&\n      !!sheet.querySelector(\'.business-metro-shell\');\n  }'), ("function nativeFeatureVisible(){return (!sheet.hidden && (!businessMode() || sheet.dataset.businessTab!=='metro')) || isVisible($('panel')) || !!activeExternalFeature();}", "function nativeFeatureVisible(){return (!sheet.hidden && !businessMode()) || isVisible($('panel')) || !!activeExternalFeature();}"), ("version:'9.5.6.5',reset:now", "version:'9.5.6.6',reset:now")]
BASE_MARKERS=("version:'9.5.6.5'",'function nativeFeatureVisible(){return (!sheet.hidden',"return $('coreOrb')?.click();")
NEW_MARKERS=("version:'9.5.6.6'",'COSMOS v9.5.6.6 — Solid, keyboard-ready OneTouch feature composer.', 'return beginCompose();')
def status(src):
    old="version:'9.5.6.5'" in src
    new="version:'9.5.6.6'" in src
    if old==new:raise ValueError('Expected exactly one COSMOS v9.5.6.5 / v9.5.6.6 marker; stop rather than guessing.')
    return 'baseline' if old else 'installed'
def transform(src, reverse=False):
    pairs=[(after,before) if reverse else (before,after) for before,after in REPLACEMENTS]
    pairs.append(('\n'+CSS+'\n</style><!-- /cosmos-v956-css -->','</style><!-- /cosmos-v956-css -->') if reverse else
                 ('</style><!-- /cosmos-v956-css -->','\n'+CSS+'\n</style><!-- /cosmos-v956-css -->'))
    for i,(before,after) in enumerate(pairs):
        if src.count(before)!=1:
            raise ValueError('Unexpected frontend or partial installation at guarded replacement %d (matches %d).'%(i+1,src.count(before)))
        src=src.replace(before,after,1)
    return src
def check_js(src):
    scripts=re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>',src,re.S)
    if len(scripts)<5:raise ValueError('Expected COSMOS script blocks missing.')
    with tempfile.TemporaryDirectory() as td:
        for i,js in enumerate(scripts):
            if not js.strip():continue
            p=Path(td)/('script-%d.js'%i);p.write_text(js,encoding='utf-8')
            r=subprocess.run(['node','--check',str(p)],capture_output=True,text=True)
            if r.returncode:raise ValueError('JavaScript syntax failed in script %d: %s'%(i,r.stderr[:600]))
def main():
    p=argparse.ArgumentParser()
    p.add_argument('--mode',choices=('validate','apply','rollback'),default='validate')
    args=p.parse_args()
    if not SOURCE.is_file():raise SystemExit('BLOCKED: cosmos-next.html not found. Run from repository root.')
    src=SOURCE.read_text(encoding='utf-8')
    try:
        state=status(src)
        if state=='baseline' and not all(m in src for m in BASE_MARKERS):
            raise ValueError('v9.5.6.5 prerequisites missing.')
        if state=='installed' and not all(m in src for m in NEW_MARKERS):
            raise ValueError('Incomplete v9.5.6.6 installation; investigate before proceeding.')
        if args.mode=='rollback':target=transform(src,True) if state=='installed' else src
        else:target=transform(src) if state=='baseline' else src
        check_js(target)
        if state=='baseline' and args.mode!='rollback' and transform(target,True)!=src:
            raise ValueError('Apply/rollback roundtrip mismatch.')
        if state=='installed' and args.mode=='rollback' and transform(target)!=src:
            raise ValueError('Rollback/apply roundtrip mismatch.')
    except ValueError as error:raise SystemExit('BLOCKED — '+str(error))
    print('PASS: COSMOS v9.5.6.6 guarded transforms, JS syntax and rollback verification')
    print('Current:',state,'Result:',status(target),'File change:',target!=src)
    if args.mode=='validate' or target==src:return
    tmp=SOURCE.with_suffix('.v9566.tmp');tmp.write_text(target,encoding='utf-8',newline='');os.replace(tmp,SOURCE)
    print('UPDATED cosmos-next.html (frontend only).')
if __name__=='__main__':main()
