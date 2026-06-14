// scripts/generate_media.js
// PTD Today - Media Builder
// Search-first reliable version for PTD Today portfolio.

import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error("Missing required env var: " + name);
  return v;
}

function optEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

const SITE_ORIGIN = optEnv("SITE_ORIGIN", "https://ptdtoday.com").replace(/\/$/, "");
const GA_ID = optEnv("GA_ID", "");

const MAX_VIDEOS = Number(optEnv("MEDIA_MAX_VIDEOS", "24"));
const MAX_PER_CHANNEL = Number(optEnv("MEDIA_MAX_PER_CHANNEL", "6"));
const MAX_PER_SEARCH = Number(optEnv("MEDIA_MAX_PER_SEARCH", "10"));
const LOOKBACK_HOURS = Number(optEnv("MEDIA_LOOKBACK_HOURS", "2160"));
const MIN_MATCH_SCORE = Number(optEnv("MEDIA_MIN_MATCH_SCORE", "2"));
const MAX_AI_GATE = Number(optEnv("MEDIA_MAX_FILTER_AI", "60"));
const CAPTIONS_LANG = optEnv("MEDIA_CAPTIONS_LANG", "en");

const DEFAULT_CHANNELS = [
  "https://www.youtube.com/@GEVernova",
  "https://www.youtube.com/@SiemensEnergy",
  "https://www.youtube.com/@HitachiEnergy",
  "https://www.youtube.com/@SchneiderElectric",
  "https://www.youtube.com/@Eaton",
  "https://www.youtube.com/@NationalGridUK",
  "https://www.youtube.com/@PJMInterconnection",
  "https://www.youtube.com/@ERCOTISO",
  "https://www.youtube.com/@IEA",
  "https://www.youtube.com/@NREL",
  "https://www.youtube.com/@USDepartmentofEnergy",
  "https://www.youtube.com/@EPRI",
  "https://www.youtube.com/@CIGRE",
  "https://www.youtube.com/@ferc",
  "https://www.youtube.com/@IEEEorg",
  "https://www.youtube.com/@ABB",
  "https://www.youtube.com/@FluenceEnergy",
  "https://www.youtube.com/@WartsilaCorporation",
  "https://www.youtube.com/@NVIDIA",
  "https://www.youtube.com/@GoogleCloudTech",
  "https://www.youtube.com/@Microsoft"
];

const DEFAULT_SEARCH_QUERIES = [
  "power transmission grid",
  "electric grid modernization",
  "grid reliability power transmission",
  "HVDC transmission project",
  "high voltage substation",
  "GIS gas insulated switchgear",
  "transformer shortage grid",
  "power grid interconnection queue",
  "data center power grid",
  "AI data center electricity demand",
  "AI energy demand grid",
  "AI infrastructure power demand",
  "renewable energy grid integration",
  "battery energy storage grid",
  "microgrid utility power",
  "offshore wind transmission grid",
  "critical minerals electrification grid",
  "electricity demand data centers",
  "utility grid planning",
  "power system reliability",
  "transmission planning renewable interconnection",
  "substation transformer grid modernization",
  "grid capacity data center load growth",
  "electric utilities load growth AI data centers"
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, obj) {
  writeFile(filePath, JSON.stringify(obj, null, 2));
}

function escapeHtml(str) {
  return (str ?? "").toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const clean = (s = "") => s.replace(/<!\[CDATA\[|\]\]>/g, "").trim();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchText(url, headers = {}, retries = 3) {
  const h = {
    "user-agent": "Mozilla/5.0 PTD-Bot/1.0 (+https://ptdtoday.com)",
    "accept": "text/html,application/xhtml+xml,application/xml,application/atom+xml,application/rss+xml,text/xml,text/plain,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.8",
    ...headers
  };

  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { headers: h });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(500 * (i + 1));
    }
  }

  return "";
}

function normalize(s) {
  return (s || "")
    .toString()
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function combinedText(v) {
  return normalize(
    v.title + " " +
    v.channel + " " +
    (v.description || "") + " " +
    (v.source_label || "")
  );
}

const HARD_EXCLUDE = [
  "laundromat",
  "laundry",
  "small business",
  "owner salary",
  "profit margin",
  "rent income",
  "side hustle",
  "passive income",
  "franchise",
  "world cup",
  "soccer",
  "football",
  "nfl",
  "nba",
  "nhl",
  "mlb",
  "gaming",
  "gameplay",
  "game trailer",
  "character reveal",
  "marvel",
  "rivals",
  "steam",
  "epic games",
  "playstation",
  "xbox",
  "nintendo",
  "movie",
  "film",
  "celebrity",
  "music video",
  "mindset",
  "high-performance coach",
  "high performance coach",
  "performance coach",
  "leadership coaching",
  "how to lead",
  "show up every day",
  "a-game",
  "personal development",
  "career advice",
  "productivity hacks",
  "insurance",
  "ubezpieczenia",
  "ubezpieczeniach",
  "actuarial",
  "actuary",
  "aktuariusze",
  "aon",
  "healthcare ai",
  "medical ai",
  "legal ai",
  "education ai",
  "retail ai",
  "marketing ai",
  "sales ai",
  "customer service ai",
  "video editing",
  "creator tools",
  "subtitles",
  "dubbing",
  "veed",
  "cinematic video generator",
  "content creator",
  "cobot",
  "flexpendant",
  "jogging",
  "operator onboarding",
  "robotics training",
  "e-learning",
  "tutorial",
  "training center",
  "election",
  "vote",
  "campaign",
  "candidate",
  "parliament",
  "congress",
  "senate",
  "president",
  "democrat",
  "republican",
  "prime minister",
  "ukraine",
  "russia",
  "israel",
  "gaza",
  "hamas",
  "iran",
  "war",
  "invasion",
  "border",
  "immigration",
  "abortion",
  "gun",
  "shooting",
  "protest",
  "riot",
  "supreme court",
  "scotus"
];

const STRONG_PTD_PHRASES = [
  "power transmission",
  "electric transmission",
  "transmission line",
  "transmission grid",
  "transmission planning",
  "transmission project",
  "power grid",
  "electric grid",
  "grid modernization",
  "grid reliability",
  "grid resilience",
  "grid connection",
  "grid interconnection",
  "interconnection queue",
  "queue reform",
  "substation",
  "substations",
  "high voltage",
  "extra high voltage",
  "hvdc",
  "facts",
  "flexible ac transmission",
  "statcom",
  "svc",
  "series capacitor",
  "fixed series capacitor",
  "synchronous condenser",
  "gas insulated switchgear",
  "switchgear",
  "transformer",
  "transformers",
  "shunt reactor",
  "capacitor bank",
  "protection relay",
  "relay protection",
  "scada",
  "power system",
  "power systems",
  "distribution grid",
  "distribution system",
  "utility grid",
  "electric utility",
  "electric utilities",
  "grid operator",
  "grid operators",
  "electricity demand",
  "electric demand",
  "load growth",
  "peak demand",
  "renewable integration",
  "renewables integration",
  "energy storage",
  "battery storage",
  "bess",
  "microgrid",
  "offshore wind",
  "solar interconnection",
  "wind interconnection",
  "data center power",
  "datacenter power",
  "data center electricity",
  "datacenter electricity",
  "data center energy",
  "datacenter energy",
  "data center grid",
  "datacenter grid",
  "data center load",
  "datacenter load",
  "data center cooling",
  "datacenter cooling",
  "liquid cooling",
  "ai electricity demand",
  "ai energy demand",
  "ai data center",
  "ai data centers",
  "ai infrastructure power",
  "grid capacity",
  "power capacity",
  "power availability",
  "power supply",
  "electricity supply",
  "critical minerals",
  "rare earth",
  "rare earths",
  "copper demand",
  "transformer shortage",
  "grid equipment",
  "electrical equipment",
  "energy infrastructure",
  "electric infrastructure",
  "electrification"
];

const SUPPORTING_TERMS = [
  "power",
  "electricity",
  "energy",
  "grid",
  "transmission",
  "distribution",
  "substation",
  "utility",
  "utilities",
  "interconnection",
  "load",
  "demand",
  "capacity",
  "renewable",
  "renewables",
  "solar",
  "wind",
  "storage",
  "battery",
  "nuclear",
  "infrastructure",
  "data center",
  "datacenter",
  "cooling",
  "transformer",
  "switchgear",
  "hvdc",
  "gis",
  "statcom",
  "facts",
  "epc",
  "oem",
  "electrification"
];

const AI_TERMS = [
  "ai",
  "artificial intelligence",
  "machine learning",
  "genai",
  "generative ai",
  "gpu",
  "gpus",
  "compute",
  "cloud",
  "data science",
  "digital twin"
];

const ENERGY_CONTEXT = [
  "power",
  "electricity",
  "energy",
  "grid",
  "utility",
  "utilities",
  "transmission",
  "distribution",
  "substation",
  "data center",
  "datacenter",
  "cooling",
  "load growth",
  "demand",
  "capacity",
  "infrastructure",
  "electrification",
  "renewable",
  "renewables",
  "nuclear",
  "storage"
];

const TRUSTED_ENERGY_CHANNELS = [
  "ge vernova",
  "siemens energy",
  "hitachi energy",
  "schneider electric",
  "eaton",
  "national grid",
  "pjm interconnection",
  "ercot",
  "iea",
  "nrel",
  "department of energy",
  "epri",
  "cigre",
  "ferc",
  "ieee",
  "fluence",
  "wartsila",
  "abb"
];

const BROAD_TECH_CHANNELS = [
  "nvidia",
  "google cloud",
  "microsoft"
];

function hasAny(text, arr) {
  return arr.some(k => text.includes(k));
}

function countMatches(text, arr) {
  let count = 0;
  for (const k of arr) {
    if (text.includes(k)) count += 1;
  }
  return count;
}

function isTrustedEnergyChannel(v) {
  const ch = normalize(v.channel || "");
  return TRUSTED_ENERGY_CHANNELS.some(c => ch.includes(c));
}

function isBroadTechChannel(v) {
  const ch = normalize(v.channel || "");
  return BROAD_TECH_CHANNELS.some(c => ch.includes(c));
}

function isHardExcluded(v) {
  return hasAny(combinedText(v), HARD_EXCLUDE);
}

function hasEnergyContext(text) {
  return hasAny(text, ENERGY_CONTEXT);
}

function keywordScore(v) {
  const text = combinedText(v);

  if (hasAny(text, HARD_EXCLUDE)) return -999;

  let score = 0;

  score += countMatches(text, STRONG_PTD_PHRASES) * 6;
  score += countMatches(text, SUPPORTING_TERMS) * 1;

  if (v.source_type === "search") score += 4;
  if (isTrustedEnergyChannel(v)) score += 4;

  if (hasAny(text, AI_TERMS) && hasEnergyContext(text)) score += 4;
  if (hasAny(text, AI_TERMS) && !hasEnergyContext(text)) score -= 8;

  if (isBroadTechChannel(v) && !hasEnergyContext(text)) score -= 12;
  if (isBroadTechChannel(v) && hasEnergyContext(text)) score += 2;

  return score;
}

function isRelevantByRules(v) {
  const text = combinedText(v);

  if (hasAny(text, HARD_EXCLUDE)) return false;

  if (hasAny(text, STRONG_PTD_PHRASES)) return true;

  if (v.source_type === "search" && countMatches(text, SUPPORTING_TERMS) >= 1) return true;

  if (isTrustedEnergyChannel(v) && countMatches(text, SUPPORTING_TERMS) >= 1) return true;

  if (hasAny(text, AI_TERMS) && hasEnergyContext(text)) return true;

  if (countMatches(text, SUPPORTING_TERMS) >= 3) return true;

  return false;
}

function parseMediaChannelsEnv() {
  const raw = optEnv("MEDIA_CHANNELS", "").trim();
  if (!raw) return DEFAULT_CHANNELS;
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

function parseSearchQueriesEnv() {
  const raw = optEnv("MEDIA_SEARCH_QUERIES", "").trim();
  if (!raw) return DEFAULT_SEARCH_QUERIES;
  return raw.split("|").map(s => s.trim()).filter(Boolean);
}

function parseYouTubeRSS(xml, sourceType = "channel", sourceLabel = "") {
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];

  return entries.map(e => {
    const title = clean((e.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const id = (e.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/i) || [])[1] || "";
    const pub = (e.match(/<published>([\s\S]*?)<\/published>/i) || [])[1] || "";
    const ch = clean((e.match(/<name>([\s\S]*?)<\/name>/i) || [])[1] || "YouTube");

    const desc = clean(
      (e.match(/<media:description[^>]*>([\s\S]*?)<\/media:description>/i) || [])[1] ||
      (e.match(/<content[^>]*>([\s\S]*?)<\/content>/i) || [])[1] ||
      ""
    );

    return {
      id,
      title,
      channel: ch,
      published_at: pub ? new Date(pub).toISOString() : new Date().toISOString(),
      url: id ? "https://www.youtube.com/watch?v=" + id : "",
      thumbnail: id ? "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg" : "",
      description: desc,
      source_type: sourceType,
      source_label: sourceLabel
    };
  }).filter(x => x.id && x.title);
}

async function collectFromSearchQueries(queries) {
  const all = [];

  for (const q of queries) {
    const url = "https://www.youtube.com/results?search_query=" +
      encodeURIComponent(q) +
      "&sp=CAI%253D";

    try {
      const html = await fetchText(url, { "accept": "text/html,*/*" }, 3);

      const ids = [];
      const re = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
      let m;

      while ((m = re.exec(html)) !== null) {
        if (!ids.includes(m[1])) ids.push(m[1]);
        if (ids.length >= MAX_PER_SEARCH) break;
      }

      for (const id of ids) {
        const meta = await fetchVideoMeta(id);

        all.push({
          id,
          title: meta.title || q,
          channel: meta.channel || "YouTube",
          published_at: meta.published_at || new Date().toISOString(),
          url: "https://www.youtube.com/watch?v=" + id,
          thumbnail: "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg",
          description: meta.description || "",
          source_type: "search",
          source_label: q
        });

        await sleep(80);
      }

      await sleep(150);
    } catch (e) {
      console.warn("YT search scrape failed:", q, e.message);
    }
  }

  return all;
}

async function fetchVideoMeta(videoId) {
  const url = "https://www.youtube.com/watch?v=" + encodeURIComponent(videoId);

  try {
    const html = await fetchText(url, { "accept": "text/html,*/*" }, 2);

    const title =
      ((html.match(/<meta property="og:title" content="([^"]*)"/i) || [])[1] || "")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&");

    const description =
      ((html.match(/<meta property="og:description" content="([^"]*)"/i) || [])[1] || "")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&");

    const channel =
      ((html.match(/"ownerChannelName":"([^"]+)"/i) || [])[1] || "")
        .replace(/\\u0026/g, "&");

    return {
      title,
      description,
      channel,
      published_at: new Date().toISOString()
    };
  } catch {
    return {
      title: "",
      description: "",
      channel: "",
      published_at: new Date().toISOString()
    };
  }
}

async function resolveToChannelId(input) {
  const s = input.trim();

  if (/^UC[a-zA-Z0-9_-]{10,}$/.test(s)) return s;

  let handle = "";

  if (s.includes("/@")) {
    handle = s.split("/@")[1].split(/[/?#]/)[0];
  } else if (s.startsWith("@")) {
    handle = s.slice(1);
  }

  if (!handle) return "";

  const url = "https://www.youtube.com/@" + encodeURIComponent(handle);

  try {
    const html = await fetchText(url, { "accept": "text/html,*/*" }, 2);
    const m = html.match(/"channelId":"(UC[a-zA-Z0-9_-]+)"/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

async function collectFromChannels(channelInputs) {
  const cutoffMs = Date.now() - LOOKBACK_HOURS * 3600 * 1000;
  const all = [];

  for (const inp of channelInputs) {
    const chId = await resolveToChannelId(inp);

    if (!chId) {
      console.warn("Could not resolve channel:", inp);
      continue;
    }

    const feed = "https://www.youtube.com/feeds/videos.xml?channel_id=" + encodeURIComponent(chId);

    try {
      const xml = await fetchText(feed, {}, 3);

      const vids = parseYouTubeRSS(xml, "channel", inp)
        .filter(v => new Date(v.published_at).getTime() >= cutoffMs)
        .slice(0, MAX_PER_CHANNEL);

      all.push(...vids);
      await sleep(120);
    } catch (e) {
      console.warn("YT feed failed:", chId, e.message);
    }
  }

  return all;
}

function dedupeAndSort(videos) {
  const seen = new Set();

  const out = videos.filter(v => {
    if (!v.id) return false;
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });

  out.sort((a, b) => {
    const sa = keywordScore(a);
    const sb = keywordScore(b);
    if (sb !== sa) return sb - sa;
    return new Date(b.published_at) - new Date(a.published_at);
  });

  return out;
}

async function fetchCaptions(videoId) {
  const url = "https://www.youtube.com/api/timedtext?lang=" +
    encodeURIComponent(CAPTIONS_LANG) +
    "&v=" +
    encodeURIComponent(videoId);

  try {
    const xml = await fetchText(url, {}, 2);
    if (!xml || !xml.includes("<text")) return "";

    const texts = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1]);

    return texts.join(" ")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12000);
  } catch {
    return "";
  }
}

async function aiGate(openai, v) {
  const system = `
You are a strict content gate for PTD Today.

ALLOW only if useful for PTD Today audiences:
- power transmission
- electric grid
- electric utilities
- substations
- high voltage equipment
- HVDC, FACTS, GIS, transformers, switchgear
- renewable integration
- storage, microgrids
- data center power, electricity demand, cooling, or grid connection
- AI electricity demand or AI infrastructure power
- energy infrastructure
- EPC or major grid infrastructure
- critical minerals for electrification

DISALLOW:
- laundromats, small business, owner salary, passive income
- sports, gaming, entertainment
- generic leadership, mindset, coaching
- insurance or actuarial AI
- healthcare/legal/retail/marketing AI
- generic video creation tools
- generic robotics training/tutorials
- politics, war, elections, ideology

Return JSON only:
{"allow": true/false, "reason": "short", "topic": "short label"}
`.trim();

  const user = `
Title: ${v.title}
Channel: ${v.channel}
Source: ${v.source_type || ""}
Source label: ${v.source_label || ""}
Published: ${v.published_at}

Description:
${v.description || "[none]"}

Transcript:
${v.transcript || "[none]"}
`.trim();

  const resp = await openai.responses.create({
    model: optEnv("OPENAI_MODEL", "gpt-5-mini"),
    input: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    text: { format: { type: "json_object" } }
  });

  let obj = {};
  try {
    obj = JSON.parse(resp.output_text || "{}");
  } catch {
    obj = {};
  }

  return {
    allow: !!obj.allow,
    reason: (obj.reason || "").toString().slice(0, 160),
    topic: (obj.topic || "").toString().slice(0, 100)
  };
}

async function summarizeVideo(openai, v) {
  const transcript = v.transcript || "";
  const desc = v.description || "";

  const system = `
You are PTD Today's Media summarizer.

Write for power transmission, grid, utility, EPC, high-voltage, renewable integration, data center power, AI infrastructure, and energy infrastructure professionals.

Rules:
- Use only transcript/description.
- If transcript is missing, say: "Based on the available description..."
- No speculation.
- No political commentary.
Return valid JSON only.
`.trim();

  const user = `
VIDEO:
Title: ${v.title}
Channel: ${v.channel}
Published: ${v.published_at}

Transcript:
${transcript ? transcript : "[No transcript available]"}

Description:
${desc ? desc : "[No description available]"}

Return JSON with exact keys:
{
  "summary": "2-3 sentences",
  "bullets": ["5 concise bullets max"],
  "takeaways": ["3-5 so what bullets for PTD Today readers"],
  "tags": ["6-10 short tags"]
}
`.trim();

  const resp = await openai.responses.create({
    model: optEnv("OPENAI_MODEL", "gpt-5-mini"),
    input: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    text: { format: { type: "json_object" } }
  });

  let obj = {};
  try {
    obj = JSON.parse(resp.output_text || "{}");
  } catch {
    obj = {};
  }

  return {
    summary: (obj.summary || "").toString().slice(0, 650),
    bullets: Array.isArray(obj.bullets) ? obj.bullets.map(String).slice(0, 5) : [],
    takeaways: Array.isArray(obj.takeaways) ? obj.takeaways.map(String).slice(0, 5) : [],
    tags: Array.isArray(obj.tags) ? obj.tags.map(String).slice(0, 10) : []
  };
}

function gaHead() {
  if (!GA_ID) return "";
  return `
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');
</script>`;
}

function renderMediaArticleHtml(item) {
  const id = item.id;
  const title = item.title || "PTD Today - Media";
  const channel = item.channel || "YouTube";
  const published = item.published_at || "";
  const youtubeUrl = item.url || "";
  const thumb = item.thumbnail || SITE_ORIGIN + "/assets/og-default.png";

  const ai = item.ai || {};
  const summary = ai.summary || "";
  const bullets = Array.isArray(ai.bullets) ? ai.bullets : [];
  const takeaways = Array.isArray(ai.takeaways) ? ai.takeaways : [];
  const tags = Array.isArray(ai.tags) ? ai.tags : [];

  const canonical = SITE_ORIGIN + "/media/" + encodeURIComponent(id) + ".html";
  const description = (summary || "PTD Today AI summary of a video from " + channel + ".")
    .replace(/\s+/g, " ")
    .slice(0, 180);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": title,
    "description": description,
    "datePublished": published || new Date().toISOString(),
    "dateModified": new Date().toISOString(),
    "mainEntityOfPage": canonical,
    "publisher": { "@type": "Organization", "name": "PTD Today" }
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} - PTD Today</title>
<meta name="description" content="${escapeHtml(description)}" />
<link rel="canonical" href="${escapeHtml(canonical)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="PTD Today" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:url" content="${escapeHtml(canonical)}" />
<meta property="og:image" content="${escapeHtml(thumb)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${escapeHtml(thumb)}" />
<script type="application/ld+json">${escapeHtml(JSON.stringify(jsonLd))}</script>
${gaHead()}
<style>
:root{--bg:#fff;--ink:#111;--muted:#5c5c5c;--rule:rgba(0,0,0,.15);--pill:rgba(0,0,0,.04);--btn:#111;--btnInk:#fff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Georgia,"Times New Roman",Times,serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:inherit}
.wrap{max-width:900px;margin:0 auto;padding:26px 16px 64px}
.mast{text-align:center;padding:16px 0 10px}
.brand{margin:0;font-size:52px;letter-spacing:.2px;font-weight:700}
.tagline{margin:6px 0 10px;color:var(--muted);font-style:italic;font-size:16px}
.nav{display:flex;justify-content:center;gap:14px;flex-wrap:wrap;margin:10px 0 10px}
.nav a{text-decoration:none;padding:7px 12px;border-radius:999px;border:1px solid transparent;color:rgba(0,0,0,.75);font-size:15px}
.nav a:hover{border-color:var(--rule);background:rgba(0,0,0,.02)}
.nav a.active{border-color:var(--rule);background:rgba(0,0,0,.03);font-weight:700;color:rgba(0,0,0,.92)}
.rule{height:1px;background:var(--rule);margin:14px 0 0}
.meta{color:var(--muted);font-size:12px;letter-spacing:.14px;text-transform:uppercase;margin:16px 0 8px}
h1{margin:0 0 10px;font-size:44px;line-height:1.03;font-weight:900}
.lede{font-size:18px;line-height:1.6;color:rgba(0,0,0,.86);margin:0 0 14px}
.card{border:1px solid var(--rule);border-radius:14px;overflow:hidden;background:#fff}
.thumb img{width:100%;display:block}
.content{padding:14px}
.subhead{margin:18px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.12px;color:var(--muted)}
ul{margin:0 0 12px;padding-left:18px}
li{margin:6px 0}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0}
.chip{display:inline-flex;align-items:center;padding:7px 10px;border-radius:999px;border:1px solid var(--rule);background:var(--pill);font-size:13px;color:rgba(0,0,0,.76)}
.btnRow{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 0}
.btn{appearance:none;border:1px solid var(--rule);background:var(--btn);color:var(--btnInk);padding:9px 14px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
.btn.secondary{background:#fff;color:#111}
.footer{text-align:center;margin-top:24px;color:var(--muted);font-size:13px}
@media(max-width:760px){.brand{font-size:44px}h1{font-size:38px}}
</style>
</head>
<body>
<div class="wrap">
<header class="mast">
<h1 class="brand">PTD Today</h1>
<div class="tagline">First to Know. First to Lead.</div>
<nav class="nav" aria-label="Primary navigation">
<a href="/index.html">Home</a>
<a href="/room.html">Room</a>
<a class="active" href="/media.html">Media</a>
<a href="/groups.html">Groups</a>
</nav>
<div class="rule"></div>
</header>
<div class="meta">VIDEO - ${escapeHtml(channel)} - ${escapeHtml(published)}</div>
<h1>${escapeHtml(title)}</h1>
${summary ? `<p class="lede">${escapeHtml(summary)}</p>` : ""}
<div class="card">
<div class="thumb"><img src="${escapeHtml(thumb)}" alt=""></div>
<div class="content">
<div class="btnRow">
<a class="btn" href="${escapeHtml(youtubeUrl)}" target="_blank" rel="noopener">Watch on YouTube</a>
<button class="btn secondary" id="shareBtn" type="button">Share</button>
</div>
${bullets.length ? `<div class="subhead">Key points</div><ul>${bullets.slice(0,8).map(b=>`<li>${escapeHtml(b)}</li>`).join("")}</ul>` : ""}
${takeaways.length ? `<div class="subhead">So what</div><ul>${takeaways.slice(0,5).map(t=>`<li>${escapeHtml(t)}</li>`).join("")}</ul>` : ""}
${tags.length ? `<div class="chips">${tags.slice(0,10).map(t=>`<span class="chip">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
</div>
</div>
<div class="footer">© ${new Date().getFullYear()} PTD Today</div>
</div>
<script>
(function(){
var url=${JSON.stringify(canonical)};
var title=${JSON.stringify(title)};
var text=${JSON.stringify(description)};
var btn=document.getElementById("shareBtn");
if(!btn)return;
btn.addEventListener("click",async function(){
if(navigator.share){
try{await navigator.share({title:title,text:text,url:url});return;}catch(e){return;}
}
try{await navigator.clipboard.writeText(url);alert("Link copied.");}
catch(e){prompt("Copy this link:",url);}
});
})();
</script>
</body>
</html>`;
}

async function main() {
  const apiKey = mustEnv("OPENAI_API_KEY");
  const openai = new OpenAI({ apiKey });

  const searchQueries = parseSearchQueriesEnv();
  const channelInputs = parseMediaChannelsEnv();

  const fromSearch = await collectFromSearchQueries(searchQueries);
  const fromChannels = await collectFromChannels(channelInputs);

  let videos = dedupeAndSort([...fromSearch, ...fromChannels]);
  videos = videos.slice(0, Math.max(MAX_VIDEOS * 12, 300));

  const kept = [];
  const borderline = [];

  for (const v of videos) {
    if (isHardExcluded(v)) {
      console.log("Blocked: " + v.title + " | " + v.channel);
      continue;
    }

    const score = keywordScore(v);
    v._score = score;

    if (score >= MIN_MATCH_SCORE && isRelevantByRules(v)) {
      kept.push(v);
    } else {
      borderline.push(v);
    }
  }

  const gated = [];
  const aiCandidates = borderline
    .filter(v => !isHardExcluded(v))
    .sort((a, b) => keywordScore(b) - keywordScore(a))
    .slice(0, MAX_AI_GATE);

  for (const v of aiCandidates) {
    v.transcript = await fetchCaptions(v.id);
    const gate = await aiGate(openai, v);

    if (gate.allow) {
      v._gate = gate;
      gated.push(v);
    } else {
      console.log("AI gate rejected: " + v.title + " | " + v.channel + " | " + gate.reason);
    }

    await sleep(120);
  }

  let finalList = [...kept, ...gated];

  finalList = finalList.filter(v => !isHardExcluded(v));
  finalList = finalList.filter(v => isRelevantByRules(v) || (v._gate && v._gate.allow));

  finalList = dedupeAndSort(finalList).slice(0, MAX_VIDEOS);

  const outItems = [];

  for (const v of finalList) {
    v.transcript = v.transcript || await fetchCaptions(v.id);
    v.ai = await summarizeVideo(openai, v);

    outItems.push({
      id: v.id,
      title: v.title,
      channel: v.channel,
      published_at: v.published_at,
      url: v.url,
      thumbnail: v.thumbnail,
      score: keywordScore(v),
      source_type: v.source_type,
      source_label: v.source_label,
      gate: v._gate || null,
      ai: v.ai
    });

    await sleep(140);
  }

  for (const it of outItems) {
    const html = renderMediaArticleHtml(it);
    writeFile(path.join("media", it.id + ".html"), html);
  }

  const payload = {
    title: "PTD Today - Media",
    disclaimer: "Informational only - AI-generated summaries; may contain errors. Verify with the original video.",
    updated_at: new Date().toISOString(),
    channels_tracked: channelInputs,
    searches_tracked: searchQueries,
    filter: {
      min_match_score: MIN_MATCH_SCORE,
      lookback_hours: LOOKBACK_HOURS,
      max_ai_gate: MAX_AI_GATE,
      scope: "Search-first PTD portfolio: power transmission, grid, substations, high voltage, utilities, data center power, AI electricity demand, renewables integration, storage, GIS, transformers, HVDC, FACTS, critical energy infrastructure"
    },
    items: outItems
  };

  writeJson(path.join("data", "media.json"), payload);
  console.log("Wrote: data/media.json (" + outItems.length + ") and media/*.html");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});