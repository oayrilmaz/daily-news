import fs from "fs";

const RSS_LIST = process.env.YOUTUBE_RSS_URLS
  ?.split("\n")
  .map(s => s.trim())
  .filter(Boolean);

if (!RSS_LIST || RSS_LIST.length === 0) {
  console.log("No YouTube RSS URLs found. Skipping.");
  process.exit(0);
}

async function fetchText(url) {
  try {
    const res = await fetch(url, { timeout: 15000 });
    if (!res.ok) {
      console.warn(`Skipping RSS (HTTP ${res.status}): ${url}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn(`Skipping RSS (fetch failed): ${url}`);
    return null;
  }
}

async function main() {
  const items = [];

  for (const url of RSS_LIST) {
    const xml = await fetchText(url);
    if (!xml) continue;

    const matches = [...xml.matchAll(/<title>(.*?)<\/title>/g)];
    matches.slice(1, 6).forEach(m => items.push(m[1]));
  }

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/youtube.json", JSON.stringify(items, null, 2));
  console.log(`Saved ${items.length} YouTube items`);
}

main();