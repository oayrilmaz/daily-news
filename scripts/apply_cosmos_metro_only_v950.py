#!/usr/bin/env python3
"""Guarded COSMOS v9.5.0 Metro-only layout correction.
Does NOT enable legal agreements, policy pages, or registration gates.
GitHub paths: scripts/apply_cosmos_metro_only_v950.py
"""
import argparse, hashlib, pathlib, sys

SOURCE_SHA = 'd42e0bbc91fd75505c57c554ce9cc7f74b29f83eefb75654190a7bb08a75cb65'
METRO_SHA = '7913327eb4bd77492cdcacd9593fc696d650a41b0794dbed991f9298cdbd96be'
FULL_LEGAL_SHA = '6146509cbaae46fa288b6cefe22102eb2ce71aefe3345a27b2dfd345e061815d'
METRO_CSS = '\n<style id="cosmos950MetroNoOverlap">\n/* v9.5.0: week stays in normal layout; only day/news scroller moves.\n   This replaces the v9.4.4 sticky header + scrolling entire stage combination\n   that placed public and private cards across the weekday rail. */\n#app.metro-live .journey-stage{\n  display:flex!important;flex-direction:column!important;align-items:stretch!important;\n  overflow:hidden!important;overflow-x:hidden!important;overflow-y:hidden!important;\n  overscroll-behavior:contain!important;touch-action:auto!important;\n  padding-bottom:4px!important;min-height:0!important;\n}\n#app.metro-live .journey-stage>.week-metro{\n  position:relative!important;top:auto!important;left:auto!important;\n  transform:none!important;flex:0 0 auto!important;min-height:0!important;\n  z-index:2!important;padding-bottom:10px!important;margin:0!important;\n  isolation:isolate!important;overflow:visible!important;\n}\n#app.metro-live .journey-stage>#metroMain,\n#app.metro-live .journey-stage>#metroMain.cosmos-public-scroller{\n  position:relative!important;top:auto!important;\n  display:flex!important;flex-direction:column!important;\n  flex:1 1 auto!important;min-height:0!important;height:auto!important;\n  max-height:none!important;overflow-y:auto!important;overflow-x:hidden!important;\n  scrollbar-width:thin!important;overscroll-behavior-y:contain!important;\n  -webkit-overflow-scrolling:touch!important;touch-action:pan-y!important;\n  padding:7px 6px calc(145px + env(safe-area-inset-bottom))!important;\n  scroll-padding-top:12px!important;\n  -webkit-mask-image:none!important;mask-image:none!important;\n}\n#app.metro-live #metroMain>.metro-day-heading{\n  position:relative!important;z-index:0!important;flex:0 0 auto!important;\n  order:10!important;margin:0 0 8px!important;\n}\n#app.metro-live #metroMain>.metro-day-scroll{\n  position:relative!important;order:20!important;flex:0 0 auto!important;\n  height:auto!important;max-height:none!important;min-height:0!important;\n  overflow:visible!important;overflow-x:visible!important;\n  padding:0 4px 8px!important;margin:0!important;\n  -webkit-mask-image:none!important;mask-image:none!important;\n}\n#app.metro-live #metroMain>.metro-day-scroll>.living-day-chart{\n  position:relative!important;min-height:0!important;height:auto!important;\n  padding:6px 0 20px!important;overflow:visible!important;\n}\n#app.metro-live #metroMain>.cosmos948-news{\n  order:90!important;flex:0 0 auto!important;margin:17px auto 24px!important;\n  max-width:min(1140px,100%)!important;\n}\n#app.metro-live #metroMain .living-branch{\n  position:relative!important;top:auto!important;bottom:auto!important;\n  margin:9px 0 14px!important;\n  min-height:85px!important;overflow:visible!important;\n}\n#app.metro-live #metroMain .living-entry,\n#app.metro-live #metroMain details.cosmos945-public-moment{\n  z-index:0!important;max-width:100%!important;box-sizing:border-box!important;\n}\n/* The day label and the weekly rail never occupy the same paint layer. */\n#app.metro-live .journey-stage>.week-metro .metro-filters{position:relative!important;z-index:1!important}\n@media(max-width:650px){\n #app.metro-live .journey-stage{padding:0 8px 0!important}\n #app.metro-live .journey-stage>.week-metro{padding-bottom:7px!important}\n #app.metro-live .journey-stage>#metroMain{padding:6px 2px calc(145px + env(safe-area-inset-bottom))!important}\n #app.metro-live #metroMain>.metro-day-heading{margin-bottom:7px!important}\n #app.metro-live #metroMain .living-branch{min-height:82px!important}\n}\n</style>'

p=argparse.ArgumentParser()
p.add_argument('--mode',choices=['validate','apply'],default='validate')
args=p.parse_args()
path=pathlib.Path('cosmos-next.html')
if not path.is_file():
    sys.exit('ERROR: cosmos-next.html not found at repository root. No files changed.')
raw=path.read_bytes()
sha=hashlib.sha256(raw).hexdigest()
if sha in (METRO_SHA,FULL_LEGAL_SHA):
    print('COSMOS layout already updated. No files changed.')
    sys.exit(0)
if sha != SOURCE_SHA:
    sys.exit('ERROR: unexpected cosmos-next.html SHA '+sha+'; expected unchanged v9.4.9. No files changed.')
text=raw.decode('utf-8')
if text.count('</body>') != 1 or 'cosmos950MetroNoOverlap' in text:
    sys.exit('ERROR: unexpected layout markers. No files changed.')
modified=text.replace('</body>',METRO_CSS+'\n</body>')
if hashlib.sha256(modified.encode('utf-8')).hexdigest()!=METRO_SHA:
    sys.exit('ERROR: proposed HTML checksum mismatch. No files changed.')
if args.mode=='validate':
    print('VALIDATION GREEN: v9.4.9 verified. Metro-only patch ready; no files changed.')
else:
    path.write_text(modified,encoding='utf-8')
    print('APPLIED: isolated Metro no-overlap CSS. No legal enforcement or Worker changes.')
