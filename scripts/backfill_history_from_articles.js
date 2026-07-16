// scripts/backfill_history_from_articles.js
// PTD Today — One-time historical backfill from existing article HTML files.
//
// Purpose:
//   - Scan articles/*.html
//   - Extract article metadata and content
//   - Rebuild history/YYYY-MM-DD.json
//   - Rebuild briefs/trends.json
//   - Rebuild briefs/outlook.json
//
// Usage:
//   node scripts/backfill_history_from_articles.js
//
// Optional environment variables:
//   ARTICLES_DIR=articles
//   HISTORY_DIR=history
//   BRIEFS_DIR=briefs
//
// Notes:
//   - Safe to run more than once.
//   - Existing history files for dates found in article HTML will be replaced.
//   - Older article HTML usually contains region metadata but not countries[].
//     Country-level history will therefore improve progressively as newer articles
//     include explicit countries metadata.

import fs from "fs";
import path from "path";

/* -------------------------------------------------------------------------- */
/* Filesystem helpers                                                         */
/* -------------------------------------------------------------------------- */

function optEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, value) {
  writeFile(filePath, JSON.stringify(value, null, 2));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJsonIfExists(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`Could not read ${filePath}: ${error.message}`);
    return fallback;
  }
}

function listHtmlFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];

  return fs
    .readdirSync(dirPath)
    .filter((name) => name.toLowerCase().endsWith(".html"))
    .sort();
}

/* -------------------------------------------------------------------------- */
/* Date helpers                                                               */
/* -------------------------------------------------------------------------- */

function utcDateOnly(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isoNow() {
  return new Date().toISOString();
}

function parseDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3])
    )
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function daysAgoDateOnly(daysAgo) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return utcDateOnly(date);
}

function isDateWithinDays(dateOnly, days) {
  const date = parseDateOnly(dateOnly);
  if (!date) return false;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const lowerBound = new Date(today);
  lowerBound.setUTCDate(today.getUTCDate() - Math.max(0, days - 1));

  return date >= lowerBound && date <= today;
}

/* -------------------------------------------------------------------------- */
/* Text helpers                                                               */
/* -------------------------------------------------------------------------- */

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/");
}

function stripTags(value) {
  return decodeHtml(
    String(value || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanString(value, fallback = "") {
  const text = stripTags(value).trim();
  return text || fallback;
}

function cleanStringArray(values, maxItems = 20) {
  const input = Array.isArray(values) ? values : [];
  const output = [];
  const seen = new Set();

  for (const raw of input) {
    const value = cleanString(raw);
    if (!value) continue;

    const key = value.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(value);

    if (output.length >= maxItems) break;
  }

  return output;
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

/* -------------------------------------------------------------------------- */
/* HTML extraction helpers                                                    */
/* -------------------------------------------------------------------------- */

function firstMatch(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function allMatches(html, pattern) {
  const output = [];
  let match;

  while ((match = pattern.exec(html)) !== null) {
    if (match[1]) output.push(match[1].trim());
  }

  return output;
}

function extractCanonical(html) {
  return firstMatch(html, [
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["'][^>]*>/i
  ]);
}

function extractArticleId(html, fileName) {
  const canonical = extractCanonical(html);
  const canonicalMatch = canonical.match(/\/articles\/([^/?#]+)\.html/i);

  if (canonicalMatch?.[1]) {
    return decodeURIComponent(canonicalMatch[1]);
  }

  return path.basename(fileName, ".html");
}

function extractTitle(html) {
  return cleanString(
    firstMatch(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<title>([\s\S]*?)<\/title>/i,
      /<h1[^>]*>([\s\S]*?)<\/h1>/i
    ]).replace(/\s+—\s+PTD Today\s*$/i, "")
  );
}

function extractDescription(html) {
  return cleanString(
    firstMatch(html, [
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i
    ])
  );
}

function extractLede(html) {
  return cleanString(
    firstMatch(html, [
      /<p[^>]+class=["'][^"']*\blede\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i
    ])
  );
}

function extractMeta(html) {
  const raw = cleanString(
    firstMatch(html, [
      /<div[^>]+class=["'][^"']*\bmeta\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
    ])
  );

  const parts = raw
    .split("•")
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    category: parts[0] || "Power Grid",
    region: parts[1] || "Global",
    created_at: parts[2] || ""
  };
}

function extractMainContentHtml(html) {
  return firstMatch(html, [
    /<div[^>]+class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div[^>]+class=["'][^"']*\bchips\b/i
  ]);
}

function extractBody(html) {
  const contentHtml = extractMainContentHtml(html);

  if (!contentHtml) return "";

  const bodyOnly = contentHtml
    .replace(
      /<div[^>]+class=["'][^"']*\bsubhead\b[^"']*["'][^>]*>\s*What to watch\s*<\/div>[\s\S]*$/i,
      ""
    )
    .replace(
      /<div[^>]+class=["'][^"']*\bsubhead\b[^"']*["'][^>]*>\s*Action\s*<\/div>[\s\S]*$/i,
      ""
    );

  return cleanString(bodyOnly);
}

function extractWatchlist(html) {
  const contentHtml = extractMainContentHtml(html);

  if (!contentHtml) return [];

  const section = firstMatch(contentHtml, [
    /<div[^>]+class=["'][^"']*\bsubhead\b[^"']*["'][^>]*>\s*What to watch\s*<\/div>\s*<ul[^>]*>([\s\S]*?)<\/ul>/i
  ]);

  return cleanStringArray(
    allMatches(section, /<li[^>]*>([\s\S]*?)<\/li>/gi),
    10
  );
}

function extractAction(html) {
  const contentHtml = extractMainContentHtml(html);

  if (!contentHtml) return "";

  return cleanString(
    firstMatch(contentHtml, [
      /<div[^>]+class=["'][^"']*\bsubhead\b[^"']*["'][^>]*>\s*Action\s*<\/div>\s*<p[^>]*>([\s\S]*?)<\/p>/i
    ])
  );
}

function extractChips(html) {
  const chipSection = firstMatch(html, [
    /<div[^>]+class=["'][^"']*\bchips\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  ]);

  return cleanStringArray(
    allMatches(
      chipSection,
      /<span[^>]+class=["'][^"']*\bchip\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi
    ),
    20
  );
}

function extractCountriesFromJsonLd(html) {
  const scriptMatches = allMatches(
    html,
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  for (const raw of scriptMatches) {
    try {
      const parsed = JSON.parse(raw);
      const about = Array.isArray(parsed?.about) ? parsed.about : [];

      return cleanStringArray(
        about.filter((value) => {
          const text = cleanString(value);
          return text && ![
            "Power Grid",
            "Substations",
            "Data Centers",
            "Renewables",
            "Markets",
            "Critical Minerals",
            "Policy",
            "OEM/EPC",
            "Global",
            "North America",
            "Europe",
            "Middle East",
            "Asia",
            "LATAM",
            "Africa"
          ].includes(text);
        }),
        8
      );
    } catch {
      // Ignore malformed or missing JSON-LD.
    }
  }

  return [];
}

function extractDateOnly(articleId, createdAt) {
  const idMatch = String(articleId || "").match(/ai-(\d{4})(\d{2})(\d{2})-/i);

  if (idMatch) {
    return `${idMatch[1]}-${idMatch[2]}-${idMatch[3]}`;
  }

  const dateMatch = String(createdAt || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return dateMatch?.[1] || "";
}

function inferConfidence(body, lede) {
  const text = `${lede} ${body}`.toLowerCase();

  let score = 0.7;

  if (
    text.includes("signals") ||
    text.includes("expectations") ||
    text.includes("scenario")
  ) {
    score += 0.04;
  }

  if (
    text.includes("appears") ||
    text.includes("may") ||
    text.includes("could")
  ) {
    score -= 0.02;
  }

  score = clamp(score, 0.55, 0.82);

  return {
    confidence_score: round(score, 2),
    confidence_label:
      score >= 0.78
        ? "High"
        : score >= 0.66
          ? "Medium"
          : "Low"
  };
}

function parseArticleHtml(html, fileName) {
  const articleId = extractArticleId(html, fileName);
  const title = extractTitle(html);
  const description = extractDescription(html);
  const lede = extractLede(html) || description;
  const meta = extractMeta(html);
  const body = extractBody(html);
  const watchlist = extractWatchlist(html);
  const action = extractAction(html);
  const chips = extractChips(html);

  const dateOnly = extractDateOnly(articleId, meta.created_at);

  if (!articleId || !title || !dateOnly) {
    throw new Error(
      `Missing required article data: id=${articleId}, title=${title}, date=${dateOnly}`
    );
  }

  const category = chips[0] || meta.category || "Power Grid";
  const region = chips[1] || meta.region || "Global";
  const tags = chips.slice(2);
  const countries = extractCountriesFromJsonLd(html);
  const confidence = inferConfidence(body, lede);

  return {
    id: articleId,
    created_at:
      meta.created_at ||
      `${dateOnly}T00:00:00.000Z`,
    date_utc: dateOnly,
    category,
    region,
    countries,
    title,
    lede,
    body: body || lede || description,
    summary: lede || description || body,
    confidence_label: confidence.confidence_label,
    confidence_score: confidence.confidence_score,
    tags,
    watchlist,
    action_for_readers:
      action ||
      "Monitor additional evidence before making operational or investment decisions."
  };
}

/* -------------------------------------------------------------------------- */
/* Historical archive generation                                              */
/* -------------------------------------------------------------------------- */

function groupArticlesByDate(articles) {
  const groups = new Map();

  for (const article of articles) {
    const date = article.date_utc;

    if (!groups.has(date)) {
      groups.set(date, []);
    }

    groups.get(date).push(article);
  }

  for (const items of groups.values()) {
    items.sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)) ||
      String(a.id).localeCompare(String(b.id))
    );
  }

  return groups;
}

function createHistoryPayload(dateOnly, articles) {
  const updatedAt = articles
    .map((article) => article.created_at)
    .filter(Boolean)
    .sort()
    .at(-1) || `${dateOnly}T23:59:59.000Z`;

  const categories = [...new Set(articles.map((article) => article.category))];
  const regions = [...new Set(articles.map((article) => article.region))];

  return {
    title: "PTD Today — Historical AI Intelligence Brief",
    disclaimer:
      "Informational only — reconstructed from previously published PTD Today AI-generated intelligence articles. May contain errors. Not investment or engineering advice.",
    updated_at: updatedAt,
    date_utc: dateOnly,
    backfilled_from_articles: true,
    sections: [
      {
        heading: "Top Themes",
        bullets: categories.slice(0, 8)
      },
      {
        heading: "Regions Covered",
        bullets: regions.slice(0, 8)
      }
    ],
    items: articles.map(({ date_utc, ...article }) => article)
  };
}

function mergeHistoryPayload(existing, backfilled) {
  const itemsById = new Map();

  for (const item of existing?.items || []) {
    if (item?.id) itemsById.set(item.id, item);
  }

  for (const item of backfilled?.items || []) {
    if (item?.id) {
      itemsById.set(item.id, {
        ...(itemsById.get(item.id) || {}),
        ...item
      });
    }
  }

  return {
    ...existing,
    ...backfilled,
    items: [...itemsById.values()].sort((a, b) =>
      String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
      String(a.id || "").localeCompare(String(b.id || ""))
    )
  };
}

function readHistoryPayloads(historyDir) {
  if (!fs.existsSync(historyDir)) return [];

  return fs
    .readdirSync(historyDir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort()
    .map((name) => readJsonIfExists(path.join(historyDir, name), null))
    .filter((payload) =>
      payload &&
      payload.date_utc &&
      Array.isArray(payload.items)
    )
    .sort((a, b) =>
      String(a.date_utc).localeCompare(String(b.date_utc))
    );
}

/* -------------------------------------------------------------------------- */
/* Trend engine                                                               */
/* -------------------------------------------------------------------------- */

function flattenHistoryItems(payloads) {
  return payloads.flatMap((payload) =>
    (payload.items || []).map((item) => ({
      ...item,
      source_date_utc: payload.date_utc
    }))
  );
}

function countBy(items, getter) {
  const counts = new Map();

  for (const item of items) {
    const values = getter(item);
    const list = Array.isArray(values) ? values : [values];

    for (const raw of list) {
      const value = cleanString(raw);
      if (!value) continue;

      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }

  return counts;
}

function ranked(counts, limit = 20) {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) =>
      b.count - a.count ||
      a.name.localeCompare(b.name)
    )
    .slice(0, limit);
}

function topicLabel(tag) {
  return cleanString(tag)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function selectHistoryWindow(payloads, days) {
  return payloads.filter((payload) =>
    isDateWithinDays(payload.date_utc, days)
  );
}

function createWindowAnalytics(payloads, days) {
  const selected = selectHistoryWindow(payloads, days);
  const items = flattenHistoryItems(selected);

  const categories = ranked(
    countBy(items, (item) => item.category),
    12
  );

  const regions = ranked(
    countBy(items, (item) => item.region),
    12
  );

  const countries = ranked(
    countBy(items, (item) => item.countries || []),
    30
  );

  const topics = ranked(
    countBy(items, (item) => item.tags || []),
    30
  ).map((entry) => ({
    ...entry,
    label: topicLabel(entry.name)
  }));

  const averageConfidence = items.length
    ? round(
        items.reduce(
          (sum, item) =>
            sum + Number(item.confidence_score || 0),
          0
        ) / items.length,
        2
      )
    : 0;

  return {
    days,
    start_date_utc: daysAgoDateOnly(days - 1),
    end_date_utc: utcDateOnly(),
    briefing_count: selected.length,
    signal_count: items.length,
    average_confidence: averageConfidence,
    categories,
    regions,
    countries,
    topics
  };
}

function rankedCountMap(values) {
  return new Map(
    (values || []).map((entry) => [
      entry.name,
      Number(entry.count) || 0
    ])
  );
}

function calculateMomentum(shortWindow, longWindow, key) {
  const shortMap = rankedCountMap(shortWindow[key]);
  const longMap = rankedCountMap(longWindow[key]);

  const names = new Set([
    ...shortMap.keys(),
    ...longMap.keys()
  ]);

  const rows = [];

  for (const name of names) {
    const shortCount = shortMap.get(name) || 0;
    const longCount = longMap.get(name) || 0;

    const shortDaily = shortCount / Math.max(1, shortWindow.days);
    const longDaily = longCount / Math.max(1, longWindow.days);

    let momentumPercent = 0;

    if (longDaily > 0) {
      momentumPercent =
        ((shortDaily - longDaily) / longDaily) * 100;
    } else if (shortDaily > 0) {
      momentumPercent = 100;
    }

    rows.push({
      name,
      label: key === "topics" ? topicLabel(name) : name,
      short_count: shortCount,
      long_count: longCount,
      short_daily_rate: round(shortDaily, 2),
      long_daily_rate: round(longDaily, 2),
      momentum_percent: round(momentumPercent, 1),
      direction:
        momentumPercent >= 12
          ? "Rising"
          : momentumPercent <= -12
            ? "Cooling"
            : "Stable"
    });
  }

  return rows.sort((a, b) =>
    Math.abs(b.momentum_percent) -
      Math.abs(a.momentum_percent) ||
    b.short_count - a.short_count
  );
}

function buildTrends(historyPayloads, generatedAt) {
  const last7Days = createWindowAnalytics(historyPayloads, 7);
  const last30Days = createWindowAnalytics(historyPayloads, 30);

  return {
    generated_at: generatedAt,
    methodology: {
      summary:
        "Counts and momentum are derived from PTD Today intelligence articles reconstructed into history/*.json.",
      caution:
        "Signal frequency is not verified market size, price movement, engineering risk, or event probability."
    },
    windows: {
      last_7_days: last7Days,
      last_30_days: last30Days
    },
    momentum: {
      topics: calculateMomentum(
        last7Days,
        last30Days,
        "topics"
      ).slice(0, 20),
      categories: calculateMomentum(
        last7Days,
        last30Days,
        "categories"
      ).slice(0, 12),
      regions: calculateMomentum(
        last7Days,
        last30Days,
        "regions"
      ).slice(0, 12),
      countries: calculateMomentum(
        last7Days,
        last30Days,
        "countries"
      ).slice(0, 20)
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Outlook engine                                                             */
/* -------------------------------------------------------------------------- */

function probabilityFromMomentum(momentumPercent, evidenceCount) {
  const momentumComponent =
    Math.tanh(Number(momentumPercent || 0) / 80);

  const evidenceComponent =
    Math.min(Number(evidenceCount || 0), 20) / 20;

  return round(
    clamp(
      0.5 +
        momentumComponent * 0.25 +
        evidenceComponent * 0.15,
      0.4,
      0.88
    ),
    2
  );
}

function outlookConfidence(probability, evidenceCount) {
  if (evidenceCount >= 10 && probability >= 0.72) {
    return "High";
  }

  if (evidenceCount >= 5 && probability >= 0.6) {
    return "Medium";
  }

  return "Low";
}

function createOutlookStatement(label, direction, horizonDays) {
  const horizon =
    horizonDays === 7
      ? "over the next 7 days"
      : "over the next 30 days";

  if (direction === "Rising") {
    return `Recent PTD Today signal activity suggests ${label} may remain elevated or strengthen ${horizon}.`;
  }

  if (direction === "Cooling") {
    return `Recent PTD Today signal activity suggests attention around ${label} may moderate ${horizon}, although reversal risk remains.`;
  }

  return `Recent PTD Today signal activity suggests ${label} may remain broadly stable ${horizon}.`;
}

function buildOutlookEntries(rows, horizonDays, limit = 10) {
  return (rows || [])
    .filter((row) =>
      row.short_count > 0 ||
      row.long_count > 0
    )
    .slice(0, limit)
    .map((row) => {
      const evidenceCount =
        Number(row.short_count || 0) +
        Number(row.long_count || 0);

      const probability = probabilityFromMomentum(
        row.momentum_percent,
        evidenceCount
      );

      return {
        key: row.name,
        label: row.label || row.name,
        horizon_days: horizonDays,
        direction: row.direction,
        momentum_percent: row.momentum_percent,
        probability,
        confidence: outlookConfidence(
          probability,
          evidenceCount
        ),
        evidence_signal_count: evidenceCount,
        statement: createOutlookStatement(
          row.label || row.name,
          row.direction,
          horizonDays
        )
      };
    });
}

function buildOutlook(trends, generatedAt) {
  return {
    generated_at: generatedAt,
    disclaimer:
      "AI-generated probabilistic scenarios based on PTD Today publishing history. These are not guarantees, verified forecasts, investment advice, or engineering conclusions.",
    methodology: {
      summary:
        "Probabilities are transparent heuristics based on reconstructed article frequency, recent momentum, evidence volume, and confidence metadata.",
      limitations: [
        "Older articles may contain region metadata without explicit countries.",
        "Historical PTD Today articles are AI-generated intelligence, not verified reporting.",
        "Signal frequency does not equal real-world event probability.",
        "Outlooks require validation using authoritative primary sources."
      ]
    },
    horizons: {
      next_7_days: {
        topics: buildOutlookEntries(
          trends.momentum.topics,
          7,
          10
        ),
        categories: buildOutlookEntries(
          trends.momentum.categories,
          7,
          8
        ),
        regions: buildOutlookEntries(
          trends.momentum.regions,
          7,
          8
        ),
        countries: buildOutlookEntries(
          trends.momentum.countries,
          7,
          10
        )
      },
      next_30_days: {
        topics: buildOutlookEntries(
          trends.momentum.topics,
          30,
          10
        ),
        categories: buildOutlookEntries(
          trends.momentum.categories,
          30,
          8
        ),
        regions: buildOutlookEntries(
          trends.momentum.regions,
          30,
          8
        ),
        countries: buildOutlookEntries(
          trends.momentum.countries,
          30,
          10
        )
      }
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

function main() {
  const articlesDir = optEnv("ARTICLES_DIR", "articles");
  const historyDir = optEnv("HISTORY_DIR", "history");
  const briefsDir = optEnv("BRIEFS_DIR", "briefs");

  const files = listHtmlFiles(articlesDir);

  if (!files.length) {
    throw new Error(
      `No HTML articles found in ${articlesDir}/`
    );
  }

  console.log(
    `Scanning ${files.length} article files from ${articlesDir}/...`
  );

  const articles = [];
  const failures = [];

  for (const fileName of files) {
    const filePath = path.join(articlesDir, fileName);

    try {
      const html = readText(filePath);
      const article = parseArticleHtml(html, fileName);
      articles.push(article);
    } catch (error) {
      failures.push({
        file: fileName,
        error: error.message
      });
    }
  }

  if (!articles.length) {
    throw new Error(
      "No article files could be parsed successfully."
    );
  }

  const groups = groupArticlesByDate(articles);

  ensureDir(historyDir);
  ensureDir(briefsDir);

  for (const [dateOnly, dayArticles] of groups.entries()) {
    const newPayload = createHistoryPayload(
      dateOnly,
      dayArticles
    );

    const historyPath = path.join(
      historyDir,
      `${dateOnly}.json`
    );

    const existing = readJsonIfExists(
      historyPath,
      null
    );

    const merged = existing
      ? mergeHistoryPayload(existing, newPayload)
      : newPayload;

    writeJson(historyPath, merged);
  }

  const historyPayloads =
    readHistoryPayloads(historyDir);

  const generatedAt = isoNow();
  const trends = buildTrends(
    historyPayloads,
    generatedAt
  );

  const outlook = buildOutlook(
    trends,
    generatedAt
  );

  writeJson(
    path.join(briefsDir, "trends.json"),
    trends
  );

  writeJson(
    path.join(briefsDir, "outlook.json"),
    outlook
  );

  const report = {
    generated_at: generatedAt,
    articles_directory: articlesDir,
    history_directory: historyDir,
    briefs_directory: briefsDir,
    html_files_found: files.length,
    articles_parsed: articles.length,
    dates_backfilled: groups.size,
    oldest_date:
      [...groups.keys()].sort()[0] || null,
    newest_date:
      [...groups.keys()].sort().at(-1) || null,
    parsing_failures: failures
  };

  writeJson(
    path.join(
      briefsDir,
      "backfill-report.json"
    ),
    report
  );

  console.log("Backfill completed.");
  console.log(
    `- Parsed articles: ${articles.length}/${files.length}`
  );
  console.log(
    `- Historical dates created/updated: ${groups.size}`
  );
  console.log(
    `- Wrote: ${path.join(briefsDir, "trends.json")}`
  );
  console.log(
    `- Wrote: ${path.join(briefsDir, "outlook.json")}`
  );
  console.log(
    `- Wrote: ${path.join(briefsDir, "backfill-report.json")}`
  );

  if (failures.length) {
    console.warn(
      `- ${failures.length} files could not be parsed. Review backfill-report.json.`
    );
  }
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
