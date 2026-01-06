import fs from "fs";
import path from "path";
import { XMLParser } from "fast-xml-parser";

const CHANNELS_FILE = "data/youtube_channels.json";
const OUT_FILE = "data/youtube.json";
const MAX_ITEMS_TOTAL = 30; // total items across all channels
const PER_CHANNEL_LIMIT = 8;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; PTDTodayBot/1.0; +https://ptdtoday.com)"
    }
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

function extractChannelIdFromHtml(html) {
  // YouTube pages usually contain: "channelId":"UCxxxxxxxx..."
  const m = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{20,})"/);
  return m ? m[1] : null;
}

function normalizeChannelEntry(ch) {
  // Accept {channelId} or {url}
  if (ch.channelId && /^UC[a-zA-Z0-9_-]{20,}$/.test(ch.channelId)) {
    return { name: ch.name || ch.channelId, channelId: ch.channelId };
  }
  if (ch.url && typeof ch.url === "string") {
    return { name: ch.name || ch.url, url: ch.url };
  }
  return null;
}

async function resolveChannelId(entry) {
  if (entry.channelId) return entry.channelId;

  const { ok, status, text } = await fetchText(entry.url);
  if (!ok) {
    throw new Error(`Failed to load channel page (${status}) ${entry.url}`);
  }
  const channelId = extractChannelIdFromHtml(text);
  if (!channelId) {
    throw new Error(`Could not extract channelId from ${entry.url}`);
  }
  return channelId;
}

async function fetchRss(channelId) {
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(
    channelId
  )}`;
  const { ok, status, text } = await fetchText(rssUrl);
  if (!ok) {
    const head = text.slice(0, 180).replace(/\s+/g, " ");
    throw new Error(`Failed RSS ${rssUrl} (${status}). Body starts: ${head}`);
  }
  return text;
}

function pickThumb(videoId) {
  if (!videoId) return "";
  // hqdefault is stable; maxres may 404 sometimes
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function parseFeed(xml, channelNameFallback) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
  });
  const obj = parser.parse(xml);

  const feed = obj.feed || {};
  const entries = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : [];

  const channelTitle =
    (feed.author && feed.author.name) ||
    feed.title ||
    channelNameFallback ||
    "YouTube";

  const items = entries
    .slice(0, PER_CHANNEL_LIMIT)
    .map((e) => {
      const title = e.title || "";
      const linkHref = e.link && e.link["@_href"] ? e.link["@_href"] : "";
      const videoId = (e["yt:videoId"] || "").toString();
      const publishedAt = e.published || e.updated || "";

      // Prefer watch link if missing
      const url =
        linkHref ||
        (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");

      return {
        title,
        url,
        videoId,
        channel: channelTitle,
        publishedAt,
        thumbnail: pickThumb(videoId)
      };
    })
    .filter((x) => x.title && (x.videoId || x.url));

  return items;
}

function sortDesc(items) {
  return items.sort((a, b) => {
    const da = Date.parse(a.publishedAt || "") || 0;
    const db = Date.parse(b.publishedAt || "") || 0;
    return db - da;
  });
}

async function main() {
  const input = readJson(CHANNELS_FILE);
  const channels = (input.channels || [])
    .map(normalizeChannelEntry)
    .filter(Boolean);

  if (!channels.length) {
    writeJson(OUT_FILE, {
      updated_at: new Date().toISOString(),
      items: [],
      errors: [{ channel: "ALL", error: "No channels configured." }]
    });
    console.log("No channels configured.");
    return;
  }

  const allItems = [];
  const errors = [];

  for (const ch of channels) {
    try {
      const channelId = await resolveChannelId(ch);
      const xml = await fetchRss(channelId);
      const items = parseFeed(xml, ch.name);
      allItems.push(...items);
    } catch (e) {
      errors.push({ channel: ch.name || ch.url || ch.channelId, error: String(e.message || e) });
    }
  }

  const dedup = new Map();
  for (const it of allItems) {
    const key = it.videoId || it.url;
    if (!key) continue;
    if (!dedup.has(key)) dedup.set(key, it);
  }

  const itemsSorted = sortDesc([...dedup.values()]).slice(0, MAX_ITEMS_TOTAL);

  writeJson(OUT_FILE, {
    updated_at: new Date().toISOString(),
    items: itemsSorted,
    errors
  });

  if (!itemsSorted.length) {
    throw new Error(
      `YouTube output has 0 valid items. Check channel URLs/handles. First error: ${
        errors[0]?.error || "none"
      }`
    );
  }

  console.log(`Wrote ${OUT_FILE} with ${itemsSorted.length} items.`);
  if (errors.length) console.log(`Warnings: ${errors.length} channel(s) failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});