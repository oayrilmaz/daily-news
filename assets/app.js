// ===========================================================
// PTD Today Builder — Articles + YouTube Videos (relaxed filter)
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

// ---------- Publisher feeds ----------
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

// ---------- YouTube channels ----------
const DEFAULT_YT_CHANNELS = [
  "UCupvZG-5ko_eiXAupbDfxWw", // CNN
  "UChqUTb7kYRX8-EiaN3XFrSQ", // Reuters
  "UCvJJ_dzjViJCoLf5uKUTwoA", // CNBC Television
  "UC16niRr50-MSBwiO3YDb3RA", // BBC News
  "UCx6h-dWzJ5NpAlja1YsApdg", // Fox Business
  "UCUMZ7gohGI9HcU9VNsr2FJQ", // Bloomberg Television
  "UCW6-BQWFA70DyycZ57JKias", // Wall Street Journal
  "UCo3TQcnm5KxV5eU2l3GKOAw"  // Financial Times
];
const YT_CHANNELS =
  (process.env.YT_CHANNELS?.split(",").map(s=>s.trim()).filter(Boolean))
  || DEFAULT_YT_CHANNELS;

const RECENT_HOURS = 48;               // show 2 days
const YT_MAX_PER_CHANNEL = 3;          // max 3 per channel
const CONCURRENCY = 6;

// ---------- helpers ----------
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
const clean = s=>(s||"").replace(/<!\[CDATA\[|\]\]>/g,"").trim();
const safeISO = x => { const d=new Date(x||Date.now()); return isNaN(d)?new Date().toISOString():d.toISOString(); };
const domainOf = u=>{try{return new URL(u).hostname.replace(/^www\./,"");}catch{return"";}};
const scoreItem = (url,p)=>10/Math.max(1,(Date.now()-new Date(p).getTime())/36e5);
const dedupe = arr=>{const s=new Set();return arr.filter(x=>!s.has(x.url)&&s.add(x.url));};
const sortByDateDesc=(a,b)=>new Date(b.published)-new Date(a.published);

// ---------- fetch ----------
async function fetchText(url){
  const r=await fetch(url,{headers:{"user-agent":"ptd-bot"}});
  if(!r.ok) throw new Error(r.status);
  return {txt:await r.text(), ct:r.headers.get("content-type")||""};
}

// ---------- RSS parsers ----------
function parseRSS(xml){
  const items=xml.match(/<item[\s\S]*?<\/item>/gi)||[];
  return items.map(b=>{
    const get=t=>(b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`,"i"))||[])[1]||"";
    return {
      title:clean(get("title")),
      url:clean(get("link"))||clean(get("guid")),
      published:safeISO(get("pubDate")),
      type:"article"
    };
  }).filter(x=>x.title&&x.url);
}
function parseYouTubeRSS(xml){
  const entries=xml.match(/<entry[\s\S]*?<\/entry>/gi)||[];
  return entries.map(e=>{
    const t=clean((e.match(/<title>([\s\S]*?)<\/title>/i)||[])[1]||"");
    const id=(e.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/i)||[])[1]||"";
    const pub=safeISO((e.match(/<published>([\s\S]*?)<\/published>/i)||[])[1]);
    const ch=clean((e.match(/<name>([\s\S]*?)<\/name>/i)||[])[1]||"");
    return {
      title:t,
      url:`https://www.youtube.com/watch?v=${id}`,
      published:pub,
      image:`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      type:"video",
      videoId:id,
      publisher:ch
    };
  }).filter(x=>x.title&&x.url);
}

// ---------- Short pages ----------
const shortIdFor=u=>crypto.createHash("sha1").update(u).digest("base64url").slice(0,10);
const gaHead=()=>`
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');</script>`;
const escapeHtml=s=>String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
function staticPage(it){
  const id=it.sid,url=`${SITE_ORIGIN}/s/${id}/`,img=it.image||`${SITE_ORIGIN}/assets/og-default.png`;
  return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${escapeHtml(it.title)} — PTD Today</title>${gaHead()}
<meta property=og:title content="${escapeHtml(it.title)}">
<meta property=og:image content="${escapeHtml(img)}">
<meta property=og:url content="${url}">
<link rel=stylesheet href="/assets/main.css"></head><body>
<div class=wrap><a href="/" class="btn linkish">← Back</a>
<h1>${escapeHtml(it.title)}</h1>
${it.type==="video"?`<iframe width="100%" height="315" src="https://www.youtube.com/embed/${escapeHtml(it.videoId)}" frameborder="0" allowfullscreen></iframe>`:
`<img src="${escapeHtml(img)}" style="width:100%;height:280px;object-fit:cover;border-radius:8px">`}
<p><a href="${escapeHtml(it.url)}" target=_blank>Original Source</a></p>
</div></body></html>`;
}

// ---------- build ----------
async function build(){
  let items=[];

  // publishers
  for(const f of FEEDS){
    try{
      const {txt}=await fetchText(f);
      items.push(...parseRSS(txt));
      await sleep(150);
    }catch(e){console.warn("Feed",f,e.message);}
  }

  // YouTube relaxed
  for(const ch of YT_CHANNELS){
    try{
      const {txt}=await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`);
      const vids=parseYouTubeRSS(txt)
        .filter(v=>Date.now()-new Date(v.published).getTime()<RECENT_HOURS*3600*1000)
        .slice(0,YT_MAX_PER_CHANNEL);
      items.push(...vids);
      console.log("YT",ch,"+",vids.length);
      await sleep(150);
    }catch(e){console.warn("YT",ch,e.message);}
  }

  items=dedupe(items).sort(sortByDateDesc);

  // short pages
  await fs.mkdir(OUT_SHORT,{recursive:true});
  await fs.mkdir(OUT_DATA,{recursive:true});
  const shortMap={};
  for(const it of items){
    const id=shortIdFor(it.url);
    it.sid=id;it.share=`/s/${id}/`;
    const dir=path.join(OUT_SHORT,id);
    await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,"index.html"),staticPage(it));
    shortMap[id]={url:it.url,title:it.title,image:it.image,type:it.type,videoId:it.videoId};
  }

  await fs.writeFile(NEWS_PATH,JSON.stringify(items,null,2));
  await fs.writeFile(WEEK_PATH,JSON.stringify({updated:new Date().toISOString(),items},null,2));
  await fs.writeFile(SHORT_MAP,JSON.stringify(shortMap,null,2));
  console.log("Done",items.length,"items total");
}

build().catch(e=>{console.error(e);process.exit(1);});