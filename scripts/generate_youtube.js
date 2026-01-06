/**
 * scripts/generate_youtube.js
 *
 * No YouTube API key required.
 * Supports channelId OR handle (@name) OR a YouTube channel URL in data/youtube_channels.json
 *
 * Outputs:
 *  - data/youtube_raw.json   (debug)
 *  - data/youtube.json       (what the Home page should read)
 *
 * IMPORTANT:
 * - This script does NOT fail the workflow if a channel breaks.
 * - It will still write data/youtube.json (possibly empty) and exit 0.
 */

import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

const ROOT = process.cwd();

const CHANNELS_PATH = path.join(ROOT, "data", "youtube_channels.json");
const OUT_JSON = path.join(ROOT, "data", "youtube.json");
const OUT_RAW = path.join(ROOT, "data", "youtube_raw.json");

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari";

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const it of arr) {
    const k = keyFn(it);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function cleanText(s) {
  return (s ?? "").toString().replace(/\s+/g, " ").trim();
}

function toIso(s) {
  if (!s) return "";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString();
  } catch {
    return "";
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
    cache: "no-store",
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

/**
 * Resolve a channelId (UC...) from:
 * - channelId (direct)
 * - handle (e.g., "SiemensEnergy" or "@SiemensEnergy")
 * - url (e.g., "https://www.youtube.com/@SiemensEnergy")
 */
async function resolveChannelId(ch) {
  // 1) direct channelId
  if (ch.channelId && /^UC[\w-]{20,}$/.test(ch.channelId)) return ch.channelId;

  // 2) try from url containing /channel/UC...
  if (ch.url) {
    const m = ch.url.match(/youtube\.com\/channel\/(UC[\w-]{20,})/i);
    if (m?.[1]) return m[1];
  }

  // 3) handle from handle or url
  let handle = ch.handle || "";
  if (!handle && ch.url) {
    const m = ch.url.match(/youtube\.com\/@([A-Za-z0-9._-]+)/i);
    if (m?.[1]) handle = m[1];
  }
  handle = handle.replace(/^@/, "").trim();

  if (!handle) return null;

  const pageUrl = `https://www.youtube.com/@${encodeURIComponent(handle)}`;
  const { ok, status, text } = await fetchText(pageUrl);
  if (!ok) throw new Error(`Handle page fetch failed (${status}) ${pageUrl}`);

  // YouTube HTML usually contains "channelId":"UC..."
  const m1 = text.match(/"channelId":"(UC[\w-]{20,})"/);
  if (m1?.[1]) return m1[1];

  // fallback: sometimes appears as /channel/UC...
  const m2 = text.match(/\/channel\/(UC[\w-]{20,})/);
  if (m2?.[1]) return m2[1];

  throw new Error(`Could not resolve channelId from handle @${handle}`);
}

async function fetchRssByChannelId(channelId) {
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(
    channelId
  )}`;

  const { ok, status, text } = await fetchText(rssUrl);

  // If YouTube blocks, you’ll often see HTML
  const looksHtml = /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
  if (!ok || looksHtml) {
    throw new Error(
      `Failed RSS ${rssUrl} (${status}). Body starts: ${cleanText(text).slice(0, 140)}`
    );
  }

  return { rssUrl, xml: text };
}

function parseRss(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
  });
  const obj = parser.parse(xml);

  const feed = obj?.feed;
  const entriesRaw = feed?.entry;

  const entries = Array.isArray(entriesRaw)
    ? entriesRaw
    : entriesRaw
    ? [entriesRaw]
    : [];

  const channelTitle = cleanText(feed?.title);

  const items = entries
    .map((e) => {
      const title = cleanText(e?.title);
      const publishedAt = toIso(e?.published) || toIso(e?.updated);

      // videoId can be under videoId or as part of id URL
      const videoId =
        cleanText(e?.videoId) ||
        cleanText(e?.["yt:videoId"]) ||
        (typeof e?.id === "string"
          ? (e.id.match(/video:([A-Za-z0-9_-]{6,})/) || [])[1]
          : "");

      // link may be an object or array of objects with href
      let url = "";
      const link = e?.link;
      if (Array.isArray(link)) {
        const alt = link.find((l) => l?.["@_rel"] === "alternate") || link[0];
        url = alt?.["@_href"] || "";
      } else if (link && typeof link === "object") {
        url = link?.["@_href"] || "";
      }

      if (!url && videoId) url = `https://www.youtube.com/watch?v=${videoId}`;

      // channel name usually in author.name
      const authorName =
        cleanText(e?.author?.name) || cleanText(e?.author?.["name"]) || channelTitle;

      return {
        title,
        url,
        videoId,
        channel: authorName,
        publishedAt,
      };
    })
    .filter((it) => it.title && it.url && it.videoId);

  return { channelTitle, items };
}

async function main() {
  if (!fs.existsSync(CHANNELS_PATH)) {
    writeJson(OUT_JSON, {
      updated_at: new Date().toISOString(),
      items: [],
      errors: [{ channel: "CONFIG", error: `Missing file: data/youtube_channels.json` }],
    });
    console.log(`Wrote ${OUT_JSON} (empty) — missing youtube_channels.json`);
    return;
  }

  const config = readJson(CHANNELS_PATH);
  const channels = Array.isArray(config.channels) ? config.channels : [];

  const maxPerChannel = Number(config.maxPerChannel ?? 6);
  const maxTotal = Number(config.maxTotal ?? 18);

  const allItems = [];
  const errors = [];
  const raw = [];

  for (const ch of channels) {
    const label = ch.name || ch.handle || ch.channelId || ch.url || "Unknown";

    try {
      const channelId = await resolveChannelId(ch);
      if (!channelId) {
        throw new Error(`Missing channelId/handle/url`);
      }

      const { rssUrl, xml } = await fetchRssByChannelId(channelId);
      const parsed = parseRss(xml);

      const items = parsed.items.slice(0, maxPerChannel);

      raw.push({
        channel: label,
        resolvedChannelId: channelId,
        rssUrl,
        found: parsed.items.length,
        kept: items.length,
      });

      allItems.push(
        ...items.map((it) => ({
          ...it,
          channel: it.channel || label,
        }))
      );
    } catch (e) {
      errors.push({ channel: label, error: String(e?.message || e) });
      raw.push({ channel: label, error: String(e?.message || e) });
    }
  }

  const merged = uniqBy(allItems, (x) => x.videoId)
    .sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""))
    .slice(0, maxTotal);

  writeJson(OUT_RAW, {
    updated_at: new Date().toISOString(),
    debug: raw,
    errors,
  });

  writeJson(OUT_JSON, {
    updated_at: new Date().toISOString(),
    items: merged,
    errors,
  });

  console.log(`YouTube: wrote ${OUT_JSON} with ${merged.length} items`);
  if (errors.length) console.log(`YouTube: ${errors.length} channel errors (see data/youtube_raw.json)`);
}

main().catch((err) => {
  // Never fail the workflow; always write a safe output.
  writeJson(OUT_JSON, {
    updated_at: new Date().toISOString(),
    items: [],
    errors: [{ channel: "FATAL", error: String(err?.message || err) }],
  });
  console.error(err);
  process.exit(0);
});