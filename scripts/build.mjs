// ====================================================================
// PTD Today Builder — Articles (~60h) + YouTube (past 7 days, topic filtered)
// Channel policies + playlist fallback + smart-allow + shorts filter + debug
// Node 20+
// ====================================================================

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

// ---------- Paths ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, "..");
const OUT_DATA   = path.join(ROOT, "data");
const OUT_SHORT  = path.join(ROOT, "s");
const NEWS_PATH  = path.join(OUT_DATA, "news.json");
const WEEK_PATH  = path.join(OUT_DATA, "7d.json");
const SHORT_MAP  = path.join(OUT_DATA, "shortlinks.json");
const YT_DEBUG   = path.join(OUT_DATA, "youtube_raw.json");

// ---------- Site ----------
const SITE_ORIGIN = "https://ptdtoday.com";
const GA_ID = "G-TVKD1RLFE5";

// ====================================================================
// CONFIG
// ====================================================================

// Articles window: today + yesterday (buffered)
const RECENT_HOURS = Number(process.env.RECENT_HOURS || 60);

// YouTube window: past 7 days
const YT_HOURS = Number(process.env.YT_HOURS || 24 * 7);

// Concurrency / caps
const CONCURRENCY        = Number(process.env.CONCURRENCY || 6);
const YT_MAX_PER_CHANNEL = Number(process.env.YT_MAX_PER_CHANNEL || 8);
const ENRICH_MAX         = Number(process.env.MAX_ENRICH || 50);

// Optional proxies (RSS fallback on GH runners)
const PROXIES = (process.env.PROXIES?.split(",").map(s=>s.trim()).filter(Boolean)) || [
  "https://r.jina.ai/http://{URL}",
  "https://r.jina.ai/https://{URL}"
];

// ---------- Publisher RSS feeds ----------
const DEFAULT_FEEDS = [
  "https://www.utilitydive.com/feeds/news/",
  "https://www.datacenterdynamics.com/en/rss/",
  "https://www.pv-magazine.com/feed/",
  "https://www.rechargenews.com/rss/",
  "https://www.offshorewind.biz/feed/",
  "https://www.ferc.gov/rss.xml",
  "https://www.energy.gov/rss"
];
const FEEDS = (process.env.FEEDS?.split(",").map(s=>s.trim()).filter(Boolean)) || DEFAULT_FEEDS;

// ---------- YouTube channels ----------
const YT = {
  // OEMs / Utilities / Vendors (already focused)
  SIEMENS:   "UC0jLzOK3mWr4YcUuG3KzZmw",
  HITACHI:   "UC4l7cLFsPzQYdMwvZRVqNag",
  ABB:       "UCJ2Kx0pPZzJyaRlwviCJPdA",
  SCHNEIDER: "UCvB8R7oZJxge5tR3MUpxYfw",

  // Business / Market desks
  BLOOMBERG: "UCUMZ7gohGI9HcU9VNsr2FJQ",
  CNBC:      "UCvJJ_dzjViJCoLf5uKUTwoA", // CNBC Television (common)
  CNBC_ALT:  "UCrp_UI8XtuYfpiqluWLD7Lw", // CNBC (alt/general)
  WSJ:       "UCW6-BQWFA70DyycZ57JKias",
  REUTERS:   "UChqUTb7kYRX8-EiaN3XFrSQ",
  BBC:       "UC16niRr50-MSBwiO3YDb3RA"
};

const YT_CHANNELS = (process.env.YT_CHANNELS?.split(",").map(s=>s.trim()).filter(Boolean)) ||
  Object.values(YT);

// Channel policies
const CHANNEL_POLICIES = {
  [YT.SIEMENS]:   { soft:false, requireCore:false },
  [YT.HITACHI]:   { soft:false, requireCore:false },
  [YT.ABB]:       { soft:false, requireCore:false },
  [YT.SCHNEIDER]: { soft:false, requireCore:false },

  [YT.BLOOMBERG]: { soft:true,  requireCore:true },
  [YT.CNBC]:      { soft:true,  requireCore:true },
  [YT.CNBC_ALT]:  { soft:true,  requireCore:true },
  [YT.WSJ]:       { soft:false, requireCore:true },
  [YT.REUTERS]:   { soft:false, requireCore:true },
  [YT.BBC]:       { soft:false, requireCore:true }
};

// ====================================================================
// TOPIC FILTERS
// ====================================================================

// Strict domain language
const RX_INCLUDE_STRICT = [
  // Transmission & Grid
  /\b(grid|transmission|distribution|substation|overhead\s+line|interconnector|intertie)\b/i,
  /\b(transformer|autotransformer|switchgear|breaker|protection\s+relay)\b/i,
  /\b(statcom|synchronous\s+condenser|reactive\s+power|facts|tcsr|tcsc|upfc|pmu|synchrophasor)\b/i,

  // HVDC/HVAC
  /\b(hvdc|hvac\s+transmission|converter\s+station|vsc|csc)\b/i,

  // Renewables & Generation
  /\b(renewable|solar|pv|wind|offshore\s+wind|hydro(?:power)?|geothermal|biomass|nuclear|smr|small\s+modular\s+reactor)\b/i,

  // Storage / Grid Edge
  /\b(battery|batteries|bess|energy\s+storage|lithium|grid[-\s]?forming)\b/i,
  /\b(virtual\s+power\s+plant|vpp|vehicle[-\s]?to[-\s]?grid|v2g|microgrid)\b/i,

  // Industrial loads
  /\b(semiconductor|foundry|fab|refinery|mining|smelter|steel|cement|rail|metro|traction|port|airport)\b/i,

  // Policy & Markets
  /\b(ferc|rto|iso|pjm|miso|ercot|caiso|iso[-\s]?ne|nyiso|ofgem|grid\s+code|capacity\s+market|ancillary\s+services)\b/i,

  // Automation & Monitoring
  /\b(scada|ems|dms|adms|derms|wams|digital\s+twin|condition\s+monitoring|predictive\s+maintenance|iec\s*61850)\b/i,

  // Equipment & Cables
  /\b(subsea\s+cable|hv\s+cable|xlpe|hvac\s+cable|conductor)\b/i,

  // Supply chain / lead times
  /\bsupply\s+chain.*\b(lead\s*time|capacity|backlog|shortage|procurement)\b/i,

  // Data centers / AI power / Semiconductors (broad but relevant)
  /\b(ai|artificial\s+intelligence|machine\s+learning|gpu|nvidia|semiconductor|chip|server|rack|data\s*cent(?:er|re)s?|hyperscale|colocation|supercomputer|hpc|cloud|ai\s+infrastructure|pue|liquid\s+cooling|immersion\s+cooling)\b/i
];

// Softer net (only if strict fails AND policy.soft = true)
const RX_INCLUDE_SOFT = [
  /\b(power|electric(ity|al)?|energy|utility|utilities)\b/i,
  /\b(grid|transmission|substation|hvdc|converter|bess|battery|storage)\b/i,
  /\b(data\s*center|datacentre|hyperscale|colocation|gpu|ai)\b/i,
  /\b(nuclear|smr|solar|pv|wind|offshore|hydrogen|electrolyzer|hydro)\b/i,
  /\b(cables?|transformer|switchgear|reactive|statcom|condenser)\b/i,
  /\b(nvidia|chip(s)?|semiconductor|foundry|fab)\b/i
];

// Core “must-have” for general news channels (avoid geopolitics)
const RX_CORE = /\b(power|electric(ity|al)?|grid|utility|data\s*cent(?:er|re)|datacentre|hyperscale|colocation|gpu|nvidia|ai|hvdc|battery|bess|hydrogen|solar|wind|nuclear|substation|transformer|transmission|converter|cooling|pue)\b/i;

// Manual smart-allow: very specific combos we care about
const RX_SMART_ALLOW = [
  /nvidia.*data\s*cent/i,
  /data\s*cent.*nvidia/i,
  /ai.*data\s*cent/i,
  /gpu.*(power|electric|grid)/i
];

// Excludes
const RX_EXCLUDE = [
  /\b(trump|biden|harris|election|congress|parliament|president|democrat|republican|politics|campaign)\b/i,
  /\b(israel|gaza|ukraine|russia|war|conflict|attack|terror|police|crime|shooting|murder|trial|court)\b/i,
  /\b(plane|aircraft|crash|collision|celebrity|hollywood|entertainment|music|movie|trailer|gossip|nfl|nba|mlb|soccer|football)\b/i,
  /\b(hurricane|storm|flood|tornado|earthquake|wildfire|blizzard|heatwave)\b(?!.*\b(grid|utility|power|outage)\b)/i,
  /#shorts|\bshorts\b/i
];

// ====================================================================
// HELPERS
// ====================================================================

const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const clean = (s="") => s.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
function safeISO(x){ const d=new Date(x||Date.now()); return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString(); }
function domainOf(url=""){ try{return new URL(url).hostname.replace(/^www\./,"").toLowerCase();}catch{return"";} }
function hoursAgo(iso){ const t=new Date(iso).getTime(); return (Date.now()-t)/36e5; }
function scoreItem(url,published){ const ageH=Math.max(1,hoursAgo(published)); return 10/ageH; }
function dedupeByUrl(items){ const seen=new Set(); return items.filter(x=>{const k=(x.url||"").trim(); if(!k||seen.has(k))return false; seen.add(k); return true;}); }
function sortByDateDesc(a,b){ return new Date(b.published)-new Date(a.published); }
const isLogoPath = u => /logo|sprite|favicon|brand|og-image-default/i.test(u||"");

// ====================================================================
// NETWORK + PARSERS (with proxy fallback)
// ====================================================================

function buildProxyUrl(proxyPattern, url){
  if (!proxyPattern.includes("{URL}")) return proxyPattern + encodeURIComponent(url);
  const raw = url.replace(/^https?:\/\//, "");
  return proxyPattern.replace("{URL}", raw);
}

async function fetchText(url, headers = {}, retries = 3){
  const h = {
    "user-agent": "PTD-Bot/1.0 (+https://ptdtoday.com)",
    "accept": "application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5",
    ...headers
  };
  for (let i=0;i<retries;i++){
    try{
      const r = await fetch(url,{headers:h});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      return { txt: await r.text(), ct: r.headers.get("content-type")||"" };
    }catch(e){
      if(i===retries-1) throw e;
      await sleep(400*(i+1));
    }
  }
}

async function fetchTextWithProxies(url, headers = {}, retries = 2){
  try { return await fetchText(url, headers, retries); }
  catch (e) {
    for (const p of PROXIES){
      try { return await fetchText(buildProxyUrl(p,url), headers, 1); }
      catch {}
    }
    throw e;
  }
}

function parseRSS(xml){
  const items=xml.match(/<item[\s\S]*?<\/item>/gi)||[];
  return items.map(b=>{
    const get=t=>(b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`,"i"))||[])[1]||"";
    const desc=get("description");
    const img = desc.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || "";
    return {
      title:clean(get("title")),
      url:clean(get("link"))||clean(get("guid")),
      published:safeISO(get("pubDate")||get("updated")||get("date")),
      image:img,
      type:"article"
    };
  }).filter(x=>x.title && x.url);
}

function parseYouTubeRSS(xml){
  const entries=xml.match(/<entry[\s\S]*?<\/entry>/gi)||[];
  return entries.map(e=>{
    const title = clean((e.match(/<title>([\s\S]*?)<\/title>/i)||[])[1]||"");
    const id    = (e.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/i)||[])[1]||"";
    const pub   = safeISO((e.match(/<published>([\s\S]*?)<\/published>/i)||[])[1]);
    const ch    = clean((e.match(/<name>([\s\S]*?)<\/name>/i)||[])[1]||"");
    const desc  = clean(
      (e.match(/<media:description[^>]*>([\s\S]*?)<\/media:description>/i)||[])[1] ||
      (e.match(/<content[^>]*>([\s\S]*?)<\/content>/i)||[])[1] || ""
    );
    return {
      title, description: desc,
      url:`https://www.youtube.com/watch?v=${id}`,
      published:pub,
      image:`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      type:"video",
      videoId:id,
      publisher:ch
    };
  }).filter(x=>x.title && x.url);
}

// Build both URLs for a channel: channel feed + uploads playlist feed
function youTubeFeedUrlsForChannelId(channelId){
  const feeds = [`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`];
  if (channelId.startsWith("UC")) {
    const playlistId = "UU" + channelId.slice(2);
    feeds.push(`https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`);
  }
  return feeds;
}

// ====================================================================
// IMAGE ENRICHMENT (articles)
// ====================================================================

function extractImageFromHtml(html){
  const pick=re=>(html.match(re)||[])[1]||"";
  const cands=[
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i
  ];
  for (const re of cands){ const u=pick(re); if(u && !isLogoPath(u)) return u; }
  const imgs=[...html.matchAll(/<img\b[^>]*src=["']([^"']+)["']/gi)].map(m=>m[1]);
  const good=imgs.find(u=>u && !isLogoPath(u));
  return good||"";
}
async function enrichArticleImages(items){
  const targets = items.filter(x=>x.type==="article" && !x.image).slice(0, ENRICH_MAX);
  const q=[...targets];
  async function worker(){
    while(q.length){
      const it=q.shift();
      try{
        const { txt } = await fetchText(it.url);
        const cand = extractImageFromHtml(txt);
        if (cand) it.image=cand;
      }catch{}
      await sleep(120);
    }
  }
  await Promise.all(Array.from({length:CONCURRENCY}, worker));
  return items;
}

// ====================================================================
// SHORT PAGES (for LinkedIn share OG/GA)
// ====================================================================

const shortIdFor = (url) => crypto.createHash("sha1").update(url).digest("base64url").slice(0,10);
const escapeHtml = (s="") => String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const gaHead = () => `
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');</script>`;

function staticSharePage(item){
  const id   = item.sid;
  const url  = `${SITE_ORIGIN}/s/${id}/`;
  const title= item.title;
  const img  = item.image || `${SITE_ORIGIN}/assets/og-default.png`;
  const meta = `
<meta property="og:type" content="${item.type==='video' ? 'video.other' : 'article'}">
<meta property="og:site_name" content="PTD Today">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:image" content="${escapeHtml(img)}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:image" content="${escapeHtml(img)}">`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — PTD Today</title>${gaHead()}${meta}
<link rel="stylesheet" href="/assets/main.css"></head>
<body>
<div class="wrap" style="max-width:820px;margin:34px auto;padding:0 16px">
  <a href="/" class="btn linkish">← Back to PTD Today</a>
  <h1 style="margin:10px 0 12px">${escapeHtml(title)}</h1>
  ${
    item.type==="video" && item.videoId
      ? `<div style="aspect-ratio:16/9;border-radius:8px;overflow:hidden;border:1px solid #d9ccb3">
           <iframe width="100%" height="100%" src="https://www.youtube.com/embed/${escapeHtml(item.videoId)}"
             title="${escapeHtml(title)}" frameborder="0"
             allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
             allowfullscreen></iframe>
         </div>
         <div class="cta-row" style="margin-top:12px">
           <a class="btn" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Watch on YouTube</a>
           <button class="btn secondary" onclick="share()">Share</button>
         </div>`
      : `<img src="${escapeHtml(img)}" alt="" style="width:100%;height:280px;object-fit:cover;border-radius:8px;border:1px solid #d9ccb3">
         <div class="cta-row" style="margin-top:12px">
           <a class="btn" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Open Article</a>
           <button class="btn linkish" onclick="share()">Share</button>
         </div>`
  }
  <p style="color:#6f675d;margin-top:10px">You’re on PTD Today. Click above to visit the original publisher.</p>
</div>
<script>
function share(){
  const url=location.href, title=document.title;
  if(navigator.share){ navigator.share({title,url}).catch(()=>{}); }
  else { navigator.clipboard.writeText(url).then(()=>alert('Link copied')).catch(()=>{}); }
}
</script>
</body></html>`;
}

// ====================================================================
// FILTER HELPERS
// ====================================================================

const testStrict  = (t) => RX_INCLUDE_STRICT.some(rx=>rx.test(t));
const testSoft    = (t) => RX_INCLUDE_SOFT.some(rx=>rx.test(t));
const testCore    = (t) => RX_CORE.test(t);
const testSmart   = (t) => RX_SMART_ALLOW.some(rx=>rx.test(t));
const testExclude = (t) => RX_EXCLUDE.some(rx=>rx.test(t));

// Decide if a YT item passes for a given channel policy
function passesYouTubePolicy(blob, policy){
  if (testExclude(blob)) return false;

  if (testSmart(blob)) {
    if (policy.requireCore && !testCore(blob)) return false;
    return true;
  }

  if (testStrict(blob)) {
    if (policy.requireCore && !testCore(blob)) return false;
    return true;
  }

  if (policy.soft && testSoft(blob)) {
    if (policy.requireCore && !testCore(blob)) return false;
    return true;
  }

  return false;
}

// ====================================================================
// BUILD
// ====================================================================

async function build(){
  let items=[];
  const ytDebug = [];

  // 1) Publishers (≈60h)
  console.log("🔹 Publishers:");
  for(const f of FEEDS){
    try{
      const { txt } = await fetchText(f);
      const parsed  = parseRSS(txt);
      items.push(...parsed);
      console.log(`  ✓ ${f} -> ${parsed.length}`);
      await sleep(150);
    }catch(e){ console.warn(`  ⚠ ${f}: ${e.message}`); }
  }

  // 2) YouTube (7-day window, policy filtering, proxy + playlist fallback)
  console.log("🔹 YouTube (past", YT_HOURS/24, "days):");
  for(const ch of YT_CHANNELS){
    const feeds = youTubeFeedUrlsForChannelId(ch);
    const policy = CHANNEL_POLICIES[ch] || { soft:false, requireCore:false };
    let all = [];
    for (const feedUrl of feeds){
      try{
        const { txt } = await fetchTextWithProxies(feedUrl, { "accept-language":"en-US,en;q=0.8" }, 3);
        const got = parseYouTubeRSS(txt);
        all.push(...got);
        await sleep(120);
      }catch(e){
        console.warn(`  ⚠ YT feed ${feedUrl}: ${e.message}`);
      }
    }

    // de-dupe by videoId
    const seen = new Set();
    all = all.filter(v => (v.videoId && !seen.has(v.videoId) && seen.add(v.videoId)));

    // time filter + newest first
    all = all.filter(v => (Date.now() - new Date(v.published).getTime()) <= YT_HOURS*3600*1000)
             .sort((a,b)=> new Date(b.published) - new Date(a.published));

    ytDebug.push({ channel: ch, feeds, count: all.length, sample: all.slice(0,5) });

    const kept=[];
    for (const v of all){
      const blob = `${v.title} ${v.description}`.toLowerCase();
      if (passesYouTubePolicy(blob, policy)) {
        kept.push(v);
        if (kept.length >= YT_MAX_PER_CHANNEL) break;
      }
    }

    items.push(...kept);
    console.log(`  ✓ ${ch} kept ${kept.length} / ${all.length} (soft=${policy.soft}, core=${policy.requireCore})`);
    await sleep(150);
  }

  // Normalize
  items = items.map(x => x.type === "video" ? {
    title: x.title,
    url: x.url,
    publisher: x.publisher || "YouTube",
    category: "Video",
    published: safeISO(x.published),
    score: scoreItem(x.url, x.published),
    image: x.image || "",
    type: "video",
    videoId: x.videoId || ""
  } : {
    title: x.title,
    url: x.url,
    publisher: domainOf(x.url),
    category: "Article",
    published: safeISO(x.published),
    score: scoreItem(x.url, x.published),
    image: (x.image||"").trim(),
    type: "article"
  });

  // Dedupe + sort
  items = dedupeByUrl(items).sort(sortByDateDesc);

  // Enrich article thumbnails
  await enrichArticleImages(items);

  // ---------- Type-aware windows ----------
  const now = Date.now();
  const isRecent = (it) => {
    const ageMs = now - new Date(it.published).getTime();
    const limit = (it.type === "video" ? YT_HOURS : RECENT_HOURS) * 3600 * 1000;
    return ageMs <= limit;
  };

  const recent = items.filter(isRecent);
  const week   = items.filter(x => now - new Date(x.published).getTime() <= 7 * 24 * 3600 * 1000);

  // Shortlinks for recent
  await fs.mkdir(OUT_DATA, { recursive: true });
  await fs.mkdir(OUT_SHORT, { recursive: true });
  const shortMap = {};

  for(const it of recent){
    const id = shortIdFor(it.url);
    it.sid   = id;
    it.share = `/s/${id}/`;
    const dir = path.join(OUT_SHORT, id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "index.html"), staticSharePage(it));
    shortMap[id] = {
      url: it.url, title: it.title, image: it.image, publisher: it.publisher,
      category: it.category, published: it.published, type: it.type, videoId: it.videoId || ""
    };
  }

  // Write data + debug
  await fs.writeFile(NEWS_PATH, JSON.stringify(recent, null, 2));
  await fs.writeFile(WEEK_PATH, JSON.stringify({ updated: new Date().toISOString(), items: week }, null, 2));
  await fs.writeFile(SHORT_MAP, JSON.stringify(shortMap, null, 2));
  await fs.writeFile(YT_DEBUG, JSON.stringify(ytDebug, null, 2));

  console.log(`Wrote:
  - data/news.json (${recent.length})
  - data/7d.json
  - data/shortlinks.json
  - data/youtube_raw.json (debug)
  - s/<id>/index.html (${Object.keys(shortMap).length})
Done.`);
}

build().catch(e=>{ console.error("Build failed:", e); process.exit(1); });