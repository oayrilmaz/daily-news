// scripts/generate_youtube.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Parser from "rss-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(process.cwd(), "data");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "youtube.json");

const parser = new Parser();

// Read YouTube RSS URLs from GitHub secret
const RSS_URLS = process.env.YOUTUBE_RSS_URLS
  ? process.env.YOUTUBE_RSS_URLS.split(",").map(u => u.trim()).filter(Boolean)
  : [];

if (!RSS_URLS.length) {
  console.log("No YOUTUBE_RSS_URLS provided. Skipping YouTube generation.");
  process.exit(0);
}

async function run() {
  const items = [];

  for (const url of RSS_URLS) {
    try {
      const feed = await parser.parseURL(url);

      for (const entry of feed.items.slice(0, 5)) {
        items.push({
          title: entry.title,
          url: entry.link,
          published_at: entry.pubDate,
          source: feed.title || "YouTube",
          platform: "YouTube"
        });
      }
    } catch (err) {
      console.error("Failed to parse:", url, err.message);
    }
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      {
        updated_at: new Date().toISOString(),
        items
      },
      null,
      2
    )
  );

  console.log(`YouTube JSON generated with ${items.length} items`);
}

run();