#!/usr/bin/env python3
"""COSMOS v9.3.4 guarded frontend correction: metadata-safe photo uploads.
Runs ONLY against the exact prior v9.3.3 source. Does not touch Workers or D1.
"""
import base64,hashlib,os,subprocess,sys,tempfile,zlib
from pathlib import Path
from html.parser import HTMLParser
MODE=sys.argv[1] if len(sys.argv)>1 else 'validate'
if MODE not in ('validate','apply'):raise SystemExit('Use validate or apply')
BEFORE='af2e9581f49dacd1fd4eedeb07c685de8dcd0a56125f0d06952931289259708e'
TARGET='e025f462b814404a82115199f0a743ef2eabea758afc6c3f4914cd836cd40213'
PATCH='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'
class InlineScripts(HTMLParser):
 def __init__(self):super().__init__();self.active=False;self.buffer='';self.scripts=[]
 def handle_starttag(self,tag,attrs):
  if tag=='script' and not dict(attrs).get('src'):
   self.active=True;self.buffer=''
 def handle_data(self,data):
  if self.active:self.buffer+=data
 def handle_endtag(self,tag):
  if tag=='script' and self.active:self.scripts.append(self.buffer);self.active=False
source=Path('cosmos-next.html')
if not source.is_file():raise SystemExit('SAFE STOP: cosmos-next.html was not found at repository root.')
original=source.read_bytes()
digest=hashlib.sha256(original).hexdigest()
if digest==TARGET:
 print('ALREADY APPLIED: v9.3.4 frontend is installed.');raise SystemExit(0)
if digest!=BEFORE:
 raise SystemExit('SAFE STOP: frontend is not the expected v9.3.3 source. No files changed. Current SHA256='+digest)
with tempfile.TemporaryDirectory() as tmp:
 folder=Path(tmp)
 (folder/'cosmos-next.html').write_bytes(original)
 patch=folder/'photo.patch';patch.write_bytes(zlib.decompress(base64.b64decode(PATCH)))
 run=subprocess.run(['patch','-p1','--batch','--forward','-i',str(patch)],cwd=folder,capture_output=True,text=True)
 if run.returncode:raise SystemExit('SAFE STOP: patch failed. '+run.stderr[:700])
 result=(folder/'cosmos-next.html').read_bytes()
 if hashlib.sha256(result).hexdigest()!=TARGET:
  raise SystemExit('SAFE STOP: checksum changed unexpectedly. No files changed.')
 html=result.decode('utf-8')
 for marker in ['cosmos934CleanCanvasJpeg','cosmos933EditPhoto','cosmos933Upload','cosmos933-has-business-bg',
    '/api/identity-media/','/api/business/jobs/discover','cosmos929-origin-orb','business-metro-shell','id="cosmosChoosePrivate"']:
  if marker not in html:raise SystemExit('SAFE STOP: preserved COSMOS feature missing: '+marker)
 parser=InlineScripts();parser.feed(html)
 if len(parser.scripts)!=4:raise SystemExit('SAFE STOP: expected four inline JavaScript blocks.')
 for index,js in enumerate(parser.scripts):
  path=folder/('inline'+str(index)+'.js');path.write_text(js)
  check=subprocess.run(['node','--check',str(path)],capture_output=True,text=True)
  if check.returncode:raise SystemExit('SAFE STOP: JavaScript check failed: '+check.stderr[:700])
 print('PASS: source checksum, photo metadata fix, four JavaScript blocks and existing COSMOS modules.')
 if MODE=='validate':print('VALIDATE only: cosmos-next.html was NOT changed.')
 else:
  temp=source.with_name('.cosmos-next-v934.tmp');temp.write_bytes(result)
  os.replace(temp,source)
  print('APPLIED: v9.3.4 frontend patch. No other files changed.')
