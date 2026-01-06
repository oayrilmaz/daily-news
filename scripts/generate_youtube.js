import fs from "fs";
import path from "path";
import { XMLParser } from "fast-xml-parser";

const OUT_PATH = "data/youtube.json";

const RSS_URLS = (process.env.YOUTUBE_RSS_URLS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

if (!RSS_URLS.length) {
  console.error("No YOUTUBE_RSS_URLS defined");
  process.exit(1);
}

const parser = new XMLParser({
  ignoreAttributes: false,
});

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed RSS ${url} (${res.status})`);
  return res.text();
}

function extractVideoId(link) {
  try {
    const u = new URL(link);
    return u.searchParams.get("v");
  } catch {
    return null;
  }
}

async function main() {
  const items = [];

  for (const url of RSS_URLS) {
    const xml = await fetchText(url);
    const json = parser.parse(xml);

    const entries = json?.feed?.entry;
    if (!entries) continue;

    const list = Array.isArray(entries) ? entries : [entries];

    for (const e of list) {
      const link =
        typeof e.link === "string"
          ? e.link
          : e.link?.["@_href"];

      const videoId =
        e["yt:videoId"] ||
        extractVideoId(link);

      if (!e.title || !videoId) continue;

      items.push({
        title: e.title,
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        channel: e.author?.name || "YouTube",
        published: e.published || e.updated || null,
      });
    }
  }

  const payload = {
    updated_at: new Date().toISOString(),
    items,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));

  console.log(`YouTube JSON written: ${items.length} items`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});