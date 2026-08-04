// scripts/resolve_entities.js
// PTD Today — Entity Resolution and Graph Repair Engine
//
// PURPOSE
// -------
// Consolidates duplicate entities before lifecycle scoring.
//
// Reads:
//   knowledge/entities.json
//   knowledge/developments.json
//   knowledge/relationships.json
//
// Writes:
//   knowledge/entities.json
//   knowledge/developments.json
//   knowledge/relationships.json
//   knowledge/entity-resolution-report.json
//
// SAFETY
// ------
// - No development or relationship is deleted.
// - Duplicate entity IDs are redirected to one canonical entity.
// - Relationships are rewritten to canonical IDs and merged when identical.
// - Matching is conservative: exact canonical names, aliases, and a small set
//   of safe grammatical variants only.

import fs from "fs";
import path from "path";

const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || "knowledge";
const ENTITIES_PATH = path.join(KNOWLEDGE_DIR, "entities.json");
const DEVELOPMENTS_PATH = path.join(KNOWLEDGE_DIR, "developments.json");
const RELATIONSHIPS_PATH = path.join(KNOWLEDGE_DIR, "relationships.json");
const REPORT_PATH = path.join(KNOWLEDGE_DIR, "entity-resolution-report.json");

const NOW = new Date().toISOString();

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/\bincorporated\b/g, "inc")
    .replace(/\bcorporation\b/g, "corp")
    .replace(/\bcompany\b/g, "co")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularizeToken(token) {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("sses")) return token;
  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function grammaticalKey(value) {
  return normalize(value)
    .split(" ")
    .map(singularizeToken)
    .join(" ");
}

/*
 * These overrides address clear semantic typing errors while remaining small
 * and transparent. New companies, projects, and technologies still emerge
 * automatically from generated evidence.
 */
const TYPE_OVERRIDES = new Map([
  ["european union", "Organization"],
  ["battery storage", "Technology"],
  ["lithium ion batteries", "Technology"],
  ["transformers", "Technology"],
  ["distribution transformers", "Technology"],
  ["microgrids", "Infrastructure"],
  ["vegetation management", "Concept"],
  ["sf6 alternatives", "Technology"]
]);

/*
 * Safe canonical-name families. These prevent plural/singular duplicates and
 * common acronym variants without merging genuinely distinct concepts.
 */
const CANONICAL_FAMILIES = [
  {
    canonical: "Grid Operators",
    members: ["grid operator", "grid operators", "system operator", "system operators"]
  },
  {
    canonical: "Battery Energy Storage Systems",
    members: [
      "battery energy storage system",
      "battery energy storage systems",
      "bess"
    ]
  },
  {
    canonical: "Battery Storage",
    members: ["battery storage", "grid scale battery storage"]
  },
  {
    canonical: "Gas-Insulated Switchgear",
    members: ["gas insulated switchgear", "gis"]
  },
  {
    canonical: "Artificial Intelligence",
    members: ["artificial intelligence", "ai"]
  },
  {
    canonical: "Rooftop Solar",
    members: ["rooftop solar", "rooftop pv"]
  }
];

const FAMILY_LOOKUP = new Map();
for (const family of CANONICAL_FAMILIES) {
  for (const member of family.members) {
    FAMILY_LOOKUP.set(normalize(member), family.canonical);
  }
}

function canonicalName(entity) {
  const candidates = [
    entity.name,
    ...(Array.isArray(entity.aliases) ? entity.aliases : [])
  ].map(normalize).filter(Boolean);

  for (const candidate of candidates) {
    const family = FAMILY_LOOKUP.get(candidate);
    if (family) return family;
  }

  return clean(entity.name);
}

function entityMatchKey(entity) {
  const canonical = canonicalName(entity);
  const exact = normalize(canonical);
  const grammatical = grammaticalKey(canonical);

  /*
   * Type is intentionally not part of the key. Type conflicts are repaired
   * after matching, because the same entity may have been classified
   * differently on separate runs.
   */
  return FAMILY_LOOKUP.get(exact)
    ? normalize(FAMILY_LOOKUP.get(exact))
    : grammatical;
}

const TYPE_PRIORITY = [
  "Country",
  "Company",
  "Utility",
  "ISO/RTO",
  "Organization",
  "Project",
  "Facility",
  "Infrastructure",
  "Equipment",
  "Technology",
  "Material",
  "Standard",
  "Policy",
  "Market",
  "Concept"
];

function chooseType(entities, canonical) {
  const override = TYPE_OVERRIDES.get(normalize(canonical));
  if (override) return override;

  const types = entities.map((entity) => clean(entity.type)).filter(Boolean);

  for (const preferred of TYPE_PRIORITY) {
    if (types.includes(preferred)) return preferred;
  }

  return types[0] || "Concept";
}

function chooseCanonicalEntity(group) {
  const canonical = canonicalName(group[0]);

  const sorted = [...group].sort((a, b) => {
    const aDevelopmentCount = (a.development_ids || []).length;
    const bDevelopmentCount = (b.development_ids || []).length;

    if (bDevelopmentCount !== aDevelopmentCount) {
      return bDevelopmentCount - aDevelopmentCount;
    }

    if (Number(b.confidence || 0) !== Number(a.confidence || 0)) {
      return Number(b.confidence || 0) - Number(a.confidence || 0);
    }

    return clean(a.entity_id).localeCompare(clean(b.entity_id));
  });

  return {
    canonical,
    base: sorted[0]
  };
}

function earliest(values) {
  return values.filter(Boolean).sort()[0] || null;
}

function latest(values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function mergeEntityGroup(group) {
  const { canonical, base } = chooseCanonicalEntity(group);

  const aliases = unique(
    group.flatMap((entity) => [
      entity.name,
      ...(entity.aliases || [])
    ])
  ).filter((alias) => normalize(alias) !== normalize(canonical));

  const descriptions = group
    .map((entity) => clean(entity.description))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  return {
    ...base,
    name: canonical,
    slug: normalize(canonical).replace(/\s+/g, "-"),
    type: chooseType(group, canonical),
    description: descriptions[0] || "",
    aliases,
    confidence: Math.max(
      ...group.map((entity) => Number(entity.confidence || 0.55))
    ),
    first_seen_at: earliest(group.map((entity) => entity.first_seen_at)),
    last_seen_at: latest(group.map((entity) => entity.last_seen_at)),
    development_ids: unique(
      group.flatMap((entity) => entity.development_ids || [])
    ),
    merged_entity_ids: unique(
      group.flatMap((entity) => [
        entity.entity_id,
        ...(entity.merged_entity_ids || [])
      ])
    ).filter((id) => id !== base.entity_id),
    resolution: {
      canonicalized_at: NOW,
      merged_record_count: group.length
    }
  };
}

function buildResolution(entities) {
  const groups = new Map();

  for (const entity of entities) {
    const key = entityMatchKey(entity);
    const group = groups.get(key) || [];
    group.push(entity);
    groups.set(key, group);
  }

  const redirects = new Map();
  const resolved = [];
  const mergedGroups = [];

  for (const [key, group] of groups.entries()) {
    const merged = mergeEntityGroup(group);
    resolved.push(merged);

    for (const entity of group) {
      redirects.set(entity.entity_id, merged.entity_id);
    }

    if (group.length > 1) {
      mergedGroups.push({
        match_key: key,
        canonical_entity_id: merged.entity_id,
        canonical_name: merged.name,
        merged_entity_ids: group
          .map((entity) => entity.entity_id)
          .filter((id) => id !== merged.entity_id),
        original_names: unique(group.map((entity) => entity.name)),
        original_types: unique(group.map((entity) => entity.type))
      });
    }
  }

  return { resolved, redirects, mergedGroups };
}

function rewriteDevelopment(development, redirects, entityById) {
  const seen = new Set();
  const rewrittenEntities = [];

  for (const entity of development.entities || []) {
    const canonicalId = redirects.get(entity.entity_id) || entity.entity_id;
    if (!canonicalId || seen.has(canonicalId)) continue;

    seen.add(canonicalId);
    rewrittenEntities.push(entityById.get(canonicalId) || {
      ...entity,
      entity_id: canonicalId
    });
  }

  const rewrittenRelationships = (development.relationships || []).map(
    (relationship) => ({
      ...relationship,
      from_entity_id:
        redirects.get(relationship.from_entity_id) ||
        relationship.from_entity_id,
      to_entity_id:
        redirects.get(relationship.to_entity_id) ||
        relationship.to_entity_id
    })
  );

  return {
    ...development,
    entities: rewrittenEntities,
    relationships: rewrittenRelationships
  };
}

function relationshipKey(relationship) {
  return [
    relationship.from_entity_id,
    relationship.relationship_type,
    relationship.to_entity_id
  ].join("::");
}

function mergeRelationships(relationships, redirects) {
  const byKey = new Map();

  for (const original of relationships) {
    const relationship = {
      ...original,
      from_entity_id:
        redirects.get(original.from_entity_id) || original.from_entity_id,
      to_entity_id:
        redirects.get(original.to_entity_id) || original.to_entity_id
    };

    /*
     * Remove self-referential edges created solely by entity consolidation.
     */
    if (
      relationship.from_entity_id &&
      relationship.from_entity_id === relationship.to_entity_id
    ) {
      continue;
    }

    const key = relationshipKey(relationship);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, relationship);
      continue;
    }

    byKey.set(key, {
      ...existing,
      strength: Math.max(
        Number(existing.strength || 0),
        Number(relationship.strength || 0)
      ),
      confidence: Math.max(
        Number(existing.confidence || 0),
        Number(relationship.confidence || 0)
      ),
      evidence_development_ids: unique([
        ...(existing.evidence_development_ids || []),
        ...(relationship.evidence_development_ids || [])
      ]),
      source_ids: unique([
        ...(existing.source_ids || []),
        ...(relationship.source_ids || [])
      ]),
      evidence_count: unique([
        ...(existing.evidence_development_ids || []),
        ...(relationship.evidence_development_ids || [])
      ]).length,
      last_seen_at: latest([
        existing.last_seen_at,
        relationship.last_seen_at
      ]),
      version: Math.max(
        Number(existing.version || 1),
        Number(relationship.version || 1)
      ) + 1
    });
  }

  return [...byKey.values()];
}

function main() {
  console.log("Resolving PTD Today entities...");

  const entitiesPayload = readJson(ENTITIES_PATH);
  const developmentsPayload = readJson(DEVELOPMENTS_PATH);
  const relationshipsPayload = readJson(RELATIONSHIPS_PATH);

  const originalEntities = entitiesPayload.entities || [];
  const originalRelationships = relationshipsPayload.relationships || [];

  const { resolved, redirects, mergedGroups } =
    buildResolution(originalEntities);

  const entityById = new Map(
    resolved.map((entity) => [entity.entity_id, entity])
  );

  const developments = (developmentsPayload.developments || []).map(
    (development) =>
      rewriteDevelopment(development, redirects, entityById)
  );

  const relationships = mergeRelationships(
    originalRelationships,
    redirects
  );

  writeJson(ENTITIES_PATH, {
    ...entitiesPayload,
    schema_version: "1.2-resolved",
    generated_at: NOW,
    entity_count: resolved.length,
    entities: resolved.sort((a, b) => a.name.localeCompare(b.name))
  });

  writeJson(DEVELOPMENTS_PATH, {
    ...developmentsPayload,
    schema_version: "1.1-resolved",
    generated_at: NOW,
    development_count: developments.length,
    developments
  });

  writeJson(RELATIONSHIPS_PATH, {
    ...relationshipsPayload,
    schema_version: "1.1-resolved",
    generated_at: NOW,
    relationship_count: relationships.length,
    relationships
  });

  writeJson(REPORT_PATH, {
    schema_version: "1.0",
    generated_at: NOW,
    before: {
      entity_count: originalEntities.length,
      relationship_count: originalRelationships.length
    },
    after: {
      entity_count: resolved.length,
      relationship_count: relationships.length
    },
    merged_group_count: mergedGroups.length,
    merged_groups: mergedGroups
  });

  console.log("Entity resolution complete.");
  console.log(`- Entities: ${originalEntities.length} → ${resolved.length}`);
  console.log(
    `- Relationships: ${originalRelationships.length} → ${relationships.length}`
  );
  console.log(`- ${REPORT_PATH}`);
}

try {
  main();
} catch (error) {
  console.error("Entity resolution failed:");
  console.error(error);
  process.exit(1);
}
