import assert from "node:assert/strict";
import worldChange from "./cosmos_world_change.cjs";

const rec=(id,value,date,{geo="United States",scope="large_power_transformers",type="reported"}={})=>({
  graph_record_id:id, claim_class:"validated_supported_state", confidence_score:85,
  evidence_record_ids:[`ev_${id}`],
  claim:{claim_type:"state_claim",subject_id:"transformer_lead_time",state_dimension:"lead_time",value,unit:"weeks",effective_at:date,geography:geo,scope,value_type:type}
});

const graph={knowledge_records:[
  rec("a",80,"2026-01-01"),
  rec("b",110,"2026-08-20"),
  rec("b2",110,"2026-08-20"),
  rec("conflict_a",120,"2026-09-15"),
  rec("conflict_b",125,"2026-09-15"),
  rec("forecast",150,"2026-12-01",{type:"forecast"}),
  rec("europe",130,"2026-09-01",{geo:"Europe"})
]};
const out=worldChange.deriveWorldChanges(graph);
assert.equal(out.counts.world_changes,1);
assert.equal(out.counts.rejected_state_claims,1);
assert.equal(out.counts.conflicts,1);
const c=out.world_changes[0];
assert.equal(c.previous_state.value,80);
assert.equal(c.current_state.value,110);
assert.equal(c.direction,"increase");
assert.equal(c.magnitude,30);
assert.equal(c.butterfly_eligible,false);
console.log("PASS cosmos_world_change_test_v0.1",out.counts,c.transition_id);
