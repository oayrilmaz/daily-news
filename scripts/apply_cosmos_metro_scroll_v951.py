#!/usr/bin/env python3
"""COSMOS v9.5.1: guarded, frontend-only one-scroller Metro correction.
Run: python scripts/apply_cosmos_metro_scroll_v951.py --mode validate|apply
"""
from pathlib import Path
import argparse, hashlib, sys
FILE=Path('cosmos-next.html')
BASE_SHA256='7913327eb4bd77492cdcacd9593fc696d650a41b0794dbed991f9298cdbd96be'
MARKER='id="cosmos951OneScroll"'
CSS='/* COSMOS v9.5.1 – a SINGLE vertical scroller for Personal Metro.\n   The week, moments, and news participate in document order. The centre\n   creation dock stays on-screen and scrolling receives sufficient clearance. */\n#app.metro-live .journey-stage {\n  overflow-y:auto!important;\n  overflow-x:hidden!important;\n  -webkit-overflow-scrolling:touch!important;\n  overscroll-behavior-y:contain!important;\n  touch-action:pan-y!important;\n  display:flex!important;\n  flex-direction:column!important;\n  align-items:stretch!important;\n  justify-content:flex-start!important;\n  bottom:0!important;\n  padding-bottom:calc(155px + env(safe-area-inset-bottom))!important;\n  scroll-padding-bottom:calc(155px + env(safe-area-inset-bottom))!important;\n}\n#app.metro-live .journey-stage>.week-metro {\n  position:relative!important;\n  top:auto!important;\n  z-index:1!important;\n  flex:0 0 auto!important;\n  background:transparent!important;\n  -webkit-backdrop-filter:none!important;\n  backdrop-filter:none!important;\n}\n#app.metro-live .journey-stage>#metroMain,\n#app.metro-live .journey-stage>#metroMain.cosmos-public-scroller {\n  flex:0 0 auto!important;\n  height:auto!important;\n  min-height:0!important;\n  max-height:none!important;\n  overflow:visible!important;\n  overflow-y:visible!important;\n  padding:8px 4px 20px!important;\n}\n#app.metro-live #metroMain>.metro-day-scroll,\n#app.metro-live #metroMain #metroDayScroll,\n#app.metro-live #metroMain .living-day-chart {\n  height:auto!important;\n  min-height:0!important;\n  max-height:none!important;\n  overflow:visible!important;\n  overflow-y:visible!important;\n  mask-image:none!important;\n  -webkit-mask-image:none!important;\n}\n#app.metro-live #metroMain>.cosmos948-news {\n  position:relative!important;\n  order:90!important;\n  margin:18px auto 25px!important;\n}\n/* No empty 150px padding in the child: clearance is in outer scroller. */\n#app.metro-live #metroMain>.metro-day-scroll {\n  padding:0 4px 12px!important;\n}\n/* Keep each moment wholly within its row and not behind a sticky header. */\n#app.metro-live #metroMain .living-branch,\n#app.metro-live #metroMain .living-rail {\n  overflow:visible!important;\n}\n#app.metro-live #metroMain .living-entry,\n#app.metro-live #metroMain details.cosmos945-public-moment {\n  max-width:100%!important;\n  box-sizing:border-box!important;\n}\n'
BLOCK='\n<style '+MARKER+'>\n'+CSS+'</style>\n'

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--mode',choices=['validate','apply'],default='validate')
    args=parser.parse_args()
    if not FILE.exists():
        raise SystemExit('ERROR: cosmos-next.html not found. No changes made.')
    current=FILE.read_bytes()
    body=current.decode('utf-8')
    if MARKER in body:
        if body.count(MARKER)!=1:
            raise SystemExit('ERROR: repeated v9.5.1 marker; inspect the file manually.')
        print('ALREADY APPLIED: v9.5.1 one-scroller marker present; no changes made.')
        return
    if hashlib.sha256(current).hexdigest()!=BASE_SHA256:
        raise SystemExit('ERROR: current frontend differs from approved Metro-only v9.5.0 source. No changes made. Back up and inspect before applying.')
    if 'id="cosmos950MetroNoOverlap"' not in body or body.count('</body>')!=1:
        raise SystemExit('ERROR: unexpected Metro markup; no changes made.')
    if 'cosmos950ShowLegalGate' in body:
        raise SystemExit('ERROR: full legal-gate frontend detected. No changes made.')
    output=body.replace('</body>', BLOCK+'</body>')
    if args.mode=='validate':
        print('PASS validation. v9.5.1 one-scroller will be applied without touching account/backend/legal files.')
    else:
        FILE.write_text(output,encoding='utf-8')
        print('APPLIED v9.5.1 one-scroller Metro CSS in cosmos-next.html.')
if __name__=='__main__': main()
