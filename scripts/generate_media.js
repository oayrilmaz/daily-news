// scripts/generate_media.js
// PTD Today — Media Builder (RELAXED FILTERS + NO POLITICS)
//
// Output:
//   - data/media.json
//   - media/<videoId>.html
//
// Env (workflow):
//   OPENAI_API_KEY (required)
//   SITE_ORIGIN (optional; default https://ptdtoday.com)
//   GA_ID (optional)
//
//   MEDIA_CHANNELS (required): comma-separated YouTube handles/URLs/UC IDs
//   MEDIA_MAX_VIDEOS (default 18)
//   MEDIA_MAX_PER_CHANNEL (default 2)
//
//   MEDIA_LOOKBACK_HOURS (default 168 = 7D)
//   MEDIA_MIN_ITEMS (default 10)
//   MEDIA_EXPAND_HOURS_IF_LOW (default 720 = 30D)
//
//   MEDIA_FILTER_MODE: off | keywords | ai | hybrid (default hybrid)
//   MEDIA_MIN_MATCH_SCORE (default 1)   <-- relaxed default
//   MEDIA_MAX_FILTER_AI (default 40)    <-- cap AI gating
//   MEDIA_CAPTIONS_LANG (default en)

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
const GA_ID = optEnv("GA_ID", "");

const MAX_VIDEOS = Number(optEnv("MEDIA_MAX_VIDEOS", "18"));
const MAX_PER_CH = Number(optEnv("MEDIA_MAX_PER_CHANNEL", "2"));

const LOOKBACK_HOURS = Number(optEnv("MEDIA_LOOKBACK_HOURS", "168"));
const MIN_ITEMS = Number(optEnv("MEDIA_MIN_ITEMS", "10"));
const EXPAND_HOURS_IF_LOW = Number(optEnv("MEDIA_EXPAND_HOURS_IF_LOW", "720"));

const FILTER_MODE = optEnv("MEDIA_FILTER_MODE", "hybrid").toLowerCase(); // off | keywords | ai | hybrid
const MIN_MATCH_SCORE = Number(optEnv("MEDIA_MIN_MATCH_SCORE", "1"));   // relaxed default
const MAX_FILTER_AI = Number(optEnv("MEDIA_MAX_FILTER_AI", "40"));
const CAPTIONS_LANG = optEnv("MEDIA_CAPTIONS_LANG", "en");

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
  // Public captions endpoint (often empty); fallback to description
  const url = `https://www.youtube.com/api/timedtext?lang=${encodeURIComponent(CAPTIONS_LANG)}&v=${encodeURIComponent(videoId)}`;
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
    :root{--bg:#fff;--ink:#111;--muted:#5c5c5c;--rule:rgba(0,0,0,.15);--pill:rgba(0,0,0,.04);--btn:#111;--btnInk:#fff;}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);font-family:Georgia,"Times New Roman",Times,serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
    a{color:inherit}
    .wrap{max-width:900px;margin:0 auto;padding:26px 16px 64px}
    .mast{text-align:center;padding:16px 0 10px}
    .brand{margin:0;font-size:52px;letter-spacing:.2px;font-weight:700}
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
      <h1 class="brand">PTD Today hookup</h1>
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

        ${tags.length ? `
          <div class="chips">${tags.slice(0,12).map(t=>`<span class="chip">${escapeHtml(t)}</span>`).join("")}</div>
        ` : ""}
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
          try { await navigator.share({ title: title, text: text, url: url }); return; }
          catch(e){ return; }
        }
        try{ await navigator.clipboard.writeText(url); alert("Link copied."); }
        catch(e){ prompt("Copy this link:", url); }
      });
    })();
  </script>
</body>
</html>`;
}

/* ---------------------------
   Filtering (RELAXED)
---------------------------- */

function normalize(s){ return (s||"").toString().toLowerCase(); }

const PTD_POSITIVE = [
  // Power grid + transmission
  "grid","power grid","transmission","distribution","substation","switchgear","gis","ais",
  "transformer","reactor","capacitor","facts","statcom","svc","hvdc","converter","inverter",
  "protection","relay","scada","ems","dms","pmu","phasor","synchrophasor",
  "tso","iso","rto","utility","interconnection","load","demand","peak","reliability","outage",
  "line","overhead","underground","cable","intertie",

  // Data centers + AI infra power
  "data center","datacenter","ai data center","gpu","compute","power supply","ups","pdu",
  "cooling","liquid cooling","chip","semiconductor","grid connection","interconnect",

  // Energy transition
  "renewable","wind","solar","storage","battery","bess","microgrid","hydrogen","nuclear",
  "carbon","emissions","efficiency",

  // Materials & supply chain
  "copper","aluminum","rare earth","critical mineral","lithium","nickel","graphite",
  "supply chain","manufacturing","factory","capacity","lead time","procurement",

  // Markets / economics (non-political)
  "power market","electricity market","energy market","capacity market","ppa","tariff",
  "price","pricing","forecast","capex","oem","epc","project","commissioning"
];

const PTD_NEGATIVE = [
  // politics / elections / war / ideology
  "election","vote","campaign","candidate","parliament","congress","senate","president",
  "democrat","republican","labour","conservative","minister","prime minister",
  "ukraine","russia","israel","gaza","hamas","iran","china taiwan","war","invasion",
  "border","immigration","abortion","gun","shooting","protest","riot","sanction",
  "supreme court","scotus",

  // general celebrity/sports gossip etc
  "celebrity","oscars","grammys","nfl","nba","nhl","mlb","soccer","football highlights"
];

function keywordScore(v){
  const text = normalize(`${v.title} ${v.channel} ${v.description || ""}`);
  let score = 0;
  for (const k of PTD_POSITIVE){
    if (text.includes(k)) score += 1;
  }
  for (const n of PTD_NEGATIVE){
    if (text.includes(n)) score -= 4; // strong penalty
  }
  return score;
}

function quickBlockPolitics(v){
  const text = normalize(`${v.title} ${v.description || ""}`);
  return PTD_NEGATIVE.some(n => text.includes(n));
}

/* ---------------------------
   AI gate (borderline only)
---------------------------- */

async function aiGate(openai, v){
  const system = `
You are a strict content gate for PTD Today.

ALLOW only if the video is materially about:
- Power transmission / distribution / substations / HV equipment
- Grid operations / reliability / utilities / market operations
- Data centers power / AI infrastructure power/cooling/supply chain
- Renewables integration, storage, interconnection
- Critical minerals / copper / manufacturing capacity related to the above

DISALLOW if it is primarily politics, elections, geopolitics, war, ideology, or general news unrelated to the above.

Return JSON only:
{"allow": true/false, "reason": "short", "topic": "short label"}
`.trim();

  const user = `
Title: ${v.title}
Channel: ${v.channel}
Published: ${v.published_at}

Description:
${v.description || "[none]"}

Transcript (may be empty):
${v.transcript || "[none]"}
`.trim();

  const resp = await openai.responses.create({
    model: optEnv("OPENAI_MODEL", "gpt-5-mini"),
    input: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    text: { format: { type: "json_object" } }
  });

  let obj = {};
  try { obj = JSON.parse(resp.output_text || "{}"); } catch { obj = {}; }
  return {
    allow: !!obj.allow,
    reason: (obj.reason || "").toString().slice(0, 140),
    topic: (obj.topic || "").toString().slice(0, 80)
  };
}

async function summarizeVideo(openai, v) {
  const transcript = v.transcript || "";
  const desc = v.description || "";

  const system = `
You are PTD Today’s Media summarizer.

Rules:
- Summarize ONLY what is present in transcript/description.
- If transcript is missing, say: "Based on the available description…"
- No speculation, no political commentary.
Return VALID JSON only.
`.trim();

  const user = `
VIDEO:
Title: ${v.title}
Channel: ${v.channel}
Published: ${v.published_at}

CONTENT:
Transcript:
${transcript ? transcript : "[No transcript available]"}

Description:
${desc ? desc : "[No description available]"}

Return JSON with EXACT keys:
{
  "summary": "2–3 sentences, human tone",
  "bullets": ["5 concise bullets max"],
  "takeaways": ["3–5 'so what' bullets for grid/data center decision-makers"],
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

  let obj = {};
  try { obj = JSON.parse(resp.output_text || "{}"); } catch { obj = {}; }

  return {
    summary: (obj.summary || "").toString().slice(0, 600),
    bullets: Array.isArray(obj.bullets) ? obj.bullets.map(String).slice(0, 5) : [],
    takeaways: Array.isArray(obj.takeaways) ? obj.takeaways.map(String).slice(0, 6) : [],
    tags: Array.isArray(obj.tags) ? obj.tags.map(String).slice(0, 12) : []
  };
}

/* ---------------------------
   Channels: MEDIA_CHANNELS
---------------------------- */

function parseMediaChannelsEnv(){
  const raw = optEnv("MEDIA_CHANNELS", "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map(s=>s.trim())
    .filter(Boolean);
}

// NOTE:
// We DON'T need UC resolution here because we use handle/feed scraping.
// We will support:
// - https://www.youtube.com/@Handle
// - @Handle
// - UCxxxxxxxxxxxxxx
//
// Implementation:
// - If UC: use feeds/videos.xml?channel_id=...
// - Else if handle: use feeds/videos.xml?user=... doesn't work reliably
//   So we fetch the channel page and extract channel_id.

async function resolveToChannelId(input){
  const s = input.trim();

  // Already UC id
  if (/^UC[a-zA-Z0-9_-]{10,}$/.test(s)) return s;

  // Extract @handle
  let handle = "";
  if (s.includes("/@")) handle = s.split("/@")[1].split(/[/?#]/)[0];
  else if (s.startsWith("@")) handle = s.slice(1);
  else handle = "";

  if (!handle) return "";

  // Fetch channel page and regex channelId
  const url = `https://www.youtube.com/@${encodeURIComponent(handle)}`;
  try{
    const html = await fetchText(url, { "accept-language": "en-US,en;q=0.8" }, 2);
    const m = html.match(/"channelId":"(UC[a-zA-Z0-9_-]+)"/);
    return m ? m[1] : "";
  }catch{
    return "";
  }
}

async function collectFromChannels(channelInputs, lookbackHours){
  const cutoffMs = Date.now() - lookbackHours * 3600 * 1000;
  const all = [];

  for (const inp of channelInputs) {
    const chId = await resolveToChannelId(inp);
    if (!chId) {
      console.warn("Could not resolve channel:", inp);
      continue;
    }
    const feed = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(chId)}`;
    try{
      const xml = await fetchText(feed, { "accept-language": "en-US,en;q=0.8" }, 3);
      const vids = parseYouTubeRSS(xml)
        .filter(v => new Date(v.published_at).getTime() >= cutoffMs)
        .slice(0, MAX_PER_CH);

      all.push(...vids);
      await sleep(120);
    }catch(e){
      console.warn("YT feed failed:", chId, e.message);
    }
  }

  // dedupe + newest first
  const seen = new Set();
  let videos = all.filter(v => (v.id && !seen.has(v.id) && seen.add(v.id)));
  videos.sort((a,b)=> new Date(b.published_at) - new Date(a.published_at));
  return videos;
}

/* ---------------------------
   Main
---------------------------- */

async function main() {
  const apiKey = mustEnv("OPENAI_API_KEY");
  const openai = new OpenAI({ apiKey });

  const channelInputs = parseMediaChannelsEnv();
  if (!channelInputs.length) {
    throw new Error("MEDIA_CHANNELS is empty. Provide comma-separated YouTube URLs/handles/UC IDs.");
  }

  // Pass 1: 7D
  let videos = await collectFromChannels(channelInputs, LOOKBACK_HOURS);

  // Pass 2: expand to 30D if too few
  if (videos.length < MIN_ITEMS && EXPAND_HOURS_IF_LOW > LOOKBACK_HOURS) {
    console.log(`Only ${videos.length} items in ${LOOKBACK_HOURS}h. Expanding to ${EXPAND_HOURS_IF_LOW}h...`);
    videos = await collectFromChannels(channelInputs, EXPAND_HOURS_IF_LOW);
  }

  // Hard cap candidates before filtering (keep newest)
  videos = videos.slice(0, Math.max(MAX_VIDEOS * 5, 120));

  // Filtering
  const kept = [];
  const borderline = [];

  for (const v of videos) {
    if (FILTER_MODE === "off") { kept.push(v); continue; }

    // quick hard block politics keywords
    if (quickBlockPolitics(v)) continue;

    if (FILTER_MODE === "ai") {
      borderline.push(v);
      continue;
    }

    const score = keywordScore(v);
    v._score = score;

    if (score >= MIN_MATCH_SCORE) kept.push(v);
    else borderline.push(v);
  }

  // AI gate for borderline (hybrid or ai)
  const gated = [];
  if ((FILTER_MODE === "hybrid" || FILTER_MODE === "ai") && borderline.length) {
    const slice = borderline
      .sort((a,b)=> new Date(b.published_at)-new Date(a.published_at))
      .slice(0, MAX_FILTER_AI);

    for (const v of slice) {
      v.transcript = await fetchCaptions(v.id);
      const gate = await aiGate(openai, v);
      if (gate.allow) {
        v._gate = gate;
        gated.push(v);
      }
      await sleep(120);
    }
  }

  let finalList = [...kept, ...gated];

  // Sort newest, take MAX_VIDEOS
  finalList.sort((a,b)=> new Date(b.published_at)-new Date(a.published_at));
  finalList = finalList.slice(0, MAX_VIDEOS);

  // If still empty, publish a hint item in JSON to avoid "looks broken"
  if (!finalList.length) {
    console.warn("No items passed filter. Consider lowering MEDIA_MIN_MATCH_SCORE or increasing MEDIA_LOOKBACK_HOURS.");
  }

  // Summaries + pages
  const outItems = [];
  for (const v of finalList) {
    v.transcript = v.transcript || await fetchCaptions(v.id);
    v.ai = await summarizeVideo(openai, v);

    outItems.push({
      id: v.id,
      title: v.title,
      channel: v.channel,
      published_at: v.published_at,
      url: v.url,
      thumbnail: v.thumbnail,
      ai: v.ai
    });

    await sleep(140);
  }

  // Write pages
  for (const it of outItems) {
    const html = renderMediaArticleHtml(it);
    writeFile(path.join("media", `${it.id}.html`), html);
  }

  // Write data/media.json
  const payload = {
    title: "PTD Today — Media",
    disclaimer: "Informational only — AI-generated summaries; may contain errors. Verify with the original video.",
    updated_at: new Date().toISOString(),
    channels_tracked: channelInputs, // so you can see what’s being tracked in the UI if you want
    filter: {
      mode: FILTER_MODE,
      min_match_score: MIN_MATCH_SCORE,
      lookback_hours: LOOKBACK_HOURS,
      expand_hours_if_low: EXPAND_HOURS_IF_LOW,
      max_filter_ai: MAX_FILTER_AI
    },
    items: outItems
  };
  writeJson(path.join("data", "media.json"), payload);

  console.log(`Wrote: data/media.json (${outItems.length}) and media/*.html`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});