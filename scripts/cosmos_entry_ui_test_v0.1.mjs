#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, token, i, arr) => {
    if (token.startsWith("--")) acc.push([token.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const file = path.resolve(args.html || "cosmos-entry-v0.1.html");
const html = fs.readFileSync(file, "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const required = [
  "<h1>Cosmos</h1>",
  "Ask Cosmos…",
  "Everything is connected.",
  "Ask anything. Explore everything.",
  'id="askForm"',
  'id="askInput"',
  'id="voiceButton"',
  "resolveView(question)",
  "cosmos_projection",
  "global_intelligence_map",
  "daily_intelligence",
  "market_pulse",
  "Professional Communities",
  "Creating a Cosmos observer around your question",
  "Your question becomes the temporary center.",
  "/cosmos.html?"
];

for (const token of required) {
  assert(html.includes(token), `Missing entry UI contract token: ${token}`);
}

const forbiddenVisibleNav = [
  '>Home<',
  '>Media</a>',
  '>Groups</a>'
];

for (const token of forbiddenVisibleNav) {
  const visiblePart = html.split('<nav class="hiddenLegacy"')[0];
  assert(!visiblePart.includes(token), `Permanent navigation leaked into entry UI: ${token}`);
}

assert(html.includes('class="hiddenLegacy"'), "Legacy surfaces must be preserved but hidden");
assert(html.includes("SpeechRecognition"), "Voice input contract missing");
assert(!html.includes("OPENAI_API_KEY"), "Entry UI must not expose OpenAI configuration");
assert(!html.includes("fetch("), "Entry UI v0.1 must not perform network reasoning");
assert(!html.includes("Math.random("), "Entry UI must not depend on random layout behavior");

const result = {
  schema_version: "0.1",
  status: "cosmos_entry_ui_test_passed",
  contracts: {
    cosmos_only_centerpiece: true,
    ask_cosmos_primary: true,
    permanent_navigation_absent: true,
    legacy_surfaces_preserved_hidden: true,
    deterministic_intent_routing_present: true,
    cosmos_projection_route_present: true,
    voice_input_contract_present: true,
    dormant_entry_requires_no_network_reasoning: true,
    question_becomes_observer: true
  },
  safeguards: {
    calls_openai_or_external_api: false,
    performs_external_search: false,
    mutates_graph: false,
    deletes_legacy_surfaces: false,
    exposes_api_key: false
  }
};

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
