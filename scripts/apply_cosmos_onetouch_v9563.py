#!/usr/bin/env python3
"""Guarded COSMOS v9.5.6.3 OneTouch month + real stations update.

Only edits cosmos-next.html. The patch is compressed and embedded so installation
requires TWO new repository files, not a replacement Cloudflare Worker or D1 SQL.

Run: python3 scripts/apply_cosmos_onetouch_v9563.py --mode validate|apply|rollback
"""
import argparse,base64,gzip,os,subprocess,tempfile
from pathlib import Path

SOURCE=Path('cosmos-next.html')
PATCH_GZ_B64='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'
REQUIRED_BASE=('v9.5.6.2: gesture navigation','v9.5.6.2: prevent the legacy Business',
               'cosmos953LegalStatusNeeded','cosmosOneTouchV956')
REQUIRED_NEW=('cosmosOneTouchBridgeV9563','v9.5.6.3: a small month compass',
              'co-stations-layer',"version:'9.5.6.3'")

def code_present(content):
    found=[mark in content for mark in REQUIRED_NEW]
    if any(found) and not all(found):raise ValueError('Partial v9.5.6.3 update: do not modify manually.')
    return all(found)

def syntax(content):
    fragments=[]
    for marker in ['<script>\n(() => {','<script id="cosmos-v956-js">']:
        start=content.find(marker)
        if start<0:raise ValueError('Expected application script missing: '+marker)
        end=content.find('</script>',start)
        if end<0:raise ValueError('Unclosed script')
        fragments.append(content[start+(len('<script>') if marker.startswith('<script>\n') else len(marker)):end])
    for i,source in enumerate(fragments):
        with tempfile.TemporaryDirectory() as folder:
            file=Path(folder)/('script_%d.js'%i);file.write_text(source,encoding='utf8')
            output=subprocess.run(['node','--check',str(file)],capture_output=True,text=True)
            if output.returncode:raise ValueError('JavaScript syntax check failed: '+output.stderr[:750])

def patch_content(original,reverse=False):
    with tempfile.TemporaryDirectory() as folder:
        folder=Path(folder)
        (folder/'cosmos-next.html').write_text(original,encoding='utf8',newline='')
        patch_file=folder/'change.patch'
        patch_file.write_bytes(gzip.decompress(base64.b64decode(PATCH_GZ_B64)))
        cmd=['patch','--silent','--batch','--fuzz=0','-p0','-i',str(patch_file)]
        if reverse:cmd.insert(1,'--reverse')
        run=subprocess.run(cmd,cwd=folder,capture_output=True,text=True)
        if run.returncode:
            raise ValueError('Patch does not match current frontend. Re-check that v9.5.6.2 is deployed. '+(run.stdout+run.stderr)[:650])
        return (folder/'cosmos-next.html').read_text(encoding='utf8')

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--mode',choices=['validate','apply','rollback'],default='validate')
    mode=p.parse_args().mode
    if not SOURCE.is_file():raise SystemExit('Run from repository root, where cosmos-next.html is located.')
    initial=SOURCE.read_text(encoding='utf8')
    try:
        if not all(x in initial for x in REQUIRED_BASE):
            raise ValueError('Expected v9.5.6.2 + legal frontend markers missing. Do not overwrite.')
        installed=code_present(initial)
        if mode=='rollback':
            final=patch_content(initial,True) if installed else initial
            if installed and code_present(final):raise ValueError('Rollback did not remove v9.5.6.3 markers.')
        else:
            final=initial if installed else patch_content(initial)
            if not code_present(final):raise ValueError('Upgrade markers missing after applying patch.')
        syntax(final)
        if not installed and mode!='rollback':
            restored=patch_content(final,True)
            if restored!=initial:raise ValueError('Rollback roundtrip did not match input.')
        if installed and mode=='rollback':
            if patch_content(final)!=initial:raise ValueError('Rollback reapply did not match input.')
    except ValueError as error:raise SystemExit('BLOCKED — '+str(error))
    print('PASS — v9.5.6.3 guarded update, JavaScript syntax and roundtrip validation.')
    print('New real-week stations installed:',code_present(final))
    if mode=='validate':return
    if final==initial:
        print('No change necessary.');return
    temporary=SOURCE.with_suffix('.v9563.tmp')
    temporary.write_text(final,encoding='utf8',newline='')
    os.replace(temporary,SOURCE)
    print('UPDATED cosmos-next.html. No Worker or D1 changes.')

if __name__=='__main__':main()
