#!/usr/bin/env node
/**
 * PTD Today / Cosmos — Impact / Propagation Engine v0.2
 *
 * Deterministic, explainable graph propagation. No OpenAI calls.
 *
 * Reads:
 *   knowledge/cosmos/state-current.json
 *   knowledge/cosmos/delta-current.json
 *   knowledge/relationships.json
 *   knowledge/developments.json
 *
 * Writes:
 *   knowledge/cosmos/impact-current.json
 *   knowledge/cosmos/impact-history/YYYY-MM-DD.json
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.cwd();
const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || "knowledge";
const COSMOS_DIR = path.join(ROOT, KNOWLEDGE_DIR, "cosmos");
const HISTORY_DIR = path.join(COSMOS_DIR, "impact-history");

const FILES = {
  state: path.join(COSMOS_DIR, "state-current.json"),
  delta: path.join(COSMOS_DIR, "delta-current.json"),
  relationships: path.join(ROOT, KNOWLEDGE_DIR, "relationships.json"),
  developments: path.join(ROOT, KNOWLEDGE_DIR, "developments.json"),
  output: path.join(COSMOS_DIR, "impact-current.json")
};

function num(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const MAX_DEPTH = Math.round(num(process.env.COSMOS_IMPACT_MAX_DEPTH, 3, 1, 3));
const MIN_REL_STRENGTH = num(process.env.COSMOS_IMPACT_MIN_REL_STRENGTH, 65, 1, 100);
const MIN_REL_CONFIDENCE = num(process.env.COSMOS_IMPACT_MIN_REL_CONFIDENCE, 0.65, 0, 1);
const MIN_PATH_SCORE = num(process.env.COSMOS_IMPACT_MIN_PATH_SCORE, 20, 0, 100);
const MAX_RESULTS = Math.round(num(process.env.COSMOS_IMPACT_MAX_RESULTS, 250, 10, 2000));
const DEPTH_DECAY = { 1: 1.00, 2: 0.70, 3: 0.45 };
const MIN_IMPORTANCE_DELTA = num(
  process.env.COSMOS_IMPACT_MIN_IMPORTANCE_DELTA,
  1.0,
  0,
  100
);

/*
 * Propagation semantics:
 * - forward: source can affect target.
 * - reverse: dependency/resource can affect the entity that depends on it.
 * - both: contextual/symmetric; allowed with a penalty.
 * - none: useful graph context, but not causal propagation by itself.
 */
const RULES = {
  INCREASES:    { mode: "forward", factor: 1.00, polarity:  1, causal: true },
  REDUCES:      { mode: "forward", factor: 1.00, polarity: -1, causal: true },
  AFFECTS:      { mode: "forward", factor: 0.95, polarity:  0, causal: true },
  SUPPLIES:     { mode: "forward", factor: 0.94, polarity:  0, causal: true },
  REGULATES:    { mode: "forward", factor: 0.94, polarity:  0, causal: true },
  ENABLES:      { mode: "forward", factor: 0.92, polarity:  0, causal: true },
  MANUFACTURES: { mode: "forward", factor: 0.92, polarity:  0, causal: true },
  SUPPORTS:     { mode: "forward", factor: 0.90, polarity:  0, causal: true },
  FUNDS:        { mode: "forward", factor: 0.88, polarity:  0, causal: true },
  REPLACES:     { mode: "forward", factor: 0.88, polarity:  0, causal: true },

  DEPENDS_ON:   { mode: "reverse", factor: 0.96, polarity:  0, causal: true },
  REQUIRES:     { mode: "reverse", factor: 0.96, polarity:  0, causal: true },
  USES:         { mode: "reverse", factor: 0.88, polarity:  0, causal: true },
  OWNED_BY:     { mode: "reverse", factor: 0.75, polarity:  0, causal: false },
  DEVELOPED_BY: { mode: "reverse", factor: 0.75, polarity:  0, causal: false },

  CONNECTED_TO: { mode: "both", factor: 0.72, polarity: 0, causal: false },
  COMPETES_WITH:{ mode: "both", factor: 0.70, polarity: 0, causal: false },
  LOCATED_IN:   { mode: "none", factor: 0.00, polarity: 0, causal: false }
};

function readJson(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing required file: ${path.relative(ROOT, file)}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function clean(value) { return String(value ?? "").trim(); }
function unique(values) { return [...new Set((values || []).filter(Boolean))]; }
function round(value, digits = 3) {
  const m = 10 ** digits;
  return Math.round(Number(value) * m) / m;
}
function stableId(prefix, values) {
  const hash = crypto.createHash("sha256").update(values.join("::")).digest("hex").slice(0, 16);
  return `${prefix}_${hash}`;
}
function entityId(x) { return x?.entity_id || x?.id || null; }
function developmentId(x) { return x?.development_id || x?.id || null; }
function endpoints(rel) {
  return {
    from: rel?.from_entity_id || rel?.source_entity_id || rel?.subject_id || null,
    to: rel?.to_entity_id || rel?.target_entity_id || rel?.object_id || null
  };
}

function stateLookup(state) {
  const lookup = new Map();
  for (const [id, e] of Object.entries(state?.entities || {})) {
    lookup.set(id, {
      entity_id: id,
      name: e?.name || id,
      slug: e?.slug || null,
      type: e?.type || null,
      lifecycle_status: e?.lifecycle_status || null,
      importance_score: Number.isFinite(Number(e?.importance_score)) ? Number(e.importance_score) : null,
      last_seen_at: e?.last_seen_at || null
    });
  }
  return lookup;
}

function compactEntity(id, lookup) {
  const e = lookup.get(id);
  return e ? {
    entity_id: e.entity_id,
    name: e.name,
    type: e.type,
    lifecycle_status: e.lifecycle_status,
    importance_score: e.importance_score
  } : {
    entity_id: id,
    name: id,
    type: null,
    lifecycle_status: null,
    importance_score: null
  };
}

function developmentEntityIds(dev) {
  return unique([
    ...(dev?.entities || []).map(entityId),
    ...(dev?.entity_ids || [])
  ]);
}

function isOnDate(dev, dateUtc) {
  if (!dateUtc) return false;
  if (clean(dev?.date_utc) === dateUtc) return true;
  const created = clean(dev?.created_at || dev?.occurred_at || dev?.updated_at);
  return created.startsWith(dateUtc);
}


function developmentTimestamp(dev) {
  const raw = clean(
    dev?.created_at ||
    dev?.occurred_at ||
    dev?.updated_at ||
    dev?.date_utc
  );
  if (!raw) return null;

  const time = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? `${raw}T00:00:00Z`
      : raw
  );

  return Number.isFinite(time) ? time : null;
}

function buildEntityDevelopmentIndex(developments, delta) {
  const byEntity = new Map();
  const dateUtc = clean(delta?.date_utc);
  const previousTime = Date.parse(clean(delta?.previous_state_generated_at));
  const currentTime = Date.parse(clean(delta?.current_state_generated_at));

  for (const dev of developments) {
    const devId = developmentId(dev);
    if (!devId) continue;

    const ts = developmentTimestamp(dev);

    const inStateInterval =
      Number.isFinite(previousTime) &&
      Number.isFinite(currentTime) &&
      Number.isFinite(ts) &&
      ts > previousTime &&
      ts <= currentTime;

    const onCurrentDate = isOnDate(dev, dateUtc);

    if (!inStateInterval && !onCurrentDate) continue;

    for (const id of developmentEntityIds(dev)) {
      if (!id) continue;

      const rows = byEntity.get(id) || [];
      rows.push({
        development_id: devId,
        timestamp: ts,
        evidence_mode: clean(dev?.evidence_mode) || null
      });
      byEntity.set(id, rows);
    }
  }

  return byEntity;
}

function evidenceForEntity(id, evidenceIndex) {
  return unique(
    (evidenceIndex.get(id) || []).map((row) => row.development_id)
  );
}

function numericChange(changes, key) {
  const row = changes?.[key];
  if (!row || typeof row !== "object") return null;

  const from = Number(row.from);
  const to = Number(row.to);

  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from, to, delta: to - from };
}

function classifySeed(kind, row, evidenceIds) {
  if (kind === "added_entity") {
    return {
      propagation_eligible: true,
      significance: evidenceIds.length ? "strong" : "medium",
      significance_score: evidenceIds.length ? 100 : 75,
      significance_reasons: [
        evidenceIds.length
          ? "New entity is linked to a development in the current state interval."
          : "New entity entered the current Cosmos graph."
      ]
    };
  }

  if (kind === "removed_entity") {
    return {
      propagation_eligible: true,
      significance: "strong",
      significance_score: 100,
      significance_reasons: [
        "Entity was removed from the active current Cosmos graph."
      ]
    };
  }

  const changes = row?.changes || {};
  const reasons = [];
  let score = 0;

  if (changes.lifecycle_status) {
    score += 45;
    reasons.push("Lifecycle status changed.");
  }

  if (changes.relationship_degree) {
    const rel = numericChange(changes, "relationship_degree");
    const magnitude = Math.abs(rel?.delta || 0);
    if (magnitude > 0) {
      score += Math.min(35, 18 + magnitude * 4);
      reasons.push(`Relationship degree changed by ${round(rel.delta, 2)}.`);
    }
  }

  if (changes.linked_development_count) {
    const dev = numericChange(changes, "linked_development_count");
    const magnitude = Math.abs(dev?.delta || 0);
    if (magnitude > 0) {
      score += Math.min(40, 20 + magnitude * 5);
      reasons.push(`Linked development count changed by ${round(dev.delta, 2)}.`);
    }
  }

  if (changes.type) {
    score += 22;
    reasons.push("Entity type changed.");
  }

  if (changes.name) {
    score += 12;
    reasons.push("Entity name changed.");
  }

  const importance = numericChange(changes, "importance_score");
  if (importance && Math.abs(importance.delta) >= MIN_IMPORTANCE_DELTA) {
    score += Math.min(35, 15 + Math.abs(importance.delta) * 4);
    reasons.push(
      `Importance score changed materially by ${round(importance.delta, 2)}.`
    );
  }

  if (evidenceIds.length) {
    score += Math.min(30, 12 + evidenceIds.length * 3);
    reasons.push(
      `${evidenceIds.length} current development${evidenceIds.length === 1 ? "" : "s"} linked to this entity.`
    );
  }

  return {
    propagation_eligible: score >= 20,
    significance:
      score >= 60 ? "strong" :
      score >= 20 ? "medium" :
      "contextual",
    significance_score: round(Math.min(100, score), 1),
    significance_reasons:
      reasons.length
        ? reasons
        : ["Only low-significance metadata/timestamp drift was observed."]
  };
}

function deltaSeeds(delta, lookup, evidenceIndex) {
  const propagating = [];
  const observed = [];
  const seen = new Set();

  const push = (id, kind, row, reason) => {
    if (!id || seen.has(id)) return;
    seen.add(id);

    const e = lookup.get(id);
    const evidenceIds = evidenceForEntity(id, evidenceIndex);
    const classification = classifySeed(kind, row, evidenceIds);

    const seed = {
      entity_id: id,
      name: e?.name || row?.name || id,
      type: e?.type || row?.type || null,
      seed_kind: kind,
      seed_reason: reason,
      changes: row?.changes || null,
      evidence_development_ids: evidenceIds,
      propagation_eligible: classification.propagation_eligible,
      significance: classification.significance,
      significance_score: classification.significance_score,
      significance_reasons: classification.significance_reasons
    };

    if (classification.propagation_eligible) propagating.push(seed);
    else observed.push(seed);
  };

  for (const row of delta?.added_entities || []) {
    push(entityId(row), "added_entity", row, "Entity was added in the current Cosmos delta.");
  }

  for (const row of delta?.changed_entities || []) {
    push(entityId(row), "changed_entity", row, "Entity changed in the current Cosmos delta.");
  }

  for (const row of delta?.removed_entities || []) {
    push(entityId(row), "removed_entity", row, "Entity was removed from the active current Cosmos state.");
  }

  return { propagating, observed };
}

function coldStartSeeds(delta, developments, lookup) {
  const dateUtc = clean(delta?.date_utc);
  const byEntity = new Map();
  for (const dev of developments) {
    if (!isOnDate(dev, dateUtc)) continue;
    const devId = developmentId(dev);
    for (const id of developmentEntityIds(dev)) {
      const row = byEntity.get(id) || { entity_id: id, evidence_development_ids: [] };
      row.evidence_development_ids = unique([...row.evidence_development_ids, devId]);
      byEntity.set(id, row);
    }
  }
  return [...byEntity.values()].map((row) => {
    const e = lookup.get(row.entity_id);
    return {
      entity_id: row.entity_id,
      name: e?.name || row.entity_id,
      type: e?.type || null,
      seed_kind: "cold_start_today_development",
      seed_reason: "Cold-start baseline: entity is explicitly linked to a development on the current UTC date.",
      changes: null,
      evidence_development_ids: row.evidence_development_ids
    };
  });
}

function buildSeeds(delta, developments, lookup) {
  const evidenceIndex = buildEntityDevelopmentIndex(developments, delta);
  const normal = deltaSeeds(delta, lookup, evidenceIndex);

  if (!delta?.cold_start && (normal.propagating.length || normal.observed.length)) {
    return {
      strategy: "evidence_grounded_delta_entities",
      seeds: normal.propagating,
      observed_deltas: normal.observed,
      evidence_indexed_entities: evidenceIndex.size
    };
  }

  const baseline = coldStartSeeds(delta, developments, lookup);

  if (baseline.length) {
    return {
      strategy: "cold_start_today_developments",
      seeds: baseline.map((seed) => ({
        ...seed,
        propagation_eligible: true,
        significance: "baseline",
        significance_score: 100,
        significance_reasons: [
          "Cold-start entity is explicitly linked to a current-date development."
        ]
      })),
      observed_deltas: [],
      evidence_indexed_entities: evidenceIndex.size
    };
  }

  return {
    strategy: "no_seed",
    seeds: [],
    observed_deltas: normal.observed || [],
    evidence_indexed_entities: evidenceIndex.size
  };
}

function ruleFor(rel) {
  const type = clean(rel?.relationship_type).toUpperCase();
  return { type, ...(RULES[type] || { mode: "none", factor: 0, polarity: 0, causal: false }) };
}

function buildAdjacency(relationships) {
  const adjacency = new Map();
  let accepted = 0;
  const add = (from, to, rel, rule, traversal, penalty = 1) => {
    if (!from || !to || from === to) return;
    const strength = num(rel?.strength, 0, 0, 100);
    const confidence = num(rel?.confidence, 0, 0, 1);
    if (strength < MIN_REL_STRENGTH || confidence < MIN_REL_CONFIDENCE) return;
    const edgeFactor = (strength / 100) * confidence * rule.factor * penalty;
    if (edgeFactor <= 0) return;
    const arc = {
      from_entity_id: from,
      to_entity_id: to,
      relationship_id: rel?.relationship_id || null,
      relationship_type: rule.type,
      label: rel?.label || null,
      explanation: rel?.explanation || null,
      traversal,
      causal: rule.causal,
      polarity: rule.polarity,
      relationship_strength: round(strength, 1),
      relationship_confidence: round(confidence, 3),
      edge_factor: round(edgeFactor, 6),
      evidence_mode: rel?.evidence_mode || null,
      evidence_development_ids: unique(rel?.evidence_development_ids || [])
    };
    const list = adjacency.get(from) || [];
    list.push(arc);
    adjacency.set(from, list);
    accepted += 1;
  };

  for (const rel of relationships) {
    if (clean(rel?.status || "active").toLowerCase() !== "active") continue;
    const { from, to } = endpoints(rel);
    const rule = ruleFor(rel);
    if (rule.mode === "forward") add(from, to, rel, rule, "forward");
    else if (rule.mode === "reverse") add(to, from, rel, rule, "reverse_dependency");
    else if (rule.mode === "both") {
      add(from, to, rel, rule, "contextual_forward", 0.85);
      add(to, from, rel, rule, "contextual_reverse", 0.85);
    }
  }
  for (const list of adjacency.values()) list.sort((a, b) => b.edge_factor - a.edge_factor);
  return { adjacency, accepted };
}

function pathScore(edges) {
  if (!edges.length) return 0;
  const product = edges.reduce((score, edge) => score * Number(edge.edge_factor || 0), 1);
  return round(product * (DEPTH_DECAY[edges.length] || 0) * 100, 2);
}

function polarity(edges) {
  const dirs = edges.map((e) => Number(e.polarity || 0)).filter(Boolean);
  if (!dirs.length) return "uncertain";
  return dirs.reduce((a, b) => a * b, 1) > 0 ? "increase" : "decrease";
}

function inferenceClass(edges) {
  if (edges.every((e) => e.causal)) return "causal_graph_path";
  if (edges.some((e) => e.causal)) return "mixed_graph_path";
  return "contextual_graph_path";
}

function relevanceWeight(id, lookup) {
  const importance = Number(lookup.get(id)?.importance_score);
  return Number.isFinite(importance) ? 0.70 + 0.30 * Math.min(100, Math.max(0, importance)) / 100 : 0.85;
}

function readablePath(seedId, edges, lookup) {
  const ids = [seedId, ...edges.map((e) => e.to_entity_id)];
  return {
    entity_ids: ids,
    entity_names: ids.map((id) => lookup.get(id)?.name || id),
    steps: edges.map((e) => ({
      from: compactEntity(e.from_entity_id, lookup),
      relationship_id: e.relationship_id,
      relationship_type: e.relationship_type,
      label: e.label,
      traversal: e.traversal,
      to: compactEntity(e.to_entity_id, lookup),
      relationship_strength: e.relationship_strength,
      relationship_confidence: e.relationship_confidence,
      explanation: e.explanation,
      evidence_development_ids: e.evidence_development_ids
    }))
  };
}

function propagate(seed, adjacency, lookup) {
  const results = [];
  const startId = seed.entity_id;
  if (!startId) return results;

  function walk(currentId, edges, visited) {
    if (edges.length >= MAX_DEPTH) return;
    for (const edge of adjacency.get(currentId) || []) {
      const nextId = edge.to_entity_id;
      if (!nextId || visited.has(nextId)) continue;
      const nextEdges = [...edges, edge];
      const score = pathScore(nextEdges);
      if (score < MIN_PATH_SCORE) continue;
      const evidenceIds = unique([
        ...(seed.evidence_development_ids || []),
        ...nextEdges.flatMap((e) => e.evidence_development_ids || [])
      ]);
      const avgConfidence = round(nextEdges.reduce((s, e) => s + e.relationship_confidence, 0) / nextEdges.length, 3);
      results.push({
        impact_id: stableId("imp", [startId, nextId, ...nextEdges.map((e) => e.relationship_id || e.relationship_type)]),
        origin: compactEntity(startId, lookup),
        affected: compactEntity(nextId, lookup),
        seed_kind: seed.seed_kind,
        seed_reason: seed.seed_reason,
        seed_significance: seed.significance || null,
        seed_significance_score: Number.isFinite(Number(seed.significance_score))
          ? Number(seed.significance_score)
          : null,
        seed_evidence_development_ids: unique(
          seed.evidence_development_ids || []
        ),
        propagation_depth: nextEdges.length,
        direct: nextEdges.length === 1,
        reasoning_mode: "graph_propagation",
        inference_class: inferenceClass(nextEdges),
        effect_polarity: polarity(nextEdges),
        cumulative_path_strength: score,
        impact_score: round(score * relevanceWeight(nextId, lookup), 2),
        average_relationship_confidence: avgConfidence,
        evidence_development_ids: evidenceIds,
        evidence_count: evidenceIds.length,
        evidence_modes: unique(nextEdges.map((e) => e.evidence_mode).filter(Boolean)),
        path: readablePath(startId, nextEdges, lookup)
      });
      const nextVisited = new Set(visited);
      nextVisited.add(nextId);
      walk(nextId, nextEdges, nextVisited);
    }
  }

  walk(startId, [], new Set([startId]));
  return results;
}

function dedupe(impacts) {
  const best = new Map();
  for (const impact of impacts) {
    const key = `${impact.origin.entity_id}::${impact.affected.entity_id}`;
    const old = best.get(key);
    if (!old || impact.impact_score > old.impact_score ||
      (impact.impact_score === old.impact_score && impact.propagation_depth < old.propagation_depth)) {
      best.set(key, impact);
    }
  }
  return [...best.values()]
    .sort((a, b) => b.impact_score - a.impact_score || a.propagation_depth - b.propagation_depth)
    .slice(0, MAX_RESULTS);
}

function countBy(impacts, getter) {
  const map = new Map();
  for (const impact of impacts) {
    const key = String(getter(impact) ?? "unknown");
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function main() {
  const state = readJson(FILES.state);
  const delta = readJson(FILES.delta);
  const relationshipsPayload = readJson(FILES.relationships);
  const developmentsPayload = readJson(FILES.developments);

  const relationships = Array.isArray(relationshipsPayload?.relationships) ? relationshipsPayload.relationships : [];
  const developments = Array.isArray(developmentsPayload?.developments) ? developmentsPayload.developments : [];
  const lookup = stateLookup(state);
  const seeds = buildSeeds(delta, developments, lookup);
  const graph = buildAdjacency(relationships);

  const raw = [];
  for (const seed of seeds.seeds) raw.push(...propagate(seed, graph.adjacency, lookup));
  const impacts = dedupe(raw);
  const generatedAt = new Date().toISOString();
  const dateUtc = clean(delta?.date_utc) || clean(state?.date_utc) || generatedAt.slice(0, 10);

  const output = {
    schema_version: "0.2",
    generated_at: generatedAt,
    date_utc: dateUtc,
    cold_start: Boolean(delta?.cold_start),
    status: seeds.seeds.length === 0 ? "no_significant_seed" : impacts.length === 0 ? "no_paths_above_threshold" : "ready",
    source: {
      state_schema_version: state?.schema_version || null,
      delta_schema_version: delta?.schema_version || null,
      relationships_schema_version: relationshipsPayload?.schema_version || null,
      developments_schema_version: developmentsPayload?.schema_version || null,
      state_generated_at: state?.generated_at || null,
      delta_generated_at: delta?.generated_at || null,
      relationships_generated_at: relationshipsPayload?.generated_at || null,
      developments_generated_at: developmentsPayload?.generated_at || null
    },
    methodology: {
      summary: "Evidence-grounded deterministic graph propagation from significant Cosmos change seeds. Every inferred impact exposes both seed evidence and the exact relationship path used to derive it.",
      reasoning_mode: "graph_propagation",
      max_depth: MAX_DEPTH,
      depth_decay: DEPTH_DECAY,
      minimum_relationship_strength: MIN_REL_STRENGTH,
      minimum_relationship_confidence: MIN_REL_CONFIDENCE,
      minimum_path_score: MIN_PATH_SCORE,
      maximum_results: MAX_RESULTS,
      minimum_material_importance_delta: MIN_IMPORTANCE_DELTA,
      seed_significance: "Lifecycle changes, relationship-degree changes, linked-development changes, material importance changes, entity additions/removals, and current development evidence may launch propagation. Timestamp-only changes and tiny score drift remain observed context.",
      seed_evidence_linkage: "Normal daily seeds are linked to developments in the previous-state to current-state interval when timestamps are available, with current UTC date as a fallback for reconstructed history.",
      cold_start_behavior: "When delta-current.json is a cold start, seeds come only from entities explicitly linked to developments on the current UTC date. This establishes a baseline without claiming those entities changed.",
      dependency_direction: "DEPENDS_ON, REQUIRES and USES propagate from the dependency/resource toward the dependent entity. INCREASES, REDUCES, AFFECTS, SUPPLIES, ENABLES and REGULATES propagate source to target.",
      contextual_edges: "CONNECTED_TO and COMPETES_WITH are allowed with a penalty. LOCATED_IN does not create an impact path by itself.",
      direction_limit: "effect_polarity is reported only when an explicit INCREASES/REDUCES relation exists in the path; otherwise it remains uncertain.",
      evidence_limit: "The engine preserves seed and relationship development IDs plus evidence_mode. AI-scenario evidence is not upgraded into verified fact."
    },
    graph: {
      relationships_available: relationships.length,
      impact_arcs_accepted: graph.accepted
    },
    seeds: {
      strategy: seeds.strategy,
      count: seeds.seeds.length,
      observed_delta_count: seeds.observed_deltas.length,
      evidence_indexed_entities: seeds.evidence_indexed_entities,
      items: seeds.seeds,
      observed_deltas: seeds.observed_deltas
    },
    summary: {
      impact_count: impacts.length,
      propagating_seed_count: seeds.seeds.length,
      contextual_delta_count: seeds.observed_deltas.length,
      seeds_with_direct_development_evidence: seeds.seeds.filter(
        (seed) => Array.isArray(seed.evidence_development_ids) &&
          seed.evidence_development_ids.length > 0
      ).length,
      by_depth: countBy(impacts, (x) => x.propagation_depth),
      by_inference_class: countBy(impacts, (x) => x.inference_class),
      by_effect_polarity: countBy(impacts, (x) => x.effect_polarity)
    },
    impacts
  };

  writeJson(FILES.output, output);
  writeJson(path.join(HISTORY_DIR, `${dateUtc}.json`), output);

  console.log("\n=== PTD Today / Cosmos Impact Engine ===");
  console.log(`Date:                 ${dateUtc}`);
  console.log(`Cold start:           ${output.cold_start}`);
  console.log(`Seed strategy:        ${output.seeds.strategy}`);
  console.log(`Propagating seeds:    ${output.seeds.count}`);
  console.log(`Contextual deltas:    ${output.seeds.observed_delta_count}`);
  console.log(`Seeds with evidence:  ${output.summary.seeds_with_direct_development_evidence}`);
  console.log(`Relationships:        ${output.graph.relationships_available}`);
  console.log(`Impact arcs accepted: ${output.graph.impact_arcs_accepted}`);
  console.log(`Impacts retained:     ${output.summary.impact_count}`);
  console.log(`Status:               ${output.status}`);
  console.log(`Output:               ${path.relative(ROOT, FILES.output)}`);
}

try {
  main();
} catch (error) {
  console.error("\nCosmos Impact Engine failed:");
  console.error(error?.stack || error?.message || error);
  process.exit(1);
}
