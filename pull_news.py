#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
PTD Today feed builder (safe version)
- NEVER wipes existing news when collectors return 0 items
- Keeps the "All" (today-style) and "Top (7d)" windows we agreed
- Maintains short links for items in the current "All" window
- Trims the stored feed to ~30 days so the JSON stays small
"""

from __future__ import annotations
import json, os, re, hashlib
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

# ----------------------------
# Paths / constants
# ----------------------------
UTC = timezone.utc
ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
NEWS_JSON = os.path.join(DATA_DIR, "news.json")
SHORTS_JSON = os.path.join(DATA_DIR, "shortlinks.json")
SHORT_DIR = os.path.join(ROOT, "s")
SHORT_BASE = "https://ptdtoday.com/s/"
RETENTION_DAYS = 30  # keep last 30d in news.json

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(SHORT_DIR, exist_ok=True)

# ----------------------------
# Time helpers + windows
# ----------------------------
def now_utc() -> datetime:
    return datetime.now(UTC)

def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")

def start_of_day(dt: datetime) -> datetime:
    return datetime(dt.year, dt.month, dt.day, tzinfo=UTC)

def window_all(today: datetime) -> tuple[datetime, datetime]:
    """Dynamic 'All' window we agreed:
       Mon  -> Fri..Mon
       Sun  -> Fri..Sun
       else -> yesterday..now"""
    sod = start_of_day(today)
    dow = sod.weekday()  # Mon=0..Sun=6
    if dow == 0:                       # Monday
        return (sod - timedelta(days=3), today)  # Fri..Mon
    if dow == 6:                       # Sunday
        return (sod - timedelta(days=2), today)  # Fri..Sun
    return (sod - timedelta(days=1), today)      # Yesterday..now

def window_7d(today: datetime) -> tuple[datetime, datetime]:
    return (today - timedelta(days=7), today)

def within(window: tuple[datetime, datetime], when_iso: str) -> bool:
    try:
        t = datetime.fromisoformat(when_iso.replace("Z", "+00:00")).astimezone(UTC)
        return window[0] <= t <= window[1]
    except Exception:
        return False

# ----------------------------
# Storage helpers
# ----------------------------
def load_json(path: str, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def save_json(path: str, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

# ----------------------------
# Item normalization
# ----------------------------
def small_id(seed: str) -> str:
    return hashlib.sha1(seed.encode("utf-8")).hexdigest()[:6]

def host_of(u: str) -> str:
    try:
        h = urlparse(u).netloc
        return re.sub(r"^www\.", "", h)
    except Exception:
        return ""

def normalize(it: dict) -> dict:
    """Ensure minimal schema always exists."""
    out = dict(it)
    out["title"] = (out.get("title") or "").strip() or "Untitled"
    out["url"] = out.get("url") or ""
    out["image"] = out.get("image") or "assets/blank.png"
    out["category"] = (out.get("category") or "grid").lower()

    # id
    out["id"] = out.get("id") or small_id(out["url"] + out["title"])

    # published -> ISO UTC
    pub = out.get("published")
    if isinstance(pub, str):
        try:
            dt = datetime.fromisoformat(pub.replace("Z", "+00:00")).astimezone(UTC)
        except Exception:
            dt = now_utc()
    elif isinstance(pub, datetime):
        dt = pub.astimezone(UTC)
    else:
        dt = now_utc()
    out["published"] = iso(dt)

    # score
    try:
        out["score"] = float(out.get("score", 0.0))
    except Exception:
        out["score"] = 0.0

    return out

# ----------------------------
# Collectors (plug your scrapers here)
# ----------------------------
def collect_items() -> list[dict]:
    """
    TODO: Replace with your real Bing/Google + direct sources collectors
    (DCD, UtilityDive, GE Vernova, Hitachi Energy, Siemens Energy, Schneider, etc.)
    Return a list of dicts with at least: title, url, image, category, published, score.
    """
    return []  # returning [] will no longer wipe the site

# ----------------------------
# Short links
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

def write_short(short_id: str, item: dict, short_url: str):
    html = SHORT_TMPL.format(
        title=item["title"],
        desc=host_of(item["url"]),
        image=item["image"],
        short=short_url,
        orig=item["url"],
    )
    with open(os.path.join(SHORT_DIR, f"{short_id}.html"), "w", encoding="utf-8") as f:
        f.write(html)

# ----------------------------
# Main
# ----------------------------
def main():
    now = now_utc()

    # 1) Load existing news (so we never lose it)
    existing = load_json(NEWS_JSON, {"updated": iso(now), "items": []})
    old_items = existing.get("items", [])
    # map by (url or id) to merge later
    by_key = {}
    for it in old_items:
        k = (it.get("url") or "") or it.get("id")
        if k:
            by_key[k] = it

    # 2) Collect new items and normalize
    fresh_raw = collect_items()
    fresh = [normalize(it) for it in fresh_raw]

    # 3) If collectors returned nothing, keep existing items (only tick updated)
    if not fresh:
        out = {"updated": iso(now), "items": old_items}
        save_json(NEWS_JSON, out)
        print(f"[SAFE] No new items collected. Kept {len(old_items)} existing stories.")
        # keep shortlinks as-is
        return

    # 4) Merge old + new (dedupe by URL falling back to id)
    for it in fresh:
        k = (it.get("url") or "") or it.get("id")
        if not k:
            k = it["id"]
        by_key[k] = it  # prefer newest version

    merged = list(by_key.values())

    # 5) Trim to retention
    cutoff = now - timedelta(days=RETENTION_DAYS)
    merged = [
        it for it in merged
        if within((cutoff, now), it.get("published", iso(now)))
    ]

    # 6) Sort newest first
    merged.sort(key=lambda x: x.get("published", ""), reverse=True)

    # 7) Ensure short-links for items in current "All" window
    win_all = window_all(now)
    short_map = load_json(SHORTS_JSON, {})
    changed = False
    for it in merged:
        if within(win_all, it["published"]):
            sid = it["id"]
            if sid not in short_map:
                short_map[sid] = SHORT_BASE + f"{sid}.html"
                changed = True
            write_short(sid, it, short_map[sid])
    if changed:
        save_json(SHORTS_JSON, short_map)

    # 8) Write news.json
    out = {"updated": iso(now), "items": merged}
    save_json(NEWS_JSON, out)
    print(f"Wrote {len(merged)} stories (merged {len(fresh)} new, kept {len(old_items)} old).")

if __name__ == "__main__":
    # Ensure shortlinks file exists
    if not os.path.exists(SHORTS_JSON):
        save_json(SHORTS_JSON, {})
    main()