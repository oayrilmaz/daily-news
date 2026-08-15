#!/usr/bin/env python3
"""
PTD Today - static country share-page generator.

Usage:
  python generate_map_share_pages.py briefs/map-signals.json .

Creates:
  ./map-share/united-states.html
  ./map-share/germany.html
  ...

Run this AFTER map-signals.json is generated and BEFORE deployment.
"""
from pathlib import Path
from urllib.parse import quote
import json, re, html, sys

BASE_URL = "https://ptdtoday.com"

COUNTRY_REGION = {
    "Algeria":"Africa","Argentina":"LATAM","Australia":"Asia","Belgium":"Europe",
    "Brazil":"LATAM","Canada":"North America","Chile":"LATAM","China":"Asia",
    "Colombia":"LATAM","Denmark":"Europe","Egypt":"Middle East","Finland":"Europe",
    "France":"Europe","Germany":"Europe","Greece":"Europe","India":"Asia",
    "Indonesia":"Asia","Israel":"Middle East","Italy":"Europe","Japan":"Asia",
    "Kenya":"Africa","Malaysia":"Asia","Mexico":"North America","Morocco":"Africa",
    "Netherlands":"Europe","New Zealand":"Asia","Nigeria":"Africa","Norway":"Europe",
    "Oman":"Middle East","Peru":"LATAM","Philippines":"Asia","Poland":"Europe",
    "Portugal":"Europe","Qatar":"Middle East","Saudi Arabia":"Middle East",
    "Singapore":"Asia","South Africa":"Africa","South Korea":"Asia","Spain":"Europe",
    "Sweden":"Europe","Thailand":"Asia","Turkey":"Middle East","Türkiye":"Middle East",
    "United Arab Emirates":"Middle East","United Kingdom":"Europe","United States":"North America",
    "Vietnam":"Asia","Democratic Republic of the Congo":"Africa"
}
VALID_COUNTRIES = set(COUNTRY_REGION)

def slugify(s):
    s = s.replace("Türkiye", "Turkey").lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")

def esc(s):
    return html.escape(str(s or ""), quote=True)

def trunc(s, n=290):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[:n-1].rstrip() + "…"

def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "briefs/map-signals.json")
    site_root = Path(sys.argv[2] if len(sys.argv) > 2 else ".")
    out = site_root / "map-share"
    out.mkdir(parents=True, exist_ok=True)

    payload = json.loads(src.read_text(encoding="utf-8"))
    signals = payload.get("signals", [])

    grouped = {}
    for sig in signals:
        raw = sig.get("countries") if isinstance(sig.get("countries"), list) else []
        # Protect against current transitional data where tags may leak into countries[].
        countries = [c for c in raw if c in VALID_COUNTRIES]
        for country in countries:
            grouped.setdefault(country, []).append(sig)

    for country, items in sorted(grouped.items()):
        seen, uniq = set(), []
        for item in items:
            key = item.get("signal_id") or item.get("dedup_key") or item.get("title")
            if key in seen:
                continue
            seen.add(key)
            uniq.append(item)
        items = uniq

        slug = slugify(country)
        share_url = f"{BASE_URL}/map-share/{slug}.html"
        destination = f"{BASE_URL}/?country={quote(country)}"
        top = [str(x.get("title","")).strip() for x in items if x.get("title")][:3]

        title = f"{country} Power Intelligence | PTD Today"
        description = (
            trunc(f"{len(items)} current intelligence signal{'s' if len(items) != 1 else ''} "
                  f"for {country}: " + " • ".join(top))
            if top else
            trunc(f"Explore today's power-grid, substation, data-center, renewable and "
                  f"infrastructure intelligence associated with {country}.")
        )

        bullets = "\n".join(f"<li>{esc(t)}</li>" for t in top)
        og_image = f"{BASE_URL}/assets/og-default.png"

        page = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(description)}">
  <link rel="canonical" href="{esc(share_url)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="PTD Today">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(description)}">
  <meta property="og:url" content="{esc(share_url)}">
  <meta property="og:image" content="{esc(og_image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{esc(title)}">
  <meta name="twitter:description" content="{esc(description)}">
  <meta name="twitter:image" content="{esc(og_image)}">
  <script>window.location.replace({json.dumps(destination)});</script>
</head>
<body>
  <main>
    <h1>{esc(title)}</h1>
    <p>{esc(description)}</p>
    <ul>{bullets}</ul>
    <p><a href="{esc(destination)}">Open {esc(country)} Power Intelligence on PTD Today</a></p>
  </main>
</body>
</html>"""
        (out / f"{slug}.html").write_text(page, encoding="utf-8")

    print(f"Generated {len(grouped)} country share pages in {out}")

if __name__ == "__main__":
    main()
