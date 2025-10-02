# Auto-pull & rank daily energy/T&D headlines with per-source caps
# Requires: feedparser, python-dateutil, beautifulsoup4, html5lib

import os, json, re, hashlib
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse, quote
import feedparser
from dateutil import parser as dtp
from bs4 import BeautifulSoup

# ---------- CONFIG ----------
MAX_ITEMS = 8                 # total items to publish
PER_SOURCE_MAX = 2            # cap per source so nobody dominates
MAX_PER_FEED_PULL = 20        # how many entries we read per feed
LOOKBACK_HOURS = 96           # only consider recent items (last 4 days)

FEEDS = [
    # Trade/industry
    "https://www.tdworld.com/rss",
    "https://www.smart-energy.com/feed/",
    "https://www.renewableenergyworld.com/feed/",
    "https://energycentral.com/news/rss",
    "https://www.power-technology.com/feed/",
    "https://feeds.feedburner.com/IeeeSpectrumEnergy",
    # General energy biz
    "https://www.reuters.com/business/energy/rss",  # Reuters Energy
    "https://www.utilitydive.com/feeds/news/",      # Utility Dive
]

# Focused Google News searches (RSS)
GN_QUERIES = [
    '("high voltage" OR HV OR HVDC OR "substation" OR "transmission line") grid',
    'STATCOM OR "synchronous condenser" OR FACTS OR "series capacitor"',
    'interconnector OR "grid congestion" OR interconnection OR curtailment',
]
def gnews(q: str) -> str:
    return f"https://news.google.com/rss/search?q={quote(q)}&hl=en-US&gl=US&ceid=US:en"
FEEDS += [gnews(q) for q in GN_QUERIES]

# Optional: exclude any domains you don’t want
BLACKLIST_DOMAINS = set([
    # example: "example.com"
])

# Keywords to nudge relevance toward HV/transmission/grid
KEYWORDS = [
    r"\b(HV|high voltage|HVDC|substation|switchgear|transformer|STATCOM|SVC|FACTS|SynCon|synchronous condenser|series capacitor|OHL|T&D|transmission line|interconnector|BESS|curtailment|interconnection|grid|reliability|resilience|SCADA|PMU|protection|ISO|TSO)\b"
]

# ---------- HELPERS ----------
def plain_text(html: str) -> str:
    if not html: return ""
    return " ".join(BeautifulSoup(html, "html5lib").get_text(" ").split())

def domain_of(url: str) -> str:
    try:
        return urlparse(url).netloc.replace("www.", "")
    except Exception:
        return ""

def relevance(title: str, summary: str) -> int:
    text = (title + " " + summary).lower()
    score = 0
    for pat in KEYWORDS:
        if re.search(pat, text, flags=re.I):
            score += 1
    return score

# ---------- MAIN COLLECTOR ----------
def collect_items():
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=LOOKBACK_HOURS)
    seen = set()
    items = []

    for feed_url in FEEDS:
        try:
            d = feedparser.parse(feed_url)
        except Exception:
            continue
        feed_title = d.feed.get("title", "") if hasattr(d, "feed") else ""
        for e in d.entries[:MAX_PER_FEED_PULL]:
            title = e.get("title", "").strip()
            link  = e.get("link", "")
            if not title or not link: 
                continue
            key = hashlib.md5((title + link).encode()).hexdigest()
            if key in seen: 
                continue
            seen.add(key)

            dom = domain_of(link)
            if dom in BLACKLIST_DOMAINS: 
                continue

            # parse published date
            published_raw = e.get("published") or e.get("updated") or ""
            try:
                dt = dtp.parse(published_raw)
                if not dt.tzinfo:
                    dt = dt.replace(tzinfo=timezone.utc)
            except Exception:
                dt = now  # fallback

            if dt < cutoff:
                continue

            summary = plain_text(e.get("summary") or e.get("description") or "")
            src = feed_title or dom or "Source"
            score = relevance(title, summary)

            # freshness boost (0..1)
            hrs_old = max(0, (now - dt).total_seconds()/3600.0)
            fresh = max(0.0, 48.0 - hrs_old)/48.0

            final = score*2 + fresh

            items.append({
                "title": title,
                "url": link,
                "summary": summary[:320],
                "source": src,
                "domain": dom,
                "published": dt.isoformat(),
                "score": round(final, 3)
            })

    # Sort by score then recency
    items.sort(key=lambda x: (x["score"], x["published"]), reverse=True)

    # Enforce per-source cap
    out, count_by_domain = [], {}
    for it in items:
        dom = it["domain"] or it["source"]
        count_by_domain.setdefault(dom, 0)
        if count_by_domain[dom] < PER_SOURCE_MAX:
            out.append(it)
            count_by_domain[dom] += 1
        if len(out) >= MAX_ITEMS:
            break
    return out

def write_outputs(items):
    os.makedirs("data", exist_ok=True)
    now = datetime.now(timezone.utc)
    data = {
        "generated_at": now.isoformat(),
        "generated_at_readable": now.astimezone().strftime("%Y-%m-%d %H:%M %Z"),
        "items": items
    }
    with open("data/top.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # LinkedIn text
    lines = [f"🔌 Today’s Top Energy & Grid Headlines — {now.astimezone().strftime('%b %d, %Y')}\n"]
    for i, it in enumerate(items, 1):
        lines.append(f"{i}) {it['title']}  [{it['source']}]")
        lines.append(it["url"] + "\n")
    lines.append("—")
    lines.append("Follow for daily HV, transmission, grid & renewables updates.")
    with open("data/linkedin.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

if __name__ == "__main__":
    items = collect_items()
    write_outputs(items)
