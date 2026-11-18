#!/usr/bin/env python3
"""COSMOS v9.5.6.7: preserve textarea focus during periodic OneTouch sync.

Run from the repository root. Guarded patch; no Worker or D1 changes.
"""
import argparse
import os
import re
import subprocess
import tempfile
from pathlib import Path

FILE=Path('cosmos-next.html')
BEFORE_CLOSE="  function closeMenu() {\n    menuOpen = false;\n    menu.hidden = true;\n    ring.setAttribute('aria-expanded', 'false');\n    lastFocus?.focus?.();\n  }"
AFTER_CLOSE="  function closeMenu(restoreFocus = true) {\n    // v9.5.6.7: This function is called by the periodic OneTouch sync even\n    // while a native textarea is active. Never steal keyboard focus unless\n    // the menu was actually open and the user is deliberately closing it.\n    if (!menuOpen) return;\n    menuOpen = false;\n    menu.hidden = true;\n    ring.setAttribute('aria-expanded', 'false');\n    const previous = lastFocus;\n    lastFocus = null;\n    if (restoreFocus && previous?.isConnected && typeof previous.focus === 'function') {\n      previous.focus({preventScroll:true});\n    }\n  }"
BEFORE_START="function startNativeFeature(run,label='COSMOS'){\n  closeMenu();nativeFeature=true;nativeFeaturePending=true;featureRequest++;"
AFTER_START="function startNativeFeature(run,label='COSMOS'){\n  // The destination composer owns the keyboard; do not refocus the old menu.\n  closeMenu(false);nativeFeature=true;nativeFeaturePending=true;featureRequest++;"
BEFORE_VERSION="version:'9.5.6.6',reset:now"
AFTER_VERSION="version:'9.5.6.7',reset:now"
PAIRS=[(BEFORE_CLOSE,AFTER_CLOSE),(BEFORE_START,AFTER_START),(BEFORE_VERSION,AFTER_VERSION)]

def state(source):
    before=BEFORE_VERSION in source
    after=AFTER_VERSION in source
    if before == after:
        raise ValueError('Expected exactly one v9.5.6.6 or v9.5.6.7 marker; do not patch an unknown version.')
    return 'v9.5.6.6' if before else 'v9.5.6.7'

def apply_pairs(source,reverse=False):
    for n,(before,after) in enumerate(PAIRS,1):
        a,b=(after,before) if reverse else (before,after)
        if source.count(a)!=1:
            raise ValueError('Source is modified or partially patched at guarded section %d (matches %d).'%(n,source.count(a)))
        source=source.replace(a,b,1)
    return source

def js_syntax(source):
    scripts=re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>',source,re.S)
    if len(scripts)<5:raise ValueError('Missing application script blocks.')
    with tempfile.TemporaryDirectory() as tmp:
        for index,body in enumerate(scripts):
            if not body.strip():continue
            p=Path(tmp)/('script-%d.js'%index);p.write_text(body,encoding='utf-8')
            proc=subprocess.run(['node','--check',str(p)],text=True,capture_output=True)
            if proc.returncode:
                raise ValueError('JavaScript syntax failed in block %d: %s'%(index,proc.stderr[:600]))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--mode',choices=['validate','apply','rollback'],default='validate')
    args=parser.parse_args()
    if not FILE.is_file():raise SystemExit('BLOCKED: Run from repository root (cosmos-next.html missing).')
    src=FILE.read_text(encoding='utf-8')
    try:
        current=state(src)
        if current=='v9.5.6.6' and args.mode!='rollback':
            dst=apply_pairs(src)
            if apply_pairs(dst,reverse=True)!=src:raise ValueError('Patch/rollback roundtrip mismatch.')
        elif current=='v9.5.6.7' and args.mode=='rollback':
            dst=apply_pairs(src,reverse=True)
            if apply_pairs(dst)!=src:raise ValueError('Rollback/patch roundtrip mismatch.')
        else:dst=src
        js_syntax(dst)
    except ValueError as e:raise SystemExit('BLOCKED: '+str(e))
    print('PASS: OneTouch textarea focus guard, syntax, and reversible patch.')
    print('Current:',current,'Result:',state(dst),'Changed:',src!=dst)
    if args.mode=='validate' or src==dst:return
    temporary=FILE.with_suffix('.v9567.tmp')
    temporary.write_text(dst,encoding='utf-8',newline='')
    os.replace(temporary,FILE)
    print('UPDATED cosmos-next.html')

if __name__=='__main__':main()
