import os, json, time, re, hashlib
from datetime import datetime, timezone
from urllib.parse import quote_plus

import feedparser
import requests
from bs4 import BeautifulSoup
from dateutil import parser as dtp

OUT_DIR = "data"
TOP_PATH = os.path.join(OUT_DIR, "top.json")
TREND_PATH = os.path.join(OUT_DIR, "trending.json")

os.makedirs(OUT_DIR, exist_ok=True)

USER_AGENT = "Mozilla/5.0 (compatible; PTDNewsBot/1.0; +https://consultlift.com)"

# ---------------------------------------------
# Helpers
# ---------------------------------------------
def now_iso():
    return datetime.now(timezone.utc).isoformat()

def clean_text(x):
    if not x:
        return ""
    return re.sub(r"\s+", " ", BeautifulSoup(x, "html5lib").get_text(" ", strip=True))

def hash_key(title, url):
    return hashlib.sha1((title.strip() + "|" + url.strip()).encode("utf-8")).hexdigest()

def fix_date(dtstr):
    if not dtstr:
        return None
    try:
        d = dtp.parse(dtstr)
        if not d.tzinfo:
            d = d.replace(tzinfo=timezone.utc)
        return d
    except Exception:
        return None

def to_item(title, url, source, published=None, summary=None, score=0):
    return {
        "title": clean_text(title)[:300],
        "url": url,
        "source": source,
        "published": (published or datetime.now(timezone.utc)).isoformat(),
        "summary": clean_text(summary)[:600] if summary else "",
        "score": score,
    }

# ---------------------------------------------
# Sources
# ---------------------------------------------
def google_news_queries():
    base = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q="
    queries = [
        "power+transmission+when:24h",
        "power+distribution+when:24h",
        "electric+grid+when:24h",
        "renewable+energy+grid+when:24h",
        "wind+power+grid+when:24h",
        "ai+data+center+energy+when:24h",
        "utility+power+when:24h",
    ]
    return [base + q for q in queries]

RSS_SOURCES = [
    # Good industry feeds
    "https://www.tdworld.com/rss.xml",
    "https://www.power-technology.com/feed/",
    "https://www.offshorewind.biz/feed/",
    # Google News queries
    *google_news_queries(),
]

# Popularity sources (provide scores or “trending” feel)
def reddit_jsons():
    subs = ["energy", "renewableenergy", "technology"]
    return [f"https://www.reddit.com/r/{s}/top/.json?t=day&limit=25" for s in subs]

HN_RSS = "https://hnrss.org/frontpage"

# ---------------------------------------------
# Harvesting
# ---------------------------------------------
def harvest_rss(url):
    items = []
    d = feedparser.parse(url)
    for e in d.entries:
        title = e.get("title") or ""
        link = e.get("link") or ""
        if not title or not link:
            continue
        source = d.feed.get("title") or "RSS"
        published = None
        for k in ("published_parsed", "updated_parsed", "created_parsed"):
            if e.get(k):
                published = datetime.fromtimestamp(time.mktime(e[k]), tz=timezone.utc)
                break
        if not published:
            published = fix_date(e.get("published") or e.get("updated") or e.get("created"))

        summary = e.get("summary") or e.get("description") or ""
        items.append(to_item(title, link, source, published, summary))
    return items

def harvest_reddit(url):
    items = []
    try:
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=20)
        r.raise_for_status()
        data = r.json()
        for child in data.get("data", {}).get("children", []):
            d = child.get("data", {})
            title = d.get("title")
            link = d.get("url")
            score = int(d.get("score") or 0)
            if not title or not link:
                continue
            items.append(to_item(title, link, "Reddit", datetime.fromtimestamp(d.get("created_utc", time.time()), tz=timezone.utc), "", score))
    except Exception:
        pass
    return items

def harvest_hn():
    items = []
    try:
        d = feedparser.parse(HN_RSS)
        for e in d.entries:
            title = e.get("title") or ""
            link = e.get("link") or ""
            if not title or not link:
                continue
            # try to extract points from title (format: "Title (123 points)")
            m = re.search(r"\((\d+)\spoints\)", title)
            score = int(m.group(1)) if m else 0
            items.append(to_item(title, link, "Hacker News", fix_date(e.get("published")), "", score))
    except Exception:
        pass
    return items

# ---------------------------------------------
# Scoring / dedupe
# ---------------------------------------------
KEYWORD_BOOSTS = {
    "transmission": 2.0,
    "distribution": 2.0,
    "grid": 1.8,
    "hv": 1.5,
    "substation": 1.6,
    "wind": 1.3,
    "renewable": 1.2,
    "ai": 1.2,
    "data center": 1.2,
    "utility": 1.1,
}

def keyword_score(title):
    t = title.lower()
    score = 0.0
    for k, w in KEYWORD_BOOSTS.items():
        if k in t:
            score += w
    return score

def recency_score(dt):
    if not dt:
        return 0.0
    # hours since now; fresher = higher
    hours = (datetime.now(timezone.utc) - dt).total_seconds()/3600
    return max(0.0, 12 - hours)  # 0..12

def merge_and_rank(raw_items):
    # Deduplicate by normalized (title,url)
    seen = {}
    for it in raw_items:
      key = hash_key(it["title"], it["url"])
      if key not in seen:
          seen[key] = it
      else:
          # keep earlier summary if missing, and earliest/strongest published
          if not seen[key]["summary"] and it["summary"]:
              seen[key]["summary"] = it["summary"]

    items = list(seen.values())
    # Add score
    for it in items:
        dt = fix_date(it["published"])
        it["_dt"] = dt
        it["score"] = it.get("score", 0) + keyword_score(it["title"]) + recency_score(dt)

    # Sort by score then recency
    items.sort(key=lambda x: (x["score"], x["_dt"] or datetime.fromtimestamp(0, tz=timezone.utc)), reverse=True)
    for it in items:
        if "_dt" in it:
            del it["_dt"]
    return items

# ---------------------------------------------
# Build feeds
# ---------------------------------------------
def build_top():
    raw = []
    for url in RSS_SOURCES:
        try:
            raw.extend(harvest_rss(url))
        except Exception:
            pass
    top_items = merge_and_rank(raw)[:40]
    return {
        "generated_at": now_iso(),
        "generated_at_readable": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "items": top_items
    }

def build_trending():
    raw = []
    # popularity-driven sources
    for url in reddit_jsons():
        raw.extend(harvest_reddit(url))
    raw.extend(harvest_hn())
    # also count items that repeat across mainstream feeds (proxy for “most cited”)
    # (already merged in merge_and_rank)
    trending_items = merge_and_rank(raw)[:30]
    return {
        "generated_at": now_iso(),
        "generated_at_readable": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "items": trending_items
    }

def main():
    top = build_top()
    with open(TOP_PATH, "w", encoding="utf-8") as f:
        json.dump(top, f, ensure_ascii=False, indent=2)

    trending = build_trending()
    with open(TREND_PATH, "w", encoding="utf-8") as f:
        json.dump(trending, f, ensure_ascii=False, indent=2)

    print(f"Wrote {TOP_PATH} and {TREND_PATH}")

if __name__ == "__main__":
    main()
