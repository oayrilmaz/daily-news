#!/usr/bin/env python3
"""COSMOS v9.3.5: safely make Business Metro transparent like Personal.
Does not change Cloudflare, authentication, jobs, private moments or D1.
"""
import hashlib, os, subprocess, sys, tempfile
from pathlib import Path
MODE=sys.argv[1] if len(sys.argv)>1 else 'validate'
if MODE not in ('validate','apply'):
    raise SystemExit('Usage: python scripts/apply_cosmos_business_metro_v935.py validate|apply')
BEFORE='e025f462b814404a82115199f0a743ef2eabea758afc6c3f4914cd836cd40213'
AFTER='1848feef2e81fb1db7f554cb5a0a66aa326de09b6fb21d3b6938f737b313dade'
STYLE='\n/* COSMOS v9.3.5 — Business Metro transparent like Personal.\n   Important: scoped to the TIMELINE only. Job search, profile, media\n   viewer, editor, and full-screen Business background stay independent. */\n#sheet.business-modal[data-business-tab="metro"]{\n  background:transparent!important;background-image:none!important;\n  border:0!important;box-shadow:none!important;\n}\n/* Restore the owner\'s selected Business wallpaper without letting the\n   v9.3.3 cover image leak into other Business tabs. */\n#sheet.business-modal[data-business-tab="metro"].cosmos933-has-business-bg{\n  background-image:var(--cosmos933-business-bg)!important;\n  background-position:center center!important;\n  background-size:cover!important;background-repeat:no-repeat!important;\n}\n#sheet.business-modal[data-business-tab="metro"] .sheet-inner,\n#sheet.business-modal[data-business-tab="metro"] .business-shell.business-timeline-first,\n#sheet.business-modal[data-business-tab="metro"] #businessBody,\n#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine,\n#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .week-metro,\n#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .metro-main,\n#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .metro-day-scroll,\n#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .living-day-chart,\n#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .metro-day-heading{\n  background:transparent!important;background-image:none!important;\n  box-shadow:none!important;\n}\n#sheet.business-modal[data-business-tab="metro"] .sheet-quickbar{\n  background:rgba(255,255,255,.22)!important;\n  -webkit-backdrop-filter:none!important;backdrop-filter:none!important;\n  border-color:rgba(255,255,255,.25)!important;\n}\n/* Live-camera or owner\'s photo remains visible, with a readable compact\n   heading and small glassy empty-state only; no full-height white surface. */\n#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .metro-day-heading{\n  border-radius:12px;padding:6px 9px!important;\n  text-shadow:0 1px 4px rgba(255,255,255,.9)!important;\n}\n#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .living-empty{\n  background:rgba(255,255,255,.64)!important;\n  border:1px solid rgba(255,255,255,.70)!important;\n  border-radius:18px!important;\n  padding:15px!important;\n  color:#263744!important;\n  -webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);\n}\n#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .living-entry{\n  background:rgba(255,255,255,.88)!important;\n  border:1px solid rgba(255,255,255,.85)!important;\n}\n#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .metro-week-note,\n#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .metro-day-heading h2,\n#sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .metro-day-heading p{\n  text-shadow:0 1px 4px rgba(255,255,255,.95)!important;\n}\n/* Avoid the blur and dim backdrop placed behind a standard modal sheet. */\n#sheetBackdrop:has(+ #sheet.business-modal[data-business-tab="metro"]){\n  background:transparent!important;\n  -webkit-backdrop-filter:none!important;backdrop-filter:none!important;\n  pointer-events:none!important;\n}\n@media(max-width:650px){\n #sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .living-empty{\n   left:5%!important;right:5%!important;padding:12px!important;\n }\n #sheet.business-modal[data-business-tab="metro"] .shared-metro-engine .metro-day-heading{\n   padding:6px!important;\n }\n}\n'
p=Path('cosmos-next.html')
if not p.is_file():
    raise SystemExit('SAFE STOP: GitHub cosmos-next.html not found at repository root.')
original=p.read_text(encoding='utf-8')
digest=hashlib.sha256(original.encode('utf-8')).hexdigest()
if digest==AFTER:
    print('Already installed: COSMOS v9.3.5 Business Metro fix. No changes.')
    raise SystemExit(0)
if digest!=BEFORE:
    raise SystemExit('SAFE STOP: Unexpected frontend SHA256: '+digest+'; expected v9.3.4. No files changed.')
if original.count('</style>')!=1 or 'COSMOS v9.3.5' in original:
    raise SystemExit('SAFE STOP: cannot safely locate the original CSS boundary.')
updated=original.replace('</style>', STYLE+'\n</style>',1)
if hashlib.sha256(updated.encode('utf-8')).hexdigest()!=AFTER:
    raise SystemExit('SAFE STOP: output checksum did not match expected v9.3.5.')
for marker in ['cosmos934CleanCanvasJpeg','cosmos933-has-business-bg',
               'business-metro-shell','/api/business/jobs/discover',
               '/api/identity-media/','cosmos929-origin-orb','COSMOS v9.3.5']:
    if marker not in updated:raise SystemExit('SAFE STOP: preserved feature missing: '+marker)
from html.parser import HTMLParser
class InlineScripts(HTMLParser):
    def __init__(self): super().__init__(); self.active=False;self.buf='';self.scripts=[]
    def handle_starttag(self,tag,attrs):
        if tag=='script' and not dict(attrs).get('src'):self.active=True;self.buf=''
    def handle_data(self,data):
        if self.active:self.buf+=data
    def handle_endtag(self,tag):
        if tag=='script' and self.active:self.scripts.append(self.buf);self.active=False
parser=InlineScripts();parser.feed(updated)
if len(parser.scripts)!=4:raise SystemExit('SAFE STOP: expected four inline JavaScript blocks.')
with tempfile.TemporaryDirectory() as tmp:
    for i,script in enumerate(parser.scripts):
        f=Path(tmp)/('inline'+str(i)+'.js');f.write_text(script,encoding='utf-8')
        test=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
        if test.returncode:raise SystemExit('SAFE STOP: JS syntax failure: '+test.stderr[:800])
print('PASS: exact v9.3.4 source; four JS scripts; scoped Metro CSS; all known modules.')
if MODE=='apply':
    temp=p.with_name('.cosmos-next-v935.tmp')
    temp.write_text(updated,encoding='utf-8')
    os.replace(temp,p)
    print('APPLIED: only cosmos-next.html changed; no Worker or D1 changes.')
else:
    print('VALIDATE mode only: no files changed.')
