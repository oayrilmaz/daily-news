// ===========================================================
// PTD Today Builder — with OG image scraping (Node 20+, no deps)
// ===========================================================
//
// Outputs:
//   - /data/news.json  → last 48 hours (used by the no-filter UI)
//   - /data/7d.json    → last 7 days (kept for archive; optional)
//
// Thumbnails:
//   - If an item has no image, we fetch the article HTML and try:
//       og:image → twitter:image → link[rel=image_src]
//   - If still missing, the front-end falls back to site favicon.
//
// Run locally:   node scripts/build.mjs
// In Actions:    node-version: 20, then run this script.
//
// Env (optional):
//   FEEDS           comma-separated list of feed URLs (overrides defaults)
//   RECENT_HOURS    default 48 (today+yesterday)
//   MAX_ENRICH      default 40 (cap how many articles we scrape per run)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------- Config ----------
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
const MAX_ENRICH = Number(process.env.MAX_ENRICH || 40);  // don’t hammer sources
const CONCURRENCY = 5;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const OUT_DIR    = path.resolve(__dirname, "../data");
const NEWS_PATH  = path.join(OUT_DIR, "news.json");
const TOP7_PATH  = path.join(OUT_DIR, "7d.json");

// ---------- Helpers ----------
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));

function safeISO(x) {
  const d = new Date(x || Date.now());
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
function hoursAgo(iso) {
  const t = new Date(iso).getTime();
  return (Date.now() - t)/36e5;
}
function domainOf(url="") {
  try { return new URL(url).hostname.replace(/^www\./,"").toLowerCase(); }
  catch { return ""; }
}
function guessCategory(title="", url="") {
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
function scoreItem(url, published) {
  const ageH = Math.max(1, hoursAgo(published));
  return 10/ageH; // simple freshness score
}
function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter(x=>{
    const k=(x.url||"").trim(); if(!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
}
function clampWindow(items, ms) {
  const now = Date.now();
  return items.filter(x=>{
    const t = new Date(x.published).getTime();
    return t && t<=now && (now - t) <= ms;
  });
}
function sortByDateDesc(a,b){ return new Date(b.published) - new Date(a.published); }

// ---------- Feed parsing ----------
function clean(s=""){ return s.replace(/<!\[CDATA\[|\]\]>/g,"").trim(); }

function parseRSS(xml) {
  const rows = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return rows.map(b=>{
    const get = tag => (b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))||[])[1] || "";
    const title = clean(get("title"));
    const link  = clean(get("link")) || clean(get("guid"));
    const pub   = get("pubDate") || get("updated") || get("date");
    const desc  = get("description");
    const img   = desc.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || "";
    return { title, url: link, published: safeISO(pub), image: img };
  }).filter(x=>x.title && x.url);
}
function parseAtom(xml) {
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  return entries.map(b=>{
    const get = tag => (b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))||[])[1] || "";
    const title = clean(get("title"));
    let link = "";
    const linkTags = b.match(/<link\b[^>]*>/gi) || [];
    for (const lt of linkTags) {
      const rel  = (lt.match(/\brel=["']([^"']+)["']/i)||[])[1]?.toLowerCase() || "alternate";
      const href = (lt.match(/\bhref=["']([^"']+)["']/i)||[])[1];
      if (href && (rel==="alternate" || rel==="self")) { link = href; break; }
    }
    const pub = get("updated") || get("published") || "";
    const img = b.match(/<media:content[^>]*url=["']([^"']+)["']/i)?.[1] || "";
    return { title, url: link, published: safeISO(pub), image: img };
  }).filter(x=>x.title && x.url);
}
function parseJSONFeed(txt) {
  let j; try { j=JSON.parse(txt); } catch { return []; }
  const arr = Array.isArray(j) ? j : (j.items || []);
  return arr.map(it=>{
    const title = String(it.title||"").trim();
    const url   = String(it.url || it.external_url || it.link || "").trim();
    const pub   = safeISO(it.date_published || it.published || it.date || it.updated);
    const image = it.image || it.banner_image || it.thumbnail || "";
    return { title, url, published: pub, image };
  }).filter(x=>x.title && x.url);
}
function detectAndParse(body, ct="") {
  const contentType = ct.toLowerCase();
  if (contentType.includes("json") || /^\s*{/.test(body)) return parseJSONFeed(body);
  if (/<rss\b/i.test(body) || /<channel\b/i.test(body)) return parseRSS(body);
  if (/<feed\b/i.test(body) || /<entry\b/i.test(body))   return parseAtom(body);
  return parseRSS(body);
}

// ---------- Network ----------
async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "user-agent":"ptd-bot/1.0 (+https://ptdtoday.com)" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ct  = res.headers.get("content-type") || "";
  const txt = await res.text();
  return { txt, ct };
}

function normalize(raw) {
  const title = (raw.title || "").trim();
  const url   = (raw.url || "").trim();
  const published = safeISO(raw.published);
  const publisher = domainOf(url);
  const category  = guessCategory(title, url);
  const image     = (raw.image || "").trim();
  const score     = scoreItem(url, published);
  return { title, url, publisher, category, published, score, image };
}

// ---------- OG image enrichment ----------
function extractOgImage(html) {
  const get = (re) => (html.match(re)||[])[1] || "";
  // Prefer og:image, then twitter:image, then image_src
  return (
    get(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    get(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
    get(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i)
  );
}
async function enrichImages(items) {
  const targets = items.filter(x => !x.image).slice(0, MAX_ENRICH);
  const q = [...targets];
  async function worker() {
    while (q.length) {
      const it = q.shift();
      try {
        const { txt } = await fetchText(it.url);
        const og = extractOgImage(txt);
        if (og) it.image = og;
      } catch {}
      await sleep(150);
    }
  }
  const workers = Array.from({length: CONCURRENCY}, worker);
  await Promise.all(workers);
  return items;
}

// ---------- Build ----------
async function build() {
  console.log("PTD build: fetching feeds…");
  let fetched = [];
  for (const feed of FEEDS) {
    try {
      const { txt, ct } = await fetchText(feed);
      const items = detectAndParse(txt, ct);
      console.log(`  ✓ ${feed} (${items.length})`);
      fetched = fetched.concat(items);
      await sleep(250);
    } catch (e) {
      console.warn(`  ⚠ ${feed}: ${e.message}`);
    }
  }

  let norm = dedupeByUrl(fetched.map(normalize));
  // Enrich missing thumbnails
  await enrichImages(norm);

  // Windows
  const recentMs = RECENT_HOURS * 3600 * 1000;
  const sevenMs  = 7 * 24 * 3600 * 1000;

  let news = clampWindow(norm, recentMs).sort(sortByDateDesc);
  let week = clampWindow(norm, sevenMs).sort(sortByDateDesc);

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(NEWS_PATH, JSON.stringify(news, null, 2));
  await fs.writeFile(TOP7_PATH, JSON.stringify({ updated: new Date().toISOString(), items: week }, null, 2));

  console.log(`Wrote:
  - ${path.relative(process.cwd(), NEWS_PATH)} (${news.length} items, ${RECENT_HOURS}h)
  - ${path.relative(process.cwd(), TOP7_PATH)} (${week.length} items, 7d)
Done.`);
}

build().catch(e=>{ console.error("Build failed:", e); process.exit(1); });