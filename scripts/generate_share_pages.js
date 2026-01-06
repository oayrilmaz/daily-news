// scripts/generate_share_pages.js
// Creates per-article share pages with Open Graph tags so LinkedIn shows the article preview.
// Input: briefs/daily-ai.json
// Output: p/<article-id>.html (each redirects to /index.html#<article-id>)

import fs from "fs";
import path from "path";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function escapeHtml(s) {
  return (s ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function truncate(s, n) {
  const t = (s ?? "").toString().trim().replace(/\s+/g, " ");
  if (t.length <= n) return t;
  return t.slice(0, n - 1).trim() + "…";
}

function main() {
  const inputPath = path.join("briefs", "daily-ai.json");
  if (!fs.existsSync(inputPath)) {
    console.error(`Missing input: ${inputPath}`);
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const items = Array.isArray(payload.items) ? payload.items : [];

  const outDir = path.join("p");
  ensureDir(outDir);

  // Set this to a real image URL you host for consistent LinkedIn cards.
  // If you don't have one yet, leave empty string and LinkedIn will use site fallback.
  const DEFAULT_OG_IMAGE = "https://ptdtoday.com/assets/ptd-og.png";

  // GitHub Pages base (no trailing slash)
  const SITE = "https://ptdtoday.com";

  let written = 0;

  for (const it of items) {
    const id = (it.id || "").toString().trim();
    if (!id) continue;

    const title = truncate(it.title || "PTD Today — Briefing", 90);
    const descSrc = it.lede || it.summary || it.body || "PTD Today — Daily intelligence briefing.";
    const description = truncate(descSrc, 200);

    const shareUrl = `${SITE}/p/${encodeURIComponent(id)}.html`;
    const targetUrl = `${SITE}/index.html#${encodeURIComponent(id)}`;

    const ogImage = DEFAULT_OG_IMAGE || "";

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)} — PTD Today</title>
  <meta name="description" content="${escapeHtml(description)}"/>

  <!-- Open Graph -->
  <meta property="og:site_name" content="PTD Today"/>
  <meta property="og:type" content="article"/>
  <meta property="og:title" content="${escapeHtml(title)}"/>
  <meta property="og:description" content="${escapeHtml(description)}"/>
  <meta property="og:url" content="${escapeHtml(shareUrl)}"/>
  ${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}"/>` : ""}

  <!-- Twitter -->
  <meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}"/>
  <meta name="twitter:title" content="${escapeHtml(title)}"/>
  <meta name="twitter:description" content="${escapeHtml(description)}"/>
  ${ogImage ? `<meta name="twitter:image" content="${escapeHtml(ogImage)}"/>` : ""}

  <!-- Redirect humans to the real reading URL (hash-based) -->
  <meta http-equiv="refresh" content="0;url=${escapeHtml(targetUrl)}"/>
  <link rel="canonical" href="${escapeHtml(shareUrl)}"/>
</head>
<body>
  <p>Redirecting to article… <a href="${escapeHtml(targetUrl)}">Open</a></p>
  <script>location.replace(${JSON.stringify(targetUrl)});</script>
</body>
</html>
`;

    fs.writeFileSync(path.join(outDir, `${id}.html`), html, "utf8");
    written++;
  }

  console.log(`Wrote ${written} share pages into /p`);
}

main();