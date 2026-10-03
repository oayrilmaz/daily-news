import fs from "node:fs";
import path from "node:path";

const NEWS_FILE = process.env.SOCIAL_NEWS_FILE || "data/news.json";
const STATE_FILE = process.env.SOCIAL_STATE_FILE || "data/social-published.json";
const QUEUE_FILE = process.env.SOCIAL_QUEUE_FILE || "data/social-queue.json";
const EXPLORE_DIR = process.env.SOCIAL_EXPLORE_DIR || "explore";

const SITE_ORIGIN = String(process.env.SITE_ORIGIN || "https://ptdtoday.com").replace(/\/+$/, "");
const TARGET_COUNT = positiveInt(process.env.SOCIAL_QUEUE_TARGET, 3);
const MAX_AGE_HOURS = positiveInt(process.env.SOCIAL_MAX_AGE_HOURS, 48);
const MIN_SCORE = finiteNumber(process.env.SOCIAL_MIN_SCORE, 2.5);

const NON_NEWS_RE =
  /\b(whitepaper|show preview|webinar|podcast|dcd studio|dcd talks|interview|opinion|sponsored|conference preview)\b/i;

// Keep unattended publishing away from political/electoral and acute-harm topics.
// Those can still be handled manually later.
const MANUAL_REVIEW_RE =
  /\b(election|electoral|ballot|campaign|candidate|president|prime minister|parliament|congress|senate|war|military strike|attack|shooting|killed|death toll|hostage|court appearance|indictment)\b/i;

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, "utf8");
  return raw.trim() ? JSON.parse(raw) : fallback;
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function truncate(value, limit) {
  const text = clean(value);
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(1, limit - 1)).trimEnd() + "…";
}

function safeSid(value) {
  return clean(value).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
}

function publishedTime(row) {
  const t = new Date(row?.published || row?.published_at || row?.date || "");
  return Number.isFinite(t.getTime()) ? t.getTime() : 0;
}

function ageHours(row, nowMs) {
  const t = publishedTime(row);
  return t ? (nowMs - t) / 36e5 : Number.POSITIVE_INFINITY;
}

function sourceUrlOk(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function developmentQuality(row) {
  const title = clean(row?.title);
  if (!title) return false;
  if (NON_NEWS_RE.test(title)) return false;
  if (MANUAL_REVIEW_RE.test(title)) return false;
  return true;
}

function rankRows(rows, nowMs) {
  return rows
    .filter(row => row && typeof row === "object")
    .filter(row => safeSid(row.sid))
    .filter(row => sourceUrlOk(row.url))
    .filter(row => ageHours(row, nowMs) <= MAX_AGE_HOURS)
    .filter(row => finiteNumber(row.score, 0) >= MIN_SCORE)
    .filter(developmentQuality)
    .sort((a, b) => {
      const scoreDiff = finiteNumber(b.score, 0) - finiteNumber(a.score, 0);
      if (scoreDiff) return scoreDiff;
      return publishedTime(b) - publishedTime(a);
    });
}

function selectDiverse(rows, publishedIds) {
  const selected = [];
  const publisherCount = new Map();

  for (const row of rows) {
    const sid = safeSid(row.sid);
    const itemId = `news-${sid}`;
    if (publishedIds.has(itemId)) continue;

    const publisher = clean(row.publisher).toLowerCase() || "unknown";
    const used = publisherCount.get(publisher) || 0;

    // Prefer diversity: no more than 2 automatic selections from one publisher.
    if (used >= 2) continue;

    selected.push(row);
    publisherCount.set(publisher, used + 1);
    if (selected.length >= TARGET_COUNT) break;
  }

  return selected;
}

function cosmosQuestion(title) {
  return `What could this development trigger next: ${clean(title)}?`;
}

function exploreHtml(row, exploreUrl, cosmosUrl) {
  const title = clean(row.title);
  const publisher = clean(row.publisher) || "the original source";
  const originalUrl = String(row.url || "");
  const published = clean(row.published);
  const description = truncate(
    `Start from “${title}” and explore what it could connect to or trigger next in PTD Today Cosmos.`,
    220
  );
  const image = `${SITE_ORIGIN}/cosmos-social-card.png`;

  const structured = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: exploreUrl,
    name: title,
    description,
    isPartOf: {
      "@type": "WebSite",
      url: `${SITE_ORIGIN}/`,
      name: "PTD Today"
    },
    about: {
      "@type": "Thing",
      name: title
    }
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} · Explore in Cosmos</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
  <link rel="canonical" href="${escapeHtml(exploreUrl)}">

  <meta property="og:type" content="article">
  <meta property="og:site_name" content="PTD Today · Cosmos">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(exploreUrl)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="627">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">

  <script type="application/ld+json">${structured}</script>
  <script>
    window.location.replace(${JSON.stringify(cosmosUrl)});
  </script>
</head>
<body>
  <main>
    <p>PTD Today Cosmos · Explore</p>
    <h1>${escapeHtml(title)}</h1>
    <p>Starting point from ${escapeHtml(publisher)}${published ? ` · ${escapeHtml(published)}` : ""}.</p>
    <p>Explore what this development could connect to or trigger next in Cosmos.</p>
    <p><a href="${escapeHtml(cosmosUrl)}">Open in Cosmos</a></p>
    <p><a href="${escapeHtml(originalUrl)}" rel="noopener noreferrer">Original source</a></p>
  </main>
</body>
</html>
`;
}

function makeQueueItem(row, createdAt) {
  const sid = safeSid(row.sid);
  const itemId = `news-${sid}`;
  const title = clean(row.title);
  const exploreUrl = `${SITE_ORIGIN}/explore/${encodeURIComponent(sid)}.html`;
  const question = cosmosQuestion(title);

  const cosmosUrl = `${SITE_ORIGIN}/cosmos.html?focus=question&question=${encodeURIComponent(question)}&new_topic=1`;

  const xTitle = truncate(title, 168);
  const xText = `${xTitle}\nWhat could this trigger next? #Cosmos`;

  const linkedinText =
    `${title}\n\nWhat could this development trigger next — across systems, markets, technology, and people?\n\nExplore it in Cosmos.`;

  return {
    queue: {
      id: itemId,
      enabled: true,
      created_at: createdAt,
      source_url: exploreUrl,
      title,
      x_text: xText,
      linkedin_text: linkedinText,
      platforms: ["x"],
      not_before: null,
      source_record: {
        sid,
        publisher: clean(row.publisher),
        original_url: String(row.url || ""),
        published: clean(row.published),
        score: finiteNumber(row.score, 0)
      }
    },
    sid,
    exploreUrl,
    cosmosUrl
  };
}

function main() {
  const news = loadJson(NEWS_FILE, []);
  if (!Array.isArray(news)) {
    throw new Error(`${NEWS_FILE} must contain a JSON array.`);
  }

  const state = loadJson(STATE_FILE, { schema_version: "1.0", published: [] });
  const publishedRows = Array.isArray(state.published) ? state.published : [];
  const publishedIds = new Set(
    publishedRows
      .filter(row => String(row?.platform || "").toLowerCase() === "x" && row?.status === "published")
      .map(row => String(row?.item_id || "").trim())
      .filter(Boolean)
  );

  const now = new Date();
  const nowMs = now.getTime();
  const createdAt = now.toISOString();

  const ranked = rankRows(news, nowMs);
  const selected = selectDiverse(ranked, publishedIds);

  fs.mkdirSync(EXPLORE_DIR, { recursive: true });

  const queueItems = [];

  for (const row of selected) {
    const built = makeQueueItem(row, createdAt);
    const html = exploreHtml(row, built.exploreUrl, built.cosmosUrl);
    fs.writeFileSync(path.join(EXPLORE_DIR, `${built.sid}.html`), html, "utf8");
    queueItems.push(built.queue);
  }

  const queue = {
    schema_version: "1.0",
    updated_at: createdAt,
    generated_by: "scripts/build_social_queue.mjs",
    policy: {
      source: NEWS_FILE,
      target_count: TARGET_COUNT,
      max_age_hours: MAX_AGE_HOURS,
      minimum_score: MIN_SCORE,
      auto_platforms: ["x"],
      note: "Automatic queue uses source-backed PTD Today news feed items only. AI-scenario briefing items are excluded."
    },
    items: queueItems
  };

  fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
  fs.writeFileSync(QUEUE_FILE, `${JSON.stringify(queue, null, 2)}\n`, "utf8");

  console.log(`Built ${queueItems.length} X queue item(s).`);
  for (const item of queueItems) {
    console.log(`- ${item.id}: ${item.title}`);
    console.log(`  ${item.source_url}`);
  }

  if (!queueItems.length) {
    console.log("No fresh eligible source-backed items were available. Queue remains empty.");
  }
}

try {
  main();
} catch (error) {
  console.error("SOCIAL_QUEUE_BUILDER_ERROR", error?.stack || error);
  process.exit(1);
}
