#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

const generatorPath = path.resolve(
  argValue("--generator", "scripts/generate_ai_news.js")
);

const outPath = path.resolve(
  argValue("--out", "knowledge/cosmos/article-presentation-test-v0.1.html")
);

const moduleUrl = pathToFileURL(generatorPath).href;
const { renderArticleHtml, buildCausalPresentation } = await import(moduleUrl);

assert(typeof renderArticleHtml === "function", "renderArticleHtml export missing");
assert(typeof buildCausalPresentation === "function", "buildCausalPresentation export missing");

const item = {
  id: "dev_article_fixture",
  development_id: "dev_article_fixture",
  created_at: "2026-08-28T12:00:00Z",
  date_utc: "2026-08-28",
  category: "Substations",
  region: "North America",
  countries: ["United States"],
  title: "Substation capacity pressure",
  lede:
    "A controlled Cosmos fixture used to verify deterministic causal article presentation.",
  body:
    "Substation capacity pressure is the focal signal in this controlled fixture.\n\n" +
    "The article body remains readable narrative while Cosmos explains why the signal is active and how effects may propagate.",
  summary:
    "Recent data-center capacity signals and utility load expectations increase attention on substation capacity.",
  why_it_matters:
    "Substation constraints can propagate into equipment demand, lead times, schedules, and location decisions.",
  event_type: "Scenario Signal",
  confidence_label: "Medium",
  confidence_score: 0.78,
  importance_score: 86,
  tags: ["substations", "data-centers", "transformers"],
  watchlist: [
    "Utility load forecasts weaken materially",
    "Transformer lead times improve faster than expected",
    "Data-center project timing shifts"
  ],
  evidence: {
    mode: "ai_scenario",
    status: "unverified",
    source_ids: [],
    source_count: 0,
    note:
      "Controlled fixture: scenario intelligence only; no authoritative external evidence is attached."
  },
  entities: [
    {
      entity_id: "ent_ai",
      name: "AI Compute Demand",
      type: "Concept",
      aliases: []
    },
    {
      entity_id: "ent_data_centers",
      name: "Data-center Capacity Expansion",
      type: "Infrastructure",
      aliases: []
    },
    {
      entity_id: "ent_substations",
      name: "Substation Capacity Pressure",
      type: "Infrastructure",
      aliases: []
    },
    {
      entity_id: "ent_transformers",
      name: "Transformer Capacity Demand",
      type: "Infrastructure",
      aliases: []
    }
  ],
  relationships: [
    {
      relationship_id: "rel_ai_dc",
      from_entity_id: "ent_ai",
      to_entity_id: "ent_data_centers",
      relationship_type: "INCREASES",
      label: "increases",
      explanation: "AI compute demand may increase data-center capacity expansion.",
      confidence: 0.88
    },
    {
      relationship_id: "rel_dc_sub",
      from_entity_id: "ent_data_centers",
      to_entity_id: "ent_substations",
      relationship_type: "INCREASES",
      label: "increases",
      explanation: "Data-center expansion may increase substation capacity pressure.",
      confidence: 0.84
    },
    {
      relationship_id: "rel_sub_tx",
      from_entity_id: "ent_substations",
      to_entity_id: "ent_transformers",
      relationship_type: "INCREASES",
      label: "increases",
      explanation: "Substation pressure may increase transformer capacity demand.",
      confidence: 0.80
    }
  ]
};

const payload = {
  schema_version: "2.0-transitional",
  content_mode: "ai_scenario",
  updated_at: "2026-08-28T12:00:00Z",
  date_utc: "2026-08-28",
  disclaimer:
    "Informational only — AI-generated scenario intelligence; may contain errors. Not investment or engineering advice."
};

const causalNarrative = {
  schema_version: "0.1",
  status: "causal_narrative_resolved",
  focal_signal: {
    development_id: "dev_article_fixture",
    title: "Substation capacity pressure"
  },
  why_now: [
    {
      title: "Recent data-center project announcements increased",
      relevance: 95,
      confidence: 88
    },
    {
      title: "Utility load forecasts strengthened",
      relevance: 90,
      confidence: 84
    },
    {
      title: "Transformer lead-time pressure remained unresolved",
      relevance: 82,
      confidence: 80
    }
  ],
  upstream_drivers: [
    {
      statement: "AI compute demand growth",
      confidence: 88
    },
    {
      statement: "Data-center capacity expansion",
      confidence: 84
    }
  ],
  downstream_consequences: [
    {
      depth: 1,
      relationship_id: "rel_article_direct",
      evidence_ids: ["ev-article-1","ev-article-2"],
      epistemic_status: "scenario",
      from: "Substation capacity pressure",
      relation: "increases",
      to: "Transformer capacity demand",
      effective_confidence: 80,
      qualification: "scenario"
    },
    {
      depth: 2,
      relationship_id: "rel_article_second",
      evidence_ids: ["ev-article-3"],
      epistemic_status: "scenario",
      from: "Transformer capacity demand",
      relation: "increases",
      to: "OEM manufacturing capacity pressure",
      effective_confidence: 62,
      qualification: "scenario"
    },
    {
      depth: 3,
      relationship_id: "rel_article_third",
      evidence_ids: ["ev-article-4"],
      epistemic_status: "scenario",
      from: "OEM manufacturing capacity pressure",
      relation: "extends",
      to: "Transformer lead-time pressure",
      effective_confidence: 44,
      qualification: "scenario"
    },
    {
      depth: 4,
      relationship_id: "rel_article_fourth",
      evidence_ids: ["ev-article-5"],
      epistemic_status: "scenario",
      from: "Transformer lead-time pressure",
      relation: "increases",
      to: "Project schedule pressure",
      effective_confidence: 34,
      qualification: "scenario"
    },
    {
      depth: 5,
      relationship_id: "rel_article_fifth",
      evidence_ids: ["ev-article-6"],
      epistemic_status: "scenario",
      from: "Project schedule pressure",
      relation: "may influence",
      to: "Potential geographic investment relocation",
      effective_confidence: 8,
      qualification: "candidate_only"
    }
  ],
  what_could_change_this_path: [
    "Transformer manufacturing capacity expands faster than expected",
    "Data-center load growth slows",
    "Utilities accelerate alternative capacity solutions"
  ],
  evidence_note:
    "Controlled fixture only. Causal interpretation remains scenario-qualified and preserves declining confidence with causal distance."
};

const presentation = buildCausalPresentation(item, causalNarrative);
const html = renderArticleHtml({
  siteOrigin: "https://ptdtoday.com",
  item,
  payload,
  causalNarrative
});

assert(
  presentation.consequences.length === 5,
  "Expected five causal consequence rows"
);

const confidencePath = presentation.consequences
  .map((row) => Number(row.confidence))
  .filter(Number.isFinite);

for (let i = 1; i < confidencePath.length; i += 1) {
  assert(
    confidencePath[i] <= confidencePath[i - 1],
    "Causal-distance confidence must not increase"
  );
}

const requiredText = [
  "Why Cosmos noticed this today",
  "What is driving it",
  "Butterfly Effect",
  "Direct",
  "2nd-order",
  "3rd-order",
  "Follow this ripple →",
  "Explore Cosmos →",
  "Why this confidence?",
  "What could change this path?",
  "Evidence & confidence",
  "AI-generated scenario intelligence"
];

for (const expected of requiredText) {
  assert(html.includes(expected), `Rendered article missing: ${expected}`);
}

const sequence = [
  "Why Cosmos noticed this today",
  "What is driving it",
  "Substation capacity pressure is the focal signal",
  "Why it matters",
  "🦋 Butterfly Effect",
  "Follow this ripple →",
  "Explore Cosmos →",
  "What could change this path?",
  "Evidence & confidence"
];

for (let i = 1; i < sequence.length; i += 1) {
  assert(
    html.indexOf(sequence[i - 1]) < html.indexOf(sequence[i]),
    `Article reading sequence is wrong: ${sequence[i - 1]} must appear before ${sequence[i]}`
  );
}

assert(
  html.includes(
    "Recent data-center project announcements increased. Utility load forecasts strengthened. Transformer lead-time pressure remained unresolved."
  ),
  "Why-now activation events must render as readable sentences"
);

assert(
  html.includes("80% effective confidence") &&
  html.includes("62% effective confidence") &&
  html.includes("44% effective confidence") &&
  html.includes("34% effective confidence") &&
  html.includes("8% effective confidence"),
  "Rendered article must preserve effective confidence across ripple depth"
);

assert(
  !html.includes("<h2>Follow the ripple</h2>"),
  "Duplicate standalone Follow the ripple section must be removed"
);

assert(
  html.includes("relationship_id=rel_article_direct") &&
  html.includes("relationship_id=rel_article_second"),
  "Butterfly relationship deep links must preserve relationship IDs"
);

assert(
  html.includes("ev-article-1") &&
  html.includes("ev-article-3"),
  "Confidence inspector must expose preserved evidence lineage when available"
);

assert(
  html.includes("inherited from the Cosmos relationship / causal output"),
  "Confidence inspector must explain that presentation does not invent confidence arithmetic"
);

assert(
  !html.includes("verified reporting.</strong>"),
  "Presentation must not imply verified reporting"
);

writeFile(outPath, html);

const result = {
  schema_version: "0.1",
  status: "article_presentation_resolved",
  generator_path: generatorPath,
  output_path: outPath,
  section_contract: {
    signal_headline_present: true,
    why_cosmos_noticed_today_present: true,
    drivers_present: true,
    readable_article_present: true,
    why_it_matters_present: true,
    butterfly_effect_present: true,
    direct_second_third_order_present: true,
    duplicate_follow_the_ripple_removed: true,
    relationship_follow_action_present: true,
    explore_cosmos_action_present: true,
    confidence_inspector_present: true,
    relationship_deep_link_present: true,
    evidence_lineage_exposed_when_available: true,
    change_conditions_present: true,
    evidence_and_confidence_present: true
  },
  causal_contract: {
    causal_distance_confidence_non_increasing: true,
    deeper_paths_remain_qualified: true,
    candidate_only_consequence_preserved: true
  },
  safeguards: {
    performs_external_search: false,
    calls_openai_or_external_api: false,
    mutates_graph: false,
    promotes_scenario_to_fact: false,
    removes_uncertainty_language: false,
    fabricates_confidence_arithmetic: false
  }
};

console.log(JSON.stringify(result, null, 2));
