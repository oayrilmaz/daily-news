#!/usr/bin/env python3
"""COSMOS v9.2.9 source-level checks; no network, tokens or private data."""
import sys,subprocess,tempfile,pathlib
from html.parser import HTMLParser
class HTMLAudit(HTMLParser):
    def __init__(self):super().__init__();self.scripts=[];self.script_on=False;self.scriptbuf=[];self.counts={}
    def handle_starttag(self,tag,attrs):
        if tag=='script':
            a=dict(attrs)
            if 'src' not in a:self.script_on=True;self.scriptbuf=[]
        if tag=='a':
            a=dict(attrs)
            self.counts[a.get('href','')]=self.counts.get(a.get('href',''),0)+1
    def handle_data(self,data):
        if self.script_on:self.scriptbuf.append(data)
    def handle_endtag(self,tag):
        if tag=='script' and self.script_on:self.scripts.append(''.join(self.scriptbuf));self.script_on=False
p=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'cosmos-next.html')
s=p.read_text(encoding='utf-8')
checks={
 'build_marker':'cosmos-next-v9.2.9-source-corrected',
 'separate_profile_media':'cosmos929MountPhotos',
 'personal_market_link':'/cosmos-market-personal.html',
 'business_market_link':'/cosmos-market-business.html',
 'work_archive':'cosmos929ShowRecentWork',
 'work_to_metro':'if(tab===\'feed\')tab=\'metro\'',
 'automatic_resume_match':'Automatically start internal-first matching',
 'compact_public_source':'cosmos-public-card cosmos929-question',
 'public_archive':'cosmos929OpenQuestionArchive',
 'historical_origins':'cosmos929-origin-orb',
 'full_width_business':'#sheet.business-modal .business-metro-shell',
}
for label,token in checks.items():
 if token not in s:raise SystemExit(f'FAIL missing {label}: {token}')
if 'data-cosmos-patch="v928"' in s:raise SystemExit('FAIL old v928 external assets must not be loaded together')
if s.count('id="cosmos929RecentWork"')>1:raise SystemExit('FAIL duplicate recent work IDs')
a=HTMLAudit();a.feed(s)
if len(a.scripts)<4:raise SystemExit(f'FAIL expected ≥4 inline scripts, found {len(a.scripts)}')
with tempfile.TemporaryDirectory() as td:
 for i,script in enumerate(a.scripts):
  f=pathlib.Path(td)/f'script_{i}.js';f.write_text(script,encoding='utf-8')
  r=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
  if r.returncode:raise SystemExit('FAIL JavaScript script '+str(i)+'\n'+r.stderr)
print(f'PASS: {len(a.scripts)} JavaScript blocks, {len(checks)} source assertions, private backend unchanged.')
