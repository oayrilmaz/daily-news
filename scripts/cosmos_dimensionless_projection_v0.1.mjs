#!/usr/bin/env node

import fs from "fs";
import path from "path";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function cleanString(value, fallback = "") {
  const text = (value ?? "").toString().trim();
  return text || fallback;
}

function normalizeKey(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function edgeDirection(relativeNodeId, edge) {
  if (edge.from === relativeNodeId && edge.to === relativeNodeId) return "self";
  if (edge.from === relativeNodeId) return "forward";
  if (edge.to === relativeNodeId) return "backward";
  return "lateral";
}

function normalizedConfidence(edge) {
  const raw = Number(
    edge.effective_confidence ??
    edge.confidence ??
    edge.confidence_score ??
    0
  );

  if (!Number.isFinite(raw)) return 0;
  return raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
}

function nodePriority(node, centerId, distances, incidentEdges) {
  if (node.id === centerId) return Number.POSITIVE_INFINITY;

  const distance = distances.get(node.id);
  if (!Number.isFinite(distance)) return -1;

  const incident = incidentEdges.get(node.id) || [];
  const bestConfidence = incident.reduce(
    (best, edge) => Math.max(best, normalizedConfidence(edge)),
    0
  );

  const evidenceBonus = incident.reduce(
    (sum, edge) => sum + (Array.isArray(edge.evidence_ids) ? edge.evidence_ids.length : 0),
    0
  );

  return 1000 - distance * 100 + bestConfidence + Math.min(50, evidenceBonus * 5);
}

function computeUndirectedDistances(centerId, nodesById, edges) {
  const adjacency = new Map();

  for (const id of nodesById.keys()) adjacency.set(id, new Set());

  for (const edge of edges) {
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) continue;
    adjacency.get(edge.from).add(edge.to);
    adjacency.get(edge.to).add(edge.from);
  }

  const distances = new Map([[centerId, 0]]);
  const queue = [centerId];

  while (queue.length) {
    const current = queue.shift();
    const currentDistance = distances.get(current);

    for (const next of adjacency.get(current) || []) {
      if (distances.has(next)) continue;
      distances.set(next, currentDistance + 1);
      queue.push(next);
    }
  }

  return distances;
}

function detectFeedbackPairs(edges) {
  const byPair = new Map();

  for (const edge of edges) {
    const key = [edge.from, edge.to].join("::");
    byPair.set(key, edge);
  }

  const feedback = [];

  for (const edge of edges) {
    const reverse = byPair.get([edge.to, edge.from].join("::"));
    if (!reverse) continue;

    const canonical = [edge.from, edge.to].sort().join("::");
    if (feedback.some((row) => row.canonical === canonical)) continue;

    feedback.push({
      canonical,
      node_a: edge.from,
      node_b: edge.to,
      edge_ids: unique([edge.id, reverse.id]),
      confidence: Math.min(
        normalizedConfidence(edge),
        normalizedConfidence(reverse)
      )
    });
  }

  return feedback;
}

export function buildDimensionlessProjection({
  graph,
  focus,
  maxNodes = 12,
  maxDistance = 3
}) {
  const rawNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph?.edges) ? graph.edges : [];

  const nodes = rawNodes
    .map((node) => ({
      id: cleanString(node?.id || node?.entity_id || node?.node_id),
      label: cleanString(node?.label || node?.name || node?.title),
      type: cleanString(node?.type || node?.entity_type || node?.node_type, "unknown"),
      temporal_state: cleanString(node?.temporal_state, "current"),
      geography_scope: node?.geography_scope ?? null,
      metadata: node?.metadata ?? {}
    }))
    .filter((node) => node.id);

  const edges = rawEdges
    .map((edge) => ({
      id: cleanString(edge?.id || edge?.relationship_id || edge?.edge_id),
      from: cleanString(edge?.from || edge?.from_id || edge?.from_entity_id),
      to: cleanString(edge?.to || edge?.to_id || edge?.to_entity_id),
      relationship: cleanString(
        edge?.relationship ||
        edge?.relationship_type ||
        edge?.label,
        "connected_to"
      ),
      direction: cleanString(edge?.direction, "directed"),
      confidence: normalizedConfidence(edge),
      evidence_ids: unique(edge?.evidence_ids || edge?.source_ids || []),
      temporal_state: cleanString(edge?.temporal_state, "current"),
      geography_scope: edge?.geography_scope ?? null,
      epistemic_status: cleanString(edge?.epistemic_status, "scenario"),
      qualification: edge?.qualification ?? null
    }))
    .filter((edge) => edge.id && edge.from && edge.to);

  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  let centerId = cleanString(focus?.id);
  if (!centerId && focus?.label) {
    const target = normalizeKey(focus.label);
    centerId = nodes.find((node) => normalizeKey(node.label) === target)?.id || "";
  }

  if (!centerId || !nodesById.has(centerId)) {
    throw new Error("Projection focus could not be resolved to a graph node");
  }

  const distances = computeUndirectedDistances(centerId, nodesById, edges);

  const incidentEdges = new Map();
  for (const node of nodes) incidentEdges.set(node.id, []);
  for (const edge of edges) {
    incidentEdges.get(edge.from)?.push(edge);
    incidentEdges.get(edge.to)?.push(edge);
  }

  const eligibleNodes = nodes
    .filter((node) => {
      const distance = distances.get(node.id);
      return Number.isFinite(distance) && distance <= maxDistance;
    })
    .sort((a, b) =>
      nodePriority(b, centerId, distances, incidentEdges) -
      nodePriority(a, centerId, distances, incidentEdges)
    );

  const selectedNodes = [];
  const selectedIds = new Set();

  const center = nodesById.get(centerId);
  selectedNodes.push(center);
  selectedIds.add(centerId);

  for (const node of eligibleNodes) {
    if (selectedIds.has(node.id)) continue;
    if (selectedNodes.length >= maxNodes) break;
    selectedNodes.push(node);
    selectedIds.add(node.id);
  }

  const visibleEdges = edges.filter(
    (edge) => selectedIds.has(edge.from) && selectedIds.has(edge.to)
  );

  const projectedNodes = selectedNodes.map((node) => ({
    ...node,
    projection_distance: distances.get(node.id),
    is_center: node.id === centerId
  }));

  const projectedEdges = visibleEdges.map((edge) => ({
    ...edge,
    relative_direction:
      edge.from === centerId || edge.to === centerId
        ? edgeDirection(centerId, edge)
        : "lateral",
    from_distance: distances.get(edge.from),
    to_distance: distances.get(edge.to),
    connects_surrounding_nodes:
      edge.from !== centerId && edge.to !== centerId
  }));

  const feedback = detectFeedbackPairs(visibleEdges);

  return {
    schema_version: "0.1",
    status: "dimensionless_projection_resolved",
    focus: {
      type: cleanString(focus?.type, "node"),
      id: centerId,
      label: center.label,
      reference_time: cleanString(focus?.reference_time, null),
      geography: focus?.geography ?? null
    },
    projection: {
      max_nodes: maxNodes,
      max_distance: maxDistance,
      visible_node_count: projectedNodes.length,
      visible_edge_count: projectedEdges.length,
      hidden_reachable_node_count: Math.max(
        0,
        [...distances.values()].filter((distance) => distance <= maxDistance).length -
        projectedNodes.length
      ),
      nodes: projectedNodes,
      edges: projectedEdges,
      feedback_loops: feedback
    },
    contracts: {
      observer_defines_center: true,
      projection_distance_relative_to_center: true,
      surrounding_node_relationships_preserved: projectedEdges.some(
        (edge) => edge.connects_surrounding_nodes
      ),
      recentering_requires_no_graph_mutation: true,
      hidden_cosmos_not_deleted: true,
      backward_forward_lateral_supported: true,
      feedback_relationships_supported: true,
      confidence_preserved_on_edges: true,
      evidence_lineage_preserved_on_edges: true,
      temporal_state_preserved: true,
      geography_scope_preserved: true
    },
    safeguards: {
      performs_external_search: false,
      calls_openai_or_external_api: false,
      mutates_graph: false,
      creates_new_facts: false,
      deletes_hidden_nodes: false,
      rewrites_edge_confidence: false,
      collapses_epistemic_status: false
    }
  };
}

async function main() {
  const graphPath = argValue("--graph");
  const focusId = argValue("--focus-id");
  const focusType = argValue("--focus-type", "node");
  const outPath = argValue("--out", "");
  const maxNodes = Number(argValue("--max-nodes", "12"));
  const maxDistance = Number(argValue("--max-distance", "3"));

  if (!graphPath) throw new Error("--graph is required");
  if (!focusId) throw new Error("--focus-id is required");

  const graph = readJson(graphPath);

  const projection = buildDimensionlessProjection({
    graph,
    focus: {
      type: focusType,
      id: focusId
    },
    maxNodes,
    maxDistance
  });

  if (outPath) writeJson(outPath, projection);
  console.log(JSON.stringify(projection, null, 2));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
