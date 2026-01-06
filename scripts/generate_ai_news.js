// scripts/generate_ai_news.js
// Generates a DAILY AI INTELLIGENCE BRIEF (not “verified news”) for PTD Today.
// Output:
//   - briefs/daily-ai.json (Home reads this)
//   - articles/<id>.html  (for social share previews + direct reading)

import fs from "fs";
import path from "path";
import OpenAI from "openai";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function isoNow() {
  return new Date().toISOString();
}

function utcDateOnly() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, obj) {
  writeFile(filePath, JSON.stringify(obj, null, 2));
}

function escapeHtml(str) {
  return (str ?? "").toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toTextParagraphs(s) {
  const t = (s || "").toString().trim();
  if (!t) return [];
  return t.split(/\n\s*\n/g).map(x => x.trim()).filter(Boolean);
}

function renderArticleHtml({ siteOrigin, item, payload }) {
  const id = (item.id || "").toString().trim();
  const title = (item.title || "PTD Today").toString().trim();
  const lede = (item.lede || item.summary || "").toString().trim();
  const body = (item.body || "").toString().trim();
  const category = (item.category || "Brief").toString();
  const region = (item.region || "Global").toString();
  const createdAt = (item.created_at || payload.updated_at || "").toString();

  const description =
    (lede || body || "PTD Today — AI-generated intelligence briefing.")
      .replace(/\s+/g, " ")
      .slice(0, 180);

  const url = `${siteOrigin.replace(/\/$/, "")}/articles/${encodeURIComponent(id)}.html`;

  const bodyParas = toTextParagraphs(body).map(p => `<p>${escapeHtml(p)}</p>`).join("\n");
  const watch = Array.isArray(item.watchlist) ? item.watchlist : [];
  const tags = Array.isArray(item.tags) ? item.tags : [];

  // Optional: set a default OG image (create later if you want)
  const ogImage = `${siteOrigin.replace(/\/$/, "")}/assets/og-default.png`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — PTD Today</title>
  <meta name="description" content="${escapeHtml(description)}" />

  <link rel="canonical" href="${escapeHtml(url)}" />

  <!-- Open Graph for LinkedIn/Facebook -->
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="PTD Today" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(url)}" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImage)}" />

  <style>
    :root{
      --bg:#ffffff;
      --ink:#111111;
      --muted:#5c5c5c;
      --rule:rgba(0,0,0,.15);
      --soft:rgba(0,0,0,.06);
      --pill:rgba(0,0,0,.04);
      --btn:#111;
      --btnInk:#fff;
    }
    *{box-sizing:border-box}
    body{
      margin:0;background:var(--bg);color:var(--ink);
      font-family: Georgia,"Times New Roman",Times,serif;
      -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
    }
    a{color:inherit}
    .wrap{max-width:900px;margin:0 auto;padding:26px 16px 64px}
    .mast{text-align:center;padding:16px 0 10px}
    .brand{margin:0;font-size:52px;letter-spacing:.2px;font-weight:700}
    .tagline{margin:6px 0 10px;color:var(--muted);font-style:italic;font-size:16px}
    .nav{display:flex;justify-content:center;gap:14px;flex-wrap:wrap;margin:10px 0 10px}
    .nav a{
      text-decoration:none;padding:7px 12px;border-radius:999px;border:1px solid transparent;
      color:rgba(0,0,0,.75);font-size:15px
    }
    .nav a:hover{border-color:var(--rule);background:rgba(0,0,0,.02)}
    .nav a.active{border-color:var(--rule);background:rgba(0,0,0,.03);font-weight:700;color:rgba(0,0,0,.92)}
    .rule{height:1px;background:var(--rule);margin:14px 0 0}

    .meta{color:var(--muted);font-size:12px;letter-spacing:.14px;text-transform:uppercase;margin:16px 0 8px}
    h1{margin:0 0 10px;font-size:44px;line-height:1.03;font-weight:900}
    .lede{font-size:18px;line-height:1.6;color:rgba(0,0,0,.86);margin:0 0 14px}
    .content{border-top:1px solid var(--soft);padding-top:14px;font-size:17px;line-height:1.75;color:rgba(0,0,0,.86)}
    .content p{margin:0 0 14px}

    .subhead{margin:18px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.12px;color:var(--muted)}
    ul{margin:0 0 12px;padding-left:18px}
    li{margin:6px 0}

    .chips{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0}
    .chip{
      display:inline-flex;align-items:center;padding:7px 10px;border-radius:999px;
      border:1px solid var(--rule);background:var(--pill);font-size:13px;color:rgba(0,0,0,.76)
    }

    .btnRow{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 0}
    .btn{
      appearance:none;border:1px solid var(--rule);background:var(--btn);color:var(--btnInk);
      padding:9px 14px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:14px
    }
    .btn.secondary{background:#fff;color:#111}
    .footer{text-align:center;margin-top:24px;color:var(--muted);font-size:13px}

    @media (max-width:760px){
      .brand{font-size:44px}
      h1{font-size:38px}
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="mast">
      <h1 class="brand">PTD Today</h1>
      <div class="tagline">First to Know. First to Lead.</div>
      <nav class="nav" aria-label="Primary navigation">
        <a class="" href="/index.html">Home</a>
        <a class="" href="/room.html">Room</a>
      </nav>
      <div class="rule"></div>
    </header>

    <div class="meta">${escapeHtml(category)} • ${escapeHtml(region)} • ${escapeHtml(createdAt)}</div>
    <h1>${escapeHtml(title)}</h1>
    ${lede ? `<p class="lede">${escapeHtml(lede)}</p>` : ""}

    <div class="content">
      ${bodyParas || `<p>${escapeHtml(item.summary || "")}</p>`}

      ${watch.length ? `
        <div class="subhead">What to watch</div>
        <ul>${watch.slice(0,10).map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
      ` : ""}

      ${item.action_for_readers ? `
        <div class="subhead">Action</div>
        <p>${escapeHtml(item.action_for_readers)}</p>
      ` : ""}
    </div>

    <div class="chips">
      <span class="chip">${escapeHtml(category)}</span>
      <span class="chip">${escapeHtml(region)}</span>
      ${(tags || []).slice(0, 10).map(t => `<span class="chip">${escapeHtml(t)}</span>`).join("")}
    </div>

    <div class="btnRow">
      <a class="btn secondary" href="/index.html#${encodeURIComponent(id)}">Back to Home</a>
      <button class="btn" type="button" id="shareBtn">Share</button>
    </div>

    <div class="footer">© ${new Date().getFullYear()} PTD Today</div>
  </div>

  <script>
    (function(){
      var url = ${JSON.stringify(url)};
      var title = ${JSON.stringify(title)};
      var text = ${JSON.stringify(description)};
      var btn = document.getElementById("shareBtn");
      if(!btn) return;
      btn.addEventListener("click", async function(){
        if (navigator.share) {
          try { await navigator.share({ title: title, text: text, url: url }); return; }
          catch(e){ return; }
        }
        try{
          await navigator.clipboard.writeText(url);
          alert("Article link copied.");
        }catch(e){
          prompt("Copy this article link:", url);
        }
      });
    })();
  </script>
</body>
</html>`;
}

async function main() {
  const apiKey = mustEnv("OPENAI_API_KEY");
  const siteOrigin = optEnv("SITE_ORIGIN", "https://ptdtoday.com").replace(/\/$/, "");
  const client = new OpenAI({ apiKey });

  const today = utcDateOnly();
  const now = isoNow();

  const system = `
You are PTD Today’s Daily AI Intelligence Brief generator.

CRITICAL RULES:
- Do NOT present unverified real-world events as facts.
- If you are not given sources, write as: "signals", "expectations", "scenario watch", "what to monitor".
- Avoid naming/quoting specific articles, magazines, or publishers.
- Keep it useful for: power grid, transmission, substations, HV equipment, EPC/OEM, data centers power, renewables, critical minerals, AI-in-energy.
- Output MUST be valid JSON that matches the schema exactly.
- No markdown, no extra text.

STYLE:
- WSJ-like editorial tone (clean, confident, human).
- Each item must have:
  - lede: 1 strong paragraph (engaging)
  - body: 6–12 short paragraphs (professional, keeps reader engaged)
  - watchlist + action
- Still framed as "intelligence/scenario", not claimed facts.
`.trim();

  const user = `
Generate today's brief for date_utc = "${today}".
Return JSON with this exact structure:

{
  "title": "PTD Today — Daily AI Intelligence Brief",
  "disclaimer": "Informational only — AI-generated; may contain errors. Not investment or engineering advice.",
  "updated_at": "${now}",
  "date_utc": "${today}",
  "sections": [
    { "heading": "Top Themes", "bullets": ["...","..."] },
    { "heading": "What to Watch (24–72h)", "bullets": ["...","..."] }
  ],
  "items": [
    {
      "id": "ai-YYYYMMDD-001",
      "created_at": "${now}",
      "category": "Power Grid" | "Substations" | "Data Centers" | "Renewables" | "Markets" | "Critical Minerals" | "Policy" | "OEM/EPC",
      "region": "Global" | "North America" | "Europe" | "Middle East" | "Asia" | "LATAM" | "Africa",
      "title": "Short headline",
      "lede": "One paragraph lede (human, engaging, intelligence framing).",
      "body": "6–12 short paragraphs. No lists unless necessary. Intelligence/scenario framing only.",
      "summary": "2–3 sentences (short card summary).",
      "confidence_label": "Low" | "Medium" | "High",
      "confidence_score": 0.0,
      "tags": ["tag1","tag2"],
      "watchlist": ["bullet", "bullet"],
      "action_for_readers": "1 sentence action"
    }
  ]
}

REQUIREMENTS:
- Exactly 10 items.
- confidence_score between 0.55 and 0.90 (float).
- ids must be unique.
- No publisher names, no 'Source:' lines, no links.
`.trim();

  const resp = await client.responses.create({
    model: "gpt-5-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    text: { format: { type: "json_object" } }
  });

  const text = resp.output_text;
  if (!text) throw new Error("No output_text returned from OpenAI");

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (e) {
    throw new Error(`Model returned non-JSON. First 200 chars: ${text.slice(0, 200)}`);
  }

  // Write JSON used by Home
  writeJson(path.join("briefs", "daily-ai.json"), payload);

  // Build per-article HTML pages for social preview
  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const item of items) {
    const id = (item.id || "").toString().trim();
    if (!id) continue;
    const html = renderArticleHtml({ siteOrigin, item, payload });
    writeFile(path.join("articles", `${id}.html`), html);
  }

  console.log("Wrote: briefs/daily-ai.json and articles/*.html");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});