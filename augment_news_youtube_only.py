# file: augment_news_youtube_only.py
#
# 1) Expands data/news.json with YouTube videos related to energy / grid / AI / data centers
#    from CNN / Reuters / WSJ / FT (VIDEO items only)
# 2) Generates a homepage "Daily Intelligence Brief" from the CURRENT data/news.json
#    and writes it to data/home_summary.json (static JSON, like your ai.html pattern)

import json
import os
import hashlib
from datetime import datetime, timezone
from urllib.request import urlopen, Request
from urllib.error import URLError
import xml.etree.ElementTree as ET


# ------------------------ Paths ------------------------------------
NEWS_JSON_PATH = "data/news.json"
HOME_SUMMARY_PATH = "data/home_summary.json"

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


def now_utc_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


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
    except FileNotFoundError:
        return []
    except Exception:
        return []


def save_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def published_dt(item):
    try:
        return datetime.fromisoformat(item["published"].replace("Z", "+00:00"))
    except Exception:
        return datetime.min.replace(tzinfo=timezone.utc)


def compute_feed_fingerprint(items, max_items=80):
    """
    Create a stable hash for the current homepage feed input.
    Uses only metadata we already have. Limits to max_items to keep stable.
    """
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
            "score": it.get("score", None),
            "url": it.get("url", "")
        })
    raw = json.dumps(compact, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


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
            {
                "role": "system",
                "content": (
                    "You are PTD Today’s editorial analyst (Energy / Grid / Data Centers / AI). "
                    "Use ONLY the provided feed items (headline + metadata). "
                    "Do NOT invent facts. Do NOT use external knowledge. Do NOT quote article text. "
                    "Write in a crisp, neutral, newsroom tone (WSJ/FT style). "
                    "If a headline is ambiguous, say 'Not enough information in the headline.'"
                )
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

    with urlopen(req, timeout=35) as resp:
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


def build_daily_brief_prompt(feed_items):
    """
    feed_items: list of dicts with title/publisher/category/published/score/url
    Produces a premium editorial brief.
    """
    compact = []
    for it in feed_items[:80]:
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
        "Write a premium 'Daily Intelligence Brief' for PTD Today based ONLY on the feed items below.\n\n"
        "STRICT RULES:\n"
        "- Use ONLY the provided items. No external facts, no guessing.\n"
        "- Do NOT quote article text. You only have headlines + metadata.\n"
        "- If something isn't clear from the headline, say: 'Not enough information in the headline.'\n"
        "- Be concise and professional. No hype.\n\n"
        "OUTPUT (markdown) — EXACT STRUCTURE:\n"
        "A) Lead (2–3 sentences): what the day signals across energy/grid/data centers/AI.\n"
        "B) Top themes (3–6 bullets): short, punchy, actionable.\n"
        "C) Why it matters (1–2 bullets): implications for operators, suppliers, investors.\n"
        "D) Watchlist (2–4 bullets): what to monitor next (policy, supply chain, projects, earnings, etc.).\n"
        "E) Top stories (up to 8): one line each, end with '(Source: Publisher)'.\n"
        "F) Sector takeaways:\n"
        "   - Grid: 1–2 bullets (if relevant)\n"
        "   - Renewables & Storage: 1–2 bullets (if relevant)\n"
        "   - Data Centers & AI: 1–2 bullets (if relevant)\n"
        "G) Notable mentions (if visible from headlines only):\n"
        "   - Companies: comma-separated\n"
        "   - Regions/Countries: comma-separated\n\n"
        "SELECTION GUIDANCE:\n"
        "- Prioritize more recent items; use score as a tie-breaker.\n"
        "- If the feed lacks variety, acknowledge it briefly in the Lead.\n\n"
        "FEED ITEMS (JSON):\n"
        f"{json.dumps(compact, ensure_ascii=False, indent=2)}\n"
    )


def generate_home_summary(all_items):
    """
    Generates /data/home_summary.json based on the same items shown on homepage.
    Summarizes articles + videos (headlines + metadata only).
    """
    items = list(all_items)

    # Sort: newest first; if timestamps equal/close, higher score first
    def sort_key(it):
        dt = published_dt(it)
        score = it.get("score", 0) if isinstance(it, dict) else 0
        try:
            s = float(score) if score is not None else 0.0
        except Exception:
            s = 0.0
        return (dt, s)

    items.sort(key=sort_key, reverse=True)

    # keep roughly last 60 hours, matching your homepage
    now = datetime.now(timezone.utc)
    cutoff = now.timestamp() - (60 * 3600)
    filtered = []
    for it in items:
        try:
            dt = published_dt(it)
            if dt.timestamp() >= cutoff:
                filtered.append(it)
        except Exception:
            filtered.append(it)

    if not filtered:
        return

    fp = compute_feed_fingerprint(filtered)

    existing = load_existing(HOME_SUMMARY_PATH)
    if isinstance(existing, dict) and existing.get("fingerprint") == fp:
        print("Homepage summary unchanged (fingerprint match). Skipping OpenAI call.")
        return

    prompt = build_daily_brief_prompt(filtered)
    summary_md = openai_call_responses(prompt)

    out = {
        "updated_at": now_utc_iso(),
        "fingerprint": fp,
        "summary_md": summary_md
    }
    save_json(HOME_SUMMARY_PATH, out)
    print(f"Saved homepage summary to {HOME_SUMMARY_PATH}")


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

    # Keep consistent ordering in news.json
    all_items.sort(key=published_dt, reverse=True)

    save_json(NEWS_JSON_PATH, all_items)
    print(f"Saved {len(all_items)} total items to {NEWS_JSON_PATH}")

    # Generate homepage summary (only if key present)
    try:
        if os.getenv(OPENAI_API_KEY_ENV, "").strip():
            generate_home_summary(all_items)
        else:
            print(f"Skipping homepage summary: env var {OPENAI_API_KEY_ENV} not set.")
    except Exception as e:
        print(f"Homepage summary generation failed: {e}")


if __name__ == "__main__":
    main()