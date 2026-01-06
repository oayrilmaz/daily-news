/**
 * scripts/generate_youtube.js
 *
 * Generates:
 *  - data/youtube_latest.json  (latest videos from channel RSS feeds)
 *  - data/youtube_top.json     (top viewed among recent videos if YOUTUBE_API_KEY provided)
 *
 * Secrets / env:
 *  - YOUTUBE_RSS_URLS   (required) multi-line RSS feed URLs
 *  - YOUTUBE_API_KEY    (optional) YouTube Data API v3 key for view counts
 *  - YOUTUBE_DAYS       (optional) default 7
 *  - YOUTUBE_MAX_PER_CHANNEL (optional) default 12
 *  - YOUTUBE_TOP_N      (optional) default 10
 */

const fs = require("fs");
const path = require("path");

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "ptdtoday-bot/1.0" } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

function safeJsonWrite(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

function parseBetween(s, start, end) {
  const a = s.indexOf(start);
  if (a < 0) return null;
  const b = s.indexOf(end, a + start.length);
  if (b < 0) return null;
  return s.slice(a + start.length, b);
}

function stripCdata(s) {
  return (s || "").replace("<![CDATA[", "").replace("]]>", "").trim();
}

/**
 * Minimal XML parsing for YouTube RSS:
 * We extract <entry> blocks and pull:
 *  - <yt:videoId>
 *  - <title>
 *  - <published>
 *  - <name> (author)
 *  - <media:thumbnail url="...">
 */
function parseYouTubeRss(xmlText) {
  const entries = [];
  const parts = xmlText.split("<entry>").slice(1);

  for (const part of parts) {
    const entryXml = part.split("</entry>")[0] || "";

    const videoId = stripCdata(parseBetween(entryXml, "<yt:videoId>", "</yt:videoId>"));
    const title = stripCdata(parseBetween(entryXml, "<title>", "</title>"));
    const published = stripCdata(parseBetween(entryXml, "<published>", "</published>"));
    const channelName = stripCdata(parseBetween(entryXml, "<name>", "</name>"));

    // thumbnail: <media:thumbnail url="..." ... />
    let thumb = null;
    const thumbIdx = entryXml.indexOf("<media:thumbnail");
    if (thumbIdx >= 0) {
      const chunk = entryXml.slice(thumbIdx, thumbIdx + 250);
      const m = chunk.match(/url="([^"]+)"/i);
      if (m && m[1]) thumb = m[1];
    }

    if (!videoId) continue;

    entries.push({
      video_id: videoId,
      title: title || "Untitled",
      published_at: published || null,
      channel_name: channelName || null,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail: thumb,
      source: "YouTube",
    });
  }

  return entries;
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function daysAgoIso(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function withinDays(item, days) {
  if (!item.published_at) return true;
  const t = Date.parse(item.published_at);
  if (Number.isNaN(t)) return true;
  return t >= Date.parse(daysAgoIso(days));
}

async function getVideoStats(apiKey, videoIds) {
  // YouTube Data API v3: videos.list?part=statistics&id=...&key=...
  // limit 50 ids per call
  const chunks = [];
  for (let i = 0; i < videoIds.length; i += 50) chunks.push(videoIds.slice(i, i + 50));

  const stats = new Map();

  for (const ids of chunks) {
    const url =
      "https://www.googleapis.com/youtube/v3/videos" +
      `?part=statistics&id=${encodeURIComponent(ids.join(","))}&key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`YouTube API error ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const items = Array.isArray(json.items) ? json.items : [];
    for (const it of items) {
      const id = it.id;
      const viewCount = Number(it?.statistics?.viewCount || 0);
      stats.set(id, { viewCount });
    }
  }

  return stats;
}

async function main() {
  const rssRaw = process.env.YOUTUBE_RSS_URLS || "";
  const rssUrls = rssRaw
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  if (!rssUrls.length) {
    throw new Error("Missing YOUTUBE_RSS_URLS (must be one RSS URL per line).");
  }

  const DAYS = Number(process.env.YOUTUBE_DAYS || 7);
  const MAX_PER_CHANNEL = Number(process.env.YOUTUBE_MAX_PER_CHANNEL || 12);
  const TOP_N = Number(process.env.YOUTUBE_TOP_N || 10);

  // 1) Fetch RSS feeds
  const allLatest = [];
  for (const rssUrl of rssUrls) {
    try {
      const xml = await fetchText(rssUrl);
      const parsed = parseYouTubeRss(xml)
        .sort((a, b) => Date.parse(b.published_at || 0) - Date.parse(a.published_at || 0))
        .slice(0, MAX_PER_CHANNEL);

      // attach rssUrl so you can trace later
      for (const v of parsed) {
        v.rss = rssUrl;
        allLatest.push(v);
      }
    } catch (e) {
      allLatest.push({
        video_id: null,
        title: `Feed error: ${rssUrl}`,
        published_at: new Date().toISOString(),
        channel_name: null,
        url: null,
        thumbnail: null,
        source: "YouTube",
        error: String(e.message || e),
      });
    }
  }

  const latestClean = uniqBy(
    allLatest.filter((x) => x.video_id),
    (x) => x.video_id
  ).sort((a, b) => Date.parse(b.published_at || 0) - Date.parse(a.published_at || 0));

  const latestPayload = {
    updated_at: new Date().toISOString(),
    days_window: DAYS,
    count: latestClean.length,
    items: latestClean,
    disclaimer:
      "YouTube section shows public videos from the listed channels. Titles/descriptions belong to their respective owners.",
  };

  safeJsonWrite("data/youtube_latest.json", latestPayload);

  // 2) If API key exists, compute top viewed among recent items (last DAYS)
  const apiKey = process.env.YOUTUBE_API_KEY || "";
  if (apiKey) {
    const recent = latestClean.filter((x) => withinDays(x, DAYS));
    const ids = recent.map((x) => x.video_id);
    const stats = await getVideoStats(apiKey, ids);

    const enriched = recent.map((x) => {
      const s = stats.get(x.video_id) || { viewCount: 0 };
      return {
        ...x,
        views: s.viewCount,
      };
    });

    enriched.sort((a, b) => (b.views || 0) - (a.views || 0));

    const topPayload = {
      updated_at: new Date().toISOString(),
      days_window: DAYS,
      count: Math.min(TOP_N, enriched.length),
      items: enriched.slice(0, TOP_N),
      disclaimer:
        "Top viewed is calculated from recent videos (from the RSS list) using YouTube public view counts.",
    };

    safeJsonWrite("data/youtube_top.json", topPayload);
  } else {
    // write a small “not available” file so the UI can handle it gracefully
    safeJsonWrite("data/youtube_top.json", {
      updated_at: new Date().toISOString(),
      days_window: DAYS,
      count: 0,
      items: [],
      note: "No YOUTUBE_API_KEY provided, so view-based ranking is disabled.",
    });
  }

  console.log("✅ Generated data/youtube_latest.json and data/youtube_top.json");
}

main().catch((err) => {
  console.error("❌ generate_youtube.js failed:", err);
  process.exit(1);
});