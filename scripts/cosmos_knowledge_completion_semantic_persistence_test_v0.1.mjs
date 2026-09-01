#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"cosmos-semantic-persistence-"));
const graph=path.join(root,"graph.json");
const map=path.join(root,"map.json");
const out=path.join(root,"out.json");
const report=path.join(root,"report.json");

fs.writeFileSync(graph,JSON.stringify({
  schema_version:"0.1",status:"cosmos_graph_snapshot",
  knowledge_records:[
    {graph_record_id:"g1",knowledge_admission_id:"a1",validation_target_id:"validation_power_transformer",claim_class:"validated_supported_relationship",validation_disposition:"supported",confidence_score:75,confidence_band:"high",persistence_level:"persistent_knowledge",evidence_record_ids:["e1","e2"],active:true,reversibility:{reversible:true}},
    {graph_record_id:"g2",knowledge_admission_id:"a2",validation_target_id:"validation_circuit_breaker",claim_class:"validated_supported_relationship",validation_disposition:"supported",confidence_score:75,confidence_band:"high",persistence_level:"persistent_knowledge",evidence_record_ids:["e3","e4"],active:true,reversibility:{reversible:true}}
  ],audit_log:[]
},null,2));

fs.writeFileSync(map,JSON.stringify({
  schema_version:"0.1",status:"validated_semantic_claim_map",
  claims:[
    {validation_target_id:"validation_power_transformer",subject:{id:"hv_substations",label:"HV Substations"},predicate:{type:"CONTAINS_COMPONENT",label:"contains equipment"},object:{id:"power_transformer",label:"Power Transformer",class:"component_or_equipment"},answer_role:null,source_stage:"candidate_validation",semantic_status:"validated_semantic_claim"},
    {validation_target_id:"validation_circuit_breaker",subject:{id:"hv_substations",label:"HV Substations"},predicate:{type:"CONTAINS_COMPONENT",label:"contains equipment"},object:{id:"circuit_breaker",label:"Circuit Breaker",class:"component_or_equipment"},answer_role:null,source_stage:"candidate_validation",semantic_status:"validated_semantic_claim"}
  ]
},null,2));

const run=spawnSync(process.execPath,["scripts/cosmos_knowledge_completion_semantic_persistence_v0.1.mjs","--graph",graph,"--semantic-map",map,"--out",out,"--report",report],{encoding:"utf8"});
if(run.status!==0) throw new Error(run.stderr||run.stdout);
const g=JSON.parse(fs.readFileSync(out));
const r=JSON.parse(fs.readFileSync(report));
if(r.status!=="semantic_persistence_resolved" || r.bridge_state.enriched_record_count!==2) throw new Error("Bridge count invalid");
for(const rec of g.knowledge_records){
  if(!rec.semantic_claim || rec.semantic_claim.semantic_status!=="persistent_validated_semantic_claim") throw new Error("Semantic claim missing");
  if(rec.confidence_score!==75 || rec.evidence_record_ids.length!==2 || rec.reversibility?.reversible!==true) throw new Error("Persistent record semantics changed");
  if(rec.semantic_claim.answer_role!==null) throw new Error("Answer role was invented");
}
console.log("Cosmos Semantic Persistence Bridge v0.1 test passed.");
