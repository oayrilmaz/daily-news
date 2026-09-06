import assert from "node:assert/strict";
import causal from "./cosmos_causal_change_edge.cjs";
import {buildButterflyChangeGridContract} from "./cosmos_butterfly_grid_contract_v0.1.mjs";

const changes=[
 {transition_id:"chg_1",change_type:"world_change",subject_id:"transformer_lead_time",state_dimension_id:"lead_time",previous_state:{value:80,unit:"weeks"},current_state:{value:110,unit:"weeks"},unit:"weeks",direction:"increase",epistemic_state:"supported",current_state_time:"2026-08-20T00:00:00.000Z",geography:"United States",scope:"large_power_transformers"},
 {transition_id:"chg_2",change_type:"world_change",subject_id:"transformer_equipment_availability",state_dimension_id:"availability_date",previous_state:{value:10,unit:"days"},current_state:{value:40,unit:"days"},unit:"days",direction:"decrease",epistemic_state:"supported",current_state_time:"2026-09-10T00:00:00.000Z",geography:"United States",scope:"large_power_transformers"},
 {transition_id:"chg_3",change_type:"world_change",subject_id:"substation_execution_window_exposure",state_dimension_id:"schedule_exposure",previous_state:{value:10,unit:"percent"},current_state:{value:35,unit:"percent"},unit:"percent",direction:"increase",epistemic_state:"supported",current_state_time:"2026-09-20T00:00:00.000Z",geography:"United States",scope:"large_power_transformers"}
];
const e1=causal.validateCausalCandidate({from_change_id:"chg_1",to_change_id:"chg_2",mechanism:"Longer delivery lead time moves feasible equipment availability beyond the prior procurement window.",carrier:"procurement_delivery_schedule",conditions:["affected transformer class is required","no qualified substitute is available"],evidence_refs:["ev1"],structural_support_refs:["rel1"]},changes);
const e2=causal.validateCausalCandidate({from_change_id:"chg_2",to_change_id:"chg_3",mechanism:"Later equipment availability consumes schedule float and increases exposure of the substation execution window.",carrier:"project_schedule_dependency",conditions:["equipment lies on the controlling execution path","available float is insufficient to absorb the shift"],evidence_refs:["ev2"],structural_support_refs:["rel2"]},changes);
assert.equal(e1.accepted,true);assert.equal(e2.accepted,true);
const grid=buildButterflyChangeGridContract({changes,causalEdges:[e1.edge,e2.edge],originChangeId:"chg_1",currentChangeId:"chg_1"});
assert.equal(grid.mode,"change_causal");
assert.equal(grid.initial_view.visible_node_count,3);
assert.equal(grid.initial_view.visible_edge_count,2);
assert.equal(grid.initial_view.edges[0].relationship,"causal_change");
assert.equal(grid.navigation_contract.why_action,"follow_cause");
assert.equal(grid.navigation_contract.next_action,"follow_effect");
console.log("PASS cosmos_butterfly_change_grid_test_v0.1",grid.initial_view.nodes.map(n=>n.id).join(" -> "));
