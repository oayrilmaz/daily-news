// scripts/generate_youtube.js
// Generates: data/youtube.json (and optionally data/youtube_raw.json)
// Reads:     data/youtube_channels.json
//
// Works WITHOUT any YouTube API key by:
//  1) Resolving each channel URL/handle to a channelId (UC...)
//  2) Fetching RSS: https://www.youtube.com/feeds/videos.xml?channel_id=UC...
//  3) Parsing the RSS XML into a simple JSON array for your Home page

import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

const CHANNELS_PATH = "data/youtube_channels.json";
const OUT_PATH = "data/youtube.json";
const RAW_PATH = "data/youtube_raw.json";

// Tuning
const MAX_ITEMS_PER_CHANNEL = 6;
const TIMEOUT_MS = 20000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

function nowIso() {
  return new Date().toISOString();
}

function isUcChannelId(x) {
  return typeof x === "string" && /^UC[a-zA-Z0-9_-]{10,}$/.test(x.trim());
}

function escapeJsonString(s) {
  return (s ?? "").toString();
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // Helps avoid some bot-block pages
        "user-agent":
          "Mozilla/5.0 (compatible; PTDTodayBot/1.0; +https://ptdtoday.com)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(t);
  }
}

async function readJson(filePath) {
  const txt = await fs.readFile(filePath, "utf8");
  return JSON.parse(txt);
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function normalizeChannelUrl(u) {
  if (!u) return "";
  let url = u.trim();

  // allow "@Handle" directly
  if (url.startsWith("@")) url = `https://www.youtube.com/${url}`;

  // If user pastes without scheme
  if (url.startsWith("www.")) url = "https://" + url;
  if (url.startsWith("youtube.com")) url = "https://" + url;

  return url;
}

function pickChannelIdFromHtml(html) {
  // Common patterns in YouTube channel/handle pages:
  // 1) "channelId":"UCxxxx"
  // 2) channel_id=UCxxxx inside links
  const m1 = html.match(/"channelId"\s*:\s*"(?<id>UC[a-zA-Z0-9_-]+)"/);
  if (m1?.groups?.id) return m1.groups.id;

  const m2 = html.match(/channel_id=(?<id>UC[a-zA-Z0-9_-]+)/);
  if (m2?.groups?.id) return m2.groups.id;

  return "";
}

async function resolveChannelId(ch) {
  // Priority:
  // - explicit channelId
  // - url (handle, /channel/UC..., /@handle, etc.)

  if (isUcChannelId(ch.channelId)) return ch.channelId.trim();

  const url = normalizeChannelUrl(ch.url || "");
  if (!url) return "";

  // If URL already contains /channel/UC...
  const direct = url.match(/\/channel\/(?<id>UC[a-zA-Z0-9_-]+)/);
  if (direct?.groups?.id) return direct.groups.id;

  // Otherwise fetch the page and extract channelId
  const { ok, status, text } = await fetchText(url);
  if (!ok) {
    throw new Error(`Failed channel page ${url} (${status})`);
  }

  const id = pickChannelIdFromHtml(text);
  if (!isUcChannelId(id)) {
    throw new Error(`Could not resolve channelId from ${url}`);
  }
  return id;
}

function toArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function parseRssEntries(xmlText) {
  // YouTube feeds are Atom; root is typically <feed> with <entry>
  const obj = parser.parse(xmlText);
  const feed = obj?.feed;
  const entries = toArray(feed?.entry);

  return entries.map((e) => {
    const videoId = e?.["yt:videoId"] || e?.["yt:videoid"] || "";
    const title = e?.title || "";
    const channel = e?.author?.name || "";
    const publishedAt = e?.published || e?.updated || "";

    // link can be array; find rel="alternate"
    const links = toArray(e?.link);
    const alt = links.find((l) => l?.["@_rel"] === "alternate") || links[0] || {};
    const url = alt?.["@_href"] || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");

    return {
      title: escapeJsonString(title),
      url: escapeJsonString(url),
      videoId: escapeJsonString(videoId),
      channel: escapeJsonString(channel),
      publishedAt: escapeJsonString(publishedAt),
    };
  });
}

function isValidItem(it) {
  return !!(it && it.title && (it.videoId || it.url));
}

async function main() {
  const errors = [];
  const raw = [];
  const items = [];

  const cfg = await readJson(CHANNELS_PATH);
  const channels = Array.isArray(cfg?.channels) ? cfg.channels : [];

  if (!channels.length) {
    await writeJson(OUT_PATH, { updated_at: nowIso(), items: [], errors: [{ error: "No channels in data/youtube_channels.json" }] });
    // Don’t fail workflow if user is still configuring
    return;
  }

  for (const ch of channels) {
    const name = ch?.name || "Unknown";
    try {
      const channelId = await resolveChannelId(ch);
      if (!isUcChannelId(channelId)) {
        throw new Error(`Invalid channelId resolved for ${name}`);
      }

      const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
      const rss = await fetchText(rssUrl);

      if (!rss.ok) {
        throw new Error(`Failed RSS ${rssUrl} (${rss.status}). Body starts: ${rss.text?.slice(0, 120)}`);
      }

      const parsed = parseRssEntries(rss.text).slice(0, MAX_ITEMS_PER_CHANNEL);

      raw.push({
        name,
        channelId,
        rssUrl,
        count: parsed.length,
      });

      for (const it of parsed) {
        if (isValidItem(it)) items.push(it);
      }
    } catch (e) {
      errors.push({
        channel: name,
        error: e?.message || String(e),
      });
    }
  }

  // Sort newest first when possible
  items.sort((a, b) => {
    const da = Date.parse(a.publishedAt || "") || 0;
    const db = Date.parse(b.publishedAt || "") || 0;
    return db - da;
  });

  // Write outputs
  await writeJson(OUT_PATH, {
    updated_at: nowIso(),
    items,
    errors,
  });

  await writeJson(RAW_PATH, {
    updated_at: nowIso(),
    channels_checked: raw,
    errors,
  });

  // IMPORTANT: Do NOT fail the workflow just because 1 channel is broken.
  // Only “fail” if absolutely nothing worked.
  if (items.length === 0) {
    throw new Error(`YouTube output has 0 valid items. Check channel URLs/handles. First error: ${errors[0]?.error || "none"}`);
  }
}

main().catch(async (err) => {
  // Ensure OUT_PATH exists even on failure (helps your Home page)
  try {
    await writeJson(OUT_PATH, {
      updated_at: nowIso(),
      items: [],
      errors: [{ error: err?.message || String(err) }],
    });
  } catch (_) {}
  console.error(err);
  process.exit(1);
});