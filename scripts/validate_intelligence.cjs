#!/usr/bin/env node
/**
 * PTD Today / Cosmos — Intelligence Integrity Gate
 *
 * Purpose:
 *   Validate the current PTD Today intelligence outputs before they are treated
 *   as trusted historical memory by Cosmos.
 *
 * Rollout:
 *   - Default: report mode (never breaks the workflow)
 *   - Strict:  INTEGRITY_STRICT=true node scripts/validate_intelligence.js
 *
 * Output:
 *   knowledge/integrity-report.json
 *
 * No external npm packages required.
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const BRIEFS_DIR = process.env.BRIEFS_DIR || "briefs";
const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || "knowledge";
const STRICT = String(process.env.INTEGRITY_STRICT || "false").toLowerCase() === "true";

const PATHS = {
  daily: path.join(ROOT, BRIEFS_DIR, "daily-ai.json"),
  map: path.join(ROOT, BRIEFS_DIR, "map-signals.json"),
  developments: path.join(ROOT, KNOWLEDGE_DIR, "developments.json"),
  entities: path.join(ROOT, KNOWLEDGE_DIR, "entities.json"),
  relationships: path.join(ROOT, KNOWLEDGE_DIR, "relationships.json"),
  timeline: path.join(ROOT, KNOWLEDGE_DIR, "timeline-events.json"),
  lifecycle: path.join(ROOT, KNOWLEDGE_DIR, "entity-lifecycle.json"),
  report: path.join(ROOT, KNOWLEDGE_DIR, "integrity-report.json")
};

const VALID_REGIONS = new Set([
  "Global",
  "North America",
  "Latin America",
  "LATAM",
  "Europe",
  "Asia",
  "Middle East",
  "Africa",
  "Oceania"
]);

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const report = {
  schema_version: "1.1",
  checked_at: new Date().toISOString(),
  strict_mode: STRICT,
  status: "unknown",
  quality_score: 1,
  files: {},
  counts: {},
  errors: [],
  warnings: [],
  summary: {}
};

function addIssue(level, code, message, context = {}) {
  const item = { code, message, ...context };
  if (level === "error") report.errors.push(item);
  else report.warnings.push(item);
}

function readJson(label, filePath, required = true) {
  if (!fs.existsSync(filePath)) {
    if (required) {
      addIssue("error", "FILE_MISSING", `${label} is missing.`, {
        file: path.relative(ROOT, filePath)
      });
    } else {
      addIssue("warning", "FILE_MISSING_OPTIONAL", `${label} is missing.`, {
        file: path.relative(ROOT, filePath)
      });
    }
    report.files[label] = { exists: false };
    return null;
  }

  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    report.files[label] = {
      exists: true,
      valid_json: true,
      file: path.relative(ROOT, filePath)
    };
    return value;
  } catch (error) {
    addIssue("error", "INVALID_JSON", `${label} is not valid JSON.`, {
      file: path.relative(ROOT, filePath),
      detail: error.message
    });
    report.files[label] = {
      exists: true,
      valid_json: false,
      file: path.relative(ROOT, filePath)
    };
    return null;
  }
}

function arrayFrom(value, preferredKeys = []) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];

  for (const key of preferredKeys) {
    if (Array.isArray(value[key])) return value[key];
  }

  for (const candidate of Object.values(value)) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function isValidIsoDateTime(value) {
  if (typeof value !== "string" || !ISO_DATETIME.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function isValidDateOnly(value) {
  if (typeof value !== "string" || !ISO_DATE_ONLY.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function checkScore(value, min, max, field, context, level = "error") {
  if (value === null || value === undefined || value === "") return;

  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    addIssue(level, "SCORE_OUT_OF_RANGE",
      `${field} must be between ${min} and ${max}.`,
      { ...context, field, value }
    );
  }
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ");
}

function looksLikeTag(value) {
  const s = String(value || "").trim();
  if (!s) return false;

  return (
    /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(s) ||
    /^(ai|epc|oem|hvdc|bess)$/i.test(s) ||
    /^(markets?|procurement|storage|substations?|transmission|renewables?|resilience|hydro|wind|solar|manufacturing|maintenance|refining|processing|protection|transformers?|batteries|offshore|volatility)$/i.test(s)
  );
}

function collectCountryNames(...sources) {
  const names = new Set();

  const walk = (value) => {
    if (!value) return;

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    if (typeof value !== "object") return;

    if (
      String(value.type || "").toLowerCase() === "country" &&
      typeof value.name === "string" &&
      value.name.trim()
    ) {
      names.add(normalizeName(value.name));
      for (const alias of Array.isArray(value.aliases) ? value.aliases : []) {
        if (typeof alias === "string" && alias.trim()) {
          names.add(normalizeName(alias));
        }
      }
    }

    for (const child of Object.values(value)) walk(child);
  };

  sources.forEach(walk);

  // Conservative built-ins for common PTD Today geography.
  [
    "United States",
    "Canada",
    "Mexico",
    "Brazil",
    "Chile",
    "Argentina",
    "United Kingdom",
    "Ireland",
    "France",
    "Germany",
    "Netherlands",
    "Belgium",
    "Spain",
    "Portugal",
    "Italy",
    "Switzerland",
    "Austria",
    "Norway",
    "Sweden",
    "Finland",
    "Denmark",
    "Poland",
    "Czech Republic",
    "Romania",
    "Greece",
    "Turkey",
    "Türkiye",
    "Saudi Arabia",
    "United Arab Emirates",
    "Qatar",
    "Oman",
    "Israel",
    "Egypt",
    "South Africa",
    "Morocco",
    "Nigeria",
    "Kenya",
    "Democratic Republic of the Congo",
    "China",
    "Japan",
    "South Korea",
    "India",
    "Singapore",
    "Malaysia",
    "Indonesia",
    "Vietnam",
    "Thailand",
    "Philippines",
    "Australia",
    "New Zealand"
  ].forEach((name) => names.add(normalizeName(name)));

  return names;
}

function validateEvidence(evidence, context) {
  if (!evidence || typeof evidence !== "object") {
    addIssue("warning", "EVIDENCE_MISSING",
      "Development has no structured evidence object.", context);
    return;
  }

  const mode = String(evidence.mode || "").trim();
  const status = String(evidence.status || "").trim();
  const sourceIds = Array.isArray(evidence.source_ids) ? evidence.source_ids : [];
  const sourceCount = Number(evidence.source_count ?? sourceIds.length);

  if (!mode) {
    addIssue("warning", "EVIDENCE_MODE_MISSING",
      "Evidence mode is missing.", context);
  }

  if (mode === "ai_scenario" && status && status !== "unverified") {
    addIssue("warning", "AI_SCENARIO_STATUS",
      "ai_scenario evidence should normally remain explicitly unverified.",
      { ...context, status });
  }

  if (status === "verified" && sourceCount < 1) {
    addIssue("error", "VERIFIED_WITHOUT_SOURCE",
      "Evidence is marked verified but has no source.", context);
  }

  if (sourceCount !== sourceIds.length) {
    addIssue("warning", "SOURCE_COUNT_MISMATCH",
      "evidence.source_count does not match source_ids length.",
      { ...context, source_count: sourceCount, source_ids_length: sourceIds.length });
  }
}

function validate() {
  const daily = readJson("daily-ai", PATHS.daily);
  const map = readJson("map-signals", PATHS.map);
  const developmentsRaw = readJson("developments", PATHS.developments);
  const entitiesRaw = readJson("entities", PATHS.entities);
  const relationshipsRaw = readJson("relationships", PATHS.relationships);
  const timelineRaw = readJson("timeline-events", PATHS.timeline);
  const lifecycleRaw = readJson("entity-lifecycle", PATHS.lifecycle);

  const dailyItems = arrayFrom(daily?.items || [], ["items"]);
  const mapSignals = arrayFrom(map?.signals || [], ["signals"]);
  const developments = arrayFrom(developmentsRaw, ["developments", "items"]);
  const entities = arrayFrom(entitiesRaw, ["entities", "items"]);
  const relationships = arrayFrom(relationshipsRaw, ["relationships", "items"]);
  const timeline = arrayFrom(timelineRaw, ["events", "timeline_events", "items"]);
  const lifecycle = arrayFrom(lifecycleRaw, ["entities", "lifecycle", "items"]);

  // entity-lifecycle.json is an aggregate intelligence document rather than a
  // top-level entity array. Prefer totals.entity_count when available.
  const lifecycleEntityCount = Number(lifecycleRaw?.totals?.entity_count);
  const lifecycleRecordCount = Number.isFinite(lifecycleEntityCount)
    ? lifecycleEntityCount
    : lifecycle.length;

  report.counts = {
    daily_items: dailyItems.length,
    map_signals: mapSignals.length,
    developments: developments.length,
    entities: entities.length,
    relationships: relationships.length,
    timeline_events: timeline.length,
    lifecycle_records: lifecycleRecordCount
  };

  const entityIds = new Set(
    entities.map((e) => e?.entity_id).filter(Boolean)
  );

  // Include entities embedded in today's briefing, since generation may stage them there.
  for (const item of dailyItems) {
    for (const e of Array.isArray(item?.entities) ? item.entities : []) {
      if (e?.entity_id) entityIds.add(e.entity_id);
    }
  }

  const developmentIds = new Set(
    developments
      .map((d) => d?.development_id || d?.id)
      .filter(Boolean)
  );
  for (const item of dailyItems) {
    const id = item?.development_id || item?.id;
    if (id) developmentIds.add(id);
  }

  const knownCountries = collectCountryNames(entitiesRaw, daily);

  // ------------------------------------------------------------------
  // Daily briefing
  // ------------------------------------------------------------------
  if (daily) {
    if (!isValidIsoDateTime(daily.updated_at)) {
      addIssue("error", "BAD_DAILY_UPDATED_AT",
        "daily-ai.updated_at is not a valid UTC ISO timestamp.",
        { value: daily.updated_at });
    }

    if (!isValidDateOnly(daily.date_utc)) {
      addIssue("error", "BAD_DAILY_DATE",
        "daily-ai.date_utc is not YYYY-MM-DD.",
        { value: daily.date_utc });
    }

    dailyItems.forEach((item, index) => {
      const id = item?.development_id || item?.id || `index:${index}`;
      const context = { file: "briefs/daily-ai.json", item: id };

      if (!item?.id && !item?.development_id) {
        addIssue("error", "DEVELOPMENT_ID_MISSING",
          "Daily item has no id/development_id.", context);
      }

      if (!isValidIsoDateTime(item?.created_at)) {
        addIssue("error", "BAD_CREATED_AT",
          "Daily item created_at is not a valid UTC ISO timestamp.",
          { ...context, value: item?.created_at });
      }

      checkScore(item?.confidence_score, 0, 1, "confidence_score", context);
      checkScore(item?.importance_score, 0, 100, "importance_score", context);

      if (item?.region && !VALID_REGIONS.has(item.region)) {
        addIssue("warning", "UNKNOWN_REGION",
          "Daily item uses an unrecognized region.",
          { ...context, region: item.region });
      }

      for (const country of Array.isArray(item?.countries) ? item.countries : []) {
        if (!knownCountries.has(normalizeName(country))) {
          addIssue("warning", "UNKNOWN_COUNTRY",
            "Daily item contains a country not recognized by the entity registry/built-ins.",
            { ...context, country });
        }
      }

      validateEvidence(item?.evidence, context);

      for (const rel of Array.isArray(item?.relationships) ? item.relationships : []) {
        const relContext = {
          ...context,
          relationship_id: rel?.relationship_id || null
        };
        checkScore(rel?.confidence, 0, 1, "relationship.confidence", relContext);
        checkScore(rel?.strength, 0, 100, "relationship.strength", relContext);

        if (rel?.from_entity_id && !entityIds.has(rel.from_entity_id)) {
          addIssue("error", "ORPHAN_REL_FROM",
            "Relationship from_entity_id does not exist.",
            { ...relContext, entity_id: rel.from_entity_id });
        }

        if (rel?.to_entity_id && !entityIds.has(rel.to_entity_id)) {
          addIssue("error", "ORPHAN_REL_TO",
            "Relationship to_entity_id does not exist.",
            { ...relContext, entity_id: rel.to_entity_id });
        }
      }
    });
  }

  // ------------------------------------------------------------------
  // Rolling map signals — current known contamination is detected here.
  // ------------------------------------------------------------------
  if (map) {
    if (!isValidIsoDateTime(map.generated_at)) {
      addIssue("error", "BAD_MAP_GENERATED_AT",
        "map-signals.generated_at is not a valid UTC ISO timestamp.",
        { value: map.generated_at });
    }

    if (map.oldest_signal_at && !isValidIsoDateTime(map.oldest_signal_at)) {
      addIssue("error", "BAD_OLDEST_SIGNAL_AT",
        "map-signals.oldest_signal_at is not a valid UTC ISO timestamp.",
        { value: map.oldest_signal_at });
    }

    if (map.newest_signal_at && !isValidIsoDateTime(map.newest_signal_at)) {
      addIssue("error", "BAD_NEWEST_SIGNAL_AT",
        "map-signals.newest_signal_at is not a valid UTC ISO timestamp.",
        { value: map.newest_signal_at });
    }

    if (
      Number.isFinite(Number(map.signal_count)) &&
      Number(map.signal_count) !== mapSignals.length
    ) {
      addIssue("warning", "MAP_SIGNAL_COUNT_MISMATCH",
        "map-signals.signal_count does not match signals.length.",
        { declared: map.signal_count, actual: mapSignals.length });
    }

    mapSignals.forEach((signal, index) => {
      const id = signal?.signal_id || `index:${index}`;
      const context = { file: "briefs/map-signals.json", signal: id };

      if (!isValidIsoDateTime(signal?.created_at)) {
        addIssue("error", "BAD_SIGNAL_CREATED_AT",
          "Map signal created_at is not a valid UTC ISO timestamp.",
          { ...context, value: signal?.created_at });
      }

      checkScore(signal?.confidence_score, 0, 1, "confidence_score", context);
      checkScore(signal?.importance_score, 0, 100, "importance_score", context);

      if (signal?.region && !VALID_REGIONS.has(signal.region)) {
        addIssue("warning", "UNKNOWN_REGION",
          "Map signal uses an unrecognized region.",
          { ...context, region: signal.region });
      }

      const countries = Array.isArray(signal?.countries) ? signal.countries : [];
      const tags = new Set(
        (Array.isArray(signal?.tags) ? signal.tags : []).map(normalizeName)
      );

      for (const country of countries) {
        const normalized = normalizeName(country);

        if (!knownCountries.has(normalized)) {
          const likelyTag = looksLikeTag(country) || tags.has(normalized);
          addIssue(
            likelyTag ? "error" : "warning",
            likelyTag ? "TAG_LEAKED_INTO_COUNTRIES" : "UNKNOWN_COUNTRY",
            likelyTag
              ? "A topic/tag appears to have leaked into signal.countries."
              : "Map signal contains an unrecognized country.",
            { ...context, country }
          );
        }
      }

      const devId = signal?.development_id;
      if (devId && developmentIds.size && !developmentIds.has(devId)) {
        addIssue("warning", "UNKNOWN_DEVELOPMENT_REFERENCE",
          "Map signal references a development ID not found in current knowledge/daily data.",
          { ...context, development_id: devId });
      }

      for (const entityId of Array.isArray(signal?.entity_ids) ? signal.entity_ids : []) {
        if (entityIds.size && !entityIds.has(entityId)) {
          addIssue("error", "UNKNOWN_ENTITY_REFERENCE",
            "Map signal references an entity ID that does not exist.",
            { ...context, entity_id: entityId });
        }
      }
    });

    const coverageCountries = arrayFrom(map?.coverage?.countries || [], ["countries"]);
    for (const entry of coverageCountries) {
      const country = typeof entry === "string" ? entry : entry?.name;
      if (!country) continue;

      if (!knownCountries.has(normalizeName(country))) {
        const likelyTag = looksLikeTag(country);
        addIssue(
          likelyTag ? "error" : "warning",
          likelyTag ? "INVALID_COUNTRY_COVERAGE" : "UNKNOWN_COUNTRY_COVERAGE",
          likelyTag
            ? "coverage.countries contains a topic/tag instead of a country."
            : "coverage.countries contains an unrecognized country.",
          { file: "briefs/map-signals.json", country }
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // Entity registry
  // ------------------------------------------------------------------
  const canonicalNames = new Map();

  entities.forEach((entity, index) => {
    const id = entity?.entity_id || `index:${index}`;
    const context = { file: "knowledge/entities.json", entity: id };

    if (!entity?.entity_id) {
      addIssue("error", "ENTITY_ID_MISSING",
        "Entity has no entity_id.", context);
    }

    checkScore(entity?.confidence, 0, 1, "entity.confidence", context);

    const name = normalizeName(entity?.name);
    const type = normalizeName(entity?.type);

    if (name) {
      const key = `${type}::${name}`;
      if (canonicalNames.has(key) && canonicalNames.get(key) !== entity?.entity_id) {
        addIssue("warning", "DUPLICATE_CANONICAL_ENTITY",
          "Two entity IDs share the same normalized type/name.",
          {
            ...context,
            duplicate_of: canonicalNames.get(key),
            normalized_key: key
          }
        );
      } else {
        canonicalNames.set(key, entity?.entity_id);
      }
    }

    if (entity?.first_seen_at && !isValidIsoDateTime(entity.first_seen_at)) {
      addIssue("warning", "BAD_ENTITY_FIRST_SEEN",
        "Entity first_seen_at is invalid.", { ...context, value: entity.first_seen_at });
    }

    if (entity?.last_seen_at && !isValidIsoDateTime(entity.last_seen_at)) {
      addIssue("warning", "BAD_ENTITY_LAST_SEEN",
        "Entity last_seen_at is invalid.", { ...context, value: entity.last_seen_at });
    }
  });

  // ------------------------------------------------------------------
  // Relationship registry
  // ------------------------------------------------------------------
  relationships.forEach((rel, index) => {
    const id = rel?.relationship_id || `index:${index}`;
    const context = { file: "knowledge/relationships.json", relationship: id };

    const from = rel?.from_entity_id || rel?.source_entity_id || rel?.subject_id;
    const to = rel?.to_entity_id || rel?.target_entity_id || rel?.object_id;

    if (!from || !to) {
      addIssue("error", "REL_ENDPOINT_MISSING",
        "Relationship is missing one or both entity endpoints.", context);
    } else {
      if (entityIds.size && !entityIds.has(from)) {
        addIssue("error", "ORPHAN_REL_FROM",
          "Relationship source entity does not exist.",
          { ...context, entity_id: from });
      }
      if (entityIds.size && !entityIds.has(to)) {
        addIssue("error", "ORPHAN_REL_TO",
          "Relationship target entity does not exist.",
          { ...context, entity_id: to });
      }
    }

    checkScore(rel?.confidence, 0, 1, "relationship.confidence", context);
    checkScore(rel?.strength, 0, 100, "relationship.strength", context);

    for (const devId of Array.isArray(rel?.evidence_development_ids)
      ? rel.evidence_development_ids
      : []) {
      if (developmentIds.size && !developmentIds.has(devId)) {
        addIssue("warning", "UNKNOWN_EVIDENCE_DEVELOPMENT",
          "Relationship evidence references an unknown development.",
          { ...context, development_id: devId });
      }
    }
  });

  // ------------------------------------------------------------------
  // Timeline / lifecycle temporal sanity
  // ------------------------------------------------------------------
  timeline.forEach((event, index) => {
    const id = event?.event_id || event?.timeline_event_id || `index:${index}`;
    const context = { file: "knowledge/timeline-events.json", event: id };

    const ts =
      event?.created_at ||
      event?.event_time ||
      event?.event_at ||
      event?.timestamp;

    if (ts && !isValidIsoDateTime(ts) && !isValidDateOnly(ts)) {
      addIssue("warning", "BAD_TIMELINE_DATE",
        "Timeline event has an invalid date/timestamp.",
        { ...context, value: ts });
    }

    const entityId = event?.entity_id || event?.primary_entity_id;
    if (entityId && entityIds.size && !entityIds.has(entityId)) {
      addIssue("warning", "TIMELINE_UNKNOWN_ENTITY",
        "Timeline event references an unknown entity.",
        { ...context, entity_id: entityId });
    }
  });

  lifecycle.forEach((entry, index) => {
    const id = entry?.entity_id || `index:${index}`;
    const context = { file: "knowledge/entity-lifecycle.json", entity: id };

    const first = entry?.first_seen_at || entry?.first_seen;
    const last = entry?.last_seen_at || entry?.last_seen;

    if (first && !isValidIsoDateTime(first) && !isValidDateOnly(first)) {
      addIssue("warning", "BAD_LIFECYCLE_FIRST_SEEN",
        "Lifecycle first_seen is invalid.", { ...context, value: first });
    }

    if (last && !isValidIsoDateTime(last) && !isValidDateOnly(last)) {
      addIssue("warning", "BAD_LIFECYCLE_LAST_SEEN",
        "Lifecycle last_seen is invalid.", { ...context, value: last });
    }

    if (first && last) {
      const a = Date.parse(first.length === 10 ? `${first}T00:00:00Z` : first);
      const b = Date.parse(last.length === 10 ? `${last}T00:00:00Z` : last);

      if (Number.isFinite(a) && Number.isFinite(b) && a > b) {
        addIssue("error", "IMPOSSIBLE_LIFECYCLE_ORDER",
          "Lifecycle first_seen occurs after last_seen.",
          { ...context, first_seen: first, last_seen: last });
      }
    }
  });

  // ------------------------------------------------------------------
  // Final score/status
  // ------------------------------------------------------------------
  const errorPenalty = report.errors.length * 0.025;
  const warningPenalty = report.warnings.length * 0.005;
  report.quality_score = Math.max(
    0,
    Math.min(1, Number((1 - errorPenalty - warningPenalty).toFixed(3)))
  );

  report.status =
    report.errors.length === 0
      ? (report.warnings.length ? "passed_with_warnings" : "passed")
      : "failed";

  report.summary = {
    errors: report.errors.length,
    warnings: report.warnings.length,
    quality_score: report.quality_score,
    action:
      report.errors.length === 0
        ? "Intelligence outputs passed structural integrity checks."
        : STRICT
          ? "Strict mode is enabled; workflow should stop before historical ingestion."
          : "Report mode: corruption detected, but workflow is not blocked yet."
  };

  fs.mkdirSync(path.dirname(PATHS.report), { recursive: true });
  fs.writeFileSync(PATHS.report, JSON.stringify(report, null, 2) + "\n");

  console.log("\n=== PTD Today / Cosmos Intelligence Integrity ===");
  console.log(`Status:   ${report.status}`);
  console.log(`Errors:   ${report.errors.length}`);
  console.log(`Warnings: ${report.warnings.length}`);
  console.log(`Quality:  ${(report.quality_score * 100).toFixed(1)}%`);
  console.log(`Report:   ${path.relative(ROOT, PATHS.report)}`);

  if (report.errors.length) {
    console.log("\nTop errors:");
    report.errors.slice(0, 20).forEach((issue, i) => {
      console.log(`${i + 1}. [${issue.code}] ${issue.message}`);
    });
  }

  if (report.warnings.length) {
    console.log("\nTop warnings:");
    report.warnings.slice(0, 20).forEach((issue, i) => {
      console.log(`${i + 1}. [${issue.code}] ${issue.message}`);
    });
  }

  if (STRICT && report.errors.length) {
    process.exitCode = 1;
  }
}

validate();

