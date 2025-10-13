// ===========================================================
// PTD Today Builder — Articles + YouTube Videos
// - Feeds from publishers (RSS/Atom/JSON)
// - YouTube channel RSS (no API key)
// - Thumbnail enrichment for articles
// - Static shortlink pages /s/<id>/ with OG (article or video)
// - GA4 tag injected into short pages
// Node 20+
// ===========================================================

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

// ---------- Paths & constants ----------
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

// ---------- Source feeds (publishers) ----------
const DEFAULT_FEEDS = [
  "https://www.utilitydive.com/feeds/news/",
  "https://www.datacenterdynamics.com/en/rss/",
  "https://www.pv-magazine.com/feed/",
  "https://www.offshorewind.biz/feed/",
  "https://www.rechargenews.com/rss/",
  "https://www.ferc.gov/rss.xml",
  "https://www.energy.gov/rss"
];

// Allow override with env FEEDS="url1,url2"
const FEEDS = (process.env.FEEDS?.split(",").map(s=>s.trim()).filter(Boolean)) || DEFAULT_FEEDS;

// ---------- YouTube channels (trusted) ----------
/* YouTube RSS format:
   https://www.youtube.com/feeds/videos.xml?channel_id=<CHANNEL_ID>
*/
const DEFAULT_YT_CHANNELS = [
  // News
  "UCupvZG-5ko_eiXAupbDfxWw", // CNN
  "UChqUTb7kYRX8-EiaN3XFrSQ", // Reuters
  "UCXIJgqnII2ZOINSWNOGFThA", // Fox News
  "UCvJJ_dzjViJCoLf5uKUTwoA", // Fox Business
  "UCvJJ_dzjViJCoLf5uKUTwoA", // (dup safeguard ok)
  "UCn7kS1Mdr1R9oZ8r0T7w3ug", // CNBC Television
  "UC16niRr50-MSBwiO3YDb3RA", // BBC News
  "UCUMZ7gohGI9HcU9VNsr2FJQ", // Bloomberg Television
  "UCW6-BQWFA70DyycZ57JKias", // Wall Street Journal
  "UCo3TQcnm5KxV5eU2l3GKOAw"  // Financial Times
];

// Allow override with env YT_CHANNELS="id1,id2"
const YT_CHANNELS =
  (process.env.YT_CHANNELS?.split(",").map(s=>s.trim()).filter(Boolean))
  || DEFAULT_YT_CHANNELS;

// ---------- Time windows & limits ----------
const RECENT_HOURS = Number(process.env.RECENT_HOURS || 48); // today + yesterday
const ENRICH_MAX   = Number(process.env.MAX_ENRICH   || 60); // article-image enrichment cap
const CONCURRENCY  = 6;

// ---------- Keyword filter for YouTube relevance ----------
const YT_KEYWORDS = [
  /grid|transmission|substation|distribution|switchgear|transformer/i,
  /hvdc|hvadc/i,
  /renewables?|solar|wind|geothermal|storage|battery|batteries/i,
  /energy policy|ferc|capacity market|rto|iso|pjm|miso|ercot|caiso|nyiso|isone/i,
  /electricity|power market|power prices|capacity prices|wholesale|ancillary/i,
  /data ?centers?|hyperscale/i,
  /ai.*(energy|power)|power.*ai|gpu.*power/i,
  /infrastructure|utility|rate case|outage/i
];

// ===========================================================
// Helpers
// ===========================================================
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const clean = (s="") => s.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
function safeISO(x){ const d=new Date(x||Date.now()); return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString(); }
function hoursAgo(iso){ const t=new Date(iso).getTime(); return (Date.now()-t)/36e5; }
function domainOf(url=""){ try{return new URL(url).hostname.replace(/^www\./,"").toLowerCase();}catch{return"";} }
function scoreItem(url,published){ const ageH=Math.max(1,hoursAgo(published)); return 10/ageH; }
function dedupeByUrl(items){ const seen=new Set(); return items.filter(x=>{const k=(x.url||"").trim(); if(!k||seen.has(k))return false; seen.add(k); return true;}); }
function clampWindow(items,ms){ const now=Date.now(); return items.filter(x=>{const t=new Date(x.published).getTime(); return t && t<=now && (now-t)<=ms;}); }
function sortByDateDesc(a,b){ return new Date(b.published)-new Date(a.published); }
const isLogoPath = u => /logo|sprite|favicon|brand|og-image-default/i.test(u||"");

// ===========================================================
// Networking
// ===========================================================
async function fetchText(url){
  const res = await fetch(url,{headers:{"user-agent":"ptd-bot/1.0 (+https://ptdtoday.com)"}});
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ct=res.headers.get("content-type")||"";
  const txt=await res.text();
  return {txt, ct};
}

// ===========================================================
// Feed parsing (publishers)
// ===========================================================
function parseRSS(xml){
  const rows = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return rows.map(b=>{
    const get = tag => (b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,"i"))||[])[1]||"";
    const title=clean(get("title"));
    const link =clean(get("link"))||clean(get("guid"));
    const pub  =get("pubDate")||get("updated")||get("date");
    const desc =get("description");
    const img  =desc.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || "";
    return { title, url:link, published:safeISO(pub), image:img, type:"article" };
  }).filter(x=>x.title && x.url);
}
function parseAtom(xml){
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  return entries.map(b=>{
    const get = tag => (b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,"i"))||[])[1]||"";
    const title=clean(get("title"));
    let link=""; const links=b.match(/<link\b[^>]*>/gi)||[];
    for(const lt of links){
      const rel=(lt.match(/\brel=["']([^"']+)["']/i)||[])[1]?.toLowerCase()||"alternate";
      const href=(lt.match(/\bhref=["']([^"']+)["']/i)||[])[1];
      if(href && (rel==="alternate"||rel==="self")){ link=href; break; }
    }
    const pub=get("updated")||get("published")||"";
    const img=b.match(/<media:content[^>]*url=["']([^"']+)["']/i)?.[1]||"";
    return { title, url:link, published:safeISO(pub), image:img, type:"article" };
  }).filter(x=>x.title && x.url);
}
function parseJSONFeed(txt){
  let j; try{ j=JSON.parse(txt); }catch{ return []; }
  const arr = Array.isArray(j) ? j : (j.items || []);
  return arr.map(it=>{
    const title=String(it.title||"").trim();
    const url  =String(it.url||it.external_url||it.link||"").trim();
    const pub  =safeISO(it.date_published||it.published||it.date||it.updated);
    const img  =it.image||it.banner_image||it.thumbnail||"";
    return { title, url, published:pub, image:img, type:"article" };
  }).filter(x=>x.title && x.url);
}
function detectAndParse(body, ct=""){
  const t=ct.toLowerCase();
  if(t.includes("json")||/^\s*{/.test(body)) return parseJSONFeed(body);
  if(/<rss\b/i.test(body)||/<channel\b/i.test(body)) return parseRSS(body);
  if(/<feed\b/i.test(body)||/<entry\b/i.test(body))   return parseAtom(body);
  return parseRSS(body);
}

// ===========================================================
// YouTube channel RSS parsing
// ===========================================================
function ytFeedUrl(channelId){
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}
function parseYouTubeRSS(xml){
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  return entries.map(b=>{
    const title = clean((b.match(/<title>([\s\S]*?)<\/title>/i)||[])[1]||"");
    const link  = (b.match(/<link[^>]+href=["']([^"']+)["']/i)||[])[1] || "";
    const pub   = (b.match(/<published>([\s\S]*?)<\/published>/i)||[])[1] || "";
    const vid   = (b.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/i)||[])[1] || "";
    const chan  = clean((b.match(/<name>([\s\S]*?)<\/name>/i)||[])[1]||"");
    const thumb = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
    return {
      title, url: link || (vid ? `https://www.youtube.com/watch?v=${vid}` : ""),
      published: safeISO(pub), image: thumb, type:"video", publisher: chan, videoId: vid
    };
  }).filter(x=>x.title && x.url);
}
function ytRelevant(item){
  const text = `${item.title}`; // could include more fields
  return YT_KEYWORDS.some(rx => rx.test(text));
}

// ===========================================================
// Normalization & enrichment for articles
// ===========================================================
function guessCategory(title="", url=""){
  const s=(title+" "+url).toLowerCase();
  if (s.includes("hvdc")) return "HVDC";
  if (s.includes("substation")) return "Substations";
  if (s.includes("protection")) return "Protection";
  if (s.includes("cable")) return "Cables";
  if (s.includes("policy") || s.includes("ferc") || s.includes("commission")) return "Policy";
  if (s.includes("renewable") || s.includes("solar") || s.includes("wind")) return "Renewables";
  if (s.includes("data center") || s.includes("datacenter")) return "Data Centers";
  if (/\bai\b|machine learning|genai|llm/.test(s)) return "AI";
  if (s.includes("transformer") || s.includes("switchgear") || s.includes("breaker") || s.includes("statcom")) return "Equipment";
  if (s.includes("transport") || s.includes("shipping") || s.includes("rail")) return "Transport";
  if (s.includes("lead time") || s.includes("supply chain") || s.includes("backlog")) return "Lead Times";
  if (s.includes("grid") || s.includes("transmission") || s.includes("distribution")) return "Grid";
  return "Grid";
}
function normalizeArticle(raw){
  const title=(raw.title||"").trim();
  const url  =(raw.url||"").trim();
  const published=safeISO(raw.published);
  const publisher=domainOf(url);
  const category =guessCategory(title,url);
  const image=(raw.image||"").trim();
  const score=scoreItem(url,published);
  return { title, url, publisher, category, published, score, image, type:"article" };
}

// best-effort OG image scrape for articles
function extractImageFromHtml(html){
  const pick=re=>(html.match(re)||[])[1]||"";
  const cands=[
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']article:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']parsely-image-url["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i
  ];
  for (const re of cands){ const u=pick(re); if(u && !isLogoPath(u)) return u; }
  const imgs=[...html.matchAll(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]);
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

// ===========================================================
// Shortlinks & static pages
// ===========================================================
const shortIdFor = (url) => crypto.createHash("sha1").update(url).digest("base64url").slice(0,10);
const escapeHtml = (s="") => String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const gaHead = () => `
  <!-- Google Analytics 4 -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){ dataLayer.push(arguments); }
    gtag('js', new Date());
    gtag('config', '${GA_ID}');
  </script>
  <!-- End GA -->`;

function staticSharePage(item){
  const id   = item.sid;
  const url  = `${SITE_ORIGIN}/s/${id}/`;
  const title= item.title;
  const img  = item.image || `${SITE_ORIGIN}/assets/og-default.png`;
  const desc = "First to Know. First to Lead.";
  const dt   = item.published ? new Date(item.published).toISOString().replace('T',' ').replace(/:\d\d\.\d{3}Z$/,'Z').replace(/:\d\dZ$/,'Z') : '';
  const meta = `
<meta property="og:type" content="${item.type==='video' ? 'video.other' : 'article'}">
<meta property="og:site_name" content="PTD Today">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${escapeHtml(img)}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${escapeHtml(img)}">`;

  const bodyContent = (item.type === "video" && item.videoId)
    ? `<div class="meta">${escapeHtml((item.category||'').toUpperCase())} • ${escapeHtml(item.publisher||'')} • ${escapeHtml(dt)}</div>
       <div class="video-wrap" style="aspect-ratio:16/9; background:#000; border:1px solid #d9ccb3; border-radius:8px; overflow:hidden;">
         <iframe width="100%" height="100%" src="https://www.youtube.com/embed/${escapeHtml(item.videoId)}"
                 title="${escapeHtml(title)}" frameborder="0"
                 allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                 allowfullscreen></iframe>
       </div>
       <div class="cta-row" style="margin-top:14px;">
         <a class="btn" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Watch on YouTube</a>
         <button class="btn secondary" onclick="share()">Share</button>
       </div>`
    : `<img class="hero" src="${escapeHtml(img)}" alt="" style="width:100%;height:280px;object-fit:cover;border-radius:8px;border:1px solid #d9ccb3;background:#f2eadc">
       <div class="cta-row" style="margin-top:14px;">
         <a class="btn" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Open Article</a>
         <a class="btn secondary" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Source</a>
         <button class="btn linkish" onclick="share()">Share</button>
       </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — PTD Today</title>
${gaHead()}
<meta name="description" content="${desc}">
<link rel="canonical" href="${url}">
${meta}
<link rel="stylesheet" href="/assets/main.css">
<style>.wrap{max-width:820px;margin:34px auto;padding:0 16px}.meta{color:#6f675d;font-size:13px;margin:6px 0 12px}</style>
</head>
<body>
<div class="wrap">
  <a href="/" class="btn linkish">← Back to PTD Today</a>
  <h1 style="margin:10px 0 6px;">${escapeHtml(title)}</h1>
  ${bodyContent}
  <p style="margin-top:14px;color:#6f675d;">You’re on PTD Today. Click the button above to visit the original publisher.</p>
</div>
<script>
function share(){
  const url=location.href, title=document.title;
  if(navigator.share){ navigator.share({title,url}).catch(()=>{}); }
  else { navigator.clipboard.writeText(url).then(()=>{ alert('Link copied to clipboard'); }).catch(()=>{}); }
}
</script>
</body>
</html>`;
}

// ===========================================================
// Build
// ===========================================================
async function build(){
  console.log("PTD build: fetching publisher feeds…");
  let fetched = [];
  for(const f of FEEDS){
    try{
      const { txt, ct } = await fetchText(f);
      const items = detectAndParse(txt, ct);
      console.log(`  ✓ ${f} (${items.length})`);
      fetched = fetched.concat(items);
      await sleep(200);
    }catch(e){ console.warn(`  ⚠ ${f}: ${e.message}`); }
  }

  console.log("PTD build: fetching YouTube RSS…");
  for(const ch of YT_CHANNELS){
    try{
      const { txt } = await fetchText(ytFeedUrl(ch));
      let vids = parseYouTubeRSS(txt).filter(ytRelevant);
      fetched = fetched.concat(vids);
      console.log(`  ✓ YT ${ch} (${vids.length} relevant)`);
      await sleep(200);
    }catch(e){ console.warn(`  ⚠ YT ${ch}: ${e.message}`); }
  }

  // Normalize
  let items = fetched.map(x => x.type === "video" ? {
      title: x.title,
      url: x.url,
      publisher: x.publisher || "youtube.com",
      category: "Video",
      published: safeISO(x.published),
      score: scoreItem(x.url, x.published),
      image: x.image || "",
      type: "video",
      videoId: x.videoId || ""
    } : normalizeArticle(x));

  // Dedupe by URL, enrich article thumbnails
  items = dedupeByUrl(items);
  await enrichArticleImages(items);

  // Windows
  const recentMs = RECENT_HOURS * 3600 * 1000;
  const sevenMs  = 7 * 24 * 3600 * 1000;
  let recent = clampWindow(items, recentMs).sort(sortByDateDesc);
  let week   = clampWindow(items, sevenMs).sort(sortByDateDesc);

  // Shortlinks + static pages
  await fs.mkdir(OUT_DATA, { recursive: true });
  await fs.mkdir(OUT_SHORT, { recursive: true });

  const shortMap = {};
  for(const it of recent){
    const id = shortIdFor(it.url);
    it.sid = id;
    it.share = `/s/${id}/`;
    const dir = path.join(OUT_SHORT, id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "index.html"), staticSharePage(it));
    shortMap[id] = {
      url: it.url, title: it.title, image: it.image, publisher: it.publisher,
      category: it.category, published: it.published, type: it.type, videoId: it.videoId || ""
    };
  }

  // Write data
  await fs.writeFile(NEWS_PATH, JSON.stringify(recent, null, 2));
  await fs.writeFile(WEEK_PATH, JSON.stringify({ updated: new Date().toISOString(), items: week }, null, 2));
  await fs.writeFile(SHORT_MAP, JSON.stringify(shortMap, null, 2));

  console.log(`Wrote:
  - data/news.json (${recent.length} recent)
  - data/7d.json
  - s/<id>/index.html short pages (with GA & OG)
  - data/shortlinks.json
Done.`);
}

build().catch(e=>{ console.error("Build failed:", e); process.exit(1); });