#!/usr/bin/env node
/**
 * PTD Today / Cosmos — State + Delta Engine v0.1
 *
 * Builds a deterministic daily world-state snapshot from the current knowledge
 * graph, then compares it with the previously committed Cosmos state.
 *
 * Outputs:
 *   knowledge/cosmos/state-current.json
 *   knowledge/cosmos/delta-current.json
 *   knowledge/cosmos/state-history/YYYY-MM-DD.json
 *   knowledge/cosmos/delta-history/YYYY-MM-DD.json
 *
 * First run is a cold start: it establishes the baseline and emits zero deltas.
 * No external npm packages required.
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || "knowledge";
const COSMOS_DIR = path.join(ROOT, KNOWLEDGE_DIR, "cosmos");
const STATE_HISTORY_DIR = path.join(COSMOS_DIR, "state-history");
const DELTA_HISTORY_DIR = path.join(COSMOS_DIR, "delta-history");

const FILES = {
  entities: path.join(ROOT, KNOWLEDGE_DIR, "entities.json"),
  relationships: path.join(ROOT, KNOWLEDGE_DIR, "relationships.json"),
  developments: path.join(ROOT, KNOWLEDGE_DIR, "developments.json"),
  lifecycle: path.join(ROOT, KNOWLEDGE_DIR, "entity-lifecycle.json"),
  currentState: path.join(COSMOS_DIR, "state-current.json"),
  currentDelta: path.join(COSMOS_DIR, "delta-current.json")
};

function readJson(file, required = true) {
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`Missing required file: ${path.relative(ROOT, file)}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function arrayFrom(value, preferredKeys = []) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of preferredKeys) {
    if (Array.isArray(value[key])) return value[key];
  }
  for (const v of Object.values(value)) {
    if (Array.isArray(v)) return v;
  }
  return [];
}

function normalizeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function entityId(entity) {
  return entity?.entity_id || entity?.id || null;
}

function relationshipEndpoints(rel) {
  return {
    from: rel?.from_entity_id || rel?.source_entity_id || rel?.subject_id || null,
    to: rel?.to_entity_id || rel?.target_entity_id || rel?.object_id || null
  };
}

function developmentId(dev) {
  return dev?.development_id || dev?.id || null;
}

function lifecycleLookup(lifecycle) {
  const lookup = new Map();
  const rankings = lifecycle?.rankings;
  if (!rankings || typeof rankings !== "object") return lookup;

  for (const list of Object.values(rankings)) {
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      if (!row?.entity_id) continue;
      const existing = lookup.get(row.entity_id) || {};
      lookup.set(row.entity_id, {
        ...existing,
        lifecycle_status: row.lifecycle_status ?? existing.lifecycle_status ?? null,
        importance_score: normalizeNumber(row.importance_score, existing.importance_score ?? null),
        momentum_score: normalizeNumber(row.momentum_score, existing.momentum_score ?? null),
        momentum_status: row.momentum_status ?? existing.momentum_status ?? null,
        last_seen_at: row.last_seen_at ?? existing.last_seen_at ?? null
      });
    }
  }
  return lookup;
}

function buildState() {
  const entitiesRaw = readJson(FILES.entities);
  const relationshipsRaw = readJson(FILES.relationships);
  const developmentsRaw = readJson(FILES.developments);
  const lifecycle = readJson(FILES.lifecycle);

  const entities = arrayFrom(entitiesRaw, ["entities", "items"]);
  const relationships = arrayFrom(relationshipsRaw, ["relationships", "items"]);
  const developments = arrayFrom(developmentsRaw, ["developments", "items"]);
  const life = lifecycleLookup(lifecycle);

  const degree = new Map();
  for (const rel of relationships) {
    const { from, to } = relationshipEndpoints(rel);
    if (from) degree.set(from, (degree.get(from) || 0) + 1);
    if (to) degree.set(to, (degree.get(to) || 0) + 1);
  }

  const devLinks = new Map();
  for (const dev of developments) {
    const ids = new Set();
    for (const e of Array.isArray(dev?.entities) ? dev.entities : []) {
      const id = e?.entity_id || e?.id;
      if (id) ids.add(id);
    }
    for (const id of Array.isArray(dev?.entity_ids) ? dev.entity_ids : []) {
      if (id) ids.add(id);
    }
    for (const id of ids) devLinks.set(id, (devLinks.get(id) || 0) + 1);
  }

  const stateEntities = {};
  for (const e of entities) {
    const id = entityId(e);
    if (!id) continue;
    const l = life.get(id) || {};
    stateEntities[id] = {
      entity_id: id,
      name: e?.name ?? e?.canonical_name ?? null,
      slug: e?.slug ?? null,
      type: e?.type ?? e?.entity_type ?? null,
      lifecycle_status: e?.lifecycle_status ?? l.lifecycle_status ?? null,
      importance_score: normalizeNumber(e?.importance_score, l.importance_score ?? null),
      momentum_score: normalizeNumber(e?.momentum_score, l.momentum_score ?? null),
      momentum_status: e?.momentum_status ?? l.momentum_status ?? null,
      first_seen_at: e?.first_seen_at ?? e?.first_seen ?? null,
      last_seen_at: e?.last_seen_at ?? e?.last_seen ?? l.last_seen_at ?? null,
      relationship_degree: degree.get(id) || 0,
      linked_development_count: devLinks.get(id) || 0
    };
  }

  return {
    schema_version: "0.1",
    generated_at: new Date().toISOString(),
    date_utc: new Date().toISOString().slice(0, 10),
    source: "PTD Today knowledge graph",
    totals: {
      entities: Object.keys(stateEntities).length,
      relationships: relationships.length,
      developments: developments.length,
      lifecycle_history_coverage_days: normalizeNumber(lifecycle?.methodology?.history_coverage_days, 0),
      lifecycle_measured_momentum_count: normalizeNumber(lifecycle?.totals?.measured_momentum_count, 0),
      lifecycle_insufficient_history_count: normalizeNumber(lifecycle?.totals?.insufficient_history_count, 0)
    },
    lifecycle_by_status: lifecycle?.by_status || {},
    entities: stateEntities
  };
}

function changedFields(before, after) {
  const fields = [
    "name", "type", "lifecycle_status", "importance_score", "momentum_score",
    "momentum_status", "last_seen_at", "relationship_degree", "linked_development_count"
  ];
  const changes = {};
  for (const field of fields) {
    const a = before?.[field] ?? null;
    const b = after?.[field] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[field] = { from: a, to: b };
  }
  return changes;
}

function buildDelta(previous, current) {
  const coldStart = !previous || !previous.entities;
  const delta = {
    schema_version: "0.1",
    generated_at: new Date().toISOString(),
    date_utc: current.date_utc,
    previous_state_generated_at: previous?.generated_at || null,
    current_state_generated_at: current.generated_at,
    cold_start: coldStart,
    summary: {
      added_entities: 0,
      removed_entities: 0,
      changed_entities: 0,
      unchanged_entities: 0,
      lifecycle_transitions: 0,
      relationship_degree_changes: 0,
      linked_development_count_changes: 0
    },
    graph_delta: {
      entities: coldStart ? 0 : current.totals.entities - (previous?.totals?.entities || 0),
      relationships: coldStart ? 0 : current.totals.relationships - (previous?.totals?.relationships || 0),
      developments: coldStart ? 0 : current.totals.developments - (previous?.totals?.developments || 0)
    },
    added_entities: [],
    removed_entities: [],
    changed_entities: []
  };

  if (coldStart) {
    delta.summary.unchanged_entities = current.totals.entities;
    return delta;
  }

  const prev = previous.entities || {};
  const curr = current.entities || {};

  for (const [id, entity] of Object.entries(curr)) {
    if (!prev[id]) {
      delta.added_entities.push(entity);
      continue;
    }
    const changes = changedFields(prev[id], entity);
    if (Object.keys(changes).length) {
      delta.changed_entities.push({
        entity_id: id,
        name: entity.name,
        type: entity.type,
        changes
      });
    } else {
      delta.summary.unchanged_entities += 1;
    }
  }

  for (const [id, entity] of Object.entries(prev)) {
    if (!curr[id]) delta.removed_entities.push(entity);
  }

  delta.summary.added_entities = delta.added_entities.length;
  delta.summary.removed_entities = delta.removed_entities.length;
  delta.summary.changed_entities = delta.changed_entities.length;

  for (const row of delta.changed_entities) {
    if (row.changes.lifecycle_status) delta.summary.lifecycle_transitions += 1;
    if (row.changes.relationship_degree) delta.summary.relationship_degree_changes += 1;
    if (row.changes.linked_development_count) delta.summary.linked_development_count_changes += 1;
  }

  return delta;
}

function main() {
  fs.mkdirSync(STATE_HISTORY_DIR, { recursive: true });
  fs.mkdirSync(DELTA_HISTORY_DIR, { recursive: true });

  const previous = readJson(FILES.currentState, false);
  const current = buildState();
  const delta = buildDelta(previous, current);

  writeJson(FILES.currentState, current);
  writeJson(FILES.currentDelta, delta);
  writeJson(path.join(STATE_HISTORY_DIR, `${current.date_utc}.json`), current);
  writeJson(path.join(DELTA_HISTORY_DIR, `${current.date_utc}.json`), delta);

  console.log("\n=== PTD Today / Cosmos State + Delta ===");
  console.log(`Date:                 ${current.date_utc}`);
  console.log(`Cold start:           ${delta.cold_start}`);
  console.log(`Entities:             ${current.totals.entities}`);
  console.log(`Relationships:        ${current.totals.relationships}`);
  console.log(`Developments:         ${current.totals.developments}`);
  console.log(`Added entities:       ${delta.summary.added_entities}`);
  console.log(`Removed entities:     ${delta.summary.removed_entities}`);
  console.log(`Changed entities:     ${delta.summary.changed_entities}`);
  console.log(`Lifecycle transitions:${delta.summary.lifecycle_transitions}`);
  console.log(`Graph Δ entities:     ${delta.graph_delta.entities}`);
  console.log(`Graph Δ relationships:${delta.graph_delta.relationships}`);
  console.log(`Graph Δ developments: ${delta.graph_delta.developments}`);
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error);
  process.exit(1);
}
