#!/usr/bin/env python3
import hashlib, json, os, re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
import feedparser
import requests

OUT_DIR = "data"
SHORT_DIR = "s"
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(SHORT_DIR, exist_ok=True)

# --------- Feeds (stable, publicly available) ----------
FEEDS = [
  # Data Center Dynamics (great sector overlap)
  "https://www.datacenterdynamics.com/en/rss/",
  # Utility Dive – Grid and policy
  "https://www.utilitydive.com/feeds/news/",
  # Reuters Technology (AI & infra items)
  "https://feeds.reuters.com/reuters/technologyNews",
  # GE Vernova newsroom (RSS)
  "https://www.gevernova.com/rss.xml",
  # Hitachi Energy newsroom (RSS)
  "https://www.hitachienergy.com/rss/news.xml",
  # Siemens Energy newsroom
  "https://press.siemens-energy.com/en/pressreleases/feed",
]

# Category heuristics
CAT_RULES = [
  ("HVDC", r"\bhvdc\b"),
  ("Substations", r"\bsubstation"),
  ("Protection", r"protection|relay|iec\s*61850|scada"),
  ("Cables", r"cable|xlpe|subsea"),
  ("Renewables", r"renewable|solar|wind|hydro|geothermal|ppa|offshore"),
  ("Grid", r"grid|transmission|interconnector|substation|capacity|datacenter|data\s*center"),
  ("Policy", r"ferc|regulator|policy|tariff|legislation|doe|ppa|incentive|permitting"),
]

def classify(title, summary, source):
  text = f"{title} {summary} {source}".lower()
  for cat, rx in CAT_RULES:
    if re.search(rx, text):
      return cat
  return "Grid"

def best_image(entry):
  # try media thumbnails first
  if 'media_thumbnail' in entry and entry.media_thumbnail:
    return entry.media_thumbnail[0]['url']
  if 'media_content' in entry and entry.media_content:
    return entry.media_content[0].get('url')
  # look inside summary
  if 'summary' in entry:
    m = re.search(r'<img[^>]+src="([^"]+)"', entry.summary, re.I)
    if m: return m.group(1)
  return None

def hash_id(url, title):
  h = hashlib.sha1((url + '|' + title).encode('utf-8')).hexdigest()
  return h[:7]  # short, good enough

def fetch_all():
  items = []
  for url in FEEDS:
    f = feedparser.parse(url)
    for e in f.entries[:30]:
      title = e.get('title','').strip()
      link  = e.get('link','').strip()
      if not title or not link:
        continue
      published = None
      if 'published_parsed' in e and e.published_parsed:
        published = datetime(*e.published_parsed[:6], tzinfo=timezone.utc).isoformat()
      else:
        published = datetime.now(timezone.utc).isoformat()
      src = urlparse(link).hostname or 'news'
      img = best_image(e)
      cat = classify(title, e.get('summary',''), src)
      score = 0.25
      # simple boost if keywords present
      if re.search(r'\bhvdc|substation|interconnector|offshore|grid\b', title.lower()):
        score += 0.2
      item = {
        "id": hash_id(link, title),
        "title": title,
        "url": link,
        "image": img,
        "published": published,
        "source": src,
        "category": cat,
        "score": score
      }
      items.append(item)
  # keep most recent first
  items.sort(key=lambda x: x['published'], reverse=True)
  return items

def write_json(items):
  updated = datetime.now(timezone.utc).isoformat()
  with open(os.path.join(OUT_DIR, "news.json"), "w", encoding="utf-8") as f:
    json.dump({"updated":updated, "items":items}, f, ensure_ascii=False, indent=2)

def build_short_pages(items):
  # also build /data/shortlinks.json for reference (optional)
  sl = {}
  for it in items:
    sl[it['id']] = {"url": it["url"], "title": it["title"], "image": it.get("image")}
    ogimg = it.get("image") or "https://ptdtoday.com/assets/og-default.png"
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{it['title']} | PTD Today</title>
<meta http-equiv="refresh" content="0;url={it['url']}">
<link rel="canonical" href="{it['url']}">
<meta property="og:title" content="{it['title']}">
<meta property="og:description" content="Read this on PTD Today, then continue to the original source.">
<meta property="og:image" content="{ogimg}">
<meta property="og:type" content="article">
<meta property="og:url" content="https://ptdtoday.com/s/{it['id']}.html">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{it['title']}">
<meta name="twitter:image" content="{ogimg}">
</head>
<body>
<p>Redirecting to the original story… <a href="{it['url']}">Continue</a></p>
</body>
</html>"""
    with open(os.path.join(SHORT_DIR, f"{it['id']}.html"), "w", encoding="utf-8") as f:
      f.write(html)
  with open(os.path.join(OUT_DIR, "shortlinks.json"), "w", encoding="utf-8") as f:
    json.dump(sl, f, ensure_ascii=False, indent=2)

def main():
  items = fetch_all()
  # hard keep: last 400 items (enough for 7d window typically)
  items = items[:400]
  write_json(items)
  build_short_pages(items)
  print(f"OK — {len(items)} items")

if __name__ == "__main__":
  main()