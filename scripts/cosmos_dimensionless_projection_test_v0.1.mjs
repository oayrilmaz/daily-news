#!/usr/bin/env node

import path from "path";
import { pathToFileURL } from "url";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const engineArgIndex = process.argv.indexOf("--engine");
const enginePath = path.resolve(
  engineArgIndex >= 0 && process.argv[engineArgIndex + 1]
    ? process.argv[engineArgIndex + 1]
    : "scripts/cosmos_dimensionless_projection_v0.1.mjs"
);

const { buildDimensionlessProjection } = await import(pathToFileURL(enginePath).href);

assert(
  typeof buildDimensionlessProjection === "function",
  "buildDimensionlessProjection export missing"
);

const graph = {
  schema_version: "fixture-0.1",
  nodes: [
    { id: "signal", label: "Today's Signal", type: "signal" },
    { id: "transformers", label: "Transformers", type: "infrastructure" },
    { id: "substations", label: "Substations", type: "infrastructure" },
    { id: "procurement", label: "Procurement", type: "process" },
    { id: "oem", label: "OEM Load", type: "market" },
    { id: "capex", label: "Grid CapEx", type: "market" },
    { id: "lead", label: "Lead Times", type: "process" },
    { id: "materials", label: "Materials", type: "material" },
    { id: "projects", label: "Projects", type: "project" },
    { id: "schedule", label: "Schedule", type: "project" },
    { id: "emergence", label: "Emergence", type: "concept" }
  ],
  edges: [
    { id: "e1", from: "signal", to: "transformers", relationship: "increases demand for", confidence: 0.90, evidence_ids: ["ev1", "ev2"], temporal_state: "current", epistemic_status: "supported" },
    { id: "e2", from: "signal", to: "substations", relationship: "increases pressure on", confidence: 0.88, evidence_ids: ["ev3"] },
    { id: "e3", from: "signal", to: "procurement", relationship: "changes", confidence: 0.80, evidence_ids: ["ev4"] },
    { id: "e4", from: "transformers", to: "oem", relationship: "increases", confidence: 0.84, evidence_ids: ["ev5"] },
    { id: "e5", from: "substations", to: "capex", relationship: "influences", confidence: 0.81, evidence_ids: ["ev6"] },
    { id: "e6", from: "procurement", to: "lead", relationship: "affects", confidence: 0.79, evidence_ids: ["ev7"] },
    { id: "e7", from: "lead", to: "procurement", relationship: "changes strategy for", confidence: 0.72, evidence_ids: ["ev8"] },
    { id: "e8", from: "oem", to: "materials", relationship: "increases demand for", confidence: 0.76, evidence_ids: ["ev9"] },
    { id: "e9", from: "capex", to: "projects", relationship: "funds", confidence: 0.82, evidence_ids: ["ev10"] },
    { id: "e10", from: "projects", to: "schedule", relationship: "affects", confidence: 0.78, evidence_ids: ["ev11"] },
    { id: "e11", from: "lead", to: "schedule", relationship: "extends", confidence: 0.74, evidence_ids: ["ev12"] },
    { id: "e12", from: "materials", to: "projects", relationship: "constrains", confidence: 0.68, evidence_ids: ["ev13"] },
    { id: "e13", from: "projects", to: "substations", relationship: "creates requirements for", confidence: 0.71, evidence_ids: ["ev14"] },
    { id: "e14", from: "schedule", to: "emergence", relationship: "may contribute to", confidence: 0.46, evidence_ids: ["ev15"], epistemic_status: "scenario" }
  ]
};

const original = JSON.stringify(graph);

const projectionSignal = buildDimensionlessProjection({
  graph,
  focus: { type: "signal", id: "signal" },
  maxNodes: 11,
  maxDistance: 4
});

assert(projectionSignal.status === "dimensionless_projection_resolved", "Signal projection did not resolve");
assert(projectionSignal.focus.id === "signal", "Signal was not preserved as observer center");
assert(
  projectionSignal.projection.nodes.find((n) => n.id === "signal")?.projection_distance === 0,
  "Center distance must be zero"
);
assert(
  projectionSignal.projection.edges.some(
    (edge) => edge.from === "lead" && edge.to === "procurement" && edge.connects_surrounding_nodes === true
  ),
  "Surrounding-node relationship was not preserved"
);
assert(
  projectionSignal.projection.feedback_loops.some(
    (row) => [row.node_a, row.node_b].includes("lead") && [row.node_a, row.node_b].includes("procurement")
  ),
  "Feedback loop was not detected"
);

const projectionTransformers = buildDimensionlessProjection({
  graph,
  focus: { type: "entity", id: "transformers" },
  maxNodes: 11,
  maxDistance: 4
});

assert(
  projectionTransformers.projection.nodes.find((n) => n.id === "transformers")?.projection_distance === 0,
  "Recentered Transformers node must become distance zero"
);
assert(
  projectionTransformers.projection.nodes.find((n) => n.id === "signal")?.projection_distance === 1,
  "Original signal should become distance one after recentering"
);

const projectionMaterials = buildDimensionlessProjection({
  graph,
  focus: { type: "material", id: "materials" },
  maxNodes: 11,
  maxDistance: 4
});

assert(
  projectionMaterials.projection.nodes.find((n) => n.id === "materials")?.projection_distance === 0,
  "Materials must become distance zero after second recentering"
);

assert(JSON.stringify(graph) === original, "Underlying graph changed during projection/recentering");

for (const projection of [projectionSignal, projectionTransformers, projectionMaterials]) {
  assert(projection.contracts.observer_defines_center === true, "Observer-center contract failed");
  assert(projection.contracts.projection_distance_relative_to_center === true, "Relative-distance contract failed");
  assert(projection.contracts.surrounding_node_relationships_preserved === true, "Grid relationship preservation contract failed");
  assert(projection.contracts.hidden_cosmos_not_deleted === true, "Hidden Cosmos contract failed");
  assert(projection.contracts.feedback_relationships_supported === true, "Feedback contract failed");
  assert(projection.safeguards.calls_openai_or_external_api === false, "OpenAI/API safeguard failed");
  assert(projection.safeguards.mutates_graph === false, "Graph mutation safeguard failed");
  assert(projection.safeguards.creates_new_facts === false, "New-fact safeguard failed");
}

console.log(JSON.stringify({
  schema_version: "0.1",
  status: "dimensionless_projection_test_passed",
  projections_tested: [
    {
      focus: projectionSignal.focus,
      visible_nodes: projectionSignal.projection.visible_node_count,
      visible_edges: projectionSignal.projection.visible_edge_count
    },
    {
      focus: projectionTransformers.focus,
      visible_nodes: projectionTransformers.projection.visible_node_count,
      visible_edges: projectionTransformers.projection.visible_edge_count
    },
    {
      focus: projectionMaterials.focus,
      visible_nodes: projectionMaterials.projection.visible_node_count,
      visible_edges: projectionMaterials.projection.visible_edge_count
    }
  ],
  contracts: projectionSignal.contracts,
  safeguards: projectionSignal.safeguards
}, null, 2));
