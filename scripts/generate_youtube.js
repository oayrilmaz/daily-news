// scripts/generate_youtube.js
import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

const OUT_FILE = "data/youtube.json";

// Secret format supported:
// - newline-separated URLs
// - comma-separated URLs
// Example:
// https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxxx
// https://www.youtube.com/feeds/videos.xml?channel_id=UCyyyyy
const RAW = process.env.YOUTUBE_RSS_URLS || "";

function splitUrls(raw) {
  return raw
    .split(/\r?\n|,/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function safeText(x) {
  if (x == null) return "";
  if (typeof x === "string") return x;
  return String(x);
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null) return obj[k];
  }
  return undefined;
}

function ensureArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function toIso(d) {
  try {
    return new Date(d).toISOString();
  } catch {
    return "";
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "PTDTodayBot/1.0 (+https://ptdtoday.com)",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

function parseYoutubeFeed(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    // YouTube feeds use namespaces; keep names as-is
    removeNSPrefix: false,
  });

  const j = parser.parse(xml);
  const feed = j?.feed || {};
  const title = safeText(feed?.title);
  const updated = safeText(feed?.updated);

  const entries = ensureArray(feed?.entry);

  const items = entries.map((e) => {
    const videoId =
      pick(e, ["yt:videoId", "videoId"]) ||
      pick(e?.["yt:videoId"], ["#text"]) ||
      "";

    const channelId =
      pick(e, ["yt:channelId", "channelId"]) ||
      pick(e?.["yt:channelId"], ["#text"]) ||
      "";

    const linkObj = ensureArray(e?.link).find((l) => l?.["@_rel"] === "alternate") || e?.link;
    const url = safeText(linkObj?.["@_href"]) || "";

    // Thumbnail is usually media:group > media:thumbnail
    const thumbs =
      ensureArray(e?.["media:group"]?.["media:thumbnail"]) ||
      ensureArray(e?.["media:thumbnail"]);
    const thumbUrl = safeText(thumbs?.[0]?.["@_url"]) || "";

    const published = safeText(e?.published);
    const itemTitle = safeText(e?.title);

    const authorName =
      safeText(e?.author?.name) ||
      safeText(feed?.author?.name) ||
      "";

    return {
      title: itemTitle,
      published_at: toIso(published),
      channel_title: authorName || title,
      channel_id: safeText(channelId),
      video_id: safeText(videoId),
      url,
      thumbnail: thumbUrl,
      source: "YouTube",
    };
  });

  return { feed_title: title, updated_at: toIso(updated), items };
}

function keywordFilter(items) {
  // OPTIONAL: keep only PTD-relevant topics (edit freely)
  const KEYWORDS = [
    "power", "grid", "substation", "transformer", "hvdc", "gis", "switchgear",
    "renewable", "solar", "wind", "battery", "storage",
    "data center", "datacenter", "ai", "semiconductor", "chip", "energy",
    "transmission", "distribution",
    "reuters", "cnbc", "bloomberg"
  ];

  const norm = (s) => (s || "").toLowerCase();

  return items.filter((it) => {
    const h = `${norm(it.title)} ${norm(it.channel_title)}`;
    return KEYWORDS.some((k) => h.includes(k));
  });
}

async function main() {
  const urls = splitUrls(RAW);

  if (!urls.length) {
    console.log("No YOUTUBE_RSS_URLS provided. Writing empty youtube.json.");
    await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
    await fs.writeFile(
      OUT_FILE,
      JSON.stringify(
        {
          updated_at: new Date().toISOString(),
          disclaimer: "YouTube list not configured (no YOUTUBE_RSS_URLS).",
          items: [],
        },
        null,
        2
      )
    );
    return;
  }

  const all = [];
  const errors = [];

  for (const u of urls) {
    try {
      const xml = await fetchText(u);
      const parsed = parseYoutubeFeed(xml);
      all.push(...parsed.items);
    } catch (e) {
      errors.push({ url: u, error: e?.message || String(e) });
    }
  }

  // Deduplicate by video_id/url
  const seen = new Set();
  let items = [];
  for (const it of all) {
    const key = it.video_id || it.url || it.title;
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(it);
  }

  // Keep only relevant topics (edit/remove if you want everything)
  items = keywordFilter(items);

  // Sort newest first
  items.sort((a, b) => (b.published_at || "").localeCompare(a.published_at || ""));

  // Keep a reasonable number
  items = items.slice(0, 25);

  const payload = {
    title: "PTD Today — YouTube Watch",
    updated_at: new Date().toISOString(),
    disclaimer:
      "Videos pulled from public YouTube RSS feeds. View counts are not available via RSS.",
    errors,
    items,
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUT_FILE} with ${items.length} items.`);
  if (errors.length) console.log("Some feeds failed:", errors);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});