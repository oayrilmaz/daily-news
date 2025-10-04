#!/usr/bin/env python3
"""
PTD Today - Pull news directly from main sources.

Finder: Bing News RSS (no key needed)
Guardrails:
  - Follow redirects to final URL (canonical)
  - Only accept stories whose FINAL domain is in APPROVED_DOMAINS
  - Scrape og:image (or twitter:image) for a thumbnail
  - Keep items for a rolling "workday" window (Sat=Fri+Sat, Sun=Fri+Sat+Sun, Mon=Fri+Sat+Sun+Mon, Tue=Mon+Tue, Wed=Tue+Wed, Thu=Wed+Thu, Fri=Thu+Fri)

Outputs:
  data/news.json   # list of articles (newest first)
"""

from __future__ import annotations
import hashlib
import json
import re
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse, quote

import requests
from bs4 import BeautifulSoup

# ----------------- CONFIG -----------------
OUTPUT_FILE = "data/news.json"

# 1) Approved original publishers
APPROVED_DOMAINS = {
    # Named by you
    "benzinga.com",
    "datacenterdynamics.com",

    # Core energy / T&D publishers we already use
    "reuters.com",
    "utilitydive.com",
    "powermag.com",
    "tdworld.com",
    "ieee.org",
    "entsoe.eu",
    "ferc.gov",
    "energy.gov",
    "marketscreener.com",
    "prnewswire.com",
    "businesswire.com",
    "marketwatch.com",
    "abb.com",
    "se.com",                    # Schneider Electric
    "hitachienergy.com",
    "siemens-energy.com",
    "gevernova.com",
    "ge.com",
    "nexans.com",
    "prysmiangroup.com",
    "mitsubishipower.com",
    "powellind.com",
}

# 2) What we look for at each source
#    Each entry: (domain, list of keyword phrases to OR)
#    We'll build a query like: site:DOMAIN (kw1 OR kw2 OR kw3 ...)
SOURCE_QUERIES = [
    ("benzinga.com", ["energy", "grid", "utilities", "transmission", "substation", "HVDC"]),
    ("datacenterdynamics.com", ["grid", "power", "substation", "HV", "HVDC", "transmission"]),
    ("reuters.com", ["grid", "power", "transmission", "substation", "HVDC"]),
    ("utilitydive.com", ["transmission", "grid", "substation", "HVDC"]),
    ("powermag.com", ["grid", "transmission", "substation", "HVDC", "cables"]),
    ("tdworld.com", ["transmission", "substation", "protection", "HVDC", "cables"]),
    ("ieee.org", ["power", "grid", "HVDC", "substation"]),
    ("entsoe.eu", ["grid", "HVDC"]),
    ("ferc.gov", ["transmission", "rule", "tariff", "order"]),
    ("energy.gov", ["grid", "transmission", "funding", "infrastructure"]),
    ("marketscreener.com", ["Schneider Electric", "Siemens Energy", "Hitachi Energy", "GE Vernova"]),
    ("prnewswire.com", ["grid", "HVDC", "substation", "transmission"]),
    ("businesswire.com", ["grid", "HVDC", "substation", "transmission"]),
    ("marketwatch.com", ["utilities", "grid", "transmission"]),
    ("abb.com", ["grid", "HVDC", "substation", "cable"]),
    ("se.com", ["grid", "HVDC", "substation", "medium voltage", "switchgear"]),
    ("hitachienergy.com", ["HVDC", "interconnector", "grid", "substation"]),
    ("siemens-energy.com", ["HVDC", "grid", "substation"]),
    ("gevernova.com", ["HVDC", "grid", "substation"]),
    ("ge.com", ["energy", "grid", "HVDC"]),
    ("nexans.com", ["HV cable", "interconnector", "subsea cable", "grid"]),
    ("prysmiangroup.com", ["HV cable", "interconnector", "subsea cable", "grid"]),
    ("mitsubishipower.com", ["HVDC", "grid", "substation"]),
    ("powellind.com", ["substation", "switchgear"]),
]

# 3) Supply chain topics (run against broad news but keep only approved domains after resolve)
SUPPLY_CHAIN_TERMS = [
    "transformer lead time",
    "equipment shortage power grid",
    "high voltage cable supply",
    "switchgear delay",
    "logistics cost power equipment",
    "transport pricing energy equipment",
]

# ------------------------------------------

UA = "Mozilla/5.0 (compatible; PTDTodayBot/1.0; +https://ptdtoday.com)"
HEADERS = {"User-Agent": UA}

def included_dates(today=None) -> set[str]:
    """Return allowed date set (YYYY-MM-DD, UTC) by your rule."""
    if today is None:
        today = datetime.now(timezone.utc).date()
    wd = today.weekday()  # Mon=0 ... Sun=6

    def d(offset): return (today + timedelta(days=offset))
    keep = set()
    if wd == 5:          # Sat -> Fri + Sat
        keep |= {d(-1), d(0)}
    elif wd == 6:        # Sun -> Fri + Sat + Sun
        keep |= {d(-2), d(-1), d(0)}
    elif wd == 0:        # Mon -> Fri + Sat + Sun + Mon
        keep |= {d(-3), d(-2), d(-1), d(0)}
    elif wd == 1:        # Tue -> Mon + Tue
        keep |= {d(-1), d(0)}
    elif wd == 2:        # Wed -> Tue + Wed
        keep |= {d(-1), d(0)}
    elif wd == 3:        # Thu -> Wed + Thu
        keep |= {d(-1), d(0)}
    elif wd == 4:        # Fri -> Thu + Fri
        keep |= {d(-1), d(0)}
    return {x.isoformat() for x in keep}

def md5_6(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()[:6]

def strip_html(s: str) -> str:
    return re.sub(r"<[^>]+>", " ", s or "").replace("&nbsp;", " ").strip()

def parse_pubdate(pub: str) -> str:
    """Return ISO8601 UTC or ''."""
    try:
        dt = parsedate_to_datetime(pub)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return ""

def domain_of(url: str) -> str:
    try:
        return urlparse(url).netloc.lower().replace("www.", "")
    except Exception:
        return ""

def resolve_final_url(url: str) -> str:
    """Follow redirects to get the final publisher URL."""
    try:
        r = requests.get(url, headers=HEADERS, timeout=12, allow_redirects=True)
        r.raise_for_status()
        return r.url
    except Exception:
        return url  # best effort

def fetch_bing_rss(query: str) -> str | None:
    url = f"https://www.bing.com/news/search?q={quote(query)}&format=rss"
    try:
        r = requests.get(url, headers=HEADERS, timeout=12)
        r.raise_for_status()
        return r.text
    except Exception:
        return None

def parse_rss(xml: str) -> list[dict]:
    from xml.etree import ElementTree as ET
    out = []
    try:
        root = ET.fromstring(xml)
        for item in root.findall(".//item"):
            title = item.findtext("title") or ""
            link = item.findtext("link") or ""
            pub = item.findtext("pubDate") or ""
            desc = item.findtext("{http://purl.org/rss/1.0/modules/content/}encoded") \
                   or item.findtext("description") or ""
            if not (title and link):
                continue
            out.append({
                "title": strip_html(title),
                "link": link.strip(),
                "date": parse_pubdate(pub),
                "summary": strip_html(desc)[:320]
            })
    except Exception:
        pass
    return out

def coerce_https(url: str) -> str:
    if not url:
        return ""
    p = urlparse(url)
    if p.scheme == "https":
        return url
    if p.scheme == "http":
        # Proxy HTTP images to HTTPS for iOS/Pages
        host_path = url.replace("http://", "", 1)
        return f"https://images.weserv.nl/?url={quote(host_path)}"
    return url

def fetch_og_image(page_url: str) -> str:
    try:
        r = requests.get(page_url, headers=HEADERS, timeout=10)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "lxml")
        for sel in [
            "meta[property='og:image']",
            "meta[name='og:image']",
            "meta[name='twitter:image']",
            "meta[property='twitter:image']",
        ]:
            tag = soup.select_one(sel)
            if tag and tag.get("content"):
                img = tag["content"].strip()
                if img.lower().endswith(".svg"):
                    continue
                return coerce_https(img)
    except Exception:
        pass
    return ""

def time_ago(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        diff = (now - dt).total_seconds()
        if diff < 60: return "just now"
        m = int(diff // 60)
        if m < 60: return f"{m} min ago"
        h = int(m // 60)
        if h < 24: return f"{h} h ago"
        d = int(h // 24)
        return f"{d} d ago"
    except Exception:
        return ""

def build_queries() -> list[str]:
    queries = []
    # Site-targeted queries
    for dom, kws in SOURCE_QUERIES:
        if not kws:
            queries.append(f"site:{dom}")
            continue
        or_block = " OR ".join([f'"{k}"' for k in kws])
        queries.append(f"site:{dom} ({or_block})")
    # Supply chain broad terms (finder), will filter by approved after resolve
    for term in SUPPLY_CHAIN_TERMS:
        queries.append(f'{term}')
    return queries

def main():
    allowed_days = included_dates()
    seen_urls = set()
    results = []

    queries = build_queries()
    for q in queries:
        xml = fetch_bing_rss(q)
        if not xml:
            continue
        items = parse_rss(xml)
        for it in items:
            if not it["date"]:
                continue
            day = it["date"][:10]
            if day not in allowed_days:
                continue

            # resolve to final URL and validate source domain
            final_url = resolve_final_url(it["link"])
            dom = domain_of(final_url)
            if dom not in APPROVED_DOMAINS:
                continue  # enforce original publisher only

            if final_url in seen_urls:
                continue
            seen_urls.add(final_url)

            img = fetch_og_image(final_url)

            results.append({
                "title": it["title"],
                "url": final_url,
                "source": dom,
                "image": img,                 # may be "", index uses fallback
                "summary": it["summary"],
                "date": it["date"],
                "timeAgo": time_ago(it["date"]),
                "id": md5_6(final_url)
            })

    # newest first
    results.sort(key=lambda x: x["date"], reverse=True)

    # write JSON list
    os_make_dirs("data")
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"Saved {len(results)} stories from approved sources.")
    print("Allowed days (UTC):", sorted(allowed_days))

# --- tiny helper (mkdir -p) ---
import os
def os_make_dirs(path: str):
    os.makedirs(path, exist_ok=True)

if __name__ == "__main__":
    main()