#!/usr/bin/env python3
"""
PTD Today news puller

- Aggregates fresh headlines from sector sources (RSS/Atom).
- Normalizes into /data/news.json (with {updated, items:[...]})
- Ensures /data/shortlinks.json maps id -> /s/<id>.html
- Creates /s/<id>.html pages with OG tags for social sharing.
- Runs safely even if some feeds fail (best-effort).

Author: PTD Today (automation)
"""

from __future__ import annotations
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
import feedparser
from bs4 import BeautifulSoup
from dateutil import parser as dateparser

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
S_DIR = os.path.join(ROOT, "s")

NEWS_JSON = os.path.join(DATA_DIR, "news.json")
SHORT_JSON = os.path.join(DATA_DIR, "shortlinks.json")

MAX_ITEMS = 80  # keep the list reasonably sized

# ---- Feeds (best-effort). Add/remove freely. ----
# (category, feed_url)
FEEDS = [
    # Core sector pubs
    ("grid",         "https://www.tdworld.com/rss"),                     # T&D World
    ("policy",       "https://www.utilitydive.com/feeds/news/"),         # Utility Dive
    ("datacenter",   "https://www.datacenterdynamics.com/en/rss/"),      # DataCenterDynamics (we'll map to 'grid' or 'hvdc' later)
    # Vendor / OEM newsroom feeds (where available)
    ("renewables",   "https://www.gevernova.com/news/rss"),              # GE Vernova (if 404, script continues)
    ("renewables",   "https://press.siemens-energy.com/en/pressreleases/rss.xml"),  # Siemens Energy press
    ("grid",         "https://www.hitachienergy.com/rss/news"),          # Hitachi Energy news (path may change; best-effort)
    ("protection",   "https://www.se.com/ww/en/work/insights/newsroom/news/rss.xml"),  # Schneider Electric
    # Energy markets / general
    ("policy",       "https://feeds.reuters.com/reuters/USenergyNews"),
]

# Keywords to weight categories (if feed doesn't provide a useful category)
KEYWORDS = {
    "hvdc":      [r"\bhvdc\b", r"high[- ]voltage direct current"],
    "cables":    [r"\bcable(s)?\b", r"\bconductor(s)?\b"],
    "substations":[r"\bsubstation(s)?\b", r"\bgis\b", r"\bswitchgear\b"],
    "protection":[r"\bprotection\b", r"\brelay(s|ing)?\b", r"\bscada\b", r"\biec ?61850\b"],
    "grid":      [r"\bgrid\b", r"\btransmission\b", r"\bdistribution\b"],
    "renewables":[r"\bwind\b", r"\bsolar\b", r"\brenewable(s)?\b", r"\benergy storage\b", r"\bbattery\b"],
    "policy":    [r"\bferc\b", r"\bdoe\b", r"\bpolicy\b", r"\bregulat(ion|ory)\b"],
}

# Supply chain / logistics mentions (we don't label separately, but useful if later you want a badge)
SUPPLY_CHAIN = [r"lead time", r"backlog", r"supply chain", r"transformer shortage", r"logistics", r"freight", r"shipping", r"port", r"container"]

# ---------- helpers ----------

def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def domain_of(url: str) -> str:
    try:
        return urlparse(url).netloc.replace("www.", "")
    except Exception:
        return ""

def sha_id(url: str, n=6) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:n]

def safe_get(url: str, timeout=12) -> requests.Response | None:
    try:
        r = requests.get(url, timeout=timeout, headers={"User-Agent": "PTD-Today/1.0"})
        if r.status_code == 200:
            return r
    except Exception:
        pass
    return None

def guess_image_from_html(url: str) -> str | None:
    r = safe_get(url)
    if not r:
        return None
    soup = BeautifulSoup(r.text, "lxml")
    # common OG tags
    og = soup.find("meta", property="og:image")
    if og and og.get("content"):
        return og["content"]
    twitter = soup.find("meta", attrs={"name":"twitter:image"})
    if twitter and twitter.get("content"):
        return twitter["content"]
    # fall back to first <img>
    img = soup.find("img")
    if img and img.get("src"):
        return img["src"]
    return None

def choose_category(feed_cat: str, title: str, summary: str) -> str:
    base = (feed_cat or "").lower()
    if base in ("grid", "substations", "protection", "cables", "hvdc", "renewables", "policy"):
        return base
    text = f"{title} {summary}".lower()
    for cat, pats in KEYWORDS.items():
        for pat in pats:
            if re.search(pat, text):
                return cat
    # Datacenter headlines → grid by default
    if base == "datacenter":
        return "grid"
    return "grid"

def parse_time(entry) -> str:
    # entry.published_parsed is a time.struct_time for most feeds
    if getattr(entry, "published", None):
        try:
            dt = dateparser.parse(entry.published)
            if not dt.tzinfo:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()
        except Exception:
            pass
    return now_iso()

def best_image(entry, url: str) -> str | None:
    # RSS media:content?
    try:
        if hasattr(entry, "media_content"):
            for m in entry.media_content:
                link = m.get("url")
                if link:
                    return link
    except Exception:
        pass
    # <enclosure url=... type=image/>
    try:
        if hasattr(entry, "enclosures"):
            for e in entry.enclosures:
                link = e.get("href") or e.get("url")
                if link:
                    return link
    except Exception:
        pass
    # Fallback to OG scrape
    return guess_image_from_html(url)

def short_html(id_: str, title: str, url: str, image: str | None) -> str:
    img = image or "https://ptdtoday.com/assets/og-default.png"  # optional default
    safe_title = (title or "PTD Today").replace('"', '&quot;')
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{safe_title} — PTD Today</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url={url}">
<link rel="canonical" href="{url}">
<meta property="og:site_name" content="PTD Today">
<meta property="og:type" content="article">
<meta property="og:title" content="{safe_title}">
<meta property="og:description" content="Headlines curated by PTD Today. Click to read at the original publisher.">
<meta property="og:url" content="https://ptdtoday.com/s/{id_}.html">
