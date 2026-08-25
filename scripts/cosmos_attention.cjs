#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — Cosmos Attention v0.2
 *
 * Purpose
 * -------
 * Deterministic "Infinite Attention" + intent-sensitive pathway layer for Cosmos Core outputs.
 *
 * Core principle:
 *   Attention may suppress visibility.
 *   Attention may never suppress existence.
 *
 * This layer:
 *   - consumes Cosmos Core v0.1/v0.1.1 output
 *   - ranks discovered context for the current interaction
 *   - creates a bounded Active Context
 *   - preserves remaining context as Expandable Context
 *   - introduces primary pathways without inventing new causality
 *   - preserves evidence quality and lineage
 *
 * This layer DOES NOT:
 *   - call OpenAI or any external API
 *   - modify Cosmos State
 *   - create new causal claims
 *   - upgrade evidence quality
 *   - impose a sector whitelist
 *
 * Node compatibility:
 *   CommonJS (.cjs), safe with package.json "type":"module".
 */

const fs = require("fs");
const path = require("path");

/* -------------------------------------------------------------------------- */
/* Defaults                                                                   */
/* -------------------------------------------------------------------------- */

const DEFAULT_BUDGET = Object.freeze({
  primary_pathways: 5,
  patterns: 5,
  emergences: 5,
  impacts: 8,
  developments: 10,
  relationships: 12,
  entities: 10,
  systems: 3,
  attention: 8
});

const MAX_DISCOVERY_ITEMS = 200;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function clean(v) {
  return String(v ?? "").trim();
}

function lower(v) {
  return clean(v).toLocaleLowerCase();
}

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeText(value) {
  return lower(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return uniq(
    normalizeText(value)
      .split(" ")
      .map(x => x.trim())
      .filter(x => x.length >= 2)
  );
}

function overlapScore(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const token of A) if (B.has(token)) hit += 1;
  return hit / A.size;
}

function jaccardStrings(valuesA, valuesB) {
  const A = new Set((valuesA || []).map(clean).filter(Boolean));
  const B = new Set((valuesB || []).map(clean).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const x of A) if (B.has(x)) i += 1;
  return i / (A.size + B.size - i);
}

function readJson(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Required file not found: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
}

function stableId(prefix, values) {
  const src = Array.isArray(values) ? values.join("|") : String(values || "");
  let hash = 2166136261;
  for (let i = 0; i < src.length; i += 1) {
    hash ^= src.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function itemEvidenceScore(item) {
  return clamp(n(item?.evidence_quality_score, 0), 0, 100);
}

function itemStructuralScore(item) {
  return clamp(
    n(
      item?.structural_strength_score ??
      item?.structural_score ??
      item?.attention_score ??
      item?.impact_score ??
      item?.pattern_score ??
      item?.emergence_score ??
      item?.traversal_score ??
      item?.importance_score,
      0
    ),
    0,
    100
  );
}

function itemConfidenceScore(item) {
  const raw = item?.confidence;
  if (raw != null && Number(raw) <= 1) {
    return clamp(n(raw) * 100, 0, 100);
  }
  return clamp(
    n(
      raw ??
      item?.confidence_score ??
      item?.attention_score ??
      item?.structural_strength_score ??
      item?.impact_score,
      0
    ),
    0,
    100
  );
}

function itemEntityIds(item) {
  return uniq([
    ...(item?.entity_ids || []),
    ...(item?.supporting_entity_ids || []),
    ...(item?.anchor_entity_ids || []),
    ...(item?.focus_entity?.entity_id ? [item.focus_entity.entity_id] : []),
    ...((item?.focus_entities || []).map(x => x?.entity_id)),
    ...((item?.shared_entities || []).map(x => x?.entity_id)),
    ...(item?.origin_entity_id ? [item.origin_entity_id] : []),
    ...(item?.affected_entity_id ? [item.affected_entity_id] : []),
    ...(item?.from_entity_id ? [item.from_entity_id] : []),
    ...(item?.to_entity_id ? [item.to_entity_id] : [])
  ]);
}

function itemText(item) {
  return [
    item?.title,
    item?.description,
    item?.label,
    item?.name,
    item?.relationship_type,
    item?.pattern_family,
    item?.emergence_family,
    item?.claim_class,
    item?.reasoning_mode,
    item?.inference_class
  ]
    .filter(Boolean)
    .join(" ");
}

function itemId(item, type) {
  return (
    item?.attention_id ||
    item?.pattern_id ||
    item?.emergence_id ||
    item?.impact_id ||
    item?.development_id ||
    item?.relationship_id ||
    item?.entity_id ||
    item?.cluster_id ||
    stableId(type, itemText(item))
  );
}

/* -------------------------------------------------------------------------- */
/* Attention scoring                                                          */
/* -------------------------------------------------------------------------- */

function buildQueryContext(core) {
  const input = core?.input || {};
  const starts = core?.resolution?.starting_points || [];

  return {
    query_text: clean(input.text),
    query_tokens: tokenize(input.text),
    starting_entity_ids: new Set(starts.map(x => x.entity_id).filter(Boolean)),
    starting_names: starts.map(x => x.name).filter(Boolean),
    mode: clean(input.mode) || "open",
    requested_perspective: clean(input.requested_perspective),
    time_horizon: input.time_horizon ?? null
  };
}

function directnessScore(item, query) {
  const ids = itemEntityIds(item);
  const directEntityHit = ids.some(id => query.starting_entity_ids.has(id));
  if (directEntityHit) return 100;

  const text = itemText(item);
  const lexical = overlapScore(query.query_text, text) * 100;

  const depth = n(item?.traversal_depth ?? item?.depth ?? item?.propagation_depth, 0);
  const depthPenalty = clamp(depth * 12, 0, 36);

  return clamp(Math.max(lexical, 55 - depthPenalty), 0, 100);
}

function questionRelevanceScore(item, query) {
  const lexical = overlapScore(query.query_text, itemText(item)) * 100;
  const ids = itemEntityIds(item);
  const entityHit = ids.some(id => query.starting_entity_ids.has(id)) ? 100 : 0;

  let modeBonus = 0;
  const text = lower(itemText(item));
  const q = lower(query.query_text);

  if (/\baffect|impact|effect|consequence|ripple|what could\b/.test(q)) {
    if (
      text.includes("impact") ||
      item?.impact_id ||
      item?.affected_entity_id ||
      item?.origin_entity_id
    ) modeBonus += 12;
  }

  if (/\bemerg|forming|trend|pattern\b/.test(q)) {
    if (item?.emergence_id || item?.pattern_id) modeBonus += 10;
  }

  return clamp(Math.max(lexical, entityHit) + modeBonus, 0, 100);
}

function temporalScore(item) {
  const persistence = item?.persistence || {};
  const status = clean(persistence.status);

  if (status === "new") return 100;
  if (status === "strengthening") return 95;
  if (status === "persistent") return 85;
  if (status === "insufficient_history") return 70;

  if (item?.date_utc || item?.generated_at) return 70;
  return 60;
}

function emergenceNoveltyScore(item, type) {
  if (type === "emergence") return 100;
  if (type === "pattern") return 85;
  if (type === "impact") return 80;
  if (type === "relationship") return 65;
  if (type === "entity") return 55;
  return 50;
}

function evidenceFactorScore(item) {
  // Preserve weak evidence as weak; do not convert it to certainty.
  // But don't erase structurally useful signals solely because evidence is weak.
  const evidence = itemEvidenceScore(item);
  return 40 + evidence * 0.6;
}

function scoreItem(item, type, query) {
  const relevance = questionRelevanceScore(item, query);
  const directness = directnessScore(item, query);
  const structural = itemStructuralScore(item);
  const confidence = itemConfidenceScore(item);
  const temporal = temporalScore(item);
  const novelty = emergenceNoveltyScore(item, type);
  const evidenceFactor = evidenceFactorScore(item);

  const total =
    relevance * 0.30 +
    directness * 0.20 +
    structural * 0.18 +
    confidence * 0.10 +
    temporal * 0.08 +
    novelty * 0.06 +
    evidenceFactor * 0.08;

  const reasons = [];
  if (relevance >= 80) reasons.push("high relevance to the current question");
  else if (relevance >= 55) reasons.push("meaningful relevance to the current question");

  if (directness >= 90) reasons.push("directly connected to the current attention center");
  else if (directness >= 65) reasons.push("close to the current attention center");

  if (structural >= 85) reasons.push("high structural importance");
  if (temporal >= 90) reasons.push("temporally fresh or strengthening");
  if (type === "emergence") reasons.push("higher-order emergence signal");
  if (type === "pattern") reasons.push("qualified structural pattern");
  if (type === "impact") reasons.push("propagated impact context");

  const evidence = itemEvidenceScore(item);
  if (evidence < 50) reasons.push("evidence remains weak and is not upgraded");
  else if (evidence >= 75) reasons.push("strong supporting evidence");

  return {
    ...item,
    _attention: {
      type,
      score: Math.round(total * 100) / 100,
      question_relevance: Math.round(relevance * 100) / 100,
      directness: Math.round(directness * 100) / 100,
      structural_strength: Math.round(structural * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      temporal_relevance: Math.round(temporal * 100) / 100,
      emergence_novelty: Math.round(novelty * 100) / 100,
      evidence_factor: Math.round(evidenceFactor * 100) / 100,
      reasons
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Diversity-aware selection                                                  */
/* -------------------------------------------------------------------------- */

function similarity(a, b) {
  const entitySim = jaccardStrings(itemEntityIds(a), itemEntityIds(b));
  const tokenSim = jaccardStrings(tokenize(itemText(a)), tokenize(itemText(b)));
  return Math.max(entitySim, tokenSim);
}

function diversitySelect(scoredItems, budget) {
  const candidates = [...scoredItems]
    .sort((a, b) => b._attention.score - a._attention.score);

  const selected = [];
  const suppressed = [];

  while (candidates.length && selected.length < budget) {
    let bestIndex = 0;
    let bestAdjusted = -Infinity;

    for (let i = 0; i < candidates.length; i += 1) {
      const item = candidates[i];

      const redundancy = selected.length
        ? Math.max(...selected.map(s => similarity(item, s)))
        : 0;

      const diversityPenalty = redundancy * 24;
      const adjusted = item._attention.score - diversityPenalty;

      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIndex = i;
      }
    }

    const [winner] = candidates.splice(bestIndex, 1);
    selected.push({
      ...winner,
      _attention: {
        ...winner._attention,
        diversity_adjusted_score: Math.round(bestAdjusted * 100) / 100
      }
    });
  }

  suppressed.push(...candidates);

  return { selected, suppressed };
}

/* -------------------------------------------------------------------------- */
/* Intent-sensitive pathway intelligence                                      */
/* -------------------------------------------------------------------------- */

function isImpactIntent(query) {
  const q = lower(query?.query_text);
  return /\baffect|impact|effect|consequence|ripple|result|lead to|depend|require|constraint|what could\b/.test(q);
}

function relationshipSemanticAdjustment(rel, query) {
  const type = clean(rel?.relationship_type).toUpperCase();
  const label = lower(rel?.label);
  const impactIntent = isImpactIntent(query);

  if (!impactIntent) return 0;

  let adjustment = 0;

  const positiveByType = {
    AFFECTS: 20,
    IMPACTS: 20,
    DRIVES: 18,
    REQUIRES: 18,
    DEPENDS_ON: 17,
    CONSTRAINS: 17,
    ENABLES: 15,
    CAUSES: 15,
    INCREASES: 14,
    DECREASES: 14,
    SUPPLIES: 12,
    SUPPORTS: 9
  };

  const negativeByType = {
    LOCATED_IN: -34,
    PART_OF: -16,
    MEMBER_OF: -16,
    ASSOCIATED_WITH: -10,
    RELATED_TO: -8
  };

  adjustment += positiveByType[type] || 0;
  adjustment += negativeByType[type] || 0;

  if (/\brequire|depend|constraint|bottleneck|capacity|resilience|enable|impact|affect|drive|supply\b/.test(label)) {
    adjustment += 8;
  }

  if (/\blocated in|headquartered|based in|member of|part of\b/.test(label)) {
    adjustment -= 18;
  }

  return adjustment;
}

function humanReadableEntityName(entityId, name) {
  const value = clean(name);
  if (!value) return null;
  if (value === entityId) return null;
  if (/^ent_[a-z0-9]+$/i.test(value)) return null;
  return value;
}

function entityInfoMap(core) {
  const map = new Map();

  function put(row) {
    if (!row?.entity_id) return;
    const previous = map.get(row.entity_id) || {};
    map.set(row.entity_id, {
      entity_id: row.entity_id,
      name: humanReadableEntityName(row.entity_id, row.name) || previous.name || null,
      type: row.type || previous.type || null
    });
  }

  for (const row of core?.resolution?.starting_points || []) put(row);
  for (const row of core?.selected_context?.entities || []) put(row);

  for (const row of core?.selected_context?.patterns || []) {
    if (row?.focus_entity) put(row.focus_entity);
    for (const x of row?.supporting_entities || []) put(x);
  }

  for (const row of core?.selected_context?.emergences || []) {
    for (const x of row?.focus_entities || []) put(x);
    for (const x of row?.shared_entities || []) put(x);
  }

  return map;
}

function pathwayCoverageKey(pathway, infoMap) {
  const toInfo = infoMap.get(pathway.to.entity_id) || {};
  const type = clean(toInfo.type) || "Unknown";
  const relType = clean(pathway.relationship.type).toUpperCase() || "UNKNOWN";
  return `${type}|${relType}`;
}

/* -------------------------------------------------------------------------- */
/* Pathway construction                                                       */
/* -------------------------------------------------------------------------- */

function entityNameMap(core) {
  const info = entityInfoMap(core);
  const map = new Map();

  for (const [entityId, row] of info.entries()) {
    if (row?.name) map.set(entityId, row.name);
  }

  return map;
}

function pathwayKey(rel) {
  return `${rel.from_entity_id || ""}|${rel.to_entity_id || ""}|${rel.relationship_id || ""}`;
}

function buildPrimaryPathways(core, relationshipRanking, active, query, budget) {
  const rankedRelationships = [
    ...((relationshipRanking?.selected) || []),
    ...((relationshipRanking?.suppressed) || [])
  ];

  const impacts = active.impacts || [];
  const infoMap = entityInfoMap(core);
  const nameMap = entityNameMap(core);
  const startingIds = query.starting_entity_ids || new Set();

  const pathways = [];

  for (const rel of rankedRelationships) {
    const fromId = rel.from_entity_id;
    const toId = rel.to_entity_id;
    if (!fromId || !toId) continue;

    const fromName = humanReadableEntityName(fromId, nameMap.get(fromId));
    const toName = humanReadableEntityName(toId, nameMap.get(toId));

    if (!fromName || !toName) continue;

    const relatedImpacts = impacts.filter(imp => {
      const ids = new Set(itemEntityIds(imp));
      return ids.has(fromId) || ids.has(toId);
    });

    const relAttention = n(rel?._attention?.score);
    const strongestImpact = relatedImpacts.length
      ? Math.max(...relatedImpacts.map(x => n(x?._attention?.score)))
      : 0;

    const semanticAdjustment = relationshipSemanticAdjustment(rel, query);
    const touchesAttentionCenter =
      startingIds.has(fromId) || startingIds.has(toId);

    const directionBonus = startingIds.has(fromId) ? 8 : 0;
    const centerBonus = touchesAttentionCenter ? 5 : 0;

    const rawScore =
      relAttention * 0.58 +
      strongestImpact * 0.24 +
      itemStructuralScore(rel) * 0.18 +
      semanticAdjustment +
      directionBonus +
      centerBonus;

    const score = clamp(rawScore, 0, 100);

    pathways.push({
      pathway_id: stableId("pathway", pathwayKey(rel)),
      score: Math.round(score * 100) / 100,
      from: {
        entity_id: fromId,
        name: fromName,
        type: infoMap.get(fromId)?.type || null
      },
      relationship: {
        relationship_id: rel.relationship_id,
        type: rel.relationship_type,
        label: rel.label,
        strength: rel.strength,
        confidence: rel.confidence,
        semantic_adjustment: semanticAdjustment
      },
      to: {
        entity_id: toId,
        name: toName,
        type: infoMap.get(toId)?.type || null
      },
      related_impact_ids: relatedImpacts
        .slice(0, 3)
        .map(x => x.impact_id)
        .filter(Boolean),
      evidence_development_ids: rel.evidence_development_ids || [],
      attention_reasons: uniq([
        ...(rel?._attention?.reasons || []),
        ...(semanticAdjustment > 0
          ? ["relationship semantics are relevant to the current intent"]
          : []),
        ...(semanticAdjustment < 0
          ? ["descriptive relationship is down-ranked for the current intent"]
          : []),
        ...(relatedImpacts.flatMap(x => x?._attention?.reasons || []))
      ]).slice(0, 7),
      claim_rule:
        "Pathway organizes existing graph/impact context only; it does not establish new causality."
    });
  }

  const sorted = pathways.sort((a, b) => b.score - a.score);
  const selected = [];
  const seenPairs = new Set();
  const coverageCounts = new Map();

  while (sorted.length && selected.length < budget) {
    let bestIndex = -1;
    let bestAdjusted = -Infinity;

    for (let i = 0; i < sorted.length; i += 1) {
      const pathway = sorted[i];
      const pair = [pathway.from.entity_id, pathway.to.entity_id].sort().join("|");
      if (seenPairs.has(pair)) continue;

      const coverageKey = pathwayCoverageKey(pathway, infoMap);
      const coveragePenalty = n(coverageCounts.get(coverageKey), 0) * 7;

      const sameDestinationPenalty = selected.some(
        x => x.to.entity_id === pathway.to.entity_id
      ) ? 10 : 0;

      const sameRelationshipTypePenalty = selected.filter(
        x => clean(x.relationship.type).toUpperCase() ===
             clean(pathway.relationship.type).toUpperCase()
      ).length * 3;

      const adjusted =
        pathway.score -
        coveragePenalty -
        sameDestinationPenalty -
        sameRelationshipTypePenalty;

      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) break;

    const [winner] = sorted.splice(bestIndex, 1);
    const pair = [winner.from.entity_id, winner.to.entity_id].sort().join("|");
    const coverageKey = pathwayCoverageKey(winner, infoMap);

    seenPairs.add(pair);
    coverageCounts.set(coverageKey, n(coverageCounts.get(coverageKey), 0) + 1);

    selected.push({
      ...winner,
      diversity_adjusted_score: Math.round(bestAdjusted * 100) / 100
    });
  }

  return selected;
}

/* -------------------------------------------------------------------------- */
/* Main attention layer                                                       */
/* -------------------------------------------------------------------------- */

function rankCollection(rows, type, query, budget) {
  const scored = (rows || [])
    .slice(0, MAX_DISCOVERY_ITEMS)
    .map(row => scoreItem(row, type, query));

  const { selected, suppressed } = diversitySelect(scored, budget);

  return {
    discovered: scored.length,
    active: selected.length,
    available_for_expansion: suppressed.length,
    selected,
    suppressed
  };
}

function runCosmosAttention(core, options = {}) {
  if (!core || typeof core !== "object") {
    throw new Error("Cosmos Attention requires a Cosmos Core JSON payload.");
  }

  const budget = {
    ...DEFAULT_BUDGET,
    ...(options.budget || {})
  };

  const query = buildQueryContext(core);
  const ctx = core.selected_context || {};

  const ranked = {
    systems: rankCollection(ctx.systems || [], "system", query, budget.systems),
    attention: rankCollection(ctx.attention || [], "attention", query, budget.attention),
    patterns: rankCollection(ctx.patterns || [], "pattern", query, budget.patterns),
    emergences: rankCollection(ctx.emergences || [], "emergence", query, budget.emergences),
    impacts: rankCollection(ctx.impacts || [], "impact", query, budget.impacts),
    developments: rankCollection(ctx.developments || [], "development", query, budget.developments),
    relationships: rankCollection(ctx.relationships || [], "relationship", query, budget.relationships),
    entities: rankCollection(ctx.entities || [], "entity", query, budget.entities)
  };

  const activeContext = {
    attention_center: (core?.resolution?.starting_points || []).map(x => ({
      entity_id: x.entity_id,
      name: x.name,
      type: x.type,
      resolution_score: x.score
    })),
    systems: ranked.systems.selected,
    attention: ranked.attention.selected,
    patterns: ranked.patterns.selected,
    emergences: ranked.emergences.selected,
    impacts: ranked.impacts.selected,
    developments: ranked.developments.selected,
    relationships: ranked.relationships.selected,
    entities: ranked.entities.selected
  };

  const primaryPathways = buildPrimaryPathways(
    core,
    ranked.relationships,
    activeContext,
    query,
    budget.primary_pathways
  );

  const expandableContext = {
    next_entities: ranked.entities.suppressed.slice(0, 20),
    next_relationships: ranked.relationships.suppressed.slice(0, 20),
    next_patterns: ranked.patterns.suppressed.slice(0, 20),
    next_emergences: ranked.emergences.suppressed.slice(0, 20),
    next_impacts: ranked.impacts.suppressed.slice(0, 20)
  };

  const suppressedCount = {};
  for (const [key, value] of Object.entries(ranked)) {
    suppressedCount[key] = {
      discovered: value.discovered,
      active: value.active,
      available_for_expansion: value.available_for_expansion
    };
  }

  return {
    schema_version: "0.2",
    generated_at: nowIso(),
    status: "attention_resolved",

    source_core: {
      schema_version: core.schema_version || null,
      generated_at: core.generated_at || null,
      status: core.status || null,
      knowledge_state: core.knowledge_state || null
    },

    input: core.input || {},

    active_context: {
      ...activeContext,
      primary_pathways: primaryPathways
    },

    expandable_context: expandableContext,

    attention_state: {
      attention_mode: "infinite_attention",
      principle:
        "Attention may suppress visibility. Attention may never suppress existence.",
      budget,
      suppressed_count: suppressedCount,
      ranking_dimensions: [
        "question_relevance",
        "directness",
        "structural_strength",
        "confidence",
        "temporal_relevance",
        "emergence_novelty",
        "evidence_factor",
        "diversity",
        "relationship_semantics",
        "pathway_resolvability",
        "pathway_coverage"
      ],
      pathway_intelligence: {
        intent_sensitive: true,
        unresolved_entities_excluded_from_primary_pathways: true,
        descriptive_relationships_downranked_for_impact_intent: true,
        diversity_coverage_applied: true
      }
    },

    infinite_state: {
      terminal: false,
      continuation_allowed: true,
      attention_can_move: true,
      underlying_context_preserved: true,
      expandable_entity_ids: uniq([
        ...((core?.navigation?.expandable_entity_ids || [])),
        ...((core?.selected_context?.entities || []).map(x => x.entity_id))
      ])
    },

    safeguards: {
      creates_new_causal_claims: false,
      upgrades_evidence_quality: false,
      forecast_generated: false,
      sector_whitelist_present: false,
      visibility_suppression_only: true,
      existence_preserved: true,
      primary_pathways_require_resolved_entities: true,
      descriptive_relationships_are_intent_weighted: true,
      source_lineage_preserved: true
    }
  };
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--input" && args[i + 1]) {
      options.input_file = args[++i];
      continue;
    }

    if (arg === "--out" && args[i + 1]) {
      options.output_file = args[++i];
      continue;
    }

    if (arg === "--budget" && args[i + 1]) {
      options.budget_file = args[++i];
      continue;
    }
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv);

  if (!options.input_file) {
    throw new Error(
      "Usage: node scripts/cosmos_attention.cjs --input <core.json> [--out <attention.json>] [--budget <budget.json>]"
    );
  }

  const core = readJson(options.input_file);
  const budget = options.budget_file ? readJson(options.budget_file) : undefined;

  const output = runCosmosAttention(core, { budget });
  const serialized = JSON.stringify(output, null, 2);

  if (options.output_file) {
    writeJson(options.output_file, output);
    console.log(`Cosmos Attention output written to ${options.output_file}`);
  } else {
    process.stdout.write(serialized + "\n");
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runCosmosAttention,
  scoreItem,
  diversitySelect
};
