# pull_news.py
# PTD Today — fetch sector news and keep only the allowed day window.
# Uses Bing News RSS + OG-image scraping (no API keys required).

import hashlib
import json
import re
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse, quote

import requests
from bs4 import BeautifulSoup
from email.utils import parsedate_to_datetime

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PTDTodayBot/1.0; +https://ptdtoday.com)"
}

OUTPUT_FILE = "data/news.json"

# Targeted queries: companies, grid/HVDC, and supply-chain angles
QUERIES = [
    # Companies
    "GE Vernova energy",
    "Siemens Energy grid",
    "Hitachi Energy transmission",
    "Schneider Electric grid",
    "ABB power grid",
    "Mitsubishi Power grid",
    "Nexans cable",
    "Prysmian HV cable",
    "Powell substation",

    # Topics
    "HVDC converter station",
    "high voltage substation project",
    "power transmission line project",
    "transformer lead time",
    "equipment shortage power grid",
    "cable supply chain energy",
    "switchgear delay",
    "logistics cost power equipment",
    "transport pricing energy equipment",
]

def included_dates(today=None):
    """
    Return a set of ISO dates (YYYY-MM-DD) to keep, based on rules:
      Sat: Fri + Sat
      Sun: Fri + Sat + Sun   <-- corrected
      Mon: Fri + Sat + Sun + Mon
      Tue: Mon + Tue
      Wed: Tue + Wed
      Thu: Wed + Thu
      Fri: Thu + Fri
    """
    if today is None:
        today = datetime.now(timezone.utc).date()
    wd = today.weekday()  # Mon=0 ... Sun=6

    def d(offset_days):  # date with offset
        return (today + timedelta(days=offset_days))

    keep = set()
    if wd == 5:          # Saturday
        keep |= {d(-1), d(0)}                       # Fri, Sat
    elif wd == 6:        # Sunday
        keep |= {d(-2), d(-1), d(0)}                # Fri, Sat, Sun
    elif wd == 0:        # Monday
        keep |= {d(-3), d(-2), d(-1), d(0)}         # Fri, Sat, Sun, Mon
    elif wd == 1:        # Tuesday
        keep |= {d(-1), d(0)}                       # Mon, Tue
    elif wd == 2:        # Wednesday
        keep |= {d(-1), d(0)}                       # Tue, Wed
    elif wd == 3:        # Thursday
        keep |= {d(-1), d(0)}                       # Wed, Thu
    elif wd == 4:        # Friday
        keep |= {d(-1), d(0)}                       # Thu, Fri

    return {x.isoformat() for x in keep}

def md5_6(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()[:6]

def strip_html(s: str) -> str:
    return re.sub(r"<[^>]+>", " ", s or "").replace("&nbsp;", " ").strip()

def coerce_https(url: str) -> str:
    if not url:
        return ""
    try:
        p = urlparse(url)
    except Exception:
        return ""
    if p.scheme == "https":
        return url
    if p.scheme == "http":
        # Proxy HTTP images so iOS/https is happy
        host_plus_path = url.replace("http://", "", 1)
        return f"https://images.weserv.nl/?url={quote(host_plus_path)}"
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
                return coerce_https(tag["content"].strip())
    except Exception:
        pass
    return ""

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
            # Normalize date → ISO (UTC)
            try:
                dt = parsedate_to_datetime(pub)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                dt = dt.astimezone(timezone.utc)
                iso = dt.isoformat()
            except Exception:
                iso = ""
            out.append({
                "title": strip_html(title),
                "url": link,
                "date": iso,
                "summary": strip_html(desc)[:320]
            })
    except Exception:
        pass
    return out

def time_ago(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        diff = (now - dt).total_seconds()
        if diff < 60: return "just now"
        m = diff // 60
        if m < 60: return f"{int(m)} min ago"
        h = m // 60
        if h < 24: return f"{int(h)} h ago"
        d = h // 24
        return f"{int(d)} d ago"
    except Exception:
        return ""

def main():
    today = datetime.now(timezone.utc).date()
    keep_days = included_dates(today)
    print("Keeping days:", sorted(keep_days))

    articles = []
    seen = set()

    for q in QUERIES:
        xml = fetch_bing_rss(q)
        if not xml:
            continue
        items = parse_rss(xml)
        for a in items:
            if not a["date"]:
                continue
            day = a["date"][:10]  # YYYY-MM-DD (UTC)
            if day not in keep_days:
                continue

            url = a["url"]
            if url in seen:
                continue
            seen.add(url)

            # derive source from domain
            try:
                dom = urlparse(url).netloc
                source = dom.replace("www.", "")
            except Exception:
                source = ""

            img = fetch_og_image(url)  # may be ""
            articles.append({
                "title": a["title"],
                "url": url,
                "source": source,
                "image": img,
                "summary": a["summary"],
                "date": a["date"],
                "timeAgo": time_ago(a["date"]),
                "id": md5_6(url)
            })

    # newest first
    articles.sort(key=lambda x: x["date"], reverse=True)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(articles, f, indent=2, ensure_ascii=False)

    print(f"Saved {len(articles)} items to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()