#!/usr/bin/env python3
import os, json, hashlib, datetime as dt, re, pathlib
import requests, feedparser
from bs4 import BeautifulSoup

ROOT = pathlib.Path(__file__).parent.resolve()
DATA = ROOT / "data"
S_DIR = ROOT / "s"
NEWS_PATH = DATA / "news.json"
TEMPLATE = (ROOT / "article.html").read_text(encoding="utf-8")

DATA.mkdir(exist_ok=True)
S_DIR.mkdir(exist_ok=True)

# ---- Sources (add as many as you want)
FEEDS = [
  # Sector / OEMs
  ("Grid", "https://www.datacenterdynamics.com/en/rss/"),
  ("Policy", "https://www.reuters.com/markets/commodities/energy/rss"),
  ("Grid", "https://www.gevernova.com/press-releases/rss"),
  ("Grid", "https://www.hitachienergy.com/rss/newsroom"),
  ("Grid", "https://press.siemens-energy.com/en/pressreleases/all/rss.xml"),
  ("Grid", "https://www.se.com/ww/en/about-us/newsroom/news/press-releases-rss.xml"),
]

# --- Helpers
def short_id(url:str, n=6)->str:
    return hashlib.md5(url.encode("utf-8")).hexdigest()[:n]

def fetch_image(url):
    try:
        html = requests.get(url, timeout=10).text
        s = BeautifulSoup(html, "html.parser")
        og = s.find("meta", property="og:image") or s.find("meta", attrs={"name":"twitter:image"})
        if og and og.get("content"): return og["content"]
    except Exception:
        pass
    return ""

def norm_date(dtm):
    try:
        if isinstance(dtm, str):
            return dt.datetime.fromisoformat(dtm.replace("Z","+00:00")).astimezone(dt.timezone.utc)
        return dt.datetime(*dtm[:6], tzinfo=dt.timezone.utc)
    except Exception:
        return dt.datetime.utcnow().replace(tzinfo=dt.timezone.utc)

def parse_feed(cat, url):
    out=[]
    f = feedparser.parse(url)
    for e in f.entries[:40]:
        title = e.get("title","").strip()
        link = e.get("link","")
        if not title or not link: continue
        published = e.get("published_parsed") or e.get("updated_parsed")
        when = norm_date(published)
        src = re.sub(r"^https?://(www\.)?","",link).split("/")[0]
        img = ""
        # try media first
        if "media_content" in e and e.media_content:
            img = e.media_content[0].get("url","")
        if not img:
            img = fetch_image(link)
        sid = short_id(link)
        out.append({
            "id": sid,
            "title": title,
            "original": link,
            "url": f"https://ptdtoday.com/s/{sid}.html",
            "image": img,
            "source": src,
            "category": cat,
            "iso": when.isoformat(),
            "date": when.strftime("%Y-%m-%d %H:%M UTC"),
            "score": 1.0,
        })
    return out

def load_old():
    if NEWS_PATH.exists():
        try:
            return json.loads(NEWS_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"updated":"", "items":[]}

def save_news(items):
    items.sort(key=lambda x: x.get("iso",""), reverse=True)
    data = {
        "updated": dt.datetime.utcnow().replace(tzinfo=dt.timezone.utc).isoformat(),
        "items": items
    }
    NEWS_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")

def make_short(item):
    html = TEMPLATE
    html = html.replace("%%TITLE%%", item["title"])
    html = html.replace("%%IMAGE%%", item["image"] or "https://ptdtoday.com/assets/og-default.png")
    html = html.replace("%%ORIG%%", item["original"])
    html = html.replace("%%CANON%%", item["url"])
    (S_DIR / f"{item['id']}.html").write_text(html, encoding="utf-8")

def within_days(item, days=14):
    try:
        t = norm_date(item.get("iso"))
        return (dt.datetime.utcnow().replace(tzinfo=dt.timezone.utc)-t).days <= days
    except Exception:
        return True

# ---- Build
print("Fetching feeds...")
new_items=[]
for cat, url in FEEDS:
    try:
        new_items += parse_feed(cat, url)
    except Exception as e:
        print("feed error", url, e)

# Merge with existing
existing = load_old().get("items", [])
by_id = { i["id"]: i for i in existing if within_days(i, 21) }  # keep up to 21 days
for it in new_items:
    by_id[it["id"]] = it

# Generate shortlinks
for it in by_id.values():
    make_short(it)

save_news(list(by_id.values()))
print(f"Items total: {len(by_id)}")