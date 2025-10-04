import hashlib
import json
import re
from datetime import datetime, timezone
from urllib.parse import urlparse, quote

import requests
from bs4 import BeautifulSoup

# -----------------------------
# QUERIES (company + topics)
# -----------------------------
NEWS_SOURCES = [
    # Companies
    "GE Vernova energy site:reuters.com",
    "Siemens Energy site:businesswire.com",
    "Hitachi Energy site:prnewswire.com",
    "Schneider Electric site:marketscreener.com",
    "ABB grid",
    "Mitsubishi Power",
    "Powell substation",

    # Sector topics
    "power transmission equipment shortage",
    "transformer lead time extension",
    "high voltage cable supply chain",
    "international shipping costs energy",
    "HV substation project delay",
]

OUTPUT_NEWS_FILE = "data/news.json"
OUTPUT_SHORTLINKS_FILE = "data/shortlinks.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PTDTodayBot/1.0; +https://ptdtoday.com)"
}

def md5_6(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()[:6]

def fetch_bing_rss(query: str) -> str | None:
    url = f"https://www.bing.com/news/search?q={quote(query)}&format=rss"
    try:
        r = requests.get(url, headers=HEADERS, timeout=12)
        r.raise_for_status()
        return r.text
    except Exception as e:
        print("RSS error:", query, e)
        return None

def parse_rss(xml: str, query: str) -> list[dict]:
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
                "link": link,
                "date": pub,
                "summary": strip_html(desc)[:320],
                "topic": query
            })
    except Exception as e:
        print("Parse RSS error:", e)
    return out

def strip_html(s: str) -> str:
    # quick HTML stripper
    return re.sub(r"<[^>]+>", " ", s or "").replace("&nbsp;", " ").strip()

def coerce_https(url: str) -> str:
    # Some sources return http images; mobile Safari blocks mixed content.
    # If http -> use a proxy that returns https.
    if not url:
        return ""
    try:
        p = urlparse(url)
    except Exception:
        return ""
    if p.scheme == "https":
        return url
    if p.scheme == "http":
        # Proxy through a free https image proxy
        return f"https://images.weserv.nl/?url={quote(url.replace('http://','',1))}"
    return url

def fetch_og_image(page_url: str) -> str:
    # Try to get og:image / twitter:image from the article page
    try:
        r = requests.get(page_url, headers=HEADERS, timeout=10)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "lxml")
        # Priority order
        for sel in [
            "meta[property='og:image']",
            "meta[name='og:image']",
            "meta[name='twitter:image']",
            "meta[property='twitter:image']",
        ]:
            tag = soup.select_one(sel)
            if tag and tag.get("content"):
                return coerce_https(tag["content"].strip())
    except Exception as e:
        print("OG image error:", page_url, e)
    return ""

def main():
    all_items = []
    shortlinks = {}

    for q in NEWS_SOURCES:
        xml = fetch_bing_rss(q)
        if not xml: 
            continue
        arts = parse_rss(xml, q)
        for a in arts:
            slug = md5_6(a["link"])
            img = fetch_og_image(a["link"])  # try to get a thumbnail
            if not img:
                img = ""  # index will fall back to default
            shortlinks[slug] = a["link"]
            all_items.append({
                "id": slug,
                "title": a["title"],
                "link": a["link"],
                "date": a["date"],
                "summary": a.get("summary",""),
                "topic": a["topic"],
                "image": img
            })

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "articles": all_items
    }
    with open(OUTPUT_NEWS_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    with open(OUTPUT_SHORTLINKS_FILE, "w", encoding="utf-8") as f:
        json.dump(shortlinks, f, indent=2)

    print(f"Saved {len(all_items)} articles with {len(shortlinks)} shortlinks")

if __name__ == "__main__":
    main()