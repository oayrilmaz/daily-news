// ===========================================================
// PTD Today Builder — Articles + Topic-Strict YouTube
// Node 20+
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

// ---------- Config ----------
const RECENT_HOURS = Number(process.env.RECENT_HOURS || 60); // ~2.5 days to avoid UTC edges
const CONCURRENCY  = 6;
const YT_MAX_PER_CHANNEL = Number(process.env.YT_MAX_PER_CHANNEL || 4);

// Publisher feeds
const DEFAULT_FEEDS = [
  "https://www.utilitydive.com/feeds/news/",
  "https://www.datacenterdynamics.com/en/rss/",
  "https://www.pv-magazine.com/feed/",
  "https://www.offshorewind.biz/feed/",
  "https://www.rechargenews.com/rss/",
  "https://www.ferc.gov/rss.xml",
  "https://www.energy.gov/rss"
];
const FEEDS = (process.env.FEEDS?.split(",").map(s=>s.trim()).filter(Boolean)) || DEFAULT_FEEDS;

// YouTube channels (trusted large publishers). Filtering below will keep only on-topic clips.
const DEFAULT_YT_CHANNELS = [
  "UCupvZG-5ko_eiXAupbDfxWw", // CNN
  "UChqUTb7kYRX8-EiaN3XFrSQ", // Reuters
  "UCvJJ_dzjViJCoLf5uKUTwoA", // CNBC
  "UC16niRr50-MSBwiO3YDb3RA", // BBC News
  "UCx6h-dWzJ5NpAlja1YsApdg", // Fox Business
  "UCUMZ7gohGI9HcU9VNsr2FJQ", // Bloomberg TV
  "UCW6-BQWFA70DyycZ57JKias", // WSJ
  "UCo3TQcnm5KxV5eU2l3GKOAw"  // FT
];
const YT_CHANNELS =
  (process.env.YT_CHANNELS?.split(",").map(s=>s.trim()).filter(Boolean))
  || DEFAULT_YT_CHANNELS;

// ---------- Topic filters ----------
const RX_INCLUDE = [
  // grid & T&D
  /\b(grid|transmission|distribution|substation|statcom|synchronous condenser|microgrid|interconnection)\b/i,
  // HVDC/HVAC
  /\b(hvdc|hvac transmission)\b/i,
  // renewables
  /\b(renewable|solar|pv|wind|offshore wind|geothermal|hydropower|pumped storage)\b/i,
  // storage / batteries / nuclear / hydrogen
  /\b(battery|batteries|energy storage|lithium|gigafactory|smr|small modular reactor|nuclear)\b/i,
  /\b(hydrogen|electrolyzer|ammonia pipeline)\b/i,
  // markets & policy (US/UK)
  /\b(ferc|capacity market|rto|iso|pjm|miso|ercot|caiso|iso-?ne|nyiso|ofgem)\b/i,
  /\b(electricity|power prices|capacity prices|ancillary services)\b/i,
  // data centers / AI-power
  /\b(data ?centers?|hyperscale|colocation|server farm|gpu (cluster|power|cooling)|pue|liquid cooling)\b/i,
  /\b(ai).*(energy|power|datacenter)|\bdatacenter\b.*\b(ai|gpu)\b/i,
  // equipment & cables
  /\b(transformer|switchgear|breaker|protection relay|iec\s*61850|subsea cable|interconnector|intertie|conductor|hv cable|u?hv\b)\b/i,
  // supply chain / lead times
  /\b(supply chain).*(lead time|backlog|capacity|shortage)\b/i,
];

const RX_EXCLUDE = [
  // politics / general news
  /\b(trump|biden|harris|election|democrat|republican|congress|senate|supreme court|white house)\b/i,
  // conflict / crime
  /\b(israel|gaza|ukraine|russia|war|shooting|police|crime|homicide|kidnapping)\b/i,
  // accidents unless grid-related
  /\b(plane|aircraft|crash|collision|fire|explosion)\b(?!.*\b(grid|utility|substation|power|outage)\b)/i,
  // sports / entertainment
  /\b(nfl|nba|mlb|soccer|football|hollywood|celebrity|music video|trailer)\b/i,
  // weather unless grid-related
  /\b(hurricane|storm|tornado|blizzard|heatwave)\b(?!.*\b(grid|utility|power|outage)\b)/i
];

// ---------- Helpers ----------
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
const clean = s=>(s||"").replace(/<!\[CDATA\[|\]\]>/g,"").trim();
const safeISO = x => { const d=new Date(x||Date.now()); return isNaN(d)?new Date().toISOString():d.toISOString(); };
const domainOf = u=>{try{return new URL(u).hostname.replace(/^www\./,"").toLowerCase();}catch{return"";}};
const hoursAgo = iso => (Date.now()-new Date(iso).getTime())/36e5;
const scoreItem = (url,p)=>10/Math.max(1,hoursAgo(p));
const dedupe = arr=>{const s=new Set();return arr.filter(x=>!s.has(x.url)&&s.add(x.url));};
const sortByDateDesc=(a,b)=>new Date(b.published)-new Date(a.published);
const isLogoPath = u => /logo|sprite|favicon|brand|og-image-default/i.test(u||"");

// ---------- Networking with retries ----------
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
      const ct = r.headers.get("content-type")||"";
      return { txt: await r.text(), ct };
    }catch(e){
      if(i===retries-1) throw e;
      await sleep(400*(i+1));
    }
  }
  throw new Error("unreachable");
}

// ---------- Parsers ----------
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

// ---------- Image enrichment for articles ----------
function extractImageFromHtml(html){
  const pick=re=>(html.match(re)||[])[1]||"";
  const cands=[
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i
  ];
  for (const re of cands){ const u=pick(re); if(u && !isLogoPath(u)) return u; }
  const imgs=[...html.matchAll(/<img\b[^>]*src=["']([^"']+)["']/gi)].map(m=>m[1]);
  const good=imgs.find(u=>u && !isLogoPath(u));
  return good||"";
}
async function enrichArticleImages(items, max = 60){
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

// ---------- Short pages ----------
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

// ---------- Topic test ----------
function onTopic(text){
  if (!text) return false;
  // exclude first: if any exclude hits, drop it
  if (RX_EXCLUDE.some(rx=>rx.test(text))) return false;
  // include: require at least one strict include keyword
  return RX_INCLUDE.some(rx=>rx.test(text));
}

// ---------- Build ----------
async function build(){
  let items=[];

  // 1) Publishers
  console.log("Publishers:");
  for(const f of FEEDS){
    try{
      const { txt } = await fetchText(f);
      const parsed  = parseRSS(txt);
      console.log(`  ✓ ${f}  -> ${parsed.length}`);
      items.push(...parsed);
      await sleep(150);
    }catch(e){ console.warn(`  ⚠ ${f}: ${e.message}`); }
  }

  // 2) YouTube — strict topic filtering on title + description
  console.log("YouTube:");
  for(const ch of YT_CHANNELS){
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`;
    try{
      const { txt } = await fetchText(url, { "accept-language":"en-US,en;q=0.8" }, 4);
      const all = parseYouTubeRSS(txt)
        .filter(v => (Date.now() - new Date(v.published).getTime()) <= RECENT_HOURS*3600*1000)
        .sort((a,b)=> new Date(b.published) - new Date(a.published));

      const chosen = [];
      for(const v of all){
        const blob = `${v.title} ${v.description}`.toLowerCase();
        if (onTopic(blob)) {
          chosen.push(v);
          if (chosen.length >= YT_MAX_PER_CHANNEL) break;
        }
      }
      console.log(`  ✓ ${ch} kept:${chosen.length} of ${all.length}`);
      items.push(...chosen);
      await sleep(150);
    }catch(e){ console.warn(`  ⚠ YT ${ch}: ${e.message}`); }
  }

  // Normalize
  items = items.map(x => x.type === "video" ? {
    title: x.title,
    url: x.url,
    publisher: x.publisher || "youtube.com",
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
    category: "Grid",
    published: safeISO(x.published),
    score: scoreItem(x.url, x.published),
    image: (x.image||"").trim(),
    type: "article"
  });

  // Dedupe + enrich images
  items = dedupe(items).sort(sortByDateDesc);
  await enrichArticleImages(items, 50);

  // Windows
  const recentMs = RECENT_HOURS * 3600 * 1000;
  const sevenMs  = 7 * 24 * 3600 * 1000;
  const recent = items.filter(x => (Date.now() - new Date(x.published).getTime()) <= recentMs).sort(sortByDateDesc);
  const week   = items.filter(x => (Date.now() - new Date(x.published).getTime()) <= sevenMs).sort(sortByDateDesc);

  // Shortlinks
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
  - data/news.json (${recent.length})
  - data/7d.json
  - s/<id>/index.html (${Object.keys(shortMap).length})
  - data/shortlinks.json`);
}

build().catch(e=>{ console.error("Build failed:", e); process.exit(1); });