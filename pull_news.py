# Daily Energy/T&D headlines tuned for HV + AI data centers + Wind
# Requires: feedparser, python-dateutil, beautifulsoup4, html5lib

import os, json, re, hashlib
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse, quote
import feedparser
from dateutil import parser as dtp
from bs4 import BeautifulSoup

# ---------- CONFIG ----------
MAX_ITEMS        = 10           # total items to publish
PER_SOURCE_MAX   = 2            # cap per source
MAX_PER_FEED     = 25           # entries scanned per feed
LOOKBACK_HOURS   = 120          # last 5 days

# Core grid/HV + NEW data center + wind feeds
FEEDS = [
    # Grid / T&D / HV
    "https://www.tdworld.com/rss",
    "https://www.smart-energy.com/feed/",
    "https://www.renewableenergyworld.com/feed/",
    "https://energycentral.com/news/rss",
    "https://www.power-technology.com/feed/",
    "https://feeds.feedburner.com/IeeeSpectrumEnergy",

    # Data center & AI infra (power/cooling/interconnection)
    "https://www.datacenterdynamics.com/en/rss/",
    "https://www.datacenterfrontier.com/rss",
    "https://www.datacenterknowledge.com/rss.xml",
    "https://www.hpcwire.com/feed/",

    # Wind-specific
    "https://www.offshorewind.biz/feed/",
    "https://www.windpowerengineering.com/feed/",
    "https://www.renewableenergyworld.com/wind-power/feed/",
]

# Focused Google News searches (RSS)
GN_QUERIES = [
    # AI data centers + grid/substations
    '"AI data center" OR "hyperscale data center" power OR substation OR grid OR interconnection',
    'hyperscale data center PPA OR offtake OR "grid connection" OR "interconnection queue"',
    # Wind PPAs & buildout
    '"wind farm" PPA OR offtake OR tender OR auction',
    'offshore wind grid connection OR interconnector OR HVDC',
]
def gnews(q: str) -> str:
    return f"https://news.google.com/rss/search?q={quote(q)}&hl=en-US&gl=US&ceid=US:en"
FEEDS += [gnews(q) for q in GN_QUERIES]

# Optional domain blacklist
BLACKLIST_DOMAINS = set([])

# Keyword scoring — base relevance to keep HV/T&D + renewables
BASE_PATTERNS = [
    r"\b(HV|HVDC|high voltage|substation|switchgear|transformer|STATCOM|SVC|FACTS|SynCon|synchronous condenser|series capacitor|OHL|T&D|transmission line|interconnector|BESS|curtailment|interconnection|grid|reliability|resilience|SCADA|PMU|protection|ISO|TSO)\b",
    r"\b(renewable|wind|offshore wind|solar|battery|storage|inverter|PPA|tender|auction)\b",
]

# EXTRA boosts for your groups (AI DC + wind focus)
BOOST_WEIGHTS = {
    # AI & data centers
    r"\bAI data center\b":          3,
    r"\bhyperscale data center\b":  3,
    r"\bdata center(s)?\b":         2,
    r"\bpower usage effectiveness\b":1,
    r"\bliquid cooling|immersion cooling|direct-to-chip cooling\b": 2,
    r"\bsubstation\b.*\bdata center\b": 3,
    r"\binterconnection\b.*\bdata center\b": 3,
    r"\bPUE\b": 1,

    # Wind specifics
    r"\boffshore wind\b":           3,
    r"\bwind (farm|project|turbine|capacity)\b": 2,
    r"\bcorporate PPA\b":           2,
    r"\bofftake agreement\b":       2,
}

def plain_text(html: str) -> str:
    if not html: return ""
    return " ".join(BeautifulSoup(html, "html5lib").get_text(" ").split())

def domain_of(url: str) -> str:
    try:
        return urlparse(url).netloc.replace("www.", "")
    except Exception:
        return ""

def score_item(title: str, summary: str) -> float:
    text = (title + " " + summary).lower()
    score = 0.0
    # base relevance
    for pat in BASE_PATTERNS:
        if re.search(pat, text, flags=re.I):
            score += 1.0
    # boosted relevance
    for pat, wt in BOOST_WEIGHTS.items():
        if re.search(pat, text, flags=re.I):
            score += float(wt)
    return score

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
        for e in d.entries[:MAX_PER_FEED]:
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

            published_raw = e.get("published") or e.get("updated") or ""
            try:
                dt = dtp.parse(published_raw)
                if not dt.tzinfo:
                    dt = dt.replace(tzinfo=timezone.utc)
            except Exception:
                dt = now

            if dt < cutoff:
                continue

            summary = plain_text(e.get("summary") or e.get("description") or "")
            src = feed_title or dom or "Source"

            relevance = score_item(title, summary)
            # freshness boost (0..1)
            hrs_old = max(0, (now - dt).total_seconds()/3600.0)
            fresh = max(0.0, 48.0 - hrs_old)/48.0

            final = relevance*2.0 + fresh  # weight relevance more

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
    out, count = [], {}
    for it in items:
        dom = it["domain"] or it["source"]
        count.setdefault(dom, 0)
        if count[dom] < PER_SOURCE_MAX:
            out.append(it)
            count[dom] += 1
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
    lines = [f"🔌 Today’s Top Energy, Grid, AI Data Center & Wind — {now.astimezone().strftime('%b %d, %Y')}\n"]
    for i, it in enumerate(items, 1):
        lines.append(f"{i}) {it['title']}  [{it['source']}]")
        lines.append(it["url"] + "\n")
    lines.append("—")
    lines.append("Follow for daily HV, transmission, AI data centers & wind updates.")
    with open("data/linkedin.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

if __name__ == "__main__":
    items = collect_items()
    write_outputs(items)
