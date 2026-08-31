#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildAnswerFirst } from "./cosmos_answer_first_v0.1.mjs";

function assert(ok, msg) { if (!ok) throw new Error(msg); }

const fixture = {
  question: "What are the HV substation equipment?",
  object: {
    id: "ent_hv_substation",
    label: "HV Substation Equipment",
    type: "equipment_system",
    description: "High-voltage substations combine primary equipment, protection, control and auxiliary systems to transform, switch, measure and protect electric power.",
    equipment: [
      "Power Transformers",
      "Circuit Breakers",
      "Disconnect Switches",
      "Gas-Insulated Switchgear",
      "Instrument Transformers",
      "Surge Arresters",
      "Busbars",
      "Protection & Control Systems",
      "Station Service Systems"
    ]
  },
  intelligence: [
    {
      id: "dev_1",
      title: "Transformer manufacturing capacity stressed by critical-minerals and component bottlenecks",
      summary: "Upstream material constraints could lengthen transformer lead-times.",
      created_at: "2026-08-31T05:00:00Z",
      tags: ["transformers","substations"],
      relevance_score: 85
    },
    {
      id: "dev_2",
      title: "Prefabricated modular substations shorten commissioning but require standardized interfaces",
      summary: "Modular substations could materially shorten delivery timelines.",
      published_at: "2026-08-29T12:00:00Z",
      tags: ["substations","equipment"]
    },
    {
      id: "dev_3",
      title: "Substation monitoring expands",
      summary: "Monitoring and predictive maintenance are increasingly connected to aging assets.",
      tags: ["substations"],
      relevance_score: 70
    }
  ]
};

const result = buildAnswerFirst(fixture);

assert(result.status === "cosmos_answer_first_resolved", "bad status");
assert(result.presentation_order[0] === "answer", "answer must be first");
assert(result.answer.text.includes("Power Transformers"), "direct answer must contain equipment");
assert(result.current_intelligence.items.length === 3, "expected 3 relevant intelligence items");
assert(result.current_intelligence.items[0].date_display !== "Date unavailable", "dated article should display date");
assert(result.current_intelligence.items.some(x => x.date_display === "Date unavailable"), "missing date must be explicit");
assert(result.current_intelligence.items.every(x => x.follow_the_ripple.enabled), "ripple action missing");
assert(result.contracts.intelligence_does_not_replace_answer, "answer contract missing");
assert(result.safeguards.invents_missing_dates === false, "must not invent dates");

const testResult = {
  schema_version: "0.1",
  status: "cosmos_answer_first_test_passed",
  tested_question: fixture.question,
  direct_answer_preview: result.answer.text,
  intelligence_count: result.current_intelligence.count,
  dated_items: result.current_intelligence.items.filter(x => x.date).length,
  undated_items: result.current_intelligence.items.filter(x => !x.date).length,
  presentation_order: result.presentation_order,
  contracts: result.contracts,
  safeguards: result.safeguards
};

const outDir = process.argv.includes("--out-dir")
  ? process.argv[process.argv.indexOf("--out-dir")+1]
  : "";

if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "answer-first-hv-substation.json"), JSON.stringify(result, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "test-result.json"), JSON.stringify(testResult, null, 2) + "\n");
}
process.stdout.write(JSON.stringify(testResult, null, 2) + "\n");
