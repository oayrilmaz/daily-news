// ===========================================================
// PTD Today Builder — shortlinks + static OG pages + thumb scrape
// Adds GA4 tag to each generated /s/<id>/ page
// ===========================================================

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ROOT        = path.resolve(__dirname, "..");
const OUT_DATA    = path.join(ROOT, "data");
const OUT_SHORT   = path.join(ROOT, "s");
const NEWS_PATH   = path.join(OUT_DATA, "news.json");
const WEEK_PATH   = path.join(OUT_DATA, "7d.json");
const SHORT_MAP   = path.join(OUT_DATA, "shortlinks.json");

const SITE_ORIGIN = "https://ptdtoday.com";
const GA_ID = "G-TVKD1RLFE5";

// ---------- Feeds & limits ----------
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

const RECENT_HOURS = Number(process.env.RECENT_HOURS || 48);
const CONCURRENCY  = 6;
const MAX_ENRICH   = Number(process.env.MAX_ENRICH || 60);

// ---------- Helpers ----------
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const clean = (s="") => s.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
function safeISO(x){ const d=new Date(x||Date.now()); return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString(); }
function hoursAgo(iso){ const t=new Date(iso).getTime(); return (Date.now()-t)/36e5; }
function domainOf(url=""){ try{return new URL(url).hostname.replace(/^www\./,"").toLowerCase();}catch{return"";} }
function guessCategory(title="",url=""){ const s=(title+" "+url).toLowerCase();
  if(s.includes("hvdc"))return"HVDC";
  if(s.includes("substation"))return"Substations";
  if(s.includes("protection"))return"Protection";
  if(s.includes("cable"))return"Cables";
  if(s.includes("policy")||s.includes("ferc")||s.includes("commission"))return"Policy";
  if(s.includes("renewable")||s.includes("solar")||s.includes("wind"))return"Renewables";
  if(/\bai\b|machine learning|genai|llm/.test(s))return"AI";
  if(s.includes("data center")||s.includes("datacenter"))return"Data Centers";
  if(s.includes("transformer")||s.includes("switchgear")||s.includes("breaker")||s.includes("statcom"))return"Equipment";
  if(s.includes("transport")||s.includes("shipping")||s.includes("rail"))return"Transport";
  if(s.includes("lead time")||s.includes("supply chain")||s.includes("backlog"))return"Lead Times";
  if(s.includes("grid")||s.includes("transmission")||s.includes("distribution"))return"Grid";
  return"Grid";
}
function scoreItem(url,published){ const ageH=Math.max(1,hoursAgo(published)); return 10/ageH; }
function dedupeByUrl(items){ const seen=new Set(); return items.filter(x=>{const k=(x.url||"").trim(); if(!k||seen.has(k))return false; seen.add(k); return true;}); }
function clampWindow(items,ms){ const now=Date.now(); return items.filter(x=>{const t=new Date(x.published).getTime(); return t && t<=now && (now-t)<=ms;}); }
function sortByDateDesc(a,b){ return new Date(b.published)-new Date(a.published); }
const isLogoPath = u => /logo|sprite|favicon|brand|og-image-default/i.test(u||"");

// ---------- Fetch ----------
async function fetchText(url){
  const res = await fetch(url,{headers:{"user-agent":"ptd-bot/1.0 (+https://ptdtoday.com)"}});
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ct=res.headers.get("content-type")||""; const txt=await res.text(); return {txt,ct};
}

// ---------- Feed parsing ----------
function parseRSS(xml){ const rows=xml.match(/<item[\s\S]*?<\/item>/gi)||[];
  return rows.map(b=>{
    const get=tag=>(b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,"i"))||[])[1]||"";
    const title=clean(get("title"));
    const link =clean(get("link"))||clean(get("guid"));
    const pub  =get("pubDate")||get("updated")||get("date");
    const desc =get("description");
    const img  =desc.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]||"";
    return {title,url:link,published:safeISO(pub),image:img};
  }).filter(x=>x.title&&x.url);
}
function parseAtom(xml){ const entries=xml.match(/<entry[\s\S]*?<\/entry>/gi)||[];
  return entries.map(b=>{
    const get=tag=>(b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,"i"))||[])[1]||"";
    const title=clean(get("title"));
    let link=""; const linkTags=b.match(/<link\b[^>]*>/gi)||[];
    for(const lt of linkTags){ const rel=(lt.match(/\brel=["']([^"']+)["']/i)||[])[1]?.toLowerCase()||"alternate";
      const href=(lt.match(/\bhref=["']([^"']+)["']/i)||[])[1];
      if(href&&(rel==="alternate"||rel==="self")){ link=href; break; }
    }
    const pub=get("updated")||get("published")||"";
    const img=b.match(/<media:content[^>]*url=["']([^"']+)["']/i)?.[1]||"";
    return {title,url:link,published:safeISO(pub),image:img};
  }).filter(x=>x.title&&x.url);
}
function parseJSONFeed(txt){ let j; try{j=JSON.parse(txt);}catch{return[];}
  const arr=Array.isArray(j)?j:(j.items||[]);
  return arr.map(it=>{
    const title=String(it.title||"").trim();
    const url  =String(it.url||it.external_url||it.link||"").trim();
    const pub  =safeISO(it.date_published||it.published||it.date||it.updated);
    const image=it.image||it.banner_image||it.thumbnail||"";
    return {title,url,published:pub,image};
  }).filter(x=>x.title&&x.url);
}
function detectAndParse(body,ct=""){ const t=ct.toLowerCase();
  if(t.includes("json")||/^\s*{/.test(body))return parseJSONFeed(body);
  if(/<rss\b/i.test(body)||/<channel\b/i.test(body))return parseRSS(body);
  if(/<feed\b/i.test(body)||/<entry\b/i.test(body))return parseAtom(body);
  return parseRSS(body);
}

// ---------- Normalize ----------
function normalize(raw){
  const title=(raw.title||"").trim();
  const url  =(raw.url||"").trim();
  const published=safeISO(raw.published);
  const publisher=domainOf(url);
  const category =guessCategory(title,url);
  const image=(raw.image||"").trim();
  const score=scoreItem(url,published);
  return {title,url,publisher,category,published,score,image};
}

// ---------- OG image scraper ----------
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
  for(const re of cands){ const u=pick(re); if(u && !isLogoPath(u)) return u; }
  const imgs=[...html.matchAll(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]);
  const good=imgs.find(u=>u && !isLogoPath(u)); return good||"";
}
async function enrichImages(items){
  const targets=items.filter(x=>!x.image).slice(0,MAX_ENRICH);
  const q=[...targets];
  async function worker(){
    while(q.length){
      const it=q.shift();
      try{ const {txt}=await fetchText(it.url); const cand=extractImageFromHtml(txt); if(cand) it.image=cand; }catch{}
      await sleep(120);
    }
  }
  await Promise.all(Array.from({length:CONCURRENCY},worker));
  return items;
}

// ---------- Shortlink static page ----------
function shortIdFor(url){ return crypto.createHash("sha1").update(url).digest("base64url").slice(0,10); }
function gaHead(){
  return `
  <!-- Google Analytics 4 -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){ dataLayer.push(arguments); }
    gtag('js', new Date());
    gtag('config', '${GA_ID}');
  </script>
  <!-- End GA -->`;
}
function escapeHtml(s=""){ return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"); }

function staticSharePage({ id, title, image, sourceUrl, publisher, category, publishedISO }){
  const shareUrl = `${SITE_ORIGIN}/s/${id}/`;
  const desc = "First to Know. First to Lead.";
  const img  = image || `${SITE_ORIGIN}/assets/og-default.png`;
  const dt   = publishedISO ? new Date(publishedISO).toISOString().replace('T',' ').replace(/:\d\d\.\d{3}Z$/,'Z').replace(/:\d\dZ$/,'Z') : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — PTD Today</title>
${gaHead()}
<meta name="description" content="${desc}">
<link rel="canonical" href="${shareUrl}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="PTD Today">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${escapeHtml(img)}">
<meta property="og:url" content="${shareUrl}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${escapeHtml(img)}">
<link rel="stylesheet" href="/assets/main.css">
<style>.wrap{max-width:820px;margin:34px auto;padding:0 16px}.hero{width:100%;height:280px;object-fit:cover;border-radius:8px;border:1px solid #d9ccb3;background:#f2eadc}.meta{color:#6f675d;font-size:13px;margin:6px 0 12px}</style>
</head>
<body>
<div class="wrap">
  <a href="/" class="btn linkish">← Back to PTD Today</a>
  <h1 style="margin:10px 0 6px;">${escapeHtml(title)}</h1>
  <div class="meta">${escapeHtml((category||'').toUpperCase())} • ${escapeHtml(publisher||'')} • ${escapeHtml(dt)}</div>
  <img class="hero" src="${escapeHtml(img)}" alt="">
  <div class="cta-row" style="margin-top:14px;">
    <a class="btn" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">Open Article</a>
    <a class="btn secondary" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">Source</a>
    <button class="btn linkish" onclick="share()">Share</button>
  </div>
  <p style="margin-top:14px;color:#6f675d;">You’re on PTD Today. Click <strong>Source</strong> to visit the original publisher.</p>
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

// ---------- Build ----------
async function build(){
  console.log("PTD build: fetching feeds…");
  let fetched=[];
  for(const f of FEEDS){
    try{ const {txt,ct}=await fetchText(f); const items=detectAndParse(txt,ct);
      console.log(`  ✓ ${f} (${items.length})`); fetched=fetched.concat(items); await sleep(200);
    }catch(e){ console.warn(`  ⚠ ${f}: ${e.message}`); }
  }

  let norm = dedupeByUrl(fetched.map(normalize));
  await enrichImages(norm);

  const recentMs = RECENT_HOURS * 3600 * 1000;
  const sevenMs  = 7 * 24 * 3600 * 1000;
  let news = clampWindow(norm, recentMs).sort(sortByDateDesc);
  let week = clampWindow(norm, sevenMs).sort(sortByDateDesc);

  await fs.mkdir(OUT_DATA,{recursive:true});
  await fs.mkdir(OUT_SHORT,{recursive:true});

  const shortMap={};
  for(const it of news){
    const id=shortIdFor(it.url);
    const dir=path.join(OUT_SHORT,id);
    await fs.mkdir(dir,{recursive:true});
    const page=staticSharePage({
      id, title:it.title, image:it.image, sourceUrl:it.url,
      publisher:it.publisher, category:it.category, publishedISO:it.published
    });
    await fs.writeFile(path.join(dir,"index.html"),page);
    shortMap[id]={ url:it.url, title:it.title, image:it.image, publisher:it.publisher, category:it.category, published:it.published };
    it.share=`/s/${id}/`; it.sid=id;
  }

  await fs.writeFile(NEWS_PATH, JSON.stringify(news,null,2));
  await fs.writeFile(WEEK_PATH, JSON.stringify({updated:new Date().toISOString(), items:week},null,2));
  await fs.writeFile(SHORT_MAP, JSON.stringify(shortMap,null,2));

  console.log(`Wrote data/news.json (${news.length}), data/7d.json, s/<id>/ pages, and shortlinks.json.`);
}

build().catch(e=>{ console.error("Build failed:", e); process.exit(1); });