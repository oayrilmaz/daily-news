#!/usr/bin/env python3
import os, re, json, hashlib, urllib.parse, time
from html import unescape
from datetime import datetime

import feedparser
from bs4 import BeautifulSoup

# ---------- Config ----------
FEEDS = [
    "https://www.tdworld.com/rss",
    "https://www.utilitydive.com/feeds/news/",
    "https://feeds.reuters.com/reuters/energy",
    "https://www.powermag.com/feed/",
    "https://www.ieee-pes.org/feed/"
]
SITE = "https://ptdtoday.com"
SHORT_DIR = "s"
LOOKUP_JSON = "data/shortlinks.json"
TOP_JSON = "data/top.json"
# ----------------------------

def ensure_dir(p):
    if not os.path.isdir(p):
        os.makedirs(p, exist_ok=True)

def strip_html(x):
    return BeautifulSoup(x or "", "lxml").get_text(" ", strip=True)

def find_img(html):
    if not html: return ""
    soup = BeautifulSoup(html, "lxml")
    img = soup.find("img")
    return img["src"] if img and img.has_attr("src") else ""

def tag_for(title, desc):
    k = (title + " " + desc).lower()
    if any(w in k for w in ["substation","switchgear"]): return "substation"
    if any(w in k for w in ["relay","protection","iec"]): return "protection"
    if any(w in k for w in ["cable","xlpe"]): return "cable"
    if "hvdc" in k: return "hvdc"
    if any(w in k for w in ["policy","tariff","regulat"]): return "policy"
    if any(w in k for w in ["renewable","solar","wind"]): return "renewable"
    return "grid"

def fetch_items():
    items=[]
    for url in FEEDS:
        f = feedparser.parse(url)
        for e in f.entries:
            title = unescape(getattr(e,"title","")).strip()
            link  = getattr(e,"link","").strip()
            if not title or not link: continue
            desc = unescape(getattr(e,"summary","") or getattr(e,"description",""))
            content = ""
            if hasattr(e,"content") and e.content:
                content = e.content[0].value or ""
            img = find_img(content) or find_img(desc)
            pub = getattr(e, "published", "") or getattr(e, "updated", "")
            items.append({
                "title": title,
                "link": link,
                "desc": strip_html(desc)[:500],
                "img": img,
                "tag": tag_for(title, desc),
                "pubDate": pub
            })
    # de-dup by link, newest first
    seen=set(); uniq=[]
    for it in items:
        if it["link"] in seen: continue
        seen.add(it["link"]); uniq.append(it)
    def sort_key(it):
        try:
            return time.mktime(feedparser._parse_date(it["pubDate"]))
        except Exception:
            return 0
    uniq.sort(key=sort_key, reverse=True)
    return uniq[:60]

def slug6(link:str)->str:
    """Short 6-hex slug from link (stable)."""
    return hashlib.blake2b(link.encode("utf-8"), digest_size=3).hexdigest()  # 6 hex chars

def esc(s): return (s or "").replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")

def internal_article_url(it):
    t = urllib.parse.quote(it["title"], safe="")
    u = urllib.parse.quote(it["link"],  safe="")
    d = urllib.parse.quote(it["desc"],  safe="")
    i = urllib.parse.quote(it["img"] or "", safe="")
    g = urllib.parse.quote(it["tag"],  safe="")
    p = urllib.parse.quote(it["pubDate"] or "", safe="")
    return f"{SITE}/article.html?t={t}&u={u}&d={d}&i={i}&g={g}&p={p}"

def short_html(slug, it):
    og_title = esc(it["title"]) or "PTD Today"
    og_desc  = esc(it["desc"])[:220]
    og_img   = it["img"] if (it["img"] and it["img"].startswith("http")) else f"{SITE}/logo.svg"
    url_self = f"{SITE}/s/{slug}.html"
    target   = internal_article_url(it)
    return f"""<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<title>{og_title}</title>
<meta property="og:title" content="{og_title}">
<meta property="og:description" content="{og_desc}">
<meta property="og:image" content="{og_img}">
<meta property="og:url" content="{url_self}">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url={target}">
<link rel="canonical" href="{target}">
</head><body>
<p>Redirecting to <a href="{target}">PTD Today</a>…</p>
</body></html>"""

def build_shortlinks(items):
    ensure_dir(SHORT_DIR)
    ensure_dir(os.path.dirname(LOOKUP_JSON))
    lookup={}
    for it in items:
        slug = slug6(it["link"])
        lookup[it["link"]] = slug
        with open(os.path.join(SHORT_DIR, f"{slug}.html"), "w", encoding="utf-8") as f:
            f.write(short_html(slug, it))
    with open(LOOKUP_JSON, "w", encoding="utf-8") as f:
        json.dump(lookup, f, ensure_ascii=False, indent=2)

def write_top(items):
    ensure_dir(os.path.dirname(TOP_JSON))
    with open(TOP_JSON, "w", encoding="utf-8") as f:
        json.dump(items[:24], f, ensure_ascii=False, indent=2)

def main():
    items = fetch_items()
    write_top(items)
    build_shortlinks(items)
    print(f"Built {len(items)} items; shortlinks in /s; lookup at {LOOKUP_JSON}")

if __name__ == "__main__":
    main()
