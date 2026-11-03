#!/usr/bin/env python3
"""COSMOS v8: make exact-headline original PNG cards AFTER editorial verification.

Reads the file written by scripts/cosmos_autonomous_publish_v7_4.mjs.
In dry_run, writes cards ONLY into the artifact folder. In live mode,
outputs ONLY to assets/cosmos-approved-cards/<approved-id>.png.
"""
import json
import math
import os
import re
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

MANIFEST = Path('artifacts/cosmos-autonomous-publish/cards-to-render.json')
ID = re.compile(r'^global-[a-z0-9-]{8,110}$')
S = (1200, 630)


def font(size, bold=False):
    paths = (["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"] if bold
             else ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                   "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"])
    for path in paths:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def lines_for(draw, value, target_px, loaded):
    words = value.strip().split()
    lines, current = [], ''
    for w in words:
        candidate = (current + ' ' + w).strip()
        if draw.textbbox((0, 0), candidate, font=loaded)[2] <= target_px:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = w
    if current:
        lines.append(current)
    return lines


def render_card(item):
    question = str(item['question']).strip()
    category = str(item.get('category', 'world')).upper().strip()[:28]
    date = str(item.get('date', ''))[:10]
    image = Image.new('RGB', S, (250, 252, 254))
    d = ImageDraw.Draw(image)
    # Subtle Cosmos orbital geometry; all draw primitives are deterministic.
    cx, cy = 1030, 315
    for r, width, tint in [(270, 2, (202, 224, 236)), (216, 2, (187, 216, 230)),
                           (162, 2, (160, 207, 225)), (103, 4, (27, 104, 130))]:
        d.ellipse((cx-r,cy-r,cx+r,cy+r), outline=tint, width=width)
    d.ellipse((cx-48, cy-48, cx+48, cy+48), fill=(18, 41, 64))
    for i in range(12):
        angle = 2 * math.pi * i / 12 + .34
        rad = 216 if i % 2 else 162
        x, y = cx + rad*math.cos(angle), cy + rad*math.sin(angle)
        size = 4 if i % 3 else 7
        d.ellipse((x-size,y-size,x+size,y+size), fill=(75, 153, 177))
    d.rounded_rectangle((62, 46, 390, 94), radius=24, fill=(21, 48, 72))
    d.text((83, 57), 'PTD TODAY  /  COSMOS', font=font(20, True), fill=(255,255,255))
    d.text((68, 126), 'GLOBAL QUESTIONS  /  ' + category, font=font(19, True), fill=(29, 114, 147))
    # All headline copy must fit. Never publish an automatically truncated question.
    chosen = None
    for size in (54, 50, 46, 42, 39, 36, 33, 30, 27, 24):
        loaded = font(size, True)
        rows = lines_for(d, question, 885, loaded)
        height = int(size * 1.35) * len(rows)
        if len(rows) <= 6 and height <= 320:
            chosen = (loaded, rows, size)
            break
    if not chosen:
        raise ValueError('Headline cannot fit safely; refusing truncated image: ' + question[:80])
    loaded, rows, size = chosen
    y = 196
    for row in rows:
        d.text((67, y), row, font=loaded, fill=(19, 36, 53))
        y += int(size * 1.34)
    d.line((68, 550, 1134, 550), fill=(203, 218, 224), width=2)
    d.text((68, 566), 'EVIDENCE + ANSWER  •  PTDTODAY.COM', font=font(20, True), fill=(47, 95, 113))
    if date:
        d.text((1042, 567), date, font=font(16), fill=(99, 113, 124))
    return image


def write_card(item):
    item_id = item.get('id', '')
    if not ID.fullmatch(item_id):
        raise ValueError('Invalid COSMOS publication id')
    destination = str(item.get('path', '')).replace('\\', '/')
    permitted = ('assets/cosmos-approved-cards/' + item_id + '.png',
                 'artifacts/cosmos-autonomous-publish/cards/' + item_id + '.png')
    if destination not in permitted:
        raise ValueError('Refusing unexpected output path: ' + destination)
    image = render_card(item)
    output = Path(destination)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, format='PNG', optimize=True)
    if output.stat().st_size < 5000 or output.stat().st_size > 5_000_000:
        raise ValueError('Generated card size out of range: ' + destination)
    print('COSMOS v8 matched-headline card:', output, f'{output.stat().st_size} bytes')


def self_test():
    with tempfile.TemporaryDirectory() as path:
        cwd = Path.cwd()
        try:
            os.chdir(path)
            item_id = 'global-sample-card-abcdef123456'
            write_card(dict(id=item_id, question='How did Novak Djokovic recover to win his Paris Masters opening match against Valentin Vacherot?', category='sports', date='2026-11-03', path='artifacts/cosmos-autonomous-publish/cards/' + item_id + '.png'))
            assert Path('artifacts/cosmos-autonomous-publish/cards/' + item_id + '.png').is_file()
            try:
                write_card(dict(id=item_id, question='A question?', path='../other.png'))
                assert False, 'Unsafe path accepted'
            except ValueError:
                pass
        finally:
            os.chdir(cwd)
    print('COSMOS v8 CARD SELF TEST PASS: headline render, PNG validation, path safety')


if __name__ == '__main__':
    if os.getenv('COSMOS_CARD_SELF_TEST') == '1':
        self_test()
    else:
        if not MANIFEST.exists():
            raise RuntimeError('Publisher did not write card manifest; stop release')
        jobs = json.loads(MANIFEST.read_text(encoding='utf8'))
        if not isinstance(jobs, list) or len(jobs) > 10:
            raise ValueError('Invalid card manifest')
        for job in jobs:
            write_card(job)
        print(f'COSMOS v8 complete: {len(jobs)} image(s) created')
