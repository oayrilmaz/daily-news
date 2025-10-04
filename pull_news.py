import requests
import json
import hashlib
from datetime import datetime, timezone

NEWS_SOURCES = [
    # Company-specific
    "GE Vernova energy site:reuters.com",
    "Siemens Energy site:businesswire.com",
    "Hitachi Energy site:prnewswire.com",
    "Schneider Electric site:marketwatch.com",

    # Sector peers
    "ABB energy",
    "Mitsubishi Power",
    "Powell grid substation",

    # Topics
    "power transmission equipment shortage",
    "transformer lead time extension",
    "high voltage cable supply chain",
    "international shipping costs energy sector",
    "HV substation project delay",
]

OUTPUT_NEWS_FILE = "data/news.json"
OUTPUT_SHORTLINKS_FILE = "data/shortlinks.json"

def fetch_news(query, count=5):
    """Fetch news results from Bing News Search RSS."""
    url = f"https://www.bing.com/news/search?q={requests.utils.quote(query)}&format=rss"
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        return r.text
    except Exception as e:
        print(f"Error fetching {query}: {e}")
        return None

def parse_rss(xml, query):
    """Very simple RSS parser (title, link, pubDate)."""
    from xml.etree import ElementTree as ET
    results = []
    try:
        root = ET.fromstring(xml)
        for item in root.findall(".//item"):
            title = item.findtext("title")
            link = item.findtext("link")
            pubDate = item.findtext("pubDate")
            if title and link:
                results.append({
                    "title": title,
                    "link": link,
                    "date": pubDate,
                    "source_query": query
                })
    except Exception as e:
        print(f"Error parsing RSS: {e}")
    return results

def slugify(url):
    """Create shortlink slug from URL hash."""
    return hashlib.md5(url.encode()).hexdigest()[:6]

def main():
    all_news = []
    shortlinks = {}

    for query in NEWS_SOURCES:
        xml = fetch_news(query)
        if xml:
            articles = parse_rss(xml, query)
            for art in articles:
                slug = slugify(art["link"])
                shortlinks[slug] = art["link"]
                all_news.append({
                    "id": slug,
                    "title": art["title"],
                    "link": art["link"],
                    "date": art["date"],
                    "topic": query
                })

    # Save outputs
    with open(OUTPUT_NEWS_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "articles": all_news
        }, f, indent=2)

    with open(OUTPUT_SHORTLINKS_FILE, "w", encoding="utf-8") as f:
        json.dump(shortlinks, f, indent=2)

    print(f"Saved {len(all_news)} articles")

if __name__ == "__main__":
    main()
