#!/usr/bin/env python3
"""COSMOS Jobs v9.3.2 exact-base, guarded frontend installer.
This does NOT modify Cloudflare Workers, D1, R2, existing data, auth or marketplaces.
"""
import base64,hashlib,os,subprocess,sys,tempfile,zlib
from pathlib import Path
from html.parser import HTMLParser
MODE=sys.argv[1] if len(sys.argv)>1 else 'validate'
if MODE not in ('validate','apply'):raise SystemExit('Use validate or apply.')
BASE='eb021d96e4c436d31d0b74148eb70fb5dd3a0ccc7e169f9a5b2ae11b04bf202f'
TARGET='964e144b1c81b069d6b7434e807ff3d56e792c23d16892a916acaf05bd86ae49'
PAYLOAD='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'
path=Path('cosmos-next.html')
if not path.is_file():raise SystemExit('Missing cosmos-next.html in repository root.')
existing=path.read_bytes()
digest=hashlib.sha256(existing).hexdigest()
if digest==TARGET:
 print('ALREADY APPLIED: source is v9.3.2. Nothing to change.');raise SystemExit(0)
if digest!=BASE:
 raise SystemExit('BLOCKED: cosmos-next.html differs from v9.3.1 starting file. Nothing changed. Current SHA256: '+digest)
class InlineScripts(HTMLParser):
 def __init__(self):super().__init__();self.active=False;self.scripts=[]
 def handle_starttag(self,tag,attrs):
  if tag=='script' and not dict(attrs).get('src'):self.active=True;self.current=''
 def handle_data(self,data):
  if self.active:self.current+=data
 def handle_endtag(self,tag):
  if tag=='script' and self.active:self.scripts.append(self.current);self.active=False
with tempfile.TemporaryDirectory() as tmp:
 dir=Path(tmp);(dir/'cosmos-next.html').write_bytes(existing)
 patchfile=dir/'fix.patch';patchfile.write_bytes(zlib.decompress(base64.b64decode(PAYLOAD)))
 run=subprocess.run(['patch','-p1','--batch','--forward','-i',str(patchfile)],cwd=dir,capture_output=True,text=True)
 if run.returncode:raise SystemExit('Patch failed. No source modified. '+run.stderr[:1400])
 result=(dir/'cosmos-next.html').read_bytes()
 if hashlib.sha256(result).hexdigest()!=TARGET:raise SystemExit('Target checksum mismatch. No changes made.')
 html=result.decode('utf-8')
 for marker in ['id="jobsResumeUpload"','jobsProviderStatus','/api/business/jobs/discover','cosmos929-origin-orb','source_employer']:
  if marker not in html:raise SystemExit('Required UI marker missing: '+marker)
 parser=InlineScripts();parser.feed(html)
 if len(parser.scripts)!=4:raise SystemExit('Unexpected inline script structure. No files changed.')
 for i,source in enumerate(parser.scripts):
  f=dir/f'inline{i}.js';f.write_text(source)
  check=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
  if check.returncode:raise SystemExit(f'JavaScript {i} failed: '+check.stderr[:900])
 print('PASS: exact base, checksum, preserved COSMOS UI, all four inline JavaScript syntax checks')
 if MODE=='apply':
  temp=path.with_name('.cosmos-next.v932.tmp');temp.write_bytes(result);os.replace(temp,path)
  print('APPLIED: v9.3.2 frontend updated.')
 else:print('VALIDATE ONLY: did not modify cosmos-next.html.')
