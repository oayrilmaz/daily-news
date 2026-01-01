# file: augment_news_youtube_only.py
#
# 1) Expands data/news.json with YouTube videos related to energy / grid / AI / data centers
#    from CNN / Reuters / WSJ / FT (VIDEO items only)
# 2) Generates AI summaries (daily/weekly/monthly/quarterly/yearly + forecast)
#    into static JSON files under /data so your site can fetch them.

import json
import os
import hashlib
from datetime import datetime, timezone, timedelta
from urllib.request import urlopen, Request
from urllib.error import URLError
import xml.etree.ElementTree as ET

# ------------------------ Paths ------------------------------------
NEWS_JSON_PATH = "data/news.json"
HOME_SUMMARY_PATH = "data/home_summary.json"          # homepage daily brief
BRIEFS_DIR = "data/briefs"

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
# Store key in env var (GitHub secret, local env, etc.)
# export OPENAI_API_KEY="..."
OPENAI_API_KEY_ENV = "OPENAI_API_KEY"
OPENAI_MODEL = os.getenv("PTD_OPENAI_MODEL", "gpt-4.1-mini")  # override if you want


# ======================== helpers ==================================
def now_utc():
    return datetime.now(timezone.utc)

def now_utc_iso():
    return now_utc().isoformat().replace("+00:00", "Z")

def has_keyword(text: str) -> bool:
    t = (text or "").lower()
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
        dt = now_utc()
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

def published_dt(item):
    try:
        return datetime.fromisoformat(item["published"].replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return datetime.min.replace(tzinfo=timezone.utc)

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

def compute_fingerprint(items, meta_extra=None, max_items=120):
    """Stable hash for avoiding unnecessary OpenAI calls."""
    compact = []
    for it in items[:max_items]:
        if not isinstance(it, dict):
            continue
        compact.append({
            "title": it.get("title", ""),
            "publisher": it.get("publisher", ""),
            "category": it.get("category", ""),
            "published": it.get("published", ""),
            "type": it.get("type", ""),
            "url": it.get("url", ""),
            "score": it.get("score", None),
        })
    base = {
        "items": compact,
        "meta": meta_extra or {}
    }
    raw = json.dumps(base, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ===================== youtube parsing =============================
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


# ===================== OpenAI call ================================
def openai_call_responses(prompt_text: str) -> str:
    """
    Calls OpenAI Responses API via HTTPS (no extra Python dependencies).
    Returns plain text output.
    """
    key = os.getenv(OPENAI_API_KEY_ENV, "").strip()
    if not key:
        raise RuntimeError(f"Missing env var {OPENAI_API_KEY_ENV}")

    url = "https://api.openai.com/v1/responses"
    payload = {
        "model": OPENAI_MODEL,
        "input": [
            {"role": "system", "content": (
                "You are PTD Today’s editorial analyst. "
                "Use ONLY the provided feed items (headline+metadata). "
                "Do NOT invent facts. Do NOT quote article text. "
                "Be concise, structured, and professional."
            )},
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


# ===================== summarization ==============================
def items_in_window(all_items, start_dt, end_dt):
    out = []
    for it in all_items:
        if not isinstance(it, dict):
            continue
        dt = published_dt(it)
        if start_dt <= dt < end_dt:
            out.append(it)
    out.sort(key=published_dt, reverse=True)
    return out

def compact_feed(items, limit=90):
    compact = []
    for it in items[:limit]:
        compact.append({
            "title": it.get("title", ""),
            "publisher": it.get("publisher", ""),
            "category": it.get("category", ""),
            "published": it.get("published", ""),
            "score": it.get("score", None),
            "type": it.get("type", ""),
            "url": it.get("url", ""),
        })
    return compact

def prompt_for_period(label, start_dt, end_dt, items):
    return (
        f"Create a “{label} Intelligence Brief” for PTD Today.\n"
        f"Time window: {start_dt.isoformat()} to {end_dt.isoformat()} (UTC)\n\n"
        "You are given ONLY headline + metadata items (no article text).\n\n"
        "Output format (markdown):\n"
        "1) Top themes (max 6 bullets)\n"
        "2) Top stories (up to 10) — one sentence each, based only on headlines/metadata; include (Source: Publisher)\n"
        "3) Sector takeaways:\n"
        "   - Grid\n"
        "   - Renewables\n"
        "   - Data Centers & AI\n"
        "   (1–3 bullets each if relevant)\n"
        "4) Notable companies/regions mentioned (only if visible from headlines)\n\n"
        "Rules:\n"
        "- Use ONLY provided items. No external knowledge. No guessing.\n"
        "- If uncertain, say: “Not enough information in the headline.”\n"
        "- Do NOT quote article text.\n\n"
        "Feed items JSON:\n"
        f"{json.dumps(compact_feed(items), ensure_ascii=False, indent=2)}\n"
    )

def prompt_for_forecast(current_year, today_dt, items_recent):
    end_of_year = datetime(current_year + 1, 1, 1, tzinfo=timezone.utc)
    return (
        f"Create a “Forecast: Watchlist for the rest of {current_year}” for PTD Today.\n"
        f"Today (UTC): {today_dt.isoformat()}\n"
        f"Scope: From today to {end_of_year.isoformat()}.\n\n"
        "Important: This is NOT a prediction based on external knowledge.\n"
        "It must be a structured 'what to watch' outlook derived ONLY from patterns in the provided headlines/metadata.\n\n"
        "Output format (markdown):\n"
        "1) What to watch (10 bullets max) — each bullet starts with a short label like “Grid: …” / “Data Centers: …” / “Policy: …”\n"
        "2) Risks & unknowns (max 6 bullets)\n"
        "3) Signals to monitor (max 8 bullets) — measurable signals or keywords that would confirm/deny the theme\n\n"
        "Rules:\n"
        "- Use ONLY provided items. No external knowledge. No guessing.\n"
        "- Do NOT claim specific future events. Phrase as watchlist/signals.\n"
        "- Do NOT quote article text.\n\n"
        "Recent items JSON:\n"
        f"{json.dumps(compact_feed(items_recent), ensure_ascii=False, indent=2)}\n"
    )

def write_summary_if_changed(path, label, start_dt, end_dt, items):
    if not items:
        return

    meta_extra = {
        "label": label,
        "start": start_dt.isoformat(),
        "end": end_dt.isoformat()
    }
    fp = compute_fingerprint(items, meta_extra=meta_extra)

    existing = load_existing(path)
    if isinstance(existing, dict) and existing.get("fingerprint") == fp:
        print(f"{label}: unchanged (fingerprint match). Skipping.")
        return

    summary_md = openai_call_responses(prompt_for_period(label, start_dt, end_dt, items))
    out = {
        "updated_at": now_utc_iso(),
        "fingerprint": fp,
        "label": label,
        "window_start": start_dt.isoformat().replace("+00:00", "Z"),
        "window_end": end_dt.isoformat().replace("+00:00", "Z"),
        "summary_md": summary_md
    }
    save_json(path, out)
    print(f"Saved {label} summary -> {path}")

def write_forecast_if_changed(path, current_year, today_dt, items_recent):
    if not items_recent:
        return

    meta_extra = {
        "label": "Forecast",
        "year": current_year,
        "today": today_dt.isoformat()
    }
    fp = compute_fingerprint(items_recent, meta_extra=meta_extra)

    existing = load_existing(path)
    if isinstance(existing, dict) and existing.get("fingerprint") == fp:
        print("Forecast: unchanged (fingerprint match). Skipping.")
        return

    summary_md = openai_call_responses(prompt_for_forecast(current_year, today_dt, items_recent))
    out = {
        "updated_at": now_utc_iso(),
        "fingerprint": fp,
        "label": f"Forecast: rest of {current_year}",
        "summary_md": summary_md
    }
    save_json(path, out)
    print(f"Saved forecast -> {path}")

def generate_all_briefs(all_items):
    os.makedirs(BRIEFS_DIR, exist_ok=True)

    # Use both articles + videos (same as your homepage feed). If you prefer excluding videos:
    # items_for_briefs = [x for x in all_items if x.get("type") != "video"]
    items_for_briefs = list(all_items)
    items_for_briefs.sort(key=published_dt, reverse=True)

    now = now_utc()

    # Daily (homepage): keep your existing ~60h window so it matches feed
    daily_start = now - timedelta(hours=60)
    daily_items = items_in_window(items_for_briefs, daily_start, now)

    # Write homepage daily brief
    write_summary_if_changed(
        HOME_SUMMARY_PATH,
        "Daily",
        daily_start,
        now,
        daily_items
    )

    # Weekly / Monthly / Quarterly
    weekly_start = now - timedelta(days=7)
    monthly_start = now - timedelta(days=30)
    quarterly_start = now - timedelta(days=90)

    write_summary_if_changed(os.path.join(BRIEFS_DIR, "weekly.json"), "Weekly", weekly_start, now,
                            items_in_window(items_for_briefs, weekly_start, now))
    write_summary_if_changed(os.path.join(BRIEFS_DIR, "monthly.json"), "Monthly", monthly_start, now,
                            items_in_window(items_for_briefs, monthly_start, now))
    write_summary_if_changed(os.path.join(BRIEFS_DIR, "quarterly.json"), "Quarterly", quarterly_start, now,
                            items_in_window(items_for_briefs, quarterly_start, now))

    # Yearly YTD (current year)
    y = now.year
    ytd_start = datetime(y, 1, 1, tzinfo=timezone.utc)
    ytd_items = items_in_window(items_for_briefs, ytd_start, now)
    write_summary_if_changed(os.path.join(BRIEFS_DIR, "yearly_ytd.json"), f"Yearly YTD ({y})", ytd_start, now, ytd_items)

    # Full 2025 summary (only if you have 2025 items in data/news.json)
    y2025_start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    y2026_start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    items_2025 = items_in_window(items_for_briefs, y2025_start, y2026_start)
    if items_2025:
        write_summary_if_changed(os.path.join(BRIEFS_DIR, "year_2025.json"), "Year 2025", y2025_start, y2026_start, items_2025)
    else:
        print("Year 2025: No 2025 items found in data/news.json (skipping year_2025.json).")

    # Forecast rest of current year (watchlist based on recent 30 days)
    recent_for_forecast = items_in_window(items_for_briefs, monthly_start, now)
    write_forecast_if_changed(os.path.join(BRIEFS_DIR, "forecast_rest_of_year.json"), y, now, recent_for_forecast)


# ===================== main =======================================
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

    print(f"Found {len(new_items)} new YouTube videos (CNN/Reuters/WSJ/FT) matching keywords.")

    all_items = existing + new_items
    all_items.sort(key=published_dt, reverse=True)

    save_json(NEWS_JSON_PATH, all_items)
    print(f"Saved {len(all_items)} total items -> {NEWS_JSON_PATH}")

    # Generate briefs only if OpenAI key is present
    try:
        if os.getenv(OPENAI_API_KEY_ENV, "").strip():
            generate_all_briefs(all_items)
        else:
            print(f"Skipping briefs: env var {OPENAI_API_KEY_ENV} not set.")
    except Exception as e:
        print(f"Brief generation failed: {e}")

if __name__ == "__main__":
    main()