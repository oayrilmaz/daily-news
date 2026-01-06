import fs from "fs";
import path from "path";
import { XMLParser } from "fast-xml-parser";

const CHANNELS_PATH = "data/youtube_channels.json";
const OUT_PATH = "data/youtube.json";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "ptdtoday-bot/1.0"
    }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}${body ? ` | ${body.slice(0, 120)}` : ""}`);
  }
  return await res.text();
}

function extractVideoId(entry) {
  // Common locations:
  // - entry["yt:videoId"]
  // - entry.link["@_href"] => https://www.youtube.com/watch?v=...
  const vid =
    entry?.["yt:videoId"] ||
    entry?.["videoId"] ||
    entry?.["yt:videoid"];

  if (typeof vid === "string" && vid.trim()) return vid.trim();

  const href = entry?.link?.["@_href"];
  if (typeof href === "string") {
    const m = href.match(/[?&]v=([^&]+)/);
    if (m?.[1]) return m[1];
  }

  return "";
}

function normalizeEntries(feed) {
  const entries = feed?.entry;
  if (!entries) return [];
  return Array.isArray(entries) ? entries : [entries];
}

async function loadChannelFeed(channelId) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  const xml = await fetchText(url);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
  });

  const parsed = parser.parse(xml);
  const feed = parsed?.feed;
  if (!feed) return [];

  const entries = normalizeEntries(feed);

  return entries.map((e) => {
    const title = (e?.title ?? "").toString().trim();
    const videoId = extractVideoId(e);
    const url =
      e?.link?.["@_href"] ||
      (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");

    const published =
      (e?.published ?? e?.updated ?? "").toString().trim();

    return {
      title,
      videoId,
      url,
      publishedAt: published,
      channelId
    };
  });
}

function dedupeByVideoId(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it.videoId) continue;
    if (seen.has(it.videoId)) continue;
    seen.add(it.videoId);
    out.push(it);
  }
  return out;
}

function isValidItem(it) {
  return (
    typeof it.title === "string" && it.title.trim().length > 0 &&
    typeof it.videoId === "string" && it.videoId.trim().length > 0 &&
    typeof it.url === "string" && it.url.startsWith("http")
  );
}

async function main() {
  if (!fs.existsSync(CHANNELS_PATH)) {
    throw new Error(`Missing ${CHANNELS_PATH}. Create it with your channelIds.`);
  }

  const cfg = readJson(CHANNELS_PATH);
  const channels = Array.isArray(cfg.channels) ? cfg.channels : [];

  if (!channels.length) {
    throw new Error(`No channels found in ${CHANNELS_PATH}. Add at least one channelId.`);
  }

  let all = [];
  const errors = [];

  for (const ch of channels) {
    const channelId = (ch.channelId ?? "").toString().trim();
    const name = (ch.name ?? channelId).toString().trim();

    if (!channelId) {
      errors.push(`Skipped channel with missing channelId (name: ${name})`);
      continue;
    }

    try {
      const items = await loadChannelFeed(channelId);
      // keep only well-formed items
      const cleaned = items.filter(isValidItem).map(it => ({
        ...it,
        channelName: name
      }));
      all.push(...cleaned);
    } catch (e) {
      errors.push(`Channel ${name} (${channelId}) failed: ${e.message}`);
      // IMPORTANT: continue; don't kill whole workflow for one bad channel
    }
  }

  all = dedupeByVideoId(all);

  // newest first (publishedAt is ISO-ish; fallback keeps original order)
  all.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));

  // keep it reasonable
  const MAX_ITEMS = 40;
  all = all.slice(0, MAX_ITEMS);

  const payload = {
    updated_at: new Date().toISOString(),
    items: all,
    errors
  };

  ensureDirFor(OUT_PATH);
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), "utf8");

  if (all.length === 0) {
    // Fail ONLY if you produced nothing (so you notice)
    throw new Error(
      `YouTube output has 0 valid items. Check channelIds. First error: ${errors[0] || "none"}`
    );
  }

  console.log(`Wrote ${OUT_PATH} with ${all.length} items.`);
  if (errors.length) console.log(`Warnings: ${errors.length} channel errors.`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});