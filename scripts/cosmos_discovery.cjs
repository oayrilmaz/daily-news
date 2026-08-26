#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — Discovery / Curiosity Engine v0.1
 *
 * Core question:
 *   "What does Cosmos need to learn next in order to continue the ripple?"
 *
 * This layer consumes Cosmos Consequence output and produces prioritized
 * knowledge-acquisition targets.
 *
 * Deterministic only:
 * - no OpenAI/API calls
 * - no web search
 * - no evidence invention
 * - no automatic entity resolution
 * - no claim upgrading
 *
 * It does not fetch answers.
 * It identifies what is missing, why it matters, and whether resolving it
 * could reopen or deepen the consequence frontier.
 */

const fs = require("fs");
const path = require("path");

/* -------------------------------------------------------------------------- */
/* Defaults                                                                   */
/* -------------------------------------------------------------------------- */

const DEFAULT_TARGET_LIMIT = 40;

const GAP_PRIORITY = {
  critical: 100,
  high: 80,
  medium: 55,
  low: 30
};

const TARGET_BASE = {
  resolve_entity: 95,
  validate_direction: 90,
  strengthen_evidence: 75,
  identify_suppliers: 78,
  identify_buyers: 72,
  identify_substitutes: 86,
  identify_capacity: 88,
  identify_geography: 60,
  identify_logistics: 68,
  identify_people: 58,
  identify_companies: 66,
  identify_components: 82,
  identify_materials: 84,
  identify_market_exposure: 62,
  extend_frontier: 92
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function clean(v) {
  return String(v ?? "").trim();
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

function nowIso() {
  return new Date().toISOString();
}

function stableId(prefix, values) {
  const src = (Array.isArray(values) ? values : [values]).join("|");
  let hash = 2166136261;
  for (let i = 0; i < src.length; i += 1) {
    hash ^= src.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
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

function humanReadable(id, name) {
  const v = clean(name);
  if (!v) return null;
  if (v === id) return null;
  if (/^ent_[a-z0-9]+$/i.test(v)) return null;
  return v;
}

function targetPriority(base, butterflyDistance = 0, gapPriority = null, reopen = false) {
  const distanceBoost = Math.min(20, n(butterflyDistance) * 4);
  const gapBoost = gapPriority ? n(GAP_PRIORITY[gapPriority], 0) * 0.18 : 0;
  const reopenBoost = reopen ? 10 : 0;
  return clamp(base + distanceBoost + gapBoost + reopenBoost, 0, 100);
}

function sourceTypesFor(targetType) {
  const map = {
    resolve_entity: [
      "entity registry",
      "company/organization sources",
      "industry directories",
      "primary-source documents"
    ],
    validate_direction: [
      "primary-source evidence",
      "historical developments",
      "technical/industry evidence"
    ],
    strengthen_evidence: [
      "primary-source reporting",
      "regulatory filings",
      "official announcements",
      "historical developments"
    ],
    identify_suppliers: [
      "supplier lists",
      "company disclosures",
      "procurement data",
      "trade/shipping data"
    ],
    identify_buyers: [
      "customer disclosures",
      "project awards",
      "procurement records",
      "company filings"
    ],
    identify_substitutes: [
      "technical standards",
      "qualified-vendor lists",
      "supplier data",
      "engineering literature"
    ],
    identify_capacity: [
      "plant capacity disclosures",
      "production statistics",
      "factory announcements",
      "company filings"
    ],
    identify_geography: [
      "facility locations",
      "project locations",
      "trade routes",
      "country/region metadata"
    ],
    identify_logistics: [
      "ports",
      "shipping routes",
      "freight data",
      "warehousing/logistics providers"
    ],
    identify_people: [
      "company leadership",
      "functional roles",
      "project teams",
      "public professional profiles"
    ],
    identify_companies: [
      "company registries",
      "industry directories",
      "market participants",
      "supplier/customer disclosures"
    ],
    identify_components: [
      "BOM/component data",
      "technical manuals",
      "engineering standards",
      "OEM documentation"
    ],
    identify_materials: [
      "BOM/material data",
      "technical specifications",
      "commodity/process data",
      "OEM documentation"
    ],
    identify_market_exposure: [
      "market data",
      "company financials",
      "commodity exposures",
      "investment disclosures"
    ],
    extend_frontier: [
      "related entities",
      "adjacent relationships",
      "historical analogues",
      "cross-domain developments"
    ]
  };
  return map[targetType] || ["relevant primary sources"];
}

function expectedInfoType(targetType) {
  const map = {
    resolve_entity: "entity identity and type",
    validate_direction: "directional relationship evidence",
    strengthen_evidence: "higher-quality supporting evidence",
    identify_suppliers: "supplier network",
    identify_buyers: "buyer/customer network",
    identify_substitutes: "qualified substitute pathways",
    identify_capacity: "available and expandable capacity",
    identify_geography: "locations and geographic exposure",
    identify_logistics: "transport/storage/port dependencies",
    identify_people: "relevant human actors and decision-makers",
    identify_companies: "relevant organizations",
    identify_components: "component dependencies",
    identify_materials: "material dependencies",
    identify_market_exposure: "financial/market exposure",
    extend_frontier: "new entities and relationships beyond the current frontier"
  };
  return map[targetType] || "missing knowledge";
}

/* -------------------------------------------------------------------------- */
/* Normalize                                                                  */
/* -------------------------------------------------------------------------- */

function normalizeInput(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Cosmos Discovery requires a Cosmos Consequence JSON payload.");
  }

  if (raw.status !== "consequence_frontier_resolved") {
    throw new Error(
      `Cosmos Discovery requires consequence_frontier_resolved input; got ${raw.status}`
    );
  }

  return {
    source: raw,
    origin_event: raw.origin_event || {},
    consequences: raw.consequence_field?.consequences || [],
    remaining_frontier_entity_ids:
      raw.consequence_field?.remaining_frontier_entity_ids || [],
    frontier_snapshots: raw.consequence_field?.frontier_snapshots || [],
    affected_actors: raw.affected_actors || [],
    alternatives: raw.alternatives?.items || [],
    knowledge_gaps: raw.knowledge_gaps?.items || [],
    butterfly_state: raw.butterfly_state || {},
    safeguards: raw.safeguards || {}
  };
}

/* -------------------------------------------------------------------------- */
/* Target builder                                                             */
/* -------------------------------------------------------------------------- */

function makeTarget({
  type,
  statement,
  reason,
  butterflyDistance = 0,
  entityIds = [],
  consequenceIds = [],
  relationshipIds = [],
  gapIds = [],
  priorityClass = null,
  reopen = false,
  expected = null,
  additional = {}
}) {
  const base = n(TARGET_BASE[type], 50);

  return {
    discovery_target_id: stableId("discovery", [
      type,
      statement,
      ...entityIds,
      ...consequenceIds,
      ...relationshipIds
    ]),
    target_type: type,
    statement,
    curiosity_reason: reason,
    priority_score: Math.round(
      targetPriority(base, butterflyDistance, priorityClass, reopen) * 100
    ) / 100,
    priority_class:
      priorityClass ||
      (base >= 90 ? "critical" : base >= 75 ? "high" : "medium"),
    butterfly_distance: butterflyDistance,
    entity_ids: uniq(entityIds),
    consequence_ids: uniq(consequenceIds),
    relationship_ids: uniq(relationshipIds),
    originating_gap_ids: uniq(gapIds),
    expected_information_type: expected || expectedInfoType(type),
    suggested_source_types: sourceTypesFor(type),
    reopens_frontier_if_resolved: Boolean(reopen),
    status: "open",
    ...additional
  };
}

/* -------------------------------------------------------------------------- */
/* Gap-derived targets                                                        */
/* -------------------------------------------------------------------------- */

function deriveFromKnowledgeGaps(ctx) {
  const targets = [];

  for (const gap of ctx.knowledge_gaps) {
    const priorityClass = clean(gap.priority).toLowerCase() || "medium";

    if (gap.gap_type === "unresolved_entity") {
      targets.push(
        makeTarget({
          type: "resolve_entity",
          statement: gap.statement,
          reason:
            "An unresolved entity blocks human-readable understanding and may hide additional relationships.",
          entityIds: gap.entity_ids || [],
          gapIds: [gap.gap_id],
          priorityClass,
          reopen: true
        })
      );
      continue;
    }

    if (gap.gap_type === "directionality") {
      targets.push(
        makeTarget({
          type: "validate_direction",
          statement: gap.statement,
          reason:
            "The relationship is visible in context but cannot extend the consequence field until its direction is validated.",
          entityIds: gap.entity_ids || [],
          gapIds: [gap.gap_id],
          priorityClass,
          reopen: true
        })
      );
      continue;
    }

    if (gap.gap_type === "weak_evidence") {
      targets.push(
        makeTarget({
          type: "strengthen_evidence",
          statement: gap.statement,
          reason:
            "The pathway exists but weak evidence limits how strongly Cosmos can rely on it.",
          entityIds: gap.entity_ids || [],
          gapIds: [gap.gap_id],
          priorityClass,
          reopen: false
        })
      );
      continue;
    }

    if (gap.gap_type === "alternatives_unknown") {
      targets.push(
        makeTarget({
          type: "identify_substitutes",
          statement: gap.statement,
          reason:
            "Without alternatives, Cosmos cannot evaluate resilience, substitution, or who could step in if the current pathway fails.",
          entityIds: gap.entity_ids || [],
          gapIds: [gap.gap_id],
          priorityClass,
          reopen: true
        })
      );
      continue;
    }

    if (gap.gap_type === "material_identity") {
      targets.push(
        makeTarget({
          type: "identify_materials",
          statement: gap.statement,
          reason:
            "The exact material is required before Cosmos can trace processing, suppliers, components, substitutes, geography, or logistics credibly.",
          entityIds: gap.entity_ids || [],
          gapIds: [gap.gap_id],
          priorityClass,
          reopen: true
        })
      );
    }
  }

  return targets;
}

/* -------------------------------------------------------------------------- */
/* Frontier-derived targets                                                   */
/* -------------------------------------------------------------------------- */

function deriveFromFrontier(ctx) {
  const targets = [];
  const snapshots = ctx.frontier_snapshots || [];
  const lastSnapshot = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const lastNonEmpty = [...snapshots].reverse().find(x => n(x.frontier_count) > 0);

  const observedMaxDistance = ctx.consequences.reduce(
    (max, row) => Math.max(max, n(row.butterfly_distance)),
    0
  );

  if (
    ctx.butterfly_state?.continuation_possible === true &&
    ctx.butterfly_state?.frontier_is_terminal === false &&
    (!lastSnapshot || n(lastSnapshot.frontier_count) === 0)
  ) {
    targets.push(
      makeTarget({
        type: "extend_frontier",
        statement:
          "The computed consequence frontier is empty even though Cosmos marks the reasoning frontier as non-terminal.",
        reason:
          "The known graph has been exhausted before the conceptual ripple has ended. Cosmos needs adjacent entities and relationships beyond the current frontier.",
        butterflyDistance: observedMaxDistance,
        entityIds: lastNonEmpty?.frontier_entity_ids || [],
        reopen: true,
        priorityClass: "critical",
        additional: {
          frontier_status: "knowledge_exhausted_not_reality_exhausted"
        }
      })
    );
  }

  const frontierEntities =
    ctx.remaining_frontier_entity_ids.length
      ? ctx.remaining_frontier_entity_ids
      : lastNonEmpty?.frontier_entity_ids || [];

  if (frontierEntities.length) {
    targets.push(
      makeTarget({
        type: "identify_companies",
        statement:
          "Identify organizations connected to the current consequence frontier.",
        reason:
          "Companies often expose suppliers, customers, projects, investments, facilities, people, and strategic responses that can reopen propagation.",
        butterflyDistance: observedMaxDistance,
        entityIds: frontierEntities,
        reopen: true
      })
    );

    targets.push(
      makeTarget({
        type: "identify_people",
        statement:
          "Identify human actors and decision-makers connected to the current consequence frontier.",
        reason:
          "Human decisions can amplify, suppress, redirect, finance, regulate, procure, substitute, or accelerate consequence pathways.",
        butterflyDistance: observedMaxDistance,
        entityIds: frontierEntities,
        reopen: true
      })
    );
  }

  return targets;
}

/* -------------------------------------------------------------------------- */
/* Consequence-derived targets                                                */
/* -------------------------------------------------------------------------- */

function deriveFromConsequences(ctx) {
  const targets = [];

  for (const c of ctx.consequences) {
    const name = humanReadable(c.to_entity_id, c.to_entity_name);
    const type = clean(c.to_entity_type).toLowerCase();
    const distance = n(c.butterfly_distance);

    if (!name) {
      continue;
    }

    if (/transformer|cable|battery|storage|manufactur|equipment|technology/.test(
      `${name} ${type}`.toLowerCase()
    )) {
      targets.push(
        makeTarget({
          type: "identify_components",
          statement:
            `Identify the critical component dependencies behind ${name}.`,
          reason:
            "Component dependencies reveal hidden suppliers, bottlenecks, qualification constraints, and downstream ripple paths.",
          butterflyDistance: distance,
          entityIds: [c.to_entity_id],
          consequenceIds: [c.consequence_id],
          relationshipIds: [c.relationship_id],
          reopen: true
        })
      );

      targets.push(
        makeTarget({
          type: "identify_materials",
          statement:
            `Identify the critical material dependencies behind ${name}.`,
          reason:
            "Material dependencies can connect technology/manufacturing consequences to mining, refining, processing, trade, logistics, and geopolitics.",
          butterflyDistance: distance,
          entityIds: [c.to_entity_id],
          consequenceIds: [c.consequence_id],
          relationshipIds: [c.relationship_id],
          reopen: true
        })
      );

      targets.push(
        makeTarget({
          type: "identify_suppliers",
          statement:
            `Identify suppliers and subcontractors supporting ${name}.`,
          reason:
            "Supplier/subcontractor relationships are required to trace operational bottlenecks and substitution options.",
          butterflyDistance: distance,
          entityIds: [c.to_entity_id],
          consequenceIds: [c.consequence_id],
          relationshipIds: [c.relationship_id],
          reopen: true
        })
      );
    }

    if (/organization|company|infrastructure|project/.test(type)) {
      targets.push(
        makeTarget({
          type: "identify_buyers",
          statement:
            `Identify buyers/customers/procurement dependencies connected to ${name}.`,
          reason:
            "Buyer relationships reveal who absorbs the consequence and where commercial or project impacts may surface next.",
          butterflyDistance: distance,
          entityIds: [c.to_entity_id],
          consequenceIds: [c.consequence_id],
          relationshipIds: [c.relationship_id],
          reopen: true
        })
      );
    }

    if (/material|manufactur|technology|equipment/.test(
      `${name} ${type}`.toLowerCase()
    )) {
      targets.push(
        makeTarget({
          type: "identify_capacity",
          statement:
            `Identify current capacity, spare capacity, expansion capacity, and lead-time constraints for ${name}.`,
          reason:
            "Capacity determines whether a consequence can be absorbed, delayed, amplified, or redirected to alternatives.",
          butterflyDistance: distance,
          entityIds: [c.to_entity_id],
          consequenceIds: [c.consequence_id],
          relationshipIds: [c.relationship_id],
          reopen: true
        })
      );
    }

    if (distance >= 2) {
      targets.push(
        makeTarget({
          type: "identify_geography",
          statement:
            `Map the geographic exposure of ${name} and this consequence branch.`,
          reason:
            "Geography can reveal country concentration, local constraints, trade dependencies, policy exposure, and alternative regions.",
          butterflyDistance: distance,
          entityIds: [c.to_entity_id],
          consequenceIds: [c.consequence_id],
          relationshipIds: [c.relationship_id],
          reopen: false
        })
      );
    }

    if (/material|manufactur|infrastructure|project/.test(
      `${name} ${type}`.toLowerCase()
    )) {
      targets.push(
        makeTarget({
          type: "identify_logistics",
          statement:
            `Identify logistics, ports, shipping, storage, and transport dependencies for ${name}.`,
          reason:
            "Physical movement can become a separate bottleneck even when production capacity exists.",
          butterflyDistance: distance,
          entityIds: [c.to_entity_id],
          consequenceIds: [c.consequence_id],
          relationshipIds: [c.relationship_id],
          reopen: true
        })
      );
    }

    if (distance >= 2) {
      targets.push(
        makeTarget({
          type: "identify_market_exposure",
          statement:
            `Identify financial, commodity, investment, and market exposure connected to ${name}.`,
          reason:
            "Market exposure can convert an operational consequence into capital allocation, pricing, valuation, financing, or investment effects.",
          butterflyDistance: distance,
          entityIds: [c.to_entity_id],
          consequenceIds: [c.consequence_id],
          relationshipIds: [c.relationship_id],
          reopen: false
        })
      );
    }
  }

  return targets;
}

/* -------------------------------------------------------------------------- */
/* Alternative-derived targets                                                */
/* -------------------------------------------------------------------------- */

function deriveFromAlternatives(ctx) {
  const targets = [];

  for (const alt of ctx.alternatives) {
    if (alt.qualification_status !== "requires_validation") continue;

    const ids = [
      alt.from?.entity_id,
      alt.to?.entity_id
    ].filter(Boolean);

    targets.push(
      makeTarget({
        type: "identify_capacity",
        statement:
          `Validate whether alternative pathway ${alt.alternative_id} has practical capacity.`,
        reason:
          "A graph alternative is not useful unless it can actually absorb demand at the required scale and timing.",
        entityIds: ids,
        relationshipIds: [alt.relationship_id],
        reopen: true,
        priorityClass: "high"
      })
    );

    targets.push(
      makeTarget({
        type: "identify_substitutes",
        statement:
          `Validate the practical substitutability of alternative pathway ${alt.alternative_id}.`,
        reason:
          "Cosmos needs qualification, technical compatibility, lead time, cost, and logistics before treating an alternative as actionable.",
        entityIds: ids,
        relationshipIds: [alt.relationship_id],
        reopen: true,
        priorityClass: "high"
      })
    );
  }

  return targets;
}

/* -------------------------------------------------------------------------- */
/* Dedup + prioritization                                                     */
/* -------------------------------------------------------------------------- */

function deduplicateTargets(targets) {
  const map = new Map();

  for (const target of targets) {
    const key = [
      target.target_type,
      [...(target.entity_ids || [])].sort().join(","),
      [...(target.relationship_ids || [])].sort().join(","),
      target.statement
    ].join("|");

    const prev = map.get(key);

    if (!prev || n(target.priority_score) > n(prev.priority_score)) {
      map.set(key, target);
    } else {
      prev.consequence_ids = uniq([
        ...(prev.consequence_ids || []),
        ...(target.consequence_ids || [])
      ]);
      prev.originating_gap_ids = uniq([
        ...(prev.originating_gap_ids || []),
        ...(target.originating_gap_ids || [])
      ]);
      prev.reopens_frontier_if_resolved =
        prev.reopens_frontier_if_resolved ||
        target.reopens_frontier_if_resolved;
    }
  }

  return [...map.values()];
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

function runCosmosDiscovery(raw, options = {}) {
  const ctx = normalizeInput(raw);

  let targets = [
    ...deriveFromKnowledgeGaps(ctx),
    ...deriveFromFrontier(ctx),
    ...deriveFromConsequences(ctx),
    ...deriveFromAlternatives(ctx)
  ];

  targets = deduplicateTargets(targets)
    .sort((a, b) => {
      if (b.priority_score !== a.priority_score) {
        return b.priority_score - a.priority_score;
      }
      if (
        Number(b.reopens_frontier_if_resolved) !==
        Number(a.reopens_frontier_if_resolved)
      ) {
        return Number(b.reopens_frontier_if_resolved) -
          Number(a.reopens_frontier_if_resolved);
      }
      return n(b.butterfly_distance) - n(a.butterfly_distance);
    })
    .slice(0, n(options.target_limit, DEFAULT_TARGET_LIMIT));

  const reopenTargets = targets.filter(
    x => x.reopens_frontier_if_resolved === true
  );

  const byType = {};
  for (const t of targets) {
    byType[t.target_type] = n(byType[t.target_type], 0) + 1;
  }

  return {
    schema_version: "0.1",
    generated_at: nowIso(),
    status: "discovery_targets_resolved",

    source_consequence: {
      schema_version: raw.schema_version || null,
      generated_at: raw.generated_at || null,
      status: raw.status || null
    },

    origin_event: ctx.origin_event,

    curiosity_state: {
      target_count: targets.length,
      frontier_reopening_target_count: reopenTargets.length,
      target_type_counts: byType,
      discovery_needed: targets.length > 0,
      continuation_possible:
        raw.butterfly_state?.continuation_possible === true,
      current_frontier_is_terminal:
        raw.butterfly_state?.frontier_is_terminal === true,
      conceptual_distance_limit:
        raw.butterfly_state?.conceptual_distance_limit ?? null,
      principle:
        "The known graph may end while reality does not. Discovery identifies what Cosmos must learn next."
    },

    discovery_targets: targets,

    next_acquisition_queue: reopenTargets.slice(0, 12).map((t, index) => ({
      queue_rank: index + 1,
      discovery_target_id: t.discovery_target_id,
      target_type: t.target_type,
      priority_score: t.priority_score,
      expected_information_type: t.expected_information_type,
      suggested_source_types: t.suggested_source_types,
      entity_ids: t.entity_ids,
      relationship_ids: t.relationship_ids,
      reason: t.curiosity_reason
    })),

    safeguards: {
      performs_external_search: false,
      calls_openai_or_external_api: false,
      invents_missing_entities: false,
      upgrades_evidence_quality: false,
      converts_unknown_to_fact: false,
      acquisition_targets_are_requests_for_knowledge_not_claims: true,
      source_lineage_preserved: true,
      consequence_frontier_may_be_reopened: true
    }
  };
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {};

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--input" && args[i + 1]) {
      out.input_file = args[++i];
    } else if (args[i] === "--out" && args[i + 1]) {
      out.output_file = args[++i];
    } else if (args[i] === "--target-limit" && args[i + 1]) {
      out.target_limit = Number(args[++i]);
    }
  }

  return out;
}

function main() {
  const options = parseArgs(process.argv);

  if (!options.input_file) {
    throw new Error(
      "Usage: node scripts/cosmos_discovery.cjs --input <consequence.json> [--out <discovery.json>] [--target-limit N]"
    );
  }

  const output = runCosmosDiscovery(readJson(options.input_file), options);

  if (options.output_file) {
    writeJson(options.output_file, output);
    console.log(`Cosmos Discovery output written to ${options.output_file}`);
  } else {
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runCosmosDiscovery,
  normalizeInput,
  deriveFromKnowledgeGaps,
  deriveFromFrontier,
  deriveFromConsequences,
  deriveFromAlternatives,
  deduplicateTargets
};
