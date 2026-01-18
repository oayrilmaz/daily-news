// scripts/generate_media.js
// PTD Today — Media Builder
// - Fetches YouTube RSS from selected channels
// - Tries captions via timedtext (if available), fallback to description
// - Uses OpenAI to summarize and produces PTD-style pages per video
// Output:
//   - data/media.json
//   - media/<videoId>.html

import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
function optEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

const SITE_ORIGIN = optEnv("SITE_ORIGIN", "https://ptdtoday.com").replace(/\/$/, "");
const GA_ID = optEnv("GA_ID", ""); // optional

const MAX_VIDEOS = Number(optEnv("MEDIA_MAX_VIDEOS", "18")); // total to publish
const MAX_PER_CH = Number(optEnv("MEDIA_MAX_PER_CHANNEL", "6"));

// ✅ IMPORTANT: support HOURS (preferred) and keep DAYS as fallback.
const DAYS_FALLBACK = Number(optEnv("MEDIA_DAYS", "7"));
const LOOKBACK_HOURS = Number(optEnv("MEDIA_LOOKBACK_HOURS", String(DAYS_FALLBACK * 24)));

// Optional: if too few items found in lookback window, expand automatically.
const MIN_ITEMS = Number(optEnv("MEDIA_MIN_ITEMS", "8"));
const EXPAND_HOURS_IF_LOW = Number(optEnv("MEDIA_EXPAND_HOURS_IF_LOW", "720")); // 30 days

// Optional scope filter to keep results inside PTD Today portfolio
// (You already asked for this: general channels, but only PTD scope)
const SCOPE_KEYWORDS = (optEnv("MEDIA_SCOPE_KEYWORDS",
  "power,grid,transmission,substation,transformer,HVDC,HV,renewable,wind,solar,energy,data center,datacenter,AI,utility,interconnection,load,dispatch,electricity,critical minerals,copper,rare earth,semiconductor"
).split(",").map(s => s.trim().toLowerCase()).filter(Boolean));

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function writeFile(filePath, content) { ensureDir(path.dirname(filePath)); fs.writeFileSync(filePath, content, "utf8"); }
function writeJson(filePath, obj) { writeFile(filePath, JSON.stringify(obj, null, 2)); }

function escapeHtml(str) {
  return (str ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

const clean = (s="") => s.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

async function fetchText(url, headers = {}, retries = 3) {
  const h = {
    "user-agent": "PTD-Bot/1.0 (+https://ptdtoday.com)",
    "accept": "application/atom+xml, application/rss+xml, application/xml, text/xml, text/plain, */*;q=0.5",
    ...headers
  };
  for (let i=0;i<retries;i++){
    try{
      const r = await fetch(url, { headers: h });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    }catch(e){
      if(i===retries-1) throw e;
      await sleep(400*(i+1));
    }
  }
}

function parseYouTubeRSS(xml) {
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  return entries.map(e => {
    const title = clean((e.match(/<title>([\s\S]*?)<\/title>/i)||[])[1]||"");
    const id    = (e.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/i)||[])[1]||"";
    const pub   = (e.match(/<published>([\s\S]*?)<\/published>/i)||[])[1]||"";
    const ch    = clean((e.match(/<name>([\s\S]*?)<\/name>/i)||[])[1]||"YouTube");
    const desc  = clean(
      (e.match(/<media:description[^>]*>([\s\S]*?)<\/media:description>/i)||[])[1] ||
      (e.match(/<content[^>]*>([\s\S]*?)<\/content>/i)||[])[1] || ""
    );

    return {
      id,
      title,
      channel: ch,
      published_at: pub ? new Date(pub).toISOString() : new Date().toISOString(),
      url: id ? `https://www.youtube.com/watch?v=${id}` : "",
      thumbnail: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "",
      description: desc
    };
  }).filter(x => x.id && x.title);
}

async function fetchCaptions(videoId) {
  const url = `https://www.youtube.com/api/timedtext?lang=en&v=${encodeURIComponent(videoId)}`;
  try{
    const xml = await fetchText(url, { "accept-language": "en-US,en;q=0.8" }, 2);
    if (!xml || !xml.includes("<text")) return "";
    const texts = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1]);
    const decoded = texts.join(" ")
      .replace(/&#39;/g,"'")
      .replace(/&quot;/g,'"')
      .replace(/&amp;/g,"&")
      .replace(/&lt;/g,"<")
      .replace(/&gt;/g,">")
      .replace(/\s+/g," ")
      .trim();
    return decoded.slice(0, 12000);
  }catch{
    return "";
  }
}

function gaHead() {
  if (!GA_ID) return "";
  return `
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');</script>`;
}

function inScope(text) {
  const t = (text || "").toLowerCase();
  return SCOPE_KEYWORDS.some(k => k && t.includes(k));
}

function renderMediaArticleHtml(item) {
  const id = item.id;
  const title = item.title || "PTD Today — Media";
  const channel = item.channel || "YouTube";
  const published = item.published_at || "";
  const youtubeUrl = item.url || "";
  const thumb = item.thumbnail || `${SITE_ORIGIN}/assets/og-default.png`;

  const ai = item.ai || {};
  const summary = ai.summary || "";
  const bullets = Array.isArray(ai.bullets) ? ai.bullets : [];
  const takeaways = Array.isArray(ai.takeaways) ? ai.takeaways : [];
  const tags = Array.isArray(ai.tags) ? ai.tags : [];

  const canonical = `${SITE_ORIGIN}/media/${encodeURIComponent(id)}.html`;
  const description = (summary || `PTD Today AI summary of a video from ${channel}.`).replace(/\s+/g," ").slice(0, 180);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": title,
    "description": description,
    "datePublished": published || new Date().toISOString(),
    "dateModified": new Date().toISOString(),
    "mainEntityOfPage": canonical,
    "publisher": { "@type": "Organization", "name": "PTD Today" }
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — PTD Today</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />

  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="PTD Today" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta property="og:image" content="${escapeHtml(thumb)}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(thumb)}" />

  <script type="application/ld+json">${escapeHtml(JSON.stringify(jsonLd))}</script>
  ${gaHead()}

  <style>
    :root{--bg:#fff;--ink:#111;--muted:#5c5c5c;--rule:rgba(0,0,0,.15);--pill:rgba(0,0,0,.04);--btn:#111;--btnInk:#fff}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);font-family:Georgia,"Times New Roman",Times,serif}
    a{color:inherit}
    .wrap{max-width:900px;margin:0 auto;padding:26px 16px 64px}
    .mast{text-align:center;padding:16px 0 10px}
    .brand{margin:0;font-size:52px;font-weight:700}
    .tagline{margin:6px 0 10px;color:var(--muted);font-style:italic;font-size:16px}
    .nav{display:flex;justify-content:center;gap:14px;flex-wrap:wrap;margin:10px 0 10px}
    .nav a{text-decoration:none;padding:7px 12px;border-radius:999px;border:1px solid transparent;color:rgba(0,0,0,.75);font-size:15px}
    .nav a:hover{border-color:var(--rule);background:rgba(0,0,0,.02)}
    .nav a.active{border-color:var(--rule);background:rgba(0,0,0,.03);font-weight:700;color:rgba(0,0,0,.92)}
    .rule{height:1px;background:var(--rule);margin:14px 0 0}
    .meta{color:var(--muted);font-size:12px;letter-spacing:.14px;text-transform:uppercase;margin:16px 0 8px}
    h1{margin:0 0 10px;font-size:44px;line-height:1.03;font-weight:900}
    .lede{font-size:18px;line-height:1.6;color:rgba(0,0,0,.86);margin:0 0 14px}
    .card{border:1px solid var(--rule);border-radius:14px;overflow:hidden;background:#fff}
    .thumb img{width:100%;display:block}
    .content{padding:14px}
    .subhead{margin:18px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.12px;color:var(--muted)}
    ul{margin:0 0 12px;padding-left:18px}
    li{margin:6px 0}
    .chips{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0}
    .chip{display:inline-flex;align-items:center;padding:7px 10px;border-radius:999px;border:1px solid var(--rule);background:var(--pill);font-size:13px;color:rgba(0,0,0,.76)}
    .btnRow{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 0}
    .btn{appearance:none;border:1px solid var(--rule);background:var(--btn);color:var(--btnInk);padding:9px 14px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
    .btn.secondary{background:#fff;color:#111}
    .footer{text-align:center;margin-top:24px;color:var(--muted);font-size:13px}
    @media (max-width:760px){.brand{font-size:44px}h1{font-size:38px}}
  </style>
</head>
<body>
  <div class="wrap">
    <header class="mast">
      <h1 class="brand">PTD Today</h1>
      <div class="tagline">First to Know. First to Lead.</div>
      <nav class="nav" aria-label="Primary navigation">
        <a href="/index.html">Home</a>
        <a href="/room.html">Room</a>
        <a class="active" href="/media.html">Media</a>
      </nav>
      <div class="rule"></div>
    </header>

    <div class="meta">VIDEO • ${escapeHtml(channel)} • ${escapeHtml(published)}</div>
    <h1>${escapeHtml(title)}</h1>
    ${summary ? `<p class="lede">${escapeHtml(summary)}</p>` : ""}

    <div class="card">
      <div class="thumb"><img src="${escapeHtml(thumb)}" alt=""></div>
      <div class="content">
        <div class="btnRow">
          <a class="btn" href="${escapeHtml(youtubeUrl)}" target="_blank" rel="noopener">Watch on YouTube</a>
          <button class="btn secondary" id="shareBtn" type="button">Share</button>
        </div>

        ${bullets.length ? `
          <div class="subhead">Key points</div>
          <ul>${bullets.slice(0,8).map(b=>`<li>${escapeHtml(b)}</li>`).join("")}</ul>
        ` : ""}

        ${takeaways.length ? `
          <div class="subhead">So what</div>
          <ul>${takeaways.slice(0,6).map(t=>`<li>${escapeHtml(t)}</li>`).join("")}</ul>
        ` : ""}

        ${tags.length ? `<div class="chips">${tags.slice(0,12).map(t=>`<span class="chip">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      </div>
    </div>

    <div class="footer">© ${new Date().getFullYear()} PTD Today</div>
  </div>

  <script>
    (function(){
      var url = ${JSON.stringify(canonical)};
      var title = ${JSON.stringify(title)};
      var text = ${JSON.stringify(description)};
      var btn = document.getElementById("shareBtn");
      if(!btn) return;
      btn.addEventListener("click", async function(){
        if (navigator.share) {
          try { await navigator.share({ title: title, text: text, url: url }); return; } catch(e){ return; }
        }
        try{ await navigator.clipboard.writeText(url); alert("Link copied."); }
        catch(e){ prompt("Copy this link:", url); }
      });
    })();
  </script>
</body>
</html>`;
}

async function summarizeVideo(openai, v) {
  const transcript = v.transcript || "";
  const desc = v.description || "";

  const system = `
You are PTD Today’s Media summarizer.

Rules:
- Summarize ONLY what is present in transcript/description.
- If transcript is missing/thin, say: "Based on the available description..."
- Keep it relevant to: power transmission, substations, utilities, grid ops, data centers power, renewables, critical minerals, and AI infrastructure.
- Avoid politics/elections/geopolitics. If the video is not within the scope, return {"out_of_scope": true}.
Return VALID JSON only.
`.trim();

  const user = `
Title: ${v.title}
Channel: ${v.channel}
Published: ${v.published_at}

Transcript:
${transcript ? transcript : "[No transcript available]"}

Description:
${desc ? desc : "[No description available]"}

Return JSON with EXACT keys:
{
  "out_of_scope": false,
  "summary": "2–3 sentences",
  "bullets": ["up to 5"],
  "takeaways": ["3–5 for decision-makers"],
  "tags": ["6–10 short tags"]
}
`.trim();

  const resp = await openai.responses.create({
    model: optEnv("OPENAI_MODEL", "gpt-5-mini"),
    input: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    text: { format: { type: "json_object" } }
  });

  const text = resp.output_text || "";
  let obj = {};
  try { obj = JSON.parse(text); } catch { obj = {}; }

  const out = {
    out_of_scope: !!obj.out_of_scope,
    summary: (obj.summary || "").toString().slice(0, 600),
    bullets: Array.isArray(obj.bullets) ? obj.bullets.map(String).slice(0, 5) : [],
    takeaways: Array.isArray(obj.takeaways) ? obj.takeaways.map(String).slice(0, 6) : [],
    tags: Array.isArray(obj.tags) ? obj.tags.map(String).slice(0, 12) : []
  };
  return out;
}

async function main() {
  const apiKey = mustEnv("OPENAI_API_KEY");
  const openai = new OpenAI({ apiKey });

  function cutoffFromHours(hours){
    return Date.now() - hours * 3600 * 1000;
  }

  let cutoffMs = cutoffFromHours(LOOKBACK_HOURS);

  const channels = (optEnv("YT_CHANNELS", "").split(",").map(s=>s.trim()).filter(Boolean));
  const DEFAULT_CHANNELS = [
    "UC0jLzOK3mWr4YcUuG3KzZmw", // Siemens (example)
    "UC4l7cLFsPzQYdMwvZRVqNag", // Hitachi Energy (example)
    "UCJ2Kx0pPZzJyaRlwviCJPdA", // ABB (example)
    "UCvB8R7oZJxge5tR3MUpxYfw"  // Schneider (example)
  ];
  const CHANNELS = channels.length ? channels : DEFAULT_CHANNELS;

  async function collect(cutoff){
    const all = [];
    for (const ch of CHANNELS) {
      const feed = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(ch)}`;
      try{
        const xml = await fetchText(feed, { "accept-language": "en-US,en;q=0.8" }, 3);
        const vids = parseYouTubeRSS(xml)
          .filter(v => new Date(v.published_at).getTime() >= cutoff)
          .slice(0, MAX_PER_CH);
        all.push(...vids);
        await sleep(120);
      }catch(e){
        console.warn("YT feed failed:", ch, e.message);
      }
    }
    // dedupe + sort
    const seen = new Set();
    let vids = all.filter(v => (v.id && !seen.has(v.id) && seen.add(v.id)));
    vids.sort((a,b)=> new Date(b.published_at) - new Date(a.published_at));
    return vids;
  }

  // First pass
  let videos = await collect(cutoffMs);

  // ✅ If too few items, auto-expand lookback
  if (videos.length < MIN_ITEMS) {
    const expandedCutoff = cutoffFromHours(EXPAND_HOURS_IF_LOW);
    videos = await collect(expandedCutoff);
    cutoffMs = expandedCutoff;
  }

  videos = videos.slice(0, MAX_VIDEOS);

  // Captions + AI summaries + scope filtering
  const kept = [];
  for (const v of videos) {
    v.transcript = await fetchCaptions(v.id);
    if (!v.transcript) v.transcript = "";

    // quick keyword filter before spending tokens
    const quickText = `${v.title}\n${v.description || ""}\n${v.channel || ""}`;
    const quickInScope = inScope(quickText);

    if (!quickInScope) {
      // skip obvious non-scope items early
      continue;
    }

    v.ai = await summarizeVideo(openai, v);
    if (v.ai?.out_of_scope) continue;

    kept.push(v);
    await sleep(150);
  }

  const outItems = kept.map(v => ({
    id: v.id,
    title: v.title,
    channel: v.channel,
    published_at: v.published_at,
    url: v.url,
    thumbnail: v.thumbnail,
    ai: v.ai
  }));

  for (const it of outItems) {
    const html = renderMediaArticleHtml(it);
    writeFile(path.join("media", `${it.id}.html`), html);
  }

  const payload = {
    title: "PTD Today — Media",
    disclaimer: "Informational only — AI-generated summaries; may contain errors. Verify with the original video.",
    updated_at: new Date().toISOString(),
    lookback_hours_used: Math.round((Date.now() - cutoffMs) / 3600000),
    items: outItems
  };
  writeJson(path.join("data", "media.json"), payload);

  console.log(`Wrote: data/media.json (${outItems.length}) and media/*.html`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});