#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — Cosmos Core v0.1
 *
 * First executable Infinite State navigation core.
 * No OpenAI/API calls. No sector whitelist. No new causal claims.
 * The current graph may be power-heavy, but the architecture is domain-neutral.
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_STATE_FILE = process.env.COSMOS_STATE_FILE || "knowledge/cosmos/cosmos-state-current.json";
const MAX_DEPTH = 3;
const MAX_BRANCHES = 5;
const MAX_STARTS = 5;
const MAX_CONTEXT = 30;

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
function clean(v) { return String(v ?? "").trim(); }
function uniq(values) { return [...new Set((values || []).filter(Boolean))]; }
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function norm(v) {
  return clean(v)
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tokens(v) { return uniq(norm(v).split(" ").filter(x => x.length >= 2)); }
function jaccardText(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let intersection = 0;
  for (const x of A) if (B.has(x)) intersection += 1;
  return intersection / (A.size + B.size - intersection);
}
function stableId(prefix, source) {
  const s = Array.isArray(source) ? source.join("|") : String(source || "");
  let hash = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function readJson(file) {
  if (!fs.existsSync(file)) throw new Error(`Required file not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalizeInput(raw) {
  const p = typeof raw === "string" ? { text: raw } : (raw && typeof raw === "object" ? raw : {});
  return {
    input_id: clean(p.input_id) || stableId("input", [clean(p.text), new Date().toISOString().slice(0, 16)]),
    text: clean(p.text),
    language: clean(p.language) || "auto",
    entity_hints: uniq(Array.isArray(p.entity_hints) ? p.entity_hints.map(clean) : []),
    concept_hints: uniq(Array.isArray(p.concept_hints) ? p.concept_hints.map(clean) : []),
    geography_hints: uniq(Array.isArray(p.geography_hints) ? p.geography_hints.map(clean) : []),
    time_horizon: p.time_horizon ?? null,
    requested_perspective: clean(p.requested_perspective) || null,
    mode: clean(p.mode) || "open",
    metadata: p.metadata && typeof p.metadata === "object" ? p.metadata : {}
  };
}

function buildIndexes(state) {
  const entities = Array.isArray(state?.now?.entities) ? state.now.entities : [];
  const developments = Array.isArray(state?.now?.developments) ? state.now.developments : [];
  const relationships = Array.isArray(state?.graph?.relationships) ? state.graph.relationships : [];
  const impacts = Array.isArray(state?.impact?.signals) ? state.impact.signals : [];
  const patterns = Array.isArray(state?.patterns?.signals) ? state.patterns.signals : [];
  const emergences = Array.isArray(state?.emergence?.signals) ? state.emergence.signals : [];
  const attention = Array.isArray(state?.attention?.signals) ? state.attention.signals : [];
  const systems = Array.isArray(state?.attention?.clusters) ? state.attention.clusters : [];

  const entityById = new Map();
  const entityNameIndex = new Map();
  const relationshipsByEntity = new Map();
  const attentionByEntity = new Map();
  const systemsByEntity = new Map();

  for (const entity of entities) {
    if (!entity?.entity_id) continue;
    entityById.set(entity.entity_id, entity);
    const names = uniq([entity.name, ...(entity.aliases || []), ...(entity.multilingual_aliases || [])]);
    for (const name of names) {
      const key = norm(name);
      if (!key) continue;
      const rows = entityNameIndex.get(key) || [];
      rows.push(entity.entity_id);
      entityNameIndex.set(key, rows);
    }
  }

  for (const rel of relationships) {
    for (const id of [rel.from_entity_id, rel.to_entity_id]) {
      if (!id) continue;
      const rows = relationshipsByEntity.get(id) || [];
      rows.push(rel);
      relationshipsByEntity.set(id, rows);
    }
  }

  for (const row of attention) {
    for (const id of row.entity_ids || []) {
      const rows = attentionByEntity.get(id) || [];
      rows.push(row);
      attentionByEntity.set(id, rows);
    }
  }

  for (const system of systems) {
    for (const id of uniq([...(system.entity_ids || []), ...(system.anchor_entity_ids || [])])) {
      const rows = systemsByEntity.get(id) || [];
      rows.push(system);
      systemsByEntity.set(id, rows);
    }
  }

  return {
    entities, developments, relationships, impacts, patterns, emergences, attention, systems,
    entityById, entityNameIndex, relationshipsByEntity, attentionByEntity, systemsByEntity
  };
}

function resolveEntities(input, idx) {
  const found = [];
  const hints = uniq([...(input.entity_hints || []), ...(input.concept_hints || []), ...(input.geography_hints || [])]);

  function add(entity, score, reason) {
    if (!entity?.entity_id) return;
    found.push({ entity_id: entity.entity_id, name: entity.name, type: entity.type, score, reason });
  }

  for (const hint of hints) {
    const exactIds = idx.entityNameIndex.get(norm(hint)) || [];
    for (const id of exactIds) add(idx.entityById.get(id), 100, "explicit_hint_exact");
    if (!exactIds.length) {
      for (const entity of idx.entities) {
        const s = jaccardText(hint, entity.name);
        if (s >= 0.5) add(entity, 70 + s * 25, "explicit_hint_lexical");
      }
    }
  }

  const query = norm(input.text);
  for (const entity of idx.entities) {
    const name = norm(entity.name);
    if (!name) continue;
    if (query.includes(name)) {
      add(entity, 92, "query_exact_phrase");
      continue;
    }
    const s = jaccardText(input.text, entity.name);
    if (s >= 0.5) add(entity, 55 + s * 30, "query_lexical");
  }

  const strongest = new Map();
  for (const row of found) {
    const prev = strongest.get(row.entity_id);
    if (!prev || row.score > prev.score) strongest.set(row.entity_id, row);
  }

  return [...strongest.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, MAX_STARTS);
}

function selectSystems(starts, idx) {
  const scored = new Map();
  for (const start of starts) {
    for (const system of idx.systemsByEntity.get(start.entity_id) || []) {
      let score = n(system.attention_score) * 0.6 + start.score * 0.4;
      if ((system.anchor_entity_ids || []).includes(start.entity_id)) score += 8;
      const prev = scored.get(system.cluster_id);
      if (!prev || score > prev._score) scored.set(system.cluster_id, { ...system, _score: score });
    }
  }
  return [...scored.values()]
    .sort((a, b) => b._score - a._score)
    .slice(0, MAX_BRANCHES)
    .map(({ _score, ...system }) => system);
}

function selectAttention(starts, systems, idx) {
  const seen = new Set();
  const out = [];
  const add = row => {
    if (!row?.attention_id || seen.has(row.attention_id)) return;
    seen.add(row.attention_id);
    out.push(row);
  };
  for (const start of starts) for (const row of idx.attentionByEntity.get(start.entity_id) || []) add(row);
  for (const system of systems) {
    const ids = new Set(system.member_attention_ids || []);
    for (const row of idx.attention) if (ids.has(row.attention_id)) add(row);
  }
  return out.sort((a, b) => n(b.attention_score) - n(a.attention_score)).slice(0, MAX_CONTEXT);
}

function relScore(rel) {
  return n(rel.cosmos_relationship_score) * 0.45 + n(rel.strength) * 0.35 + n(rel.confidence) * 100 * 0.20;
}
function otherEnd(rel, id) {
  if (rel.from_entity_id === id) return rel.to_entity_id;
  if (rel.to_entity_id === id) return rel.from_entity_id;
  return null;
}

function traverseGraph(starts, idx, options = {}) {
  const maxDepth = clamp(n(options.max_depth, MAX_DEPTH), 1, MAX_DEPTH);
  const maxBranches = clamp(n(options.max_branches, MAX_BRANCHES), 1, MAX_BRANCHES);
  const visited = new Set(starts.map(x => x.entity_id));
  const nodes = [];
  const relationships = [];
  let frontier = starts.map(x => ({ entity_id: x.entity_id, path_score: x.score }));

  for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
    const next = [];
    for (const current of frontier) {
      const rels = [...(idx.relationshipsByEntity.get(current.entity_id) || [])]
        .sort((a, b) => relScore(b) - relScore(a))
        .slice(0, maxBranches);

      for (const rel of rels) {
        const other = otherEnd(rel, current.entity_id);
        if (!other) continue;
        const score = current.path_score * 0.55 + relScore(rel) * 0.45;
        relationships.push({
          relationship_id: rel.relationship_id,
          from_entity_id: rel.from_entity_id,
          to_entity_id: rel.to_entity_id,
          relationship_type: rel.relationship_type,
          label: rel.label,
          strength: rel.strength,
          confidence: rel.confidence,
          evidence_quality_score: rel.evidence_quality_score,
          evidence_quality_label: rel.evidence_quality_label,
          evidence_development_ids: rel.evidence_development_ids || [],
          traversal_depth: depth + 1,
          traversal_score: Math.round(score * 100) / 100
        });

        if (!visited.has(other)) {
          visited.add(other);
          const entity = idx.entityById.get(other);
          if (entity) nodes.push({
            entity_id: entity.entity_id,
            name: entity.name,
            type: entity.type,
            lifecycle_status: entity.lifecycle_status,
            importance_score: entity.importance_score,
            depth: depth + 1,
            traversal_score: Math.round(score * 100) / 100
          });
          next.push({ entity_id: other, path_score: score });
        }
      }
    }
    frontier = next.sort((a, b) => b.path_score - a.path_score).slice(0, maxBranches);
  }

  return {
    max_depth: maxDepth,
    max_branches: maxBranches,
    nodes: nodes.sort((a, b) => b.traversal_score - a.traversal_score).slice(0, MAX_CONTEXT),
    relationships: relationships.sort((a, b) => b.traversal_score - a.traversal_score).slice(0, MAX_CONTEXT)
  };
}

function selectDerived(starts, traversal, idx) {
  const wanted = new Set(uniq([...starts.map(x => x.entity_id), ...traversal.nodes.map(x => x.entity_id)]));
  function pick(rows, scoreField) {
    return rows
      .map(row => ({ row, overlap: (row.entity_ids || []).filter(id => wanted.has(id)).length }))
      .filter(x => x.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap || n(b.row[scoreField]) - n(a.row[scoreField]))
      .slice(0, MAX_CONTEXT)
      .map(x => x.row);
  }
  return {
    impacts: pick(idx.impacts, "impact_score"),
    patterns: pick(idx.patterns, "pattern_score"),
    emergences: pick(idx.emergences, "emergence_score")
  };
}

function runCosmosCore(rawInput, options = {}) {
  const stateFile = options.state_file || DEFAULT_STATE_FILE;
  const state = readJson(stateFile);
  const idx = buildIndexes(state);
  const input = normalizeInput(rawInput);
  const starts = resolveEntities(input, idx);
  const systems = selectSystems(starts, idx);
  const attention = selectAttention(starts, systems, idx);
  const traversal = traverseGraph(starts, idx, options);
  const derived = selectDerived(starts, traversal, idx);

  const devIds = uniq([
    ...traversal.relationships.flatMap(x => x.evidence_development_ids || []),
    ...derived.impacts.flatMap(x => x.supporting_development_ids || []),
    ...derived.patterns.flatMap(x => x.supporting_development_ids || []),
    ...derived.emergences.flatMap(x => x.supporting_development_ids || [])
  ]);
  const devMap = new Map(idx.developments.filter(x => x?.development_id).map(x => [x.development_id, x]));
  const developments = devIds.map(id => devMap.get(id)).filter(Boolean).slice(0, MAX_CONTEXT);

  return {
    schema_version: "0.1",
    generated_at: new Date().toISOString(),
    status: starts.length ? "context_resolved" : "no_starting_point_resolved",
    input,
    knowledge_state: {
      source_file: stateFile,
      cosmos_state_schema_version: state.schema_version || null,
      cosmos_state_date_utc: state.date_utc || null,
      cosmos_state_generated_at: state.generated_at || null,
      source_freshness: state.source_freshness || null
    },
    resolution: {
      starting_points: starts,
      note: "v0.1 is domain-neutral and exposes a pluggable multilingual semantic-resolution boundary. Deterministic matching uses graph names/aliases and explicit hints; richer multilingual understanding is a separate future layer."
    },
    selected_context: {
      systems,
      attention,
      patterns: derived.patterns,
      emergences: derived.emergences,
      impacts: derived.impacts,
      developments,
      relationships: traversal.relationships,
      entities: traversal.nodes
    },
    navigation: {
      max_depth: traversal.max_depth,
      max_branches: traversal.max_branches,
      expandable_entity_ids: uniq([...starts.map(x => x.entity_id), ...traversal.nodes.map(x => x.entity_id)])
    },
    infinite_state: {
      terminal: false,
      continuation_allowed: true,
      observations: [
        "This result is a bounded view into a non-terminal Cosmos state.",
        "Future interactions may change relevance without rewriting historical evidence."
      ]
    },
    safeguards: {
      creates_new_causal_claims: false,
      upgrades_evidence_quality: false,
      forecast_generated: false,
      sector_whitelist_present: false,
      traversal_bounded_for_response: true,
      source_lineage_preserved: true
    }
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {};
  const text = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--state" && args[i + 1]) { options.state_file = args[++i]; continue; }
    if (args[i] === "--input" && args[i + 1]) { options.input_file = args[++i]; continue; }
    if (args[i] === "--out" && args[i + 1]) { options.output_file = args[++i]; continue; }
    if (args[i] === "--max-depth" && args[i + 1]) { options.max_depth = Number(args[++i]); continue; }
    if (args[i] === "--max-branches" && args[i + 1]) { options.max_branches = Number(args[++i]); continue; }
    text.push(args[i]);
  }
  return { options, text: text.join(" ").trim() };
}

function main() {
  const { options, text } = parseArgs(process.argv);
  let input;
  if (options.input_file) input = readJson(options.input_file);
  else if (text) input = { text };
  else input = {
    text: "What could AI data-center growth affect?",
    entity_hints: ["Artificial Intelligence", "Data Centers"],
    mode: "open"
  };

  const output = runCosmosCore(input, options);
  const json = JSON.stringify(output, null, 2);
  if (options.output_file) {
    fs.mkdirSync(path.dirname(options.output_file), { recursive: true });
    fs.writeFileSync(options.output_file, json, "utf8");
    console.log(`Cosmos Core output written to ${options.output_file}`);
  } else {
    process.stdout.write(json + "\n");
  }
}

if (require.main === module) main();
module.exports = { runCosmosCore, normalizeInput, resolveEntities, buildIndexes };
