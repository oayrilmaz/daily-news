import feedparser
import json
from datetime import datetime
from dateutil import parser as dateparser

# Sources (you can add more RSS feeds here)
FEEDS = [
    "https://feeds.reuters.com/reuters/businessNews",
    "https://feeds.reuters.com/reuters/environment",
    "https://www.eenews.net/rss",
    "https://www.utilitydive.com/feeds/news/",
]

def fetch_news():
    items = []
    for url in FEEDS:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:5]:
                published_dt = None
                if hasattr(entry, "published"):
                    try:
                        published_dt = dateparser.parse(entry.published)
                    except Exception:
                        published_dt = None

                items.append({
                    "title": entry.title,
                    "url": entry.link,
                    "published": published_dt.isoformat() if published_dt else "",
                    "source": feed.feed.get("title", ""),
                    "summary": getattr(entry, "summary", ""),
                })
        except Exception as e:
            print(f"Error fetching {url}: {e}")

    # Sort newest first
    items.sort(key=lambda x: x["published"], reverse=True)
    return items[:15]

def main():
    items = fetch_news()
    now = datetime.utcnow()

    data = {
        "generated_at": now.isoformat(),
        "generated_at_readable": now.strftime("%Y-%m-%d %H:%M UTC"),
        "items": items,
    }

    # Save JSON for website
    with open("data/top.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    # Save LinkedIn-ready text
    lines = ["🌍 Daily Energy & Grid Headlines\n"]
    for x in items:
        line = f"🔹 {x['title']} ({x['source']})\n{x['url']}"
        lines.append(line)
    lines.append("\n#Energy #Grid #Power #Transmission")
    with open("data/linkedin.txt", "w", encoding="utf-8") as f:
        f.write("\n\n".join(lines))

if __name__ == "__main__":
    main()
