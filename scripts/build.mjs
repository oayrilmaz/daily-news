// ===========================================================
// PTD Today Builder — Rolling 7-Day Archive Version
// ===========================================================
//
// This script:
// 1. Fetches multiple RSS/Atom/JSON feeds.
// 2. Normalizes & merges new items with existing /data/7d.json.
// 3. Keeps a rolling 7 days of news (so even old items remain visible).
// 4. Saves:
//      - /data/news.json → past 72 hours only
//      - /data/7d.json   → full rolling 7 days
//
// Run manually: node scripts/build.mjs
// Auto via GitHub Actions: every 3 hours
//
// Node 20+ (no external dependencies)

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");
const NEWS_PATH = path.join(DATA_DIR, "news.json");
const WEEK_PATH = path.join(DATA_DIR, "7d.json");

const FEEDS = [
  "https://www.utilitydive.com/feeds/news/",
  "https://www.datacenterdynamics.com/en/rss/",
  "https://www.pv-magazine.com/feed/",
  "https://www.offshorewind.biz/feed/",
  "https://www.rechargenews.com/rss/",
  "https://www.ferc.gov/rss.xml",
  "https://feeds.arstechnica.com/arstechnica/technology-lab",
  "https://www.energy.gov/rss",
  "https://www.greentechmedia.com/rss",
];

const HRS_72 = 72 * 3600 * 1000;
const HRS_7D = 7 * 24 * 3600 * 1000;

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s = "") => s.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
const safeISO = (x) => {
  const d = new Date(x || Date.now());
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
};

function domainOf(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function guessCategory(title = "", url = "") {
  const s = (title + " " + url).toLowerCase();
  if (s.includes("hvdc")) return "HVDC";
  if (s.includes("substation")) return "Substations";
  if (s.includes("protection")) return "Protection";
  if (s.includes("cable")) return "Cables";
  if (s.includes("policy") || s.includes("ferc")) return "Policy";
  if (s.includes("renewable") || s.includes("solar") || s.includes("wind"))
    return "Renewables";
  if (s.includes("ai") || s.includes("machine learning")) return "AI";
  if (s.includes("data center") || s.includes("datacenter"))
    return "Data Centers";
  if (s.includes("transport") || s.includes("shipping")) return "Transport";
  if (s.includes("transformer") || s.includes("switchgear"))
    return "Equipment";
  if (s.includes("lead time") || s.includes("supply chain"))
    return "Lead Times";
  if (s.includes("grid") || s.includes("transmission")) return "Grid";
  return "Grid";
}

function scoreItem(url, published) {
  const ageHrs = (Date.now() - new Date(published).getTime()) / 36e5;
  return Math.max(0, 10 - ageHrs / 12); // simple recency score
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((x) => {
    const key = x.url?.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clampWindow(items, ms) {
  const now = Date.now();
  return items.filter((x) => {
    const t = new Date(x.published).getTime();
    return t && now - t <= ms && t <= now;
  });
}

function normalize(raw) {
  const title = clean(raw.title || "");
  const url = raw.url || raw.link || "";
  const published = safeISO(raw.published || raw.pubDate);
  const publisher = domainOf(url);
  const category = guessCategory(title, url);
  const image =
    raw.image ||
    raw.image_url ||
    (raw.description?.match(/<img[^>]*src=["']([^"']+)["']/i)?.[1] || "");
  const score = scoreItem(url, published);
  return { title, url, publisher, category, published, score, image };
}

// -----------------------------------------------------------
// Feed Parsing (RSS/Atom/JSON)
// -----------------------------------------------------------

function parseFeed(text, url = "") {
  if (/^\s*{/.test(text)) {
    try {
      const j = JSON.parse(text);
      const arr = Array.isArray(j) ? j : j.items || [];
      return arr.map(normalize);
    } catch {
      return [];
    }
  }

  const items = text.match(/<item[\s\S]*?<\/item>/gi) || [];
  return items.map((b) => {
    const get = (tag) =>
      (b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")) ||
        [])[1] || "";
    const title = clean(get("title"));
    const link = clean(get("link")) || clean(get("guid"));
    const pub = get("pubDate") || get("date") || get("updated");
    const desc = get("description");
    const img =
      desc.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || "";
    return normalize({ title, url: link, published: pub, image: img });
  });
}

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed);
    const txt = await res.text();
    return parseFeed(txt, feed);
  } catch (e) {
    console.warn("⚠️ Feed error:", feed, e.message);
    return [];
  }
}

// -----------------------------------------------------------
// Build
// -----------------------------------------------------------

async function readOld(file) {
  try {
    const txt = await fs.readFile(file, "utf8");
    const j = JSON.parse(txt);
    return Array.isArray(j) ? j : j.items || [];
  } catch {
    return [];
  }
}

async function build() {
  console.log("📰 PTD Builder: Fetching feeds...");

  let fetched = [];
  for (const f of FEEDS) {
    const arr = await fetchFeed(f);
    console.log(`  ${f} → ${arr.length} items`);
    fetched = fetched.concat(arr);
    await sleep(400);
  }

  const fresh = dedupe(fetched);
  console.log(`Fetched total unique: ${fresh.length}`);

  // Load previous data
  const old7d = await readOld(WEEK_PATH);
  const oldNews = await readOld(NEWS_PATH);

  // Combine everything for archive
  let pool = dedupe([...fresh, ...old7d, ...oldNews]);
  pool = clampWindow(pool, HRS_7D);
  pool.sort((a, b) => b.score - a.score || new Date(b.published) - new Date(a.published));

  const news72 = clampWindow(pool, HRS_72);

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    WEEK_PATH,
    JSON.stringify({ updated: new Date().toISOString(), items: pool }, null, 2)
  );
  await fs.writeFile(NEWS_PATH, JSON.stringify(news72, null, 2));

  console.log(`✅ Saved:
  • /data/news.json → ${news72.length} items (72h)
  • /data/7d.json   → ${pool.length} items (7d rolling)
  Done ✅`);
}

// -----------------------------------------------------------

build().catch((e) => {
  console.error("❌ Build failed:", e);
  process.exit(1);
});