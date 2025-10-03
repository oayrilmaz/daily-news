#!/usr/bin/env python3
"""
Builds PTD Today data and shortlinks.

- Reads multiple RSS/Atom feeds
- Extracts title/link/summary/time/image
- Classifies into: Grid, Substations, Protection, Cables, HVDC, Renewables, Policy
- Ensures LinkedIn-safe image (HTTPS, non-SVG) with fallback to /assets/og-default.png
- Writes:
    data/news.json              (with "items": [...], each item has "slug")
    data/shortlinks.json        (mapping original link -> slug)
    s/<slug>.html               (shortlink pages with OG tags + meta refresh)
"""

import os, json, re, time, hashlib, urllib.parse
from datetime import datetime
from html import unescape

import feedparser
from bs4 import BeautifulSoup

# ------------ CONFIG ------------
SITE = "https://ptdtoday.com"
OG_FALLBACK = f"{SITE}/assets/og-default.png"

FEEDS = [
    "https://www.tdworld.com/rss",
    "https://www.utilitydive.com/feeds/news/",
    "https://feeds.reuters.com/reuters/energy",
    "https://www.powermag.com/feed/",
    "https://www.ieee-pes.org/feed/",
]

OUT_DIR = "data"
NEWS_JSON = os.path.join(OUT_DIR, "news.json")
SHORT_JSON = os.path.join(OUT_DIR, "shortlinks.json")
SHORT_DIR = "s"
MAX_ITEMS = 60
# --------------------------------

def ensure_dir(p):
    os.makedirs(p, exist_ok=True)

def strip_html(x:str)->str:
    if not x: return ""
    return BeautifulSoup(x, "lxml").get_text(" ", strip=True)

def find_first_img(html: str) -> str:
    if not html: return ""
    soup = BeautifulSoup(html, "lxml")
    tag = soup.find("img")
    src = tag.get("src") if tag else ""
    return src or ""

def is_safe_image(url: str) -> bool:
    if not url: return False
    u = url.strip()
    if not u.startswith("https://"): return False
    if u.lower().endswith(".svg"): return False
    return True

def classify(title: str, summary: str) -> str:
    txt = (title + " " + summary).lower()
    if any(w in txt for w in ["substation", "switchgear"]): return "Substations"
    if any(w in txt for w in ["relay", "protection", "iec 61850", "distance protection"]): return "Protection"
    if any(w in txt for w in ["cable", "xlpe", "underground cable", "submarine cable"]): return "Cables"
    if "hvdc" in txt: return "HVDC"
    if any(w in txt for w in ["policy", "regulat", "tariff", "ferc", "doe rule"]): return "Policy"
    if any(w in txt for w in ["renewable", "solar", "wind", "battery", "storage", "hydrogen"]): return "Renewables"
    return "Grid"

def best_image(entry) -> str:
    # try media_content / links / encoded / summary
    try:
        if "media_content" in entry and entry.media_content:
            url = entry.media_content[0].get("url") or ""
            if is_safe_image(url): return url
    except Exception: pass

    try:
        for l in getattr(entry, "links", []):
            if l.get("type","").startswith("image/"):
                url = l.get("href") or ""
                if is_safe_image(url): return url
    except Exception: pass

    enc = ""
    if hasattr(entry,"content") and entry.content:
        enc = entry.content[0].value or ""
    desc = getattr(entry, "summary", "") or getattr(entry, "description", "")

    for html in (enc, desc):
        url = find_first_img(html)
        if is_safe_image(url): return url

    return ""

def parse_time(entry) -> str:
    # output: ISO 8601 string (for client-side "relative time")
    # prefer published / updated parsed
    for fld in ("published_parsed", "updated_parsed"):
        t = getattr(entry, fld, None)
        if t: 
            return datetime(*t[:6]).isoformat()
    s = getattr(entry, "published", "") or getattr(entry, "updated", "")
    try:
        pt = feedparser.parse("")._parse_date(s)
    except Exception:
        pt = None
    if pt:
        return datetime(*pt[:6]).isoformat()
    return datetime.utcnow().isoformat()

def slug6(link: str) -> str:
    # stable short 6-hex slug
    return hashlib.blake2b(link.encode("utf-8"), digest_size=3).hexdigest()

def article_url(item: dict) -> str:
    # build internal article.html URL with query
    q = {
        "t": item["title"],
        "u": item["url"],
        "d": item["summary"][:280],
        "i": item["image"] if is_safe_image(item["image"]) else OG_FALLBACK,
        "g": item["category"],
        "p": item["time"],
    }
    return f"{SITE}/article.html?" + urllib.parse.urlencode(q, safe="")

def short_html(slug: str, item: dict) -> str:
    og_title = item["title"]
    og_desc  = item["summary"][:220]
    og_img   = item["image"] if is_safe_image(item["image"]) else OG_FALLBACK
    url_self = f"{SITE}/s/{slug}.html"
    target   = article_url(item)
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

def collect_items():
    items=[]
    for url in FEEDS:
        f = feedparser.parse(url)
        for e in f.entries:
            title = unescape(getattr(e,"title","")).strip()
            link  = getattr(e,"link","").strip()
            if not title or not link: 
                continue
            summary = unescape(getattr(e,"summary","") or getattr(e,"description",""))
            img = best_image(e)
            cat = classify(title, summary)
            t_iso = parse_time(e)
            items.append({
                "title": title,
                "url":   link,
                "summary": strip_html(summary),
                "time":  t_iso,
                "category": cat,
                "image": img
            })
    # de-dup by link (keep first/newest) + sort by time desc
    seen=set(); uniq=[]
    for it in items:
        if it["url"] in seen: 
            continue
        seen.add(it["url"])
        uniq.append(it)
    uniq.sort(key=lambda x: x["time"], reverse=True)
    return uniq[:MAX_ITEMS]

def main():
    ensure_dir(OUT_DIR)
    ensure_dir(SHORT_DIR)

    items = collect_items()

    # attach slug + write shortlinks
    lookup = {}
    for it in items:
        slug = slug6(it["url"])
        it["slug"] = slug
        lookup[it["url"]] = slug
        with open(os.path.join(SHORT_DIR, f"{slug}.html"), "w", encoding="utf-8") as f:
            f.write(short_html(slug, it))

    with open(SHORT_JSON, "w", encoding="utf-8") as f:
        json.dump(lookup, f, ensure_ascii=False, indent=2)

    payload = {
        "generated_at": datetime.utcnow().isoformat(),
        "items": items
    }
    with open(NEWS_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(items)} items")
    print(f"- {NEWS_JSON}")
    print(f"- {SHORT_JSON}")
    print(f"- {SHORT_DIR}/<slug>.html")

if __name__ == "__main__":
    main()
