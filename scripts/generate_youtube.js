// scripts/generate_youtube.js
import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

const CHANNELS_FILE = "data/youtube_channels.json";
const OUT_FILE = "data/youtube.json";

// If you want the workflow to FAIL when zero items are produced, set STRICT_YOUTUBE=1 in Actions env.
const STRICT = process.env.STRICT_YOUTUBE === "1";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // keep tag names as-is (yt:videoId etc.)
  removeNSPrefix: false,
});

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function toArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function safeStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function buildRssUrl(ch) {
  // Preferred: explicit RSS URL
  if (ch.rss && safeStr(ch.rss)) return safeStr(ch.rss);

  // Backward compatible: channelId → RSS URL
  if (ch.channelId && safeStr(ch.channelId)) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(
      safeStr(ch.channelId)
    )}`;
  }

  return "";
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      // Helps avoid some bot blocks
      "user-agent":
        "Mozilla/5.0 (compatible; PTDTodayBot/1.0; +https://ptdtoday.com)",
      accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for RSS: ${url}\n${body.slice(0, 200)}`);
  }
  return await res.text();
}

function extractEntryUrl(entry) {
  // YouTube RSS usually has <link rel="alternate" href="..."/>
  const links = toArray(entry.link);

  // Case 1: fast-xml-parser returns link as object with @_href
  for (const l of links) {
    const href = safeStr(l?.["@_href"]);
    if (href) return href;
  }

  // Case 2: link is a string
  for (const l of links) {
    const s = safeStr(l);
    if (s.startsWith("http")) return s;
  }

  // Fallback: build from videoId
  const vid = safeStr(entry?.["yt:videoId"]);
  if (vid) return `https://www.youtube.com/watch?v=${vid}`;

  return "";
}

function extractThumb(entry) {
  // Common: media:group > media:thumbnail @_url
  const mg = entry?.["media:group"];
  const thumb = mg?.["media:thumbnail"];

  // Could be array or object
  const thumbs = toArray(thumb);
  for (const t of thumbs) {
    const url = safeStr(t?.["@_url"]);
    if (url) return url;
  }
  return "";
}

function parseFeed(xmlText, channelName, rssUrl) {
  // If YouTube returns HTML (blocked / bad URL), parser will not have feed
  if (xmlText.trim().startsWith("<!DOCTYPE html") || xmlText.includes("<html")) {
    return {
      ok: false,
      error: `Got HTML instead of RSS for ${channelName} (${rssUrl}). Check the URL/channel ID.`,
      items: [],
    };
  }

  let doc;
  try {
    doc = parser.parse(xmlText);
  } catch (e) {
    return { ok: false, error: `XML parse error for ${channelName}: ${e}`, items: [] };
  }

  const feed = doc?.feed;
  const entries = toArray(feed?.entry);

  const items = entries
    .map((entry) => {
      const title = safeStr(entry?.title);
      const videoId = safeStr(entry?.["yt:videoId"]);
      const url = extractEntryUrl(entry);
      const published = safeStr(entry?.published);
      const authorName = safeStr(entry?.author?.name);
      const thumbnail = extractThumb(entry);

      return {
        title,
        videoId,
        url,
        published_at: published,
        channel: channelName,
        author: authorName || channelName,
        thumbnail,
        source: "youtube_rss",
      };
    })
    .filter((it) => it.title && it.videoId && it.url);

  return { ok: true, error: "", items };
}

async function main() {
  if (!fs.existsSync(CHANNELS_FILE)) {
    throw new Error(`Missing ${CHANNELS_FILE}. Create it first.`);
  }

  const cfg = readJson(CHANNELS_FILE);
  const channels = Array.isArray(cfg.channels) ? cfg.channels : [];

  if (!channels.length) {
    console.log("No channels configured. Writing empty youtube.json.");
    ensureDirFor(OUT_FILE);
    fs.writeFileSync(
      OUT_FILE,
      JSON.stringify({ updated_at: new Date().toISOString(), items: [], channels: [] }, null, 2)
    );
    return;
  }

  const allItems = [];
  const channelResults = [];

  for (const ch of channels) {
    const name = safeStr(ch.name) || "YouTube";
    const rssUrl = buildRssUrl(ch);

    if (!rssUrl) {
      channelResults.push({ name, ok: false, error: "Missing rss or channelId" });
      continue;
    }

    try {
      const xml = await fetchText(rssUrl);
      const parsed = parseFeed(xml, name, rssUrl);

      channelResults.push({ name, ok: parsed.ok, error: parsed.error || "" });
      allItems.push(...parsed.items);
    } catch (e) {
      channelResults.push({ name, ok: false, error: String(e?.message || e) });
    }
  }

  // Sort newest first (published_at is ISO)
  allItems.sort((a, b) => (b.published_at || "").localeCompare(a.published_at || ""));

  const output = {
    updated_at: new Date().toISOString(),
    items: allItems,
    channels: channelResults,
  };

  ensureDirFor(OUT_FILE);
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));

  const okCount = channelResults.filter((c) => c.ok).length;
  console.log(`YouTube channels ok: ${okCount}/${channelResults.length}`);
  console.log(`YouTube items written: ${allItems.length} → ${OUT_FILE}`);

  if (STRICT && allItems.length === 0) {
    throw new Error(
      `STRICT_YOUTUBE=1 and 0 valid items produced. Check data/youtube_channels.json RSS URLs.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});