# file: augment_news_youtube_only.py
#
# Expands data/news.json with YouTube videos related to
# energy / grid / AI / data centers from:
#   - CNN
#   - Reuters
#   - The Wall Street Journal
#   - Financial Times
#
# Only adds VIDEO items, in the same format you already use.

import json
from datetime import datetime, timezone
from urllib.request import urlopen
from urllib.error import URLError
import xml.etree.ElementTree as ET

# Path to your news.json (adjust if needed)
NEWS_JSON_PATH = "data/news.json"   # if your file is at root, use "news.json"

# --- YouTube channels (news orgs) ---------------------------------
# Each tuple: (feed_url, publisher_label)
YOUTUBE_CHANNELS = [
    ("https://www.youtube.com/feeds/videos.xml?channel_id=UCupvZG-5ko_eiXAupbDfxWw", "CNN"),
    ("https://www.youtube.com/feeds/videos.xml?channel_id=UChqUTb7kYRX8-EiaN3XFrSQ", "Reuters"),
    ("https://www.youtube.com/feeds/videos.xml?channel_id=UCK7tptUDHh-RYDsdxO1-5QQ", "The Wall Street Journal"),
    ("https://www.youtube.com/feeds/videos.xml?channel_id=UCoUxsWakJucWg46KW5RsvPw", "Financial Times"),
]

# --- Keywords to keep (tune for PTD focus) -------------------------
KEYWORDS = [
    "grid", "power", "electricity", "substation", "hvdc",
    "renewable", "solar", "wind", "battery", "energy storage",
    "data center", "datacenter", "cloud", "ai", "chips",
    "semiconductor", "nvidia", "rare earth"
]

def has_keyword(text: str) -> bool:
    t = text.lower()
    return any(k in t for k in KEYWORDS)

def fetch(url: str):
    try:
        with urlopen(url, timeout=10) as resp:
            return resp.read()
    except URLError:
        return None

def parse_iso(dt_str: str) -> str:
    """Normalize RFC3339-ish string into YYYY-MM-DDTHH:MM:SSZ."""
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    except Exception:
        dt = datetime.now(timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

def parse_youtube_feed(xml_bytes, publisher):
    if not xml_bytes:
        return []

    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
        "media": "http://search.yahoo.com/mrss/"
    }
    root = ET.fromstring(xml_bytes)
    videos = []

    for entry in root.findall("atom:entry", ns):
        title_el = entry.find("atom:title", ns)
        title = (title_el.text or "").strip() if title_el is not None else ""

        vid_el = entry.find("yt:videoId", ns)
        video_id = (vid_el.text or "").strip() if vid_el is not None else ""

        link_el = entry.find("atom:link[@rel='alternate']", ns)
        url = link_el.get("href") if link_el is not None else ""

        desc_el = entry.find("media:group/media:description", ns)
        desc = (desc_el.text or "").strip() if desc_el is not None else ""

        published_el = entry.find("atom:published", ns)
        published_raw = published_el.text if published_el is not None else None
        published_iso = parse_iso(published_raw) if published_raw else datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        if not title or not video_id or not url:
            continue

        # Keep only energy / grid / AI-related topics
        if not has_keyword(title + " " + desc):
            continue

        item = {
            "title": title,
            "url": url,
            "publisher": publisher,
            "category": "Video",
            "published": published_iso,
            "score": 1.0,  # base score; you can tune
            "image": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            "type": "video",
            "videoId": video_id
            # NOTE: we do NOT set sid/share here; your front-end ignores them now
        }
        videos.append(item)

    return videos

def load_existing(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return []

def save_all(path, items):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)

def main():
    existing = load_existing(NEWS_JSON_PATH)
    # map by URL for dedupe
    by_url = {item.get("url"): item for item in existing if isinstance(item, dict) and item.get("url")}

    new_items = []
    for feed_url, pub in YOUTUBE_CHANNELS:
        xml_bytes = fetch(feed_url)
        videos = parse_youtube_feed(xml_bytes, pub)
        for v in videos:
            if v["url"] not in by_url:
                new_items.append(v)

    print(f"Found {len(new_items)} new YouTube videos from CNN/Reuters/WSJ/FT matching your keywords.")

    all_items = existing + new_items

    # sort by published desc
    def published_dt(item):
        try:
            return datetime.fromisoformat(item["published"].replace("Z", "+00:00"))
        except Exception:
            return datetime.min.replace(tzinfo=timezone.utc)

    all_items.sort(key=published_dt, reverse=True)

    save_all(NEWS_JSON_PATH, all_items)
    print(f"Saved {len(all_items)} total items to {NEWS_JSON_PATH}")

if __name__ == "__main__":
    main()