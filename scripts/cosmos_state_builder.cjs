#!/usr/bin/env node
/**
 * PTD Today / Cosmos — Cosmos State Builder v0.1
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
    row.origin_entity_id,
    row.source_entity_id,
    row.focus_entity?.entity_id,
    row.affected_entity_id,
    row.target_entity_id,
    row.affected_entity?.entity_id,
    ...(row.path?.entity_ids || []),
    ...(row.entity_ids || [])
  ]);
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
    .map(row => ({
      impact_id:
        row.impact_id ||
        row.id ||
        stableId("impact", [
          row.origin_entity_id,
          row.affected_entity_id,
          row.title
        ]),
      title: row.title || row.description || null,
      impact_score: round(impactScore(row), 2),
      confidence_class: row.confidence_class || null,
      evidence_quality_score: n(row.evidence_quality_score),
      evidence_quality_label:
        row.evidence_quality_label ||
        evidenceLabel(row.evidence_quality_score),
      polarity: row.polarity || row.direction || null,
      origin_entity_id:
        row.origin_entity_id ||
        row.source_entity_id ||
        row.focus_entity?.entity_id ||
        null,
      affected_entity_id:
        row.affected_entity_id ||
        row.target_entity_id ||
        row.affected_entity?.entity_id ||
        null,
      entity_ids: impactEntityIds(row),
      supporting_relationship_ids:
        row.supporting_relationship_ids ||
        row.relationship_ids ||
        [],
      supporting_development_ids:
        row.supporting_development_ids ||
        row.evidence?.development_ids ||
        [],
      raw_ref: row.impact_id || row.id || null
    }))
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

  const attentionTop = attention
    .sort((a, b) =>
      b.attention_score - a.attention_score ||
      evidenceRank(b.evidence_quality_label) - evidenceRank(a.evidence_quality_label) ||
      clean(a.ref_id).localeCompare(clean(b.ref_id))
    )
    .slice(0, LIMITS.attention);

  const output = {
    schema_version: "0.1",
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
      signals: attentionTop
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
      attention_retained: attentionTop.length
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
  console.log(`Output:          ${path.relative(ROOT, FILES.output)}`);
}

try {
  main();
} catch (error) {
  console.error("\nCosmos State Builder failed:");
  console.error(error?.stack || error?.message || error);
  process.exit(1);
}
