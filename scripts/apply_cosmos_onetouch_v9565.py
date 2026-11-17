#!/usr/bin/env python3
"""COSMOS v9.5.6.5 guarded OneTouch feature-popup repair.
Run from repo root with --mode validate|apply|rollback.
This only modifies cosmos-next.html. No authentication, Worker, R2 or D1 edits.
"""
import argparse,base64,gzip,os,subprocess,tempfile,re
from pathlib import Path
SOURCE=Path('cosmos-next.html')
PATCH_GZ_B64='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'
BASE_MARKERS=("version:'9.5.6.4'",'v9.5.6.4: OneTouch is the only default UI',
 'co-feature-dismiss','co-station-icon','cosmos953LegalStatusNeeded')
NEW_MARKERS=("version:'9.5.6.5'",'v9.5.6.5: actual feature dialogs appear above OneTouch',
 'function activeExternalFeature()','function openEmbeddedPage(name,path)','function closeEmbeddedPage()')

def state(content):
    matched=[mark in content for mark in NEW_MARKERS]
    if any(matched) and not all(matched):
        raise ValueError('Partial v9.5.6.5 installation detected. Stop and inspect your current frontend.')
    return 'installed' if all(matched) else 'baseline'

def syntax(content):
    scripts=re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>',content,re.S)
    if len(scripts)<5:raise ValueError('Missing application JavaScript scripts.')
    for i,js in enumerate(scripts):
        if not js.strip():continue
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/('s%d.js'%i);p.write_text(js,encoding='utf8')
            check=subprocess.run(['node','--check',str(p)],capture_output=True,text=True)
            if check.returncode:raise ValueError('JavaScript syntax error in script '+str(i)+': '+check.stderr[:700])

def change(content,reverse=False):
    with tempfile.TemporaryDirectory() as tmp:
        folder=Path(tmp)
        (folder/'cosmos-next.html').write_text(content,encoding='utf8',newline='')
        f=folder/'change.patch';f.write_bytes(gzip.decompress(base64.b64decode(PATCH_GZ_B64)))
        cmd=['patch','--batch','--silent','--fuzz=0','-p0','-i',str(f)]
        if reverse:cmd.insert(1,'--reverse')
        res=subprocess.run(cmd,cwd=folder,capture_output=True,text=True)
        if res.returncode:
            raise ValueError('Patch does not match deployed code; do not force it. '+(res.stdout+res.stderr)[:500])
        return (folder/'cosmos-next.html').read_text(encoding='utf8')

def main():
    arg=argparse.ArgumentParser();arg.add_argument('--mode',choices=['validate','apply','rollback'],default='validate')
    mode=arg.parse_args().mode
    if not SOURCE.is_file():raise SystemExit('Run from repository root with cosmos-next.html present.')
    original=SOURCE.read_text(encoding='utf8')
    try:
        installed=state(original)=='installed'
        if not installed and not all(x in original for x in BASE_MARKERS):
            raise ValueError('Expected COSMOS v9.5.6.4 markers are not present. Please check deployment order.')
        if mode=='rollback':updated=change(original,True) if installed else original
        else:
            updated=original if installed else change(original)
            if state(updated)!='installed':raise ValueError('Updated v9.5.6.5 markers missing.')
        syntax(updated)
        if not installed and mode!='rollback' and change(updated,True)!=original:
            raise ValueError('Apply/rollback roundtrip mismatch.')
        if installed and mode=='rollback' and change(updated)!=original:
            raise ValueError('Rollback/apply roundtrip mismatch.')
    except ValueError as e:raise SystemExit('BLOCKED — '+str(e))
    print('PASS — v9.5.6.5 guarded patch, JS syntax, idempotence and rollback checks')
    print('Changed:',updated!=original,'Installed:',state(updated)=='installed')
    if mode=='validate' or updated==original:return
    staged=SOURCE.with_suffix('.v9565.tmp')
    staged.write_text(updated,encoding='utf8',newline='')
    os.replace(staged,SOURCE)
    print('UPDATED cosmos-next.html (frontend only).')
if __name__=='__main__':main()
