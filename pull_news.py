#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime, timezone, timedelta
import json, re, hashlib, html

DATA_DIR = Path("data")
SHORTLINK_DIR = Path("s")
TEMPLATE_PATH = Path("article.html")
JSON_PATH = DATA_DIR / "news.json"

DEFAULT_IMAGE = "https://ptdtoday.com/assets/og-default.png"
DEFAULT_DESC  = "Energy & Power Transmission Daily News — PTD Today"

RETENTION_DAYS = 14  # keep last N days of items

SHORTLINK_TEMPLATE = TEMPLATE_PATH.read_text(encoding="utf-8")

def sanitize(txt: str) -> str:
    return html.escape(txt or "").replace("\n", " ").strip()

def make_id(url: str) -> str:
    return hashlib.md5(url.encode("utf-8")).hexdigest()[:8]

def write_shortlink_page(sid: str, title: str, desc: str, image: str, source: str):
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

def derive_source(url: str) -> str:
    return re.sub(r"^https?://(www\.)?", "", url).split("/")[0]

def build_item(title, url, category, image=None, description=None, source=None, score=None, published=None):
    sid = make_id(url)
    write_shortlink_page(
        sid=sid,
        title=title,
        desc=description or DEFAULT_DESC,
        image=image or DEFAULT_IMAGE,
        source=url
    )
    if published is None:
        published = datetime.now(timezone.utc).isoformat()
    return {
        "id": sid,
        "title": title,
        "url": url,
        "category": (category or "").lower(),
        "image": image or DEFAULT_IMAGE,
        "description": description or DEFAULT_DESC,
        "source": source or derive_source(url),
        "published": published,
        "score": float(score or 0.0),
    }

def sample_items():
    """Temporary stand-in until you connect to Bing/Google/DCD etc."""
    return [
        build_item(
            "Photonics startup PINC Technologies secures $6.8m from Seed funding round",
            "https://www.datacenterdynamics.com/en/news/photonics-startup-pinc-technologies-secures-68m-from-seed-funding-round/",
            "grid",
            "https://media.datacenterdynamics.com/media/images/pinc-logo.width-800.jpg",
            "PINC Technologies has raised $6.8 million to expand photonics-based interconnect solutions for data centers.",
            "datacenterdynamics.com",
            3.642
        ),
        build_item(
            "EE targets 99% 5G Standalone coverage across UK by FY2030",
            "https://www.datacenterdynamics.com/en/news/ee-targets-99-5g-standalone-coverage-across-uk-by-end-of-fy2030/",
            "renewables",
            "https://media.datacenterdynamics.com/media/images/EE_5G.width-800.jpg",
            "EE announces plans to achieve nationwide 5G Standalone coverage by 2030 as part of BT Group’s network upgrade strategy.",
            "datacenterdynamics.com",
            3.520
        ),
    ]

def load_existing():
    if not JSON_PATH.exists():
        return {"updated":"", "items":[]}
    try:
        return json.loads(JSON_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"updated":"", "items":[]}

def merge_items(existing, new):
    by_url = {}
    # keep existing first
    for it in existing:
        by_url[it.get("url")] = it
    # then overwrite / add new
    for it in new:
        by_url[it.get("url")] = it
    items = list(by_url.values())
    # retention window
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    def ok(it):
        try:
            t = datetime.fromisoformat(it.get("published",""))
        except Exception:
            return True
        return t >= cutoff
    items = [i for i in items if ok(i)]
    # sort newest first
    items.sort(key=lambda i: i.get("published",""), reverse=True)
    return items

def main():
    DATA_DIR.mkdir(exist_ok=True)
    existing = load_existing().get("items", [])
    new = sample_items()
    merged = merge_items(existing, new)
    news = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "items": merged
    }
    JSON_PATH.write_text(json.dumps(news, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"✅ Wrote {len(merged)} stories to {JSON_PATH}")
    print(f"✅ Shortlinks in /s/: {len(list(SHORTLINK_DIR.glob('*.html')))}")

if __name__ == "__main__":
    main()