# file: augment_news_youtube_only.py
#
# 1) Expands data/news.json with YouTube videos related to energy / grid / AI / data centers
#    from CNN / Reuters / WSJ / FT (VIDEO items only)
# 2) Generates multiple “brief” JSON files (daily/weekly/monthly/quarterly/YTD/2025/forecast)
#    using ONLY headline + metadata from data/news.json (no invention, no external knowledge).

import json
import os
import hashlib
from datetime import datetime, timezone, timedelta
from urllib.request import urlopen, Request
from urllib.error import URLError
import xml.etree.ElementTree as ET


# ------------------------ Paths ------------------------------------
NEWS_JSON_PATH = "data/news.json"
HOME_SUMMARY_PATH = "data/home_summary.json"         # keep for daily (homepage default)
BRIEFS_DIR = "data/briefs"                           # new folder for all other briefs

# ------------------------ YouTube feeds ----------------------------
YOUTUBE_CHANNELS = [
    ("https://www.youtube.com/feeds/videos.xml?channel_id=UCupvZG-5ko_eiXAupbDfxWw", "CNN"),
    ("https://www.youtube.com/feeds/videos.xml?channel_id=UChqUTb7kYRX8-EiaN3XFrSQ", "Reuters"),
    ("https://www.youtube.com/feeds/videos.xml?channel_id=UCK7tptUDHh-RYDsdxO1-5QQ", "The Wall Street Journal"),
    ("https://www.youtube.com/feeds/videos.xml?channel_id=UCoUxsWakJucWg46KW5RsvPw", "Financial Times"),
]

KEYWORDS = [
    "grid", "power", "electricity", "substation", "hvdc",
    "renewable", "solar", "wind", "battery", "energy storage",
    "data center", "datacenter", "cloud", "ai", "chips",
    "semiconductor", "nvidia", "rare earth"
]

# ------------------------ OpenAI -----------------------------------
OPENAI_API_KEY_ENV = "OPENAI_API_KEY"
OPENAI_MODEL = os.getenv("PTD_OPENAI_MODEL", "gpt-4.1-mini")


def now_utc():
    return datetime.now(timezone.utc)

def now_utc_iso():
    return now_utc().isoformat().replace("+00:00", "Z")

def parse_iso(dt_str: str) -> str:
    """Normalize RFC3339-ish string into YYYY-MM-DDTHH:MM:SSZ."""
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    except Exception:
        dt = now_utc()
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

def published_dt(item):
    try:
        return datetime.fromisoformat(item["published"].replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return datetime.min.replace(tzinfo=timezone.utc)

def has_keyword(text: str) -> bool:
    t = (text or "").lower()
    return any(k in t for k in KEYWORDS)

def fetch(url: str):
    try:
        with urlopen(url, timeout=10) as resp:
            return resp.read()
    except URLError:
        return None

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
        published_iso = parse_iso(published_raw) if published_raw else now_utc_iso()

        if not title or not video_id or not url:
            continue

        if not has_keyword(title + " " + desc):
            continue

        item = {
            "title": title,
            "url": url,
            "publisher": publisher,
            "category": "Video",
            "published": published_iso,
            "score": 1.0,
            "image": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            "type": "video",
            "videoId": video_id
        }
        videos.append(item)

    return videos

def load_existing(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return [] if path.endswith(".json") else None

def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True) if os.path.dirname(path) else None
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

def compute_fingerprint(items, label, max_items=120):
    compact = []
    for it in items[:max_items]:
        if not isinstance(it, dict):
            continue
        compact.append({
            "title": it.get("title",""),
            "publisher": it.get("publisher",""),
            "category": it.get("category",""),
            "published": it.get("published",""),
            "type": it.get("type",""),
            "url": it.get("url","")
        })
    raw = json.dumps({"label": label, "items": compact}, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def openai_call_responses(prompt_text: str) -> str:
    key = os.getenv(OPENAI_API_KEY_ENV, "").strip()
    if not key:
        raise RuntimeError(f"Missing env var {OPENAI_API_KEY_ENV}")

    url = "https://api.openai.com/v1/responses"
    payload = {
        "model": OPENAI_MODEL,
        "input": [
            {"role": "system", "content":
                "You are PTD Today’s editorial analyst. Use ONLY the provided feed items (headline + metadata). "
                "Do NOT invent facts. Do NOT use external knowledge. Do NOT quote article text. "
                "Be concise, professional, and structured."
            },
            {"role": "user", "content": prompt_text}
        ]
    }

    data = json.dumps(payload).encode("utf-8")
    req = Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        },
        method="POST"
    )

    with urlopen(req, timeout=45) as resp:
        out = resp.read().decode("utf-8", errors="replace")

    j = json.loads(out)

    if isinstance(j, dict) and "output_text" in j and isinstance(j["output_text"], str):
        return j["output_text"].strip()

    texts = []
    for block in j.get("output", []) if isinstance(j, dict) else []:
        for c in block.get("content", []) if isinstance(block, dict) else []:
            if isinstance(c, dict) and c.get("type") == "output_text":
                texts.append(c.get("text", ""))
    return "\n".join(texts).strip()

def build_prompt(label: str, feed_items):
    # Keep only what we show on cards (headline metadata)
    compact = []
    for it in feed_items[:120]:
        if not isinstance(it, dict):
            continue
        compact.append({
            "title": it.get("title", ""),
            "publisher": it.get("publisher", ""),
            "category": it.get("category", ""),
            "published": it.get("published", ""),
            "score": it.get("score", None),
            "type": it.get("type", ""),
            "url": it.get("url", "")
        })

    return (
        f"Create a PTD Today “{label} Intelligence Brief” from the feed items below.\n\n"
        "You only have: headline + publisher + category + timestamp + score + type + url.\n\n"
        "Output format (markdown):\n"
        "1) Top themes (max 5 bullets)\n"
        "2) Top stories (up to 8) — one sentence each, based ONLY on headline/metadata; include (Source: Publisher)\n"
        "3) Sector takeaways (Grid / Renewables / Data Centers & AI) — 1–2 bullets each IF relevant\n"
        "4) Notable companies/regions mentioned (ONLY if visible from headlines)\n\n"
        "Rules:\n"
        "- Use ONLY provided items. No external knowledge. No guessing.\n"
        "- If uncertain, say: “Not enough information in the headline.”\n"
        "- Do NOT quote article text.\n\n"
        "Feed items (JSON):\n"
        f"{json.dumps(compact, ensure_ascii=False, indent=2)}\n"
    )

def filter_range(items, start_dt, end_dt):
    out = []
    for it in items:
        dt = published_dt(it)
        if dt == datetime.min.replace(tzinfo=timezone.utc):
            continue
        if start_dt <= dt < end_dt:
            out.append(it)
    return out

def quarter_start(dt):
    q = ((dt.month - 1) // 3) * 3 + 1
    return datetime(dt.year, q, 1, tzinfo=timezone.utc)

def year_start(dt):
    return datetime(dt.year, 1, 1, tzinfo=timezone.utc)

def generate_brief_file(path, label, items):
    if not items:
        return False

    fp = compute_fingerprint(items, label)

    existing = load_existing(path)
    if isinstance(existing, dict) and existing.get("fingerprint") == fp:
        print(f"{label}: unchanged (fingerprint match).")
        return False

    prompt = build_prompt(label, items)
    summary_md = openai_call_responses(prompt)

    payload = {
        "updated_at": now_utc_iso(),
        "label": label,
        "fingerprint": fp,
        "summary_md": summary_md
    }
    save_json(path, payload)
    print(f"Saved {label} brief -> {path}")
    return True

def generate_all_briefs(all_items):
    # Sort newest first
    items = list(all_items)
    items.sort(key=published_dt, reverse=True)

    now = now_utc()

    # Define time windows
    daily_start = now - timedelta(days=1)
    weekly_start = now - timedelta(days=7)
    monthly_start = now - timedelta(days=30)

    q_start = quarter_start(now)
    y_start = year_start(now)

    # 2025 full year window
    y2025_start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    y2026_start = datetime(2026, 1, 1, tzinfo=timezone.utc)

    # Forecast (headlines only): use last 30 days to create “forward watchlist”
    forecast_window = filter_range(items, monthly_start, now)

    daily_items = filter_range(items, daily_start, now)
    weekly_items = filter_range(items, weekly_start, now)
    monthly_items = filter_range(items, monthly_start, now)
    quarterly_items = filter_range(items, q_start, now)
    ytd_items = filter_range(items, y_start, now)
    y2025_items = filter_range(items, y2025_start, y2026_start)

    # Ensure output folder exists
    os.makedirs(BRIEFS_DIR, exist_ok=True)

    # Daily brief remains at home_summary.json (your homepage reads it already)
    generate_brief_file(HOME_SUMMARY_PATH, "Daily", daily_items)

    # Other periods
    generate_brief_file(os.path.join(BRIEFS_DIR, "weekly.json"), "Weekly", weekly_items)
    generate_brief_file(os.path.join(BRIEFS_DIR, "monthly.json"), "Monthly (last 30 days)", monthly_items)
    generate_brief_file(os.path.join(BRIEFS_DIR, "quarterly.json"), "Quarter-to-date", quarterly_items)
    generate_brief_file(os.path.join(BRIEFS_DIR, "ytd.json"), "Year-to-date", ytd_items)
    generate_brief_file(os.path.join(BRIEFS_DIR, "year_2025.json"), "Year 2025 review", y2025_items)

    # Forecast: prompt uses last 30 days but asks for “watchlist”
    # (still allowed because it’s based on headline signals, not real predictions)
    if forecast_window:
        label = "Forecast / Watchlist (based on last 30 days headlines)"
        generate_brief_file(os.path.join(BRIEFS_DIR, "forecast_rest_of_year.json"), label, forecast_window)

def main():
    existing = load_existing(NEWS_JSON_PATH)
    if not isinstance(existing, list):
        existing = []

    # Dedupe by URL
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
    all_items.sort(key=published_dt, reverse=True)

    save_json(NEWS_JSON_PATH, all_items)
    print(f"Saved {len(all_items)} total items to {NEWS_JSON_PATH}")

    # Generate briefs (only if OPENAI_API_KEY is set)
    try:
        if os.getenv(OPENAI_API_KEY_ENV, "").strip():
            generate_all_briefs(all_items)
        else:
            print(f"Skipping briefs: env var {OPENAI_API_KEY_ENV} not set.")
    except Exception as e:
        print(f"Brief generation failed: {e}")

if __name__ == "__main__":
    main()