# file: augment_news_youtube_only.py
#
# 1) Expands data/news.json + data/news_archive.json with YouTube videos (VIDEO items only)
# 2) Applies strict PTD-topic filtering (block politics first, then require sector keywords)
# 3) Generates brief JSON files (daily/weekly/monthly/quarterly/YTD/2025/forecast)
# 4) ALWAYS writes brief files (creates stubs if not enough items / no API key).

import json
import os
import hashlib
from datetime import datetime, timezone, timedelta
from urllib.request import urlopen, Request
from urllib.error import URLError
import xml.etree.ElementTree as ET

# ------------------------ Paths ------------------------------------
NEWS_JSON_PATH = "data/news.json"
ARCHIVE_JSON_PATH = "data/news_archive.json"

HOME_SUMMARY_PATH = "data/home_summary.json"
BRIEFS_DIR = "data/briefs"

SOURCES_PATH = "data/sources.json"

# ------------------------ OpenAI -----------------------------------
OPENAI_API_KEY_ENV = "OPENAI_API_KEY"
OPENAI_MODEL = os.getenv("PTD_OPENAI_MODEL", "gpt-4.1-mini")

# ------------------------ Helpers ----------------------------------
def now_utc():
    return datetime.now(timezone.utc)

def now_utc_iso():
    return now_utc().isoformat().replace("+00:00", "Z")

def parse_iso(dt_str: str) -> str:
    try:
        dt = datetime.fromisoformat((dt_str or "").replace("Z", "+00:00"))
    except Exception:
        dt = now_utc()
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

def published_dt(item):
    try:
        return datetime.fromisoformat(item.get("published", "").replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return datetime.min.replace(tzinfo=timezone.utc)

def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def save_json(path, obj):
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

def fetch(url: str):
    try:
        req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urlopen(req, timeout=12) as resp:
            return resp.read()
    except URLError:
        return None
    except Exception:
        return None

def normalize_text(s: str) -> str:
    return (s or "").strip().lower()

def contains_any(text: str, keywords) -> bool:
    t = normalize_text(text)
    return any(normalize_text(k) in t for k in (keywords or []) if k)

def should_block(title: str, desc: str, block_keywords) -> bool:
    blob = f"{title} {desc}"
    return contains_any(blob, block_keywords)

def should_include(title: str, desc: str, include_keywords) -> bool:
    blob = f"{title} {desc}"
    return contains_any(blob, include_keywords)

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

# ------------------------ YouTube parsing ---------------------------
def parse_youtube_feed(xml_bytes, publisher, include_keywords, block_keywords):
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

        # ✅ Block-first (politics/war/etc.)
        if should_block(title, desc, block_keywords):
            continue

        # ✅ Include-only (PTD topics)
        if not should_include(title, desc, include_keywords):
            continue

        videos.append({
            "title": title,
            "url": url,
            "publisher": publisher,
            "category": "Video",
            "published": published_iso,
            "score": 1.0,
            "image": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            "type": "video",
            "videoId": video_id
        })

    return videos

# ------------------------ OpenAI call ------------------------------
def openai_call_responses(prompt_text: str) -> str:
    key = os.getenv(OPENAI_API_KEY_ENV, "").strip()
    if not key:
        raise RuntimeError(f"Missing env var {OPENAI_API_KEY_ENV}")

    url = "https://api.openai.com/v1/responses"
    payload = {
        "model": OPENAI_MODEL,
        "input": [
            {"role": "system", "content":
                "You are PTD Today’s editorial analyst.\n"
                "Use ONLY the provided feed items (headline + metadata).\n"
                "Do NOT invent facts. Do NOT use external knowledge.\n"
                "Do NOT quote article text.\n"
                "Be concise, professional, and structured.\n"
                "Focus strictly on: grid/transmission, renewables, oil & gas, data centers & AI, semiconductors, rare earth/critical minerals."
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

    with urlopen(req, timeout=60) as resp:
        out = resp.read().decode("utf-8", errors="replace")

    j = json.loads(out)

    if isinstance(j, dict) and isinstance(j.get("output_text"), str):
        return j["output_text"].strip()

    texts = []
    for block in j.get("output", []) if isinstance(j, dict) else []:
        for c in block.get("content", []) if isinstance(block, dict) else []:
            if isinstance(c, dict) and c.get("type") == "output_text":
                texts.append(c.get("text", ""))
    return "\n".join(texts).strip()

def build_prompt(label: str, feed_items, mode: str = "brief"):
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

    if mode == "forecast":
        return (
            f"Create a PTD Today “{label}” based ONLY on the feed items below.\n\n"
            "This is NOT a prediction. It is a forward-looking WATCHLIST inferred from headline signals.\n"
            "You only have headline + metadata. No external knowledge.\n\n"
            "Output format (markdown):\n"
            "1) Themes to watch (max 6 bullets) — watch items, not facts\n"
            "2) What to monitor next (Grid / Renewables / Oil & Gas / Data Centers & AI / Critical Minerals) — 1–2 bullets each if relevant\n"
            "3) Regions / companies appearing repeatedly (only if visible from headlines)\n"
            "4) Constraints/risks implied by headlines (max 5 bullets)\n\n"
            "Rules:\n"
            "- Use ONLY provided items.\n"
            "- Do NOT state future events as facts.\n"
            "- If uncertain, say: “Not enough information in the headline.”\n\n"
            "Feed items (JSON):\n"
            f"{json.dumps(compact, ensure_ascii=False, indent=2)}\n"
        )

    return (
        f"Create a PTD Today “{label} Intelligence Brief” from the feed items below.\n\n"
        "Output format (markdown):\n"
        "1) Top themes (max 5 bullets)\n"
        "2) Top stories (up to 8) — one sentence each; include (Source: Publisher)\n"
        "3) Sector takeaways (Grid / Renewables / Oil & Gas / Data Centers & AI / Critical Minerals) — 1–2 bullets each if relevant\n"
        "4) Notable companies/regions mentioned (only if visible from headlines)\n\n"
        "Rules:\n"
        "- Use ONLY provided items. No external knowledge. No guessing.\n"
        "- If uncertain, say: “Not enough information in the headline.”\n"
        "- Do NOT quote article text.\n\n"
        "Feed items (JSON):\n"
        f"{json.dumps(compact, ensure_ascii=False, indent=2)}\n"
    )

def write_stub(path, label, reason):
    payload = {
        "updated_at": now_utc_iso(),
        "label": label,
        "fingerprint": "stub",
        "summary_md": f"• Not available yet.\n\nReason: {reason}"
    }
    save_json(path, payload)

def generate_brief_file(path, label, items, mode="brief"):
    key_present = bool(os.getenv(OPENAI_API_KEY_ENV, "").strip())

    if not items:
        write_stub(path, label, "Not enough items in this time window yet.")
        return

    fp = compute_fingerprint(items, label)
    existing = load_json(path, default=None)
    if isinstance(existing, dict) and existing.get("fingerprint") == fp:
        return

    if not key_present:
        write_stub(path, label, f"{OPENAI_API_KEY_ENV} is not set in Actions secrets.")
        return

    try:
        prompt = build_prompt(label, items, mode=mode)
        summary_md = openai_call_responses(prompt)
        payload = {
            "updated_at": now_utc_iso(),
            "label": label,
            "fingerprint": fp,
            "summary_md": summary_md
        }
        save_json(path, payload)
    except Exception as e:
        write_stub(path, label, f"Brief generation failed: {e}")

def generate_all_briefs(archive_items):
    items = list(archive_items)
    items.sort(key=published_dt, reverse=True)

    now = now_utc()

    daily_start = now - timedelta(hours=24)
    weekly_start = now - timedelta(days=7)
    monthly_start = now - timedelta(days=30)

    q_start = quarter_start(now)
    y_start = year_start(now)

    y2025_start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    y2026_start = datetime(2026, 1, 1, tzinfo=timezone.utc)

    daily_items = filter_range(items, daily_start, now)
    weekly_items = filter_range(items, weekly_start, now)
    monthly_items = filter_range(items, monthly_start, now)
    quarterly_items = filter_range(items, q_start, now)
    ytd_items = filter_range(items, y_start, now)
    y2025_items = filter_range(items, y2025_start, y2026_start)

    os.makedirs(BRIEFS_DIR, exist_ok=True)

    generate_brief_file(HOME_SUMMARY_PATH, "Daily", daily_items, mode="brief")

    generate_brief_file(os.path.join(BRIEFS_DIR, "daily.json"), "Daily (last 24 hours)", daily_items, mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "weekly.json"), "Weekly (last 7 days)", weekly_items, mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "monthly_30d.json"), "Monthly (last 30 days)", monthly_items, mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "quarterly_qtd.json"), "Quarter-to-date", quarterly_items, mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "ytd.json"), "Year-to-date", ytd_items, mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "year_2025.json"), "Year 2025 review", y2025_items, mode="brief")

    generate_brief_file(
        os.path.join(BRIEFS_DIR, "forecast_rest_of_year.json"),
        "Forward Watchlist (rest of year • headline signals from last 30 days)",
        monthly_items,
        mode="forecast"
    )

def main():
    sources_cfg = load_json(SOURCES_PATH, default={})
    global_cfg = sources_cfg.get("global", {}) if isinstance(sources_cfg, dict) else {}
    sources = sources_cfg.get("sources", []) if isinstance(sources_cfg, dict) else []

    include_keywords = global_cfg.get("include_keywords", [])
    block_keywords = global_cfg.get("block_keywords", [])
    yt_cfg = global_cfg.get("youtube", {})
    max_videos = int(yt_cfg.get("max_videos_per_run", 10))

    # Load current site feed + archive
    news_items = load_json(NEWS_JSON_PATH, default=[])
    if not isinstance(news_items, list):
        news_items = []

    archive_items = load_json(ARCHIVE_JSON_PATH, default=[])
    if not isinstance(archive_items, list):
        archive_items = []

    archive_by_url = {it.get("url"): it for it in archive_items if isinstance(it, dict) and it.get("url")}
    news_by_url = {it.get("url"): it for it in news_items if isinstance(it, dict) and it.get("url")}

    # Fetch new videos from configured youtube sources
    new_items = []
    for s in sources:
        if not isinstance(s, dict):
            continue
        if s.get("type") != "youtube":
            continue

        feed_url = s.get("url", "")
        publisher = s.get("publisher", "YouTube")

        xml_bytes = fetch(feed_url)
        vids = parse_youtube_feed(xml_bytes, publisher, include_keywords, block_keywords)
        for v in vids:
            u = v.get("url")
            if not u:
                continue
            if (u not in archive_by_url) and (u not in news_by_url):
                new_items.append(v)

    # Cap videos per run (prevents flooding)
    new_items = sorted(new_items, key=published_dt, reverse=True)[:max_videos]

    print(f"Found {len(new_items)} new PTD-relevant YouTube videos (politics blocked).")

    # Update news.json
    updated_news = list(news_items) + new_items
    updated_news.sort(key=published_dt, reverse=True)
    save_json(NEWS_JSON_PATH, updated_news)

    # Update archive.json (keep 365d)
    updated_archive = list(archive_items) + new_items
    cutoff = now_utc() - timedelta(days=365)
    updated_archive = [it for it in updated_archive if published_dt(it) >= cutoff]
    updated_archive.sort(key=published_dt, reverse=True)
    save_json(ARCHIVE_JSON_PATH, updated_archive)

    # Generate briefs from archive
    generate_all_briefs(updated_archive)

if __name__ == "__main__":
    main()