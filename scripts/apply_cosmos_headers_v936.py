#!/usr/bin/env python3
"""COSMOS v9.3.6 guarded header correction (Personal/Business parity)."""
import hashlib, os, subprocess, sys, tempfile
from pathlib import Path
MODE=sys.argv[1] if len(sys.argv)>1 else 'validate'
if MODE not in ('validate','apply'):
    raise SystemExit('Usage: python scripts/apply_cosmos_headers_v936.py validate|apply')
BEFORE='1848feef2e81fb1db7f554cb5a0a66aa326de09b6fb21d3b6938f737b313dade'
AFTER='4dfd7b3662c27672dae27770a0ab36447a95490b4e55725ad9e33004ab7bd7dc'
OLD_HEADER='header.innerHTML=`<button type="button" class="business-header-brand" id="businessHeaderUniverse" aria-label="Choose COSMOS universe" title="Choose universe"><strong>COSMOS</strong><span>Look deeper.</span></button>\n      <div class="business-header-actions" aria-label="COSMOS controls">'
NEW_HEADER='header.innerHTML=`<div class="cosmos929-brand cosmos936-business-brand"><a class="cosmos929-origin-orb" href="/cosmos-original-home.html" aria-label="Open original COSMOS Origins" title="Original COSMOS"><span aria-hidden="true"></span></a><button type="button" class="business-header-brand brand" id="businessHeaderUniverse" aria-label="Choose COSMOS universe" title="Choose universe">COSMOS<span class="tagline">Look deeper.</span></button></div>\n      <div class="business-header-actions" aria-label="COSMOS controls">'
OLD_JS='if(mini){mini.style.backgroundImage=\'url("\'+url+\'")\';mini.classList.add(\'has-photo\');}'
NEW_JS='if(mini){\n        // Override legacy !important background shorthand on both header avatars.\n        // The image is an authenticated owner-only blob URL, never a public R2 URL.\n        mini.style.setProperty(\'background-image\',\'url("\'+url+\'")\',\'important\');\n        mini.classList.add(\'has-photo\');\n      }'
STYLE='\n/* COSMOS v9.3.6 — identical Origins circle / logo language in both universes.\n   One appearance; separate authenticated Personal and Business portraits. */\n#sheet.business-modal .sheet-quickbar{\n  display:flex!important;flex-wrap:nowrap!important;align-items:center!important;\n  justify-content:space-between!important;gap:8px!important;\n}\n#sheet.business-modal .cosmos936-business-brand{\n  display:flex!important;align-items:center!important;gap:11px!important;\n  min-width:0!important;flex:0 1 auto!important;pointer-events:auto;\n}\n#sheet.business-modal .cosmos936-business-brand .cosmos929-origin-orb{\n  display:grid!important;flex:0 0 34px!important;min-width:34px!important;\n  width:34px!important;height:34px!important;place-items:center!important;\n  border:1.5px solid #8c9ba6!important;border-radius:50%!important;\n  background:#fff!important;box-shadow:0 2px 12px #00000012!important;\n}\n#sheet.business-modal .cosmos936-business-brand .cosmos929-origin-orb span{\n  width:18px!important;height:18px!important;border:1px solid #6b8295!important;\n  border-radius:50%!important;\n}\n#sheet.business-modal .cosmos936-business-brand > .business-header-brand{\n  display:block!important;min-width:0!important;min-height:0!important;\n  background:transparent!important;border:0!important;border-radius:0!important;\n  box-shadow:none!important;padding:0!important;text-align:left!important;\n  text-transform:uppercase!important;font-size:13px!important;\n  line-height:1.25!important;letter-spacing:.20em!important;\n  font-weight:800!important;color:#272c31!important;\n  text-shadow:0 1px 12px rgba(255,255,255,.9)!important;\n  white-space:nowrap!important;\n}\n#sheet.business-modal .cosmos936-business-brand > .business-header-brand .tagline{\n  display:block!important;margin-top:5px!important;font-size:11px!important;\n  letter-spacing:.01em!important;font-weight:500!important;\n  color:#697183!important;text-transform:none!important;\n}\n#sheet.business-modal .business-header-actions{\n  display:flex!important;flex:0 0 auto!important;align-items:center!important;\n  justify-content:flex-end!important;gap:clamp(4px,1vw,8px)!important;\n  margin-left:auto!important;\n}\n/* Older styles forced a solid background with !important, preventing\n   authenticated owner portrait URLs from appearing in the circle. */\n#app .cosmos933-header-avatar,#sheet.business-modal .cosmos933-header-avatar{\n  background-color:#f2f4f6!important;\n  background-size:cover!important;background-position:center center!important;\n  background-repeat:no-repeat!important;\n}\n#app .cosmos933-header-avatar.has-photo,\n#sheet.business-modal .cosmos933-header-avatar.has-photo{\n  color:transparent!important;\n}\n@media(max-width:540px){\n  #sheet.business-modal .cosmos936-business-brand{gap:9px!important;}\n  #sheet.business-modal .cosmos936-business-brand > .business-header-brand{\n    font-size:12px!important;\n  }\n  #sheet.business-modal .cosmos936-business-brand > .business-header-brand .tagline{\n    font-size:11px!important;\n  }\n}\n'
p=Path('cosmos-next.html')
if not p.is_file():raise SystemExit('SAFE STOP: cosmos-next.html missing at repository root.')
source=p.read_text(encoding='utf-8')
digest=hashlib.sha256(source.encode('utf-8')).hexdigest()
if digest==AFTER:
    print('COSMOS v9.3.6 already installed; no changes.')
    raise SystemExit(0)
if digest!=BEFORE:
    raise SystemExit('SAFE STOP: unexpected frontend SHA256 '+digest+'. Expected v9.3.5. No files changed.')
if any(source.count(x)!=1 for x in (OLD_HEADER,OLD_JS,'</style>')):
    raise SystemExit('SAFE STOP: header/photo anchors changed. No files changed.')
output=source.replace(OLD_HEADER,NEW_HEADER,1).replace(OLD_JS,NEW_JS,1).replace('</style>',STYLE+'\n</style>',1)
if hashlib.sha256(output.encode('utf-8')).hexdigest()!=AFTER:
    raise SystemExit('SAFE STOP: expected output checksum mismatch; no files changed.')
for marker in ['COSMOS v9.3.5','COSMOS v9.3.6','cosmos934CleanCanvasJpeg','/api/business/jobs/discover','/api/identity-media/','cosmos936-business-brand']:
    if marker not in output:raise SystemExit('SAFE STOP: preserved feature missing: '+marker)
from html.parser import HTMLParser
class Scripts(HTMLParser):
    def __init__(self):super().__init__();self.open=False;self.buf='';self.blocks=[]
    def handle_starttag(self,tag,attrs):
        if tag=='script' and not dict(attrs).get('src'):self.open=True;self.buf=''
    def handle_data(self,data):
        if self.open:self.buf+=data
    def handle_endtag(self,tag):
        if tag=='script' and self.open:self.blocks.append(self.buf);self.open=False
parser=Scripts();parser.feed(output)
if len(parser.blocks)!=4:raise SystemExit('SAFE STOP: unexpected inline JavaScript count.')
with tempfile.TemporaryDirectory() as tmp:
    for idx,code in enumerate(parser.blocks):
        check=Path(tmp)/f'inline_{idx}.js';check.write_text(code,encoding='utf-8')
        proc=subprocess.run(['node','--check',str(check)],text=True,capture_output=True)
        if proc.returncode:raise SystemExit('SAFE STOP: JS syntax: '+proc.stderr[:600])
print('PASS: exact v9.3.5 source, four JS blocks, profile-photo fix, brand parity.')
if MODE=='apply':
    temp=p.with_name('.cosmos-next-v936.tmp');temp.write_text(output,encoding='utf-8')
    os.replace(temp,p)
    print('APPLIED: only cosmos-next.html updated (no Worker or D1 change).')
else:print('VALIDATE: source unchanged.')
