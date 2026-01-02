# file: ai/augment_news_youtube_only.py
#
# 1) Expands data/news.json with YouTube videos related to PTD Today topics
#    from CNN / Reuters / WSJ / FT (VIDEO items only)
# 2) Maintains a rolling archive at data/news_archive.json (for weekly/monthly/quarterly/YTD)
# 3) Generates multiple “brief” JSON files (daily/weekly/monthly/quarterly/YTD/2025/forecast)
#    using ONLY headline + metadata from the archive (no invention, no external knowledge).
# 4) ALWAYS writes brief files (creates stubs if not enough items / no API key).
# 5) NEW: Strong PTD-topic filtering to avoid politics/general news clutter.

import json
import os
import re
import hashlib
from datetime import datetime, timezone, timedelta
from urllib.request import urlopen, Request
from urllib.error import URLError
import xml.etree.ElementTree as ET

# ------------------------ Paths ------------------------------------
NEWS_JSON_PATH = "data/news.json"                    # your site uses this for cards
ARCHIVE_JSON_PATH = "data/news_archive.json"         # permanent history for briefs

HOME_SUMMARY_PATH = "data/home_summary.json"         # homepage brief reads this
BRIEFS_DIR = "data/briefs"                           # weekly/monthly/quarterly/ytd/year/forecast


# ------------------------ YouTube feeds ----------------------------
YOUTUBE_CHANNELS = [
    ("https://www.youtube.com/feeds/videos.xml?channel_id=UCupvZG-5ko_eiXAupbDfxWw", "CNN"),
    ("https://www.youtube.com/feeds/videos.xml?channel_id=UChqUTb7kYRX8-EiaN3XFrSQ", "Reuters"),
    ("https://www.youtube.com/feeds/videos.xml?channel_id=UCK7tptUDHh-RYDsdxO1-5QQ", "The Wall Street Journal"),
    ("https://www.youtube.com/feeds/videos.xml?channel_id=UCoUxsWakJucWg46KW5RsvPw", "Financial Times"),
]


# ------------------------ PTD Topic Filtering -----------------------
# We use (A) strong "hard" topic phrases and (B) broader energy/industry phrases.
# A video/article must match >=1 hard term OR (>=2 broad terms).
# Political/general-news terms are excluded unless hard terms are present.

HARD_PATTERNS = [
    r"\bhvdc\b",
    r"\bhigh[-\s]?voltage\b",
    r"\bsubstation(s)?\b",
    r"\btransmission\b",
    r"\bdistribution\b",
    r"\bpower\s*grid\b|\belectric\s*grid\b|\bgrid\b",
    r"\btransformer(s)?\b",
    r"\bgis\b|\bgas[-\s]?insulated\b",
    r"\bsynchronous\s+condenser(s)?\b",
    r"\bseries\s+capacitor(s)?\b|\bfixed\s+series\s+capacitor(s)?\b|\bfsc\b",
    r"\bfacts\b|\bsvc\b|\bstatcom\b",
    r"\brenewable(s)?\b|\bclean\s+energy\b|\benergy\s+transition\b",
    r"\bsolar\b|\bpv\b|\bphotovoltaic(s)?\b",
    r"\bwind\b|\boffshore\s+wind\b|\bonshore\s+wind\b",
    r"\bbattery\b|\benergy\s+storage\b|\bbess\b",
    r"\bnuclear\b|\bsmr\b|\bsmall\s+modular\s+reactor(s)?\b",
    r"\bdata\s*center(s)?\b|\bdatacenter(s)?\b",
    r"\bai\b|\bartificial\s+intelligence\b|\bgenai\b",
    r"\bchip(s)?\b|\bsemiconductor(s)?\b|\bnvidia\b|\bamd\b|\btsmc\b",
    r"\brare\s+earth(s)?\b|\bcritical\s+mineral(s)?\b|\blithium\b|\bcobalt\b|\bnickel\b|\bgraphite\b",
    r"\boil\b|\bgas\b|\blng\b|\bpipeline(s)?\b|\brefiner(y|ies)\b|\bupstream\b|\bdownstream\b",
    r"\butility\b|\butilities\b|\bindependent\s+system\s+operator\b|\biso\b|\brto\b",
]

BROAD_PATTERNS = [
    r"\belectricity\b",
    r"\bpower\b",
    r"\benergy\b",
    r"\bgrid\b",
    r"\bcarbon\b|\bemissions\b|\bco2\b",
    r"\bmarket(s)?\b|\bpricing\b|\btariff(s)?\b",
    r"\binterconnector(s)?\b|\btransmission\s+line(s)?\b",
    r"\bcharger(s)?\b|\bev\b|\belectric\s+vehicle(s)?\b",
]

EXCLUDE_PATTERNS = [
    r"\belection(s)?\b",
    r"\bpresident\b|\bprime\s+minister\b|\bparliament\b|\bsenate\b|\bcongress\b",
    r"\btrump\b|\bbiden\b|\bobama\b",
    r"\bmayor\b|\bgubern(or|atorial)\b",
    r"\bwar\b|\bukraine\b|\brussia\b|\bgaza\b|\bisrael\b|\bhamas\b",
    r"\bmurder\b|\bshooting\b|\btrial\b|\bcourt\b",
    r"\bcelebrity\b|\boscar(s)?\b|\bmovie\b|\bfootball\b|\bsoccer\b|\bnba\b|\bnfl\b",
]

HARD_RE = re.compile("|".join(HARD_PATTERNS), re.IGNORECASE)
BROAD_RE = re.compile("|".join(BROAD_PATTERNS), re.IGNORECASE)
EXCL_RE = re.compile("|".join(EXCLUDE_PATTERNS), re.IGNORECASE)


def is_ptd_relevant(title: str, desc: str = "") -> bool:
    text = f"{title or ''} {desc or ''}".strip()

    hard = len(HARD_RE.findall(text))
    broad = len(BROAD_RE.findall(text))
    excl = len(EXCL_RE.findall(text))

    # If it has hard PTD terms -> accept, even if "politics" words appear.
    if hard >= 1:
        return True

    # If no hard terms, require stronger broad evidence and no obvious politics.
    if broad >= 2 and excl == 0:
        return True

    return False


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
        with urlopen(req, timeout=15) as resp:
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

        # NEW: strict PTD-topic filter (kills politics/general news)
        if not is_ptd_relevant(title, desc):
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
                "PTD Today focus: power transmission, grid/substations/HVDC, renewables, storage, oil & gas,\n"
                "data centers, AI/chips/semiconductors, and critical minerals/rare earths.\n"
                "Use ONLY the provided feed items (headline + metadata).\n"
                "Do NOT invent facts. Do NOT use external knowledge.\n"
                "Do NOT quote article text.\n"
                "Ignore items that are not relevant to PTD Today focus.\n"
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
    # Also filter at brief-time (double safety)
    filtered = []
    for it in feed_items:
        title = it.get("title", "")
        # We don’t have article body; only headline metadata. That’s OK.
        if is_ptd_relevant(title, ""):
            filtered.append(it)

    compact = []
    for it in filtered[:120]:
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
            "1) Themes likely to stay active (max 6 bullets) — phrase as watch items, not facts\n"
            "2) What to monitor next (Grid / Renewables / Oil & Gas / Data Centers & AI / Chips & Supply Chain / Critical Minerals) — 1–2 bullets each if relevant\n"
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
        f"Create a PTD Today “{label} Intelligence Brief” from the feed items below.\n\n"
        "PTD Today focus: power transmission, grid/substations/HVDC, renewables, storage, oil & gas,\n"
        "data centers, AI/chips/semiconductors, and critical minerals/rare earths.\n"
        "Ignore non-PTD items.\n\n"
        "You only have: headline + publisher + category + timestamp + score + type + url.\n\n"
        "Output format (markdown):\n"
        "1) Top themes (max 6 bullets)\n"
        "2) Top stories (up to 10) — one sentence each, based ONLY on headline/metadata; include (Source: Publisher)\n"
        "3) Sector takeaways (Grid / Renewables / Oil & Gas / Data Centers & AI / Chips & Supply Chain / Critical Minerals) — 1–2 bullets each IF relevant\n"
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
    # ALWAYS create the file (real or stub)
    key_present = bool(os.getenv(OPENAI_API_KEY_ENV, "").strip())

    # Filter to PTD topics first (so briefs never become political)
    filtered = []
    for it in items:
        if not isinstance(it, dict):
            continue
        if is_ptd_relevant(it.get("title", ""), ""):
            filtered.append(it)

    if not filtered:
        write_stub(path, label, "Not enough PTD-relevant items in this time window yet.")
        return False

    fp = compute_fingerprint(filtered, label)
    existing = load_json(path, default=None)
    if isinstance(existing, dict) and existing.get("fingerprint") == fp:
        print(f"{label}: unchanged (fingerprint match).")
        return False

    if not key_present:
        write_stub(path, label, f"{OPENAI_API_KEY_ENV} is not set in Actions secrets.")
        return False

    try:
        prompt = build_prompt(label, filtered, mode=mode)
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
    items = list(archive_items)
    items.sort(key=published_dt, reverse=True)

    now = now_utc()

    daily_start = now - timedelta(hours=24)
    weekly_start = now - timedelta(days=7)
    monthly_30d_start = now - timedelta(days=30)

    q_start = quarter_start(now)
    y_start = year_start(now)

    y2025_start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    y2026_start = datetime(2026, 1, 1, tzinfo=timezone.utc)

    daily_items = filter_range(items, daily_start, now)
    weekly_items = filter_range(items, weekly_start, now)
    monthly_30d_items = filter_range(items, monthly_30d_start, now)

    quarterly_qtd_items = filter_range(items, q_start, now)
    ytd_items = filter_range(items, y_start, now)
    y2025_items = filter_range(items, y2025_start, y2026_start)

    os.makedirs(BRIEFS_DIR, exist_ok=True)

    # Homepage (your home page reads data/home_summary.json)
    generate_brief_file(HOME_SUMMARY_PATH, "Daily (Homepage • last 24 hours)", daily_items, mode="brief")

    # These filenames match what you listed / what briefs.html typically expects
    generate_brief_file(os.path.join(BRIEFS_DIR, "daily.json"), "Daily (last 24 hours)", daily_items, mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "weekly.json"), "Weekly (last 7 days)", weekly_items, mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "monthly_mtd.json"), "Monthly (month-to-date)", filter_range(items, datetime(now.year, now.month, 1, tzinfo=timezone.utc), now), mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "monthly_30d.json"), "Monthly (last 30 days)", monthly_30d_items, mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "quarterly_qtd.json"), "Quarter-to-date", quarterly_qtd_items, mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "ytd.json"), "Year-to-date", ytd_items, mode="brief")
    generate_brief_file(os.path.join(BRIEFS_DIR, "year_2025.json"), "Year 2025 review", y2025_items, mode="brief")

    generate_brief_file(
        os.path.join(BRIEFS_DIR, "forecast_rest_of_year.json"),
        "Forward Watchlist (headline signals from last 30 days)",
        monthly_30d_items,
        mode="forecast"
    )


def main():
    # Load site feed (contains articles from your other pipeline + videos from this script)
    news_items = load_json(NEWS_JSON_PATH, default=[])
    if not isinstance(news_items, list):
        news_items = []

    # Load archive (persistent)
    archive_items = load_json(ARCHIVE_JSON_PATH, default=[])
    if not isinstance(archive_items, list):
        archive_items = []

    # Build URL indexes for dedupe
    archive_by_url = {it.get("url"): it for it in archive_items if isinstance(it, dict) and it.get("url")}
    news_by_url = {it.get("url"): it for it in news_items if isinstance(it, dict) and it.get("url")}

    # Fetch PTD-relevant YouTube videos and add to BOTH news.json and archive.json
    new_items = []
    for feed_url, pub in YOUTUBE_CHANNELS:
        xml_bytes = fetch(feed_url)
        videos = parse_youtube_feed(xml_bytes, pub)
        for v in videos:
            u = v.get("url")
            if u and (u not in archive_by_url) and (u not in news_by_url):
                new_items.append(v)

    print(f"Found {len(new_items)} new PTD-relevant YouTube videos.")

    # Update news.json (site feed)
    updated_news = list(news_items) + new_items
    updated_news.sort(key=published_dt, reverse=True)
    save_json(NEWS_JSON_PATH, updated_news)
    print(f"Saved {len(updated_news)} items to {NEWS_JSON_PATH}")

    # Update archive.json (persistent history)
    updated_archive = list(archive_items) + new_items

    # Keep archive limited (last 365 days)
    cutoff = now_utc() - timedelta(days=365)
    updated_archive = [it for it in updated_archive if published_dt(it) >= cutoff]

    updated_archive.sort(key=published_dt, reverse=True)
    save_json(ARCHIVE_JSON_PATH, updated_archive)
    print(f"Saved {len(updated_archive)} items to {ARCHIVE_JSON_PATH}")

    # Generate briefs from ARCHIVE
    generate_all_briefs(updated_archive)

if __name__ == "__main__":
    main()