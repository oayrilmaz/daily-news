#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json, os, time, hashlib, re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

DATA_DIR = "data"
NEWS_JSON = os.path.join(DATA_DIR, "news.json")
SHORTS_JSON = os.path.join(DATA_DIR, "shortlinks.json")
SHORT_PAGE = "s"  # folder with short HTML files

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(SHORT_PAGE, exist_ok=True)

# ----------------------------
# 1) WINDOWS WE AGREED
# ----------------------------
UTC = timezone.utc

def start_of_day_utc(dt: datetime) -> datetime:
    return datetime(dt.year, dt.month, dt.day, tzinfo=UTC)

def add_days(dt: datetime, n: int) -> datetime:
    return dt + timedelta(days=n)

def window_for_all(now: datetime) -> tuple[datetime, datetime]:
    """Dynamic 'today' window by day-of-week.
       Mon -> Fri..Mon (3 days)
       Tue/Wed/Thu/Fri/Sat -> previous day..now
       Sun -> Fri..Sun (2 days back)"""
    today = start_of_day_utc(now)
    dow = today.weekday()  # Mon=0 .. Sun=6
    if dow == 0:  # Monday
        return (add_days(today, -3), now)     # Fri..Mon
    elif dow == 6:  # Sunday
        return (add_days(today, -2), now)     # Fri..Sun
    else:
        return (add_days(today, -1), now)     # prev day..now

def window_for_7d(now: datetime) -> tuple[datetime, datetime]:
    return (now - timedelta(days=7), now)

# ----------------------------
# 2) SCRAPE / COLLECT
# ----------------------------
# Replace this with your real collectors (Bing/Google, Benzinga, DCD, UtilityDive, Hitachi Energy, GE Vernova, Siemens Energy, Schneider, etc.)
# Each item must provide at least:
#   id (stable), title, url, image, category, published (ISO), score (float)
def collect_items() -> list[dict]:
    # TODO: your real scrapers
    # This placeholder returns an empty list so only filtering/window logic runs.
    return []

# ----------------------------
# 3) NORMALIZE + SAFETY
# ----------------------------
def safe_id(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:6]

def clamp_host(u: str) -> str:
    try:
        host = urlparse(u).netloc
        return re.sub(r"^www\.", "", host)
    except Exception:
        return ""

def as_iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00","Z")

def ensure_item_shape(it: dict) -> dict:
    # fill required keys so index.html never breaks
    it = dict(it)
    it["id"] = it.get("id") or safe_id(it.get("url","")+it.get("title",""))
    it["title"] = (it.get("title") or "").strip() or "Untitled"
    it["url"] = it.get("url") or ""
    it["image"] = it.get("image") or "assets/blank.png"
    it["category"] = (it.get("category") or "grid").lower()
    # published -> ISO
    pub = it.get("published")
    if isinstance(pub, str):
        try:
            it["published"] = datetime.fromisoformat(pub.replace("Z","+00:00")).astimezone(UTC).isoformat().replace("+00:00","Z")
        except Exception:
            it["published"] = as_iso(datetime.now(UTC))
    elif isinstance(pub, datetime):
        it["published"] = as_iso(pub)
    else:
        it["published"] = as_iso(datetime.now(UTC))
    # score
    try:
        it["score"] = float(it.get("score", 0.0))
    except Exception:
        it["score"] = 0.0
    return it

def within(window: tuple[datetime, datetime], iso: str) -> bool:
    try:
        t = datetime.fromisoformat(iso.replace("Z","+00:00")).astimezone(UTC)
        return window[0] <= t <= window[1]
    except Exception:
        return False

# ----------------------------
# 4) SHORT LINK PAGES
# ----------------------------
SHORT_TMPL = """<!doctype html><meta charset="utf-8">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{image}">
<meta property="og:url" content="{short}">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="{orig}">
<script>location.replace("{orig}");</script>
"""

def write_short_page(short_id: str, item: dict, short_url: str):
    html = SHORT_TMPL.format(
        title = item["title"],
        desc  = clamp_host(item["url"]),
        image = item["image"],
        short = short_url,
        orig  = item["url"],
    )
    with open(os.path.join(SHORT_PAGE, f"{short_id}.html"), "w", encoding="utf-8") as f:
        f.write(html)

# ----------------------------
# 5) MAIN
# ----------------------------
def main():
    now = datetime.now(UTC)

    # 5.1 collect & normalize
    raw = collect_items()
    items = [ensure_item_shape(it) for it in raw]

    # 5.2 filter windows
    win_all = window_for_all(now)
    win_7d  = window_for_7d(now)

    # “All” window (today logic)
    items_all = [it for it in items if within(win_all, it["published"])]
    # keep everything in news.json; index.html already filters. But
    # to guarantee presence for today/past week even if collectors return wider sets,
    # we *also* drop anything older than 30d to keep file light:
    cutoff_30 = now - timedelta(days=30)
    items = [it for it in items if within((cutoff_30, now), it["published"])]

    # 5.3 sort default (newest first)
    items.sort(key=lambda it: it["published"], reverse=True)

    # 5.4 write short links (only for the “current displayable” ones to limit churn)
    with open(SHORTS_JSON, "r", encoding="utf-8") as f:
        short_map = json.load(f)
    # if file empty/invalid:
    if not isinstance(short_map, dict):
        short_map = {}

    base = "https://ptdtoday.com/s/"
    changed = False
    for it in items_all:  # ensure “today window” items always have short links
        sid = it["id"]
        if sid not in short_map:
            short_map[sid] = base + f"{sid}.html"
            changed = True
        write_short_page(sid, it, short_map[sid])

    if changed:
        with open(SHORTS_JSON, "w", encoding="utf-8") as f:
            json.dump(short_map, f, ensure_ascii=False, indent=2)

    # 5.5 write news.json
    out = {
        "updated": as_iso(now),
        "items": items
    }
    with open(NEWS_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(items)} items. Today-window: {len(items_all)}")

if __name__ == "__main__":
    # ensure shortlinks.json exists
    if not os.path.exists(SHORTS_JSON):
        with open(SHORTS_JSON, "w", encoding="utf-8") as f:
            f.write("{}")
    main()