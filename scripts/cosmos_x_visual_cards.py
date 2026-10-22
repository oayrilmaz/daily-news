#!/usr/bin/env python3
"""COSMOS X v5: copyright-safe, unique OG/Twitter card images.

Reads the verified v4 social queue, creates 1200 x 630 PNG previews,
annotates sourced question pages, and builds one inviting page for playful
posts. Does not post on X, contact external services, or touch Cosmos Next.
"""

from __future__ import annotations

import hashlib
import html
import json
import math
import os
from pathlib import Path
import re
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(os.environ.get('COSMOS_SITE_ROOT', '.')).resolve()
QUEUE = ROOT / 'data' / 'social-queue.json'
CARDS = ROOT / 'assets' / 'cosmos-x-cards'
FUN = ROOT / 'x'
SITE = 'https://ptdtoday.com'
WIDTH, HEIGHT = 1200, 630
FONT_DIRS = [Path('/usr/share/fonts/truetype/dejavu'),Path('/usr/share/fonts/truetype/liberation2'),Path('/usr/share/fonts/truetype')]

PALETTES = {
  'space': ('#071F39','#124479','#89D8F8'), 'science': ('#122938','#266C80','#AAF0DC'),
  'sports': ('#102D39','#158064','#C3F4AB'), 'music': ('#291B4E','#6C4AB8','#F8CEFF'),
  'movies_tv': ('#342339','#9C4670','#FFD3C1'), 'food': ('#4A2633','#BB7454','#FFE4AC'),
  'technology': ('#0A2A48','#246FAC','#C3ECFF'), 'ai': ('#172A4B','#566AC0','#C8D2FF'),
  'gaming': ('#271D51','#7154BD','#DBC8FF'), 'travel': ('#243D59','#5B8FAD','#D7F2FE'),
  'finance': ('#18342C','#267962','#C5FAD4'), 'business': ('#172C49','#3F74AD','#D6E8FA'),
  'environment': ('#13392F','#437B50','#CBF6B5'), 'energy': ('#25314B','#B0803D','#FFF3B0'),
  'culture': ('#263554','#778BAE','#F1E8C9'), 'pets': ('#23384B','#54859B','#FFE6C2'), 'mystery': ('#342D55','#6A66A6','#D8D4FF'), 'other': ('#1C3050','#5D80B0','#DEECFA'),
}


def slug_id(value: object) -> str:
    text = re.sub(r'[^a-z0-9-]+', '-', str(value).lower()).strip('-')
    if not text or len(text)>110:
        raise ValueError('Unsafe image key: ' + str(value)[:60])
    return text


def font(size: int, bold: bool=False):
    fns = ['DejaVuSans-Bold.ttf','LiberationSans-Bold.ttf'] if bold else ['DejaVuSans.ttf','LiberationSans-Regular.ttf']
    for folder in FONT_DIRS:
        for fn in fns:
            candidate = folder/fn
            if candidate.exists():
                return ImageFont.truetype(str(candidate),size)
    return ImageFont.load_default()


def rgb(h: str):
    h=h.lstrip('#');return tuple(int(h[i:i+2],16) for i in (0,2,4))


def shade(top, bot):
    image=Image.new('RGB',(WIDTH,HEIGHT))
    px=image.load();a=rgb(top);b=rgb(bot)
    for y in range(HEIGHT):
        t=y/(HEIGHT-1)
        col=tuple(int(a[i]*(1-t)+b[i]*t) for i in range(3))
        for x in range(WIDTH):px[x,y]=col
    return image


def wrap(draw,text,f,max_width,max_lines):
    words=str(text).strip().split();out=[];cur=''
    for word in words:
        try_line=(cur+' '+word).strip()
        if draw.textbbox((0,0),try_line,font=f)[2]<=max_width:cur=try_line
        else:
            if cur: out.append(cur)
            cur=word
    if cur:out.append(cur)
    if len(out)>max_lines:
        out=out[:max_lines]
        while draw.textbbox((0,0),out[-1]+'…',font=f)[2]>max_width and len(out[-1])>1:
            out[-1]=out[-1][:-1]
        out[-1]=out[-1].rstrip(' ,.')+'…'
    return out


def draw_theme(g, theme, rng):
    # Domain-specific vector motifs, generated locally without stock photos.
    cx,cy=960,315
    accent=(rng[0],rng[1],rng[2],255)
    white=(250,253,255,210)
    if theme in ('space','science','ai'):
        for rr in (155,202,248):g.ellipse((cx-rr,cy-rr,cx+rr,cy+rr),outline=(*rgb('#A8DAFE'),105),width=3)
        g.ellipse((cx-108,cy-108,cx+108,cy+108),fill=(*rgb('#274D78'),250),outline=accent,width=5)
        g.arc((cx-225,cy-78,cx+225,cy+78),15,166,fill=white,width=9)
        g.arc((cx-225,cy-78,cx+225,cy+78),196,338,fill=white,width=9)
        for x,y,r in ((745,155,3),(1087,152,4),(1122,424,3),(787,442,5)):
            g.ellipse((x-r,y-r,x+r,y+r),fill=white)
    elif theme in ('music','gaming','movies_tv'):
        for i,h in enumerate((110,170,225,125,270,185,95)):
            x=750+i*58;g.rounded_rectangle((x,cy-h/2,x+30,cy+h/2),radius=15,fill=accent if i%2 else white)
        g.arc((780,92,1115,505),40,320,fill=accent,width=5)
    elif theme=='pets':
        g.ellipse((835,172,1105,449),fill=(*rgb('#D6B58F'),255),outline=white,width=9)
        g.polygon([(829,219),(785,140),(902,182)],fill=(*rgb('#D6B58F'),255))
        g.polygon([(1047,182),(1163,140),(1111,239)],fill=(*rgb('#D6B58F'),255))
        for x in (904,1025):g.ellipse((x,270,x+19,289),fill=(*rgb('#112B42'),255))
        g.ellipse((931,326,1006,364),fill=(*rgb('#2A3646'),255))
        g.arc((918,336,1019,405),15,165,fill=white,width=6)
    elif theme=='mystery':
        g.line([(855,201),(910,456),(1006,405),(1081,195)],fill=white,width=17)
        g.ellipse((923,389,976,439),fill=accent)
    elif theme in ('food',):
        g.ellipse((795,170,1135,510),outline=white,width=12)
        g.ellipse((842,218,1088,464),outline=accent,width=13)
        for i in range(5):
            x=850+i*52;g.line((x,225,x+50,460),fill=(*rgb('#FFF8DB'),100),width=7)
    elif theme in ('sports',):
        g.ellipse((797,149,1120,473),fill=(*rgb('#175248'),255),outline=white,width=9)
        g.polygon([(961,255),(914,289),(933,348),(991,348),(1010,289)],fill=white)
        for x,y in ((845,215),(1050,214),(816,365),(1090,365)):
            g.line((x,y,950,305),fill=accent,width=5)
    elif theme in ('technology','business','finance','energy'):
        for i,h in enumerate((80,140,205,290)):
            x=770+i*95;g.rounded_rectangle((x,470-h,x+59,470),radius=12,fill=accent if i%2 else white)
        g.line([(774,359),(846,312),(952,264),(1086,168)],fill=white,width=10)
        g.polygon([(1075,171),(1110,149),(1099,190)],fill=white)
    elif theme in ('environment','travel'):
        g.polygon([(970,155),(784,458),(1124,456)],fill=(*rgb('#74AFAC'),230),outline=accent)
        g.polygon([(970,156),(925,230),(1007,229)],fill=white)
        for i in range(4):
            x=799+i*70;g.ellipse((x,414,x+40,455),fill=white)
    else:
        g.ellipse((795,158,1125,488),outline=white,width=12)
        g.ellipse((860,224,1058,422),outline=accent,width=10)
        g.arc((825,188,1093,456),15,190,fill=white,width=9)
        g.rounded_rectangle((910,250,1020,357),radius=20,outline=white,width=8)


def render_card(item, out):
    kind=item['content_kind'];d=item.get('discovery') or {}
    theme=(d.get('domain') if kind=='discovery' else 'culture') or 'other'
    # For playful categories, use topical motif selection as well.
    if kind=='playful':
        key=d.get('topic_key','')
        if re.search('dog|cat|pet|animal',key):theme='pets'
        elif re.search('sock|mystery|lost',key):theme='mystery'
        elif re.search('music|sound|dance|concert',key):theme='music'
        elif re.search('pizza|coffee|food|meal',key):theme='food'
        elif re.search('planet|moon|space|alien|gravity',key):theme='space'
        elif re.search('travel|teleport|city|map|flight',key):theme='travel'
        elif re.search('movie|fiction|book|cinema',key):theme='movies_tv'
        elif re.search('sport|football',key):theme='sports'
        elif re.search('robot|phone|wifi|search|invention',key):theme='technology'
    dark,light,pale=PALETTES.get(theme,PALETTES['other'])
    base=shade(dark,light).convert('RGBA');g=ImageDraw.Draw(base,'RGBA')
    # Distinctive geometric accents; no photograph attribution / false imagery.
    for i in range(9):
        z=70+i*28;x=790+(i*53)%250;y=70+(i*41)%510
        g.ellipse((x-z,y-z,x+z,y+z),outline=(*rgb(pale),max(25,85-i*7)),width=2)
    g.rounded_rectangle((44,42,260,94),radius=23,fill=(*rgb('#1B486F'),255),outline=(*rgb('#6793B5'),255),width=2)
    g.text((66,54),'COSMOS',font=font(22,True),fill=(255,255,255,240),stroke_width=0)
    k='A QUESTION WORTH ASKING' if kind=='playful' else 'ONE STORY. MORE CONNECTIONS.'
    g.text((60,132),k,font=font(20,True),fill=(*rgb(pale),255))
    title=(item.get('title') if kind=='discovery' else item.get('x_text','').split('\n')[0]) or 'Look deeper.'
    title=re.sub(r'^([^\w\d]+)','',str(title))
    size=50
    lines=[]
    while size>32:
        ff=font(size,True);lines=wrap(g,title,ff,620,4)
        if len(lines)<=3:break
        size-=3
    y=193
    for line in lines:
        g.text((60,y),line,font=font(size,True),fill=(255,255,255,250),spacing=4)
        y+=size+16
    g.text((60,540),'Look deeper.  •  ptdtoday.com',font=font(24),fill=(234,243,255,235))
    # Clip visuals strictly to the right-side art region to keep headline legible.
    artwork=Image.new('RGBA',(WIDTH,HEIGHT),(0,0,0,0))
    art_draw=ImageDraw.Draw(artwork,'RGBA')
    draw_theme(art_draw,theme,rgb(pale))
    art_draw.rectangle((0,0,719,HEIGHT),fill=(0,0,0,0))
    base=Image.alpha_composite(base,artwork)
    out.parent.mkdir(parents=True,exist_ok=True)
    base.convert('RGB').save(out,format='PNG',optimize=True)
    with Image.open(out) as p:
        assert p.format=='PNG' and p.size==(1200,630)
    return theme


def inject_meta(page:Path,image_url:str,title:str):
    markup=page.read_text(encoding='utf8')
    if '</head>' not in markup.lower():raise ValueError('HTML page missing </head>: '+str(page))
    # Remove old conflicting cards, including generic/logo cards.
    for name in ('og:image','og:image:width','og:image:height','og:image:alt','twitter:image','twitter:image:alt','twitter:card'):
        markup=re.sub(r'<meta\s+[^>]*(?:property|name)\s*=\s*[\'\"]'+re.escape(name)+r'[\'\"][^>]*>\s*','',markup,flags=re.I)
    meta=(f'  <meta property="og:image" content="{html.escape(image_url,quote=True)}">\n'
          '  <meta property="og:image:width" content="1200">\n'
          '  <meta property="og:image:height" content="630">\n'
          f'  <meta property="og:image:alt" content="{html.escape(title,quote=True)}">\n'
          '  <meta name="twitter:card" content="summary_large_image">\n'
          f'  <meta name="twitter:image" content="{html.escape(image_url,quote=True)}">\n'
          f'  <meta name="twitter:image:alt" content="{html.escape(title,quote=True)}">\n')
    markup=re.sub('</head>',meta+'</head>',markup,count=1,flags=re.I)
    page.write_text(markup,encoding='utf8')


def playful_page(item, page:Path,image_url:str):
    # A real explanatory landing page, no auto-redirect or inaccessible surprise.
    text=str(item.get('x_text') or '').strip()
    first=text.split('\n')[0]
    text=html.escape(text).replace('\n','<br>')
    link='https://ptdtoday.com/?utm_source=x&utm_medium=organic&utm_campaign=cosmos_visual_v5&utm_content='+slug_id(item['id'])
    title=html.escape(first,quote=True)
    desc=html.escape('A question to spark your curiosity. Ask anything, explore connections, and look deeper with public COSMOS.',quote=True)
    page_url=SITE+'/x/'+page.name
    doc=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,follow"><title>{title} · COSMOS</title><meta name="description" content="{desc}"><link rel="canonical" href="{html.escape(page_url,quote=True)}"><meta property="og:title" content="{title}"><meta property="og:description" content="{desc}"><meta property="og:url" content="{html.escape(page_url,quote=True)}"><meta name="referrer" content="strict-origin-when-cross-origin"></head>
<body style="margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f5f9fc;color:#102f54"><main style="max-width:690px;margin:7vh auto;padding:30px"><p style="font-size:1.05rem;letter-spacing:6px;font-weight:800">COSMOS</p><p style="color:#54708c">Look deeper.</p><section style="background:white;border:1px solid #deebf3;border-radius:27px;box-shadow:0 12px 50px #16395616;padding:28px 32px"><img src="{html.escape(image_url,quote=True)}" alt="COSMOS curiosity card" width="600" height="315" style="width:100%;height:auto;border-radius:18px"><p style="font-size:clamp(1.2rem,3vw,1.8rem);line-height:1.45">{text}</p><p style="color:#5a7186">What's your answer? Continue exploring unexpected connections in public COSMOS.</p><a href="{html.escape(link,quote=True)}" style="display:inline-block;background:#164d86;color:white;font-weight:700;text-decoration:none;border-radius:40px;padding:17px 25px">Explore public COSMOS →</a></section><p style="font-size:.9rem;color:#71859b;margin-top:26px">Original hypothetical question. Not a news report. No account required to browse public COSMOS.</p></main></body></html>'''
    page.parent.mkdir(parents=True,exist_ok=True)
    page.write_text(doc,encoding='utf8')
    inject_meta(page,image_url,first)
    return SITE+'/x/'+page.name


def main():
    queue=json.loads(QUEUE.read_text(encoding='utf8'))
    if queue.get('policy',{}).get('mode')!='cosmos_x_v4_curiosity_and_discovery':
        raise ValueError('Expected v4 content queue; refusing to rewrite a different queue schema')
    items=queue.get('items') or []
    if len(items)!=3 or [r.get('content_kind') for r in items]!=['discovery','playful','discovery']:
        raise ValueError('Unexpected queue sequence')
    for item in items:
        ident=slug_id(item['id'])
        image=CARDS/(ident+'.png')
        image_url=SITE+'/assets/cosmos-x-cards/'+image.name
        theme=render_card(item,image)
        item.setdefault('discovery',{})['visual_theme']=theme
        item['discovery']['visual_card_url']=image_url
        if item['content_kind']=='discovery':
            # Canonical question pages were already generated by v4.
            u=item['source_url'].split('?',1)[0]
            if not u.startswith(SITE+'/q/'):raise ValueError('Invalid public question URL')
            slug=Path(u).name
            if not re.fullmatch(r'[a-zA-Z0-9_-]+\.html',slug):raise ValueError('Unsafe question URL')
            question=ROOT/'q'/slug
            if not question.exists():raise FileNotFoundError(question)
            inject_meta(question,image_url,str(item.get('title') or 'COSMOS Question'))
        else:
            # Create a public landing page to give a question-specific X card.
            page=FUN/(ident+'.html')
            url=playful_page(item,page,image_url)
            item['source_url']=url+'?utm_source=x&utm_medium=organic&utm_campaign=cosmos_visual_v5&utm_content='+ident
    queue['policy']['visuals']='original_locally_rendered_per_post_1200x630_png'
    queue['policy']['social_cards_note']='Preview images use original vector art and source-based text; the publisher must append source_url for OG cards to appear.'
    QUEUE.write_text(json.dumps(queue,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('COSMOS X v5 cards:',[(r['id'],r['discovery']['visual_theme']) for r in items])

if __name__=='__main__':
    try:main()
    except Exception as error:
        print('COSMOS_X_VISUAL_ERROR:',error,file=sys.stderr)
        sys.exit(1)
