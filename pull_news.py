#!/usr/bin/env python3
import hashlib, json, os, re
from datetime import datetime, timezone
from urllib.parse import urlparse, urljoin
import feedparser, requests
from bs4 import BeautifulSoup
from dateutil import parser as dtp

ROOT = os.path.dirname(__file__)
DATA_DIR = os.path.join(ROOT, "data")
S_DIR = os.path.join(ROOT, "s")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(S_DIR, exist_ok=True)

FALLBACK_IMG = "/assets/og-default.png"

# ---- Publisher feeds (original sources) ----
SOURCES = [
    "https://www.datacenterdynamics.com/en/rss/",
    "https://www.utilitydive.com/rss/",
    "https://feeds.reuters.com/reuters/energyNews",
    "https://www.benzinga.com/rss",
]

# ---- Keyword → category rules ----
CAT_RULES = {
    "grid":       ["grid","transmission","distribution","pjm","ercot","ferc","outage"],
    "substations":["substation","transformer","switchgear","relay","breaker","busbar"],
    "protection": ["protection","relay","fault","arc flash","safety"],
    "cables":     ["cable","underground","subsea","xlpe"],
    "hvdc":       ["hvdc","converter station","interconnector","flexible dc"],
    "renewables": ["solar","wind","renewable","hydrogen","geothermal","ppa"],
    "policy":     ["policy","regulation","doe","ferc","white house","treasury","eu"],
    "ai":         ["ai","artificial intelligence","model","gpu","nvidia","llm"],
    "datacenters":["data center","datacenter","hyperscale","colocation","server farm"],
}

def pick_cat(text: str) -> str:
    t = text.lower()
    for cat, terms in CAT_RULES.items():
        if any(k in t for k in terms):
            return cat
    if "datacenterdynamics" in t: return "datacenters"
    if "utilitydive" in t: return "grid"
    return "grid"

def _force_https(u: str) -> str:
    if u.startswith("//"): return "https:" + u
    if u.startswith("http://"): return "https://" + u[7:]
    return u

def og_image(page_url: str) -> str:
    """Resolve OG image; return absolute https URL or FALLBACK_IMG."""
    try:
        r = requests.get(page_url, timeout=10,
                         headers={"User-Agent":"Mozilla/5.0 PTDToday"})
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "lxml")
        tag = soup.find("meta", property="og:image") or soup.find("meta", attrs={"name":"og:image"})
        if tag:
            content = (tag.get("content") or tag.get("value") or "").strip()
            if content:
                absu = urljoin(page_url, content)  # fix relative paths
                return _force_https(absu)
    except Exception:
        pass
    return FALLBACK_IMG

def short_id(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:6]

def write_shortlink(item):
    tid = item["id"]
    html = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>{item['title']}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:title" content="{item['title']}">
<meta property="og:description" content="{(item.get('summary','') or '').replace('"','')[:180]}">
<meta property="og:image" content="{item['image']}">
<meta property="og:url" content="https://ptdtoday.com/s/{tid}.html">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="{item['url']}">
<style>html,body{{margin:0;background:#f6efe3;color:#1b1b1b}} .w{{max-width:720px;margin:16vh auto;padding:0 20px;font:16px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial}} a.btn{{display:inline-block;margin-top:10px;border:1px solid #333;border-radius:10px;padding:.7em 1em;text-decoration:none;color:#111}} img{{max-width:100%;height:auto;border-radius:10px}}</style>
</head><body>
<div class="w">
  <p>You’re heading to the original article on <strong>{urlparse(item['url']).netloc}</strong>.</p>
  <a class="btn" href="{item['url']}">Continue to source →</a>
  <p style="margin-top:2rem"><img src="{item['image']}" alt=""></p>
</div>
<script>location.replace({json.dumps(item["url"])})</script>
</body></html>"""
    with open(os.path.join(S_DIR, f"{tid}.html"), "w", encoding="utf-8") as f:
        f.write(html)

def fetch():
    seen = set()
    items = []
    for feed in SOURCES:
        d = feedparser.parse(feed)
        for e in d.entries[:100]:
            link  = e.get("link") or e.get("id")
            title = (e.get("title") or "").strip()
            if not link or not title: continue
            sid = short_id(link)
            if sid in seen: continue
            seen.add(sid)

            # parse date
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
            dt = dt.astimezone(timezone.utc)

            summary = (e.get("summary") or e.get("description") or "").strip()
            cat = pick_cat(f"{title} {summary} {link}")

            image = og_image(link)

            items.append({
                "id": sid,
                "title": title,
                "url": link,
                "image": image,
                "site": urlparse(link).netloc,
                "cat": cat,
                "score": round(0.25 + (hash(sid) % 750) / 1000, 3),
                "date": dt.isoformat(),
                "summary": summary[:500],
            })
    # newest first; keep a healthy backlog
    items.sort(key=lambda x: x["date"], reverse=True)
    return items[:500]

def save(items):
    updated = datetime.now(timezone.utc).isoformat()
    for it in items:
        write_shortlink(it)
    with open(os.path.join(DATA_DIR, "news.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": updated, "items": items}, f, ensure_ascii=False, indent=0)
    with open(os.path.join(DATA_DIR, "shortlinks.json"), "w", encoding="utf-8") as f:
        json.dump({it["id"]: f"/s/{it['id']}.html" for it in items}, f)

if __name__ == "__main__":
    print("Fetching feeds…")
    items = fetch()
    print(f"{len(items)} items")
    save(items)
    print("Done.")