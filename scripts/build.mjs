// scripts/build.mjs
// PTD Today feed builder (Node 20+). No external deps required.
//
// What it does
// 1) Fetches a list of RSS/Atom feeds
// 2) Parses items (RSS <item>, Atom <entry>; also tolerates JSON Feed)
// 3) Normalizes fields (title, url, publisher, category, published, score, image)
// 4) Scores by freshness × domain weight
// 5) Dedupes
// 6) Writes: data/news.json (last 72h, date-desc) and data/7d.json (top by score)
//
// Usage locally:
//   node scripts/build.mjs
//
// In GitHub Actions (example):
//   - uses: actions/setup-node@v4
//     with: { node-version: "20" }
//   - run: node scripts/build.mjs
//
// Optional ENV overrides:
//   FEEDS        -> comma-separated list of feed URLs
//   RECENT_HOURS -> default 72
//   TOP7D_LIMIT  -> default 60

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ---------------------- Config ---------------------- */

// Default feeds (add/remove as you wish)
const DEFAULT_FEEDS = [
  'https://www.utilitydive.com/feeds/news/',
  'https://www.datacenterdynamics.com/en/rss/',
  // Add more reputable sources as needed:
  // 'https://www.tdworld.com/rss',           // if available
  // 'https://www.greentechmedia.com/rss',    // example (defunct now)
  // 'https://feeds.arstechnica.com/arstechnica/technology-lab',
];

// Allow override via env FEEDS (comma-separated)
const FEEDS = (process.env.FEEDS?.split(',').map(s => s.trim()).filter(Boolean)) || DEFAULT_FEEDS;

// Domain authority weights (tune freely)
const DOMAIN_WEIGHT = {
  'utilitydive.com': 1.00,
  'datacenterdynamics.com': 0.90,
  // add more domains and weights here
};

// Time & sizing
const RECENT_HOURS = Number(process.env.RECENT_HOURS || 72);
const TOP7D_LIMIT  = Number(process.env.TOP7D_LIMIT  || 60);

// Output paths
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const OUT_DIR    = path.resolve(__dirname, '../data');
const NEWS_PATH  = path.join(OUT_DIR, 'news.json');
const TOP7_PATH  = path.join(OUT_DIR, '7d.json');

/* ---------------------- Helpers ---------------------- */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; }
}

function safeISO(x) {
  const d = new Date(x || Date.now());
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function hoursAgo(iso) {
  const t = new Date(iso).getTime();
  return (Date.now() - t) / 36e5;
}

function guessCategory(title = '', url = '') {
  const s = (title + ' ' + url).toLowerCase();
  if (s.includes('hvdc')) return 'HVDC';
  if (s.includes('substation')) return 'Substations';
  if (s.includes('protection')) return 'Protection';
  if (s.includes('cable')) return 'Cables';
  if (s.includes('policy') || s.includes('regulat')) return 'Policy';
  if (s.includes('data center') || s.includes('datacenter') || s.includes('ai')) return 'Data Centers';
  if (s.includes('renewable') || s.includes('solar') || s.includes('wind')) return 'Renewables';
  if (s.includes('grid') || s.includes('transmission') || s.includes('distribution')) return 'Grid';
  return 'Grid';
}

function scoreItem(url, publishedISO) {
  const d  = domainOf(url);
  const w  = DOMAIN_WEIGHT[d] ?? 0.5;
  const ah = Math.max(1, hoursAgo(publishedISO));
  // Simple & stable: freshness × domain trust
  return (w / ah) * 10;
}

/* ---------------------- Parsers ---------------------- */

// Very small RSS <item> parser
function parseRSS(xml) {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return items.map(b => {
    const get = tag => (b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))||[])[1]?.trim() || '';
    const cd  = s => s.replace(/<!\[CDATA\[|\]\]>/g,'').trim();
    const title = cd(get('title'));
    let link = cd(get('link'));
    if (!link) link = cd(get('guid'));
    const pub  = get('pubDate') || get('updated') || get('date') || '';
    const desc = cd(get('description'));
    // crude image extraction from description
    const imgMatch = desc.match(/<img[^>]*src=["']([^"']+)["']/i);
    const image = imgMatch?.[1] || '';
    return { title, url: link, published: safeISO(pub), image };
  }).filter(x => x.title && x.url);
}

// Very small Atom <entry> parser
function parseAtom(xml) {
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  return entries.map(b => {
    const get = tag => (b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))||[])[1]?.trim() || '';
    const cd  = s => s.replace(/<!\[CDATA\[|\]\]>/g,'').trim();
    const title = cd(get('title'));
    let link = '';
    // prefer <link rel="alternate" href="...">, else any link with href
    const linkTags = b.match(/<link\b[^>]*>/gi) || [];
    for (const lt of linkTags) {
      const rel  = (lt.match(/\brel=["']([^"']+)["']/i)||[])[1]?.toLowerCase() || 'alternate';
      const href = (lt.match(/\bhref=["']([^"']+)["']/i)||[])[1];
      if (href && (rel === 'alternate' || rel === 'self')) { link = href; break; }
    }
    const pub = get('updated') || get('published') || '';
    // simple image guess from media tags
    const imgMatch = b.match(/<media:content[^>]*url=["']([^"']+)["']/i) || b.match(/<img[^>]*src=["']([^"']+)["']/i);
    const image = imgMatch?.[1] || '';
    return { title, url: link, published: safeISO(pub), image };
  }).filter(x => x.title && x.url);
}

// JSON Feed (https://jsonfeed.org/) tolerance
function parseJSONFeed(jsonText) {
  let j;
  try { j = JSON.parse(jsonText); } catch { return []; }
  const items = Array.isArray(j) ? j : (j.items || []);
  return items.map(it => {
    const title = String(it.title || '').trim();
    const url   = String(it.url || it.external_url || it.link || '').trim();
    const pub   = safeISO(it.date_published || it.published || it.date || it.updated);
    // try common fields for image
    const image = it.image || it.banner_image || it.thumbnail || '';
    return { title, url, published: pub, image };
  }).filter(x => x.title && x.url);
}

function detectAndParse(body, contentType = '') {
  const ct = contentType.toLowerCase();
  if (ct.includes('application/json') || ct.includes('json')) return parseJSONFeed(body);
  if (/<rss\b/i.test(body) || /<channel\b/i.test(body)) return parseRSS(body);
  if (/<feed\b/i.test(body) || /<entry\b/i.test(body))   return parseAtom(body);
  // fallback to RSS parser
  return parseRSS(body);
}

/* ---------------------- Fetch & Build ---------------------- */

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'ptd-bot/1.0 (+https://ptdtoday.com)' }
  });
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
    title,
    url,
    publisher,
    category: guessCategory(title, url),
    published,
    score: scoreItem(url, published),
    image // may be empty; frontend shows placeholder if missing
  };
}

async function main() {
  console.log('PTD build: fetching feeds...');
  let all = [];

  for (const feed of FEEDS) {
    try {
      const { txt, ct } = await fetchText(feed);
      const parsed = detectAndParse(txt, ct);
      console.log(`  ✓ ${feed}  (${parsed.length} items)`);
      all = all.concat(parsed);
      // polite delay to avoid feed throttling
      await sleep(400);
    } catch (err) {
      console.warn(`  ⚠ feed error: ${feed} -> ${err.message}`);
    }
  }

  if (all.length === 0) {
    console.warn('No items fetched. Writing empty-but-valid files to keep site stable.');
  }

  // Normalize + dedupe
  const seen = new Set();
  const normalized = all
    .map(normalize)
    .filter(x => {
      if (!x.title || !x.url) return false;
      const key = `${x.title}|${x.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  // Outputs
  const now = Date.now();

  const news = normalized
    .filter(x => (now - new Date(x.published).getTime()) < RECENT_HOURS * 3600 * 1000)
    .sort((a,b) => new Date(b.published) - new Date(a.published));

  const top7d = normalized
    .filter(x => (now - new Date(x.published).getTime()) < 7 * 24 * 3600 * 1000)
    .sort((a,b) => (b.score - a.score) || (new Date(b.published) - new Date(a.published)))
    .slice(0, TOP7D_LIMIT);

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(NEWS_PATH, JSON.stringify(news, null, 2));
  await fs.writeFile(TOP7_PATH, JSON.stringify({ updated: new Date().toISOString(), items: top7d }, null, 2));

  console.log(`Wrote:
  - ${path.relative(process.cwd(), NEWS_PATH)} (${news.length} items)
  - ${path.relative(process.cwd(), TOP7_PATH)} (${top7d.length} items)
Done.`);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
