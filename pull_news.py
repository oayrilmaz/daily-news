#!/usr/bin/env python3
import os, re, json, hashlib, urllib.parse, time
from datetime import datetime, timezone
from html import unescape

import feedparser
from bs4 import BeautifulSoup

# ------------------ CONFIG ------------------
FEEDS = [
    "https://www.tdworld.com/rss",
    "https://www.utilitydive.com/feeds/news/",
    "https://feeds.reuters.com/reuters/energy",
    "https://www.powermag.com/feed/",
    "https://www.ieee-pes.org/feed/"
]

SHORT_DIR = "s"                        # where short HTML pages live
LOOKUP_JSON = "data/shortlinks.json"   # original-link -> slug
TOP_JSON = "data/top.json"             # optional list for debugging/other uses
SITE_ORIGIN = "https://ptdtoday.com"   # used in generated short pages
# -------------------------------------------

def ensure_dir(p):
    if not os.path.isdir(p):
        os.makedirs(p, exist_ok=True)

def strip_html(x):
    if not x: return ""
    return BeautifulSoup(x, "lxml").get_text(" ", strip=True)

def find_img(html):
    if not html: return ""
    soup = BeautifulSoup(html, "lxml")
    img = soup.find("img")
    return img["src"] if img and img.has_attr("src") else ""

def tag_for(title, desc):
    k = (title + " " + desc).lower()
    if any(w in k for w in ["substation","switchgear"]): return "substation"
    if any(w in k for w in ["relay","protection","iec"]): return "protection"
    if any(w in k for w in ["cable","hvdc","xlpe"]): return "cable"
    if any(w in k for w in ["policy","tariff","regulat"]): return "policy"
    if any(w in k for w in ["data center","datacenter"]): return "datacenter"
    if any(w in k for w in ["renewable","solar","wind"]): return "renewable"
    return "grid"

def fetch_items():
    items = []
    for url in FEEDS:
        f = feedparser.parse(url)
        for e in f.entries:
            title = unescape(getattr(e, "title", "")).strip()
            link  = getattr(e, "link", "").strip()
            desc  = getattr(e, "summary", "") or getattr(e, "description", "")
            desc  = unescape(desc)
            content = ""
            if hasattr(e, "content") and e.content:
                content = e.content[0].value or ""
            img = find_img(content) or find_img(desc)
            pub = ""
            if getattr(e, "published", ""):
                pub = e.published
            elif getattr(e, "updated", ""):
                pub = e.updated

            if not title or not link:
                continue

            items.append({
                "title": title,
                "link": link,
                "desc": strip_html(desc)[:500],
                "img": img,
                "tag": tag_for(title, desc),
                "pubDate": pub
            })
    # de-dup by link, keep first (usually the newest sort later)
    seen = set()
    dedup = []
    for it in items:
        if it["link"] in seen: continue
        seen.add(it["link"]); dedup.append(it)

    # sort newest first where possible
    def sort_key(it):
        try:
            return time.mktime(feedparser._parse_date(it["pubDate"]))
        except Exception:
            return 0
    dedup.sort(key=sort_key, reverse=True)
    return dedup[:60]   # cap

def slugify(title, link):
    base = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')[:40]
    h = hashlib.blake2b(link.encode('utf-8'), digest_size=4).hexdigest()  # 8 chars
    return f"{base}-{h}" if base else h

def og_escape(s):
    return (s or "").replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").strip()

def build_article_url(it):
    t = urllib.parse.quote(it["title"], safe="")
    u = urllib.parse.quote(it["link"],  safe="")
    d = urllib.parse.quote(it["desc"],  safe="")
    i = urllib.parse.quote(it["img"] or "", safe="")
    g = urllib.parse.quote(it["tag"],  safe="")
    p = urllib.parse.quote(it["pubDate"] or "", safe="")
    return f"{SITE_ORIGIN}/article.html?t={t}&u={u}&d={d}&i={i}&g={g}&p={p}"

def build_short_page(slug, it):
    og_title = og_escape(it["title"]) or "PTD Today"
    og_desc  = og_escape(it["desc"])[:220]
    og_img   = it["img"] if (it["img"] and it["img"].startswith("http")) else f"{SITE_ORIGIN}/logo.svg"
    og_url   = f"{SITE_ORIGIN}/s/{slug}.html"
    target   = build_article_url(it)

    html = f"""<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<title>{og_title}</title>
<meta property="og:title" content="{og_title}">
<meta property="og:description" content="{og_desc}">
<meta property="og:image" content="{og_img}">
<meta property="og:url" content="{og_url}">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url={target}">
<link rel="canonical" href="{target}">
</head><body>
<p>Redirecting to <a href="{target}">PTD Today</a>…</p>
</body></html>"""
    return html

def build_shortlinks(items):
    ensure_dir(SHORT_DIR)
    ensure_dir(os.path.dirname(LOOKUP_JSON))
    lookup = {}
    for it in items:
        slug = slugify(it["title"], it["link"])
        lookup[it["link"]] = slug
        with open(os.path.join(SHORT_DIR, f"{slug}.html"), "w", encoding="utf-8") as f:
            f.write(build_short_page(slug, it))
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
    print(f"Generated {len(items)} items, shortlinks in /s, lookup at {LOOKUP_JSON}")

if __name__ == "__main__":
    main()
