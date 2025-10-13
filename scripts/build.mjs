// ===========================================================
// PTD Today Builder — Articles + On-Topic YouTube (Energy, Grid, Renewables)
// ===========================================================

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, "..");
const OUT_DATA   = path.join(ROOT, "data");
const OUT_SHORT  = path.join(ROOT, "s");
const NEWS_PATH  = path.join(OUT_DATA, "news.json");
const WEEK_PATH  = path.join(OUT_DATA, "7d.json");
const SHORT_MAP  = path.join(OUT_DATA, "shortlinks.json");

const SITE_ORIGIN = "https://ptdtoday.com";
const GA_ID = "G-TVKD1RLFE5";

// ====================================================================
// CONFIGURATION
// ====================================================================

const RECENT_HOURS = Number(process.env.RECENT_HOURS || 60);
const CONCURRENCY  = 6;
const YT_MAX_PER_CHANNEL = Number(process.env.YT_MAX_PER_CHANNEL || 4);

// --- Core publisher RSS feeds ---
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

// --- YouTube channels ---
const DEFAULT_YT_CHANNELS = [
  "UCupvZG-5ko_eiXAupbDfxWw", // CNN
  "UChqUTb7kYRX8-EiaN3XFrSQ", // Reuters
  "UC16niRr50-MSBwiO3YDb3RA", // BBC News
  "UCvJJ_dzjViJCoLf5uKUTwoA", // CNBC
  "UCx6h-dWzJ5NpAlja1YsApdg", // Fox Business
  "UCUMZ7gohGI9HcU9VNsr2FJQ", // Bloomberg
  "UCW6-BQWFA70DyycZ57JKias", // WSJ
  "UCo3TQcnm5KxV5eU2l3GKOAw"  // Financial Times
];
const YT_CHANNELS =
  (process.env.YT_CHANNELS?.split(",").map(s=>s.trim()).filter(Boolean))
  || DEFAULT_YT_CHANNELS;

// ====================================================================
// TOPIC FILTERS
// ====================================================================

// --- Include list (based on all 10 T&D-related domains you approved) ---
const RX_INCLUDE = [
  // Transmission & Grid
  /\b(grid|transmission|distribution|substation|hvdc|hvac|transformer|switchgear|breaker|iec\s*61850|statcom|synchronous condenser|fact|reactive power|microgrid|interconnector|u?hv|conductor|cable)\b/i,
  // Generation & Renewables
  /\b(solar|wind|offshore wind|pv|renewable|hydro|nuclear|hydrogen|geothermal|biomass|smr|gigafactory)\b/i,
  // Storage & Grid Edge
  /\b(battery|bess|energy storage|lithium|vehicle to grid|v2g|microgrid|virtual power plant|vpp)\b/i,
  // Data Centers & AI Power
  /\b(data ?center|hyperscale|colocation|gpu|ai.*(energy|power)|pue|cooling|liquid cooling|server farm)\b/i,
  // Industrial Consumers
  /\b(refinery|mining|steel|cement|semiconductor|fab|smelter|ev plant|port|airport|rail|metro|traction)\b/i,
  // Policy & Markets
  /\b(ferc|rto|iso|pjm|miso|ercot|caiso|iso[- ]?ne|nyiso|ofgem|grid code|capacity market)\b/i,
  // Automation & Monitoring
  /\b(scada|ems|adms|derms|pmu|wams|digital twin|predictive maintenance|condition monitoring)\b/i,
  // Construction & Supply
  /\b(epc|lead time|supply chain|transformer shortage|equipment delay|factory)\b/i
];

// --- Exclude list (drop unrelated/political/crime content) ---
const RX_EXCLUDE = [
  /\b(trump|biden|harris|election|congress|democrat|republican|white house|president|politics)\b/i,
  /\b(israel|gaza|ukraine|russia|war|conflict|attack|police|crime|shooting|murder|court|trial)\b/i,
  /\b(plane|aircraft|crash|hurricane|storm|flood|weather|heatwave|fire|tornado|earthquake)\b/i,
  /\b(entertainment|hollywood|celebrity|movie|football|soccer|nba|nfl|mlb|music|trailer|gossip)\b/i
];

// ====================================================================
// HELPERS
// ====================================================================

const sleep = ms=>new Promise(r=>setTimeout(r,ms));
const clean = s=>(s||"").replace(/<!\[CDATA\[|\]\]>/g,"").trim();
const safeISO = x => { const d=new Date(x||Date.now()); return isNaN(d)?new Date().toISOString():d.toISOString(); };
const domainOf = u=>{try{return new URL(u).hostname.replace(/^www\./,"").toLowerCase();}catch{return"";}};
const hoursAgo = iso => (Date.now()-new Date(iso).getTime())/36e5;
const scoreItem = (url,p)=>10/Math.max(1,hoursAgo(p));
const dedupe = arr=>{const s=new Set();return arr.filter(x=>!s.has(x.url)&&s.add(x.url));};
const sortByDateDesc=(a,b)=>new Date(b.published)-new Date(a.published);
const isLogoPath = u => /logo|sprite|favicon|brand|og-image-default/i.test(u||"");

// ====================================================================
// NETWORK + PARSERS
// ====================================================================

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
  }).filter(x=>x.title&&x.url);
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
  }).filter(x=>x.title&&x.url);
}

// ====================================================================
// IMAGE ENRICHMENT
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
async function enrichArticleImages(items, max = 50){
  const targets = items.filter(x=>x.type==="article" && !x.image).slice(0, max);
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
// SHORT PAGES (for LinkedIn share)
// ====================================================================

const shortIdFor=u=>crypto.createHash("sha1").update(u).digest("base64url").slice(0,10);
const escapeHtml=s=>String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const gaHead=()=>`
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');</script>`;

function staticPage(it){
  const id=it.sid,url=`${SITE_ORIGIN}/s/${id}/`,img=it.image||`${SITE_ORIGIN}/assets/og-default.png`;
  const meta = `
<meta property="og:type" content="${it.type==='video'?'video.other':'article'}">
<meta property="og:site_name" content="PTD Today">
<meta property="og:title" content="${escapeHtml(it.title)}">
<meta property="og:image" content="${escapeHtml(img)}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(it.title)}">
<meta name="twitter:image" content="${escapeHtml(img)}">`;
  return `<!doctype html><html lang="en"><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${escapeHtml(it.title)} — PTD Today</title>${gaHead()}${meta}
<link rel=stylesheet href="/assets/main.css"></head><body>
<div class="wrap" style="max-width:820px;margin:34px auto;padding:0 16px">
  <a href="/" class="btn linkish">← Back to PTD Today</a>
  <h1 style="margin:10px 0 12px">${escapeHtml(it.title)}</h1>
  ${it.type==="video"
    ? `<div style="aspect-ratio:16/9;border-radius:8px;overflow:hidden;border:1px solid #d9ccb3">
         <iframe width="100%" height="100%" src="https://www.youtube.com/embed/${escapeHtml(it.videoId)}"
            title="${escapeHtml(it.title)}" frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
       </div>
       <div class="cta-row" style="margin-top:12px"><a class="btn" href="${escapeHtml(it.url)}" target="_blank" rel="noopener">Watch on YouTube</a></div>`
    : `<img src="${escapeHtml(img)}" alt="" style="width:100%;height:280px;object-fit:cover;border-radius:8px;border:1px solid #d9ccb3">
       <div class="cta-row" style="margin-top:12px"><a class="btn" href="${escapeHtml(it.url)}" target="_blank" rel="noopener">Open Article</a></div>`
  }
  <p style="color:#6f675d;margin-top:10px">You’re on PTD Today. Click above to visit the original publisher.</p>
</div></body></html>`;
}

// ====================================================================
// FILTER TEST
// ====================================================================

function onTopic(text){
  if (!text) return false;
  if (RX_EXCLUDE.some(rx=>rx.test(text))) return false;
  return RX_INCLUDE.some(rx=>rx.test(text));
}

// ====================================================================
// BUILD
// ====================================================================

async function build(){
  let items=[];

  console.log("🔹 Publisher Feeds:");
  for(const f of FEEDS){
    try{
      const { txt } = await fetchText(f);
      const parsed  = parseRSS(txt);
      items.push(...parsed);
      console.log("  ✓", f, parsed.length);
      await sleep(150);
    }catch(e){ console.warn("  ⚠", f, e.message); }
  }

  console.log("🔹 YouTube Feeds:");
  for(const ch of YT_CHANNELS){
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`;
    try{
      const { txt } = await fetchText(url, { "accept-language":"en-US,en;q=0.8" });
      const all = parseYouTubeRSS(txt)
        .filter(v => (Date.now() - new Date(v.published).getTime()) <= RECENT_HOURS*3600*1000);
      const chosen = [];
      for(const v of all){
        const blob = `${v.title} ${v.description}`.toLowerCase();
        if (onTopic(blob)) {
          chosen.push(v);
          if (chosen.length >= YT_MAX_PER_CHANNEL) break;
        }
      }
      items.push(...chosen);
      console.log(`  ✓ ${ch} kept ${chosen.length}/${all.length}`);
      await sleep(150);
    }catch(e){ console.warn("  ⚠", ch, e.message); }
  }

  // Normalize & clean
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
  items = dedupe(items).sort(sortByDateDesc);

  // Add article images
  await enrichArticleImages(items, 40);

  // Write data
  const recent = items.filter(x => (Date.now() - new Date(x.published).getTime()) <= RECENT_HOURS*3600*1000);
  const week   = items.filter(x => (Date.now() - new Date(x.published).getTime()) <= 7*24*3600*1000);
  await fs.mkdir(OUT_DATA, { recursive: true });
  await fs.mkdir(OUT_SHORT, { recursive: true });

  const shortMap = {};
  for(const it of recent){
    const id = shortIdFor(it.url);
    it.sid = id;
    it.share = `/s/${id}/`;
    const dir = path.join(OUT_SHORT, id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "index.html"), staticPage(it));
    shortMap[id] = { url: it