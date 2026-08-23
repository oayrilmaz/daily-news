#!/usr/bin/env node
/**
 * PTD Today / Cosmos — Cosmos State Builder v0.4
 *
 * Deterministic, read-only synthesis layer above:
 *   State → Delta → Impact → Pattern → Emergence → Developments/Relationships
 *
 * No OpenAI calls.
 *
 * Inputs:
 *   knowledge/cosmos/state-current.json
 *   knowledge/cosmos/delta-current.json
 *   knowledge/cosmos/impact-current.json
 *   knowledge/cosmos/patterns-current.json
 *   knowledge/cosmos/emergence-current.json
 *   knowledge/developments.json
 *   knowledge/relationships.json
 *
 * Outputs:
 *   knowledge/cosmos/cosmos-state-current.json
 *   knowledge/cosmos/cosmos-state-history/YYYY-MM-DD.json
 *
 * Design principle:
 *   Cosmos State does not invent new claims.
 *   It ranks, connects, and exposes the strongest already-derived intelligence
 *   while preserving evidence quality, uncertainty, causality safeguards,
 *   and lineage back to developments and relationships.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.cwd();
const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || "knowledge";
const COSMOS_DIR = path.join(ROOT, KNOWLEDGE_DIR, "cosmos");
const HISTORY_DIR = path.join(COSMOS_DIR, "cosmos-state-history");

const FILES = {
  state: path.join(COSMOS_DIR, "state-current.json"),
  delta: path.join(COSMOS_DIR, "delta-current.json"),
  impact: path.join(COSMOS_DIR, "impact-current.json"),
  patterns: path.join(COSMOS_DIR, "patterns-current.json"),
  emergence: path.join(COSMOS_DIR, "emergence-current.json"),
  developments: path.join(ROOT, KNOWLEDGE_DIR, "developments.json"),
  relationships: path.join(ROOT, KNOWLEDGE_DIR, "relationships.json"),
  output: path.join(COSMOS_DIR, "cosmos-state-current.json")
};

const LIMITS = {
  attention: Number(process.env.COSMOS_STATE_ATTENTION_LIMIT || 20),
  entities: Number(process.env.COSMOS_STATE_ENTITY_LIMIT || 40),
  relationships: Number(process.env.COSMOS_STATE_RELATIONSHIP_LIMIT || 50),
  developments: Number(process.env.COSMOS_STATE_DEVELOPMENT_LIMIT || 30),
  impacts: Number(process.env.COSMOS_STATE_IMPACT_LIMIT || 30),
  patterns: Number(process.env.COSMOS_STATE_PATTERN_LIMIT || 30),
  emergences: Number(process.env.COSMOS_STATE_EMERGENCE_LIMIT || 20)
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

function n(value, fallback = 0) {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}

function round(value, digits = 2) {
  const m = 10 ** digits;
  return Math.round(n(value) * m) / m;
}

function clean(value) {
  return String(value ?? "").trim();
}

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function stableId(prefix, parts) {
  const hash = crypto
    .createHash("sha256")
    .update(parts.map(x => String(x ?? "")).join("::"))
    .digest("hex")
    .slice(0, 16);
  return `${prefix}_${hash}`;
}

function maxDate(...values) {
  const good = values
    .flat()
    .filter(Boolean)
    .map(String)
    .filter(x => /^\d{4}-\d{2}-\d{2}/.test(x))
    .sort();
  return good.length ? good[good.length - 1].slice(0, 10) : null;
}

function evidenceLabel(score) {
  score = n(score);
  return score >= 75 ? "strong" : score >= 50 ? "moderate" : score > 0 ? "weak" : "unknown";
}

function evidenceRank(label) {
  return ({strong: 4, moderate: 3, weak: 2, unknown: 1})[label] || 0;
}

function scoreEntity(e) {
  return (
    n(e.importance_score) * 0.55 +
    Math.min(100, n(e.relationship_degree) * 1.6) * 0.25 +
    Math.min(100, n(e.linked_development_count) * 1.4) * 0.20
  );
}

function scoreRelationship(r) {
  const evidenceBoost = Math.min(12, Math.log2(1 + n(r.evidence_count)) * 4);
  const sourceBoost = (r.source_ids || []).length > 0 ? 8 : 0;
  return Math.min(
    100,
    n(r.strength) * 0.58 +
    n(r.confidence) * 100 * 0.26 +
    evidenceBoost +
    sourceBoost
  );
}

function scoreDevelopment(d) {
  const importance =
    n(d.importance_score,
      n(d.importance,
        n(d.priority_score, 0)));

  const confidence =
    n(d.confidence_score,
      n(d.confidence, 0));

  const sourceCount =
    (d.evidence?.source_ids || d.source_ids || []).length;

  const sourceBoost = sourceCount > 0 ? 10 : 0;

  return Math.min(
    100,
    importance * 0.58 +
    confidence * 100 * 0.32 +
    sourceBoost
  );
}

function getImpactRows(payload) {
  return (
    payload?.impacts ||
    payload?.impact_signals ||
    payload?.results ||
    []
  );
}

function impactScore(row) {
  return n(
    row.impact_score,
    n(row.score,
      n(row.structural_strength_score, 0))
  );
}

function impactEntityIds(row) {
  return uniq([
    row.origin?.entity_id,
    row.origin_entity_id,
    row.source_entity_id,
    row.focus_entity?.entity_id,
    row.affected?.entity_id,
    row.affected_entity_id,
    row.target_entity_id,
    row.affected_entity?.entity_id,
    ...(row.path?.entity_ids || []),
    ...(row.entity_ids || [])
  ]);
}

function impactRelationshipIds(row) {
  return uniq([
    ...(row.supporting_relationship_ids || []),
    ...(row.relationship_ids || []),
    ...((row.path?.steps || []).map(step => step?.relationship_id))
  ]);
}

function impactDevelopmentIds(row) {
  return uniq([
    ...(row.evidence_development_ids || []),
    ...(row.seed_evidence_development_ids || []),
    ...(row.supporting_development_ids || []),
    ...(row.evidence?.development_ids || [])
  ]);
}

function impactEvidence(row) {
  const modes = uniq(row.evidence_modes || []);
  const hasAiScenario = modes.includes("ai_scenario");
  const hasNonScenario = modes.some(mode => mode && mode !== "ai_scenario");

  // Preserve upstream epistemic status. We do not upgrade scenario-only
  // evidence merely because a graph path is structurally strong.
  let score = 0;
  let label = "unknown";

  if (hasNonScenario) {
    score = 60;
    label = "moderate";
  } else if (hasAiScenario) {
    score = 35;
    label = "weak";
  }

  return {
    evidence_modes: modes,
    evidence_quality_score: score,
    evidence_quality_label: label
  };
}

function impactTitle(row) {
  const origin = clean(row.origin?.name || row.origin_name);
  const affected = clean(row.affected?.name || row.affected_name);
  if (origin && affected) {
    return `${origin} → ${affected} propagated impact`;
  }
  if (Array.isArray(row.path?.entity_names) && row.path.entity_names.length >= 2) {
    return `${row.path.entity_names[0]} → ${row.path.entity_names[row.path.entity_names.length - 1]} propagated impact`;
  }
  return row.title || row.description || null;
}

function developmentEvidence(d) {
  const mode =
    d?.evidence?.mode ||
    d?.evidence_mode ||
    "unknown";

  const status =
    d?.evidence?.status ||
    d?.evidence_status ||
    "unknown";

  const sources =
    d?.evidence?.source_ids ||
    d?.source_ids ||
    [];

  let quality = 0;

  if (sources.length > 0) quality = 75;
  else if (mode === "ai_scenario") quality = 35;
  else if (status === "verified") quality = 80;
  else if (status === "partially_verified") quality = 55;
  else quality = 25;

  return {
    mode,
    status,
    source_count: sources.length,
    evidence_quality_score: quality,
    evidence_quality_label: evidenceLabel(quality)
  };
}

function compactDevelopment(d) {
  const ev = developmentEvidence(d);
  return {
    development_id: d.development_id,
    created_at: d.created_at || null,
    date_utc: d.date_utc || null,
    title: d.title || null,
    summary: d.summary || d.lede || null,
    why_it_matters: d.why_it_matters || null,
    category: d.category || null,
    region: d.region || null,
    countries: d.countries || [],
    confidence_score: n(d.confidence_score, n(d.confidence, 0)),
    importance_score: n(d.importance_score, n(d.importance, 0)),
    evidence: ev,
    entity_ids: uniq(
      (d.entities || []).map(x => x?.entity_id).filter(Boolean)
    ),
    relationship_ids: uniq(
      (d.relationships || []).map(x => x?.relationship_id).filter(Boolean)
    )
  };
}

function buildAdjacency(relationships) {
  const adjacency = new Map();

  function add(a, b) {
    if (!a || !b || a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a).add(b);
  }

  for (const r of relationships || []) {
    if (!r || r.status === "inactive") continue;
    if (n(r.strength) < 60 || n(r.confidence) < 0.60) continue;
    add(r.from_entity_id, r.to_entity_id);
    add(r.to_entity_id, r.from_entity_id);
  }

  return adjacency;
}

function graphAdjacencyScore(aIds, bIds, adjacency) {
  const A = uniq(aIds || []);
  const B = uniq(bIds || []);
  if (!A.length || !B.length) return 0;

  let links = 0;
  for (const a of A) {
    const neighbors = adjacency.get(a);
    if (!neighbors) continue;
    for (const b of B) {
      if (neighbors.has(b)) links += 1;
    }
  }

  return links / Math.max(1, Math.min(A.length, B.length));
}

function compactRelationship(r) {
  const sourceCount = (r.source_ids || []).length;
  const eq = sourceCount > 0 ? 75 : (r.evidence_mode === "ai_scenario" ? 35 : 25);

  return {
    relationship_id: r.relationship_id,
    from_entity_id: r.from_entity_id,
    to_entity_id: r.to_entity_id,
    relationship_type: r.relationship_type,
    label: r.label || null,
    explanation: r.explanation || null,
    strength: n(r.strength),
    confidence: n(r.confidence),
    evidence_mode: r.evidence_mode || "unknown",
    evidence_count: n(r.evidence_count),
    source_count: sourceCount,
    evidence_quality_score: eq,
    evidence_quality_label: evidenceLabel(eq),
    evidence_development_ids: r.evidence_development_ids || [],
    status: r.status || null,
    version: n(r.version, 1),
    first_seen_at: r.first_seen_at || null,
    last_seen_at: r.last_seen_at || null
  };
}

function main() {
  const state = readJson(FILES.state);
  const delta = readJson(FILES.delta);
  const impact = readJson(FILES.impact);
  const patterns = readJson(FILES.patterns);
  const emergence = readJson(FILES.emergence);
  const developments = readJson(FILES.developments);
  const relationships = readJson(FILES.relationships);

  const generatedAt = new Date().toISOString();

  const dateUtc =
    maxDate(
      state.date_utc,
      delta.date_utc,
      impact.date_utc,
      patterns.date_utc,
      emergence.date_utc,
      developments.generated_at,
      relationships.generated_at
    ) || generatedAt.slice(0, 10);

  // state-current.json stores entities as an object keyed by entity_id.
  // Also accept an array for forward/backward compatibility.
  const stateEntities = Array.isArray(state.entities)
    ? state.entities
    : state.entities && typeof state.entities === "object"
      ? Object.values(state.entities)
      : [];

  // Delta files can expose changes in several compatible shapes.
  // Normalize all supported shapes into one array before indexing.
  const deltaRows = [
    ...(Array.isArray(delta.entities) ? delta.entities : []),
    ...(Array.isArray(delta.entity_changes) ? delta.entity_changes : []),
    ...(Array.isArray(delta.changes?.entities) ? delta.changes.entities : []),
    ...(Array.isArray(delta.added_entities) ? delta.added_entities : []),
    ...(Array.isArray(delta.changed_entities) ? delta.changed_entities : []),
    ...(Array.isArray(delta.removed_entities) ? delta.removed_entities : [])
  ];

  const deltaByEntity = new Map();
  for (const row of deltaRows) {
    const id =
      row.entity_id ||
      row.current?.entity_id ||
      row.after?.entity_id ||
      row.before?.entity_id;
    if (id) deltaByEntity.set(id, row);
  }

  const rankedEntities = stateEntities
    .map(e => {
      const d = deltaByEntity.get(e.entity_id) || null;
      return {
        entity_id: e.entity_id,
        name: e.name,
        type: e.type || null,
        lifecycle_status: e.lifecycle_status || null,
        importance_score: n(e.importance_score),
        momentum_score: Number.isFinite(Number(e.momentum_score))
          ? Number(e.momentum_score)
          : null,
        momentum_status: e.momentum_status || null,
        relationship_degree: n(e.relationship_degree),
        linked_development_count: n(e.linked_development_count),
        first_seen_at: e.first_seen_at || null,
        last_seen_at: e.last_seen_at || null,
        current_attention_score: round(scoreEntity(e), 2),
        delta: d
      };
    })
    .sort((a, b) =>
      b.current_attention_score - a.current_attention_score ||
      clean(a.name).localeCompare(clean(b.name))
    )
    .slice(0, LIMITS.entities);

  const rankedRelationships = (relationships.relationships || [])
    .filter(r => r && r.status !== "inactive")
    .map(r => ({
      ...compactRelationship(r),
      cosmos_relationship_score: round(scoreRelationship(r), 2)
    }))
    .sort((a, b) =>
      b.cosmos_relationship_score - a.cosmos_relationship_score ||
      clean(a.relationship_id).localeCompare(clean(b.relationship_id))
    )
    .slice(0, LIMITS.relationships);

  const rankedDevelopments = (developments.developments || [])
    .map(d => ({
      ...compactDevelopment(d),
      cosmos_development_score: round(scoreDevelopment(d), 2)
    }))
    .sort((a, b) =>
      b.cosmos_development_score - a.cosmos_development_score ||
      clean(b.created_at).localeCompare(clean(a.created_at))
    )
    .slice(0, LIMITS.developments);

  const rankedImpacts = getImpactRows(impact)
    .map(row => {
      const ev = impactEvidence(row);
      return {
        impact_id:
          row.impact_id ||
          row.id ||
          stableId("impact", [
            row.origin?.entity_id || row.origin_entity_id,
            row.affected?.entity_id || row.affected_entity_id,
            row.path?.entity_ids?.join(">")
          ]),
        title: impactTitle(row),
        impact_score: round(impactScore(row), 2),
        reasoning_mode: row.reasoning_mode || null,
        inference_class: row.inference_class || null,
        propagation_depth: Number.isInteger(row.propagation_depth)
          ? row.propagation_depth
          : null,
        direct: typeof row.direct === "boolean" ? row.direct : null,
        seed_kind: row.seed_kind || null,
        seed_reason: row.seed_reason || null,
        seed_significance: row.seed_significance || null,
        seed_significance_score: n(row.seed_significance_score),
        average_relationship_confidence: n(row.average_relationship_confidence),
        cumulative_path_strength: n(row.cumulative_path_strength),
        evidence_count: n(row.evidence_count),
        evidence_modes: ev.evidence_modes,
        evidence_quality_score: ev.evidence_quality_score,
        evidence_quality_label: ev.evidence_quality_label,
        effect_polarity: row.effect_polarity || row.polarity || row.direction || null,
        origin: row.origin || null,
        affected: row.affected || null,
        origin_entity_id:
          row.origin?.entity_id ||
          row.origin_entity_id ||
          row.source_entity_id ||
          row.focus_entity?.entity_id ||
          null,
        affected_entity_id:
          row.affected?.entity_id ||
          row.affected_entity_id ||
          row.target_entity_id ||
          row.affected_entity?.entity_id ||
          null,
        entity_ids: impactEntityIds(row),
        entity_names: row.path?.entity_names || [],
        supporting_relationship_ids: impactRelationshipIds(row),
        supporting_development_ids: impactDevelopmentIds(row),
        seed_evidence_development_ids: row.seed_evidence_development_ids || [],
        path: row.path || null,
        raw_ref: row.impact_id || row.id || null
      };
    })
    .sort((a, b) => b.impact_score - a.impact_score)
    .slice(0, LIMITS.impacts);

  const rankedPatterns = (patterns.patterns || [])
    .map(p => ({
      pattern_id: p.pattern_id,
      pattern_family: p.pattern_family,
      title: p.title,
      description: p.description,
      pattern_score: n(p.pattern_score),
      structural_strength_score: n(p.structural_strength_score),
      evidence_quality_score: n(p.evidence_quality_score),
      evidence_quality_label:
        p.evidence_quality_label ||
        evidenceLabel(p.evidence_quality_score),
      confidence_class: p.confidence_class || null,
      focus_entity: p.focus_entity || null,
      supporting_entity_ids: uniq(
        (p.supporting_entities || []).map(x => x?.entity_id)
      ),
      supporting_impact_ids: p.supporting_impact_ids || [],
      supporting_relationship_ids: p.supporting_relationship_ids || [],
      supporting_development_ids: p.evidence?.development_ids || [],
      persistence: p.persistence || null
    }))
    .sort((a, b) =>
      b.pattern_score - a.pattern_score ||
      b.structural_strength_score - a.structural_strength_score
    )
    .slice(0, LIMITS.patterns);

  const rankedEmergences = (emergence.emergences || [])
    .map(e => ({
      emergence_id: e.emergence_id,
      emergence_family: e.emergence_family,
      title: e.title,
      description: e.description,
      emergence_score: n(e.emergence_score),
      structural_strength_score: n(e.structural_strength_score),
      evidence_quality_score: n(e.evidence_quality_score),
      evidence_quality_label:
        e.evidence_quality_label ||
        evidenceLabel(e.evidence_quality_score),
      confidence_class: e.confidence_class || null,
      pattern_families: e.pattern_families || [],
      supporting_pattern_ids: e.supporting_pattern_ids || [],
      focus_entities: e.focus_entities || [],
      shared_entities: e.shared_entities || [],
      supporting_impact_ids: e.supporting_impact_ids || [],
      supporting_relationship_ids: e.supporting_relationship_ids || [],
      supporting_development_ids: e.supporting_development_ids || [],
      persistence: e.persistence || null,
      interpretation: e.interpretation || null
    }))
    .sort((a, b) => b.emergence_score - a.emergence_score)
    .slice(0, LIMITS.emergences);

  // Attention layer: rank already-derived intelligence, never invent a new claim.
  const attention = [];

  for (const e of rankedEmergences) {
    attention.push({
      attention_id: stableId("attn", ["emergence", e.emergence_id]),
      attention_type: "emergence",
      ref_id: e.emergence_id,
      title: e.title,
      attention_score: round(
        e.emergence_score * 0.72 +
        e.structural_strength_score * 0.18 +
        e.evidence_quality_score * 0.10,
        2
      ),
      structural_score: e.emergence_score,
      evidence_quality_score: e.evidence_quality_score,
      evidence_quality_label: e.evidence_quality_label,
      confidence_class: e.confidence_class,
      persistence: e.persistence,
      entity_ids: uniq([
        ...(e.focus_entities || []).map(x => x?.entity_id),
        ...(e.shared_entities || []).map(x => x?.entity_id)
      ]),
      supporting_development_ids: e.supporting_development_ids,
      supporting_relationship_ids: e.supporting_relationship_ids,
      supporting_pattern_ids: e.supporting_pattern_ids,
      claim_class: "higher_order_structural_signal"
    });
  }

  for (const p of rankedPatterns) {
    attention.push({
      attention_id: stableId("attn", ["pattern", p.pattern_id]),
      attention_type: "pattern",
      ref_id: p.pattern_id,
      title: p.title,
      attention_score: round(
        p.pattern_score * 0.72 +
        p.structural_strength_score * 0.18 +
        p.evidence_quality_score * 0.10,
        2
      ),
      structural_score: p.pattern_score,
      evidence_quality_score: p.evidence_quality_score,
      evidence_quality_label: p.evidence_quality_label,
      confidence_class: p.confidence_class,
      persistence: p.persistence,
      entity_ids: uniq([
        p.focus_entity?.entity_id,
        ...(p.supporting_entity_ids || [])
      ]),
      supporting_development_ids: p.supporting_development_ids,
      supporting_relationship_ids: p.supporting_relationship_ids,
      supporting_impact_ids: p.supporting_impact_ids,
      claim_class: "structural_pattern_signal"
    });
  }

  for (const i of rankedImpacts) {
    attention.push({
      attention_id: stableId("attn", ["impact", i.impact_id]),
      attention_type: "impact",
      ref_id: i.impact_id,
      title: i.title,
      attention_score: round(
        i.impact_score * 0.88 +
        i.evidence_quality_score * 0.12,
        2
      ),
      structural_score: i.impact_score,
      evidence_quality_score: i.evidence_quality_score,
      evidence_quality_label: i.evidence_quality_label,
      confidence_class: i.confidence_class,
      entity_ids: i.entity_ids,
      supporting_development_ids: i.supporting_development_ids,
      supporting_relationship_ids: i.supporting_relationship_ids,
      claim_class: "propagated_impact_signal"
    });
  }

  const attentionSorted = attention
    .sort((a, b) =>
      b.attention_score - a.attention_score ||
      evidenceRank(b.evidence_quality_label) - evidenceRank(a.evidence_quality_label) ||
      clean(a.ref_id).localeCompare(clean(b.ref_id))
    );

  // v0.2 attention calibration:
  // prevent one upstream family from consuming the whole attention surface.
  // The quota is a presentation/diversity rule, not a truth or confidence rule.
  const quota = {
    pattern: Math.min(8, LIMITS.attention),
    emergence: Math.min(6, Math.max(0, LIMITS.attention - 8)),
    impact: Math.max(0, LIMITS.attention - 14)
  };

  const byType = {
    pattern: attentionSorted.filter(x => x.attention_type === "pattern"),
    emergence: attentionSorted.filter(x => x.attention_type === "emergence"),
    impact: attentionSorted.filter(x => x.attention_type === "impact")
  };

  const attentionTop = [];
  for (const type of ["pattern", "emergence", "impact"]) {
    attentionTop.push(...byType[type].slice(0, quota[type]));
  }

  // Backfill if one type has fewer available items than its quota.
  if (attentionTop.length < LIMITS.attention) {
    const selectedIds = new Set(attentionTop.map(x => x.attention_id));
    for (const row of attentionSorted) {
      if (attentionTop.length >= LIMITS.attention) break;
      if (!selectedIds.has(row.attention_id)) {
        attentionTop.push(row);
        selectedIds.add(row.attention_id);
      }
    }
  }

  attentionTop.sort((a, b) =>
    b.attention_score - a.attention_score ||
    evidenceRank(b.evidence_quality_label) - evidenceRank(a.evidence_quality_label) ||
    clean(a.ref_id).localeCompare(clean(b.ref_id))
  );

  function jaccard(a, b) {
    const A = new Set(a || []);
    const B = new Set(b || []);
    if (!A.size || !B.size) return 0;
    let intersection = 0;
    for (const value of A) {
      if (B.has(value)) intersection += 1;
    }
    return intersection / (A.size + B.size - intersection);
  }

  const adjacency = buildAdjacency(relationships.relationships || []);

  function sharedCount(aIds, bIds) {
    const B = new Set(bIds || []);
    return (aIds || []).filter(id => B.has(id)).length;
  }

  function candidateMatchesAnchor(anchor, candidate) {
    const anchorIds = anchor.entity_ids || [];
    const candidateIds = candidate.entity_ids || [];

    const shared = sharedCount(anchorIds, candidateIds);
    const overlap = jaccard(anchorIds, candidateIds);
    const adjacencyScore = graphAdjacencyScore(anchorIds, candidateIds, adjacency);

    // v0.4 is deliberately NON-TRANSITIVE:
    // every member must qualify directly against the original anchor.
    //
    // Same-family members need meaningful direct overlap.
    if (anchor.attention_type === candidate.attention_type) {
      return shared >= 2 && overlap >= 0.30;
    }

    // Cross-family members may join through:
    //   1) at least two shared anchor entities, or
    //   2) one shared anchor entity + strong graph adjacency, or
    //   3) very strong direct graph adjacency to the anchor.
    if (shared >= 2) return true;
    if (shared >= 1 && adjacencyScore >= 0.25) return true;
    if (adjacencyScore >= 0.60) return true;

    return false;
  }

  function anchorPriority(row) {
    const familyWeight = {
      emergence: 3,
      pattern: 2,
      impact: 1
    }[row.attention_type] || 0;

    return (
      familyWeight * 1000 +
      n(row.attention_score) * 10 +
      n(row.evidence_quality_score)
    );
  }

  // v0.4 bounded systems:
  // - anchors are selected from the strongest Emergence/Pattern signals
  // - candidates qualify ONLY against that anchor, never transitively
  // - overlapping systems are allowed
  // - each system is capped to a compact member set
  // - single-member systems are discarded
  const anchors = attentionTop
    .filter(x => x.attention_type === "emergence" || x.attention_type === "pattern")
    .sort((a, b) =>
      anchorPriority(b) - anchorPriority(a) ||
      clean(a.ref_id).localeCompare(clean(b.ref_id))
    );

  const entityNameById = new Map(
    stateEntities.map(entity => [entity.entity_id, entity.name])
  );

  const proposed = [];

  for (const anchor of anchors) {
    const candidates = attentionTop
      .filter(x => x.attention_id !== anchor.attention_id)
      .filter(x => candidateMatchesAnchor(anchor, x))
      .map(x => {
        const shared = sharedCount(anchor.entity_ids || [], x.entity_ids || []);
        const overlap = jaccard(anchor.entity_ids || [], x.entity_ids || []);
        const adjacencyScore = graphAdjacencyScore(
          anchor.entity_ids || [],
          x.entity_ids || [],
          adjacency
        );

        const crossFamilyBonus =
          x.attention_type !== anchor.attention_type ? 12 : 0;

        const fitScore =
          shared * 18 +
          overlap * 30 +
          adjacencyScore * 25 +
          crossFamilyBonus +
          n(x.attention_score) * 0.15;

        return { row: x, fitScore };
      })
      .sort((a, b) =>
        b.fitScore - a.fitScore ||
        b.row.attention_score - a.row.attention_score
      )
      .slice(0, 7)
      .map(x => x.row);

    const members = [anchor, ...candidates];

    if (members.length < 2) continue;

    const memberTypes = uniq(members.map(x => x.attention_type));
    const entityFrequency = new Map();

    for (const member of members) {
      for (const entityId of member.entity_ids || []) {
        entityFrequency.set(entityId, (entityFrequency.get(entityId) || 0) + 1);
      }
    }

    const topEntityIds = [...entityFrequency.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([id]) => id);

    const topEntityNames = topEntityIds
      .map(id => entityNameById.get(id))
      .filter(Boolean);

    const labelCore =
      topEntityNames.length > 0
        ? topEntityNames.join(" · ")
        : anchor.title || "Connected intelligence";

    const systemScore = round(
      n(anchor.attention_score) * 0.70 +
      Math.min(100, members.length * 12) * 0.15 +
      (memberTypes.length > 1 ? 100 : 60) * 0.15,
      2
    );

    proposed.push({
      cluster_id: stableId(
        "sys",
        [anchor.attention_id, ...members.map(x => x.attention_id).sort()]
      ),
      anchor_attention_id: anchor.attention_id,
      anchor_type: anchor.attention_type,
      anchor_ref_id: anchor.ref_id,
      anchor_title: anchor.title,
      label: `${labelCore} — bounded system`,
      member_count: members.length,
      member_attention_ids: members.map(x => x.attention_id),
      member_types: memberTypes,
      cross_family: memberTypes.length > 1,
      entity_ids: topEntityIds,
      attention_score: systemScore,
      evidence_quality_score: round(
        members.reduce((sum, x) => sum + n(x.evidence_quality_score), 0) /
          Math.max(1, members.length),
        2
      ),
      evidence_quality_label: evidenceLabel(
        members.reduce((sum, x) => sum + n(x.evidence_quality_score), 0) /
          Math.max(1, members.length)
      ),
      interpretation:
        "Bounded system for navigation and synthesis only. Every member qualifies directly against the original anchor through shared entities and/or strong graph adjacency; membership is not transitive. This system does not establish new causality, verification, or forecast."
    });
  }

  // Deduplicate near-identical systems while allowing legitimate overlap.
  // Two systems are considered duplicates only when their member sets overlap heavily.
  const clusters = [];

  for (const candidate of proposed.sort((a, b) =>
    Number(b.cross_family) - Number(a.cross_family) ||
    b.attention_score - a.attention_score ||
    b.member_count - a.member_count
  )) {
    const isDuplicate = clusters.some(existing => {
      const overlap = jaccard(
        existing.member_attention_ids,
        candidate.member_attention_ids
      );
      return overlap >= 0.75;
    });

    if (!isDuplicate) {
      clusters.push(candidate);
    }

    if (clusters.length >= 6) break;
  }

  const output = {
    schema_version: "0.4",
    generated_at: generatedAt,
    date_utc: dateUtc,
    status: "ready",

    methodology: {
      reasoning_mode: "deterministic_cosmos_state_synthesis",
      summary:
        "Cosmos State ranks and links already-derived State, Delta, Impact, Pattern, Emergence, Development and Relationship intelligence. It does not create new causal claims or upgrade evidence quality.",
      no_new_claims: true,
      causality_rule:
        "Causality is inherited from upstream layers and is never strengthened by Cosmos State.",
      evidence_rule:
        "Evidence quality is preserved from upstream intelligence. Structural strength and evidence quality remain separate.",
      attention_rule:
        "Attention score prioritizes structurally important signals while retaining evidence-quality visibility. High attention does not imply verified truth.",
      attention_diversity_rule:
        "The retained attention surface is quota-balanced across Pattern, Emergence and Impact so one upstream family cannot consume every visible slot.",
      overlap_cluster_rule:
        "Attention signals may be grouped into bounded system clusters anchored on strong Emergence or Pattern signals. Every member must qualify directly against the original anchor through shared entities and/or strong graph adjacency; clustering is non-transitive. Cross-family Pattern/Emergence/Impact grouping is preferred, overlapping systems are allowed, single-member systems are discarded, and near-duplicate systems are suppressed. A bounded system is not a new causal, verification or forecasting claim.",
      stale_input_rule:
        "Input dates are exposed in source_freshness so consumers can avoid blending snapshots as though they were contemporaneous."
    },

    source_freshness: {
      state: {
        schema_version: state.schema_version || null,
        date_utc: state.date_utc || null,
        generated_at: state.generated_at || null
      },
      delta: {
        schema_version: delta.schema_version || null,
        date_utc: delta.date_utc || null,
        generated_at: delta.generated_at || null
      },
      impact: {
        schema_version: impact.schema_version || null,
        date_utc: impact.date_utc || null,
        generated_at: impact.generated_at || null
      },
      patterns: {
        schema_version: patterns.schema_version || null,
        date_utc: patterns.date_utc || null,
        generated_at: patterns.generated_at || null
      },
      emergence: {
        schema_version: emergence.schema_version || null,
        date_utc: emergence.date_utc || null,
        generated_at: emergence.generated_at || null
      },
      developments: {
        schema_version: developments.schema_version || null,
        generated_at: developments.generated_at || null,
        development_count: developments.development_count ?? (developments.developments || []).length
      },
      relationships: {
        schema_version: relationships.schema_version || null,
        generated_at: relationships.generated_at || null,
        relationship_count: relationships.relationship_count ?? (relationships.relationships || []).length
      }
    },

    now: {
      entities: rankedEntities,
      developments: rankedDevelopments
    },

    graph: {
      relationships: rankedRelationships
    },

    impact: {
      signals: rankedImpacts
    },

    patterns: {
      signals: rankedPatterns
    },

    emergence: {
      signals: rankedEmergences
    },

    attention: {
      signals: attentionTop,
      clusters
    },

    safeguards: {
      forecast: false,
      causality: "not_established_unless_explicitly_inherited",
      evidence_quality_upgraded: false,
      ai_scenario_present: [
        ...rankedDevelopments.map(x => x.evidence?.mode),
        ...rankedRelationships.map(x => x.evidence_mode)
      ].includes("ai_scenario")
    },

    counts: {
      entities_available: stateEntities.length,
      relationships_available: (relationships.relationships || []).length,
      developments_available: (developments.developments || []).length,
      impacts_available: getImpactRows(impact).length,
      patterns_available: (patterns.patterns || []).length,
      emergences_available: (emergence.emergences || []).length,
      attention_retained: attentionTop.length,
      attention_patterns: attentionTop.filter(x => x.attention_type === "pattern").length,
      attention_emergences: attentionTop.filter(x => x.attention_type === "emergence").length,
      attention_impacts: attentionTop.filter(x => x.attention_type === "impact").length,
      attention_clusters: clusters.length,
      attention_cross_family_clusters: clusters.filter(x => x.cross_family).length,
      attention_cluster_members_max: clusters.length
        ? Math.max(...clusters.map(x => x.member_count))
        : 0
    }
  };

  writeJson(FILES.output, output);
  writeJson(path.join(HISTORY_DIR, `${dateUtc}.json`), output);

  console.log("\n=== PTD Today / Cosmos State Builder ===");
  console.log(`Date:            ${dateUtc}`);
  console.log(`Entities:        ${output.counts.entities_available}`);
  console.log(`Relationships:   ${output.counts.relationships_available}`);
  console.log(`Developments:    ${output.counts.developments_available}`);
  console.log(`Impacts:         ${output.counts.impacts_available}`);
  console.log(`Patterns:        ${output.counts.patterns_available}`);
  console.log(`Emergences:      ${output.counts.emergences_available}`);
  console.log(`Attention:       ${output.counts.attention_retained}`);
  console.log(`  Patterns:      ${output.counts.attention_patterns}`);
  console.log(`  Emergences:    ${output.counts.attention_emergences}`);
  console.log(`  Impacts:       ${output.counts.attention_impacts}`);
  console.log(`Clusters:        ${output.counts.attention_clusters}`);
  console.log(`  Cross-family:  ${output.counts.attention_cross_family_clusters}`);
  console.log(`  Max members:   ${output.counts.attention_cluster_members_max}`);
  console.log(`Output:          ${path.relative(ROOT, FILES.output)}`);
}

try {
  main();
} catch (error) {
  console.error("\nCosmos State Builder failed:");
  console.error(error?.stack || error?.message || error);
  process.exit(1);
}
