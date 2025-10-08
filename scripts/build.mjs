// scripts/build.mjs
// PTD Today — Rolling 7-day archive builder (Node 20+; no external deps)
//
// Key difference from the basic version:
// - Reads existing data/7d.json and data/news.json (if present)
// - Merges newly fetched items with stored ones
// - Trims to a true rolling 7 days so Top (7d) is always a full week
//
// Usage:
//   node scripts/build.mjs
//
// In GitHub Actions:
//   - uses: actions/setup-node@v4
//     with: { node-version: "20" }
//   - run: node scripts/build.mjs
//
// Optional ENV:
//   FEEDS        -> comma-separated feed URLs (override defaults)
//   RECENT_HOURS -> default 72
//   TOP7D_LIMIT  -> default 250 (enough for a busy week)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ---------------------- Config ---------------------- */

const DEFAULT_FEEDS = [
  'https://www.utilitydive.com/feeds/news/',
  'https://www.datacenterdynamics.com/en/rss/',
  // Add more to increase coverage:
  // 'https://www.pv-magazine.com/feed/',
  // 'https://www.offshorewind.biz/feed/',
  // 'https://www.rechargenews.com/rss/',
  // 'https://www.ferc.gov/rss.xml',
  // 'https://feeds.arstechnica.com/arstechnica/technology-lab'
];
const FEEDS = (process.env.FEEDS?.split(',').map(s => s.trim()).filter(Boolean)) || DEFAULT_FEEDS;

const DOMAIN_WEIGHT = {
  'utilitydive.com': 1.00,
  'datacenterdynamics.com': 0.90,
  // Add more domains & weights as you like
};

const RECENT_HOURS = Number(process.env.RECENT_HOURS || 72);   // for data/news.json
const TOP7D_LIMIT  = Number(process.env.TOP7D_LIMIT  || 250);  // generous cap for week

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const OUT_DIR    = path.resolve(__dirname, '../data');
const NEWS_PATH  = path.join(OUT_DIR, 'news.json');
const TOP7_PATH  = path.join(OUT_DIR, '7d.json');

/* ---------------------- Helpers ---------------------- */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./,'').toLowerCase(); }
  catch { return ''; }
}

function safeISO(x) {
  const d = new Date(x || Date.now());
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function hoursAgo(iso) {
  const t = new Date(iso).getTime();
  return (Date.now() - t) / 36e5;
}

function sevenDaysAgoISO() {
  return new Date(Date.now() - 7*24*3600*1000).toISOString();
}

function guessCategory(title = '', url = '') {
  const s = (title + ' ' + url).toLowerCase();
  if (s.includes('hvdc')) return 'HVDC';
  if (s.includes('substation')) return 'Substations';
  if (s.includes('protection')) return 'Protection';
  if (s.includes('cable')) return 'Cables';
  if (s.includes('policy') || s.includes('regulat')) return 'Policy';
  if (s.includes('data center') || s.includes('datacenter')) return 'Data Centers';
  if (s.includes('ai') || s.includes('machine learning') || s.includes('genai')) return 'AI';
  if (s.includes('renewable') || s.includes('solar') || s.includes('wind')) return 'Renewables';
  if (s.includes('transport') || s.includes('transit') || s.includes('rail') || s.includes('shipping')) return 'Transport';
  if (s.includes('transformer') || s.includes('switchgear') || s.includes('breaker') || s.includes('equipment') || s.includes('statcom')) return 'Equipment';
  if (s.includes('lead time') || s.includes('supply chain') || s.includes('backlog') || s.includes('delivery time') || s.includes('order book')) return 'Lead Times';
  if (s.includes('grid') || s.includes('transmission') || s.includes('distribution')) return 'Grid';
  return 'Grid';
}

function scoreItem(url, publishedISO) {
  const d  = domainOf(url);
  const w  = DOMAIN_WEIGHT[d] ?? 0.5;
  const ah = Math.max(1, hoursAgo(publishedISO));
  return (w / ah) * 10;
}

/* ---------------------- Parsers ---------------------- */

function parseRSS(xml) {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return items.map(b => {
    const get = tag => (b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))||[])[1]?.trim() || '';
    const cd  = s => s.replace(/<!\[CDATA\[|\]\]>/g,'').trim();
    const title = cd(get('title'));
    let link = cd(get('link')); if (!link) link = cd(get('guid'));
    const pub  = get('pubDate') || get('updated') || get('date') || '';
    const desc = cd(get('description'));
    const imgMatch = desc.match(/<img[^>]*src=["']([^"']+)["']/i);
    const image = imgMatch?.[1] || '';
    return { title, url: link, published: safeISO(pub), image };
  }).filter(x => x.title && x.url);
}

function parseAtom(xml) {
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  return entries.map(b => {
    const get = tag => (b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))||[])[1]?.trim() || '';
    const cd  = s => s.replace(/<!\[CDATA\[|\]\]>/g,'').trim();
    const title = cd(get('title'));
    let link = '';
    const linkTags = b.match(/<link\b[^>]*>/gi) || [];
    for (const lt of linkTags) {
      const rel  = (lt.match(/\brel=["']([^"']+)["']/i)||[])[1]?.toLowerCase() || 'alternate';
      const href = (lt.match(/\bhref=["']([^"']+)["']/i)||[])[1];
      if (href && (rel === 'alternate' || rel === 'self')) { link = href; break; }
    }
    const pub = get('updated') || get('published') || '';
    const imgMatch = b.match(/<media:content[^>]*url=["']([^"']+)["']/i) || b.match(/<img[^>]*src=["']([^"']+)["']/i);
    const image = imgMatch?.[1] || '';
    return { title, url: link, published: safeISO(pub), image };
  }).filter(x => x.title && x.url);
}

function parseJSONFeed(jsonText) {
  let j; try { j = JSON.parse(jsonText); } catch { return []; }
  const items = Array.isArray(j) ? j : (j.items || []);
  return items.map(it => {
    const title = String(it.title || '').trim();
    const url   = String(it.url || it.external_url || it.link || '').trim();
    const pub   = safeISO(it.date_published || it.published || it.date || it.updated);
    const image = it.image || it.banner_image || it.thumbnail || '';
    return { title, url, published: pub, image };
  }).filter(x => x.title && x.url);
}

function detectAndParse(body, contentType = '') {
  const ct = contentType.toLowerCase();
  if (ct.includes('application/json') || ct.includes('json')) return parseJSONFeed(body);
  if (/<rss\b/i.test(body) || /<channel\b/i.test(body)) return parseRSS(body);
  if (/<feed\b/i.test(body) || /<entry\b/i.test(body))   return parseAtom(body);
  return parseRSS(body);
}

/* ---------------------- Fetch & Build ---------------------- */

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'ptd-bot/1.0 (+https://ptdtoday.com)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ct  = res.headers.get('content-type') || '';
  const txt = await res.text();
  return { txt, ct };
}

function normalize(raw) {
  const title = (raw.title || '').trim();
  const url   = (raw.url || '').trim();
  const published = safeISO(raw.published);
  const publisher = domainOf(url);
  const image = (raw.image || '').trim();
  return {
    title, url, publisher,
    category: guessCategory(title, url),
    published,
    score: scoreItem(url, published),
    image
  };
}

async function readJSONIfExists(p) {
  try { const s = await fs.readFile(p, 'utf8'); return JSON.parse(s); }
  catch { return null; }
}

function toItemsArray(maybe) {
  if (!maybe) return [];
  if (Array.isArray(maybe)) return maybe;
  if (Array.isArray(maybe.items)) return maybe.items;
  return [];
}

function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter(x=>{
    const key = (x.url || '').trim();
    if(!key) return false;
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clampToWindow(items, msWindow) {
  const now = Date.now();
  return items.filter(x => {
    const t = new Date(x.published).getTime();
    return !Number.isNaN(t) && (now - t) <= msWindow && t <= now;
  });
}

function sortByScoreThenDateDesc(a, b) {
  const s = (b.score ?? 0) - (a.score ?? 0);
  if (s !== 0) return s;
  return new Date(b.published) - new Date(a.published);
}

async function main() {
  console.log('PTD build: fetching feeds…');

  // 1) Fetch fresh items from feeds
  let fetched = [];
  for (const feed of FEEDS) {
    try {
      const { txt, ct } = await fetchText(feed);
      const parsed = detectAndParse(txt, ct);
      console.log(`  ✓ ${feed}  (${parsed.length} items)`);
      fetched = fetched.concat(parsed);
      await sleep(400); // be polite
    } catch (err) {
      console.warn(`  ⚠ feed error: ${feed} -> ${err.message}`);
    }
  }
  let freshNorm = fetched.map(normalize);

  // 2) Load existing archives (if any)
  const prevNewsRaw = await readJSONIfExists(NEWS_PATH);
  const prevTopRaw  = await readJSONIfExists(TOP7_PATH);

  const prevNews = toItemsArray(prevNewsRaw);
  const prevTop  = toItemsArray(prevTopRaw);

  // 3) Normalize prev items (ensure same shape)
  const prevNewsNorm = prevNews.map(normalize);
  const prevTopNorm  = prevTop.map(normalize);

  // 4) Build news.json = freshNorm within RECENT_HOURS (72h)
  const newsWindowMs = RECENT_HOURS * 3600 * 1000;
  let newsMerged = dedupeByUrl([ ...freshNorm ]);
  newsMerged = clampToWindow(newsMerged, newsWindowMs)
    .sort((a,b)=> new Date(b.published) - new Date(a.published));

  // 5) Build rolling 7d.json = (prevTopNorm ∪ prevNewsNorm ∪ freshNorm), last 7 days
  const sevenWindowMs = 7 * 24 * 3600 * 1000;
  let pool = [
    ...freshNorm,
    ...prevNewsNorm,   // bring forward anything recent that might roll out of feeds
    ...prevTopNorm     // keep the last runs so we retain items from early week
  ];

  // Deduplicate, clamp to 7d, score-sort, cap
  pool = dedupeByUrl(pool);
  pool = clampToWindow(pool, sevenWindowMs);
  pool.sort(sortByScoreThenDateDesc);
  if (pool.length > TOP7D_LIMIT) pool = pool.slice(0, TOP7D_LIMIT);

  // 6) Write files
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(NEWS_PATH, JSON.stringify(newsMerged, null, 2));
  await fs.writeFile(TOP7_PATH, JSON.stringify({ updated: new Date().toISOString(), items: pool }, null, 2));

  console.log(`Wrote:
  - ${path.relative(process.cwd(), NEWS_PATH)} (${newsMerged.length} items)
  - ${path.relative(process.cwd(), TOP7_PATH)} (${pool.length} items)
Done.`);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});