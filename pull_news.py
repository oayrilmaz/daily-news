#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations
import json, os, re, hashlib
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

UTC = timezone.utc
ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
NEWS_JSON  = os.path.join(DATA, "news.json")
BOOT_JSON  = os.path.join(DATA, "bootstrap.json")
SHORTS_JSON= os.path.join(DATA, "shortlinks.json")
SHORT_DIR  = os.path.join(ROOT, "s")
os.makedirs(DATA, exist_ok=True)
os.makedirs(SHORT_DIR, exist_ok=True)

SHORT_BASE = "https://ptdtoday.com/s/"
RETENTION_DAYS = 30

SVG_PLACEHOLDER = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' "
                   "width='160' height='120'%3E%3Crect width='100%25' height='100%25' "
                   "fill='%23efe7d7'/%3E%3Cpath d='M15 90 L60 50 L85 72 L110 58 L145 90 Z' "
                   "fill='%23d7c9b1'/%3E%3C/svg%3E")

def now_utc(): return datetime.now(UTC)
def iso(dt):    return dt.astimezone(UTC).isoformat().replace("+00:00","Z")
def start_of_day(dt): return datetime(dt.year,dt.month,dt.day,tzinfo=UTC)

def window_all(today):
    sod = start_of_day(today); dow = sod.weekday()  # Mon=0..Sun=6
    if dow==0:  # Monday -> Friday..Monday
        return (sod - timedelta(days=3), today)
    if dow==6:  # Sunday -> Friday..Sunday
        return (sod - timedelta(days=2), today)
    return (sod - timedelta(days=1), today)

def window_7d(today): return (today - timedelta(days=7), today)

def within(win, when_iso):
    try:
        t = datetime.fromisoformat(when_iso.replace("Z","+00:00")).astimezone(UTC)
        return win[0] <= t <= win[1]
    except Exception:
        return False

def load_json(path, default):
    try:
        with open(path,"r",encoding="utf-8") as f: return json.load(f)
    except Exception: return default

def save_json(path,obj):
    with open(path,"w",encoding="utf-8") as f: json.dump(obj,f,ensure_ascii=False,indent=2)

def small_id(seed:str)->str: return hashlib.sha1(seed.encode("utf-8")).hexdigest()[:6]
def host_of(u:str)->str:
    try:
        h = urlparse(u).netloc
        return re.sub(r"^www\.", "", h)
    except Exception:
        return ""

CAT_MAP = {
    "grid":"grid","substations":"substations","protection":"protection",
    "cables":"cables","hvdc":"hvdc","renewables":"renewables","policy":"policy",
    "ai":"ai","artificial intelligence":"ai","machine learning":"ai",
    "data center":"datacenters","data centers":"datacenters",
    "datacenter":"datacenters","datacenters":"datacenters",
    "data centre":"datacenters","data centres":"datacenters",
}
def map_cat(raw:str)->str:
    k = (raw or "").strip().lower()
    if k in CAT_MAP: return CAT_MAP[k]
    for key,val in CAT_MAP.items():
        if key in k: return val
    return "grid"

def normalize(it:dict)->dict:
    o = dict(it)
    o["title"] = (o.get("title") or "").strip() or "Untitled"
    o["url"]   = o.get("url") or ""
    o["image"] = o.get("image") or SVG_PLACEHOLDER
    o["category"] = map_cat(o.get("category") or "")
    o["source"] = o.get("source") or host_of(o["url"])
    o["id"] = o.get("id") or small_id(o["url"]+o["title"])
    pub = o.get("published")
    dt = None
    if isinstance(pub,str):
        try: dt = datetime.fromisoformat(pub.replace("Z","+00:00")).astimezone(UTC)
        except Exception: dt = None
    elif isinstance(pub,datetime):
        dt = pub.astimezone(UTC)
    o["published"] = iso(dt or now_utc())
    try: o["score"] = float(o.get("score",0))
    except Exception: o["score"] = 0.0
    return o

def collect_items()->list[dict]:
    return []  # your real scrapers plug in here; index works either way

SHORT_TMPL = """<!doctype html><meta charset="utf-8">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{image}">
<meta property="og:url" content="{short}">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="{orig}">
<script>location.replace("{orig}");</script>
"""
def write_short(sid:str, item:dict, short_url:str):
    html = SHORT_TMPL.format(
        title=item["title"], desc=item.get("source") or host_of(item["url"]),
        image=item["image"], short=short_url, orig=item["url"]
    )
    with open(os.path.join(SHORT_DIR,f"{sid}.html"),"w",encoding="utf-8") as f:
        f.write(html)

def main():
    now = now_utc()
    existing = load_json(NEWS_JSON, {"updated": iso(now), "items": []})
    old_items = existing.get("items", [])
    key_map = {(it.get("url") or it.get("id")): it for it in old_items if (it.get("url") or it.get("id"))}

    fresh_raw = collect_items()
    fresh = [normalize(x) for x in fresh_raw]

    if not fresh and not old_items:
        boot = load_json(BOOT_JSON, [])
        if boot:
            fresh = [normalize(x) for x in boot]
            print(f"[bootstrap] loaded {len(fresh)} items")

    if not fresh:
        save_json(NEWS_JSON, {"updated": iso(now), "items": old_items})
        print(f"[keep] {len(old_items)} existing items, no new fetch")
        return

    for it in fresh:
        k = it.get("url") or it.get("id")
        key_map[k] = it
    merged = list(key_map.values())

    cutoff = now - timedelta(days=30)
    merged = [it for it in merged if within((cutoff, now), it["published"])]
    merged.sort(key=lambda x:x["published"], reverse=True)

    short_map = load_json(SHORTS_JSON, {})
    changed = False
    win_all = window_all(now)
    for it in merged:
        if within(win_all, it["published"]):
            sid = it["id"]
            if sid not in short_map:
                short_map[sid] = SHORT_BASE + f"{sid}.html"; changed=True
            write_short(sid, it, short_map[sid])
    if changed: save_json(SHORTS_JSON, short_map)

    save_json(NEWS_JSON, {"updated": iso(now), "items": merged})
    print(f"[write] {len(merged)} total items")

if __name__ == "__main__":
    if not os.path.exists(SHORTS_JSON): save_json(SHORTS_JSON, {})
    main()