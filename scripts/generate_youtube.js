// scripts/generate_youtube.js
// Generates /data/youtube.json from YouTube RSS (no API key needed).
// Input:  /data/youtube_channels.json
// Output: /data/youtube.json  (+ optional /data/youtube_raw.json for debugging)

import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

const ROOT = process.cwd();

const INPUT_CHANNELS = path.join(ROOT, "data", "youtube_channels.json");
const OUT_YOUTUBE = path.join(ROOT, "data", "youtube.json");
const OUT_RAW = path.join(ROOT, "data", "youtube_raw.json");

const MAX_PER_CHANNEL = 6;      // keep small (home page should stay fast)
const MAX_TOTAL = 24;           // total items across all channels
const FETCH_TIMEOUT_MS = 20000; // 20s

function nowIso() {
  return new Date().toISOString();
}

function asArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function safeText(x) {
  if (x === null || x === undefined) return "";
  return String(x).trim();
}

function extractVideoIdFromUrl(url) {
  try {
    const u = new URL(url);
    // https://www.youtube.com/watch?v=XXXX
    const v = u.searchParams.get("v");
    if (v) return v;

    // https://www.youtube.com/shorts/XXXX
    const parts = u.pathname.split("/").filter(Boolean);
    const shortsIdx = parts.indexOf("shorts");
    if (shortsIdx >= 0 && parts[shortsIdx + 1]) return parts[shortsIdx + 1];

    // https://youtu.be/XXXX
    if (u.hostname === "youtu.be" && parts[0]) return parts[0];

    return "";
  } catch {
    return "";
  }
}

function normalizeYoutubeLink(url) {
  // Keep what RSS gives (usually watch?v=), but ensure https
  url = safeText(url);
  if (!url) return "";
  if (url.startsWith("http://")) url = "https://" + url.slice(7);
  return url;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "ptdtoday-youtube-rss/1.0 (+https://ptdtoday.com)",
        "accept": "application/atom+xml,application/xml,text/xml,*/*",
      },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(t);
  }
}

function buildFeedUrl(channelId) {
  // YouTube RSS requires the true Channel ID (usually starts with UC...)
  const id = safeText(channelId);
  if (!id) return "";
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`;
}

async function readChannels() {
  const raw = await fs.readFile(INPUT_CHANNELS, "utf-8");
  const json = JSON.parse(raw);

  const channels = asArray(json.channels).map((c) => ({
    name: safeText(c.name) || "YouTube",
    channelId: safeText(c.channelId),
    feedUrl: safeText(c.feedUrl), // optional override
  }));

  return channels.filter((c) => c.feedUrl || c.channelId);
}

function parseAtom(xmlText) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  return parser.parse(xmlText);
}

function atomEntriesToItems(atomObj, channelNameFallback) {
  // YouTube uses Atom: feed.entry[]
  const feed = atomObj?.feed;
  const entries = asArray(feed?.entry);

  const authorName =
    safeText(feed?.author?.name) || safeText(feed?.title) || channelNameFallback;

  const items = [];

  for (const e of entries) {
    const title = safeText(e?.title);
    const publishedAt = safeText(e?.published) || safeText(e?.updated);

    // Atom link can be object or array; YouTube includes rel="alternate"
    const links = asArray(e?.link);
    let url = "";

    for (const l of links) {
      const href = safeText(l?.["@_href"]);
      const rel = safeText(l?.["@_rel"]);
      if (href && (!rel || rel === "alternate")) {
        url = href;
        break;
      }
    }
    url = normalizeYoutubeLink(url);

    const videoId =
      safeText(e?.["yt:videoId"]) ||
      safeText(e?.["yt:videoid"]) ||
      extractVideoIdFromUrl(url);

    if (!title || (!videoId && !url)) continue;

    items.push({
      title,
      url,
      videoId,
      channel: authorName,
      publishedAt,
    });
  }

  return items;
}

function dedupeAndSort(items) {
  const seen = new Set();
  const out = [];

  for (const it of items) {
    const key = it.videoId || it.url || it.title;
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }

  out.sort((a, b) => {
    const ta = Date.parse(a.publishedAt || "") || 0;
    const tb = Date.parse(b.publishedAt || "") || 0;
    return tb - ta;
  });

  return out;
}

async function main() {
  const channels = await readChannels();

  const allItems = [];
  const errors = [];
  const rawDebug = [];

  for (const ch of channels) {
    const feedUrl = ch.feedUrl || buildFeedUrl(ch.channelId);

    if (!feedUrl) {
      errors.push({ channel: ch.name, error: "Missing channelId/feedUrl" });
      continue;
    }

    // Extra guard: channel_id links MUST be valid, otherwise YouTube returns HTML (often 404)
    if (!ch.feedUrl && !/^UC[A-Za-z0-9_-]{10,}$/.test(ch.channelId)) {
      errors.push({
        channel: ch.name,
        error:
          `Invalid channelId "${ch.channelId}". It should look like "UCxxxx...". ` +
          `If you only have a handle, you must find the channelId first.`,
      });
      continue;
    }

    try {
      const { ok, status, text } = await fetchWithTimeout(feedUrl, FETCH_TIMEOUT_MS);

      // If YouTube returns HTML, it usually means wrong channelId or blocked
      const looksLikeHtml = /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);

      if (!ok) {
        errors.push({
          channel: ch.name,
          error: `Failed RSS ${feedUrl} (${status}). Body starts: ${text.slice(0, 140)}`,
        });
        continue;
      }

      if (looksLikeHtml) {
        errors.push({
          channel: ch.name,
          error: `RSS returned HTML (not XML). Check channelId. Body starts: ${text
            .slice(0, 140)
            .replace(/\s+/g, " ")}`,
        });
        continue;
      }

      const atom = parseAtom(text);
      const items = atomEntriesToItems(atom, ch.name).slice(0, MAX_PER_CHANNEL);

      rawDebug.push({
        channel: ch.name,
        feedUrl,
        parsedCount: items.length,
      });

      allItems.push(...items);
    } catch (e) {
      errors.push({ channel: ch.name, error: String(e?.message || e) });
    }
  }

  const finalItems = dedupeAndSort(allItems).slice(0, MAX_TOTAL);

  const payload = {
    updated_at: nowIso(),
    items: finalItems,
    errors,
  };

  await fs.mkdir(path.dirname(OUT_YOUTUBE), { recursive: true });
  await fs.writeFile(OUT_YOUTUBE, JSON.stringify(payload, null, 2), "utf-8");
  await fs.writeFile(
    OUT_RAW,
    JSON.stringify({ updated_at: payload.updated_at, channels: rawDebug, errors }, null, 2),
    "utf-8"
  );

  // Hard fail ONLY if we produced zero valid items (so the workflow alerts you)
  if (finalItems.length === 0) {
    const firstErr = errors[0]?.error || "No items produced.";
    throw new Error(
      `YouTube output has 0 valid items. Check channelIds. First error: ${firstErr}`
    );
  }

  console.log(`✅ Wrote ${OUT_YOUTUBE} with ${finalItems.length} items.`);
  if (errors.length) console.log(`⚠️ ${errors.length} channel errors (see youtube.json / youtube_raw.json).`);
}

main().catch((err) => {
  console.error("❌", err?.message || err);
  process.exit(1);
});