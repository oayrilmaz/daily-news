#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
PTD Today feed builder (SAFE + BOOTSTRAP)
- Never wipes existing items
- If collectors return nothing AND news.json is empty, load data/bootstrap.json
- Preserves short links for items in the current "All" window
- Keeps retention to ~30 days
"""

from __future__ import annotations
import json, os, re, hashlib
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

UTC = timezone.utc
ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
NEWS_JSON = os.path.join(DATA_DIR, "news.json")
BOOT_JSON = os.path.join(DATA_DIR, "bootstrap.json")
SHORTS_JSON = os.path.join(DATA_DIR, "shortlinks.json")
SHORT_DIR = os.path.join(ROOT, "s")

# use your live domain here
SHORT_BASE = "https://ptdtoday.com/s/"
RETENTION_DAYS = 30

os.makedirs(DATA_DIR, exist_ok=True)
(os.path.isdir(SHORT_DIR) or os.makedirs(SHORT_DIR, exist_ok=True))

# ---------- time helpers ----------
def now_utc() -> datetime:
    return datetime.now(UTC)

def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")

def start_of_day(dt: datetime) -> datetime:
    return datetime(dt.year, dt.month, dt.day, tzinfo=UTC)

def window_all(today: datetime) -> tuple[datetime, datetime]:
    """Agreed 'All' window:
       Mon  -> Fri..Mon, Sun -> Fri..Sun, else -> yesterday..now
    """
    sod = start_of_day(today)
    dow = sod.weekday()  # Mon=0..Sun=6
    if dow == 0:  # Monday
        return (sod - timedelta(days=3), today)
    if dow == 6:  # Sunday
        return (sod - timedelta(days=2), today)
    return (sod - timedelta(days=1), today)

def window_7d(today: datetime) -> tuple[datetime, datetime]:
    return (today - timedelta(days=7), today)

def within(window: tuple[datetime, datetime], when_iso: str) -> bool:
    try:
        t = datetime.fromisoformat(when_iso.replace("Z", "+00:00")).astimezone(UTC)
        return window[0] <= t <= window[1]
    except Exception:
        return False

# ---------- storage ----------
def load_json(path: str, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def save_json(path: str, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

# ---------- normalization ----------
def small_id(seed: str) -> str:
    return hashlib.sha1(seed.encode("utf-8")).hexdigest()[:6]

def host_of(u: str) -> str:
    try:
        h = urlparse(u).netloc
        return re.sub(r"^www\.", "", h)
    except Exception:
        return ""

def normalize(it: dict) -> dict:
    out = dict(it)
    out["title"] = (out.get("title") or "").strip() or "Untitled"
    out["url"] = out.get("url") or ""
    out["image"] = out.get("image") or "assets/blank.png"
    out["category"] = (out.get("category") or "grid").lower()
    # id
    out["id"] = out.get("id") or small_id(out["url"] + out["title"])
    # published
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

# ---------- collectors (replace with real scrapers later) ----------
def collect_items() -> list[dict]:
    """Return live items here. Empty list is OK (safe mode will keep old)."""
    return []

# ---------- shortlinks ----------
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

# ---------- main ----------
def main():
    now = now_utc()

    # Load existing
    existing = load_json(NEWS_JSON, {"updated": iso(now), "items": []})
    old_items = existing.get("items", [])
    by_key = {}
    for it in old_items:
        k = (it.get("url") or "") or it.get("id")
        if k:
            by_key[k] = it

    # Try collectors
    fresh_raw = collect_items()
    fresh = [normalize(it) for it in fresh_raw]

    # BOOTSTRAP: if nothing fresh AND nothing old, seed from bootstrap.json
    if not fresh and not old_items:
        boot = load_json(BOOT_JSON, [])
        if boot:
            fresh = [normalize(x) for x in boot]
            print(f"[BOOTSTRAP] Loaded {len(fresh)} items from data/bootstrap.json")

    # If still nothing, keep old (could be empty the first time)
    if not fresh:
        out = {"updated": iso(now), "items": old_items}
        save_json(NEWS_JSON, out)
        print(f"[SAFE] No new items. Kept {len(old_items)} existing.")
        return

    # Merge (prefer newest)
    for it in fresh:
        k = (it.get("url") or "") or it.get("id")
        if not k:
            k = it["id"]
        by_key[k] = it
    merged = list(by_key.values())

    # Retention
    cutoff = now - timedelta(days=RETENTION_DAYS)
    merged = [it for it in merged if within((cutoff, now), it.get("published", iso(now)))]

    # Sort newest first
    merged.sort(key=lambda x: x.get("published", ""), reverse=True)

    # Shortlinks for current "All" window
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

    out = {"updated": iso(now), "items": merged}
    save_json(NEWS_JSON, out)
    print(f"Wrote {len(merged)} stories (merged {len(fresh)} new, kept {len(old_items)} old).")

if __name__ == "__main__":
    if not os.path.exists(SHORTS_JSON):
        save_json(SHORTS_JSON, {})
    main()