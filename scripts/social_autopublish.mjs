import fs from "node:fs";
import crypto from "node:crypto";

const QUEUE_FILE = process.env.SOCIAL_QUEUE_FILE || "data/social-queue.json";
const STATE_FILE = process.env.SOCIAL_STATE_FILE || "data/social-published.json";
const MODE = String(process.env.SOCIAL_MODE || "preview").trim().toLowerCase();
const PLATFORM = String(process.env.SOCIAL_PLATFORM || "all").trim().toLowerCase();
const ENABLED = String(process.env.SOCIAL_AUTOPUBLISH_ENABLED || "false").trim().toLowerCase() === "true";

const MAX_LINKEDIN_PER_DAY = toPositiveInt(process.env.MAX_LINKEDIN_PER_DAY, 1);
const MAX_X_PER_DAY = toPositiveInt(process.env.MAX_X_PER_DAY, 3);
const MAX_LINKEDIN_PER_RUN = toPositiveInt(process.env.MAX_LINKEDIN_PER_RUN, 1);
const MAX_X_PER_RUN = toPositiveInt(process.env.MAX_X_PER_RUN, 1);

const LINKEDIN_VERSION = String(process.env.LINKEDIN_VERSION || "202609").trim();
const LINKEDIN_ACCESS_TOKEN = String(process.env.LINKEDIN_ACCESS_TOKEN || "").trim();
const LINKEDIN_AUTHOR_URN = String(process.env.LINKEDIN_AUTHOR_URN || "").trim();

const X_API_KEY = String(process.env.X_API_KEY || "").trim();
const X_API_SECRET = String(process.env.X_API_SECRET || "").trim();
const X_ACCESS_TOKEN = String(process.env.X_ACCESS_TOKEN || "").trim();
const X_ACCESS_TOKEN_SECRET = String(process.env.X_ACCESS_TOKEN_SECRET || "").trim();

const ALLOWED_HOSTS = new Set(["ptdtoday.com", "www.ptdtoday.com", "share.ptdtoday.com"]);
const now = new Date();
const todayUtc = now.toISOString().slice(0, 10);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function loadJson(path, fallback) {
  if (!fs.existsSync(path)) return fallback;
  const raw = fs.readFileSync(path, "utf8");
  return raw.trim() ? JSON.parse(raw) : fallback;
}

function saveState(state) {
  state.updated_at = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function cleanText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function canonicalUrl(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "https:") throw new Error(`Only https URLs are allowed: ${url.href}`);
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`Social queue URL is outside PTD Today: ${url.href}`);
  }
  url.hash = "";
  return url.href;
}

function appendUrl(text, url) {
  const clean = cleanText(text);
  return clean.includes(url) ? clean : `${clean}\n\n${url}`.trim();
}

function xText(item, url) {
  const text = appendUrl(item.x_text || item.short_text || item.title, url);
  if (text.length > 280) {
    throw new Error(`X text for ${item.id} is ${text.length} chars; maximum is 280.`);
  }
  return text;
}

function linkedInText(item, url) {
  return appendUrl(item.linkedin_text || item.long_text || item.title, url);
}

function platformWanted(name) {
  if (PLATFORM === "all") return true;
  return PLATFORM === name;
}

function itemPlatformEnabled(item, name) {
  const platforms = Array.isArray(item.platforms) ? item.platforms.map(v => String(v).toLowerCase()) : ["linkedin", "x"];
  return platforms.includes(name);
}

function isDue(item) {
  if (!item.not_before) return true;
  const t = new Date(item.not_before);
  return Number.isFinite(t.getTime()) && t.getTime() <= now.getTime();
}

function alreadyPublished(state, itemId, platform) {
  return state.published.some(row => row.item_id === itemId && row.platform === platform && row.status === "published");
}

function publishedToday(state, platform) {
  return state.published.filter(row => row.platform === platform && row.status === "published" && String(row.published_at || "").slice(0, 10) === todayUtc).length;
}

function recordPublished(state, item, platform, postId, sourceUrl) {
  state.published.push({
    item_id: item.id,
    platform,
    source_url: sourceUrl,
    post_id: postId || "",
    published_at: new Date().toISOString(),
    status: "published"
  });
}

function pctEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function oauth1Header(method, url, consumerKey, consumerSecret, accessToken, accessTokenSecret) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(18).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0"
  };

  const normalized = Object.entries(oauth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${pctEncode(k)}=${pctEncode(v)}`)
    .join("&");

  const base = [method.toUpperCase(), pctEncode(url), pctEncode(normalized)].join("&");
  const key = `${pctEncode(consumerSecret)}&${pctEncode(accessTokenSecret)}`;
  oauth.oauth_signature = crypto.createHmac("sha1", key).update(base).digest("base64");

  return "OAuth " + Object.entries(oauth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${pctEncode(k)}=\"${pctEncode(v)}\"`)
    .join(", ");
}

async function publishX(text) {
  for (const [name, value] of Object.entries({ X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET })) {
    if (!value) throw new Error(`${name} is required for live X publishing.`);
  }

  const endpoint = "https://api.x.com/2/tweets";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: oauth1Header("POST", endpoint, X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  });

  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!response.ok) throw new Error(`X API ${response.status}: ${raw.slice(0, 1200)}`);
  return String(data?.data?.id || "");
}

async function publishLinkedIn(commentary) {
  if (!LINKEDIN_ACCESS_TOKEN) throw new Error("LINKEDIN_ACCESS_TOKEN is required for live LinkedIn publishing.");
  if (!LINKEDIN_AUTHOR_URN) throw new Error("LINKEDIN_AUTHOR_URN is required for live LinkedIn publishing.");

  const response = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LINKEDIN_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "Linkedin-Version": LINKEDIN_VERSION
    },
    body: JSON.stringify({
      author: LINKEDIN_AUTHOR_URN,
      commentary,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: []
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false
    })
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`LinkedIn API ${response.status}: ${raw.slice(0, 1200)}`);
  return String(response.headers.get("x-restli-id") || "");
}

function validateItem(item) {
  if (!item || typeof item !== "object") throw new Error("Queue item must be an object.");
  if (!item.id || !String(item.id).trim()) throw new Error("Queue item is missing id.");
  const url = canonicalUrl(item.source_url);
  return { ...item, id: String(item.id).trim(), source_url: url };
}

async function main() {
  if (!["preview", "live"].includes(MODE)) throw new Error(`SOCIAL_MODE must be preview or live; got ${MODE}`);
  if (!["all", "linkedin", "x"].includes(PLATFORM)) throw new Error(`SOCIAL_PLATFORM must be all, linkedin, or x; got ${PLATFORM}`);
  if (MODE === "live" && !ENABLED) {
    throw new Error("Live mode is locked. Set repository variable SOCIAL_AUTOPUBLISH_ENABLED=true before publishing.");
  }

  const queue = loadJson(QUEUE_FILE, { schema_version: "1.0", items: [] });
  const state = loadJson(STATE_FILE, { schema_version: "1.0", published: [] });
  if (!Array.isArray(queue.items)) throw new Error(`${QUEUE_FILE} must contain items[].`);
  if (!Array.isArray(state.published)) state.published = [];

  const candidates = queue.items
    .filter(item => item?.enabled !== false)
    .filter(isDue)
    .map(validateItem)
    .sort((a, b) => String(a.not_before || a.created_at || "").localeCompare(String(b.not_before || b.created_at || "")));

  const dailyRemaining = {
    linkedin: Math.max(0, MAX_LINKEDIN_PER_DAY - publishedToday(state, "linkedin")),
    x: Math.max(0, MAX_X_PER_DAY - publishedToday(state, "x"))
  };
  const runRemaining = { linkedin: MAX_LINKEDIN_PER_RUN, x: MAX_X_PER_RUN };

  let actions = 0;
  console.log(`PTD Today social publisher: mode=${MODE} platform=${PLATFORM} candidates=${candidates.length}`);

  for (const item of candidates) {
    for (const platform of ["linkedin", "x"]) {
      if (!platformWanted(platform) || !itemPlatformEnabled(item, platform)) continue;
      if (alreadyPublished(state, item.id, platform)) continue;
      if (dailyRemaining[platform] <= 0 || runRemaining[platform] <= 0) continue;

      const text = platform === "linkedin" ? linkedInText(item, item.source_url) : xText(item, item.source_url);
      console.log(`\n[${MODE.toUpperCase()}] ${platform.toUpperCase()} :: ${item.id}`);
      console.log(text);

      if (MODE === "live") {
        const postId = platform === "linkedin" ? await publishLinkedIn(text) : await publishX(text);
        recordPublished(state, item, platform, postId, item.source_url);
        saveState(state);
        console.log(`Published ${platform} post id=${postId || "(not returned)"}`);
      }

      dailyRemaining[platform] -= 1;
      runRemaining[platform] -= 1;
      actions += 1;
    }
  }

  if (!actions) console.log("No eligible social posts for this run.");
  if (MODE === "preview") console.log("Preview mode made no external API calls and changed no publish state.");
}

main().catch(error => {
  console.error("SOCIAL_AUTOPUBLISH_ERROR", error?.stack || error);
  process.exit(1);
});
