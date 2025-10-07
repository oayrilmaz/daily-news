#!/usr/bin/env python3
import json
from datetime import datetime, timedelta

# ---------- Replace this with your real scrapers ----------
def sample_items():
    # Return a list of dicts with the fields used on the site.
    # Keep absolute image URLs and a proper ISO UTC timestamp.
    return [
        {
            "title": "OpenAI valued at $500bn in employee share sale",
            "url": "https://www.datacenterdynamics.com/en/news/openai-valued-500bn-employee-share-sale/",
            "short": "https://ptdtoday.com/s/dcbf8a.html",
            "source": "datacenterdynamics.com",
            "category": "grid",
            "date": "2025-10-05T18:13:20Z",
            "score": 0.94,
            "image_url": "https://images.unsplash.com/photo-1556157382-97eda2d62296?q=80&w=1200"
        },
        {
            "title": "Wafer-scale AI chip company Cerebras drops IPO plans",
            "url": "https://www.datacenterdynamics.com/en/news/cerebras-drops-ipo-plans/",
            "short": "https://ptdtoday.com/s/39a670.html",
            "source": "datacenterdynamics.com",
            "category": "grid",
            "date": "2025-10-05T17:44:09Z",
            "score": 0.92,
            "img": "https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=1200"
        },
        {
            "title": "PJM launches fast track proposal for new generation amid data center demand",
            "url": "https://www.utilitydive.com/news/pjm-fast-track-new-generation-data-center-demand/",
            "short": "https://ptdtoday.com/s/5a2a6e.html",
            "source": "utilitydive.com",
            "category": "policy",
            "date": "2025-10-06T16:35:24Z",
            "score": 0.548,
            "thumbnail": "https://images.unsplash.com/photo-1509395176047-4a66953fd231?q=80&w=1200"
        },
        {
            "title": "Energy strategies for data opportunities",
            "url": "https://www.utilitydive.com/news/energy-strategies-data-centers/",
            "short": "https://ptdtoday.com/s/3d25ef.html",
            "source": "utilitydive.com",
            "category": "renewables",
            "date": "2025-10-06T16:09:38Z",
            "score": 0.860,
            "thumb": "https://images.unsplash.com/photo-1497436072909-60f360e1d4b1?q=80&w=1200"
        },
        {
            "title": "Digital Realty partners with DXC for enterprise AI platform",
            "url": "https://www.datacenterdynamics.com/en/news/digital-realty-dxc-enterprise-ai-platform/",
            "short": "https://ptdtoday.com/s/416348.html",
            "source": "datacenterdynamics.com",
            "category": "ai",
            "date": "2025-10-04T09:00:03Z",
            "score": 0.751,
            "image": "https://images.unsplash.com/photo-1518779578993-ec3579fee39f?q=80&w=1200"
        },
        {
            "title": "Can data centers ever be sustainable? A wake-up call for the industry",
            "url": "https://www.datacenterdynamics.com/en/analysis/can-data-centers-be-sustainable/",
            "short": "https://ptdtoday.com/s/469ce3.html",
            "source": "datacenterdynamics.com",
            "category": "datacenters",
            "date": "2025-10-04T07:00:00Z",
            "score": 0.912,
            "picture": "https://images.unsplash.com/photo-1496307042754-b4aa456c4a2d?q=80&w=1200"
        }
    ]
# ---------------------------------------------------------

def utcnow():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

def compute_window(now=None):
    if now is None:
        now = datetime.utcnow()
    wd = now.weekday()  # Mon=0 … Sun=6
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end   = now.replace(hour=23, minute=59, second=59, microsecond=999000)
    if wd == 5:          # Sat  -> Fri+Sat
        start = start - timedelta(days=1)
    elif wd == 6:        # Sun  -> Fri+Sat+Sun
        start = start - timedelta(days=2)
    elif wd == 0:        # Mon  -> Fri+Sat+Sun+Mon
        start = start - timedelta(days=3)
    return start, end

def main():
    items_all = sample_items()

    # --- daily/weekend window (your existing behavior) ---
    start, end = compute_window()
    def in_window(it):
        t = datetime.fromisoformat(it["date"].replace("Z",""))
        return start <= t <= end

    items_today = [it for it in items_all if in_window(it)]
    items_today.sort(key=lambda x: x.get("date",""), reverse=True)

    with open("data/news.json", "w", encoding="utf-8") as f:
        json.dump({"updated": utcnow(), "items": items_today}, f, ensure_ascii=False)

    # --- strict last 7 days (Top 7d tab) ---
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    items_7d = [it for it in items_all
                if datetime.fromisoformat(it["date"].replace("Z","")) >= seven_days_ago]
    # Sort by score desc (ties by date)
    items_7d.sort(key=lambda x: (x.get("score", 0), x.get("date","")), reverse=True)

    with open("data/news_7d.json", "w", encoding="utf-8") as f:
        json.dump({"updated": utcnow(), "items": items_7d}, f, ensure_ascii=False)

    print("Wrote data/news.json and data/news_7d.json")

if __name__ == "__main__":
    main()