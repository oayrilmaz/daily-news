import fs from "node:fs";
import crypto from "node:crypto";

const QUEUE_FILE = process.env.SOCIAL_QUEUE_FILE || "data/social-queue.json";
const STATE_FILE = process.env.SOCIAL_STATE_FILE || "data/social-published.json";
const MODE = String(process.env.SOCIAL_MODE || "preview").trim().toLowerCase();
const PLATFORM = String(process.env.SOCIAL_PLATFORM || "all").trim().toLowerCase();
const ENABLED = String(process.env.SOCIAL_AUTOPUBLISH_ENABLED || "false").trim().toLowerCase() === "true";

// COSMOS Grok experiment: mentions remain opt-in and limited. X requires prior
// indication of consent for automated @mentions; a single Grok reply does not
// authorize unlimited ongoing mentions. "review" requires item.grok_approved;
// "auto" requires operator-confirmed permission via a separate variable.
const GROK_MODE = String(process.env.SOCIAL_GROK_MODE || "review").trim().toLowerCase();
const GROK_POLICY_AUTHORIZED = String(process.env.SOCIAL_GROK_POLICY_AUTHORIZED || "false").trim().toLowerCase() === "true";
const GROK_MAX_PER_DAY = 1; // intentionally not configurable: one at most per UTC day

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

// X/Twitter shortens every URL through t.co. The X character limit is therefore
// based on the transformed URL length, not the literal length of our /q/... URL.
// The previous raw text.length check incorrectly rejected valid Cosmos Question
// posts because a ~60-80 character PTD Today URL actually counts as 23 characters
// once posted to X.
const X_MAX_WEIGHTED_LENGTH = 280;
const X_TCO_URL_LENGTH = 23;
const X_URL_RE = /https?:\/\/[^\s]+/giu;

function xCodePointWeight(character) {
  const cp = character.codePointAt(0);
  // Mirrors the long-standing twitter-text weighting ranges used by X:
  // common Latin/basic punctuation count as 1; most other code points as 2.
  if (
    (cp >= 0x0000 && cp <= 0x10ff) ||
    (cp >= 0x2000 && cp <= 0x200d) ||
    (cp >= 0x2010 && cp <= 0x201f) ||
    (cp >= 0x2032 && cp <= 0x2037)
  ) return 1;
  return 2;
}

function xPlainWeightedLength(value) {
  let total = 0;
  for (const character of Array.from(String(value || ""))) {
    total += xCodePointWeight(character);
  }
  return total;
}

function xWeightedLength(value) {
  const text = String(value || "");
  let weighted = 0;
  let cursor = 0;

  for (const match of text.matchAll(X_URL_RE)) {
    const index = Number(match.index || 0);
    weighted += xPlainWeightedLength(text.slice(cursor, index));
    weighted += X_TCO_URL_LENGTH;
    cursor = index + match[0].length;
  }

  weighted += xPlainWeightedLength(text.slice(cursor));
  return weighted;
}

function xText(item, url) {
  const text = appendUrl(item.x_text || item.short_text || item.title, url);
  const weightedLength = xWeightedLength(text);

  if (weightedLength > X_MAX_WEIGHTED_LENGTH) {
    throw new Error(
      `X text for ${item.id} has weighted length ${weightedLength}; maximum is ${X_MAX_WEIGHTED_LENGTH}. ` +
      `Raw source length is ${text.length}.`
    );
  }

  return text;
}

function grokMentionedToday(state) {
  return state.published.filter(row => row.platform === "x" && row.status === "published" &&
    row.grok_mention === true && String(row.published_at || "").slice(0, 10) === todayUtc).length;
}

function eligibleGrokItem(item) {
  return itemPlatformEnabled(item, "x") && item.enabled !== false &&
    /\?/.test(String(item.x_text || "")) &&
    ["discovery", "playful"].includes(String(item.content_kind || ""));
}

function pickGrokItem(candidates, state) {
  if (GROK_MODE === "off" || grokMentionedToday(state) >= GROK_MAX_PER_DAY) return null;
  if (GROK_MODE === "auto" && !GROK_POLICY_AUTHORIZED) {
    console.log("GROK: auto mode blocked. X requires prior recipient opt-in for automated mentions; set SOCIAL_GROK_POLICY_AUTHORIZED only if you have confirmed authorization.");
    return null;
  }
  const unseen = candidates.filter(item => eligibleGrokItem(item) && !alreadyPublished(state, item.id, "x"));
  const allowed = GROK_MODE === "review" ? unseen.filter(item => item.grok_approved === true) : unseen;
  // Focus on a researched, high-interest question; otherwise choose an original
  // playful hypothetical. We do not mention Grok on every scheduled post.
  return allowed.find(item => item.content_kind === "discovery") || allowed[0] || null;
}

const GROK_PROMPTS = [
  "@grok — what surprising consequence are we missing?",
  "@grok — which outcome is the most plausible, and why?",
  "@grok — what would you challenge about this scenario?",
  "@grok — where could the biggest ripple effect appear?"
];

function grokPromptFor(item) {
  const digest = crypto.createHash("sha256").update(String(item.id)).digest();
  return GROK_PROMPTS[digest[0] % GROK_PROMPTS.length];
}

function grokXText(item, url, shouldMention) {
  if (!shouldMention) return xText(item, url);
  const existing = cleanText(item.x_text || item.short_text || item.title);
  if (/@grok\b/i.test(existing)) return xText(item, url);
  // Insert a direct, distinct question above topic hashtags; preserve the
  // canonical COSMOS destination link appended by xText().
  const hashtagLine = /(?:^|\n)(?:#[A-Za-z][A-Za-z0-9_]*\s*){1,4}$/m;
  const match = hashtagLine.exec(existing);
  const prompts = [grokPromptFor(item), "@grok — what do you think?", "@grok, your take?", "@grok?"];
  for (const prompt of prompts) {
    const augmented = match
      ? `${existing.slice(0, match.index).trimEnd()}\n\n${prompt}\n\n${existing.slice(match.index).trim()}`
      : `${existing}\n\n${prompt}`;
    try {
      return xText({ ...item, x_text: augmented }, url);
    } catch (error) {
      if (prompt === prompts[prompts.length - 1]) {
        console.warn(`GROK mention skipped for ${item.id}: ${error.message}`);
      }
    }
  }
  return xText(item, url);
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

function recordPublished(state, item, platform, postId, sourceUrl, grokMention = false) {
  state.published.push({
    item_id: item.id,
    platform,
    source_url: sourceUrl,
    post_id: postId || "",
    published_at: new Date().toISOString(),
    status: "published",
    ...(platform === "x" ? { grok_mention: Boolean(grokMention) } : {})
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

async function verifyXCredentials() {
  for (const [name, value] of Object.entries({ X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET })) {
    if (!value) throw new Error(`${name} is required for X credential verification.`);
  }

  const endpoint = "https://api.x.com/2/users/me";
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: oauth1Header("GET", endpoint, X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET)
    }
  });

  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }

  if (!response.ok) {
    throw new Error(`X credential check failed (${response.status}): ${raw.slice(0, 1200)}`);
  }

  const user = data?.data || {};
  const accessLevel = String(response.headers.get("x-access-level") || "").trim();
  console.log(`X credential verification succeeded for @${user.username || "unknown"} (${user.name || "unknown"}) id=${user.id || "unknown"}.`);
  if (accessLevel) console.log(`X reported access level: ${accessLevel}`);
  console.log("Verification used GET /2/users/me only. No post was created, edited, or deleted.");
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
  if (!["preview", "verify-x", "live"].includes(MODE)) throw new Error(`SOCIAL_MODE must be preview, verify-x, or live; got ${MODE}`);
  if (!["all", "linkedin", "x"].includes(PLATFORM)) throw new Error(`SOCIAL_PLATFORM must be all, linkedin, or x; got ${PLATFORM}`);
  if (!["off", "review", "auto"].includes(GROK_MODE)) throw new Error(`SOCIAL_GROK_MODE must be off, review, or auto; got ${GROK_MODE}`);
  if (MODE === "live" && !ENABLED) {
    throw new Error("Live mode is locked. Set repository variable SOCIAL_AUTOPUBLISH_ENABLED=true before publishing.");
  }

  if (MODE === "verify-x") {
    await verifyXCredentials();
    return;
  }

  const queue = loadJson(QUEUE_FILE, { schema_version: "1.0", items: [] });
  const state = loadJson(STATE_FILE, { schema_version: "1.0", published: [] });
  if (!Array.isArray(queue.items)) throw new Error(`${QUEUE_FILE} must contain items[].`);
  if (!Array.isArray(state.published)) state.published = [];

  // Catch accidental unsolicited direct mentions in legacy generated queue data.
  for (const item of queue.items) {
    if (/@grok\b/i.test(String(item?.x_text || "")) && item.grok_approved !== true &&
        !(GROK_MODE === "auto" && GROK_POLICY_AUTHORIZED)) {
      throw new Error(`Queue ${item.id}: @grok mention is not approved for automation.`);
    }
  }
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
  const grokTarget = pickGrokItem(candidates, state);
  let grokUsedThisRun = false;
  console.log(`PTD Today social publisher: mode=${MODE} platform=${PLATFORM} candidates=${candidates.length}`);
  console.log(`GROK mode=${GROK_MODE} target=${grokTarget?.id || "none"}; max_one_per_utc_day=true`);
  if (MODE === "preview" && grokTarget) {
    const draft = grokXText(grokTarget, grokTarget.source_url, true);
    console.log(`GROK PREVIEW (may be a later scheduled post): ${grokTarget.id}`);
    console.log(draft);
  }

  for (const item of candidates) {
    for (const platform of ["linkedin", "x"]) {
      if (!platformWanted(platform) || !itemPlatformEnabled(item, platform)) continue;
      if (alreadyPublished(state, item.id, platform)) continue;
      if (dailyRemaining[platform] <= 0 || runRemaining[platform] <= 0) continue;

      const isGrokTarget = platform === "x" && grokTarget?.id === item.id && !grokUsedThisRun;
      const text = platform === "linkedin" ? linkedInText(item, item.source_url) : grokXText(item, item.source_url, isGrokTarget);
      const grokTagged = platform === "x" && /@grok\b/i.test(text);
      console.log(`\n[${MODE.toUpperCase()}] ${platform.toUpperCase()} :: ${item.id}${grokTagged ? " [GROK MENTION]" : ""}`);
      console.log(text);

      if (MODE === "live") {
        const postId = platform === "linkedin" ? await publishLinkedIn(text) : await publishX(text);
        recordPublished(state, item, platform, postId, item.source_url, grokTagged);
        saveState(state);
        console.log(`Published ${platform} post id=${postId || "(not returned)"}`);
      }

      if (grokTagged) grokUsedThisRun = true;
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
