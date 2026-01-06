/**
 * Generates /data/youtube.json from YouTube RSS feeds.
 * No npm deps. Uses built-in fetch (Node 20+).
 *
 * You provide channel RSS URLs in YOUTUBE_RSS_URLS env (comma-separated).
 * Example:
 *  https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxx,https://www.youtube.com/feeds/videos.xml?channel_id=UCyyyy
 */

import fs from "fs";
import path from "path";

const OUT_PATH = path.join("data", "youtube.json");

// ---- CONFIG ----
const MAX_ITEMS_TOTAL = Number(process.env.YOUTUBE_MAX_ITEMS || 12);
const MAX_ITEMS_PER_FEED = Number(process.env.YOUTUBE_MAX_PER_FEED || 6);
const RSS_URLS = (process.env.YOUTUBE_RSS_URLS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// If you don’t set YOUTUBE_RSS_URLS, we still write a valid json with empty items.
function nowIso() {
  return new Date().toISOString();
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function stripCdata(s) {
  return (s || "").replace("<![CDATA[", "").replace("]]>", "").trim();
}

function pickTag(xml, tag) {
  // very small RSS parser (good enough for YouTube RSS)
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? stripCdata(m[1]) : "";
}

function pickAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]+)"[^>]*\\/?>`, "i");
  const m = xml.match(re);
  return m ? m[1] : "";
}

function splitEntries(xml) {
  // YouTube RSS uses <entry> blocks
  return xml.split(/<entry>/i).slice(1).map(chunk => "<entry>" + chunk);
}

function safeText(s, max = 300) {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "ptdtoday-bot/1.0" } });
  if (!res.ok) throw new Error(`RSS fetch failed ${res.status} for ${url}`);
  return await res.text();
}

function extractVideoId(entryXml) {
  // <yt:videoId>VIDEOID</yt:videoId>
  const vid = pickTag(entryXml, "yt:videoId");
  if (vid) return vid;

  // fallback: <link rel="alternate" href="https://www.youtube.com/watch?v=VIDEOID"/>
  const href = pickAttr(entryXml, "link", "href");
  const m = (href || "").match(/[?&]v=([^&]+)/);
  return m ? m[1] : "";
}

async function main() {
  ensureDir("data");

  if (!RSS_URLS.length) {
    const payload = {
      updated_at: nowIso(),
      title: "Video Briefs",
      disclaimer: "YouTube video links are provided for convenience; ownership remains with original publishers.",
      items: []
    };
    fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
    console.log(`Wrote ${OUT_PATH} (no feeds configured).`);
    return;
  }

  let all = [];

  for (const rssUrl of RSS_URLS) {
    try {
      const xml = await fetchText(rssUrl);

      const feedTitle = safeText(pickTag(xml, "title"), 120) || "YouTube";
      const entries = splitEntries(xml).slice(0, MAX_ITEMS_PER_FEED);

      for (const e of entries) {
        const title = safeText(pickTag(e, "title"), 140);
        const published = pickTag(e, "published") || pickTag(e, "updated") || "";
        const author = safeText(pickTag(e, "name") || pickTag(e, "author"), 80) || feedTitle;

        const videoId = extractVideoId(e);
        const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : "";
        const embedUrl = videoId ? `https://www.youtube.com/embed/${videoId}` : "";

        if (!title || !videoId) continue;

        all.push({
          type: "video",
          source: "YouTube",
          channel: author,
          title,
          published_at: published,
          video_id: videoId,
          watch_url: watchUrl,
          embed_url: embedUrl
        });
      }
    } catch (err) {
      console.error(`Feed failed: ${rssUrl} — ${err.message}`);
    }
  }

  // newest first
  all.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));

  // limit
  all = all.slice(0, MAX_ITEMS_TOTAL);

  const payload = {
    updated_at: nowIso(),
    title: "Video Briefs",
    disclaimer: "YouTube video links are provided for convenience; ownership remains with original publishers.",
    items: all
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUT_PATH} (${all.length} items).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});