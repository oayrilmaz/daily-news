// scripts/update_entity_lifecycle.js
// PTD Today — Entity Lifecycle Engine
//
// PURPOSE
// -------
// Gives PTDToday's knowledge graph temporal behavior.
//
// The script reads:
//   - knowledge/entities.json
//   - knowledge/developments.json
//   - knowledge/relationships.json
//
// It writes:
//   - knowledge/entities.json                 (enriched in place)
//   - knowledge/entity-lifecycle.json         (summary and ranked states)
//   - knowledge/snapshots/YYYY-MM-DD.json     (daily Time Machine snapshot)
//
// IMPORTANT
// ---------
// - Nothing is deleted.
// - Dormant, historical, merged, and deprecated entities remain available.
// - Statuses are calculated from evidence already stored in PTDToday.
// - The scoring rules are deterministic and transparent.
// - Entity-type-specific decay prevents countries, standards, and mature
//   technologies from disappearing simply because they were quiet recently.

import fs from "fs";
import path from "path";

const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || "knowledge";
const ENTITIES_PATH = path.join(KNOWLEDGE_DIR, "entities.json");
const DEVELOPMENTS_PATH = path.join(KNOWLEDGE_DIR, "developments.json");
const RELATIONSHIPS_PATH = path.join(KNOWLEDGE_DIR, "relationships.json");
const LIFECYCLE_PATH = path.join(KNOWLEDGE_DIR, "entity-lifecycle.json");
const SNAPSHOTS_DIR = path.join(KNOWLEDGE_DIR, "snapshots");

const NOW = new Date();
const NOW_ISO = NOW.toISOString();
const TODAY = NOW_ISO.slice(0, 10);

const HALF_LIFE_DAYS = {
  Country: Number.POSITIVE_INFINITY,
  Standard: 1460,
  Technology: 730,
  Material: 730,
  Company: 365,
  Organization: 365,
  Utility: 365,
  "ISO/RTO": 365,
  Market: 270,
  Policy: 240,
  Infrastructure: 240,
  Equipment: 240,
  Facility: 180,
  Project: 120,
  Concept: 180,
  Event: 45
};

const DEFAULT_HALF_LIFE_DAYS = 240;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(older, newer = NOW) {
  const oldDate = toDate(older);
  const newDate = toDate(newer);
  if (!oldDate || !newDate) return Number.POSITIVE_INFINITY;
  return Math.max(0, (newDate.getTime() - oldDate.getTime()) / 86_400_000);
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function round(value, digits = 1) {
  const multiplier = 10 ** digits;
  return Math.round(Number(value) * multiplier) / multiplier;
}

function buildIndexes(developmentsPayload, relationshipsPayload) {
  const developments = Array.isArray(developmentsPayload?.developments)
    ? developmentsPayload.developments
    : [];
  const relationships = Array.isArray(relationshipsPayload?.relationships)
    ? relationshipsPayload.relationships
    : [];

  const developmentsByEntity = new Map();
  const relationshipsByEntity = new Map();

  for (const development of developments) {
    for (const entity of development.entities || []) {
      if (!entity?.entity_id) continue;
      const list = developmentsByEntity.get(entity.entity_id) || [];
      list.push(development);
      developmentsByEntity.set(entity.entity_id, list);
    }
  }

  for (const relationship of relationships) {
    for (const entityId of [relationship?.from_entity_id, relationship?.to_entity_id]) {
      if (!entityId) continue;
      const list = relationshipsByEntity.get(entityId) || [];
      list.push(relationship);
      relationshipsByEntity.set(entityId, list);
    }
  }

  return { developmentsByEntity, relationshipsByEntity };
}

function recencyScore(entity) {
  if (entity.type === "Country") return 100;

  const daysSinceLastSeen = daysBetween(entity.last_seen_at);
  const halfLife = HALF_LIFE_DAYS[entity.type] ?? DEFAULT_HALF_LIFE_DAYS;

  if (!Number.isFinite(daysSinceLastSeen)) return 0;
  if (!Number.isFinite(halfLife)) return 100;

  return clamp(
    100 * Math.pow(0.5, daysSinceLastSeen / halfLife),
    0,
    100
  );
}

function developmentActivity(entityId, indexes) {
  const developments = indexes.developmentsByEntity.get(entityId) || [];

  let last30 = 0;
  let previous30 = 0;
  let last90 = 0;
  let totalImportance = 0;
  const countries = new Set();
  const categories = new Set();

  for (const development of developments) {
    const age = daysBetween(development.created_at);
    if (age <= 30) last30 += 1;
    else if (age <= 60) previous30 += 1;
    if (age <= 90) last90 += 1;

    totalImportance += Number(development.importance_score || 0);

    for (const country of development.countries || []) countries.add(country);
    if (development.category) categories.add(development.category);
  }

  const averageImportance = developments.length
    ? totalImportance / developments.length
    : 0;

  const velocity = previous30 > 0
    ? last30 / previous30
    : last30 > 0
      ? 2
      : 0;

  return {
    development_count: developments.length,
    developments_last_30_days: last30,
    developments_previous_30_days: previous30,
    developments_last_90_days: last90,
    velocity: round(velocity, 2),
    average_importance: round(averageImportance, 1),
    country_count: countries.size,
    category_count: categories.size,
    countries: [...countries].sort(),
    categories: [...categories].sort()
  };
}

function relationshipActivity(entityId, indexes) {
  const relationships = indexes.relationshipsByEntity.get(entityId) || [];
  const activeRelationships = relationships.filter(
    (relationship) => !["merged", "deprecated", "inactive"].includes(
      String(relationship.status || "active").toLowerCase()
    )
  );

  const connectedEntityIds = new Set();
  let totalStrength = 0;
  let totalConfidence = 0;

  for (const relationship of activeRelationships) {
    connectedEntityIds.add(relationship.from_entity_id);
    connectedEntityIds.add(relationship.to_entity_id);
    totalStrength += Number(relationship.strength || 0);
    totalConfidence += Number(relationship.confidence || 0);
  }

  connectedEntityIds.delete(entityId);

  return {
    relationship_count: relationships.length,
    active_relationship_count: activeRelationships.length,
    connected_entity_count: connectedEntityIds.size,
    average_strength: activeRelationships.length
      ? round(totalStrength / activeRelationships.length, 1)
      : 0,
    average_confidence: activeRelationships.length
      ? round(totalConfidence / activeRelationships.length, 2)
      : 0
  };
}

function calculateScores(entity, indexes) {
  const activity = developmentActivity(entity.entity_id, indexes);
  const relationship = relationshipActivity(entity.entity_id, indexes);
  const recency = recencyScore(entity);

  const activityScore = clamp(
    activity.developments_last_30_days * 18 +
      activity.developments_last_90_days * 5 +
      Math.log2(activity.development_count + 1) * 10,
    0,
    100
  );

  const relationshipScore = clamp(
    relationship.active_relationship_count * 7 +
      relationship.connected_entity_count * 5 +
      relationship.average_strength * 0.25,
    0,
    100
  );

  const geographicScore = clamp(
    activity.country_count * 18 + activity.category_count * 8,
    0,
    100
  );

  const importanceScore = clamp(activity.average_importance, 0, 100);

  const overall = round(
    recency * 0.30 +
      activityScore * 0.25 +
      relationshipScore * 0.20 +
      geographicScore * 0.10 +
      importanceScore * 0.15,
    1
  );

  const momentum = round(clamp((activity.velocity - 1) * 50, -100, 100), 1);

  return {
    overall,
    recency: round(recency, 1),
    activity: round(activityScore, 1),
    relationships: round(relationshipScore, 1),
    geography: round(geographicScore, 1),
    importance: round(importanceScore, 1),
    momentum,
    metrics: { ...activity, ...relationship }
  };
}

function calculateLifecycleStatus(entity, scores) {
  const existingStatus = String(entity.status || "").toLowerCase();
  if (existingStatus === "merged") return "merged";
  if (existingStatus === "deprecated") return "deprecated";
  if (entity.type === "Country") return "active";

  const ageDays = daysBetween(entity.first_seen_at);
  const inactiveDays = daysBetween(entity.last_seen_at);
  const velocity = scores.metrics.velocity;
  const recent = scores.metrics.developments_last_30_days;

  if (inactiveDays > 730) return "historical";

  if (ageDays <= 45 && recent <= 3 && scores.overall < 70) {
    return "emerging";
  }

  if (recent >= 2 && velocity >= 1.5 && scores.overall >= 55) {
    return "accelerating";
  }

  if (scores.momentum <= -35 && inactiveDays > 30) return "cooling";
  if (scores.overall >= 58) return "active";
  if (scores.overall >= 42) return "stable";
  if (scores.overall >= 25) return "cooling";
  return "dormant";
}

function lifecycleReason(status, scores, entity) {
  const recent = scores.metrics.developments_last_30_days;
  const inactiveDays = Math.round(daysBetween(entity.last_seen_at));

  switch (status) {
    case "emerging":
      return "Recently discovered and still building evidence and relationships.";
    case "accelerating":
      return `Recent activity is expanding, with ${recent} development(s) in the last 30 days.`;
    case "active":
      return "Maintains strong current relevance across developments and relationships.";
    case "stable":
      return "Remains relevant, but recent activity is broadly steady.";
    case "cooling":
      return "Recent activity or momentum has weakened relative to its earlier state.";
    case "dormant":
      return `Currently has limited recent activity; last meaningful signal was approximately ${inactiveDays} day(s) ago.`;
    case "historical":
      return "Retained for historical and Time Machine exploration.";
    case "merged":
      return "The entity has been merged into or succeeded by another entity.";
    case "deprecated":
      return "The entity record is preserved but should no longer be used for new relationships.";
    default:
      return "Lifecycle status calculated from current PTDToday evidence.";
  }
}

function enrichEntity(entity, indexes) {
  const scores = calculateScores(entity, indexes);
  const lifecycleStatus = calculateLifecycleStatus(entity, scores);
  const priorLifecycle = entity.lifecycle || {};
  const statusChanged = priorLifecycle.status !== lifecycleStatus;

  return {
    ...entity,
    lifecycle: {
      status: lifecycleStatus,
      reason: lifecycleReason(lifecycleStatus, scores, entity),
      calculated_at: NOW_ISO,
      status_changed_at: statusChanged
        ? NOW_ISO
        : priorLifecycle.status_changed_at || NOW_ISO,
      previous_status: statusChanged
        ? priorLifecycle.status || null
        : priorLifecycle.previous_status || null,
      active_view: !["dormant", "historical", "merged", "deprecated"].includes(
        lifecycleStatus
      ),
      successor_entity_id: entity.successor_entity_id || null
    },
    scores: {
      importance: scores.overall,
      momentum: scores.momentum,
      recency: scores.recency,
      activity: scores.activity,
      relationship_density: scores.relationships,
      geographic_reach: scores.geography,
      linked_development_importance: scores.importance
    },
    metrics: scores.metrics,
    updated_at: NOW_ISO
  };
}

function buildLifecycleSummary(entities) {
  const byStatus = {};
  const byType = {};

  for (const entity of entities) {
    const status = entity.lifecycle?.status || "unknown";
    const type = entity.type || "Unknown";
    byStatus[status] = (byStatus[status] || 0) + 1;
    byType[type] = (byType[type] || 0) + 1;
  }

  const rank = (filter, sorter) =>
    entities
      .filter(filter)
      .sort(sorter)
      .slice(0, 50)
      .map((entity) => ({
        entity_id: entity.entity_id,
        slug: entity.slug,
        name: entity.name,
        type: entity.type,
        lifecycle_status: entity.lifecycle?.status,
        importance_score: entity.scores?.importance,
        momentum_score: entity.scores?.momentum,
        last_seen_at: entity.last_seen_at
      }));

  return {
    schema_version: "1.0",
    generated_at: NOW_ISO,
    date_utc: TODAY,
    methodology: {
      summary:
        "Entity lifecycle status is calculated from recency, development activity, relationship density, geographic reach, linked-development importance, and entity-type-specific time decay.",
      statuses: [
        "emerging",
        "accelerating",
        "active",
        "stable",
        "cooling",
        "dormant",
        "historical",
        "merged",
        "deprecated"
      ],
      preservation:
        "No entity is deleted. Dormant, historical, merged, and deprecated entities remain available through the Time Machine."
    },
    totals: {
      entity_count: entities.length,
      active_view_count: entities.filter((entity) => entity.lifecycle?.active_view).length,
      hidden_from_active_view_count: entities.filter((entity) => !entity.lifecycle?.active_view).length
    },
    by_status: byStatus,
    by_type: byType,
    rankings: {
      most_important: rank(
        () => true,
        (a, b) => Number(b.scores?.importance || 0) - Number(a.scores?.importance || 0)
      ),
      fastest_accelerating: rank(
        (entity) => Number(entity.scores?.momentum || 0) > 0,
        (a, b) => Number(b.scores?.momentum || 0) - Number(a.scores?.momentum || 0)
      ),
      cooling: rank(
        (entity) => entity.lifecycle?.status === "cooling",
        (a, b) => Number(a.scores?.momentum || 0) - Number(b.scores?.momentum || 0)
      ),
      dormant: rank(
        (entity) => ["dormant", "historical"].includes(entity.lifecycle?.status),
        (a, b) => String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || ""))
      )
    }
  };
}

function buildSnapshot(entities, lifecycleSummary) {
  return {
    schema_version: "1.0",
    snapshot_date_utc: TODAY,
    generated_at: NOW_ISO,
    entity_count: entities.length,
    lifecycle_totals: lifecycleSummary.by_status,
    entities: entities.map((entity) => ({
      entity_id: entity.entity_id,
      slug: entity.slug,
      name: entity.name,
      type: entity.type,
      lifecycle_status: entity.lifecycle?.status,
      active_view: entity.lifecycle?.active_view,
      importance_score: entity.scores?.importance,
      momentum_score: entity.scores?.momentum,
      relationship_count: entity.metrics?.relationship_count || 0,
      development_count: entity.metrics?.development_count || 0,
      country_count: entity.metrics?.country_count || 0,
      first_seen_at: entity.first_seen_at,
      last_seen_at: entity.last_seen_at,
      successor_entity_id: entity.lifecycle?.successor_entity_id || null
    }))
  };
}

function main() {
  console.log("Updating PTD Today entity lifecycle...");

  const entitiesPayload = readJson(ENTITIES_PATH);
  const developmentsPayload = readJson(DEVELOPMENTS_PATH);
  const relationshipsPayload = readJson(RELATIONSHIPS_PATH);

  const entities = Array.isArray(entitiesPayload?.entities)
    ? entitiesPayload.entities
    : [];

  const indexes = buildIndexes(developmentsPayload, relationshipsPayload);

  const enrichedEntities = entities
    .map((entity) => enrichEntity(entity, indexes))
    .sort((a, b) =>
      Number(b.scores?.importance || 0) - Number(a.scores?.importance || 0)
    );

  const lifecycleSummary = buildLifecycleSummary(enrichedEntities);
  const snapshot = buildSnapshot(enrichedEntities, lifecycleSummary);

  writeJson(ENTITIES_PATH, {
    ...entitiesPayload,
    schema_version: "1.1-lifecycle",
    generated_at: NOW_ISO,
    entity_count: enrichedEntities.length,
    entities: enrichedEntities
  });

  writeJson(LIFECYCLE_PATH, lifecycleSummary);
  writeJson(path.join(SNAPSHOTS_DIR, `${TODAY}.json`), snapshot);

  console.log("Entity lifecycle update complete.");
  console.log(`- ${ENTITIES_PATH}`);
  console.log(`- ${LIFECYCLE_PATH}`);
  console.log(`- ${path.join(SNAPSHOTS_DIR, `${TODAY}.json`)}`);
  console.log(
    `- Active view: ${lifecycleSummary.totals.active_view_count}/${lifecycleSummary.totals.entity_count}`
  );
}

try {
  main();
} catch (error) {
  console.error("Entity lifecycle update failed:");
  console.error(error);
  process.exit(1);
}
