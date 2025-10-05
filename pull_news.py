#!/usr/bin/env python3
from __future__ import annotations

import hashlib, json, os, re, time
from datetime import datetime, timezone
from urllib.parse import urlparse

import feedparser
import requests
from bs4 import BeautifulSoup
from dateutil import parser as dateparser

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
S_DIR = os.path.join(ROOT, "s")

NEWS_JSON = os.path.join(DATA, "news.json")
SHORT_JSON = os.path.join(DATA, "shortlinks.json")

MAX_ITEMS = 80

# --------- feeds (best-effort) ----------
FEEDS = [
    ("grid",        "https://www.tdworld.com/rss"),
    ("policy",      "https://www.utilitydive.com/feeds/news/"),
    ("grid",        "https://www.datacenterdynamics.com/en/rss/"),
    ("renewables",  "https://www.gevernova.com/news/rss"),
    ("renewables",  "https://press.siemens-energy.com/en/pressreleases/rss.xml"),
    ("grid",        "https://www.hitachienergy.com/rss/news"),
    ("protection",  "https://www.se.com/ww/en/work/insights/newsroom/news/rss.xml"),
    ("policy",      "https://feeds.reuters.com/reuters/USenergyNews"),
]

KEYWORDS = {
    "hvdc":        [r"\bhvdc\b", r"high[- ]voltage direct current"],
    "cables":      [r"\bcable(s)?\b", r"\bconductor(s)?\b"],
    "substations": [r"\bsubstation(s)?\b", r"\bgis\b", r"\bswitchgear\b"],
    "protection":  [r"\bprotection\b", r"\brelay(s|ing)?\b", r"\bscada\b", r"\biec ?61850\b"],
    "grid":        [r"\bgrid\b", r"\btransmission\b", r"\bdistribution\b", r"\bdatacenter(s)?\b"],
    "renewables":  [r"\bwind\b", r"\bsolar\b", r"\brenewable(s)?\b", r"\bbattery\b", r"\bstorage\b"],
    "policy":      [r"\bferc\b", r"\bdoe\b", r"\bpolicy\b", r"\bregulat(ion|ory)\b"],
}

def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def sha_id(url: str, n=6) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:n]

def domain(u: str) -> str:
    try: return urlparse(u).netloc.replace("www.","")
    except: return ""

def safe_get(url: str, timeout=12):
    try:
        r = requests.get(url, timeout=timeout, headers={"User-Agent":"PTD-Today/1.0"})
        if r.status_code == 200: return r
    except: pass
    return None

def og_image_from_page(url: str) -> str | None:
    r = safe_get(url); 
    if not r: return None
    s = BeautifulSoup(r.text, "lxml")
    og = s.find("meta", property="og:image")
    if og and og.get("content"): return og["content"]
    tw = s.find("meta", attrs={"name":"twitter:image"})
    if tw and tw.get("content"): return tw["content"]
    im = s.find("img")
    if im and im.get("src"): return im["src"]
    return None

def best_image(entry, url: str) -> str | None:
    try:
        if hasattr(entry, "media_content"):
            for m in entry.media_content:
                if m.get("url"): return m["url"]
    except: pass
    try:
        if hasattr(entry, "enclosures"):
            for e in entry.enclosures:
                link = e.get("href") or e.get("url")
                if link: return link
    except: pass
    return og_image_from_page(url)

def parse_time(entry) -> str:
    if getattr(entry, "published", None):
        try:
            dt = dateparser.parse(entry.published)
            if not dt.tzinfo: dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()
        except: pass
    return now_iso()

def choose_category(feed_cat: str, title: str, summary: str) -> str:
    base = (feed_cat or "").lower()
    if base in ("grid","substations","protection","cables","hvdc","renewables","policy"):
        return base
    text = f"{title} {summary}".lower()
    for cat, pats in KEYWORDS.items():
        for pat in pats:
            if re.search(pat, text):
                return cat
    if base == "datacenter": return "grid"
    return "grid"

def ensure_dirs():
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(S_DIR, exist_ok=True)

def load_json(path, fallback):
    if os.path.exists(path):
        try:
            with open(path,"r",encoding="utf-8") as f: return json.load(f)
        except: pass
    return fallback

def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp,"w",encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

def make_short_page(id_, title, url, image):
    img = image or "/assets/og-default.png"
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title} — PTD Today</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url={url}">
<link rel="canonical" href="{url}">
<meta property="og:site_name" content="PTD Today">
<meta property="og:type" content="article">
<meta property="og:title" content="{title}">
<meta property="og:description" content="Headlines curated by PTD Today. Click to read at the original publisher.">
<meta property="og:url" content="https://ptdtoday.com/s/{id_}.html">
<meta property="og:image" content="{img}">
<meta name="twitter:card" content="summary_large_image">
</head>
<body>
Redirecting to <a href="{url}">original source</a>…
</body>
</html>"""
    with open(os.path.join(S_DIR, f"{id_}.html"), "w", encoding="utf-8") as f:
        f.write(html)

def main():
    ensure_dirs()

    short = load_json(SHORT_JSON, {})
    items = []

    for feed_cat, feed_url in FEEDS:
        try:
            fp = feedparser.parse(feed_url)
        except Exception:
            continue
        for e in fp.entries[:25]:
            url = getattr(e, "link", "").strip()
            title = (getattr(e, "title", "") or "").strip()
            if not url or not title: continue

            summary = (getattr(e, "summary", "") or "").strip()
            img = best_image(e, url)
            cat = choose_category(feed_cat, title, summary)
            tpub = parse_time(e)
            src = domain(url)
            sid = sha_id(url, 6)

            # create/update short page
            if short.get(sid) != url:
                short[sid] = url
                make_short_page(sid, title.replace('"','&quot;'), url, img)

            item = {
                "id": sid,
                "title": title,
                "url": url,
                "image": img,
                "category": cat,
                "source": src,
                "published": tpub
            }
            items.append(item)

    # De-dup by id, keep most recent first
    seen = set()
    uniq = []
    for it in sorted(items, key=lambda x: x["published"], reverse=True):
        if it["id"] in seen: continue
        seen.add(it["id"])
        uniq.append(it)
        if len(uniq) >= MAX_ITEMS: break

    news = {
        "updated": now_iso(),
        "items": uniq
    }

    write_json(NEWS_JSON, news)
    write_json(SHORT_JSON, short)

if __name__ == "__main__":
    main()
