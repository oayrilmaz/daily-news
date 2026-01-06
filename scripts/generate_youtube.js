import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

function splitUrls(raw) {
  if (!raw) return [];
  return raw
    .split(/[\n,]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "PTDTodayBot/1.0 (+https://ptdtoday.com)" }
  });
  if (!res.ok) throw new Error(`Failed to fetch RSS: ${url} (${res.status})`);
  return await res.text();
}

function parseYouTubeFeed(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
  });

  const obj = parser.parse(xml);
  const feed = obj.feed;
  if (!feed) return [];

  const entries = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : [];

  return entries.map((e) => {
    // YouTube Atom fields
    const videoId = e["yt:videoId"];
    const channelId = e["yt:channelId"];
    const title = typeof e.title === "string" ? e.title : e.title?.["#text"] || "";
    const published = e.published || "";
    const updated = e.updated || "";
    const linkHref =
      Array.isArray(e.link)
        ? (e.link.find((l) => l?.["@_rel"] === "alternate")?.["@_href"] || e.link[0]?.["@_href"])
        : e.link?.["@_href"];

    const authorName = e.author?.name || "";
    const authorUri = e.author?.uri || "";

    // Thumbnail is usually on media:group
    const thumb =
      e["media:group"]?.["media:thumbnail"]?.["@_url"] ||
      (Array.isArray(e["media:group"]?.["media:thumbnail"])
        ? e["media:group"]["media:thumbnail"][0]?.["@_url"]
        : "");

    return {
      source: "YouTube",
      channel: authorName,
      channelId,
      channelUrl: authorUri,
      videoId,
      title,
      url: linkHref || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ""),
      published,
      updated,
      thumbnail: thumb
    };
  });
}

async function main() {
  const urls = splitUrls(process.env.YOUTUBE_RSS_URLS);

  if (urls.length === 0) {
    console.log("No YOUTUBE_RSS_URLS provided. Skipping.");
    return;
  }

  const all = [];
  for (const u of urls) {
    const xml = await fetchText(u);
    const items = parseYouTubeFeed(xml);
    all.push(...items);
  }

  // Deduplicate by videoId
  const dedup = new Map();
  for (const it of all) {
    if (it.videoId) dedup.set(it.videoId, it);
  }

  // Sort by published desc
  const items = Array.from(dedup.values()).sort((a, b) => {
    const da = Date.parse(a.published || a.updated || 0) || 0;
    const db = Date.parse(b.published || b.updated || 0) || 0;
    return db - da;
  });

  const out = {
    updated_utc: new Date().toISOString(),
    source: "youtube_rss",
    count: items.length,
    items
  };

  // Write to data/youtube.json (create folder if needed)
  const outDir = path.join(process.cwd(), "data");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "youtube.json");

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${items.length} items -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});