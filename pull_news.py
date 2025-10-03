#!/usr/bin/env python3
"""
PTD Today builder:
- Fetches multiple feeds every run (so even if some sources are unchanged, others can refresh)
- Normalizes: title, link, summary, time, image, category
- Guarantees LinkedIn-safe image (HTTPS, non-SVG) with fallback
- Outputs:
   data/news.json            {generated_at, items:[...]}
   data/shortlinks.json      original_link -> slug
   s/<slug>.html             per-article OG redirect pages
"""

import os, json, hashlib, urllib.parse
from datetime import datetime
from html import unescape

import feedparser
from bs4 import BeautifulSoup

# ---------- CONFIG ----------
SITE = "https://ptdtoday.com"
OG_FALLBACK = f"{SITE}/assets/og-default.png"
OUT_DIR = "data"
NEWS_JSON = os.path.join(OUT_DIR, "news.json")
SHORT_JSON = os.path.join(OUT_DIR, "shortlinks.json")
SHORT_DIR = "s"
MAX_ITEMS = 80

# A broad mix of reputable sources — script tries ALL of these each run.
FEEDS = [
    "https://www.tdworld.com/rss",
    "https://www.utilitydive.com/feeds/news/",
    "https://feeds.reuters.com/reuters/energy",
    "https://www.powermag.com/feed/",
    "https://www.ieee-pes.org/feed/",
    "https://www.eei.org/rss/AllNews.xml",
    "https://www.entsoe.eu/feed/",
    "https://www.ferc.gov/rss.xml",
    "https://www.energy.gov/oe/articles/feed",
]
# ----------------------------

def ensure_dir(p): os.makedirs(p, exist_ok=True)

def text_only(html: str) -> str:
    if not html: return ""
    return BeautifulSoup(html, "lxml").get_text(" ", strip=True)

def first_img(html: str) -> str:
    if not html: return ""
    soup = BeautifulSoup(html, "lxml")
    tag = soup.find("img")
    return (tag.get("src") if tag else "") or ""

def is_linkedin_safe_image(url: str) -> bool:
    if not url: return False
    u = url.strip().lower()
    return u.startswith("https://") and not u.endswith(".svg")

def classify(title: str, summary: str) -> str:
    t = (title + " " + summary).lower()
    if any(w in t for w in ["substation", "switchgear"]): return "Substations"
    if any(w in t for w in ["relay", "protection", "iec 61850", "distance protection"]): return "Protection"
    if any(w in t for w in ["cable", "xlpe", "submarine cable"]): return "Cables"
    if "hvdc" in t: return "HVDC"
    if any(w in t for w in ["policy", "regulat", "tariff", "ferc", "doe rule"]): return "Policy"
    if any(w in t for w in ["renewable", "solar", "wind", "battery", "storage", "hydrogen"]): return "Renewables"
    return "Grid"

def parse_time(entry) -> str:
    # prefer parsed timestamps if present
    for fld in ("published_parsed", "updated_parsed"):
        t = getattr(entry, fld, None)
        if t:
            return datetime(*t[:6]).isoformat()
    # fallback: try to parse free-text date
    s = getattr(entry, "published", "") or getattr(entry, "updated", "")
    try:
        pt = feedparser.parse("")._parse_date(s)
        if pt:
            return datetime(*pt[:6]).isoformat()
    except Exception:
        pass
    return datetime.utcnow().isoformat()  # never blank

def best_image(entry) -> str:
    # media_content
    try:
        if "media_content" in entry and entry.media_content:
            url = entry.media_content[0].get("url") or ""
            if is_linkedin_safe_image(url): return url
    except Exception:
        pass
    # enclosure/links
    try:
        for l in getattr(entry, "links", []):
            if l.get("type", "").startswith("image/"):
                url = l.get("href") or ""
                if is_linkedin_safe_image(url): return url
    except Exception:
        pass
    # content/summary scrapes
    enc = entry.content[0].value if getattr(entry, "content", None) else ""
    desc = getattr(entry, "summary", "") or getattr(entry, "description", "")
    for html in (enc, desc):
        url = first_img(html)
        if is_linkedin_safe_image(url): return url
    return ""  # let caller fallback

def slug6(link: str) -> str:
    return hashlib.blake2b(link.encode("utf-8"), digest_size=3).hexdigest()

def article_url(item: dict) -> str:
    q = {
        "t": item["title"],
        "u": item["url"],
        "d": item["summary"][:280],
        "i": item["image"] if is_linkedin_safe_image(item["image"]) else OG_FALLBACK,
        "g": item["category"],
        "p": item["time"],
    }
    return f"{SITE}/article.html?" + urllib.parse.urlencode(q, safe="")

def short_html(slug: str, item: dict) -> str:
    og_title = item["title"]
    og_desc  = item["summary"][:220]
    og_img   = item["image"] if is_linkedin_safe_image(item["image"]) else OG_FALLBACK
    url_self = f"{SITE}/s/{slug}.html"
    target   = article_url(item)
    return f"""<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<title>{og_title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:site_name" content="PTD Today">
<meta property="og:title" content="{og_title}">
<meta property="og:description" content="{og_desc}">
<meta property="og:image" content="{og_img}">
<meta property="og:url" content="{url_self}">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url={target}">
<link rel="canonical" href="{target}">
<style>html,body{{margin:0;font:16px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}}.wrap{{padding:24px}}</style>
</head><body><div class="wrap">Redirecting to <a href="{target}">PTD Today</a>…</div></body></html>"""

def collect():
    items = []
    for url in FEEDS:
        f = feedparser.parse(url)
        for e in f.entries:
            title = unescape(getattr(e, "title", "")).strip()
            link  = getattr(e, "link", "").strip()
            if not title or not link:
                continue
            desc  = getattr(e, "summary", "") or getattr(e, "description", "")
            summary = text_only(unescape(desc))[:500]

            img = best_image(e)
            cat = classify(title, summary)
            t_iso = parse_time(e)

            items.append({
                "title": title,
                "url":   link,
                "summary": summary,
                "time":  t_iso,
                "category": cat,
                "image": img
            })

    # de-dup by link and sort newest first
    seen = set()
    uniq = []
    for it in items:
        if it["url"] in seen:  # skip duplicates (many feeds cross-post)
            continue
        seen.add(it["url"])
        uniq.append(it)
    uniq.sort(key=lambda x: x["time"], reverse=True)
    return uniq[:MAX_ITEMS]

def main():
    ensure_dir(OUT_DIR)
    ensure_dir(SHORT_DIR)

    items = collect()
    # always try ALL sources each run; even if some feeds don’t change,
    # others can update the page.

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
