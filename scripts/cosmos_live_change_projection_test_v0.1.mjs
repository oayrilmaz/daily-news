#!/usr/bin/env node
import fs from "node:fs";
import assert from "node:assert/strict";
import {buildButterflyChangeGridContract} from "./cosmos_butterfly_grid_contract_v0.1.mjs";

const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const entitiesRaw=read("knowledge/entities.json");
const entities=Array.isArray(entitiesRaw)?entitiesRaw:(entitiesRaw.entities||[]);
const byId=new Map(entities.map(e=>[e.entity_id,e]));
const changesRaw=read("knowledge/cosmos/cosmos-integration-m2-test-v0.1/world-changes.json");
const edgesRaw=read("knowledge/cosmos/cosmos-integration-m2-test-v0.1/causal-edges.json");
const changes=changesRaw.world_changes;
const edges=edgesRaw.causal_edges;

for(const c of changes){
  assert.ok(byId.has(c.subject_id),`Fixture Change subject must resolve to a real Cosmos entity: ${c.subject_id}`);
}
const grid=buildButterflyChangeGridContract({
  changes,
  causalEdges:edges,
  originChangeId:changes[0].transition_id,
  currentChangeId:changes[1].transition_id
});
assert.equal(grid.mode,"change_causal");
assert.equal(grid.center.id,"chg_fixture_project_schedule");
assert.ok(grid.initial_view.nodes.some(n=>n.id==="chg_fixture_transformer_lead_time"));
assert.ok(grid.initial_view.nodes.some(n=>n.id==="chg_fixture_substation_exposure"));
assert.ok(grid.initial_view.edges.some(e=>e.relation_class==="cause"));
assert.ok(grid.initial_view.edges.some(e=>e.relation_class==="effect"));
assert.equal(grid.navigation_contract.why_action,"follow_cause");
assert.equal(grid.navigation_contract.next_action,"follow_effect");
assert.equal(grid.navigation_contract.around_action,"return_to_object_projection");

const html=fs.readFileSync("cosmos.html","utf8");
for(const required of [
  "/knowledge/cosmos/world-changes-current.json",
  "/knowledge/cosmos/causal-change-edges-current.json",
  'focus_type:"change"',
  '"FOLLOW_CAUSE"',
  '"FOLLOW_EFFECT"',
  '"AROUND"',
  'data-butterfly-why',
  'data-butterfly-next',
  'data-butterfly-around'
]) assert.ok(html.includes(required),`cosmos.html missing integration marker: ${required}`);

const liveChanges=read("knowledge/cosmos/world-changes-current.json");
const liveEdges=read("knowledge/cosmos/causal-change-edges-current.json");
assert.deepEqual(liveChanges.world_changes,[]);
assert.deepEqual(liveEdges.causal_edges,[]);
assert.equal(liveChanges.safeguards.fixture_data_not_published_as_world_fact,true);
assert.equal(liveEdges.safeguards.fixture_data_not_published_as_world_fact,true);

console.log("PASS cosmos_live_change_projection_test_v0.1",{
  resolved_fixture_subjects:changes.length,
  visible_nodes:grid.initial_view.visible_node_count,
  visible_edges:grid.initial_view.visible_edge_count,
  live_world_changes:liveChanges.world_changes.length,
  live_causal_edges:liveEdges.causal_edges.length
});
