import fs from "fs/promises";
import path from "path";
import { XMLParser } from "fast-xml-parser";

const OUT_FILE = "briefs/youtube.json";
const MAX_ITEMS_TOTAL = 18;     // total videos saved
const MAX_PER_FEED = 6;         // max pulled from each RSS feed
const FETCH_TIMEOUT_MS = 15000;

function parseEnvList(value) {
  return (value || "")
    .split(/[\n,]+/g)
    .map(s => s.trim())
    .filter(Boolean);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchText(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "PTD-Today-Bot/1.0 (+https://ptdtoday.com)",
        "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8"
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// Extract YouTube videoId from common URL patterns
function extractVideoId(link) {
  if (!link) return null;
  try {
    const u = new URL(link);
    if (u.hostname.includes("youtube.com")) {
      return u.searchParams.get("v") || null;
    }
    if (u.hostname === "youtu.be") {
      return u.pathname.replace("/", "") || null;
    }
  } catch {}
  // fallback: try to find v=xxxxx
  const m = String(link).match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
  return m ? m[1] : null;
}

function normalizeItem(entry, feedTitle = "") {
  // RSS entry fields vary; YouTube usually has:
  // entry.title, entry.link, entry["yt:videoId"], entry.author.name, entry.published
  const title = entry.title?.["#text"] ?? entry.title ?? "";
  const link = entry.link?.["@_href"] ?? entry.link ?? "";
  const videoId =
    entry["yt:videoId"] ||
    entry["videoId"] ||
    extractVideoId(link);

  const channel =
    entry.author?.name ??
    entry.author ??
    feedTitle ??
    "";

  const published =
    entry.published ??
    entry.updated ??
    "";

  const thumb =
    videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";

  return {
    source: "YouTube",
    channel: String(channel || "").trim(),
    title: String(title || "").trim(),
    url: link || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ""),
    videoId: videoId || "",
    published_at: published || "",
    thumbnail: thumb
  };
}

// OPTIONAL: fetch view counts using YouTube Data API (requires YOUTUBE_API_KEY)
async function enrichWithViews(items, apiKey) {
  const ids = [...new Set(items.map(v => v.videoId).filter(Boolean))];
  if (!apiKey || ids.length === 0) return items;

  // YouTube API allows up to 50 ids per call
  const chunks = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

  const stats = new Map();

  for (const chunk of chunks) {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", chunk.join(","));
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) continue;

    const json = await res.json();
    for (const it of (json.items || [])) {
      const vid = it.id;
      const views = Number(it.statistics?.viewCount || 0);
      stats.set(vid, views);
    }

    // be gentle
    await sleep(200);
  }

  return items.map(v => ({
    ...v,
    views: stats.get(v.videoId) ?? null
  }));
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function main() {
  const rssUrls = parseEnvList(process.env.YOUTUBE_RSS_URLS);
  const ytApiKey = (process.env.YOUTUBE_API_KEY || "").trim();

  const payload = {
    title: "PTD Today — YouTube Briefs",
    updated_at: new Date().toISOString(),
    disclaimer:
      "Video list is aggregated from public YouTube feeds. Informational only. Availability may change.",
    items: []
  };

  if (rssUrls.length === 0) {
    // Don’t fail the job—just write an empty file so the site still loads.
    await ensureDir(path.dirname(OUT_FILE));
    await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
    console.log("No YOUTUBE_RSS_URLS provided. Wrote empty youtube.json.");
    return;
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
  });

  const all = [];

  for (const url of rssUrls) {
    try {
      const xml = await fetchText(url);
      const obj = parser.parse(xml);

      const feedTitle =
        obj?.feed?.title?.["#text"] ??
        obj?.feed?.title ??
        "";

      const entries = obj?.feed?.entry
        ? (Array.isArray(obj.feed.entry) ? obj.feed.entry : [obj.feed.entry])
        : [];

      const mapped = entries
        .slice(0, MAX_PER_FEED)
        .map(e => normalizeItem(e, feedTitle))
        .