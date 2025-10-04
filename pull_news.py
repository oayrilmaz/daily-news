import requests
import json
from datetime import datetime, timezone

# === News sources & keywords === #
SOURCES = [
    "https://newsapi.org/v2/everything"
]
KEYWORDS = [
    "GE Vernova", "Siemens Energy", "Hitachi Energy", "Schneider Electric",
    "HVDC", "grid", "power transmission", "substations", "renewables",
    "transformer lead time", "equipment shortage", "cable supply", "switchgear delay",
    "logistics cost", "transport pricing energy"
]

# === API setup === #
API_KEY = "demo"  # replace with your NewsAPI key if available
OUTPUT_FILE = "data/news.json"

def fetch_articles():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    all_articles = []

    for kw in KEYWORDS:
        print(f"Fetching for keyword: {kw}")
        params = {
            "q": kw,
            "language": "en",
            "sortBy": "publishedAt",
            "pageSize": 8,
            "apiKey": API_KEY
        }
        try:
            r = requests.get(SOURCES[0], params=params)
            r.raise_for_status()
            data = r.json()
            for art in data.get("articles", []):
                date_str = art.get("publishedAt", "")
                if date_str.startswith(today):
                    all_articles.append({
                        "title": art.get("title"),
                        "url": art.get("url"),
                        "source": art.get("source", {}).get("name", ""),
                        "image": art.get("urlToImage"),
                        "summary": art.get("description"),
                        "date": date_str,
                        "timeAgo": "today"
                    })
        except Exception as e:
            print(f"⚠️ Error fetching {kw}: {e}")

    return all_articles

def save_articles(articles):
    # Deduplicate by URL
    seen = set()
    unique_articles = []
    for a in articles:
        if a["url"] not in seen:
            unique_articles.append(a)
            seen.add(a["url"])

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(unique_articles, f, ensure_ascii=False, indent=2)

    print(f"✅ Saved {len(unique_articles)} fresh articles to {OUTPUT_FILE}")

if __name__ == "__main__":
    articles = fetch_articles()
    if not articles:
        print("⚠️ No new articles found for today.")
    save_articles(articles)