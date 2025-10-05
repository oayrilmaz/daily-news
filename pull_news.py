#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
PTD Today – News Aggregator
---------------------------
Pulls sector news from trustworthy RSS/Atom feeds, normalizes, ranks,
writes:
  - data/news.json
  - data/shortlinks.json
  - s/<id>.html shortlink pages (with OG tags)
  
Categories supported on the site:
  Grid, Substations, Protection, Cables, HVDC, Renewables, Policy

Notes:
- Uses OpenGraph <meta> to discover thumbnail images.
- Adds referrer-safe fallback image /assets/og-default.png at render time.
- Ranking = simple recency + source weight; you can tune WEIGHTS below.
"""

import os, json, time, hashlib, re
from datetime import datetime, timedelta, timezone
import requests
from bs4 import BeautifulSoup
import feedparser

SITE = "https://ptdtoday.com"
FALLBACK_IMG = "/assets/og-default.png"
OUT_NEWS = "data/news.json"
OUT_SHORTS = "data/shortlinks.json"
SHORTS_DIR = "s"

# ---------- Sources (add/remove freely) ----------
# Each tuple: (feed_url, default_category, source_name)
FEEDS = [
    # Sector publishers
    ("https://www.utilitydive.com/feeds/news/",           "Grid",         "Utility Dive"),
    ("https://www.datacenterdynamics.com/en/rss/",        "Grid",         "DataCenterDynamics"),
    ("https://www.reuters.com/finance/energy/rss",        "Policy",       "Reuters Energy"),
    ("https://www.tdworld.com/rss",                       "Grid",         "T&D World"),
    ("https://www.greentechmedia.com/rss",                "Renewables",   "Greentech Media"),  # if 410/redirects, it’ll just skip
    
    # Company newsrooms (some don’t publish often; still helpful)
    ("https://www.gevernova.com/newsroom/rss.xml",        "Grid",         "GE Vernova"),
    ("https://www.siemens-energy.com/global/en/newsroom/_jcr_content.rss.xml", "Grid", "Siemens Energy"),
    ("https://www.hitachienergy.com/rss/news",            "Grid",         "Hitachi Energy"),
    ("https://blog.schneider-electric.com/feed/",         "Protection",   "Schneider Electric"),
    ("https://newsroom.xcelenergy.com/releases.rss",      "Policy",       "Xcel Energy"),
    ("https://www.duke-energy.com/rss/newsreleases",      "Policy",       "Duke Energy"),
]

# ---------- Optional heuristics to refine category ----------
KEYMAP = [
    (r"\bhvdc\b",               "HVDC"),
    (r"\bsubstation|switchgear|breaker|relay\b", "Substations"),
    (r"\bprotection|relaying|protection and control\b", "Protection"),
    (r"\bcable|cabling|underground cable|subsea cable\b", "Cables"),
    (r"\bwind|solar|renewable|pv\b",             "Renewables"),
    (r"\bferc|doe|epa|policy|regulator|regulation\b", "Policy"),
    (r"\bgrid|transmission|distribution|tsos?|dsos?\b", "Grid"),
]

# ---------- Per-source weights for simple ranking ----------
WEIGHTS = {
    "Utility Dive": 1.1,
    "DataCenterDynamics": 1.05,
    "Reuters Energy": 1.05,
    "T&D World": 1.0,
    "GE Vernova": 0.95,
    "Siemens Energy": 0.95,
    "Hitachi Energy": 0.95,
    "Schneider Electric": 0.9,
    "Xcel Energy": 0.9,
    "Duke Energy": 0.9,
}

# ---------- Helpers ----------
def now_utc_iso():
    return datetime.now(timezone.utc).isoformat()

def sha(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:6]

def pick_category(title: str, default_cat: str) -> str:
    t = (title or "").lower()
    for pat, cat in KEYMAP:
        if re.search(pat, t):
            return cat
    return default_cat

def to_iso(parsed):
    # Try to convert feedparser time to ISO
    try:
        dt = datetime(*parsed[:6], tzinfo=timezone.utc)
        return dt.isoformat()
    except Exception:
        return now_utc_iso()

def fetch_og(url: str) -> dict:
    """Grab OG <meta> for image/title; return dict with 'image','title' best-effort."""
    out = {"image": "", "title": ""}
    try:
        r = requests.get(url, timeout=10, headers={"User-Agent":"Mozilla/5.0"})
        if r.ok:
            soup = BeautifulSoup(r.text, "html.parser")
            og_img = soup.find("meta", property="og:image")
            og_title = soup.find("meta", property="og:title")
            if og_img and og_img.get("content"):
                out["image"] = og_img["content"]
            if og_title and og_title.get("content"):
                out["title"] = og_title["content"]
    except Exception:
        pass
    return out

def score_item(source: str, published_iso: str) -> float:
    """Recency + weight."""
    w = WEIGHTS.get(source, 1.0)
    try:
        age_h = (datetime.now(timezone.utc) - datetime.fromisoformat(published_iso)).total_seconds()/3600.0
    except Exception:
        age_h = 0.0
    # fresher is higher; min guard to avoid division by zero
    rec = 1.0 / (1.0 + max(0.1, age_h/24.0))
    return round(rec * w, 4)

# ---------- Shortlink page writer ----------
REDIRECT_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>%%TITLE%% — PTD Today</title>
<meta http-equiv="refresh" content="0; url=%%ORIG%%">
<meta property="og:title" content="%%TITLE%%">
<meta property="og:image" content="%%IMAGE%%">
<meta property="og:description" content="Open on PTD Today, then continue to the original source.">
<meta property="og:type" content="article">
<meta property="og:url" content="%%SELF%%">
<meta name="twitter:card" content="summary_large_image">
<style>body{font-family:Georgia,serif;margin:40px;line-height:1.5}</style>
</head>
<body>
  <p>Redirecting to the original article…</p>
  <p><a href="%%ORIG%%">Continue</a></p>
</body>
</html>
"""

def write_shortlink_page(short_id: str, original: str, title: str, image: str):
    os.makedirs(SHORTS_DIR, exist_ok=True)
    html = (REDIRECT_TEMPLATE
            .replace("%%ORIG%%", original)
            .replace("%%TITLE%%", title or "PTD Today")
            .replace("%%IMAGE%%", image or (SITE + FALLBACK_IMG))
            .replace("%%SELF%%", f"{SITE}/s/{short_id}.html"))
    with open(os.path.join(SHORTS_DIR, f"{short_id}.html"), "w", encoding="utf-8") as f:
        f.write(html)

# ---------- Main ----------
def main():
    items = []
    seen = set()

    print("Fetching feeds...")
    for feed_url, default_cat, source in FEEDS:
        try:
            fp = feedparser.parse(feed_url)
        except Exception:
            continue
        for e in fp.entries[:40]:
            link = e.get("link") or e.get("id") or ""
            title = (e.get("title") or "").strip()
            if not link or not title: 
                continue
            key = (link, title)
            if key in seen: 
                continue
            seen.add(key)

            # published
            pub_iso = to_iso(e.get("published_parsed") or e.get("updated_parsed") or time.gmtime())

            # guess category from title/keywords
            cat = pick_category(title, default_cat)

            # basic og fetch (to get image; title may improve)
            og = fetch_og(link)
            image = og.get("image") or ""
            if og.get("title"):
                title = og["title"].strip()

            items.append({
                "title": title,
                "original": link,
                "source": source,
                "published": pub_iso,
                "category": cat,
                "image": image,
            })

    # sort newest first
    items.sort(key=lambda x: x["published"], reverse=True)

    # score and limit (keep a healthy number)
    for it in items:
        it["score"] = score_item(it["source"], it["published"])

    items = items[:120]

    # build shortlinks & map
    shortlinks = {}
    for it in items:
        sid = sha(it["original"])
        shortlinks[sid] = it["original"]
        write_shortlink_page(sid, it["original"], it["title"], it.get("image") or "")
        it["id"] = sid  # keep in JSON for debugging/joins if you want

    # write JSONs
    os.makedirs("data", exist_ok=True)
    with open(OUT_NEWS, "w", encoding="utf-8") as f:
        json.dump({"updated": now_utc_iso(), "items": items}, f, indent=2)

    with open(OUT_SHORTS, "w", encoding="utf-8") as f:
        json.dump(shortlinks, f, indent=2)

    print(f"Wrote {OUT_NEWS} with {len(items)} items, and {len(shortlinks)} shortlinks.")

if __name__ == "__main__":
    main()