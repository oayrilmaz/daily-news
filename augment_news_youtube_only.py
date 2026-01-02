# file: ai/augment_news_youtube_only.py
#
# Expands data/news.json with PTD-relevant YouTube videos (energy/grid/AI/data centers/etc.)
# Maintains rolling archive at data/news_archive.json
# Generates multiple “brief” JSON files (daily/weekly/monthly/quarterly/YTD/2025/forecast)
# ALWAYS writes brief files (creates stubs if not enough items / no API key).
#
# IMPORTANT:
# - This version **PURGES old political YouTube videos** already stored in news.json + archive.json
# - This version **ONLY keeps YouTube videos** that match PTD topics and **rejects politics**
# - Briefs are generated from the archive, but **filtered to PTD-relevant items only**
#
# Paths expected by your site:
# - data/news.json
# - data/news_archive.json
# - data/home_summary.json
# - data/briefs/*.json

import json
import os
import hashlib
from datetime import datetime, timezone, timedelta
from urllib.request import urlopen, Request
from urllib.error import URLError
import xml.etree.ElementTree as ET


# ------------------------ Paths ------------------------------------
NEWS_JSON_PATH = "data/news.json"                    # site uses this for cards
ARCHIVE_JSON_PATH = "data/news_archive.json"         # permanent history for briefs

HOME_SUMMARY_PATH = "data/home_summary.json"         # homepage brief reads this
BRIEFS_DIR = "data/briefs"                           # brief files


# ------------------------ YouTube feeds ----------------------------
YOUTUBE_CHANNELS = [
    ("https://www.youtube.com/feeds/videos.xml?channel_id=UCupvZG-5ko_eiXAupbDfxWw", "CNN"),
    ("https://www.youtube.com/feeds/videos.xml?channel_id=UChqUTb7kYRX8-EiaN3XFrSQ", "Reuters"),
    ("https://www.youtube.com/feeds/videos.xml?channel_id=UCK7tptUDHh-RYDsdxO1-5QQ", "The Wall Street Journal"),
    ("https://www.youtube.com/feeds/videos.xml?channel_id=UCoUxsWakJucWg46KW5RsvPw", "Financial Times"),
]

# PTD topics (positive signals)
KEYWORDS = [
    # Grid / transmission
    "grid", "power", "electricity", "substation", "transformer", "switchgear",
    "hvdc", "high voltage", "transmission", "distribution", "interconnector",
    "tso", "dso", "utility", "utilities", "iso", "rto",
    "cable", "subsea cable", "intertie",

    # Renewables / storage
    "renewable", "renewables", "solar", "pv", "wind", "offshore wind",
    "hydrogen", "electrolyzer", "geothermal",
    "battery", "batteries", "energy storage", "storage", "bess",

    # Data centers / AI / chips
    "data center", "datacenter", "cloud", "hyperscale",
    "ai", "artificial intelligence", "genai", "gpu", "chips",
    "semiconductor", "nvidia", "amd", "intel",

    # Oil & gas (optional)
    "oil", "gas", "lng", "pipeline", "refinery", "upstream", "downstream",

    # Materials / rare earth
    "rare earth", "lithium", "cobalt", "nickel", "graphite", "copper",

    # Policy/markets (energy-specific)
    "ppa", "cfd", "capacity market", "tariff", "auction",
]

# Strong negative signals (politics / unrelated news)
# (We want to reject typical political content even if it accidentally includes "power" etc.)
NEGATIVE_KEYWORDS = [
    # US politics / elections / politicians / parties
    "election", "campaign", "ballot", "polls", "primary", "debate",
    "democrat", "democratic", "republican", "gop", "senate", "congress", "parliament",
    "president", "prime minister", "governor", "mayor", "white house",
    "aoc", "bernie", "sanders", "trump", "biden", "harris", "mamdani",
    "zohra", "zohran", "nyc",

    # general crime / celebrity / war coverage that isn’t energy-focused
    "celebrity", "royal", "oscars", "movie", "actor", "actress",
    "murder", "shooting", "stabbed", "kidnapped",
    "earthquake", "wildfire", "fire", "hostage",
]

# For YouTube we require stronger match than articles (to avoid random political clips)
MIN_POSITIVE_HITS_FOR_YOUTUBE = 1


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

def fetch(url: str):
    try:
        req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urlopen(req, timeout=12) as resp:
            return resp.read()
    except URLError:
        return None
    except Exception:
        return None

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

def _count_positive_hits(text: str) -> int:
    t = (text or "").lower()
    hits = 0
    for k in KEYWORDS:
        if k in t:
            hits += 1
    return hits

def _has_negative(text: str) -> bool:
    t = (text or "").lower()
    return any(n in t for n in NEGATIVE_KEYWORDS)

def is_ptd_relevant(title: str, desc: str = "", category: str = "", publisher: str = "", url: str = "", strict: bool = False) -> bool:
    """
    strict=True is used for YouTube items to aggressively reject politics/unrelated clips.
    strict=False can be used for articles (still filters obvious politics).
    """
    blob = " ".join([title or "", desc or "", category or "", publisher or "", url or ""]).strip()
    if not blob:
        return False

    # Block obvious politics/unrelated
    if _has_negative(blob):
        return False

    # Require PTD keywords (count-based for strict mode)
    hits = _count_positive_hits(blob)

    if strict:
        return hits >= MIN_POSITIVE_HITS_FOR_YOUTUBE
    else:
        # For archive/articles: allow if at least 1 keyword hit
        return hits >= 1


# ------------------------ YouTube parsing ---------------------------
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

        # STRICT filter for YouTube: must be PTD relevant and NOT political
        if not is_ptd_relevant(title, desc, category="Video", publisher=publisher, url=url, strict=True):
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
            "videoId": video_id,
            "description": desc[:2000]  # stored for filtering/debug, trimmed
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
                "Focus ONLY on PTD topics: grid/transmission, substations/HVDC, renewables/storage, "
                "data centers/AI/chips, oil & gas, critical minerals/rare earths.\n"
                "If an item is not within PTD topics, ignore it."
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
            f"Create a PTD Today “{label}” based ONLY on the PTD-relevant feed items below.\n\n"
            "This is NOT a prediction. It is a forward-looking WATCHLIST inferred from headline signals.\n"
            "You only have headline + metadata. No external knowledge.\n\n"
            "Output format (markdown):\n"
            "1) Themes likely to stay active (max 6 bullets) — phrase as watch items, not facts\n"
            "2) What to monitor next (Grid / Renewables / Data Centers & AI / Oil & Gas / Critical Materials) — 1–2 bullets each if relevant\n"
            "3) Regions / companies appearing repeatedly (only if visible from headlines)\n"
            "4) Risks / constraints implied by headlines (max 5 bullets)\n\n"
            "Rules:\n"
            "- Use ONLY provided items. No guessing about outcomes.\n"
            "- Do NOT state future events as facts.\n"
            "- If uncertain, say: “Not enough information in the headline.”\n\n"
            "Feed items (JSON):\n"
            f"{json.dumps(compact, ensure_ascii=False, indent=2)}\n"
        )

    return (
        f"Create a PTD Today “{label} Intelligence Brief” from the PTD-relevant feed items below.\n\n"
        "You only have: headline + publisher + category + timestamp + score + type + url.\n\n"
        "Output format (markdown):\n"
        "1) Top themes (max 5 bullets)\n"
        "2) Top stories (up to 8) — one sentence each, based ONLY on headline/metadata; include (Source: Publisher)\n"
        "3) Sector takeaways (Grid / Renewables & Storage / Data Centers & AI / Oil & Gas / Critical Materials) — 1–2 bullets each IF relevant\n"
        "4) Notable companies/regions mentioned (ONLY if visible from headlines)\n\n"
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
    print(f"Wrote STUB -> {path}")

def generate_brief_file(path, label, items, mode="brief"):
    key_present = bool(os.getenv(OPENAI_API_KEY_ENV, "").strip())

    if not items:
        write_stub(path, label, "Not enough PTD-relevant items in this time window yet.")
        return False

    fp = compute_fingerprint(items, label)
    existing = load_json(path, default=None)
    if isinstance(existing, dict) and existing.get("fingerprint") == fp:
        print(f"{label}: unchanged (fingerprint match).")
        return False

    if not key_present:
        write_stub(path, label, f"{OPENAI_API_KEY_ENV} is not set in Actions secrets.")
        return False

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
        print(f"Saved {label} -> {path}")
        return True
    except Exception as e:
        write_stub(path, label, f"Brief generation failed: {e}")
        return False

def generate_all_briefs(archive_items):
    # Only use PTD-relevant items for briefs (prevents politics in summaries)
    ptd_items = []
    for it in archive_items:
        if not isinstance(it, dict):
            continue
        title = it.get("title", "")
        desc = it.get("description", "") or it.get("summary", "") or ""
        cat = it.get("category", "")
        pub = it.get("publisher", "")
        url = it.get("url", "")
        if is_ptd_relevant(title, desc, category=cat, publisher=pub, url=url, strict=False):
            ptd_items.append(it)

    ptd_items.sort(key=published_dt, reverse=True)

    now = now_utc()
    daily_start = now - timedelta(hours=60)   # matches your UI expectation (60h)
    weekly_start = now - timedelta(days=7)
    monthly_start = now - timedelta(days=30)

    q_start = quarter_start(now)
    y_start = year_start(now)

    y2025_start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    y2026_start = datetime(2026, 1, 1, tzinfo=timezone.utc)

    daily_items = filter_range(ptd_items, daily_start, now)
    weekly_items = filter_range(ptd_items, weekly_start, now)
    monthly_items = filter_range(ptd_items, monthly_start, now)
    quarterly_items = filter_range(ptd_items, q_start, now)
    ytd_items = filter_range(ptd_items, y_start, now)
    y2025_items = filter_range(ptd_items, y2025_start, y2026_start)

    os.makedirs(BRIEFS_DIR, exist_ok=True)

    # Homepage brief
    generate_brief_file(HOME_SUMMARY_PATH, "Daily", daily_items, mode="brief")

    # Briefs page expects these exact filenames:
    generate_brief_file(os.path.join(BRIEFS_DIR, "daily.json"), "Daily (last 60 hours)", daily_items, mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "weekly.json"), "Weekly", weekly_items, mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "monthly_mtd.json"), "Monthly (MTD)", filter_range(ptd_items, datetime(now.year, now.month, 1, tzinfo=timezone.utc), now), mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "monthly_30d.json"), "Monthly (last 30 days)", monthly_items, mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "quarterly_qtd.json"), "Quarter-to-date", quarterly_items, mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "ytd.json"), "Year-to-date", ytd_items, mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "year_2025.json"), "Year 2025 review", y2025_items, mode="brief")

    generate_brief_file(
        os.path.join(BRIEFS_DIR, "forecast_rest_of_year.json"),
        "Forecast / Watchlist (headline signals from last 30 days)",
        monthly_items,
        mode="forecast"
    )


def main():
    # Load current site feed
    news_items = load_json(NEWS_JSON_PATH, default=[])
    if not isinstance(news_items, list):
        news_items = []

    # Load archive (persistent)
    archive_items = load_json(ARCHIVE_JSON_PATH, default=[])
    if not isinstance(archive_items, list):
        archive_items = []

    # -------- PURGE: remove already-stored political/unrelated YouTube videos ----------
    YT_PUBLISHERS = {"CNN", "Reuters", "The Wall Street Journal", "Financial Times"}

    def is_youtube_item(it):
        return (
            isinstance(it, dict)
            and it.get("type") == "video"
            and it.get("publisher") in YT_PUBLISHERS
            and "youtube.com" in (it.get("url", "") or "")
        )

    def keep_item(it):
        if not isinstance(it, dict):
            return False
        if is_youtube_item(it):
            title = it.get("title", "")
            desc = it.get("description", "") or ""
            return is_ptd_relevant(title, desc, category="Video", publisher=it.get("publisher",""), url=it.get("url",""), strict=True)
        # For non-YouTube items, keep (articles, etc.)
        return True

    before_news = len(news_items)
    before_archive = len(archive_items)
    news_items = [it for it in news_items if keep_item(it)]
    archive_items = [it for it in archive_items if keep_item(it)]
    print(f"PURGE: news.json {before_news} -> {len(news_items)}, archive.json {before_archive} -> {len(archive_items)}")

    # Build URL indexes for dedupe
    archive_by_url = {it.get("url"): it for it in archive_items if isinstance(it, dict) and it.get("url")}
    news_by_url = {it.get("url"): it for it in news_items if isinstance(it, dict) and it.get("url")}

    # Fetch new YouTube videos (PTD-only) and add to BOTH news.json and archive.json
    new_items = []
    for feed_url, pub in YOUTUBE_CHANNELS:
        xml_bytes = fetch(feed_url)
        videos = parse_youtube_feed(xml_bytes, pub)
        for v in videos:
            u = v.get("url")
            if u and (u not in archive_by_url) and (u not in news_by_url):
                new_items.append(v)

    print(f"Found {len(new_items)} new PTD-relevant YouTube videos (politics filtered).")

    # Update news.json (site feed) - keep existing articles, add filtered videos
    updated_news = list(news_items) + new_items
    updated_news.sort(key=published_dt, reverse=True)
    save_json(NEWS_JSON_PATH, updated_news)
    print(f"Saved {len(updated_news)} items to {NEWS_JSON_PATH}")

    # Update archive.json (persistent history)
    updated_archive = list(archive_items)
    updated_archive.extend(new_items)

    # Keep archive from growing forever (last 365 days)
    cutoff = now_utc() - timedelta(days=365)
    updated_archive = [it for it in updated_archive if published_dt(it) >= cutoff]
    updated_archive.sort(key=published_dt, reverse=True)
    save_json(ARCHIVE_JSON_PATH, updated_archive)
    print(f"Saved {len(updated_archive)} items to {ARCHIVE_JSON_PATH}")

    # Generate briefs from ARCHIVE (PTD-filtered)
    generate_all_briefs(updated_archive)


if __name__ == "__main__":
    main()