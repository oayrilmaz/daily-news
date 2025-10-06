#!/usr/bin/env python3
import hashlib, json, os, re, time, uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
import feedparser, requests
from bs4 import BeautifulSoup
from dateutil import parser as dtp

ROOT = os.path.dirname(__file__)
DATA_DIR = os.path.join(ROOT, "data")
S_DIR = os.path.join(ROOT, "s")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(S_DIR, exist_ok=True)

FALLBACK_IMG = "/assets/og-default.png"  # used when page has no OG image

# ---- Sources (direct publisher feeds so your links are original) ----
SOURCES = [
    # Data Center Dynamics (publisher)
    "https://www.datacenterdynamics.com/en/rss/",
    # Utility Dive (energy/data center/power)
    "https://www.utilitydive.com/rss/",
    # Reuters energy
    "https://feeds.reuters.com/reuters/energyNews",
    # Benzinga news (business/markets)
    "https://www.benzinga.com/rss",
]

# ---- Categorization via simple keyword mapping ----
CAT_RULES = {
    "grid":       ["grid", "transmission", "distribution", "pjm", "ercot", "ferc"],
    "substations":["substation", "transformer", "switchgear", "relay", "breaker"],
    "protection": ["protection", "relay", "fault", "arc flash", "safety"],
    "cables":     ["cable", "underground", "subsea", "hv cable", "xlpe"],
    "hvdc":       ["hvdc", "high-voltage direct", "converter station", "interconnector"],
    "renewables": ["solar", "wind", "renewable", "hydrogen", "ppa", "geothermal"],
    "policy":     ["policy", "regulation", "white house", "doe", "ferc"],
    "ai":         ["ai", "artificial intelligence", "model", "gpu", "nvidia"],
    "datacenters":["data center", "datacenter", "hyperscale", "colocation", "server farm"],
}

def pick_cat(text: str) -> str:
    t = text.lower()
    for cat, terms in CAT_RULES.items():
        if any(k in t for k in terms):
            return cat
    # sensible defaults based on site
    if "datacenterdynamics" in t: return "datacenters"
    if "utilitydive" in t: return "grid"
    return "grid"

def og_image(url: str) -> str:
    try:
        r = requests.get(url, timeout=10, headers={"User-Agent":"Mozilla/5.0"})
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "lxml")
        tag = soup.find("meta", property="og:image") or soup.find("meta", attrs={"name":"og:image"})
        if tag:
            content = tag.get("content") or tag.get("value")
            if content and content.strip():
                return content.strip()
    except Exception:
        pass
    return FALLBACK_IMG

def short_id(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:6]

def write_shortlink(item):
    """Create s/<id>.html with correct OG tags so LinkedIn/X show previews."""
    tid = item["id"]
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{item['title']}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:title" content="{item['title']}">
<meta property="og:description" content="{item.get('summary','').replace('"','')[:180]}">
<meta property="og:image" content="{item['image']}">
<meta property="og:url" content="https://ptdtoday.com/s/{tid}.html">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="{item['url']}">
<style>html,body{{margin:0}} .jump{{font:16px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial}} .wrap{{max-width:720px;margin:18vh auto;padding:0 20px}} a.btn{{display:inline-block;border:1px solid #333;padding:.7em 1em;border-radius:10px;text-decoration:none}} img{{max-width:100%;height:auto;border-radius:10px}}</style>
</head>
<body>
<div class="wrap">
  <p class="jump">You’re heading to the original article on <strong>{urlparse(item['url']).netloc}</strong>.</p>
  <p><a class="btn" href="{item['url']}">Continue to source →</a></p>
  <p style="margin-top:2rem"><img src="{item['image']}" alt=""></p>
</div>
<script>location.replace({json.dumps(item["url"])})</script>
</body>
</html>"""
    with open(os.path.join(S_DIR, f"{tid}.html"), "w", encoding="utf-8") as f:
        f.write(html)

def fetch():
    seen = set()
    items = []
    for feed in SOURCES:
        d = feedparser.parse(feed)
        for e in d.entries[:80]:
            link = e.get("link") or e.get("id")
            title = (e.get("title") or "").strip()
            if not link or not title:
                continue
            key = short_id(link)
            if key in seen:
                continue
            seen.add(key)

            # date
            dt = None
            for cand in (e.get("published"), e.get("updated"), e.get("created")):
                if cand:
                    try:
                        dt = dtp.parse(cand)
                        break
                    except Exception:
                        pass
            if not dt:
                dt = datetime.now(timezone.utc)

            # fetch OG image (only once per domain in case of rate limit)
            img = og_image(link)

            # summary
            summary = (e.get("summary") or e.get("description") or "").strip()
            cat = pick_cat(f"{title} {summary} {link}")

            items.append({
                "id": key,
                "title": title,
                "url": link,
                "image": img,
                "site": urlparse(link).netloc,
                "cat": cat,
                "score": round(0.25 + hash(key) % 750 / 1000, 3),  # lightweight stable pseudo-score
                "date": dt.astimezone(timezone.utc).isoformat(),
                "summary": summary[:500],
            })

    # newest first; keep at most 300
    items.sort(key=lambda x: x["date"], reverse=True)
    return items[:300]

def save(items):
    updated = datetime.now(timezone.utc).isoformat()
    # write shortlink pages first
    for it in items:
        write_shortlink(it)

    # and the json that index.html reads
    with open(os.path.join(DATA_DIR, "news.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": updated, "items": items}, f, ensure_ascii=False)

    # optional map id->short for debugging
    with open(os.path.join(DATA_DIR, "shortlinks.json"), "w", encoding="utf-8") as f:
        json.dump({it["id"]: f"/s/{it['id']}.html" for it in items}, f)

if __name__ == "__main__":
    print("Fetching feeds...")
    items = fetch()
    print(f"{len(items)} items")
    save(items)
    print("Done.")