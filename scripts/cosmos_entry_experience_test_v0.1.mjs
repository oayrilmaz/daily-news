#!/usr/bin/env node
/**
 * Deterministic test for Cosmos Entry Experience v0.1
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      out[key] = value;
      i += 1;
    } else out[key] = true;
  }
  return out;
}

const args = parseArgs(process.argv);
const enginePath = path.resolve(args.engine || "scripts/cosmos_entry_experience_v0.1.mjs");
const { buildCosmosEntryExperience } = await import(pathToFileURL(enginePath).href);

const dormant = buildCosmosEntryExperience({});
const causal = buildCosmosEntryExperience({
  question: "Why are transformer lead times increasing?",
  center_intelligence: {
    id: "transformer-lead-times",
    label: "Transformer Lead Times",
    type: "signal",
    summary: "Fixture summary only.",
    why_it_matters: "Fixture importance only.",
    evidence_ids: ["fixture-evidence-1"],
    epistemic_status: "scenario"
  }
});
const media = buildCosmosEntryExperience({
  question: "Show me videos about transformers"
});
const map = buildCosmosEntryExperience({
  question: "What is going on in the United States?"
});
const unknown = buildCosmosEntryExperience({
  question: "EPC Contractors"
});

assert(dormant.entry.route === "/", "Root entry must be /");
assert(dormant.entry.mode === "dormant", "Empty entry must be dormant");
assert(dormant.entry.initial_surfaces_visible.length === 0, "Dormant entry must show no legacy surface");
assert(dormant.entry.permanent_navigation.length === 0, "Permanent navigation must be empty");
assert(dormant.entry.primary_interaction.type === "ask_cosmos", "Ask Cosmos must be primary");

assert(causal.intent.view === "cosmos_projection", "Why-question must resolve to Cosmos projection");
assert(causal.observer.question === "Why are transformer lead times increasing?", "Original question must be preserved");
assert(causal.observer.return_to_entry_observer.available === true, "Entry observer must be recoverable");
assert(causal.center_intelligence.summary === "Fixture summary only.", "Supplied center intelligence must be preserved");
assert(causal.cosmos_projection_contract.collision_safe_layout_required === true, "Collision-safe layout required");
assert(causal.cosmos_projection_contract.overlapping_nodes_allowed === false, "Node overlap must be forbidden");

assert(media.intent.view === "media", "Video request must materialize media");
assert(map.intent.view === "global_intelligence_map", "Country/geography request must materialize map");
assert(unknown.center_intelligence.information_state === "requires_resolution", "Missing center information must be explicit");
assert(unknown.center_intelligence.summary === "", "Engine must not invent center summary");

for (const result of [dormant, causal, media, map, unknown]) {
  assert(result.status === "cosmos_entry_experience_resolved", "Unexpected status");
  assert(Object.values(result.contracts).every(Boolean), "All entry contracts must pass");
  assert(Object.values(result.safeguards).every((v) => v === false), "All safeguards must remain false");
}

const output = {
  schema_version: "0.1",
  status: "cosmos_entry_experience_test_passed",
  cases: {
    dormant_entry: {
      view: dormant.intent.view,
      visible_surfaces: dormant.entry.initial_surfaces_visible.length
    },
    causal_question: {
      view: causal.intent.view,
      center: causal.center_intelligence.label,
      return_to_entry_observer: causal.observer.return_to_entry_observer.available
    },
    media_question: { view: media.intent.view },
    geography_question: { view: map.intent.view },
    unresolved_center: {
      information_state: unknown.center_intelligence.information_state,
      invented_summary: Boolean(unknown.center_intelligence.summary)
    }
  },
  contracts: dormant.contracts,
  safeguards: dormant.safeguards
};

if (args.out) {
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(path.resolve(args.out), JSON.stringify(output, null, 2) + "\n");
}

process.stdout.write(JSON.stringify(output, null, 2) + "\n");
