PTD TODAY — generate_ai_news.js ROOT FIX
===========================================

Do NOT run the workflow until these edits are made.

A) ADD THIS CONTROLLED COUNTRY SET
----------------------------------
Place immediately after COUNTRY_ALIASES:

const VALID_COUNTRY_NAMES = new Set([
  "Algeria","Argentina","Australia","Belgium","Brazil","Canada","Chile","China",
  "Colombia","Denmark","Egypt","Finland","France","Germany","Greece","India",
  "Indonesia","Israel","Italy","Japan","Kenya","Malaysia","Mexico","Morocco",
  "Netherlands","New Zealand","Nigeria","Norway","Oman","Peru","Philippines",
  "Poland","Portugal","Qatar","Saudi Arabia","Singapore","South Africa",
  "South Korea","Spain","Sweden","Thailand","Türkiye","United Arab Emirates",
  "United Kingdom","United States","Vietnam","Democratic Republic of the Congo",
  "Czechia","Austria","Switzerland","Ireland"
]);

function normalizeCountries(value, maxItems = 8) {
  return cleanStringArray(value, maxItems)
    .map(normalizeCountryName)
    .filter((country) => VALID_COUNTRY_NAMES.has(country));
}

function validIsoTimestamp(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function safeCreatedAt(item, fallbackIso) {
  if (validIsoTimestamp(item?.created_at)) return item.created_at;

  if (validIsoTimestamp(item?.source_updated_at)) return item.source_updated_at;

  const sourceDate = cleanString(item?.source_date_utc);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) {
    return `${sourceDate}T12:00:00.000Z`;
  }

  const idText = cleanString(item?.development_id || item?.article_id || item?.id);
  const match = idText.match(/(?:^|[-_])((?:19|20)\d{2})(\d{2})(\d{2})(?:[-_]|$)/);
  if (match) {
    const candidate = `${match[1]}-${match[2]}-${match[3]}T12:00:00.000Z`;
    if (!Number.isNaN(Date.parse(candidate))) return candidate;
  }

  return fallbackIso;
}


B) IN normalizeItem(), REPLACE:
-------------------------------
  const countries = cleanStringArray(item?.countries, 8)
    .map(normalizeCountryName)
    .filter(Boolean);

WITH:

  const countries = normalizeCountries(item?.countries, 8);


C) REPLACE signalDedupKey() COMPLETELY WITH:
---------------------------------------------
function signalDedupKey(item) {
  const countries = normalizeCountries(item?.countries, 8)
    .sort()
    .join("|");

  return [
    normalizeKey(item?.title),
    normalizeKey(item?.category),
    countries
  ].join("::");
}


D) REPLACE toMapSignal() COMPLETELY WITH:
-----------------------------------------
function toMapSignal(item, generatedAt) {
  const countries = normalizeCountries(item?.countries, 8);
  const createdAt = safeCreatedAt(item, generatedAt);

  return {
    signal_id: stableId(
      "sig",
      [
        item?.development_id || item?.id,
        compactTimestamp(createdAt)
      ].join("::")
    ),
    article_id: cleanString(item?.development_id || item?.id),
    development_id: cleanString(item?.development_id || item?.id),
    created_at: createdAt,
    category: normalizeCategory(item?.category),
    region: normalizeRegion(item?.region),
    countries,
    title: cleanString(item?.title, "Untitled intelligence signal"),
    summary: cleanString(
      item?.summary || item?.lede,
      "AI-generated intelligence signal for monitoring."
    ),
    why_it_matters: cleanString(item?.why_it_matters),
    confidence_label: cleanString(item?.confidence_label, "Medium"),
    confidence_score: round(clamp(item?.confidence_score, 0.55, 0.9), 2),
    importance_score: Math.round(
      clamp(item?.importance_score ?? 70, 40, 100)
    ),
    entity_ids: [...new Set(
      (item?.entities || []).map((entity) => entity?.entity_id).filter(Boolean)
    )],
    tags: cleanStringArray(item?.tags, 12),
    watchlist: cleanStringArray(item?.watchlist, 6),
    evidence_mode: item?.evidence?.mode || "ai_scenario",
    dedup_key: signalDedupKey({ ...item, countries })
  };
}


E) IN buildLatestMapSignals(), REPLACE THE combined BLOCK:
----------------------------------------------------------
  const combined = [
    ...currentItems.map((item) => toMapSignal(item, generatedAt)),
    ...existingSignals,
    ...(historicalItems || []).map((item) =>
      toMapSignal(item, item?.created_at || generatedAt)
    )
  ];

WITH:

  // IMPORTANT:
  // Rebuild from normalized current + historical intelligence.
  // Do not recycle existing map signals back into the next generation, because
  // that can perpetuate legacy structural contamination indefinitely.
  const combined = [
    ...currentItems.map((item) => toMapSignal(item, generatedAt)),
    ...(historicalItems || []).map((item) =>
      toMapSignal(item, generatedAt)
    )
  ];


F) DELETE THESE NOW-UNUSED LINES FROM buildLatestMapSignals():
--------------------------------------------------------------
  const existingSignals = Array.isArray(existingPayload?.signals)
    ? existingPayload.signals
    : [];

You can keep the existingPayload parameter temporarily for backward
compatibility, but it will no longer be used.

WHY THIS FIX WORKS
------------------
- Current model output is filtered through a controlled country taxonomy.
- Historical records get safe timestamps from source_date_utc/source_updated_at.
- Yesterday's map is no longer recursively re-injected into today's map.
- map-signals.json becomes a projection of source intelligence, not a second
  self-feeding historical store.
- The permanent normalizer still runs after entity resolution to catch any
  post-resolution orphan IDs before the strict Cosmos gate.
