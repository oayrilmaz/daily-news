import assert from "node:assert/strict";
import causal from "./cosmos_causal_change_edge.cjs";
const changes=[
 {transition_id:"chg_lead",change_type:"world_change",epistemic_state:"supported",current_state_time:"2026-08-20T00:00:00.000Z",geography:"United States",scope:"large_power_transformers"},
 {transition_id:"chg_avail",change_type:"world_change",epistemic_state:"supported",current_state_time:"2026-09-10T00:00:00.000Z",geography:"United States",scope:"large_power_transformers"}
];
const good={from_change_id:"chg_lead",to_change_id:"chg_avail",mechanism:"Longer required delivery lead time pushes feasible equipment availability beyond the prior need date.",carrier:"procurement_delivery_schedule",conditions:["affected transformer class is required","no qualified substitute is available within the required window"],evidence_refs:["ev_causal_1"],structural_support_refs:["rel_requires_1"]};
const ok=causal.validateCausalCandidate(good,changes);
assert.equal(ok.accepted,true);
assert.equal(ok.edge.butterfly_eligible,true);
assert.equal(causal.validateCausalCandidate({...good,mechanism:""},changes).accepted,false);
const reverseChanges=[changes[0],{...changes[1],current_state_time:"2026-08-01T00:00:00.000Z"}];
assert.ok(causal.validateCausalCandidate(good,reverseChanges).reasons.includes("temporal_order_incompatible"));
console.log("PASS cosmos_causal_change_edge_test_v0.1",ok.edge.causal_edge_id);
