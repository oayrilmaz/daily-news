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
  } catch {
    console.warn(`Skipping RSS (fetch failed): ${url}`);
    return null;
  }
}

function extractEntries(xml) {
  // Extract <entry> blocks
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => m[1]);

  return entries.slice(0, 6).map(e => {
    const title = (e.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "").trim();
    const videoId = (e.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/)?.[1] || "").trim();
    const channel = (e.match(/<name>([\s\S]*?)<\/name>/)?.[1] || "").trim();
    const published = (e.match(/<published>([\s\S]*?)<\/published>/)?.[1] || "").trim();

    const url = videoId ? `https://www.youtube.com/watch?v=${videoId}` : "";

    if (!videoId || !title) return null;

    return { title, videoId, url, channel, published };
  }).filter(Boolean);
}

async function main() {
  const all = [];

  for (const url of RSS_LIST) {
    const xml = await fetchText(url);
    if (!xml) continue;
    all.push(...extractEntries(xml));
  }

  // de-dupe by videoId
  const map = new Map();
  for (const v of all) map.set(v.videoId, v);
  const items = [...map.values()].slice(0, 20);

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/youtube.json", JSON.stringify(items, null, 2));
  console.log(`Saved ${items.length} YouTube videos`);
}

main();