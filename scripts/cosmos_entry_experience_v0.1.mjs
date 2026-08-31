#!/usr/bin/env node
/**
 * Cosmos Entry Experience v0.1
 * Deterministic, read-only entry contract for PTD Today.
 *
 * This layer does not call OpenAI, search the web, mutate the Cosmos graph,
 * or delete legacy PTD Today surfaces. It converts an entry state + optional
 * user intent into a UI/view contract that a frontend can render.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SCHEMA_VERSION = "0.1";

function cleanString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function slug(value) {
  return cleanString(value, "cosmos")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "cosmos";
}

const VIEW_RULES = [
  {
    id: "daily_intelligence",
    patterns: [
      /\b(today'?s?|daily|latest|new|changed|happened)\b.*\b(intelligence|brief|briefing|signals?|news|developments?)\b/i,
      /\bwhat changed\b/i,
      /\bwhat happened\b/i
    ],
    view: "daily_intelligence",
    label: "Daily Intelligence",
    centerType: "intent"
  },
  {
    id: "global_map",
    patterns: [/\b(map|country|countries|geograph\w*|region|where|united states|u\.?s\.?|usa)\b/i],
    view: "global_intelligence_map",
    label: "Global Intelligence",
    centerType: "geography"
  },
  {
    id: "media",
    patterns: [/\b(video|videos|media|watch|youtube)\b/i],
    view: "media",
    label: "Media",
    centerType: "intent"
  },
  {
    id: "communities",
    patterns: [/\b(group|groups|community|communities|linkedin)\b/i],
    view: "communities",
    label: "Professional Communities",
    centerType: "intent"
  },
  {
    id: "market",
    patterns: [/\b(market|markets|stock|stocks|outlook|investment|price|prices)\b/i],
    view: "market_pulse",
    label: "Market Pulse & Outlook",
    centerType: "market"
  },
  {
    id: "causal",
    patterns: [/\b(why|driver|driving|cause|causes|impact|effect|affect|consequence|ripple|butterfly|connected|relationship)\b/i],
    view: "cosmos_projection",
    label: "Cosmos",
    centerType: "question"
  }
];

function resolveIntent(question, explicitIntent = null) {
  const q = cleanString(question);
  if (!q) {
    return {
      status: "awaiting_question",
      intent: "entry",
      view: "cosmos_entry",
      label: "Cosmos",
      center_type: "cosmos",
      confidence: 100,
      deterministic_rule: "empty_question"
    };
  }

  if (explicitIntent && typeof explicitIntent === "object") {
    const view = cleanString(explicitIntent.view);
    if (view) {
      return {
        status: "resolved",
        intent: cleanString(explicitIntent.intent, "explicit"),
        view,
        label: cleanString(explicitIntent.label, "Cosmos"),
        center_type: cleanString(explicitIntent.center_type, "question"),
        confidence: Number.isFinite(explicitIntent.confidence)
          ? Math.max(0, Math.min(100, Math.round(explicitIntent.confidence)))
          : 100,
        deterministic_rule: "explicit_intent"
      };
    }
  }

  for (const rule of VIEW_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(q))) {
      return {
        status: "resolved",
        intent: rule.id,
        view: rule.view,
        label: rule.label,
        center_type: rule.centerType,
        confidence: 100,
        deterministic_rule: rule.id
      };
    }
  }

  return {
    status: "resolved",
    intent: "explore",
    view: "cosmos_projection",
    label: "Cosmos",
    center_type: "question",
    confidence: 100,
    deterministic_rule: "default_exploration"
  };
}

function buildCenterIntelligence(input, intent) {
  const question = cleanString(input.question);
  const observer = input.observer && typeof input.observer === "object" ? input.observer : {};
  const supplied = input.center_intelligence && typeof input.center_intelligence === "object"
    ? input.center_intelligence
    : {};

  const label = cleanString(
    supplied.label,
    cleanString(observer.label, question || "Cosmos")
  );

  return {
    id: cleanString(supplied.id, cleanString(observer.id, `observer:${slug(label)}`)),
    label,
    type: cleanString(supplied.type, cleanString(observer.type, intent.center_type)),
    summary: cleanString(supplied.summary),
    why_it_matters: cleanString(supplied.why_it_matters),
    provenance: normalizeArray(supplied.provenance),
    evidence_ids: normalizeArray(supplied.evidence_ids),
    temporal_state: cleanString(supplied.temporal_state, "unknown"),
    geography_scope: supplied.geography_scope ?? null,
    epistemic_status: cleanString(supplied.epistemic_status, "unqualified"),
    information_state: supplied.summary ? "available" : "requires_resolution",
    contract: {
      center_is_not_label_only: true,
      missing_center_information_is_explicit: true,
      no_summary_is_invented: !supplied.summary
    }
  };
}

export function buildCosmosEntryExperience(input = {}) {
  const question = cleanString(input.question);
  const intent = resolveIntent(question, input.intent);
  const center = buildCenterIntelligence(input, intent);
  const entryObserver = input.entry_observer && typeof input.entry_observer === "object"
    ? input.entry_observer
    : {
        id: center.id,
        label: center.label,
        type: center.type
      };

  const hasQuestion = Boolean(question);
  const route = intent.view === "cosmos_entry"
    ? "/"
    : `/cosmos.html?view=${encodeURIComponent(intent.view)}&observer=${encodeURIComponent(center.id)}`;

  return {
    schema_version: SCHEMA_VERSION,
    status: "cosmos_entry_experience_resolved",
    entry: {
      route: "/",
      brand: "Cosmos",
      product_context: "PTD Today",
      mode: hasQuestion ? "active" : "dormant",
      headline: "Cosmos",
      principle: "There is no absolute center. The observer creates the center.",
      primary_interaction: {
        type: "ask_cosmos",
        placeholder: "Ask Cosmos…",
        text_enabled: true,
        voice_contract_ready: true,
        voice_implementation_required: false
      },
      permanent_navigation: [],
      initial_surfaces_visible: hasQuestion ? [intent.view] : [],
      legacy_surfaces_preserved: [
        "daily_intelligence",
        "global_intelligence_map",
        "market_pulse",
        "media",
        "communities",
        "articles"
      ]
    },
    observer: {
      question: question || null,
      entry_observer: entryObserver,
      current_observer: {
        id: center.id,
        label: center.label,
        type: center.type
      },
      return_to_entry_observer: {
        available: true,
        observer_id: cleanString(entryObserver.id, center.id),
        observer_label: cleanString(entryObserver.label, center.label)
      }
    },
    intent,
    resolved_view: {
      id: intent.view,
      route,
      materialize_on_demand: intent.view !== "cosmos_entry",
      source_surfaces_are_not_deleted: true
    },
    center_intelligence: center,
    cosmos_projection_contract: {
      projection_requested: intent.view === "cosmos_projection",
      recenter_on_node_selection: true,
      preserve_entry_observer: true,
      edge_inspection: true,
      expand_one_layer: true,
      collision_safe_layout_required: true,
      overlapping_nodes_allowed: false,
      geometry_is_projection_not_ontology: true
    },
    contracts: {
      cosmos_is_root_entry_experience: true,
      cosmos_is_only_initial_centerpiece: true,
      no_permanent_home_media_groups_navigation: true,
      ask_cosmos_is_primary_interaction: true,
      views_materialize_from_user_intent: true,
      legacy_surfaces_preserved_not_deleted: true,
      original_question_preserved: true,
      entry_observer_recoverable: true,
      current_observer_has_intelligence_contract: true,
      center_information_not_invented_when_missing: true,
      projection_requires_collision_safe_layout: true,
      observer_defines_center: true,
      display_is_not_fixed_hierarchy: true
    },
    safeguards: {
      performs_external_search: false,
      calls_openai_or_external_api: false,
      mutates_graph: false,
      deletes_legacy_surfaces: false,
      creates_new_facts: false,
      invents_center_summary: false,
      rewrites_confidence: false,
      promotes_scenario_to_fact: false
    }
  };
}

const args = parseArgs(process.argv);
if (args.input) {
  const result = buildCosmosEntryExperience(readJson(args.input));
  if (args.out) writeJson(args.out, result);
  else process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
