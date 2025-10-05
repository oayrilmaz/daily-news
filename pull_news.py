#!/usr/bin/env python3
"""
PTD Today — Automated news pull + shortlink page generator
----------------------------------------------------------
Creates:
  • /data/news.json   → consumed by index.html
  • /s/{id}.html      → OG/Twitter-rich redirect pages for LinkedIn/X
"""

from pathlib import Path
from datetime import datetime, timezone
import json, re, hashlib, html

# ------------- CONFIG -------------------------------------------------------
DATA_DIR = Path("data")
SHORTLINK_DIR = Path("s")
TEMPLATE_PATH = Path("article.html")
JSON_PATH = DATA_DIR / "news.json"

DEFAULT_IMAGE = "https://ptdtoday.com/assets/og-default.png"
DEFAULT_DESC  = "Energy & Power Transmission Daily News — PTD Today"

# ------------- SHORTLINK TEMPLATE LOADING ----------------------------------
SHORTLINK_TEMPLATE = TEMPLATE_PATH.read_text(encoding="utf-8")

def sanitize(txt: str) -> str:
    return html.escape(txt or "").replace("\n", " ").strip()

def make_id(url: str) -> str:
    """8-char stable hash from URL."""
    return hashlib.md5(url.encode("utf-8")).hexdigest()[:8]

def write_shortlink_page(sid: str, title: str, desc: str, image: str, source: str):
    """Write /s/{sid}.html with proper OpenGraph and Twitter cards."""
    SHORTLINK_DIR.mkdir(parents=True, exist_ok=True)

    safe_map = {
        "{{id}}": sid,
        "{{title}}": sanitize(title),
        "{{description}}": sanitize(desc or DEFAULT_DESC),
        "{{image}}": image or DEFAULT_IMAGE,
        "{{source}}": source
    }

    html_out = SHORTLINK_TEMPLATE
    for k, v in safe_map.items():
        html_out = html_out.replace(k, v)

    Path(SHORTLINK_DIR, f"{sid}.html").write_text(html_out, encoding="utf-8")

# ------------- BUILD ITEMS -------------------------------------------------
def load_existing():
    if JSON_PATH.exists():
        try:
            return json.loads(JSON_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {"items": []}
    return {"items": []}

def build_item(title, url, category, image=None, description=None, source=None, score=None):
    sid = make_id(url)
    write_shortlink_page(
        sid=sid,
        title=title,
        desc=description or DEFAULT_DESC,
        image=image or DEFAULT_IMAGE,
        source=url
    )
    return {
        "id": sid,
        "title": title,
        "url": url,
        "category": category.lower(),
        "image": image or DEFAULT_IMAGE,
        "description": description or DEFAULT_DESC,
        "source": source or re.sub(r"^https?://(www\.)?", "", url).split("/")[0],
        "published": datetime.now(timezone.utc).isoformat(),
        "score": score or 0.0,
    }

# ------------- SAMPLE DATA (replace with your scraper later) ---------------
def sample_items():
    """Temporary static items for testing."""
    return [
        build_item(
            "Photonics startup PINC Technologies secures $6.8 m from Seed funding round",
            "https://www.datacenterdynamics.com/en/news/photonics-startup-pinc-technologies-secures-68m-from-seed-funding-round/",
            "grid",
            "https://media.datacenterdynamics.com/media/images/pinc-logo.width-800.jpg",
            "PINC Technologies has raised $6.8 million to expand photonics-based interconnect solutions for data centers.",
            "datacenterdynamics.com",
            3.642
        ),
        build_item(
            "EE targets 99 % 5 G Standalone coverage across UK by FY 2030",
            "https://www.datacenterdynamics.com/en/news/ee-targets-99-5g-standalone-coverage-across-uk-by-end-of-fy2030/",
            "renewables",
            "https://media.datacenterdynamics.com/media/images/EE_5G.width-800.jpg",
            "EE announces plans to achieve nationwide 5 G Standalone coverage by 2030 as part of BT Group’s network upgrade strategy.",
            "datacenterdynamics.com",
            3.520
        ),
    ]

# ------------- MAIN --------------------------------------------------------
def main():
    DATA_DIR.mkdir(exist_ok=True)
    items = sample_items()

    news = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "items": items
    }

    JSON_PATH.write_text(json.dumps(news, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"✅ Wrote {len(items)} stories to {JSON_PATH}")
    print(f"✅ Created {len(list(SHORTLINK_DIR.glob('*.html')))} shortlink pages in {SHORTLINK_DIR}/")

if __name__ == "__main__":
    main()