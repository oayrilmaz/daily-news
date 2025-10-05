#!/usr/bin/env python3
import json, hashlib, os, datetime

# -------------------------
# CONFIGURATION
# -------------------------
OUTPUT_DATA = "data/news.json"
OUTPUT_SHORTLINKS = "data/shortlinks.json"
SHORTLINK_DIR = "s"
SITE_BASE = "https://ptdtoday.com"

# -------------------------
# SAMPLE ITEMS (replace later with real Bing/Google scraping)
# -------------------------
def sample_items():
    now = datetime.datetime.utcnow().isoformat() + "Z"
    return [
        {
            "title": "Photonics startup PINC Technologies secures $6.8m from Seed funding round",
            "category": "Grid",
            "source": "datacenterdynamics.com",
            "original": "https://www.datacenterdynamics.com/en/news/photonics-startup-pinc-technologies-secures-68m-from-seed-funding-round/",
            "image": "https://www.datacenterdynamics.com/media/images/PINC.width-1200.jpg",
            "published": now,
            "score": 3.642,
        },
        {
            "title": "EE targets 99% 5G Standalone coverage across UK by FY2030",
            "category": "Renewables",
            "source": "datacenterdynamics.com",
            "original": "https://www.datacenterdynamics.com/en/news/ee-targets-99-5g-standalone-coverage-across-uk-by-fy2030/",
            "image": "https://www.datacenterdynamics.com/media/images/EE-5G.width-1200.jpg",
            "published": now,
            "score": 3.520,
        },
    ]

# -------------------------
# SHORTLINK TEMPLATE
# -------------------------
TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>%%TITLE%% — PTD Today</title>
<meta name="description" content="%%TITLE%%">
<meta property="og:title" content="%%TITLE%% — PTD Today">
<meta property="og:description" content="%%SOURCE%%">
<meta property="og:image" content="%%IMAGE%%">
<meta property="og:url" content="%%ORIGINAL%%">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="%%TITLE%% — PTD Today">
<meta name="twitter:description" content="%%SOURCE%%">
<meta name="twitter:image" content="%%IMAGE%%">
<style>
body {
  font-family: Georgia, serif;
  background-color: #f8f4ef;
  color: #111;
  margin: 2em auto;
  max-width: 650px;
  line-height: 1.6;
}
a { color: #1a0dab; text-decoration: none; }
a:hover { text-decoration: underline; }
h1 {
  font-size: 1.4em;
  border-bottom: 1px solid #ccc;
  padding-bottom: 0.4em;
}
footer {
  margin-top: 2em;
  font-size: 0.9em;
  color: #555;
}
</style>
</head>
<body>
  <h1>%%TITLE%%</h1>
  <p>Originally published on <a href="%%ORIGINAL%%" target="_blank">%%SOURCE%%</a>.</p>
  <p><img src="%%IMAGE%%" alt="" style="max-width:100%%; border:1px solid #ccc;"></p>
  <footer>© PTD Today — <a href="%s">Back to homepage</a></footer>
</body>
</html>
""" % SITE_BASE

# -------------------------
# MAIN PROCESS
# -------------------------
def make_short(item):
    """Create a short HTML redirect page for the article."""
    h = hashlib.sha1(item["original"].encode()).hexdigest()[:6]
    path = os.path.join(SHORTLINK_DIR, f"{h}.html")

    html = TEMPLATE
    for k, v in item.items():
        html = html.replace(f"%%{k.upper()}%%", str(v))
    os.makedirs(SHORTLINK_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return h

def main():
    print("Fetching feeds...")
    items = sample_items()  # later replace this with your real scraper

    os.makedirs("data", exist_ok=True)
    news = {
        "updated": datetime.datetime.utcnow().isoformat() + "Z",
        "items": items
    }

    # Save the main JSON
    with open(OUTPUT_DATA, "w", encoding="utf-8") as f:
        json.dump(news, f, indent=2)

    # Create shortlinks
    shortmap = {}
    for it in items:
        hid = make_short(it)
        shortmap[hid] = it["original"]

    with open(OUTPUT_SHORTLINKS, "w", encoding="utf-8") as f:
        json.dump(shortmap, f, indent=2)

    print(f"Generated {len(items)} items.")
    print("Done.")

if __name__ == "__main__":
    main()