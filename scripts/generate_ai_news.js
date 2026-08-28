



// scripts/generate_ai_news.js
// PTD Today — Transitional Intelligence Generator for the new PTDToday.com
//
// DECISION: KEEP AND MODERNIZE
//
// This file preserves the current live outputs while also creating the first
// structured knowledge files required by the new PTDToday architecture.
//
// Legacy-compatible outputs:
//   - briefs/daily-ai.json
//   - briefs/trends.json
//   - briefs/outlook.json
//   - briefs/map-signals.json
//   - history/YYYY-MM-DD.json
//   - articles/<development-id>.html
//   - summary-share/YYYY-MM-DD.html
//
// New architecture outputs:
//   - knowledge/developments.json
//   - knowledge/entities.json
//   - knowledge/relationships.json
//   - knowledge/timeline-events.json
//   - knowledge/knowledge-diff.json
//
// Important:
//   - This generator currently creates AI scenario intelligence, not verified
//     reporting. That status is explicit in every generated object.
//   - When real source ingestion is added, source records and evidence links
//     will be attached without changing the object identities.
//   - robots.txt and sitemaps remain owned by scripts/build.mjs.
//   - Article views continue using the existing Cloudflare Worker endpoint.

import fs from "fs";
import path from "path";
import OpenAI from "openai";

/* -------------------------------------------------------------------------- */
/* Environment and filesystem helpers                                         */
/* -------------------------------------------------------------------------- */

function mustEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

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

function readJsonIfExists(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`Could not read ${filePath}: ${error.message}`);
    return fallback;
  }
}

function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort();
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
  return String(dateOnly || "").replace(/-/g, "");
}

function compactTimestamp(isoValue) {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return String(isoValue || "").replace(/[^0-9]/g, "").slice(0, 14);
  }

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0")
  ].join("");
}

function parseDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  ));

  return Number.isNaN(date.getTime()) ? null : date;
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

function daysAgoDateOnly(daysAgo) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return utcDateOnly(date);
}

/* -------------------------------------------------------------------------- */
/* Text, IDs, and normalization                                               */
/* -------------------------------------------------------------------------- */

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

function stableId(prefix, value) {
  return `${prefix}_${stableHash(value)}`;
}

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
  const text = cleanString(value);
  if (!text) return [];

  return text.split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);
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

const VALID_ENTITY_TYPES = new Set([
  "Technology",
  "Company",
  "Country",
  "Organization",
  "Material",
  "Project",
  "Standard",
  "Policy",
  "Infrastructure",
  "Market",
  "Concept"
]);

const VALID_RELATIONSHIP_TYPES = new Set([
  "DEPENDS_ON",
  "INCREASES",
  "REDUCES",
  "SUPPLIES",
  "LOCATED_IN",
  "OWNED_BY",
  "DEVELOPED_BY",
  "REGULATES",
  "REQUIRES",
  "COMPETES_WITH",
  "REPLACES",
  "ENABLES",
  "USES",
  "MANUFACTURES",
  "FUNDS",
  "SUPPORTS",
  "AFFECTS",
  "CONNECTED_TO"
]);

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

const VALID_COUNTRIES = new Set([
  "Algeria","Argentina","Australia","Austria","Bahrain","Bangladesh","Belgium",
  "Bolivia","Brazil","Bulgaria","Canada","Chile","China","Colombia","Costa Rica",
  "Croatia","Czechia","Denmark","Dominican Republic","Ecuador","Egypt","Estonia",
  "Ethiopia","Finland","France","Germany","Ghana","Greece","Hungary","Iceland",
  "India","Indonesia","Iraq","Ireland","Israel","Italy","Japan","Jordan","Kenya",
  "Kuwait","Latvia","Lithuania","Luxembourg","Malaysia","Mexico","Morocco",
  "Netherlands","New Zealand","Nigeria","Norway","Oman","Pakistan","Panama",
  "Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania",
  "Saudi Arabia","Senegal","Serbia","Singapore","Slovakia","Slovenia",
  "South Africa","South Korea","Spain","Sri Lanka","Sweden","Switzerland",
  "Tanzania","Thailand","Tunisia","Türkiye","Ukraine",
  "United Arab Emirates","United Kingdom","United States","Uruguay","Vietnam",
  "Democratic Republic of the Congo"
]);

function normalizeCountries(value) {
  return cleanStringArray(value, 8)
    .map(normalizeCountryName)
    .filter((country) => VALID_COUNTRIES.has(country));
}

function normalizeCountryName(value) {
  const raw = cleanString(value);
  if (!raw) return "";
  return COUNTRY_ALIASES[normalizeKey(raw)] || raw;
}

function normalizeCategory(value) {
  const category = cleanString(value, "Power Grid");
  return VALID_CATEGORIES.has(category) ? category : "Power Grid";
}

function normalizeRegion(value) {
  const region = cleanString(value, "Global");
  return VALID_REGIONS.has(region) ? region : "Global";
}

function normalizeEntityType(value) {
  const type = cleanString(value, "Concept");
  return VALID_ENTITY_TYPES.has(type) ? type : "Concept";
}

function normalizeRelationshipType(value) {
  const type = cleanString(value, "CONNECTED_TO")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");

  return VALID_RELATIONSHIP_TYPES.has(type) ? type : "CONNECTED_TO";
}

/* -------------------------------------------------------------------------- */
/* New structured knowledge objects                                           */
/* -------------------------------------------------------------------------- */

function normalizeEntity(raw) {
  const name = cleanString(raw?.name);
  if (!name) return null;

  const type = normalizeEntityType(raw?.type);
  const canonicalKey = `${type}:${normalizeKey(name)}`;

  return {
    entity_id: stableId("ent", canonicalKey),
    slug: normalizeKey(name),
    name,
    type,
    description: cleanString(raw?.description),
    aliases: cleanStringArray(raw?.aliases, 8),
    status: "active",
    confidence: round(clamp(raw?.confidence ?? 0.75, 0.55, 0.95), 2),
    first_seen_at: null,
    last_seen_at: null
  };
}

function normalizeRelationship(raw, entityLookup, developmentId, now) {
  const fromName = cleanString(raw?.from);
  const toName = cleanString(raw?.to);
  if (!fromName || !toName) return null;

  const fromEntity = entityLookup.get(normalizeKey(fromName));
  const toEntity = entityLookup.get(normalizeKey(toName));
  if (!fromEntity || !toEntity) return null;

  const relationshipType = normalizeRelationshipType(raw?.type);
  const relationshipKey = [
    fromEntity.entity_id,
    relationshipType,
    toEntity.entity_id
  ].join("::");

  return {
    relationship_id: stableId("rel", relationshipKey),
    from_entity_id: fromEntity.entity_id,
    to_entity_id: toEntity.entity_id,
    relationship_type: relationshipType,
    label: cleanString(raw?.label),
    explanation: cleanString(raw?.explanation),
    strength: Math.round(clamp(raw?.strength ?? 65, 1, 100)),
    confidence: round(clamp(raw?.confidence ?? 0.7, 0.55, 0.95), 2),
    evidence_mode: "ai_scenario",
    evidence_development_ids: [developmentId],
    source_ids: [],
    valid_from: now,
    valid_to: null,
    status: "active",
    version: 1
  };
}

function normalizeItem(item, index, dateOnly, now) {
  const provisionalTitle = cleanString(
    item?.title,
    `Untitled intelligence signal ${index + 1}`
  );

  const developmentId = cleanString(
    item?.id,
    stableId("dev", `${dateOnly}:${provisionalTitle}`)
  );

  const confidenceScore = clamp(item?.confidence_score, 0.55, 0.9);
  const confidenceLabel =
    confidenceScore >= 0.78
      ? "High"
      : confidenceScore >= 0.66
        ? "Medium"
        : "Low";

  const region = normalizeRegion(item?.region);
  const countries = normalizeCountries(item?.countries);

  const entities = (Array.isArray(item?.entities) ? item.entities : [])
    .map(normalizeEntity)
    .filter(Boolean);

  for (const country of countries) {
    const countryEntity = normalizeEntity({
      name: country,
      type: "Country",
      confidence: 0.95
    });

    if (
      countryEntity &&
      !entities.some((entity) => entity.entity_id === countryEntity.entity_id)
    ) {
      entities.push(countryEntity);
    }
  }

  const entityLookup = new Map();
  for (const entity of entities) {
    entityLookup.set(normalizeKey(entity.name), entity);
    for (const alias of entity.aliases) {
      entityLookup.set(normalizeKey(alias), entity);
    }
  }

  const relationships = (Array.isArray(item?.relationships)
    ? item.relationships
    : []
  )
    .map((relationship) =>
      normalizeRelationship(
        relationship,
        entityLookup,
        developmentId,
        now
      )
    )
    .filter(Boolean);

  return {
    id: developmentId,
    development_id: developmentId,
    created_at: cleanString(item?.created_at, now),
    date_utc: dateOnly,
    category: normalizeCategory(item?.category),
    region,
    countries,
    title: provisionalTitle,
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
    why_it_matters: cleanString(
      item?.why_it_matters,
      item?.summary || item?.lede || "This signal may affect the power and energy ecosystem."
    ),
    event_type: cleanString(item?.event_type, "Scenario Signal"),
    confidence_label: ["Low", "Medium", "High"].includes(item?.confidence_label)
      ? item.confidence_label
      : confidenceLabel,
    confidence_score: round(confidenceScore, 2),
    importance_score: Math.round(
      clamp(item?.importance_score ?? item?.importance ?? 70, 40, 100)
    ),
    tags: cleanStringArray(item?.tags, 12),
    watchlist: cleanStringArray(item?.watchlist, 10),
    action_for_readers: cleanString(
      item?.action_for_readers,
      "Monitor additional evidence before making operational or investment decisions."
    ),
    lenses: {
      engineering: cleanString(item?.lenses?.engineering),
      business: cleanString(item?.lenses?.business),
      policy: cleanString(item?.lenses?.policy),
      climate: cleanString(item?.lenses?.climate),
      history: cleanString(item?.lenses?.history)
    },
    evidence: {
      mode: "ai_scenario",
      status: "unverified",
      source_ids: [],
      source_count: 0,
      note:
        "Generated as scenario intelligence without authoritative external sources."
    },
    entities,
    relationships,
    status: "published",
    version: 1
  };
}

function normalizeSections(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 6)
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
    let id = items[index].development_id;
    if (!id || seenIds.has(id)) {
      id = stableId(
        "dev",
        `${dateOnly}:${items[index].title}:${index + 1}`
      );
      items[index].id = id;
      items[index].development_id = id;
    }
    seenIds.add(id);
  }

  return {
    schema_version: "2.0-transitional",
    content_mode: "ai_scenario",
    title: cleanString(
      payload?.title,
      "PTD Today — Daily AI Intelligence Brief"
    ),
    disclaimer: cleanString(
      payload?.disclaimer,
      "Informational only — AI-generated scenario intelligence; may contain errors. Not investment or engineering advice."
    ),
    updated_at: cleanString(payload?.updated_at, now),
    date_utc: cleanString(payload?.date_utc, dateOnly),
    sections: normalizeSections(payload?.sections),
    items
  };
}

/* -------------------------------------------------------------------------- */
/* Knowledge extraction and merging                                           */
/* -------------------------------------------------------------------------- */

function mergeEntities(existingPayload, items, now) {
  const byId = new Map();

  for (const entity of existingPayload?.entities || []) {
    if (entity?.entity_id) byId.set(entity.entity_id, entity);
  }

  for (const item of items) {
    for (const entity of item.entities || []) {
      const existing = byId.get(entity.entity_id);

      byId.set(entity.entity_id, {
        ...existing,
        ...entity,
        first_seen_at: existing?.first_seen_at || item.created_at || now,
        last_seen_at: item.created_at || now,
        development_ids: cleanStringArray([
          ...(existing?.development_ids || []),
          item.development_id
        ], 500)
      });
    }
  }

  return {
    schema_version: "1.0",
    generated_at: now,
    entity_count: byId.size,
    entities: [...byId.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  };
}

function mergeRelationships(existingPayload, items, now) {
  const byId = new Map();

  for (const relationship of existingPayload?.relationships || []) {
    if (relationship?.relationship_id) {
      byId.set(relationship.relationship_id, relationship);
    }
  }

  for (const item of items) {
    for (const relationship of item.relationships || []) {
      const existing = byId.get(relationship.relationship_id);
      const evidenceIds = cleanStringArray([
        ...(existing?.evidence_development_ids || []),
        ...(relationship.evidence_development_ids || [])
      ], 500);

      byId.set(relationship.relationship_id, {
        ...existing,
        ...relationship,
        evidence_development_ids: evidenceIds,
        evidence_count: evidenceIds.length,
        first_seen_at: existing?.first_seen_at || item.created_at || now,
        last_seen_at: item.created_at || now,
        version: Number(existing?.version || 0) + 1
      });
    }
  }

  return {
    schema_version: "1.0",
    generated_at: now,
    relationship_count: byId.size,
    relationships: [...byId.values()].sort((a, b) =>
      Number(b.strength || 0) - Number(a.strength || 0)
    )
  };
}

function mergeDevelopments(existingPayload, items, now) {
  const byId = new Map();

  for (const item of existingPayload?.developments || []) {
    if (item?.development_id) byId.set(item.development_id, item);
  }

  for (const item of items) {
    byId.set(item.development_id, item);
  }

  const developments = [...byId.values()]
    .sort((a, b) =>
      String(b.created_at || "").localeCompare(String(a.created_at || ""))
    )
    .slice(0, 5000);

  return {
    schema_version: "1.0",
    generated_at: now,
    development_count: developments.length,
    developments
  };
}

function buildTimelineEvents(items, now) {
  return {
    schema_version: "1.0",
    generated_at: now,
    event_count: items.length,
    events: items.map((item) => ({
      timeline_event_id: stableId(
        "evt",
        `${item.development_id}:${item.created_at}`
      ),
      development_id: item.development_id,
      event_type: item.event_type,
      occurred_at: item.created_at,
      date_utc: item.date_utc,
      title: item.title,
      summary: item.summary,
      entity_ids: (item.entities || []).map((entity) => entity.entity_id),
      countries: item.countries,
      category: item.category,
      region: item.region,
      confidence: item.confidence_score,
      evidence_mode: item.evidence?.mode || "ai_scenario"
    }))
  };
}

function buildKnowledgeDiff(previousEntities, currentEntities, previousRelationships, currentRelationships, now) {
  const oldEntityIds = new Set(
    (previousEntities?.entities || []).map((entity) => entity.entity_id)
  );
  const oldRelationshipIds = new Set(
    (previousRelationships?.relationships || [])
      .map((relationship) => relationship.relationship_id)
  );

  const newEntities = (currentEntities.entities || [])
    .filter((entity) => !oldEntityIds.has(entity.entity_id));

  const newRelationships = (currentRelationships.relationships || [])
    .filter((relationship) =>
      !oldRelationshipIds.has(relationship.relationship_id)
    );

  return {
    schema_version: "1.0",
    generated_at: now,
    summary: {
      new_entity_count: newEntities.length,
      new_relationship_count: newRelationships.length
    },
    new_entities: newEntities.slice(0, 100),
    new_relationships: newRelationships.slice(0, 100)
  };
}

/* -------------------------------------------------------------------------- */
/* Map signal engine                                                          */
/* -------------------------------------------------------------------------- */

function signalDedupKey(item) {
  const countries = normalizeCountries(item?.countries)
    .sort()
    .join("|");

  return [
    normalizeKey(item?.title),
    normalizeKey(item?.category),
    countries
  ].join("::");
}

function toMapSignal(item, generatedAt) {
  const countries = normalizeCountries(item?.countries);

  return {
    signal_id: stableId(
      "sig",
      [
        item?.development_id || item?.id,
        compactTimestamp(item?.created_at || generatedAt)
      ].join("::")
    ),
    article_id: cleanString(item?.development_id || item?.id),
    development_id: cleanString(item?.development_id || item?.id),
    created_at: cleanString(item?.created_at, generatedAt),
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
    entity_ids: (item?.entities || []).map((entity) => entity.entity_id),
    tags: cleanStringArray(item?.tags, 12),
    watchlist: cleanStringArray(item?.watchlist, 6),
    evidence_mode: item?.evidence?.mode || "ai_scenario",
    dedup_key: signalDedupKey(item)
  };
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

function evidenceDevelopmentId(item) {
  return cleanString(item?.development_id || item?.id);
}

function rankWithEvidence(items, getter, limit = 20, labeler = null) {
  const groups = new Map();

  for (const item of items) {
    const values = getter(item);
    const list = Array.isArray(values) ? values : [values];
    const developmentId = evidenceDevelopmentId(item);

    for (const raw of list) {
      const name = cleanString(raw);
      if (!name) continue;

      const existing = groups.get(name) || {
        name,
        count: 0,
        evidence_development_ids: []
      };

      existing.count += 1;

      if (
        developmentId &&
        !existing.evidence_development_ids.includes(developmentId)
      ) {
        existing.evidence_development_ids.push(developmentId);
      }

      groups.set(name, existing);
    }
  }

  return [...groups.values()]
    .map((entry) => ({
      ...entry,
      ...(labeler ? { label: labeler(entry.name) } : {})
    }))
    .sort((a, b) =>
      b.count - a.count ||
      a.name.localeCompare(b.name)
    )
    .slice(0, limit);
}

function uniqueEvidenceIds(...lists) {
  return cleanStringArray(
    lists.flatMap((list) => Array.isArray(list) ? list : []),
    5000
  );
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

  const combined = [
    ...currentItems.map((item) => toMapSignal(item, generatedAt)),
    ...existingSignals,
    ...(historicalItems || []).map((item) =>
      toMapSignal(item, item?.created_at || generatedAt)
    )
  ];

  const seen = new Set();
  const unique = [];

  for (const signal of combined) {
    const key = cleanString(signal?.dedup_key) || signalDedupKey(signal);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    unique.push({ ...signal, dedup_key: key });
  }

  unique.sort((a, b) => {
    const dateDifference = String(b.created_at || "")
      .localeCompare(String(a.created_at || ""));

    if (dateDifference !== 0) return dateDifference;

    return Number(b.importance_score || 0) -
      Number(a.importance_score || 0);
  });

  const signals = unique.slice(0, maximumSignals);
  const countryCounts = countBy(signals, (signal) => signal.countries || []);
  const regionCounts = countBy(signals, (signal) => signal.region);
  const categoryCounts = countBy(signals, (signal) => signal.category);

  return {
    schema_version: "2.0-transitional",
    generated_at: generatedAt,
    mode: "latest-50",
    maximum_signals: maximumSignals,
    signal_count: signals.length,
    country_count: countryCounts.size,
    oldest_signal_at: signals.at(-1)?.created_at || null,
    newest_signal_at: signals[0]?.created_at || null,
    methodology: {
      summary:
        "The map shows the latest unique PTD Today intelligence signals.",
      evidence_mode:
        "Current signals are AI scenarios until verified source ingestion is connected.",
      caution:
        "Country assignment is included only when justified by the generated scenario."
    },
    coverage: {
      countries: mapToRankedArray(countryCounts, 100),
      regions: mapToRankedArray(regionCounts, 20),
      categories: mapToRankedArray(categoryCounts, 20)
    },
    signals
  };
}

/* -------------------------------------------------------------------------- */
/* Historical archive, trends, and transparent scenario outlooks              */
/* -------------------------------------------------------------------------- */

function mergeDailyHistory(existingPayload, currentPayload) {
  const existingItems = Array.isArray(existingPayload?.items)
    ? existingPayload.items
    : [];

  const itemsByKey = new Map();

  for (const item of [...currentPayload.items, ...existingItems]) {
    const key = signalDedupKey(item);
    if (!key || itemsByKey.has(key)) continue;
    itemsByKey.set(key, item);
  }

  const mergedItems = [...itemsByKey.values()]
    .sort((a, b) =>
      String(b.created_at || "").localeCompare(String(a.created_at || ""))
    )
    .slice(0, 300);

  return {
    ...existingPayload,
    ...currentPayload,
    updated_at: currentPayload.updated_at,
    date_utc: currentPayload.date_utc,
    items: mergedItems,
    archive_mode: "merged-daily-signals",
    signal_count: mergedItems.length
  };
}

function readHistoryPayloads(historyDir) {
  return listJsonFiles(historyDir)
    .map((fileName) => readJsonIfExists(path.join(historyDir, fileName), null))
    .filter((payload) =>
      payload &&
      payload.date_utc &&
      Array.isArray(payload.items)
    )
    .sort((a, b) => String(a.date_utc).localeCompare(String(b.date_utc)));
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

  const categories = rankWithEvidence(
    items,
    (item) => item.category,
    12
  );

  const regions = rankWithEvidence(
    items,
    (item) => item.region,
    12
  );

  const countries = rankWithEvidence(
    items,
    (item) => item.countries || [],
    30
  );

  const topics = rankWithEvidence(
    items,
    (item) => item.tags || [],
    30,
    topicLabelFromTag
  );

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
    categories,
    regions,
    countries,
    topics
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
  const shortRows = new Map(
    (Array.isArray(shortWindow[key]) ? shortWindow[key] : []).map((entry) => [
      entry.name,
      entry
    ])
  );

  const longRows = new Map(
    (Array.isArray(longWindow[key]) ? longWindow[key] : []).map((entry) => [
      entry.name,
      entry
    ])
  );

  const names = new Set([...shortRows.keys(), ...longRows.keys()]);
  const rows = [];

  for (const name of names) {
    const shortRow = shortRows.get(name) || {};
    const longRow = longRows.get(name) || {};

    const shortCount = Number(shortRow.count) || 0;
    const longCount = Number(longRow.count) || 0;
    const shortDaily = shortCount / Math.max(1, shortWindow.days);
    const longDaily = longCount / Math.max(1, longWindow.days);

    let momentumPercent = 0;
    if (longDaily > 0) {
      momentumPercent = ((shortDaily - longDaily) / longDaily) * 100;
    } else if (shortDaily > 0) {
      momentumPercent = 100;
    }

    const shortEvidenceIds = cleanStringArray(
      shortRow.evidence_development_ids,
      5000
    );
    const longEvidenceIds = cleanStringArray(
      longRow.evidence_development_ids,
      5000
    );
    const evidenceDevelopmentIds = uniqueEvidenceIds(
      shortEvidenceIds,
      longEvidenceIds
    );

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
            : "Stable",
      short_evidence_development_ids: shortEvidenceIds,
      long_evidence_development_ids: longEvidenceIds,
      evidence_development_ids: evidenceDevelopmentIds,
      evidence_signal_count: evidenceDevelopmentIds.length
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
    schema_version: "2.0-transitional",
    generated_at: generatedAt,
    evidence_mode: "ai_scenario_history",
    methodology: {
      summary:
        "Counts and momentum are derived from PTD Today AI scenario signals archived in history/*.json.",
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

function probabilityFromMomentum(momentumPercent, confidence = 0.7) {
  const momentumComponent = Math.tanh(Number(momentumPercent || 0) / 80);
  const confidenceComponent = clamp(confidence, 0.55, 0.9) - 0.55;

  return round(
    clamp(
      0.5 + momentumComponent * 0.26 + confidenceComponent * 0.35,
      0.35,
      0.9
    ),
    2
  );
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
      : `over the next ${horizonDays} days`;

  if (direction === "Rising") {
    return `Current PTD Today scenario-signal frequency suggests ${label} may remain elevated or strengthen ${horizon}.`;
  }

  if (direction === "Cooling") {
    return `Current PTD Today scenario-signal frequency suggests attention around ${label} may moderate ${horizon}.`;
  }

  return `Current PTD Today scenario-signal frequency suggests ${label} may remain broadly stable ${horizon}.`;
}

function buildOutlookEntries(momentumRows, horizonDays, limit = 8) {
  return momentumRows
    .filter((row) => row.short_count > 0 || row.long_count > 0)
    .slice(0, limit)
    .map((row) => {
      const evidenceDevelopmentIds = cleanStringArray(
        row.evidence_development_ids,
        5000
      );

      /*
       * The 7-day window is contained inside the 30-day window, so
       * short_count + long_count can double-count recent signals.
       * Outlook evidence is therefore based on UNIQUE contributing
       * development IDs.
       */
      const evidenceCount = evidenceDevelopmentIds.length ||
        Math.max(
          Number(row.short_count || 0),
          Number(row.long_count || 0)
        );

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
        evidence_development_ids: evidenceDevelopmentIds,
        short_evidence_development_ids: cleanStringArray(
          row.short_evidence_development_ids,
          5000
        ),
        long_evidence_development_ids: cleanStringArray(
          row.long_evidence_development_ids,
          5000
        ),
        evidence_mode: "ai_scenario_history",
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
    schema_version: "2.0-transitional",
    generated_at: generatedAt,
    disclaimer:
      "AI-generated probabilistic scenarios based only on PTD Today scenario-signal history. These are not guarantees, investment advice, operational instructions, verified forecasts, or engineering conclusions.",
    methodology: {
      summary:
        "Probabilities are a transparent heuristic based on recent scenario-signal frequency, unique contributing development evidence, and confidence metadata.",
      limitations: [
        "Current source intelligence is AI-generated scenario content.",
        "Signal frequency is not the same as real-world event probability.",
        "Outlooks require validation against authoritative primary sources.",
        "Low historical coverage reduces confidence.",
        "Evidence counts represent unique contributing development IDs; the 7-day subset is not added again to the 30-day evidence set."
      ]
    },
    horizons: {
      next_7_days: {
        topics: buildOutlookEntries(trends.momentum.topics, 7, 10),
        categories: buildOutlookEntries(trends.momentum.categories, 7, 8),
        regions: buildOutlookEntries(trends.momentum.regions, 7, 8),
        countries: buildOutlookEntries(trends.momentum.countries, 7, 10)
      },
      next_30_days: {
        topics: buildOutlookEntries(trends.momentum.topics, 30, 10),
        categories: buildOutlookEntries(trends.momentum.categories, 30, 8),
        regions: buildOutlookEntries(trends.momentum.regions, 30, 8),
        countries: buildOutlookEntries(trends.momentum.countries, 30, 10)
      }
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Daily intelligence summary share page                                      */
/* -------------------------------------------------------------------------- */

function renderSummaryShareHtml({ siteOrigin, payload }) {
  const date = cleanString(payload?.date_utc) || utcDateOnly();
  const base = String(siteOrigin || "https://ptdtoday.com").replace(/\/$/, "");
  const shareUrl = `${base}/summary-share/${encodeURIComponent(date)}.html`;
  const liveUrl = `${base}/?summary=${encodeURIComponent(date)}#todays-intelligence-summary`;

  const sections = Array.isArray(payload?.sections) ? payload.sections : [];
  const findSection = (heading) =>
    sections.find(
      (section) =>
        cleanString(section?.heading).toLowerCase() === heading.toLowerCase()
    );

  const topThemes = findSection("Top Themes");
  const whyItMatters = findSection("Why It Matters");
  const rippleEffects = findSection("Ripple Effects & Connections");
  const watch = findSection("What to Watch (24–72h)");

  const topBullets = Array.isArray(topThemes?.bullets)
    ? topThemes.bullets.filter(Boolean).slice(0, 3)
    : [];

  const description = cleanString(
    topBullets.length
      ? `PTD Today intelligence summary for ${date}: ${topBullets.join(" • ")}`
      : `PTD Today intelligence summary for ${date}.`
  ).slice(0, 300);

  const esc = escapeHtml;

  const sectionHtml = (section, note = "") => {
    const bullets = Array.isArray(section?.bullets)
      ? section.bullets.filter(Boolean)
      : [];

    if (!bullets.length) return "";

    return `
      <section class="summaryBlock">
        <h2>${esc(section.heading)}</h2>
        <ul>
          ${bullets.map((bullet) => `<li>${esc(bullet)}</li>`).join("")}
        </ul>
        ${note ? `<p class="note">${esc(note)}</p>` : ""}
      </section>
    `;
  };

  const title = `PTD Today — Intelligence Summary | ${date}`;
  const ogImage = `${base}/assets/og-default.png`;
  const causalPresentation = buildCausalPresentation(item, causalNarrative);
  const causalSectionsHtml = renderCausalSections(causalPresentation);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">

  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(shareUrl)}">

  <meta property="og:type" content="article">
  <meta property="og:site_name" content="PTD Today">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(shareUrl)}">
  <meta property="og:image" content="${esc(ogImage)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(ogImage)}">

  <style>
    :root{--ink:#111;--muted:#5c5c5c;--line:rgba(0,0,0,.15);--soft:rgba(0,0,0,.025)}
    *{box-sizing:border-box}
    body{margin:0;background:#fff;color:var(--ink);font-family:Georgia,"Times New Roman",serif}
    .wrap{max-width:820px;margin:0 auto;padding:34px 18px 60px}
    .brand{font-size:18px;font-weight:800;margin-bottom:22px}
    h1{font-size:42px;line-height:1.04;margin:0 0 8px}
    .date{color:var(--muted);margin-bottom:24px}
    .summaryBlock{border:1px solid var(--line);border-radius:16px;padding:18px;margin:12px 0;background:var(--soft)}
    .summaryBlock h2{font-size:24px;margin:0 0 10px}
    .summaryBlock ul{margin:0;padding-left:22px}
    .summaryBlock li{font-size:17px;line-height:1.5;margin:9px 0}
    .note{color:var(--muted);font-size:13px;font-style:italic;line-height:1.45}
    .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}
    .btn{appearance:none;border:1px solid #111;border-radius:999px;background:#111;color:#fff;
      padding:10px 15px;font:700 14px Georgia,"Times New Roman",serif;text-decoration:none;cursor:pointer}
    .btn.secondary{background:#fff;color:#111}
    .disclaimer{margin-top:24px;color:var(--muted);font-size:12px;line-height:1.5}
  </style>
</head>
<body>
  <main class="wrap">
    <div class="brand">PTD Today</div>
    <h1>Today’s Intelligence Summary</h1>
    <div class="date">${esc(date)}</div>

    ${sectionHtml(topThemes)}
    ${sectionHtml(
      whyItMatters,
      "Cross-signal synthesis explaining why today’s signals matter together."
    )}
    ${sectionHtml(
      rippleEffects,
      "Scenario propagation describes plausible second- and third-order effects, not guaranteed outcomes."
    )}
    ${sectionHtml(watch)}

    <div class="actions">
      <a class="btn" href="${esc(liveUrl)}">Explore on PTD Today →</a>
      <button class="btn secondary" id="shareSummary" type="button">Share ↗</button>
    </div>

    <p class="disclaimer">${esc(
      payload?.disclaimer ||
      "Informational only — AI-generated scenario intelligence; may contain errors. Not investment or engineering advice."
    )}</p>
  </main>

  <script>
    (function(){
      var title = ${JSON.stringify(title)};
      var text = ${JSON.stringify(description)};
      var url = ${JSON.stringify(shareUrl)};
      var button = document.getElementById("shareSummary");

      if(!button)return;

      button.addEventListener("click",async function(){
        if(navigator.share){
          try{
            await navigator.share({title:title,text:text,url:url});
            return;
          }catch(error){
            return;
          }
        }

        var draft = title + "\\n\\n" + text + "\\n\\n" + url;

        try{
          await navigator.clipboard.writeText(draft);
          alert("Summary share draft copied.");
        }catch(error){
          prompt("Copy this summary share draft:",draft);
        }
      });
    })();
  </script>
</body>
</html>`;
}


/* -------------------------------------------------------------------------- */
/* Cosmos article presentation helpers                                        */
/* -------------------------------------------------------------------------- */

function readJsonIfExistsSafe(filePath, fallback = null) {
  return readJsonIfExists(filePath, fallback);
}

function findCausalNarrativeForItem(item, knowledgeDir = "knowledge") {
  const candidates = [
    path.join(knowledgeDir, "cosmos", "causal-narrative-current.json"),
    path.join(knowledgeDir, "cosmos", "causal-narrative-test-v0.1.json")
  ];

  for (const filePath of candidates) {
    const payload = readJsonIfExistsSafe(filePath, null);
    if (!payload || typeof payload !== "object") continue;

    const focalId = cleanString(
      payload?.focal_signal?.development_id ||
      payload?.focal_signal?.signal_id ||
      payload?.focal_signal?.id
    );

    const itemId = cleanString(item?.development_id || item?.id);
    const focalTitle = cleanString(payload?.focal_signal?.title || payload?.focal_signal?.statement);
    const itemTitle = cleanString(item?.title);

    if (
      (focalId && itemId && focalId === itemId) ||
      (focalTitle && itemTitle &&
       normalizeKey(focalTitle) === normalizeKey(itemTitle))
    ) {
      return payload;
    }
  }

  return null;
}

function buildFallbackCausalPresentation(item) {
  const relationships = Array.isArray(item?.relationships) ? item.relationships : [];
  const entityById = new Map(
    (item?.entities || []).map((entity) => [entity.entity_id, entity.name])
  );

  const downstream = relationships.slice(0, 4).map((relationship, index) => ({
    depth: index + 1,
    from: entityById.get(relationship.from_entity_id) || "Signal",
    relation: cleanString(
      relationship.label ||
      relationship.relationship_type?.toLowerCase().replace(/_/g, " "),
      "affects"
    ),
    to: entityById.get(relationship.to_entity_id) || "Related system",
    confidence:
      Number.isFinite(Number(relationship.confidence))
        ? Math.round(Number(relationship.confidence) * 100)
        : null,
    qualification: "scenario relationship from article knowledge graph"
  }));

  return {
    why_now: cleanString(
      item?.summary || item?.lede,
      "This signal is active in today’s intelligence set."
    ),
    drivers: relationships.slice(0, 3).map((relationship) => ({
      statement: cleanString(
        relationship.explanation ||
        relationship.label ||
        relationship.relationship_type,
        "Related structural pressure is present."
      ),
      confidence:
        Number.isFinite(Number(relationship.confidence))
          ? Math.round(Number(relationship.confidence) * 100)
          : null
    })),
    consequences: downstream,
    change_conditions: cleanStringArray(item?.watchlist, 5),
    evidence_note:
      item?.evidence?.note ||
      "Scenario intelligence only; authoritative external evidence has not yet been attached."
  };
}

function buildCausalPresentation(item, causalNarrative = null) {
  if (!causalNarrative) return buildFallbackCausalPresentation(item);

  const whyNowRows = Array.isArray(causalNarrative?.why_now)
    ? causalNarrative.why_now
    : Array.isArray(causalNarrative?.activation_events)
      ? causalNarrative.activation_events
      : [];

  const drivers = Array.isArray(causalNarrative?.upstream_drivers)
    ? causalNarrative.upstream_drivers
    : [];

  const consequences = Array.isArray(causalNarrative?.downstream_consequences)
    ? causalNarrative.downstream_consequences
    : Array.isArray(causalNarrative?.butterfly_effect)
      ? causalNarrative.butterfly_effect
      : [];

  const changeConditions =
    cleanStringArray(
      causalNarrative?.change_conditions ||
      causalNarrative?.what_could_change_this_path ||
      item?.watchlist,
      6
    );

  return {
    why_now: whyNowRows
      .slice(0, 3)
      .map((row) =>
        cleanString(
          row?.statement ||
          row?.title ||
          row?.activation_event ||
          row?.description
        )
      )
      .filter(Boolean)
      .join(" "),
    drivers: drivers.slice(0, 4).map((row) => ({
      statement: cleanString(
        row?.statement ||
        row?.title ||
        row?.driver ||
        row?.description
      ),
      confidence: Number.isFinite(Number(row?.confidence))
        ? Math.round(Number(row.confidence))
        : Number.isFinite(Number(row?.effective_confidence))
          ? Math.round(Number(row.effective_confidence))
          : null
    })),
    consequences: consequences.slice(0, 6).map((row, index) => ({
      depth: Number(row?.depth || row?.butterfly_distance || index + 1),
      from: cleanString(row?.from || row?.from_name || row?.origin || ""),
      relation: cleanString(
        row?.relation ||
        row?.relationship ||
        row?.relationship_label ||
        "may affect"
      ),
      to: cleanString(
        row?.to ||
        row?.to_name ||
        row?.target ||
        row?.statement ||
        row?.consequence ||
        ""
      ),
      confidence: Number.isFinite(Number(row?.effective_confidence))
        ? Math.round(Number(row.effective_confidence))
        : Number.isFinite(Number(row?.confidence))
          ? Math.round(Number(row.confidence))
          : null,
      qualification: cleanString(
        row?.qualification ||
        row?.epistemic_status ||
        row?.claim_class ||
        "scenario"
      )
    })),
    change_conditions: changeConditions,
    evidence_note: cleanString(
      causalNarrative?.evidence_note ||
      causalNarrative?.evidence_status ||
      item?.evidence?.note,
      "Evidence lineage is preserved separately from causal interpretation."
    )
  };
}

function renderCausalSections(presentation) {
  const esc = escapeHtml;

  const driversHtml = (presentation.drivers || [])
    .filter((row) => row.statement)
    .map((row) => `
      <li>
        ${esc(row.statement)}
        ${row.confidence !== null ? `<span class="confidence">${row.confidence}% confidence</span>` : ""}
      </li>
    `)
    .join("");

  const consequenceRows = (presentation.consequences || [])
    .filter((row) => row.to || row.from)
    .map((row) => {
      const depthLabel =
        row.depth === 1 ? "Direct" :
        row.depth === 2 ? "2nd-order" :
        row.depth === 3 ? "3rd-order" :
        `Depth ${row.depth}`;

      const chain = [row.from, row.relation, row.to].filter(Boolean).join(" ");

      return `
        <div class="rippleRow">
          <div class="rippleDepth">${esc(depthLabel)}</div>
          <div class="rippleMain">
            <div class="rippleChain">${esc(chain)}</div>
            <div class="rippleMeta">
              ${row.confidence !== null ? `${esc(String(row.confidence))}% effective confidence` : ""}
              ${row.qualification ? `${row.confidence !== null ? " • " : ""}${esc(row.qualification)}` : ""}
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  const changeHtml = (presentation.change_conditions || [])
    .map((item) => `<li>${esc(item)}</li>`)
    .join("");

  return `
    ${presentation.why_now ? `
      <section class="cosmosBlock">
        <div class="eyebrow">Why Cosmos noticed this today</div>
        <p>${esc(presentation.why_now)}</p>
      </section>
    ` : ""}

    ${driversHtml ? `
      <section class="cosmosBlock">
        <div class="eyebrow">What is driving it</div>
        <ul class="driverList">${driversHtml}</ul>
      </section>
    ` : ""}

    ${consequenceRows ? `
      <section class="cosmosBlock butterfly">
        <div class="eyebrow">🦋 Butterfly Effect</div>
        <div class="butterflyIntro">
          The signal may propagate through connected systems. Deeper paths carry lower confidence and remain scenario-qualified.
        </div>
        <div class="rippleStack">${consequenceRows}</div>
      </section>
    ` : ""}

    ${changeHtml ? `
      <section class="cosmosBlock">
        <div class="eyebrow">What could change this path?</div>
        <ul class="driverList">${changeHtml}</ul>
      </section>
    ` : ""}

    <section class="cosmosBlock evidenceBox">
      <div class="eyebrow">Evidence & confidence</div>
      <p>${esc(presentation.evidence_note)}</p>
    </section>
  `;
}

/* -------------------------------------------------------------------------- */
/* Backward-compatible article rendering                                      */
/* -------------------------------------------------------------------------- */

function renderArticleHtml({ siteOrigin, item, payload, causalNarrative = null }) {
  const id = cleanString(item.development_id || item.id);
  const title = cleanString(item.title, "PTD Today");
  const lede = cleanString(item.lede || item.summary);
  const body = cleanString(item.body);
  const description = cleanString(
    lede || body,
    "PTD Today intelligence."
  ).replace(/\s+/g, " ").slice(0, 180);

  const base = siteOrigin.replace(/\/$/, "");
  const url = `${base}/articles/${encodeURIComponent(id)}.html`;
  const ogImage = `${base}/assets/og-default.png`;

  const bodyParagraphs = toTextParagraphs(body)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("\n");

  const entityLinks = (item.entities || []).map((entity) =>
    `<span class="chip">${escapeHtml(entity.name)}</span>`
  ).join("");

  const relationshipRows = (item.relationships || []).slice(0, 8)
    .map((relationship) => {
      const from = (item.entities || []).find(
        (entity) => entity.entity_id === relationship.from_entity_id
      )?.name || "Entity";
      const to = (item.entities || []).find(
        (entity) => entity.entity_id === relationship.to_entity_id
      )?.name || "Entity";

      return `<li><strong>${escapeHtml(from)}</strong> ${escapeHtml(
        relationship.label || relationship.relationship_type.toLowerCase().replace(/_/g, " ")
      )} <strong>${escapeHtml(to)}</strong></li>`;
    })
    .join("");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    datePublished: item.created_at || payload.updated_at,
    dateModified: payload.updated_at || item.created_at,
    mainEntityOfPage: url,
    publisher: {
      "@type": "Organization",
      name: "PTD Today"
    }
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
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
    :root{--ink:#101828;--muted:#667085;--line:#e4e7ec;--paper:#fff;--soft:#f8fafc;--accent:#155eef}
    *{box-sizing:border-box}
    body{margin:0;background:var(--soft);color:var(--ink);font:16px/1.65 Inter,Arial,sans-serif}
    a{color:inherit}
    .wrap{max-width:900px;margin:auto;padding:28px 18px 64px}
    .mast{text-align:center;margin-bottom:28px}
    .brand{font:800 42px/1.1 Georgia,serif;text-decoration:none}
    .tagline{margin-top:7px;color:var(--muted)}
    .nav{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:15px}
    .nav a{padding:7px 12px;border:1px solid var(--line);border-radius:999px;text-decoration:none;background:#fff}
    article{background:var(--paper);border:1px solid var(--line);border-radius:20px;padding:28px;box-shadow:0 16px 50px rgba(16,24,40,.06)}
    .meta{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}
    h1{font:800 clamp(34px,7vw,56px)/1.04 Georgia,serif;margin:10px 0 16px}
    .lede{font-size:20px;color:#344054}
    .why{margin:24px 0;padding:18px;border-left:4px solid var(--accent);background:#eff4ff;border-radius:0 14px 14px 0}
    .cosmosBlock{margin:24px 0;padding:20px;border:1px solid var(--line);border-radius:16px;background:#fff}
    .eyebrow{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#344054;margin-bottom:8px}
    .driverList{margin:0;padding-left:20px}.driverList li{margin:9px 0}
    .confidence{display:inline-block;margin-left:8px;color:var(--muted);font-size:12px}
    .butterfly{background:linear-gradient(180deg,#fff,#f8fafc)}
    .butterflyIntro{color:var(--muted);margin-bottom:14px}
    .rippleStack{display:grid;gap:10px}
    .rippleRow{display:grid;grid-template-columns:90px 1fr;gap:12px;align-items:start;padding:12px;border:1px solid var(--line);border-radius:12px;background:#fff}
    .rippleDepth{font-size:12px;font-weight:800;color:#344054}
    .rippleChain{font-weight:700}
    .rippleMeta{color:var(--muted);font-size:12px;margin-top:4px}
    .evidenceBox{background:#fcfcfd}
    .content p{margin:0 0 16px}
    h2{font-size:20px;margin:28px 0 10px}
    .chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}
    .chip{padding:6px 10px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:13px}
    .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:26px}
    .btn{display:inline-flex;align-items:center;padding:10px 14px;border-radius:999px;border:1px solid var(--line);background:#fff;text-decoration:none;cursor:pointer}
    .btn.primary{background:var(--ink);color:#fff}
    .footer{text-align:center;color:var(--muted);font-size:13px;margin-top:24px}
  </style>
</head>
<body>
  <div class="wrap">
    <header class="mast">
      <a class="brand" href="/">PTD Today</a>
      <div class="tagline">Understand what changed — and why it matters.</div>
      <nav class="nav" aria-label="Primary navigation">
        <a href="/">Home</a>
        <a href="/media.html">Media</a>
        <a href="/groups.html">Groups</a>
      </nav>
    </header>

    <article>
      <div class="meta">
        ${escapeHtml(item.category)} • ${escapeHtml(item.region)} •
        ${escapeHtml(item.created_at)}
      </div>

      <h1>${escapeHtml(title)}</h1>
      <p class="lede">${escapeHtml(lede)}</p>

      ${causalSectionsHtml.split('<section class="cosmosBlock evidenceBox">')[0]}

      <div class="content">${bodyParagraphs}</div>

      <section class="why">
        <strong>Why it matters</strong>
        <div>${escapeHtml(item.why_it_matters)}</div>
      </section>

      ${relationshipRows ? `
        <h2>Follow the ripple</h2>
        <ul>${relationshipRows}</ul>
      ` : ""}

      <section class="cosmosBlock evidenceBox">
        <div class="eyebrow">Evidence & confidence</div>
        <p>${escapeHtml(causalPresentation.evidence_note)}</p>
        <p>
          This item is currently classified as
          <strong>AI-generated scenario intelligence</strong> and is not verified reporting.
        </p>
      </section>

      <div class="chips">
        ${entityLinks}
        ${(item.tags || []).map((tag) =>
          `<span class="chip">${escapeHtml(tag)}</span>`
        ).join("")}
      </div>

      <div class="actions">
        <a class="btn" href="/#${encodeURIComponent(id)}">Back to Home</a>
        <span class="btn" id="articleViewCounter" hidden>
          👁 <span id="articleViewCount">—</span> views
        </span>
        <button class="btn primary" id="shareBtn" type="button">Share</button>
      </div>
    </article>

    <div class="footer">© ${new Date().getFullYear()} PTD Today</div>
  </div>

  <script>
    (function(){
      var articleId = ${JSON.stringify(id)};
      var title = ${JSON.stringify(title)};
      var text = ${JSON.stringify(description)};
      var url = ${JSON.stringify(url)};

      document.getElementById("shareBtn")?.addEventListener("click", async function(){
        if (navigator.share) {
          try {
            await navigator.share({ title: title, text: text, url: url });
            return;
          } catch (error) {}
        }

        try {
          await navigator.clipboard.writeText(url);
          alert("Article link copied.");
        } catch (error) {
          prompt("Copy this article link:", url);
        }
      });

      async function registerArticleView(){
        var counter = document.getElementById("articleViewCounter");
        var countElement = document.getElementById("articleViewCount");
        if (!counter || !countElement || !articleId) return;

        try {
          var response = await fetch(
            "https://ptdtoday-view-counter.ozgurayrilmaz.workers.dev/view/" +
            encodeURIComponent(articleId),
            { method:"POST", mode:"cors", cache:"no-store" }
          );

          if (!response.ok) throw new Error("View request failed");

          var data = await response.json();
          var views = Number(data.views) || 0;

          countElement.textContent = new Intl.NumberFormat("en-US", {
            notation: views >= 1000 ? "compact" : "standard",
            maximumFractionDigits: 1
          }).format(views);

          counter.hidden = false;
        } catch (error) {
          console.error("View counter error:", error);
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

CRITICAL STATUS:
- You are generating scenario intelligence, not verified reporting.
- Do not present unverified events as established facts.
- Never fabricate quotations, named sources, statistics, project awards,
  regulatory decisions, incidents, prices, company announcements, or dates.
- Use language such as "signals", "scenario", "may", "could",
  "current indications", and "what to monitor".
- Output valid JSON only.

SUBJECT AREA:
- Power grids
- Transmission and substations
- High-voltage equipment
- EPC and OEM activity
- Data-center power
- Renewables
- Critical minerals
- Markets and policy
- AI in energy

DAILY SUMMARY REASONING:
- The daily summary must synthesize across the 10 generated intelligence items.
- It must contain exactly four sections in this order:
  1. Top Themes
  2. Why It Matters
  3. Ripple Effects & Connections
  4. What to Watch (24–72h)
- "Why It Matters" must explain connections among multiple signals, not restate headlines.
- "Ripple Effects & Connections" must express plausible second- and third-order
  scenario propagation using arrow-style chains such as:
  "Data-center load growth → substation pressure → transformer demand → procurement risk."
- Never convert correlation into certainty. Use "may", "could", "if sustained",
  "would increase pressure", and similar scenario framing where causality is uncertain.
- Do not introduce named facts, companies, projects, prices, statistics, policies,
  or events that are not represented in the generated intelligence items.
- The summary should be useful to an executive deciding what deserves attention next.

NEW STRUCTURED KNOWLEDGE REQUIREMENTS:
Every item must include:
- why_it_matters
- event_type
- entities
- relationships
- perspective lenses

ENTITY RULES:
- Use only meaningful entities.
- Entity types:
  Technology, Company, Country, Organization, Material, Project,
  Standard, Policy, Infrastructure, Market, Concept.
- Do not invent company, project, policy, or standard names.
- Generic concepts such as "Transformer Manufacturing" are acceptable.
- Countries must be explicit only when responsibly justified.

RELATIONSHIP RULES:
- Relationship endpoints must exactly match names in the entities array.
- Relationship types:
  DEPENDS_ON, INCREASES, REDUCES, SUPPLIES, LOCATED_IN, OWNED_BY,
  DEVELOPED_BY, REGULATES, REQUIRES, COMPETES_WITH, REPLACES,
  ENABLES, USES, MANUFACTURES, FUNDS, SUPPORTS, AFFECTS, CONNECTED_TO.
- Each relationship needs strength from 1 to 100 and confidence from 0.55 to 0.95.
- Avoid weak or decorative relationships.

STYLE:
- Executive intelligence tone.
- Clear uncertainty.
- Concise but useful.
- No markdown and no text outside the JSON object.
`.trim();
}

function buildUserPrompt(dateOnly, now) {
  return `
Generate the PTD Today daily AI scenario-intelligence brief for "${dateOnly}".

Return exactly this JSON structure:

{
  "title": "PTD Today — Daily AI Intelligence Brief",
  "disclaimer": "Informational only — AI-generated scenario intelligence; may contain errors. Not investment or engineering advice.",
  "updated_at": "${now}",
  "date_utc": "${dateOnly}",
  "sections": [
    {
      "heading": "Top Themes",
      "bullets": [
        "Three concise cross-signal themes grounded in the 10 generated items."
      ]
    },
    {
      "heading": "Why It Matters",
      "bullets": [
        "Two or three synthesis statements explaining why multiple themes matter together and what system-level pressure or opportunity they may create."
      ]
    },
    {
      "heading": "Ripple Effects & Connections",
      "bullets": [
        "Three or four scenario chains using arrows, for example: Load growth → substation pressure → transformer demand → procurement lead-time risk."
      ]
    },
    {
      "heading": "What to Watch (24–72h)",
      "bullets": [
        "Three specific observable triggers or indicators that would strengthen, weaken, or redirect the scenario."
      ]
    }
  ],
  "items": [
    {
      "created_at": "${now}",
      "category": "Power Grid",
      "region": "North America",
      "countries": ["United States"],
      "title": "Short scenario headline",
      "lede": "One strong paragraph.",
      "body": "Professional analysis with short paragraphs separated by blank lines.",
      "summary": "Two or three concise sentences.",
      "why_it_matters": "One concise explanation of broader significance.",
      "event_type": "Scenario Signal",
      "confidence_label": "Medium",
      "confidence_score": 0.72,
      "importance_score": 78,
      "tags": ["transformers", "grid-expansion"],
      "watchlist": ["specific signal to monitor"],
      "action_for_readers": "One practical monitoring action.",
      "lenses": {
        "engineering": "Engineering interpretation.",
        "business": "Business interpretation.",
        "policy": "Policy interpretation.",
        "climate": "Climate interpretation.",
        "history": "Historical interpretation."
      },
      "entities": [
        {
          "name": "Artificial Intelligence",
          "type": "Technology",
          "description": "Short stable description.",
          "aliases": ["AI"],
          "confidence": 0.9
        },
        {
          "name": "Data Centers",
          "type": "Infrastructure",
          "description": "Short stable description.",
          "aliases": [],
          "confidence": 0.9
        }
      ],
      "relationships": [
        {
          "from": "Artificial Intelligence",
          "type": "INCREASES",
          "to": "Data Centers",
          "label": "increases demand for",
          "explanation": "Concise explanation using scenario framing.",
          "strength": 82,
          "confidence": 0.78
        }
      ]
    }
  ]
}

REQUIREMENTS:
- Exactly 10 items.
- sections must contain exactly 4 sections in this exact order:
  Top Themes; Why It Matters; Ripple Effects & Connections; What to Watch (24–72h).
- Top Themes: 3 bullets.
- Why It Matters: 2 to 3 bullets; each must synthesize at least two generated signals or domains.
- Ripple Effects & Connections: 3 to 4 bullets; each must contain at least one "→"
  and describe a plausible multi-step propagation chain.
- What to Watch (24–72h): 3 bullets; use observable indicators/triggers rather than generic advice.
- Summary reasoning must remain scenario-framed and must not add unsupported named facts.
- No item IDs are required; the generator creates stable IDs.
- confidence_score: 0.55 to 0.90.
- importance_score: integer 40 to 100.
- 3 to 8 meaningful entities per item.
- 1 to 6 meaningful relationships per item.
- Every relationship endpoint must match an entity name exactly.
- Do not invent named companies, projects, regulations, standards, awards,
  incidents, prices, or primary-source claims.
- Use [] for countries when a specific assignment is not justified.
- countries[] may contain country names only; never place technologies, topics,
  markets, equipment, tags, sectors, or procurement terms in countries[].
- Include geographic and category variety.
`.trim();
}

async function generateBrief(client, dateOnly, now) {
  const response = await client.responses.create({
    model: optEnv("OPENAI_MODEL", "gpt-5-mini"),
    input: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(dateOnly, now) }
    ],
    text: {
      format: {
        type: "json_object"
      }
    }
  });

  if (!response.output_text) {
    throw new Error("No output_text returned from OpenAI");
  }

  let parsed;
  try {
    parsed = JSON.parse(response.output_text);
  } catch {
    throw new Error(
      `Model returned non-JSON. First 300 chars: ${response.output_text.slice(0, 300)}`
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
  const summaryShareDir = optEnv("SUMMARY_SHARE_DIR", "summary-share");
  const knowledgeDir = optEnv("KNOWLEDGE_DIR", "knowledge");

  const now = isoNow();
  const today = utcDateOnly();
  const client = new OpenAI({ apiKey });

  console.log(`Generating PTD Today intelligence for ${today}...`);

  const payload = await generateBrief(client, today, now);

  // 1. Preserve the current homepage-compatible briefing.
  writeJson(path.join(briefsDir, "daily-ai.json"), payload);

  // 1A. Generate a crawler-friendly, date-specific social-share page for
  //     Today's Intelligence Summary. This uses the same generated payload
  //     and does not trigger any additional OpenAI request.
  writeFile(
    path.join(summaryShareDir, `${today}.html`),
    renderSummaryShareHtml({ siteOrigin, payload })
  );

  // 2. Merge today's signals into the historical daily archive.
  const todayHistoryPath = path.join(historyDir, `${today}.json`);
  const existingTodayHistory = readJsonIfExists(todayHistoryPath, null);
  const mergedTodayHistory = mergeDailyHistory(
    existingTodayHistory,
    payload
  );
  writeJson(todayHistoryPath, mergedTodayHistory);

  // 3. Read historical data for map, trends, and outlooks.
  const historyPayloads = readHistoryPayloads(historyDir);
  const historicalItems = flattenHistoryItems(historyPayloads);

  // 4. Preserve and enrich the latest-50 map dataset.
  const mapSignalsPath = path.join(briefsDir, "map-signals.json");
  const existingMapSignals = readJsonIfExists(mapSignalsPath, null);
  const latestMapSignals = buildLatestMapSignals({
    existingPayload: existingMapSignals,
    currentItems: payload.items,
    historicalItems,
    generatedAt: now,
    maximumSignals: Number(optEnv("MAP_SIGNAL_LIMIT", "50"))
  });
  writeJson(mapSignalsPath, latestMapSignals);

  // 5. Produce backward-compatible trend and scenario-outlook files.
  const trends = buildTrends(historyPayloads, now);
  const outlook = buildOutlook(trends, now);
  writeJson(path.join(briefsDir, "trends.json"), trends);
  writeJson(path.join(briefsDir, "outlook.json"), outlook);

  // 6. Build the new permanent knowledge layer.
  const developmentsPath = path.join(knowledgeDir, "developments.json");
  const entitiesPath = path.join(knowledgeDir, "entities.json");
  const relationshipsPath = path.join(knowledgeDir, "relationships.json");

  const previousDevelopments = readJsonIfExists(developmentsPath, null);
  const previousEntities = readJsonIfExists(entitiesPath, null);
  const previousRelationships = readJsonIfExists(relationshipsPath, null);

  const developments = mergeDevelopments(
    previousDevelopments,
    payload.items,
    now
  );
  const entities = mergeEntities(previousEntities, payload.items, now);
  const relationships = mergeRelationships(
    previousRelationships,
    payload.items,
    now
  );
  const timelineEvents = buildTimelineEvents(payload.items, now);
  const knowledgeDiff = buildKnowledgeDiff(
    previousEntities,
    entities,
    previousRelationships,
    relationships,
    now
  );

  writeJson(developmentsPath, developments);
  writeJson(entitiesPath, entities);
  writeJson(relationshipsPath, relationships);
  writeJson(
    path.join(knowledgeDir, "timeline-events.json"),
    timelineEvents
  );
  writeJson(
    path.join(knowledgeDir, "knowledge-diff.json"),
    knowledgeDiff
  );

  // 7. Continue generating standalone article pages during migration.
  for (const item of payload.items) {
    const id = cleanString(item.development_id || item.id);
    if (!id) continue;

    const causalNarrative = findCausalNarrativeForItem(item, knowledgeDir);

    writeFile(
      path.join(articlesDir, `${id}.html`),
      renderArticleHtml({ siteOrigin, item, payload, causalNarrative })
    );
  }

  console.log("PTD Today generation complete.");
  console.log(`- ${path.join(briefsDir, "daily-ai.json")}`);
  console.log(`- ${path.join(summaryShareDir, `${today}.html`)}`);
  console.log(`- ${path.join(briefsDir, "map-signals.json")}`);
  console.log(`- ${path.join(briefsDir, "trends.json")}`);
  console.log(`- ${path.join(briefsDir, "outlook.json")}`);
  console.log(`- ${path.join(historyDir, `${today}.json`)}`);
  console.log(`- ${path.join(knowledgeDir, "developments.json")}`);
  console.log(`- ${path.join(knowledgeDir, "entities.json")}`);
  console.log(`- ${path.join(knowledgeDir, "relationships.json")}`);
  console.log(`- ${path.join(knowledgeDir, "timeline-events.json")}`);
  console.log(`- ${path.join(knowledgeDir, "knowledge-diff.json")}`);
  console.log(`- ${articlesDir}/*.html`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
