#!/usr/bin/env python3
"""COSMOS Global Questions v7.0 — source-first, PAA/editorial provenance and optional media.
Produces unique 1200x630 editorial draft PNG cards.
Does not publish and never mutates the automated social queue.
Requires Pillow. Run after cosmos_global_trends_v6_3.mjs.
"""
from __future__ import annotations
import json
import math
import random
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path.cwd()
INPUT=ROOT/'data/cosmos-global-questions-review.json'
OUT=ROOT/'assets/cosmos-global-cards'
W,H=1200,630
THEMES=[('#0c223b','#24739a','#bdefff'),('#102935','#1f7b6e','#c2fae3'),('#1e2543','#7860bd','#f5dafd'),('#2d273c','#b8755b','#fff0c4'),('#172737','#527a9c','#e4edff')]
FONTS=['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf']
REG=['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf']

def font(size,bold=False):
    for fn in (FONTS if bold else REG):
        if Path(fn).exists():return ImageFont.truetype(fn,size)
    return ImageFont.load_default()
def hexc(hexstr):return tuple(bytes.fromhex(hexstr.lstrip('#')))
def blend(a,b,t):return tuple(round(x*(1-t)+y*t) for x,y in zip(a,b))
def wrap(draw,text,f,maxw,maxrows=4):
    lines=[];line=''
    for word in text.split():
        nxt=(line+' '+word).strip()
        if draw.textbbox((0,0),nxt,font=f)[2]<=maxw:line=nxt
        else:
            if line:lines.append(line)
            line=word
    if line:lines.append(line)
    if len(lines)>maxrows:
        lines=lines[:maxrows]
        while lines[-1] and draw.textbbox((0,0),lines[-1]+'…',font=f)[2]>maxw:
            lines[-1]=lines[-1][:-1]
        lines[-1]=lines[-1].rstrip(' ,.')+'…'
    return lines

def draw_card(row,index):
    seed=int(row['id'][-9:].encode().hex()[:8],16)
    rng=random.Random(seed)
    base,other,accent=THEMES[index%len(THEMES)]
    top=hexc(base);bot=hexc(other)
    im=Image.new('RGB',(W,H));d=ImageDraw.Draw(im)
    for y in range(H):
        tone=blend(top,bot,(y/H)*.80)
        d.line((0,y,W,y),fill=tone)
    # Original abstract lens / orbit motifs, no downloaded images or branding.
    cx,cy=1000,325
    for rad in (124,168,212,264):
        d.ellipse((cx-rad,cy-rad,cx+rad,cy+rad),outline=(157,213,244),width=2)
    d.ellipse((cx-106,cy-106,cx+106,cy+106),fill=hexc(base),outline=hexc(accent),width=6)
    for _ in range(22):
        x=rng.randint(735,1180);y=rng.randint(74,550);rad=rng.randint(2,6)
        d.ellipse((x-rad,y-rad,x+rad,y+rad),fill=hexc(accent))
    d.text((64,51),'PTD TODAY  /  COSMOS',font=font(26,True),fill=(241,248,255))
    d.text((65,110),'GLOBAL QUESTIONS',font=font(19,True),fill=hexc(accent))
    title=row['question'];size=54 if len(title)<77 else 45
    f=font(size,True);lines=wrap(d,title,f,665,4)
    y=180
    for line in lines:
        d.text((64,y),line,font=f,fill=(255,255,255));y+=size+13
    region=', '.join(row.get('trend_regions',[])[:4])
    origin = 'GOOGLE PEOPLE ALSO ASK' if row.get('question_source_type') == 'google_paa' else 'COSMOS EDITORIAL / SOURCE-BASED'
    d.text((65,530),f'{origin}  ·  {region}',font=font(19,False),fill=(235,244,249))
    extras=['EVIDENCE + ANSWER']
    if row.get('grok_perspective'): extras.append('GROK')
    if row.get('youtube'): extras.append('VIDEO')
    d.text((65,565),'  +  '.join(extras)+'  ON COSMOS',font=font(20,True),fill=hexc(accent))
    return im

def main():
    if not INPUT.exists():
        print('No COSMOS v6.3 review file yet; no cards generated.');return
    data=json.loads(INPUT.read_text(encoding='utf-8'))
    # v6.3.1 added source diagnostics but kept the card fields unchanged.
    # Accept both review schema versions. This keeps the older v6.3 review compatible.
    version=str(data.get('version',''))
    if version not in ('6.3','6.3.1'):
        raise ValueError(f'Expected review file version 6.3 or 6.3.1; received {version!r}')
    if not isinstance(data.get('items'),list):
        raise ValueError('Review file must contain an items array')
    OUT.mkdir(parents=True,exist_ok=True)
    count=0
    for i,row in enumerate(data.get('items',[])):
        if not re.fullmatch('global-[a-z0-9-]+',row['id']):raise ValueError('Unsafe card ID')
        image=draw_card(row,i);dest=OUT/(row['id']+'.png');image.save(dest,optimize=True)
        count+=1
    print(f'Generated {count} separate original COSMOS Global Questions preview cards.')
if __name__=='__main__':main()
