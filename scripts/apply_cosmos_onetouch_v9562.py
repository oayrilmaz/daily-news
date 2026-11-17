#!/usr/bin/env python3
"""COSMOS v9.5.6.2 — Fix OneTouch swipe navigation & Business UI parity.
Apply only to existing v9.5.6.1 legalized OneTouch. Does not edit any
Worker, backend, D1 or existing authenticated functions.

Usage: python3 scripts/apply_cosmos_onetouch_v9562.py --mode validate|apply|rollback
"""
import argparse,os,subprocess,tempfile
from pathlib import Path
SOURCE=Path('cosmos-next.html')
REPLACEMENTS=[('html.cosmos-v956-clean #sheetBackdrop{visibility:hidden!important;pointer-events:none!important}', '/* v9.5.6.2: prevent the legacy Business calendar, wheel, and panels from\n   showing THROUGH the transparent OneTouch lens. These rules apply only while\n   OneTouch is active; native Business functions remain available from its menu. */\nhtml.cosmos-v956-clean #sheet.business-modal{visibility:hidden!important;pointer-events:none!important}\nhtml.cosmos-v956-clean #sheetBackdrop{visibility:hidden!important;pointer-events:none!important}\n#cosmosOneTouchV956[data-universe="business"]{\n  background:radial-gradient(circle at 72% 24%,rgba(100,133,156,.26),transparent 60%),\n    linear-gradient(156deg,#102538 0%,#30445b 54%,#12273b 100%);\n}\n#cosmosOneTouchV956 .co-lens,\n#cosmosOneTouchV956 .co-grid,\n#cosmosOneTouchV956 .co-day{touch-action:pan-y;overscroll-behavior-x:contain}\n#cosmosOneTouchV956 .co-live-announcement{position:absolute!important;width:1px!important;height:1px!important;\n  padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;\n  white-space:nowrap!important;border:0!important}'), ('  let swipe = null;\n  let monitorLock = false;', "  let pointerGesture = null;\n  let touchGesture = null;\n  let lastNavigationAt = 0;\n  let horizontalWheel = 0;\n  let lastWheelAt = 0;\n  let lastWheelShift = 0;\n  let monitorLock = false;\n  const liveAnnouncement = document.createElement('span');\n  liveAnnouncement.className = 'co-live-announcement';\n  liveAnnouncement.setAttribute('role','status');\n  liveAnnouncement.setAttribute('aria-live','polite');\n  root.appendChild(liveAnnouncement);"), ('  function shiftWeek(n) {selected.setDate(selected.getDate()+7*n);renderGrid();}', "  function shiftWeek(n) {\n    const next = dateAtNoon(selected);\n    next.setDate(next.getDate() + 7 * n);\n    selected = next;\n    renderGrid();\n    const days = weekDays();\n    liveAnnouncement.textContent = 'Showing ' + days[0].toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) +\n      ' through ' + days[6].toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});\n  }"), ("    if (action==='switch'){\n      closeMenu();\n      const destination=currentUniverse==='business'?'personal':'business';\n      const fn=window.cosmosMetroShortcutsV923?.[destination];\n      if(typeof fn==='function'){fn(); setTimeout(()=>sync(true),350);}\n      else runNative('switch');\n      return;\n    }", "    if (action==='switch'){\n      closeMenu();\n      const destination=currentUniverse==='business'?'personal':'business';\n      const fn=window.cosmosMetroShortcutsV923?.[destination];\n      if(typeof fn==='function') fn();\n      else {\n        // The fallback must not permanently expose the crowded native workspace.\n        const switcher=$('cosmosUniverseSwitch');\n        if(switcher)switcher.click();\n      }\n      nativeWorkspace=false;\n      setTimeout(()=>{nativeWorkspace=false;sync(true);},320);\n      return;\n    }")]
OLD_TOUCH="  const lens = $('cosmosV956Lens');\n  lens.addEventListener('touchstart',e=>{\n    if(e.touches.length!==1||menuOpen)return;\n    swipe={x:e.touches[0].clientX,y:e.touches[0].clientY};\n  },{passive:true});\n  lens.addEventListener('touchend',e=>{\n    if(!swipe||e.changedTouches.length!==1||menuOpen)return;\n    const dx=e.changedTouches[0].clientX-swipe.x;\n    const dy=e.changedTouches[0].clientY-swipe.y;\n    swipe=null;\n    if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5)shiftWeek(dx>0?-1:1);\n  },{passive:true});\n"
NEW_TOUCH="  // v9.5.6.2: gesture navigation is attached to the foreground OneTouch lens.\n  // Direction: finger right = past, finger left = future. Pointer + touch fallback\n  // covers iOS Safari, desktops, and browsers that cancel pointer gestures.\n  const lens = $('cosmosV956Lens');\n  function gestureStart(x,y,id) { return {x,y,id}; }\n  function finishGesture(start,x,y,event) {\n    if (!start || root.hidden || menuOpen || nativeWorkspace) return false;\n    const dx=x-start.x, dy=y-start.y;\n    const threshold=Math.max(42,Math.min(85,lens.clientWidth*.085));\n    if (Math.abs(dx)<threshold || Math.abs(dx)<Math.abs(dy)*1.25) return false;\n    // Both pointerup and touchend may fire for one iOS gesture: move only once.\n    if (Date.now()-lastNavigationAt<330) return true;\n    lastNavigationAt=Date.now();\n    shiftWeek(dx>0?-1:1);\n    if (event && event.cancelable) event.preventDefault();\n    return true;\n  }\n  if (window.PointerEvent) {\n    lens.addEventListener('pointerdown',e=>{\n      if(menuOpen || !e.isPrimary)return;\n      pointerGesture=gestureStart(e.clientX,e.clientY,e.pointerId);\n    },{passive:true});\n    window.addEventListener('pointerup',e=>{\n      if(!pointerGesture || e.pointerId!==pointerGesture.id)return;\n      const start=pointerGesture;pointerGesture=null;\n      finishGesture(start,e.clientX,e.clientY,e);\n    },{capture:true});\n    window.addEventListener('pointercancel',e=>{\n      if(pointerGesture?.id===e.pointerId)pointerGesture=null;\n    },{capture:true});\n  }\n  lens.addEventListener('touchstart',e=>{\n    if(menuOpen || e.touches.length!==1)return;\n    touchGesture=gestureStart(e.touches[0].clientX,e.touches[0].clientY,0);\n  },{passive:true});\n  lens.addEventListener('touchend',e=>{\n    if(!touchGesture || e.changedTouches.length!==1)return;\n    const start=touchGesture;touchGesture=null;\n    finishGesture(start,e.changedTouches[0].clientX,e.changedTouches[0].clientY,e);\n  },{passive:false});\n  lens.addEventListener('touchcancel',()=>{touchGesture=null;},{passive:true});\n  // Horizontal two-finger scrolling on trackpads. Ignore vertical page scroll.\n  lens.addEventListener('wheel',e=>{\n    if(menuOpen || root.hidden || nativeWorkspace || e.ctrlKey)return;\n    if(Math.abs(e.deltaX)<Math.abs(e.deltaY)*1.15 || Math.abs(e.deltaX)<2)return;\n    if(e.cancelable)e.preventDefault();\n    const t=Date.now();\n    if(t-lastWheelAt>450)horizontalWheel=0;\n    lastWheelAt=t;\n    horizontalWheel+=e.deltaX;\n    if(Math.abs(horizontalWheel)>65 && t-lastWheelShift>360){\n      shiftWeek(horizontalWheel>0?1:-1);\n      lastWheelShift=t;\n      horizontalWheel=0;\n    }\n  },{passive:false});\n  // Swipes must not also activate the calendar day under the releasing finger.\n  lens.addEventListener('click',e=>{\n    if(Date.now()-lastNavigationAt<360){e.preventDefault();e.stopImmediatePropagation();}\n  },true);\n"

def exactly_once(content,old,new):
    count=content.count(old)
    if count!=1:raise ValueError('expected code block not unique ('+str(count)+')')
    return content.replace(old,new,1)

def migrate(content,reverse=False):
    if reverse:
        if 'v9.5.6.2: gesture navigation' not in content:
            if 'v9.5.6.2: prevent the legacy Business' in content:raise ValueError('partial update')
            return content
        content=exactly_once(content,NEW_TOUCH,OLD_TOUCH)
        for old,new in reversed(REPLACEMENTS):content=exactly_once(content,new,old)
        return content
    if 'v9.5.6.2: gesture navigation' in content:
        if 'v9.5.6.2: prevent the legacy Business' not in content:raise ValueError('partial update')
        return content
    if 'cosmos953LegalStatusNeeded' not in content or 'cosmos953LegalGate' not in content:
        raise ValueError('v9.5.6.1 legal frontend missing. Apply legal repair first; do not overwrite.')
    if 'cosmosOneTouchV956' not in content:raise ValueError('v9.5.6 OneTouch layer missing')
    for old,new in REPLACEMENTS:content=exactly_once(content,old,new)
    content=exactly_once(content,OLD_TOUCH,NEW_TOUCH)
    return content

def validate_js(content):
    start=content.index('<script id="cosmos-v956-js">')+len('<script id="cosmos-v956-js">')
    end=content.index('</script>',start)
    with tempfile.TemporaryDirectory() as directory:
        path=Path(directory)/'onetouch.js';path.write_text(content[start:end],encoding='utf-8')
        p=subprocess.run(['node','--check',str(path)],capture_output=True,text=True)
        if p.returncode:raise ValueError('OneTouch syntax validation failed: '+p.stderr[:650])

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--mode',choices=['validate','apply','rollback'],default='validate')
    mode=ap.parse_args().mode
    if not SOURCE.is_file():raise SystemExit('Run this script at the repository root.')
    before=SOURCE.read_text(encoding='utf-8')
    try:
        after=migrate(before,reverse=mode=='rollback')
        validate_js(after)
        if migrate(migrate(before),reverse=True)!=migrate(before,reverse=True):
            raise ValueError('roundtrip check failed')
    except (ValueError,KeyError) as error:raise SystemExit('BLOCKED — '+str(error))
    print('PASS — syntax, integration markers and rollback checks successful.')
    print('OneTouch v9.5.6.2 present:', 'v9.5.6.2: gesture navigation' in after)
    if mode=='validate':return
    if before==after:
        print('Already in requested state; nothing to change.');return
    tmp=SOURCE.with_suffix('.v9562.tmp');tmp.write_text(after,encoding='utf-8',newline='')
    os.replace(tmp,SOURCE)
    print('SUCCESS — changed only cosmos-next.html. Verify mobile gestures and Business parity on live Pages.')
if __name__=='__main__':main()
