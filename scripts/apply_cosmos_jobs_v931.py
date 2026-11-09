#!/usr/bin/env python3
"""COSMOS Jobs v9.3.1 guarded frontend correction. Use in GitHub Actions.
Does NOT touch D1, Cloudflare Worker, authentication, personal moments, or marketplaces.
"""
from pathlib import Path
from html.parser import HTMLParser
import base64,hashlib,zlib,subprocess,tempfile,os,sys
MODE=sys.argv[1] if len(sys.argv)>1 else 'validate'
if MODE not in ('validate','apply'):raise SystemExit('Choose validate or apply.')
BASE='122e4e499bdddc61dfe5298b3392bc1bab52897c5d844b508878ab814dd82896'
TARGET='eb021d96e4c436d31d0b74148eb70fb5dd3a0ccc7e169f9a5b2ae11b04bf202f'
PAYLOAD='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'
path=Path('cosmos-next.html')
if not path.is_file():raise SystemExit('Missing cosmos-next.html; run from repository root.')
original=path.read_bytes();sha=hashlib.sha256(original).hexdigest()
if sha==TARGET:
 print('ALREADY APPLIED: v9.3.1. No changes needed.');raise SystemExit(0)
if sha!=BASE:
 raise SystemExit('BLOCKED: existing cosmos-next.html differs from exact v9.3.0 base. No files changed. Current SHA: '+sha)
patch_bytes=zlib.decompress(base64.b64decode(PAYLOAD))
class Scripts(HTMLParser):
 def __init__(self):super().__init__();self.script=False;self.chunks=[];self.parts=[]
 def handle_starttag(self,tag,attrs):
  if tag=='script' and not dict(attrs).get('src'):self.script=True;self.parts=[]
 def handle_data(self,data):
  if self.script:self.parts.append(data)
 def handle_endtag(self,tag):
  if tag=='script' and self.script:self.chunks.append(''.join(self.parts));self.script=False
with tempfile.TemporaryDirectory() as d:
 tmp=Path(d);(tmp/'cosmos-next.html').write_bytes(original)
 patch=tmp/'correction.patch';patch.write_bytes(patch_bytes)
 proc=subprocess.run(['patch','-p1','--batch','--forward','-i',str(patch)],cwd=tmp,capture_output=True,text=True)
 if proc.returncode:raise SystemExit('Patch failed, no files modified. '+proc.stderr[:1000])
 result=(tmp/'cosmos-next.html').read_bytes()
 if hashlib.sha256(result).hexdigest()!=TARGET:raise SystemExit('Output hash mismatch. No files changed.')
 html=result.decode('utf-8')
 assert '/api/business/jobs/career-profile' in html
 assert 'jobsQuickRegion' in html and 'jobsApplyLocation' in html
 assert 'cosmos929-origin-orb' in html
 assert 'id="jobsResumeUpload"' in html
 parser=Scripts();parser.feed(html)
 if len(parser.chunks)!=4:raise SystemExit('Unexpected JS structure; no changes made.')
 for i,block in enumerate(parser.chunks):
  candidate=tmp/f'inline{i}.js';candidate.write_text(block)
  ck=subprocess.run(['node','--check',str(candidate)],capture_output=True,text=True)
  if ck.returncode:raise SystemExit('JavaScript '+str(i)+' failed syntax: '+ck.stderr[:1000])
 print('PASS: v9.3.1 patch, exact SHA, core UI invariants and four JavaScript syntax checks.')
 if MODE=='apply':
  tmpfile=path.with_name('.cosmos-next.v931.tmp');tmpfile.write_bytes(result);os.replace(tmpfile,path)
  print('APPLIED: v9.3.1 frontend updated.')
 else:print('VALIDATE ONLY: existing cosmos-next.html unchanged.')
