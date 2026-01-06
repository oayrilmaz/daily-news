// scripts/generate_youtube.js
// Generates a simple JSON feed from one or more YouTube channel RSS URLs.
// Output: /briefs/youtube.json
// Env: YOUTUBE_RSS_URLS = comma/newline separated list of RSS URLs
// Example RSS URL:
// https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxxxxxxxxxxxxxxxxxxxx

import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

const OUT_FILE = "briefs/youtube.json";

function splitUrls(raw) {
  return (raw || "")
    .split(/[\n,]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "ptdtoday-bot/1.0 (+https://ptdtoday.com)",
      "accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    // Don’t hard-fail the whole workflow because of one bad channel.
    throw new Error(`Failed to fetch RSS: ${url} (${res.status})`);
  }
  return await res.text();
}

function parseRss(xmlText) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    // YouTube feeds use namespaces like yt:videoId, media:group, etc.
    removeNSPrefix: false,
  });

  const parsed = parser.parse(xmlText);
  const feed = parsed?.feed || {};
  const entries = feed?.entry ? (Array.isArray(feed.entry) ? feed.entry : [feed.entry]) : [];

  const channelTitle = feed?.title ?? "";
  const channelLink = feed?.link?.["@_href"] ?? "";

  const items = entries.map((e) => {
    const title = e?.title ?? "";
    const published = e?.published ?? "";
    const updated = e?.updated ?? "";
    const videoId = e?.["yt:videoId"] ?? "";
    const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : (e?.link?.["@_href"] ?? "");
    const authorName = e?.author?.name ?? "";

    // Thumbnail is usually in media:group > media:thumbnail
    let thumb = "";
    const mediaGroup = e?.["media:group"];
    const mediaThumb = mediaGroup?.["media:thumbnail"];
    if (Array.isArray(mediaThumb) && mediaThumb[0]?.["@_url"]) thumb = mediaThumb[0]["@_url"];
    else if (mediaThumb?.["@_url"]) thumb = mediaThumb["@_url"];

    return {
      title,
      published_at: published || updated,
      video_id: videoId,
      url: videoUrl,
      thumbnail: thumb,
      author: authorName,
    };
  });

  return {
    channel_title: channelTitle,
    channel_url: channelLink,
    items,
  };
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
  const urls = splitUrls(process.env.YOUTUBE_RSS_URLS);

  if (!urls.length) {
    // Still write a valid JSON so the site can render “no videos yet”
    await ensureDir(OUT_FILE);
    await fs.writeFile(
      OUT_FILE,
      JSON.stringify(
        {
          updated_at: new Date().toISOString(),
          items: [],
          warnings: ["YOUTUBE_RSS_URLS is empty."],
        },
        null,
        2
      )
    );
    console.log(`Wrote empty ${OUT_FILE} (no YOUTUBE_RSS_URLS provided).`);
    return;
  }

  const warnings = [];
  const all = [];

  for (const url of urls) {
    try {
      const xml = await fetchText(url);
      const parsed = parseRss(xml);

      const channelItems = (parsed.items || []).map((it) => ({
        ...it,
        source: "YouTube",
        channel_title: parsed.channel_title || "",
        channel_url: parsed.channel_url || "",
      }));

      all.push(...channelItems);
      console.log(`OK: ${parsed.channel_title || "YouTube channel"} (${channelItems.length} items)`);
    } catch (err) {
      warnings.push(String(err?.message || err));
      console.log(`WARN: ${String(err?.message || err)}`);
    }
  }

  // Sort newest first
  all.sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));

  const payload = {
    updated_at: new Date().toISOString(),
    items: all.slice(0, 50), // keep it light
    warnings,
  };

  await ensureDir(OUT_FILE);
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUT_FILE} (${payload.items.length} videos).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});