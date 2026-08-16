// scripts/generate_ai_news.js
// PTD Today — Daily AI Intelligence Generator
//
// Generates:
//   - briefs/daily-ai.json
//   - briefs/trends.json
//   - briefs/outlook.json
//   - briefs/map-signals.json       (latest 50 unique signals)
//   - history/YYYY-MM-DD.json        (merged, not overwritten)
//   - articles/<id>.html
//
// Design goals:
//   - Preserve the current PTD Today homepage/article format.
//   - Add country metadata for the interactive world map.
//   - Keep the homepage/article feed at 10 full intelligence articles.
//   - Maintain a separate map dataset containing the latest 50 unique signals.
//   - Preserve generated signals in a merged historical archive.
//   - Derive transparent 7-day and 30-day trend summaries.
//   - Produce probabilistic AI outlooks that are explicitly scenarios,
//     not guarantees or engineering/investment advice.
//   - Keep output backward-compatible with the current homepage.
//
// NOTE:
//   - robots.txt and sitemaps remain owned by scripts/build.mjs.
//   - Article views continue to use the existing Cloudflare Worker endpoint.

import fs from "fs";
import path from "path";
import OpenAI from "openai";

/* -------------------------------------------------------------------------- */
/* Environment and filesystem helpers                                         */
/* -------------------------------------------------------------------------- */

function mustEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function isoNow() {
  return new Date().toISOString();
}

function utcDateOnly(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function compactDate(dateOnly) {
  return dateOnly.replace(/-/g, "");
}

function compactTimestamp(isoValue) {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return String(isoValue || "").replace(/[^0-9]/g, "").slice(0, 14);
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day}${hour}${minute}${second}`;
}

function hoursBetween(olderIso, newerIso) {
  const older = new Date(olderIso).getTime();
  const newer = new Date(newerIso).getTime();

  if (!Number.isFinite(older) || !Number.isFinite(newer)) {
    return Number.POSITIVE_INFINITY;
  }

  return (newer - older) / 3_600_000;
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

function readJsonIfExists(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`Could not read JSON file ${filePath}:`, error.message);
    return fallback;
  }
}

function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];

  return fs
    .readdirSync(dirPath)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort();
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
/* Text and normalization helpers                                             */
/* -------------------------------------------------------------------------- */

function escapeHtml(value) {
  return (value ?? "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toTextParagraphs(value) {
  const text = (value || "").toString().trim();
  if (!text) return [];

  return text
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function cleanString(value, fallback = "") {
  const text = (value ?? "").toString().trim();
  return text || fallback;
}

function cleanStringArray(value, maxItems = 20) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const output = [];

  for (const raw of value) {
    const item = cleanString(raw);
    if (!item) continue;

    const key = item.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(item);

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
  const multiplier = 10 ** digits;
  return Math.round(Number(value) * multiplier) / multiplier;
}

function normalizeKey(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stableHash(value) {
  const input = String(value || "");
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function signalDedupKey(item) {
  const countries = cleanStringArray(item?.countries, 8)
    .map(normalizeCountryName)
    .sort()
    .join("|");

  return [
    normalizeKey(item?.title),
    normalizeKey(item?.category),
    countries
  ].join("::");
}

/* -------------------------------------------------------------------------- */
/* Controlled taxonomies                                                      */
/* -------------------------------------------------------------------------- */

const VALID_CATEGORIES = new Set([
  "Power Grid",
  "Substations",
  "Data Centers",
  "Renewables",
  "Markets",
  "Critical Minerals",
  "Policy",
  "OEM/EPC"
]);

const VALID_REGIONS = new Set([
  "Global",
  "North America",
  "Europe",
  "Middle East",
  "Asia",
  "LATAM",
  "Africa"
]);

const REGION_COUNTRIES = {
  "North America": [
    "United States",
    "Canada",
    "Mexico"
  ],
  Europe: [
    "United Kingdom",
    "Ireland",
    "France",
    "Germany",
    "Spain",
    "Portugal",
    "Italy",
    "Netherlands",
    "Belgium",
    "Luxembourg",
    "Switzerland",
    "Austria",
    "Poland",
    "Czechia",
    "Slovakia",
    "Hungary",
    "Romania",
    "Bulgaria",
    "Greece",
    "Norway",
    "Sweden",
    "Finland",
    "Denmark",
    "Iceland",
    "Estonia",
    "Latvia",
    "Lithuania",
    "Ukraine",
    "Croatia",
    "Slovenia",
    "Serbia"
  ],
  "Middle East": [
    "Türkiye",
    "Saudi Arabia",
    "United Arab Emirates",
    "Qatar",
    "Oman",
    "Kuwait",
    "Bahrain",
    "Jordan",
    "Israel",
    "Iraq"
  ],
  Asia: [
    "China",
    "India",
    "Japan",
    "South Korea",
    "Singapore",
    "Malaysia",
    "Indonesia",
    "Thailand",
    "Vietnam",
    "Philippines",
    "Pakistan",
    "Bangladesh",
    "Sri Lanka",
    "Australia",
    "New Zealand"
  ],
  LATAM: [
    "Brazil",
    "Argentina",
    "Chile",
    "Colombia",
    "Peru",
    "Ecuador",
    "Uruguay",
    "Paraguay",
    "Bolivia",
    "Panama",
    "Costa Rica",
    "Dominican Republic"
  ],
  Africa: [
    "South Africa",
    "Egypt",
    "Morocco",
    "Algeria",
    "Nigeria",
    "Kenya",
    "Ethiopia",
    "Ghana",
    "Tanzania",
    "Tunisia",
    "Senegal"
  ],
  Global: []
};

const COUNTRY_ALIASES = {
  usa: "United States",
  us: "United States",
  "united-states-of-america": "United States",
  uk: "United Kingdom",
  uae: "United Arab Emirates",
  turkey: "Türkiye",
  turkiye: "Türkiye",
  korea: "South Korea",
  "south-korea": "South Korea",
  "republic-of-korea": "South Korea",
  czech: "Czechia",
  "czech-republic": "Czechia"
};

function normalizeCountryName(value) {
  const raw = cleanString(value);
  if (!raw) return "";

  const alias = COUNTRY_ALIASES[normalizeKey(raw)];
  return alias || raw;
}

function normalizeCategory(value) {
  const category = cleanString(value, "Power Grid");
  return VALID_CATEGORIES.has(category) ? category : "Power Grid";
}

function normalizeRegion(value) {
  const region = cleanString(value, "Global");
  return VALID_REGIONS.has(region) ? region : "Global";
}

function normalizeCountries(value, region) {
  const countries = cleanStringArray(value, 8)
    .map(normalizeCountryName)
    .filter(Boolean);

  if (countries.length) return countries;

  /*
   * We intentionally do not invent countries from a broad region.
   * The homepage map can use region fallback until the model supplies
   * explicit countries.
   */
  return [];
}

/* -------------------------------------------------------------------------- */
/* Payload validation and enrichment                                          */
/* -------------------------------------------------------------------------- */

function normalizeItem(item, index, dateOnly, now) {
  const fallbackId = `ai-${compactDate(dateOnly)}-${String(index + 1).padStart(3, "0")}`;

  const region = normalizeRegion(item?.region);
  const category = normalizeCategory(item?.category);

  const confidenceScore = clamp(item?.confidence_score, 0.55, 0.9);
  const confidenceLabel =
    confidenceScore >= 0.78
      ? "High"
      : confidenceScore >= 0.66
        ? "Medium"
        : "Low";

  const countries = normalizeCountries(item?.countries, region);
  const tags = cleanStringArray(item?.tags, 12);
  const watchlist = cleanStringArray(item?.watchlist, 10);

  return {
    id: cleanString(item?.id, fallbackId),
    created_at: cleanString(item?.created_at, now),
    category,
    region,
    countries,
    title: cleanString(item?.title, "Untitled intelligence signal"),
    lede: cleanString(
      item?.lede || item?.summary,
      "AI-generated intelligence signal for monitoring."
    ),
    body: cleanString(
      item?.body || item?.summary,
      "This intelligence signal requires continued monitoring."
    ),
    summary: cleanString(
      item?.summary || item?.lede,
      "AI-generated intelligence signal for monitoring."
    ),
    confidence_label: ["Low", "Medium", "High"].includes(item?.confidence_label)
      ? item.confidence_label
      : confidenceLabel,
    confidence_score: round(confidenceScore, 2),
    importance_score: Math.round(
      clamp(item?.importance_score ?? item?.importance ?? 70, 40, 100)
    ),
    tags,
    watchlist,
    action_for_readers: cleanString(
      item?.action_for_readers,
      "Monitor additional evidence before making operational or investment decisions."
    )
  };
}

function normalizeSections(value) {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 6)
    .map((section) => ({
      heading: cleanString(section?.heading, "Section"),
      bullets: cleanStringArray(section?.bullets, 10)
    }))
    .filter((section) => section.bullets.length > 0);
}

function normalizePayload(payload, dateOnly, now) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];

  const items = rawItems
    .slice(0, 10)
    .map((item, index) => normalizeItem(item, index, dateOnly, now));

  const seenIds = new Set();

  for (let index = 0; index < items.length; index += 1) {
    let id = items[index].id;

    if (!id || seenIds.has(id)) {
      id = `ai-${compactDate(dateOnly)}-${String(index + 1).padStart(3, "0")}`;
      items[index].id = id;
    }

    seenIds.add(id);
  }

  return {
    title: cleanString(
      payload?.title,
      "PTD Today — Daily AI Intelligence Brief"
    ),
    disclaimer: cleanString(
      payload?.disclaimer,
      "Informational only — AI-generated; may contain errors. Not investment or engineering advice."
    ),
    updated_at: cleanString(payload?.updated_at, now),
    date_utc: cleanString(payload?.date_utc, dateOnly),
    sections: normalizeSections(payload?.sections),
    items
  };
}


/* -------------------------------------------------------------------------- */
/* Latest 50 map signal engine                                           */
/* -------------------------------------------------------------------------- */

function toMapSignal(item, generatedAt) {
  const countries = cleanStringArray(item?.countries, 8)
    .map(normalizeCountryName)
    .filter(Boolean);

  const signalId = [
    "sig",
    compactTimestamp(item?.created_at || generatedAt),
    stableHash(
      [
        item?.title,
        item?.category,
        item?.region,
        countries.join("|")
      ].join("::")
    )
  ].join("-");

  return {
    signal_id: signalId,
    article_id: cleanString(item?.id),
    created_at: cleanString(item?.created_at, generatedAt),
    category: normalizeCategory(item?.category),
    region: normalizeRegion(item?.region),
    countries,
    title: cleanString(item?.title, "Untitled intelligence signal"),
    summary: cleanString(
      item?.summary || item?.lede,
      "AI-generated intelligence signal for monitoring."
    ),
    confidence_label: cleanString(item?.confidence_label, "Medium"),
    confidence_score: round(
      clamp(item?.confidence_score, 0.55, 0.9),
      2
    ),
    importance_score: Math.round(
      clamp(item?.importance_score ?? 70, 40, 100)
    ),
    tags: cleanStringArray(item?.tags, 12),
    watchlist: cleanStringArray(item?.watchlist, 6),
    dedup_key: signalDedupKey(item)
  };
}

function buildLatestMapSignals({
  existingPayload,
  currentItems,
  historicalItems,
  generatedAt,
  maximumSignals = 50
}) {
  const existingSignals = Array.isArray(existingPayload?.signals)
    ? existingPayload.signals
    : [];

  const incomingSignals = currentItems.map((item) =>
    toMapSignal(item, generatedAt)
  );

  const historySignals = (Array.isArray(historicalItems)
    ? historicalItems
    : []
  ).map((item) =>
    toMapSignal(item, item?.created_at || generatedAt)
  );

  /*
   * Order matters:
   * 1) newest current generation
   * 2) already-published map signals
   * 3) historical archive used to fill remaining slots immediately
   */
  const combined = [
    ...incomingSignals,
    ...existingSignals,
    ...historySignals
  ];

  const seen = new Set();
  const unique = [];

  for (const signal of combined) {
    const key =
      cleanString(signal?.dedup_key) ||
      signalDedupKey(signal);

    if (!key || seen.has(key)) continue;

    seen.add(key);

    unique.push({
      ...signal,
      dedup_key: key
    });
  }

  unique.sort((a, b) => {
    const dateDifference =
      String(b.created_at || "").localeCompare(
        String(a.created_at || "")
      );

    if (dateDifference !== 0) {
      return dateDifference;
    }

    return (
      Number(b.importance_score || 0) -
      Number(a.importance_score || 0)
    );
  });

  const signals = unique.slice(0, maximumSignals);

  const countryCounts = countBy(
    signals,
    (signal) => signal.countries || []
  );

  const regionCounts = countBy(
    signals,
    (signal) => signal.region
  );

  const categoryCounts = countBy(
    signals,
    (signal) => signal.category
  );

  return {
    generated_at: generatedAt,
    mode: "latest-50",
    maximum_signals: maximumSignals,
    signal_count: signals.length,
    country_count: countryCounts.size,
    oldest_signal_at:
      signals.length
        ? signals[signals.length - 1].created_at
        : null,
    newest_signal_at:
      signals.length
        ? signals[0].created_at
        : null,
    methodology: {
      summary:
        "The map shows the latest 50 unique PTD Today intelligence signals. Existing history is used immediately to fill the dataset, and newer hourly signals replace older ones automatically.",
      caution:
        "Signals are AI-generated intelligence scenarios and may contain errors. Country assignment is included only when justified."
    },
    coverage: {
      countries: mapToRankedArray(countryCounts, 100),
      regions: mapToRankedArray(regionCounts, 20),
      categories: mapToRankedArray(categoryCounts, 20)
    },
    signals
  };
}

function mergeDailyHistory(existingPayload, currentPayload) {
  const existingItems = Array.isArray(existingPayload?.items)
    ? existingPayload.items
    : [];

  const currentItems = Array.isArray(currentPayload?.items)
    ? currentPayload.items
    : [];

  const itemsByKey = new Map();

  for (const item of [...currentItems, ...existingItems]) {
    const key = signalDedupKey(item);
    if (!key || itemsByKey.has(key)) continue;
    itemsByKey.set(key, item);
  }

  const mergedItems = [...itemsByKey.values()]
    .sort((a, b) =>
      String(b.created_at || "").localeCompare(
        String(a.created_at || "")
      )
    )
    .slice(0, 300);

  return {
    ...existingPayload,
    ...currentPayload,
    updated_at: currentPayload.updated_at,
    date_utc: currentPayload.date_utc,
    items: mergedItems,
    archive_mode: "merged-hourly-signals",
    signal_count: mergedItems.length
  };
}

/* -------------------------------------------------------------------------- */
/* Historical archive and analytics                                           */
/* -------------------------------------------------------------------------- */

function readHistoryPayloads(historyDir) {
  return listJsonFiles(historyDir)
    .map((fileName) => {
      const filePath = path.join(historyDir, fileName);
      const payload = readJsonIfExists(filePath, null);

      if (!payload || !payload.date_utc || !Array.isArray(payload.items)) {
        return null;
      }

      return payload;
    })
    .filter(Boolean)
    .sort((a, b) => String(a.date_utc).localeCompare(String(b.date_utc)));
}

function countBy(items, getter) {
  const counts = new Map();

  for (const item of items) {
    const values = getter(item);
    const list = Array.isArray(values) ? values : [values];

    for (const value of list) {
      const key = cleanString(value);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return counts;
}

function mapToRankedArray(counts, limit = 20) {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function flattenHistoryItems(payloads) {
  return payloads.flatMap((payload) =>
    (Array.isArray(payload.items) ? payload.items : []).map((item) => ({
      ...item,
      source_date_utc: payload.date_utc,
      source_updated_at: payload.updated_at
    }))
  );
}

function selectHistoryWindow(payloads, days) {
  return payloads.filter((payload) =>
    isDateWithinDays(payload.date_utc, days)
  );
}

function topicLabelFromTag(tag) {
  return cleanString(tag)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function createWindowAnalytics(payloads, days) {
  const windowPayloads = selectHistoryWindow(payloads, days);
  const items = flattenHistoryItems(windowPayloads);

  const categoryCounts = countBy(items, (item) => item.category);
  const regionCounts = countBy(items, (item) => item.region);
  const countryCounts = countBy(items, (item) => item.countries || []);
  const tagCounts = countBy(items, (item) => item.tags || []);

  const averageConfidence = items.length
    ? round(
        items.reduce(
          (sum, item) => sum + Number(item.confidence_score || 0),
          0
        ) / items.length,
        2
      )
    : 0;

  return {
    days,
    start_date_utc: daysAgoDateOnly(days - 1),
    end_date_utc: utcDateOnly(),
    briefing_count: windowPayloads.length,
    signal_count: items.length,
    average_confidence: averageConfidence,
    categories: mapToRankedArray(categoryCounts, 12),
    regions: mapToRankedArray(regionCounts, 12),
    countries: mapToRankedArray(countryCounts, 30),
    topics: mapToRankedArray(tagCounts, 30).map((entry) => ({
      ...entry,
      label: topicLabelFromTag(entry.name)
    }))
  };
}

function rankedCountMap(rankedArray) {
  return new Map(
    (Array.isArray(rankedArray) ? rankedArray : []).map((entry) => [
      entry.name,
      Number(entry.count) || 0
    ])
  );
}

function calculateMomentum(shortWindow, longWindow, key) {
  const shortMap = rankedCountMap(shortWindow[key]);
  const longMap = rankedCountMap(longWindow[key]);

  const names = new Set([...shortMap.keys(), ...longMap.keys()]);
  const shortDays = Math.max(1, shortWindow.days);
  const longDays = Math.max(1, longWindow.days);

  const rows = [];

  for (const name of names) {
    const shortCount = shortMap.get(name) || 0;
    const longCount = longMap.get(name) || 0;

    const shortDaily = shortCount / shortDays;
    const longDaily = longCount / longDays;

    let momentumPercent = 0;

    if (longDaily > 0) {
      momentumPercent = ((shortDaily - longDaily) / longDaily) * 100;
    } else if (shortDaily > 0) {
      momentumPercent = 100;
    }

    rows.push({
      name,
      label: key === "topics" ? topicLabelFromTag(name) : name,
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
    Math.abs(b.momentum_percent) - Math.abs(a.momentum_percent)
  );
}

function buildTrends(historyPayloads, generatedAt) {
  const last7Days = createWindowAnalytics(historyPayloads, 7);
  const last30Days = createWindowAnalytics(historyPayloads, 30);

  return {
    generated_at: generatedAt,
    methodology: {
      summary:
        "Counts and momentum are derived from PTD Today AI intelligence signals archived in history/*.json.",
      caution:
        "Momentum reflects changes in signal frequency, not verified market size, price movement, or engineering risk."
    },
    windows: {
      last_7_days: last7Days,
      last_30_days: last30Days
    },
    momentum: {
      topics: calculateMomentum(last7Days, last30Days, "topics").slice(0, 20),
      categories: calculateMomentum(last7Days, last30Days, "categories").slice(0, 12),
      regions: calculateMomentum(last7Days, last30Days, "regions").slice(0, 12),
      countries: calculateMomentum(last7Days, last30Days, "countries").slice(0, 20)
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Deterministic outlook foundation                                           */
/* -------------------------------------------------------------------------- */

function probabilityFromMomentum(momentumPercent, confidence = 0.7) {
  const momentumComponent = Math.tanh(Number(momentumPercent || 0) / 80);
  const confidenceComponent = clamp(confidence, 0.55, 0.9) - 0.55;

  const probability =
    0.5 +
    momentumComponent * 0.26 +
    confidenceComponent * 0.35;

  return round(clamp(probability, 0.35, 0.9), 2);
}

function outlookConfidence(probability, evidenceCount) {
  if (evidenceCount >= 8 && probability >= 0.74) return "High";
  if (evidenceCount >= 4 && probability >= 0.62) return "Medium";
  return "Low";
}

function createOutlookStatement(label, direction, horizonDays) {
  const horizon =
    horizonDays === 7
      ? "over the next 7 days"
      : horizonDays === 30
        ? "over the next 30 days"
        : `over the next ${horizonDays} days`;

  if (direction === "Rising") {
    return `Current signal frequency suggests ${label} is more likely to remain elevated or strengthen ${horizon}.`;
  }

  if (direction === "Cooling") {
    return `Current signal frequency suggests attention around ${label} may moderate ${horizon}, although reversal risk remains.`;
  }

  return `Current signal frequency suggests ${label} is likely to remain broadly stable ${horizon}.`;
}

function buildOutlookEntries(momentumRows, horizonDays, limit = 8) {
  return momentumRows
    .filter((row) => row.short_count > 0 || row.long_count > 0)
    .slice(0, limit)
    .map((row) => {
      const evidenceCount = row.short_count + row.long_count;
      const evidenceConfidence = clamp(
        0.55 + Math.min(evidenceCount, 14) * 0.025,
        0.55,
        0.9
      );

      const probability = probabilityFromMomentum(
        row.momentum_percent,
        evidenceConfidence
      );

      return {
        key: row.name,
        label: row.label || row.name,
        horizon_days: horizonDays,
        direction: row.direction,
        momentum_percent: row.momentum_percent,
        probability,
        confidence: outlookConfidence(probability, evidenceCount),
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
  const topicMomentum = trends?.momentum?.topics || [];
  const categoryMomentum = trends?.momentum?.categories || [];
  const regionMomentum = trends?.momentum?.regions || [];
  const countryMomentum = trends?.momentum?.countries || [];

  return {
    generated_at: generatedAt,
    disclaimer:
      "AI-generated probabilistic scenarios based on PTD Today signal history. These are not guarantees, investment advice, operational instructions, or engineering conclusions.",
    methodology: {
      summary:
        "Probabilities are a transparent heuristic based on recent signal-frequency momentum, evidence volume, and confidence metadata.",
      limitations: [
        "The source intelligence may contain errors.",
        "Signal frequency is not the same as real-world event probability.",
        "Outlooks require validation against authoritative primary sources.",
        "Low historical coverage reduces confidence."
      ]
    },
    horizons: {
      next_7_days: {
        topics: buildOutlookEntries(topicMomentum, 7, 10),
        categories: buildOutlookEntries(categoryMomentum, 7, 8),
        regions: buildOutlookEntries(regionMomentum, 7, 8),
        countries: buildOutlookEntries(countryMomentum, 7, 10)
      },
      next_30_days: {
        topics: buildOutlookEntries(topicMomentum, 30, 10),
        categories: buildOutlookEntries(categoryMomentum, 30, 8),
        regions: buildOutlookEntries(regionMomentum, 30, 8),
        countries: buildOutlookEntries(countryMomentum, 30, 10)
      }
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Article rendering                                                          */
/* -------------------------------------------------------------------------- */

function renderArticleHtml({ siteOrigin, item, payload }) {
  const id = cleanString(item.id);
  const title = cleanString(item.title, "PTD Today");
  const lede = cleanString(item.lede || item.summary);
  const body = cleanString(item.body);
  const category = cleanString(item.category, "Brief");
  const region = cleanString(item.region, "Global");
  const countries = cleanStringArray(item.countries, 8);
  const createdAt = cleanString(
    item.created_at || payload.updated_at
  );

  const description = cleanString(
    lede || body,
    "PTD Today — AI-generated intelligence briefing."
  )
    .replace(/\s+/g, " ")
    .slice(0, 180);

  const base = siteOrigin.replace(/\/$/, "");
  const url = `${base}/articles/${encodeURIComponent(id)}.html`;
  const ogImage = `${base}/assets/og-default.png`;

  const bodyParagraphs = toTextParagraphs(body)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("\n");

  const watchlist = cleanStringArray(item.watchlist, 10);
  const tags = cleanStringArray(item.tags, 12);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    datePublished:
      createdAt || payload.updated_at || new Date().toISOString(),
    dateModified:
      payload.updated_at || createdAt || new Date().toISOString(),
    mainEntityOfPage: url,
    about: [
      category,
      region,
      ...countries,
      ...tags
    ].filter(Boolean),
    publisher: {
      "@type": "Organization",
      name: "PTD Today"
    }
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />

  <title>${escapeHtml(title)} — PTD Today</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(url)}" />

  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="PTD Today" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(url)}" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImage)}" />

  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>

  <style>
    :root{
      --bg:#ffffff;
      --ink:#111111;
      --muted:#5c5c5c;
      --rule:rgba(0,0,0,.15);
      --soft:rgba(0,0,0,.06);
      --pill:rgba(0,0,0,.04);
      --btn:#111;
      --btnInk:#fff;
    }

    *{box-sizing:border-box}

    body{
      margin:0;
      background:var(--bg);
      color:var(--ink);
      font-family:Georgia,"Times New Roman",Times,serif;
      -webkit-font-smoothing:antialiased;
      text-rendering:optimizeLegibility;
    }

    a{color:inherit}

    .wrap{
      max-width:900px;
      margin:0 auto;
      padding:26px 16px 64px;
    }

    .mast{
      text-align:center;
      padding:16px 0 10px;
    }

    .brand{
      margin:0;
      font-size:52px;
      letter-spacing:.2px;
      font-weight:700;
    }

    .tagline{
      margin:6px 0 10px;
      color:var(--muted);
      font-style:italic;
      font-size:16px;
    }

    .nav{
      display:flex;
      justify-content:center;
      gap:14px;
      flex-wrap:wrap;
      margin:10px 0;
    }

    .nav a{
      text-decoration:none;
      padding:7px 12px;
      border-radius:999px;
      border:1px solid transparent;
      color:rgba(0,0,0,.75);
      font-size:15px;
    }

    .nav a:hover{
      border-color:var(--rule);
      background:rgba(0,0,0,.02);
    }

    .rule{
      height:1px;
      background:var(--rule);
      margin:14px 0 0;
    }

    .meta{
      color:var(--muted);
      font-size:12px;
      letter-spacing:.14px;
      text-transform:uppercase;
      margin:16px 0 8px;
    }

    h1{
      margin:0 0 10px;
      font-size:44px;
      line-height:1.03;
      font-weight:900;
    }

    .lede{
      font-size:18px;
      line-height:1.6;
      color:rgba(0,0,0,.86);
      margin:0 0 14px;
    }

    .content{
      border-top:1px solid var(--soft);
      padding-top:14px;
      font-size:17px;
      line-height:1.75;
      color:rgba(0,0,0,.86);
    }

    .content p{margin:0 0 14px}

    .subhead{
      margin:18px 0 8px;
      font-size:12px;
      text-transform:uppercase;
      letter-spacing:.12px;
      color:var(--muted);
    }

    ul{
      margin:0 0 12px;
      padding-left:18px;
    }

    li{margin:6px 0}

    .chips{
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      margin:14px 0 0;
    }

    .chip{
      display:inline-flex;
      align-items:center;
      padding:7px 10px;
      border-radius:999px;
      border:1px solid var(--rule);
      background:var(--pill);
      font-size:13px;
      color:rgba(0,0,0,.76);
    }

    .btnRow{
      display:flex;
      align-items:center;
      gap:10px;
      flex-wrap:wrap;
      margin:16px 0 0;
    }

    .btn{
      appearance:none;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-height:38px;
      border:1px solid var(--rule);
      background:var(--btn);
      color:var(--btnInk);
      padding:9px 14px;
      border-radius:999px;
      cursor:pointer;
      font-family:inherit;
      font-size:14px;
      text-decoration:none;
    }

    .btn.secondary{
      background:#fff;
      color:#111;
    }

    .article-view-counter{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:6px;
      min-height:38px;
      padding:9px 14px;
      border:1px solid var(--rule);
      border-radius:999px;
      background:var(--pill);
      color:var(--muted);
      font-family:Georgia,"Times New Roman",Times,serif;
      font-size:14px;
      font-weight:700;
      line-height:1;
      white-space:nowrap;
    }

    .article-view-counter[hidden]{display:none}

    .footer{
      text-align:center;
      margin-top:24px;
      color:var(--muted);
      font-size:13px;
    }

    @media (max-width:760px){
      .brand{font-size:44px}
      h1{font-size:38px}
    }
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
        <a href="/media.html">Media</a>
        <a href="/groups.html">Groups</a>
      </nav>

      <div class="rule"></div>
    </header>

    <div class="meta">
      ${escapeHtml(category)} •
      ${escapeHtml(region)}
      ${countries.length ? ` • ${escapeHtml(countries.join(", "))}` : ""}
      • ${escapeHtml(createdAt)}
    </div>

    <h1>${escapeHtml(title)}</h1>

    ${lede ? `<p class="lede">${escapeHtml(lede)}</p>` : ""}

    <div class="content">
      ${bodyParagraphs || `<p>${escapeHtml(item.summary || "")}</p>`}

      ${
        watchlist.length
          ? `
        <div class="subhead">What to watch</div>
        <ul>
          ${watchlist
            .map((entry) => `<li>${escapeHtml(entry)}</li>`)
            .join("")}
        </ul>
      `
          : ""
      }

      ${
        item.action_for_readers
          ? `
        <div class="subhead">Action</div>
        <p>${escapeHtml(item.action_for_readers)}</p>
      `
          : ""
      }
    </div>

    <div class="chips">
      <span class="chip">${escapeHtml(category)}</span>
      <span class="chip">${escapeHtml(region)}</span>

      ${countries
        .map((country) => `<span class="chip">${escapeHtml(country)}</span>`)
        .join("")}

      ${tags
        .map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`)
        .join("")}
    </div>

    <div class="btnRow">
      <a
        class="btn secondary"
        href="/index.html#${encodeURIComponent(id)}"
      >
        Back to Home
      </a>

      <span
        class="article-view-counter"
        id="articleViewCounter"
        aria-label="Article views"
      >
        <span aria-hidden="true">👁</span>
        <span id="articleViewCount">—</span>
        <span>views</span>
      </span>

      <button class="btn" type="button" id="shareBtn">
        Share
      </button>
    </div>

    <div class="footer">
      © ${new Date().getFullYear()} PTD Today
    </div>
  </div>

  <script>
    (function(){
      var url = ${JSON.stringify(url)};
      var title = ${JSON.stringify(title)};
      var text = ${JSON.stringify(description)};
      var articleId = ${JSON.stringify(id)};

      var shareBtn = document.getElementById("shareBtn");
      var counter = document.getElementById("articleViewCounter");
      var countElement = document.getElementById("articleViewCount");

      if (shareBtn) {
        shareBtn.addEventListener("click", async function(){
          if (navigator.share) {
            try {
              await navigator.share({
                title: title,
                text: text,
                url: url
              });
              return;
            } catch (error) {
              return;
            }
          }

          try {
            await navigator.clipboard.writeText(url);
            alert("Article link copied.");
          } catch (error) {
            prompt("Copy this article link:", url);
          }
        });
      }

      async function registerArticleView() {
        if (!counter || !countElement || !articleId) return;

        var apiUrl =
          "https://ptdtoday-view-counter.ozgurayrilmaz.workers.dev/view/" +
          encodeURIComponent(articleId);

        try {
          var response = await fetch(apiUrl, {
            method: "POST",
            mode: "cors",
            cache: "no-store"
          });

          if (!response.ok) {
            throw new Error("View counter request failed");
          }

          var data = await response.json();
          var views = Number(data.views) || 0;

          countElement.textContent =
            new Intl.NumberFormat("en-US", {
              notation: views >= 1000 ? "compact" : "standard",
              maximumFractionDigits: 1
            }).format(views);
        } catch (error) {
          console.error("View counter error:", error);
          counter.hidden = true;
        }
      }

      registerArticleView();
    })();
  </script>
</body>
</html>`;
}

/* -------------------------------------------------------------------------- */
/* OpenAI generation                                                          */
/* -------------------------------------------------------------------------- */

function buildSystemPrompt() {
  return `
You are PTD Today’s Daily AI Intelligence Brief generator.

CRITICAL RULES:
- Do NOT present unverified real-world events as established facts.
- This is intelligence/scenario content, not verified reporting.
- If no authoritative sources are supplied, use language such as:
  "signals", "expectations", "scenario watch", "appears", "may",
  "could", "what to monitor", and "current indications".
- Never fabricate quotations, named sources, statistics, project awards,
  regulatory decisions, incidents, prices, company announcements, or dates.
- Avoid naming publishers or pretending to cite external reporting.
- Keep the content useful for power grids, transmission, substations,
  high-voltage equipment, EPC/OEM, data-center power, renewables,
  critical minerals, markets, policy, and AI in energy.
- Output MUST be valid JSON matching the requested schema.
- No markdown and no extra text outside the JSON object.

MAP COVERAGE AND IMPORTANCE:
- Each item must include an "importance_score" integer from 40 to 100.
- Higher importance means broader operational, investment, supply-chain, or infrastructure relevance.
- Avoid giving every item the same importance score.

COUNTRY METADATA:
- Each item must include a "countries" array.
- Use explicit countries only when the scenario is meaningfully associated
  with those countries.
- Use [] for broad global or regional scenarios that cannot responsibly
  be assigned to specific countries.
- Do not invent a country merely to populate the map.

STYLE:
- Clean, confident, executive intelligence tone.
- Clear uncertainty and scenario framing.
- Each item must include:
  - one strong lede paragraph,
  - a professional body,
  - a concise summary,
  - watchlist,
  - reader action,
  - confidence metadata,
  - countries,
  - tags.
`.trim();
}

function buildUserPrompt(dateOnly, now) {
  return `
Generate the PTD Today daily AI intelligence brief for date_utc = "${dateOnly}".

Return JSON with exactly this structure:

{
  "title": "PTD Today — Daily AI Intelligence Brief",
  "disclaimer": "Informational only — AI-generated; may contain errors. Not investment or engineering advice.",
  "updated_at": "${now}",
  "date_utc": "${dateOnly}",
  "sections": [
    {
      "heading": "Top Themes",
      "bullets": ["...", "..."]
    },
    {
      "heading": "What to Watch (24–72h)",
      "bullets": ["...", "..."]
    }
  ],
  "items": [
    {
      "id": "ai-YYYYMMDD-001",
      "created_at": "${now}",
      "category": "Power Grid" | "Substations" | "Data Centers" | "Renewables" | "Markets" | "Critical Minerals" | "Policy" | "OEM/EPC",
      "region": "Global" | "North America" | "Europe" | "Middle East" | "Asia" | "LATAM" | "Africa",
      "countries": ["United States"],
      "title": "Short headline",
      "lede": "One strong paragraph using intelligence/scenario framing.",
      "body": "Professional analysis. Use short paragraphs separated by blank lines.",
      "summary": "Two or three concise sentences for the homepage card.",
      "confidence_label": "Low" | "Medium" | "High",
      "confidence_score": 0.0,
      "importance_score": 0,
      "tags": ["tag1", "tag2"],
      "watchlist": ["specific item to monitor", "specific item to monitor"],
      "action_for_readers": "One sentence action."
    }
  ]
}

REQUIREMENTS:
- Exactly 10 full-featured items for the homepage/article feed.
- IDs must be unique and use date ${compactDate(dateOnly)}.
- confidence_score must be between 0.55 and 0.90.
- importance_score must be an integer between 40 and 100.
- Geographic balance target per generation:
  - North America: approximately 2 items
  - Europe: approximately 2 items
  - Asia: approximately 2 items
  - Middle East: approximately 1 item
  - LATAM: approximately 1 item
  - Africa: approximately 1 item
  - Global: approximately 1 item
- Across the 10 items, aim to cover at least 8 explicit countries when responsibly possible.
- Prefer one or two justified countries per country-specific signal.
- Do not repeatedly use only the United States, Germany, China, India, or the United Kingdom.
- Include a useful mix of categories and regions.
- countries must be [] when a specific-country assignment is not justified.
- Do not include source lines or URLs.
- Do not claim that a speculative development definitely happened.
`.trim();
}

async function generateBrief(client, dateOnly, now) {
  const response = await client.responses.create({
    model: optEnv("OPENAI_MODEL", "gpt-5-mini"),
    input: [
      {
        role: "system",
        content: buildSystemPrompt()
      },
      {
        role: "user",
        content: buildUserPrompt(dateOnly, now)
      }
    ],
    text: {
      format: {
        type: "json_object"
      }
    }
  });

  const outputText = response.output_text;

  if (!outputText) {
    throw new Error("No output_text returned from OpenAI");
  }

  let parsed;

  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new Error(
      `Model returned non-JSON. First 300 chars: ${outputText.slice(0, 300)}`
    );
  }

  return normalizePayload(parsed, dateOnly, now);
}

/* -------------------------------------------------------------------------- */
/* Main build                                                                 */
/* -------------------------------------------------------------------------- */

async function main() {
  const apiKey = mustEnv("OPENAI_API_KEY");
  const siteOrigin = optEnv(
    "SITE_ORIGIN",
    "https://ptdtoday.com"
  ).replace(/\/$/, "");

  const historyDir = optEnv("HISTORY_DIR", "history");
  const briefsDir = optEnv("BRIEFS_DIR", "briefs");
  const articlesDir = optEnv("ARTICLES_DIR", "articles");

  const now = isoNow();
  const today = utcDateOnly();

  const client = new OpenAI({ apiKey });

  console.log(`Generating PTD Today intelligence for ${today}...`);

  const payload = await generateBrief(client, today, now);

  /*
   * Current homepage payload: always the latest 10 full articles.
   */
  writeJson(
    path.join(briefsDir, "daily-ai.json"),
    payload
  );

  /*
   * Historical archive: merge hourly generations instead of replacing
   * the entire UTC day.
   */
  const todayHistoryPath = path.join(
    historyDir,
    `${today}.json`
  );

  const existingTodayHistory = readJsonIfExists(
    todayHistoryPath,
    null
  );

  const mergedTodayHistory = mergeDailyHistory(
    existingTodayHistory,
    payload
  );

  writeJson(
    todayHistoryPath,
    mergedTodayHistory
  );

  /*
   * Read history immediately so the map can be seeded with the latest
   * 50 previously published signals on the very first run.
   */
  const historyPayloadsForMap =
    readHistoryPayloads(historyDir);

  const historicalItemsForMap =
    flattenHistoryItems(historyPayloadsForMap);

  const mapSignalsPath = path.join(
    briefsDir,
    "map-signals.json"
  );

  const existingMapSignals = readJsonIfExists(
    mapSignalsPath,
    null
  );

  const latestMapSignals = buildLatestMapSignals({
    existingPayload: existingMapSignals,
    currentItems: payload.items,
    historicalItems: historicalItemsForMap,
    generatedAt: now,
    maximumSignals: Number(
      optEnv("MAP_SIGNAL_LIMIT", "50")
    )
  });

  writeJson(
    mapSignalsPath,
    latestMapSignals
  );

  /*
   * Build article pages.
   */
  for (const item of payload.items) {
    const id = cleanString(item.id);
    if (!id) continue;

    const html = renderArticleHtml({
      siteOrigin,
      item,
      payload
    });

    writeFile(
      path.join(articlesDir, `${id}.html`),
      html
    );
  }

  /*
   * Read all history after writing today's file so trends include the
   * latest briefing.
   */
  const historyPayloads = readHistoryPayloads(historyDir);

  const trends = buildTrends(historyPayloads, now);
  const outlook = buildOutlook(trends, now);

  writeJson(
    path.join(briefsDir, "trends.json"),
    trends
  );

  writeJson(
    path.join(briefsDir, "outlook.json"),
    outlook
  );

  console.log("PTD Today generation complete.");
  console.log(`- ${path.join(briefsDir, "daily-ai.json")}`);
  console.log(`- ${path.join(briefsDir, "trends.json")}`);
  console.log(`- ${path.join(briefsDir, "outlook.json")}`);
  console.log(`- ${path.join(briefsDir, "map-signals.json")}`);
  console.log(`- ${path.join(historyDir, `${today}.json`)}`);
  console.log(`- ${articlesDir}/*.html`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
