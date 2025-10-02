# Requires: pip install feedparser python-dateutil beautifulsoup4 html5lib
import os, re, json, hashlib
from datetime import datetime, timezone, timedelta
from dateutil import parser as dtp
import feedparser
from bs4 import BeautifulSoup

# ======== CONFIG ========
OUT_DIR = os.path.join('data')
MAX_ITEMS = 5                 # number of top news items to keep
MIN_HOURS_NEW = 72            # only consider stories from last 3 days
KEYWORDS = [
    'HV','high voltage','substation','switchgear','transformer','STATCOM','SVC','HVDC',
    'FSC','series capacitor','synchronous condenser','SynCon','FACTS','OHL','T&D',
    'transmission line','grid','interconnector','ISO','TSO','protection','SCADA','PMU',
    'reliability','resilience','renewable','wind','offshore','solar','BESS','battery',
    'storage','inverter','curtailment','interconnection','policy','RTO','FERC','NERC',
    'CIGRE','IEEE','auction','PPA','RFP'
]

# RSS feeds
FEEDS = [
    "https://www.tdworld.com/rss",
    "https://www.smart-energy.com/feed/",
    "https://www.renewableenergyworld.com/feed/",
    "https://energycentral.com/news/rss",
    "https://www.power-technology.com/feed/",
    "https://feeds.feedburner.com/IeeeSpectrumEnergy"
]

# Google News queries
GN_QUERIES = [
    '("high voltage" OR HV OR "substation" OR "transmission line" OR HVDC) power grid',
    'STATCOM OR "synchronous condenser" OR "series capacitor" OR FACTS',
    'renewable transmission OR interconnection OR curtailment OR "grid congestion"'
]

def gnews_rss(q):
    import urllib.parse as up
    return f"https://news.google.com/rss/search?q={up.quote(q)}&hl=en-US&gl=US&ceid=US:en"

FEEDS += [gnews_rss(q) for q in GN_QUERIES]
# ======== /CONFIG ========

def clean_text(html):
    if not html: return ""
    soup = BeautifulSoup(html, "html5lib")
    return ' '.join(soup.get_text(" ").split())

def relevance_score(title, summary):
    text = f"{title} {summary}".lower()
    score = 0
    for kw in KEYWORDS:
        if kw.lower() in text:
            score += 1
    return score

def collect():
    seen = set()
    items = []
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=MIN_HOURS_NEW)

    for url in FEEDS:
        try:
            d = feedparser.parse(url)
            for e in d.entries:
                title = e.get('title', '').strip()
                if not title: continue
                uid = hashlib.md5((title + e.get('link','')).encode()).hexdigest()
                if uid in seen: continue
                seen.add(uid)

                link = e.get('link') or ''
                published = e.get('published') or e.get('updated') or ''
                try:
                    published_dt = dtp.parse(published)
                    if not published_dt.tzinfo: 
                        published_dt = published_dt.replace(tzinfo=timezone.utc)
                except Exception:
                    published_dt =_
