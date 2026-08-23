#!/usr/bin/env node
/**
 * PTD Today / Cosmos — Emergence Engine v0.1
 *
 * Deterministic, explainable higher-order synthesis above Pattern Engine v0.2.
 * No OpenAI calls.
 *
 * Input:
 *   knowledge/cosmos/patterns-current.json
 *
 * Optional lineage inputs (read only when present):
 *   knowledge/cosmos/impact-current.json
 *   knowledge/cosmos/delta-current.json
 *   knowledge/cosmos/state-current.json
 *
 * Outputs:
 *   knowledge/cosmos/emergence-current.json
 *   knowledge/cosmos/emergence-history/YYYY-MM-DD.json
 *
 * Core rule:
 *   An emergence candidate must be supported by MULTIPLE patterns and MULTIPLE
 *   pattern families. A single strong pattern is never promoted into emergence.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.cwd();
const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || 'knowledge';
const COSMOS_DIR = path.join(ROOT, KNOWLEDGE_DIR, 'cosmos');
const HISTORY_DIR = path.join(COSMOS_DIR, 'emergence-history');

const FILES = {
  patterns: path.join(COSMOS_DIR, 'patterns-current.json'),
  impact: path.join(COSMOS_DIR, 'impact-current.json'),
  delta: path.join(COSMOS_DIR, 'delta-current.json'),
  state: path.join(COSMOS_DIR, 'state-current.json'),
  output: path.join(COSMOS_DIR, 'emergence-current.json')
};

function num(value, fallback = 0, min = -Infinity, max = Infinity) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clean(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function round(value, digits = 2) {
  const m = 10 ** digits;
  return Math.round(Number(value) * m) / m;
}

function stableId(prefix, parts) {
  const hash = crypto
    .createHash('sha256')
    .update(parts.map(x => String(x ?? '')).join('::'))
    .digest('hex')
    .slice(0, 16);
  return `${prefix}_${hash}`;
}

function readJson(file, required = true) {
  if (!fs.existsSync(file)) {
    if (required) {
      throw new Error(`Missing required file: ${path.relative(ROOT, file)}`);
    }
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const MIN_PATTERN_SCORE = num(
  process.env.COSMOS_EMERGENCE_MIN_PATTERN_SCORE,
  55,
  0,
  100
);

const MIN_PATTERNS = Math.round(num(
  process.env.COSMOS_EMERGENCE_MIN_PATTERNS,
  3,
  2,
  20
));

const MIN_FAMILIES = Math.round(num(
  process.env.COSMOS_EMERGENCE_MIN_FAMILIES,
  2,
  2,
  4
));

const MIN_SHARED_ENTITIES = Math.round(num(
  process.env.COSMOS_EMERGENCE_MIN_SHARED_ENTITIES,
  1,
  1,
  20
));

const MIN_CLUSTER_SCORE = num(
  process.env.COSMOS_EMERGENCE_MIN_SCORE,
  50,
  0,
  100
);

const MAX_RESULTS = Math.round(num(
  process.env.COSMOS_EMERGENCE_MAX_RESULTS,
  40,
  5,
  200
));

const PERSISTENCE_MIN_HISTORY_DAYS = Math.round(num(
  process.env.COSMOS_EMERGENCE_PERSISTENCE_MIN_DAYS,
  3,
  2,
  30
));

const ALLOWED_PATTERN_FAMILIES = new Set([
  'impact_convergence',
  'evidence_reinforcement',
  'structural_acceleration',
  'cross_domain_coupling'
]);

/* -------------------------------------------------------------------------- */
/* Pattern helpers                                                            */
/* -------------------------------------------------------------------------- */

function compactEntity(entity) {
  if (!entity || typeof entity !== 'object') return null;
  return {
    entity_id: entity.entity_id || null,
    name: entity.name || entity.entity_id || null,
    type: entity.type || null,
    lifecycle_status: entity.lifecycle_status || null,
    importance_score:
      Number.isFinite(Number(entity.importance_score))
        ? Number(entity.importance_score)
        : null
  };
}

function patternEntityIds(pattern) {
  return unique([
    pattern?.focus_entity?.entity_id,
    ...(pattern?.supporting_entities || []).map(x => x?.entity_id)
  ]);
}

function patternFamilies(patterns) {
  return unique(patterns.map(p => p?.pattern_family));
}

function average(values) {
  const rows = (values || []).map(Number).filter(Number.isFinite);
  if (!rows.length) return 0;
  return rows.reduce((a, b) => a + b, 0) / rows.length;
}

function evidenceQualityScore(patterns) {
  if (!patterns.length) return 0;

  // Conservative by design: higher-order reasoning cannot improve weak evidence.
  // We use a weighted average, but cap the result at the strongest underlying
  // pattern's evidence score.
  const weighted = patterns.map(p => {
    const weight = Math.max(1, num(p?.pattern_score, 0));
    return {
      weight,
      evidence: num(p?.evidence_quality_score, 0)
    };
  });

  const sumWeight = weighted.reduce((s, x) => s + x.weight, 0);
  const avg = sumWeight
    ? weighted.reduce((s, x) => s + x.evidence * x.weight, 0) / sumWeight
    : 0;

  const maxUnderlying = Math.max(
    0,
    ...patterns.map(p => num(p?.evidence_quality_score, 0))
  );

  return round(Math.min(avg, maxUnderlying), 1);
}

function evidenceQualityLabel(score) {
  return score >= 75
    ? 'strong'
    : score >= 50
      ? 'moderate'
      : score > 0
        ? 'weak'
        : 'unknown';
}

function overlapCount(a, b) {
  const bSet = new Set(b);
  let count = 0;
  for (const x of a) if (bSet.has(x)) count += 1;
  return count;
}

function jaccard(a, b) {
  const aa = new Set(a);
  const bb = new Set(b);
  const union = new Set([...aa, ...bb]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const x of aa) if (bb.has(x)) intersection += 1;
  return intersection / union.size;
}

/* -------------------------------------------------------------------------- */
/* Candidate pattern filtering                                                */
/* -------------------------------------------------------------------------- */

function candidatePatterns(payload) {
  return (payload?.patterns || [])
    .filter(p =>
      p &&
      ALLOWED_PATTERN_FAMILIES.has(p.pattern_family) &&
      num(p.pattern_score, 0) >= MIN_PATTERN_SCORE
    )
    .sort((a, b) =>
      num(b.pattern_score, 0) - num(a.pattern_score, 0) ||
      clean(a.pattern_id).localeCompare(clean(b.pattern_id))
    );
}

/* -------------------------------------------------------------------------- */
/* Build pattern-overlap graph                                                */
/* -------------------------------------------------------------------------- */

function buildPatternGraph(patterns) {
  const entityIdsByPattern = new Map(
    patterns.map(p => [p.pattern_id, patternEntityIds(p)])
  );

  const adjacency = new Map(
    patterns.map(p => [p.pattern_id, new Set()])
  );

  const edges = [];

  for (let i = 0; i < patterns.length; i++) {
    for (let j = i + 1; j < patterns.length; j++) {
      const a = patterns[i];
      const b = patterns[j];

      // Same-family-only overlap is not sufficient to create emergence.
      if (a.pattern_family === b.pattern_family) continue;

      const aIds = entityIdsByPattern.get(a.pattern_id) || [];
      const bIds = entityIdsByPattern.get(b.pattern_id) || [];
      const shared = overlapCount(aIds, bIds);

      if (shared < MIN_SHARED_ENTITIES) continue;

      const jac = jaccard(aIds, bIds);

      // Stronger when focus entities directly cross-support one another.
      const directFocusBridge =
        Boolean(a?.focus_entity?.entity_id) &&
        Boolean(b?.focus_entity?.entity_id) &&
        (
          aIds.includes(b.focus_entity.entity_id) ||
          bIds.includes(a.focus_entity.entity_id)
        );

      const edgeStrength = Math.min(
        100,
        shared * 18 +
        jac * 35 +
        (directFocusBridge ? 20 : 0)
      );

      adjacency.get(a.pattern_id).add(b.pattern_id);
      adjacency.get(b.pattern_id).add(a.pattern_id);

      edges.push({
        from_pattern_id: a.pattern_id,
        to_pattern_id: b.pattern_id,
        shared_entity_count: shared,
        entity_jaccard: round(jac, 3),
        direct_focus_bridge: directFocusBridge,
        edge_strength: round(edgeStrength, 2)
      });
    }
  }

  return { adjacency, edges, entityIdsByPattern };
}

/* -------------------------------------------------------------------------- */
/* Connected components                                                       */
/* -------------------------------------------------------------------------- */

function connectedComponents(patterns, adjacency) {
  const byId = new Map(patterns.map(p => [p.pattern_id, p]));
  const seen = new Set();
  const components = [];

  for (const p of patterns) {
    if (seen.has(p.pattern_id)) continue;

    const queue = [p.pattern_id];
    const ids = [];
    seen.add(p.pattern_id);

    while (queue.length) {
      const id = queue.shift();
      ids.push(id);

      for (const next of adjacency.get(id) || []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }

    const rows = ids.map(id => byId.get(id)).filter(Boolean);
    components.push(rows);
  }

  return components;
}

/* -------------------------------------------------------------------------- */
/* Cluster metrics                                                            */
/* -------------------------------------------------------------------------- */

function clusterMetrics(patterns, graphEdges) {
  const ids = new Set(patterns.map(p => p.pattern_id));
  const localEdges = graphEdges.filter(
    e => ids.has(e.from_pattern_id) && ids.has(e.to_pattern_id)
  );

  const families = patternFamilies(patterns);
  const focusEntityIds = unique(
    patterns.map(p => p?.focus_entity?.entity_id)
  );

  const entityFrequency = new Map();
  const entitySnapshot = new Map();

  for (const p of patterns) {
    for (const entity of [
      p?.focus_entity,
      ...(p?.supporting_entities || [])
    ]) {
      const id = entity?.entity_id;
      if (!id) continue;
      entityFrequency.set(id, (entityFrequency.get(id) || 0) + 1);
      if (!entitySnapshot.has(id)) entitySnapshot.set(id, compactEntity(entity));
    }
  }

  const sharedEntities = [...entityFrequency.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, count]) => ({
      ...entitySnapshot.get(id),
      pattern_support_count: count
    }));

  const structuralAvg = average(
    patterns.map(p => p?.structural_strength_score)
  );

  const scoreAvg = average(
    patterns.map(p => p?.pattern_score)
  );

  const maxScore = Math.max(
    0,
    ...patterns.map(p => num(p?.pattern_score, 0))
  );

  const edgeStrengthAvg = average(
    localEdges.map(e => e.edge_strength)
  );

  const familyDiversity = families.length / 4;

  const densityMax = patterns.length > 1
    ? (patterns.length * (patterns.length - 1)) / 2
    : 1;

  const crossFamilyDensity = Math.min(1, localEdges.length / densityMax);

  const evidenceScore = evidenceQualityScore(patterns);

  return {
    pattern_count: patterns.length,
    families,
    family_count: families.length,
    focus_entity_ids: focusEntityIds,
    focus_entity_count: focusEntityIds.length,
    shared_entities: sharedEntities,
    shared_entity_count: sharedEntities.length,
    local_edges: localEdges,
    edge_count: localEdges.length,
    average_pattern_score: round(scoreAvg, 2),
    maximum_pattern_score: round(maxScore, 2),
    average_structural_strength: round(structuralAvg, 2),
    average_overlap_edge_strength: round(edgeStrengthAvg, 2),
    cross_family_density: round(crossFamilyDensity, 3),
    family_diversity: round(familyDiversity, 3),
    evidence_quality_score: evidenceScore,
    evidence_quality_label: evidenceQualityLabel(evidenceScore)
  };
}

/* -------------------------------------------------------------------------- */
/* Emergence classification                                                   */
/* -------------------------------------------------------------------------- */

function emergenceFamilies(metrics) {
  const set = new Set(metrics.families);
  const types = [];

  if (
    set.has('structural_acceleration') &&
    set.has('impact_convergence')
  ) {
    types.push('acceleration_convergence');
  }

  if (
    set.has('cross_domain_coupling') &&
    set.has('evidence_reinforcement')
  ) {
    types.push('reinforced_coupling');
  }

  if (metrics.family_count >= 3 && metrics.pattern_count >= 4) {
    types.push('multi_family_emergence');
  }

  if (
    metrics.family_count === 4 &&
    metrics.pattern_count >= 5 &&
    metrics.shared_entity_count >= 2
  ) {
    types.push('systemic_emergence');
  }

  if (!types.length && metrics.family_count >= 2) {
    types.push('multi_pattern_convergence');
  }

  return types;
}

function emergenceScore(metrics) {
  const familyScore = metrics.family_diversity * 24;
  const patternScore = Math.min(18, metrics.pattern_count * 3);
  const sharedEntityScore = Math.min(18, metrics.shared_entity_count * 4);
  const edgeScore = Math.min(
    16,
    metrics.average_overlap_edge_strength * 0.16
  );
  const densityScore = metrics.cross_family_density * 12;
  const structuralScore = Math.min(
    12,
    metrics.average_structural_strength * 0.12
  );

  return round(
    Math.min(
      98,
      familyScore +
      patternScore +
      sharedEntityScore +
      edgeScore +
      densityScore +
      structuralScore
    ),
    2
  );
}

/* -------------------------------------------------------------------------- */
/* Candidate creation                                                         */
/* -------------------------------------------------------------------------- */

function createEmergenceCandidate(type, patterns, metrics) {
  const patternIds = patterns
    .map(p => p.pattern_id)
    .filter(Boolean)
    .sort();

  const families = [...metrics.families].sort();

  const topSharedEntities = metrics.shared_entities
    .slice(0, 12);

  const focusEntities = unique(
    patterns
      .map(p => p?.focus_entity?.entity_id)
      .filter(Boolean)
  )
    .map(id => {
      for (const p of patterns) {
        if (p?.focus_entity?.entity_id === id) {
          return compactEntity(p.focus_entity);
        }
      }
      return { entity_id: id, name: id, type: null };
    });

  const score = emergenceScore(metrics);

  if (score < MIN_CLUSTER_SCORE) return null;

  const topNames = topSharedEntities
    .slice(0, 4)
    .map(x => x.name || x.entity_id)
    .filter(Boolean);

  const titleBase = topNames.length
    ? topNames.join(' · ')
    : focusEntities
        .slice(0, 3)
        .map(x => x.name || x.entity_id)
        .join(' · ');

  const descriptions = {
    acceleration_convergence:
      'Structural acceleration and independent impact convergence are appearing in the same connected pattern cluster. This may indicate that change is not only increasing locally, but is also propagating toward shared affected entities.',
    reinforced_coupling:
      'Cross-domain coupling is supported by repeatedly reinforced relationships inside the same cluster. This strengthens the structural coherence of the connection without turning unverified evidence into fact.',
    multi_family_emergence:
      'Three or more independent pattern families overlap around shared entities. The combination is more informative than any single pattern because different structural mechanisms are pointing into the same connected system.',
    systemic_emergence:
      'All four Pattern Engine families are participating in the same connected cluster. This is the strongest structural emergence class in v0.1, but it remains a scenario signal whose evidence quality is inherited from underlying patterns.',
    multi_pattern_convergence:
      'Multiple pattern families overlap around shared entities. This is a higher-order convergence signal and should be treated as a candidate emergence, not a verified real-world conclusion.'
  };

  return {
    emergence_id: stableId(
      'emg',
      [type, ...families, ...patternIds]
    ),
    emergence_family: type,
    title: titleBase
      ? `${titleBase} — ${type.replace(/_/g, ' ')}`
      : type.replace(/_/g, ' '),
    description: descriptions[type],
    emergence_score: score,
    structural_strength_score: round(
      metrics.average_structural_strength,
      2
    ),
    evidence_quality_score: metrics.evidence_quality_score,
    evidence_quality_label: metrics.evidence_quality_label,
    confidence_class:
      score >= 82 && metrics.evidence_quality_score >= 50
        ? 'high'
        : score >= 65 && metrics.evidence_quality_score >= 35
          ? 'medium'
          : 'low',

    pattern_family_count: metrics.family_count,
    pattern_families: families,
    supporting_pattern_ids: patternIds,
    supporting_patterns: patterns.map(p => ({
      pattern_id: p.pattern_id,
      pattern_family: p.pattern_family,
      title: p.title,
      pattern_score: p.pattern_score,
      structural_strength_score: p.structural_strength_score,
      evidence_quality_score: p.evidence_quality_score,
      confidence_class: p.confidence_class,
      focus_entity: compactEntity(p.focus_entity)
    })),

    focus_entities: focusEntities,
    shared_entities: topSharedEntities,

    supporting_impact_ids: unique(
      patterns.flatMap(p => p?.supporting_impact_ids || [])
    ),
    supporting_relationship_ids: unique(
      patterns.flatMap(p => p?.supporting_relationship_ids || [])
    ),
    supporting_development_ids: unique(
      patterns.flatMap(p => p?.evidence?.development_ids || [])
    ),

    signal_details: {
      pattern_count: metrics.pattern_count,
      family_count: metrics.family_count,
      shared_entity_count: metrics.shared_entity_count,
      focus_entity_count: metrics.focus_entity_count,
      overlap_edge_count: metrics.edge_count,
      cross_family_density: metrics.cross_family_density,
      average_overlap_edge_strength:
        metrics.average_overlap_edge_strength,
      average_pattern_score: metrics.average_pattern_score,
      maximum_pattern_score: metrics.maximum_pattern_score
    },

    persistence: {
      status: 'insufficient_history',
      days_observed: 1,
      history_days_available: 0
    },

    interpretation: {
      claim_class: 'higher_order_structural_signal',
      causality: 'not_established',
      forecast: false,
      evidence_inheritance:
        'Evidence quality is inherited from underlying patterns and is never upgraded by emergence scoring.'
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Decompose overly broad connected components                                */
/* -------------------------------------------------------------------------- */

function neighborhoodCandidates(component, graph) {
  const byId = new Map(component.map(p => [p.pattern_id, p]));
  const componentIds = new Set(byId.keys());
  const outputs = [];

  // One candidate neighborhood per pattern "anchor". This prevents one giant
  // connected component from swallowing the whole graph.
  for (const anchor of component) {
    const neighborIds = [...(graph.adjacency.get(anchor.pattern_id) || [])]
      .filter(id => componentIds.has(id));

    const rows = unique([
      anchor.pattern_id,
      ...neighborIds
    ])
      .map(id => byId.get(id))
      .filter(Boolean);

    if (rows.length < MIN_PATTERNS) continue;

    // Keep strongest pattern per family first, then add additional patterns
    // only when they materially overlap the anchor neighborhood.
    rows.sort((a, b) =>
      num(b.pattern_score, 0) - num(a.pattern_score, 0)
    );

    const familyBest = new Map();
    for (const p of rows) {
      if (!familyBest.has(p.pattern_family)) {
        familyBest.set(p.pattern_family, p);
      }
    }

    const selected = [...familyBest.values()];

    for (const p of rows) {
      if (selected.includes(p)) continue;
      if (selected.length >= 8) break;

      const overlapWithSelected = selected.some(s =>
        overlapCount(patternEntityIds(p), patternEntityIds(s)) >= 2
      );

      if (overlapWithSelected) selected.push(p);
    }

    if (selected.length >= MIN_PATTERNS) {
      outputs.push(selected);
    }
  }

  return outputs;
}

/* -------------------------------------------------------------------------- */
/* Deduplication                                                               */
/* -------------------------------------------------------------------------- */

function dedupeEmergences(rows) {
  const best = new Map();

  for (const row of rows) {
    const entityKey = row.shared_entities
      .slice(0, 6)
      .map(x => x.entity_id)
      .filter(Boolean)
      .sort()
      .join(',');

    const key = `${row.emergence_family}::${entityKey}`;

    const old = best.get(key);
    if (
      !old ||
      row.emergence_score > old.emergence_score ||
      (
        row.emergence_score === old.emergence_score &&
        row.supporting_pattern_ids.length >
          old.supporting_pattern_ids.length
      )
    ) {
      best.set(key, row);
    }
  }

  return [...best.values()]
    .sort((a, b) =>
      b.emergence_score - a.emergence_score ||
      b.pattern_family_count - a.pattern_family_count ||
      a.emergence_id.localeCompare(b.emergence_id)
    )
    .slice(0, MAX_RESULTS);
}

/* -------------------------------------------------------------------------- */
/* History / persistence                                                      */
/* -------------------------------------------------------------------------- */

function loadHistory(currentDateUtc) {
  if (!fs.existsSync(HISTORY_DIR)) return [];

  const names = fs
    .readdirSync(HISTORY_DIR)
    .filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort();

  const rows = [];

  for (const name of names) {
    if (name.slice(0, 10) === currentDateUtc) continue;

    try {
      rows.push(
        JSON.parse(
          fs.readFileSync(path.join(HISTORY_DIR, name), 'utf8')
        )
      );
    } catch (_) {}
  }

  return rows;
}

function applyPersistence(emergences, history) {
  if (history.length < PERSISTENCE_MIN_HISTORY_DAYS - 1) {
    for (const row of emergences) {
      row.persistence = {
        status: 'insufficient_history',
        days_observed: 1,
        history_days_available: history.length
      };
    }
    return;
  }

  const priorById = new Map();

  for (const payload of history) {
    for (const row of payload?.emergences || []) {
      const arr = priorById.get(row.emergence_id) || [];
      arr.push(payload.date_utc || null);
      priorById.set(row.emergence_id, arr);
    }
  }

  for (const row of emergences) {
    const priorDates = unique(priorById.get(row.emergence_id) || []);
    const daysObserved = priorDates.length + 1;

    row.persistence = {
      status:
        daysObserved >= 7
          ? 'persistent'
          : daysObserved >= 3
            ? 'recurring'
            : 'new',
      days_observed: daysObserved,
      history_days_available: history.length,
      prior_dates: priorDates
    };

    // Persistence may modestly strengthen a signal, but can never push it to
    // absolute certainty.
    if (daysObserved >= 3) {
      row.emergence_score = round(
        Math.min(
          98,
          row.emergence_score +
            Math.min(6, (daysObserved - 2) * 1.25)
        ),
        2
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                */
/* -------------------------------------------------------------------------- */

function countBy(items, getter) {
  const map = new Map();

  for (const item of items) {
    const key = String(getter(item) ?? 'unknown');
    map.set(key, (map.get(key) || 0) + 1);
  }

  return Object.fromEntries(
    [...map.entries()]
      .sort((a, b) =>
        b[1] - a[1] ||
        a[0].localeCompare(b[0])
      )
  );
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

function main() {
  const patternsPayload = readJson(FILES.patterns);

  if (patternsPayload?.schema_version !== '0.2') {
    throw new Error(
      `Emergence Engine v0.1 expects patterns-current.json schema 0.2; got ${patternsPayload?.schema_version}`
    );
  }

  const impact = readJson(FILES.impact, false);
  const delta = readJson(FILES.delta, false);
  const state = readJson(FILES.state, false);

  const patterns = candidatePatterns(patternsPayload);

  const graph = buildPatternGraph(patterns);
  const components = connectedComponents(patterns, graph.adjacency);

  const rawEmergences = [];

  for (const component of components) {
    if (component.length < MIN_PATTERNS) continue;

    const neighborhoods = neighborhoodCandidates(component, graph);

    for (const rows of neighborhoods) {
      const metrics = clusterMetrics(rows, graph.edges);

      if (
        metrics.pattern_count < MIN_PATTERNS ||
        metrics.family_count < MIN_FAMILIES ||
        metrics.shared_entity_count < MIN_SHARED_ENTITIES
      ) {
        continue;
      }

      for (const type of emergenceFamilies(metrics)) {
        const candidate = createEmergenceCandidate(
          type,
          rows,
          metrics
        );

        if (candidate) rawEmergences.push(candidate);
      }
    }
  }

  let emergences = dedupeEmergences(rawEmergences);

  const generatedAt = new Date().toISOString();
  const dateUtc =
    clean(patternsPayload?.date_utc) ||
    generatedAt.slice(0, 10);

  const history = loadHistory(dateUtc);
  applyPersistence(emergences, history);

  emergences = emergences
    .sort((a, b) =>
      b.emergence_score - a.emergence_score ||
      a.emergence_id.localeCompare(b.emergence_id)
    )
    .slice(0, MAX_RESULTS);

  const output = {
    schema_version: '0.1',
    generated_at: generatedAt,
    date_utc: dateUtc,
    status:
      emergences.length
        ? 'ready'
        : 'no_emergence_above_threshold',

    source: {
      patterns_schema_version:
        patternsPayload?.schema_version || null,
      patterns_generated_at:
        patternsPayload?.generated_at || null,
      impact_schema_version:
        impact?.schema_version || null,
      delta_schema_version:
        delta?.schema_version || null,
      state_schema_version:
        state?.schema_version || null
    },

    methodology: {
      summary:
        'Deterministic higher-order synthesis above Pattern Engine v0.2. Emergence requires multiple patterns from multiple families that overlap through shared entities. A single strong pattern can never become emergence by itself.',
      reasoning_mode: 'deterministic_higher_order_pattern_synthesis',
      minimum_pattern_score: MIN_PATTERN_SCORE,
      minimum_patterns_per_candidate: MIN_PATTERNS,
      minimum_pattern_families: MIN_FAMILIES,
      minimum_shared_entities: MIN_SHARED_ENTITIES,
      minimum_emergence_score: MIN_CLUSTER_SCORE,
      maximum_results: MAX_RESULTS,

      emergence_families: [
        'acceleration_convergence',
        'reinforced_coupling',
        'multi_family_emergence',
        'systemic_emergence',
        'multi_pattern_convergence'
      ],

      evidence_rule:
        'Emergence scoring never upgrades underlying evidence quality. Evidence quality is inherited conservatively from supporting patterns.',

      causality_rule:
        'Overlap, reinforcement, convergence and acceleration are structural signals. They do not establish causality or guarantee an outcome.',

      anti_hub_rule:
        'The engine decomposes broad connected components into anchor neighborhoods so one highly connected hub cannot turn the entire pattern graph into one emergence.',

      persistence_rule:
        'Persistence is reported only after enough emergence-history days exist. Recurrence may modestly strengthen emergence score but never creates certainty.'
    },

    diagnostics: {
      pattern_count_input:
        (patternsPayload?.patterns || []).length,
      candidate_pattern_count:
        patterns.length,
      pattern_graph_edge_count:
        graph.edges.length,
      connected_component_count:
        components.length,
      raw_emergence_count:
        rawEmergences.length,
      emergence_count_retained:
        emergences.length,
      history_days_available:
        history.length
    },

    summary: {
      emergence_count: emergences.length,
      by_family:
        countBy(emergences, x => x.emergence_family),
      by_confidence_class:
        countBy(emergences, x => x.confidence_class),
      by_evidence_quality:
        countBy(emergences, x => x.evidence_quality_label),
      by_persistence:
        countBy(emergences, x => x.persistence?.status)
    },

    emergences
  };

  writeJson(FILES.output, output);
  writeJson(
    path.join(HISTORY_DIR, `${dateUtc}.json`),
    output
  );

  console.log('\n=== PTD Today / Cosmos Emergence Engine ===');
  console.log(`Date:                   ${dateUtc}`);
  console.log(`Patterns considered:    ${patterns.length}`);
  console.log(`Pattern graph edges:    ${graph.edges.length}`);
  console.log(`Raw emergences:         ${rawEmergences.length}`);
  console.log(`Emergences retained:    ${emergences.length}`);
  console.log(
    `Systemic emergence:     ${output.summary.by_family.systemic_emergence || 0}`
  );
  console.log(
    `Multi-family emergence: ${output.summary.by_family.multi_family_emergence || 0}`
  );
  console.log(
    `Accel + convergence:    ${output.summary.by_family.acceleration_convergence || 0}`
  );
  console.log(
    `Reinforced coupling:    ${output.summary.by_family.reinforced_coupling || 0}`
  );
  console.log(`Status:                 ${output.status}`);
  console.log(
    `Output:                 ${path.relative(ROOT, FILES.output)}`
  );
}

try {
  main();
} catch (error) {
  console.error('\nCosmos Emergence Engine failed:');
  console.error(error?.stack || error?.message || error);
  process.exit(1);
}
