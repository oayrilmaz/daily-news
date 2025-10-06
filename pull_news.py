#!/usr/bin/env python3
import hashlib, json, os, re, sys
from datetime import datetime, timezone, timedelta
from html import unescape

import requests
import feedparser
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.abspath(__file__))

DATA_DIR = os.path.join(ROOT, 'data')
S_DIR = os.path.join(ROOT, 's')
TEMPLATE_FILE = os.path.join(ROOT, 'article.html')
NEWS_FILE = os.path.join(DATA_DIR, 'news.json')
DEFAULT_IMG = "/assets/og-default.png"

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(S_DIR, exist_ok=True)

# ------------- Sources (stable RSS where possible)
SOURCES = [
    # Data center & grid / policy
    ("https://www.datacenterdynamics.com/en/rss.xml", "grid"),
    ("https://www.utilitydive.com/feeds/news/", "grid"),
    ("https://www.utilitydive.com/feeds/policy/", "policy"),
    # Reuters Energy (broad)
    ("https://feeds.reuters.com/reuters/USenergyNews", "grid"),
    # Company newsrooms (best-effort; if 404, script continues)
    ("https://press.siemens-energy.com/en/pressreleases.xml", "grid"),
    ("https://www.hitachienergy.com/us/en/news/rss", "grid"),
]

def fetch_feed(url, category):
    try:
        f = feedparser.parse(url)
        items = []
        for e in f.entries[:40]:
            title = unescape(e.get('title','')).strip()
            link = e.get('link') or e.get('id')
            if not (title and link): 
                continue
            published = None
            for key in ('published_parsed','updated_parsed'):
                if e.get(key):
                    published = datetime(*e[key][:6], tzinfo=timezone.utc)
                    break
            if not published:
                published = datetime.now(tz=timezone.utc)

            # Try to find an image
            img = None
            if 'media_content' in e and e.media_content:
                img = e.media_content[0].get('url')
            if not img and 'media_thumbnail' in e and e.media_thumbnail:
                img = e.media_thumbnail[0].get('url')

            # Sometimes image lives in summary
            if not img:
                summary = e.get('summary','')
                m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', summary)
                if m:
                    img = m.group(1)

            items.append({
                "title": title,
                "url": link,
                "source": re.sub(r'^https?://(www\.)?','', (f.feed.get('link') or link)).split('/')[0],
                "category": category,
                "image": img or DEFAULT_IMG,
                "published": published.isoformat(),
                "summary": unescape(BeautifulSoup(e.get('summary',''), 'html.parser').get_text(' ', strip=True))[:280],
            })
        return items
    except Exception as ex:
        print(f"[warn] {url}: {ex}", file=sys.stderr)
        return []

def make_id(url: str) -> str:
    return hashlib.sha1(url.encode('utf-8')).hexdigest()[:6]

def score(item):
    # lightweight score: recency + title length
    age_h = max(1e-6, (datetime.now(timezone.utc) - datetime.fromisoformat(item['published'])).total_seconds()/3600)
    return round(1.0/age_h + min(1.0, len(item['title'])/140.0), 4)

def build_short_page(tpl:str, item:dict):
    html = tpl
    html = html.replace("%%TITLE%%", item['title'])
    html = html.replace("%%DESC%%", item.get('summary','') or "PTD Today")
    html = html.replace("%%IMG%%", item.get('image') or DEFAULT_IMG)
    html = html.replace("%%CANON%%", f"https://ptdtoday.com/s/{item['id']}.html")
    html = html.replace("%%ORIG%%", item['url'])
    return html

def main():
    print("Fetching feeds...")
    seen = set()
    items = []
    for url, cat in SOURCES:
        items.extend(fetch_feed(url, cat))

    # de-dup by canonical url host+title
    dedup = {}
    for it in items:
        k = (re.sub(r'https?://(www\.)?','', it['url']).split('/')[0].lower(), it['title'].lower())
        if k in dedup: 
            continue
        it['id'] = make_id(it['url'])
        it['score'] = score(it)
        dedup[k] = it
    items = list(dedup.values())

    # Keep last ~150 by time
    items.sort(key=lambda x: x['published'], reverse=True)
    items = items[:150]

    # write JSON
    out = {"updated": datetime.now(timezone.utc).isoformat(), "items": items}
    with open(NEWS_FILE, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    # shortlink pages
    with open(TEMPLATE_FILE, 'r', encoding='utf-8') as f:
        tpl = f.read()
    for it in items:
        path = os.path.join(S_DIR, f"{it['id']}.html")
        with open(path, 'w', encoding='utf-8') as f:
            f.write(build_short_page(tpl, it))

    print(f"Wrote {len(items)} stories, news.json & short pages.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())