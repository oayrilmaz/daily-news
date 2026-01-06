import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Parser from "rss-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT = path.join(__dirname, "../public/youtube.json");

const rssUrls = process.env.YOUTUBE_RSS_URLS
  ? process.env.YOUTUBE_RSS_URLS.split(",").map(u => u.trim())
  : [];

if (!rssUrls.length) {
  console.log("No YouTube RSS URLs configured.");
  process.exit(0);
}

const parser = new Parser();

const items = [];

for (const url of rssUrls) {
  try {
    const feed = await parser.parseURL(url);
    for (const entry of feed.items.slice(0, 5)) {
      items.push({
        title: entry.title,
        link: entry.link,
        published: entry.pubDate,
        channel: feed.title
      });
    }
  } catch (err) {
    console.error("RSS error:", url, err.message);
  }
}

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    {
      updated: new Date().toISOString(),
      count: items.length,
      videos: items
    },
    null,
    2
  )
);

console.log(`YouTube JSON generated: ${items.length} items`);