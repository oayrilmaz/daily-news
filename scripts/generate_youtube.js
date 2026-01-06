import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

const CHANNELS_FILE = "data/youtube_channels.json";
const OUTPUT_FILE = "data/youtube.json";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

function safeArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function pickCanonicalChannelId(html) {
  // Look for canonical like: <link rel="canonical" href="https://www.youtube.com/channel/UCxxxx">
  const m = html.match(/rel="canonical"\s+href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)"/);
  return m ? m[1] : null;
}

async function resolveChannelId(ch) {
  if (ch.channelId && ch.channelId.startsWith("UC")) return ch.channelId;

  // If user gave a channel URL directly
  if (ch.url) {
    // Try to fetch and parse canonical
    const res = await fetch(ch.url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (GitHub Actions)" },
    });
    const html = await res.text();
    const id = pickCanonicalChannelId(html);
    return id;
  }

  // If user gave @handle
  if (ch.handle) {
    const handle = ch.handle.startsWith("@") ? ch.handle : `@${ch.handle}`;
    const url = `https://www.youtube.com/${handle}`;
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (GitHub Actions)" },
    });
    const html = await res.text();
    const id = pickCanonicalChannelId(html);
    return id;
  }

  return null;
}

function normalizeVideo(entry, channelName) {
  // YouTube RSS entry has: title, link[@_href], yt:videoId, published, author.name
  const title = entry?.title ?? "";
  const url = entry?.link?.["@_href"] ?? "";
  const videoId = entry?.["yt:videoId"] ?? "";
  const publishedAt = entry?.published ?? entry?.updated ?? "";
  const authorName = entry?.author?.name ?? channelName ?? "";

  return {
    title,
    url,
    videoId,
    channel: authorName,
    publishedAt,
  };
}

async function fetchRssForChannelId(channelId) {
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(rssUrl, {
    redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0 (GitHub Actions)" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed RSS ${rssUrl} (${res.status}). Body starts: ${text.slice(0, 120)}`);
  }

  const xml = await res.text();
  const parsed = parser.parse(xml);
  const feed = parsed?.feed;
  const entries = safeArray(feed?.entry);
  return entries;
}

async function main() {
  const cfg = readJson(CHANNELS_FILE);
  const channels = safeArray(cfg.channels);

  if (!channels.length) {
    throw new Error(`No channels found in ${CHANNELS_FILE}`);
  }

  const allItems = [];
  const errors = [];

  for (const ch of channels) {
    const name = ch.name || ch.handle || ch.url || ch.channelId || "Unknown";

    try {
      const channelId = await resolveChannelId(ch);

      if (!channelId) {
        errors.push({ channel: name, error: "Could not resolve channelId (add handle/url/channelId)" });
        continue;
      }

      const entries = await fetchRssForChannelId(channelId);

      for (const e of entries.slice(0, 6)) {
        const item = normalizeVideo(e, name);

        // Validate required fields for your Home renderer
        if (item.title && item.url && item.videoId) {
          allItems.push(item);
        }
      }
    } catch (err) {
      errors.push({ channel: name, error: err?.message || String(err) });
    }
  }

  // Sort newest first (publishedAt is ISO)
  allItems.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));

  const out = {
    updated_at: new Date().toISOString(),
    items: allItems,
    errors,
  };

  writeJson(OUTPUT_FILE, out);

  // If zero valid items, FAIL with a very clear reason (so your Action shows why)
  if (allItems.length === 0) {
    const firstErr = errors[0]?.error || "No valid items produced.";
    throw new Error(`YouTube output has 0 valid items. Check handles/URLs. First error: ${firstErr}`);
  }

  console.log(`Wrote ${OUTPUT_FILE} with ${allItems.length} items`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});