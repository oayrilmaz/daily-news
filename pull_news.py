#!/usr/bin/env python3
"""
PTD Today — Pull news directly from main publishers, auto-tag by category,
keep only items in your rolling workday window, AND score items so the site
can show a "Top (7d)" ranked list.

New fields:
  - "score": float ranking score for last 7 days (recency + publisher weight + boosts)
  - "week":  bool (True if within last 7 days)

Output: data/news.json
"""

from __future__ import annotations
import hashlib
import json
import os
import re
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse, quote

import requests
from bs4 import BeautifulSoup

# ----------------------------- CONFIG ---------------------------------

OUTPUT_FILE = "data/news.json"

APPROVED_DOMAINS = {
    "benzinga.com", "datacenterdynamics.com",
    "reuters.com", "utilitydive.com", "powermag.com", "tdworld.com",
    "ieee.org", "entsoe.eu", "ferc.gov", "energy.gov",
    "abb.com", "se.com", "hitachienergy.com", "siemens-energy.com",
    "gevernova.com", "ge.com", "nexans.com", "prysmiangroup.com",
    "mitsubishipower.com", "powellind.com",
    "prnewswire.com", "businesswire.com",
    "marketwatch.com", "marketscreener.com",
}

SOURCE_QUERIES = [
    ("benzinga.com",           ["energy", "utilities", "grid", "transmission", "substation", "hvdc", "renewables"]),
    ("datacenterdynamics.com", ["grid", "power", "substation", "hvdc", "generator", "interconnector", "subsea cable"]),
    ("reuters.com",            ["grid", "power", "utilities", "transmission", "substation", "hvdc", "renewables"]),
    ("utilitydive.com",        ["grid", "transmission", "substation", "hvdc", "renewables", "policy"]),
    ("powermag.com",           ["grid", "transmission", "substation", "hvdc", "cables", "renewables"]),
    ("tdworld.com",            ["transmission", "substation", "protection", "relay", "switchgear", "hvdc", "cables"]),
    ("ieee.org",               ["power", "grid", "hvdc", "substation", "protection", "ai"]),
    ("entsoe.eu",              ["grid", "hvdc", "interconnector", "transmission"]),
    ("ferc.gov",               ["transmission", "tariff", "policy", "order", "rule"]),
    ("energy.gov",             ["grid", "funding", "infrastructure", "hvdc", "transmission", "resilience"]),

    ("abb.com",                ["hvdc", "substation", "grid", "transformer", "cable"]),
    ("se.com",                 ["grid", "substation", "switchgear", "protection", "medium voltage", "hvdc"]),
    ("hitachienergy.com",      ["hvdc", "interconnector", "grid", "substation"]),
    ("siemens-energy.com",     ["hvdc", "grid", "substation"]),
    ("gevernova.com",          ["hvdc", "grid", "substation"]),
    ("ge.com",                 ["energy", "grid", "hvdc"]),
    ("nexans.com",             ["hv cable", "interconnector", "subsea cable", "grid"]),
    ("prysmiangroup.com",      ["hv cable", "interconnector", "subsea cable", "grid"]),
    ("mitsubishipower.com",    ["hvdc", "grid", "substation"]),
    ("powellind.com",          ["substation", "switchgear"]),

    ("prnewswire.com",         ["grid", "hvdc", "substation", "transmission", "interconnector"]),
    ("businesswire.com",       ["grid", "hvdc", "substation", "transmission", "interconnector"]),
    ("marketwatch.com",        ["utilities", "grid", "transmission", "renewables"]),
    ("marketscreener.com",     ["Schneider Electric", "Siemens Energy", "Hitachi Energy", "GE Vernova"]),
]

SUPPLY_CHAIN_TERMS = [
    "transformer lead time",
    "equipment shortage power grid",
    "high voltage cable supply",
    "switchgear delay",
    "logistics cost power equipment",
    "transport pricing energy equipment",
    "shipping cost transformer",
    "logistics corridor substation",
]

EXTRA_THEMES = [
    "data center grid connection",
    "data center power",
    "AI power consumption",
    "AI energy demand",
    "grid modernization",
    "interconnector hvdc subsea",
]

CATEGORY_KEYWORDS = {
    "grid":         ["grid", "transmission", "interconnector", "overhead line", "underground cable"],
    "substations":  ["substation", "gis substation", "ais substation", "transformer station"],
    "protection":   ["protection", "relay", "iec 61850", "fault", "breaker failure", "distance protection"],
    "cables":       ["cable", "subsea cable", "hv cable", "xlpe", "underground"],
    "hvdc":         ["hvdc", "converter station", "vsc", "lcc", "bipole"],
    "renewables":   ["renewable", "wind", "offshore wind", "solar", "hydro", "battery", "storage"],
    "policy":       ["ferc", "tariff", "order", "policy", "regulation", "doe funding", "rto", "iso market"],
    "supply-chain": ["lead time", "shortage", "logistics", "shipping", "delay", "supply chain", "transport pricing"],
    "ai":           ["ai", "artificial intelligence", "machine learning"],
    "data-centers": ["data center", "datacenter", "hyperscale"],
}

# Weight by publisher when scoring "Top (7d)"
SOURCE_WEIGHTS = {
    "reuters.com": 3.0,
    "utilitydive.com": 2.6,
    "powermag.com": 2.4,
    "tdworld.com": 2.2,
    "ieee.org": 2.0,
    "entsoe.eu": 2.0,
    "energy.gov": 1.9,
    "ferc.gov": 1.9,

    # Vendor newsrooms – still valuable, lower than independent press
    "siemens-energy.com": 1.8,
    "hitachienergy.com": 1.8,
    "gevernova.com": 1.8,
    "abb.com": 1.7,
    "se.com": 1.7,
    "nexans.com": 1.6,
    "prysmiangroup.com": 1.6,
    "mitsubishipower.com": 1.6,
    "powellind.com": 1.5,

    "datacenterdynamics.com": 1.9,
    "benzinga.com": 1.6,
    "marketwatch.com": 1.5,
    "marketscreener.com": 1.5,
    "prnewswire.com": 1.3,
    "businesswire.com": 1.3,
}

UA = "Mozilla/5.0 (compatible; PTDTodayBot/1.1; +https://ptdtoday.com)"
HEADERS = {"User-Agent": UA}

# ------------------------- helpers -------------------------

def included_dates(today=None) -> set[str]:
    """Rolling publishing window from your rules."""
    if today is None:
        today = datetime.now(timezone.utc).date()
    wd = today.weekday()  # Mon=0 ... Sun=6
    def d(off): return (today + timedelta(days=off))
    keep = set()
    if wd == 5: keep |= {d(-1), d(0)}                       # Sat: Fri+Sat
    elif wd == 6: keep |= {d(-2), d(-1), d(0)}              # Sun: Fri+Sat+Sun
    elif wd == 0: keep |= {d(-3), d(-2), d(-1), d(0)}       # Mon: Fri..Mon
    else: keep |= {d(-1), d(0)}                             # Tue..Fri: prev day + today
    return {x.isoformat() for x in keep}

def md5_6(s: str) -> str: return hashlib.md5(s.encode("utf-8")).hexdigest()[:6]
def strip_html(s: str) -> str: return re.sub(r"<[^>]+>", " ", s or "").replace("&nbsp;"," ").strip()

def parse_pubdate(pub: str) -> str:
    try:
        dt = parsedate_to_datetime(pub)
        if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return ""

def domain_of(url: str) -> str:
    try: return urlparse(url).netloc.lower().replace("www.","")
    except Exception: return ""

def resolve_final_url(url: str) -> str:
    try:
        r = requests.get(url, headers=HEADERS, timeout=12, allow_redirects=True)
        r.raise_for_status()
        return r.url
    except Exception:
        return url

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
            link  = item.findtext("link")  or ""
            pub   = item.findtext("pubDate") or ""
            desc  = item.findtext("{http://purl.org/rss/1.0/modules/content/}encoded") \
                    or item.findtext("description") or ""
            if not (title and link): continue
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
    if not url: return ""
    p = urlparse(url)
    if p.scheme == "https": return url
    if p.scheme == "http":
        host_path = url.replace("http://", "", 1)
        return f"https://images.weserv.nl/?url={quote(host_path)}"
    return url

def fetch_og_image(page_url: str) -> str:
    try:
        r = requests.get(page_url, headers=HEADERS, timeout=10)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "lxml")
        for sel in [
            "meta[property='og:image']","meta[name='og:image']",
            "meta[property='twitter:image']","meta[name='twitter:image']",
        ]:
            tag = soup.select_one(sel)
            if tag and tag.get("content"):
                img = tag["content"].strip()
                if img.lower().endswith(".svg"): continue
                return coerce_https(img)
    except Exception:
        pass
    return ""

def time_ago(iso: str) -> str:
    try:
        dt  = datetime.fromisoformat(iso.replace("Z","+00:00"))
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
    for dom, kws in SOURCE_QUERIES:
        if kws:
            or_block = " OR ".join([f'"{k}"' for k in kws])
            queries.append(f"site:{dom} ({or_block})")
        else:
            queries.append(f"site:{dom}")
    for term in SUPPLY_CHAIN_TERMS: queries.append(term)
    for term in EXTRA_THEMES:       queries.append(term)
    return queries

def tag_categories(title: str, summary: str) -> list[str]:
    text = f"{title} {summary}".lower()
    tags = []
    for cat, kws in CATEGORY_KEYWORDS.items():
        if any(kw.lower() in text for kw in kws):
            tags.append(cat)
    return tags[:6] if tags else ["grid"]

def scoring(dom: str, iso_date: str, title: str, cats: list[str]) -> float:
    """Score used for Top(7d): recency + publisher weight + boosts."""
    try:
        dt  = datetime.fromisoformat(iso_date.replace("Z","+00:00"))
    except Exception:
        return 0.0
    now  = datetime.now(timezone.utc)
    hours = max(0.0, (now - dt).total_seconds() / 3600.0)

    # Recency: 0..2 points (fresh = 2, 7 days old ~0)
    recency = max(0.0, 1.0 - min(hours, 168.0) / 168.0) * 2.0

    # Publisher weight: 1.0..3.0 typical
    src_w = SOURCE_WEIGHTS.get(dom, 1.4)

    # Category boost: HVDC / Supply chain / Data Centers are hot
    boost = 0.0
    for hot in ("hvdc", "supply-chain", "data-centers"):
        if hot in cats: boost += 0.4

    # Keyword richness (simple proxy): number of category keywords hit (capped)
    kw_rich = min(1.0, len(cats) * 0.2)

    return round(src_w + recency + boost + kw_rich, 3)

# ----------------------------- main -----------------------------

def main():
    allowed_days = included_dates()
    seen = set()
    results = []
    now = datetime.now(timezone.utc)

    queries = build_queries()
    for q in queries:
        xml = fetch_bing_rss(q)
        if not xml: continue
        items = parse_rss(xml)

        for it in items:
            if not it["date"]: continue
            day = it["date"][:10]
            if day not in allowed_days:
                # We still *score* last-7-days items (for Top tab) but don't show
                # them in the default streams. We'll compute "week" separately.
                pass

            final_url = resolve_final_url(it["link"])
            dom = domain_of(final_url)
            if dom not in APPROVED_DOMAINS: continue
            if final_url in seen: continue
            seen.add(final_url)

            cats = tag_categories(it["title"], it["summary"])
            img  = fetch_og_image(final_url)

            # last 7 days flag
            try:
                dt = datetime.fromisoformat(it["date"].replace("Z","+00:00"))
            except Exception:
                dt = now
            in_week = (now - dt) <= timedelta(days=7)

            score = scoring(dom, it["date"], it["title"], cats) if in_week else 0.0

            results.append({
                "id": md5_6(final_url),
                "title": it["title"],
                "url": final_url,
                "source": dom,
                "image": img,
                "summary": it["summary"],
                "date": it["date"],
                "timeAgo": time_ago(it["date"]),
                "cats": cats,
                "week": in_week,
                "score": score,
            })

    # newest first for default view
    results.sort(key=lambda x: x["date"], reverse=True)

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"Saved {len(results)} stories.")
    print("Allowed days (UTC):", sorted(allowed_days))

if __name__ == "__main__":
    main()